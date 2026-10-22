'use strict';

/**
 * Vision manager generik untuk deskripsi gambar dan OCR.
 *
 * Konfigurasi dibaca dari config.yaml bagian `vision:`, yang merujuk provider
 * lewat `name` (base URL dan nama variabel key ada di sana, nilainya di .env).
 * Fallback ke VISION_BASE_URL / VISION_API_KEY kalau bagian itu belum ada.
 *
 * Model dipilih dari katalog provider (/models) berdasarkan kapabilitas
 * vision yang sebenarnya, bukan dari nama.
 *
 * Modul video sengaja terpisah (videoVisionManager) karena kebutuhan dan
 * batas ukurannya berbeda.
 */

const axios = require('axios');
const sharp = require('sharp');
const OpenAI = require('openai');
const catalog = require('./modelCatalog');
const botConfig = require('./botConfig');

function readEnv(...keys) {
    for (const key of keys) {
        const v = process.env[key];
        if (v) return v;
    }
    return '';
}

function normalizeBaseURL(url) {
    return (url || '').replace(/\/+$/, '');
}

const VISION_DEFAULTS = {
    provider: null,
    model: '',
    timeout_ms: 60000,
    max_dimension: 1024,
    min_prompt_tokens: 100,
    max_attempts: 3,
};

/**
 * Konfigurasi vision dari config.yaml bagian `vision:`.
 * Provider dirujuk lewat name, jadi base URL dan nama variabel key ada di
 * config sedangkan nilainya tetap di .env.
 */
function getVisionConfig() {
    const { section, provider } = botConfig.getProviderForSection('vision', VISION_DEFAULTS);
    // Model bisa diubah saat runtime lewat d!model (target "vision").
    const target = botConfig.getTargetValue('vision');

    const baseURL = provider
        ? normalizeBaseURL(provider.base_url)
        : normalizeBaseURL(readEnv('VISION_BASE_URL', 'ZENMUX_BASE_URL'));
    const apiKey = provider
        ? provider.apiKey
        : readEnv('VISION_API_KEY', 'ZENMUX_API_KEY');

    return {
        baseURL,
        apiKey,
        model: target.model || readEnv('VISION_MODEL'),
        timeoutMs: botConfig.asNumber(section.timeout_ms, 60000),
        maxDimension: botConfig.asNumber(section.max_dimension, 1024),
        minPromptTokens: botConfig.asNumber(section.min_prompt_tokens, 100),
        maxAttempts: botConfig.asNumber(section.max_attempts, 3),
    };
}

let visionClient = null;
let visionClientBaseURL = null;
let resolvedModel = null;

// Model yang sudah terbukti tidak menerima gambar, supaya tidak dicoba ulang.
const failedVisionModels = new Set();

/**
 * Client OpenAI-compatible untuk provider vision.
 */
function getVisionClient() {
    const cfg = getVisionConfig();
    if (!cfg.baseURL) {
        throw new Error(
            'Vision provider belum diset. Isi bagian `vision:` di config.yaml ' +
            '(provider: <name>) atau VISION_BASE_URL di .env.'
        );
    }
    // Client di-cache per base URL supaya ganti provider langsung berlaku.
    if (!visionClient || visionClientBaseURL !== cfg.baseURL) {
        visionClient = new OpenAI({
            apiKey: cfg.apiKey || 'vision',
            baseURL: cfg.baseURL,
            // Retry otomatis memperlama kegagalan secara drastis: tiga kandidat
            // model dengan retry bisa jadi tiga menit. Vision manager hanya
            // jalur cadangan, jadi lebih baik cepat gagal lalu fallback.
            maxRetries: 0,
        });
        visionClientBaseURL = cfg.baseURL;
    }
    return visionClient;
}

function isVisionProviderAvailable() {
    return Boolean(getVisionConfig().baseURL);
}

/**
 * Pilih model vision: pakai VISION_MODEL kalau di-set, kalau tidak ambil dari
 * katalog provider yang benar-benar melaporkan dukungan image.
 *
 * Katalog tidak selalu jujur (tunnel pihak ketiga kadang melaporkan vision
 * padahal model di baliknya teks murni), jadi model pilihan pertama diuji
 * dengan gambar kecil. Kalau gagal, kandidat berikutnya dicoba.
 *
 * Model "free" diprioritaskan kalau ada, karena vision manager hanya dipakai
 * sebagai cadangan sehingga biaya sekecil mungkin lebih penting daripada
 * kualitas tertinggi.
 */
async function resolveVisionModel() {
    if (resolvedModel) return resolvedModel;
    const cfg = getVisionConfig();
    if (cfg.model) {
        resolvedModel = cfg.model;
        return resolvedModel;
    }

    const candidates = await getVisionCandidates();
    if (!candidates.length) {
        // Cadangan terakhir: pola nama pada model chat yang sedang aktif.
        const { getActiveChatModelInfo } = require('./llmManager');
        const active = getActiveChatModelInfo();
        if (active?.model) {
            resolvedModel = active.model;
            console.warn(`[VisionManager] Fallback ke model aktif: ${resolvedModel}`);
            return resolvedModel;
        }
        throw new Error('Tidak ada model vision yang bisa dipakai.');
    }

    resolvedModel = candidates[0];
    console.log(
        `[VisionManager] Model dipilih dari katalog: ${resolvedModel} ` +
        `(${candidates.length} kandidat vision)`
    );
    return resolvedModel;
}

/**
 * Daftar model vision dari katalog, diurutkan: gratis dulu, lalu yang
 * namanya menunjukkan model ringan/cepat.
 */
async function getVisionCandidates() {
    try {
        const cfg = getVisionConfig();
        const cat = await catalog.loadCatalog({
            baseURL: cfg.baseURL,
            apiKey: cfg.apiKey,
            label: 'vision-manager',
        });
        if (!cat) return [];

        const candidates = [...cat.entries()]
            .filter(([, info]) => info.vision)
            .map(([id]) => id);

        const isFree = (id) => /free/i.test(id);
        const isFlash = (id) => /flash|mini|small|lite/i.test(id);

        return candidates.sort((a, b) => {
            if (isFree(a) !== isFree(b)) return isFree(a) ? -1 : 1;
            if (isFlash(a) !== isFlash(b)) return isFlash(a) ? -1 : 1;
            return a.localeCompare(b);
        });
    } catch (error) {
        console.warn(`[VisionManager] Gagal baca katalog: ${error.message}`);
        return [];
    }
}

/**
 * Unduh gambar dan siapkan buffer + data URL yang sudah dioptimalkan.
 * Animasi (GIF) diratakan jadi satu frame karena API chat hanya menerima
 * satu gambar per part.
 */
async function fetchAndProcessImage(imageUrl, maxDimension = null) {
    const limit = maxDimension || getVisionConfig().maxDimension;
    try {
        let buffer;
        if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
            buffer = Buffer.from(imageUrl.split(',')[1], 'base64');
        } else {
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 20000,
                headers: { 'User-Agent': 'BotDitos/2.2 (+discord)' },
            });
            buffer = Buffer.from(imageResponse.data);
        }

        const resizedBuffer = await sharp(buffer)
            .resize(limit, limit, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();

        const base64 = resizedBuffer.toString('base64');
        return {
            buffer: resizedBuffer,
            base64,
            mimeType: 'image/jpeg',
            dataUrl: `data:image/jpeg;base64,${base64}`,
        };
    } catch (err) {
        console.error('[VisionManager] fetchAndProcessImage error:', err.message);
        throw err;
    }
}

const DEFAULT_DESCRIBE_PROMPT =
    'Deskripsikan gambar ini dengan detail tapi jangan kepanjangan dalam bahasa Indonesia. ' +
    'Fokus ke hal-hal penting yang ada di gambar.';

/**
 * Deskripsikan gambar (atau OCR kalau prompt diisi instruksi khusus).
 *
 * Kalau model terpilih ternyata tidak benar-benar menerima gambar (umum pada
 * tunnel pihak ketiga yang melaporkan vision di katalog tapi model di
 * baliknya teks murni), kandidat berikutnya dicoba otomatis.
 *
 * @param {string} imageUrl URL atau data URL gambar
 * @param {string} [prompt] instruksi khusus, misal untuk OCR
 * @param {object} [options] { model, maxTokens }
 * @returns {Promise<string|null>} teks hasil, atau null kalau gagal
 */
async function describeImage(imageUrl, prompt = null, options = {}) {
    if (!isVisionProviderAvailable()) {
        console.warn('[VisionManager] Vision provider belum diset di config.yaml.');
        return null;
    }

    const cfg = getVisionConfig();

    // Model eksplisit dicoba lebih dulu. Kalau gagal (rate limit, gangguan
    // provider), kandidat lain tetap dicoba supaya gambar tidak hilang begitu
    // saja — dengan catatan model eksplisit tetap jadi prioritas.
    if (options.model || cfg.model) {
        const preferred = options.model || cfg.model;
        const text = await tryDescribe(imageUrl, prompt, preferred, options);
        if (text) return text;

        console.warn(
            `[VisionManager] Model pilihan (${preferred}) gagal, mencoba kandidat lain.`
        );
    }

    const candidates = await getVisionCandidates();
    if (!candidates.length) {
        return null;
    }

    // Coba beberapa kandidat teratas. Model yang gagal tidak dicoba lagi.
    const tried = [];
    for (const model of candidates.slice(0, cfg.maxAttempts)) {
        // Lewati model pilihan yang barusan gagal, jangan ulangi.
        if (options.model || cfg.model) {
            if (model === (options.model || cfg.model)) continue;
        }
        if (failedVisionModels.has(model)) continue;
        tried.push(model);
        const text = await tryDescribe(imageUrl, prompt, model, options);
        if (text) {
            resolvedModel = model;
            return text;
        }
        failedVisionModels.add(model);
    }

    console.warn(
        `[VisionManager] Semua kandidat gagal (${tried.join(', ')}). ` +
        'Periksa vision.model di config.yaml dan status provider.'
    );
    return null;
}

/**
 * Satu percobaan deskripsi dengan model tertentu.
 * @returns {Promise<string|null>}
 */
async function tryDescribe(imageUrl, prompt, model, options = {}) {
    try {
        const imageInfo = await fetchAndProcessImage(imageUrl);

        console.log(`[VisionManager] Memproses gambar dengan ${model}...`);
        const client = getVisionClient();

        const completion = await client.chat.completions.create({
            model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt || DEFAULT_DESCRIBE_PROMPT },
                        { type: 'image_url', image_url: { url: imageInfo.dataUrl } },
                    ],
                },
            ],
            // Model reasoning bisa menghabiskan budget untuk berpikir dan
            // mengembalikan content kosong, jadi beri ruang lebih.
            max_tokens: options.maxTokens || 1500,
        }, {
            timeout: getVisionConfig().timeoutMs,
        });

        const text = completion.choices?.[0]?.message?.content?.trim();
        const promptTokens = completion.usage?.prompt_tokens || 0;

        if (!text) {
            console.warn(
                `[VisionManager] Respons kosong (finish=${completion.choices?.[0]?.finish_reason}).`
            );
            return null;
        }

        // Model yang mengabaikan lampiran hanya menghasilkan puluhan token,
        // atau menjawab bahwa ia tidak bisa melihat gambar. Hasil seperti itu
        // adalah halusinasi/penolakan, jadi jangan dipakai.
        if (promptTokens > 0 && promptTokens < getVisionConfig().minPromptTokens) {
            console.warn(
                `[VisionManager] Gambar tidak ikut diproses (prompt_tokens=${promptTokens}). ` +
                `Model "${model}" kemungkinan tidak benar-benar menerima input gambar.`
            );
            return null;
        }
        if (/tidak (dapat|bisa) melihat|tidak mendukung (pemrosesan )?gambar|cannot (see|view|process) (the )?image|not support.*image/i.test(text)) {
            console.warn(`[VisionManager] Model "${model}" menolak input gambar.`);
            return null;
        }

        console.log(`[VisionManager] Selesai -> ${text.length} karakter`);
        return text;
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'unknown error';
        console.error(`[VisionManager] Gagal (${model}):`, reason);
        return null;
    }
}

/**
 * OCR: ambil teks dari gambar tanpa tambahan komentar.
 */
async function extractTextFromImage(imageUrl, instruction = null, options = {}) {
    const ocrInstruction = instruction ||
        'Extract all text from this image exactly as it appears. ' +
        'Do not add any commentary or explanation, just the text itself. ' +
        'If there is no text, reply exactly: [No text found]';

    return describeImage(imageUrl, ocrInstruction, options);
}

module.exports = {
    getVisionConfig,
    isVisionProviderAvailable,
    getVisionClient,
    resolveVisionModel,
    getVisionCandidates,
    fetchAndProcessImage,
    describeImage,
    tryDescribe,
    extractTextFromImage,
    DEFAULT_DESCRIBE_PROMPT,
};
