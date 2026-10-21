'use strict';

/**
 * Vision manager generik untuk deskripsi gambar dan OCR.
 *
 * Sebelumnya modul ini terikat ke Gemini lewat SDK Google. Sekarang memakai
 * endpoint OpenAI-compatible apa pun, jadi cukup set VISION_BASE_URL dan
 * VISION_API_KEY ke provider mana pun (9router lokal, ZenMux, OpenAI, dsb)
 * tanpa mengubah kode.
 *
 * Model dipilih dari katalog provider (/models) berdasarkan kapabilitas
 * vision yang sebenarnya, bukan dari nama. Kalau katalog tidak tersedia,
 * dipakai VISION_MODEL atau pola nama sebagai cadangan.
 *
 * Modul video sengaja terpisah (videoVisionManager) karena kebutuhan dan
 * batas ukurannya berbeda.
 */

const axios = require('axios');
const sharp = require('sharp');
const OpenAI = require('openai');
const catalog = require('./modelCatalog');

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

const VISION_BASE_URL = normalizeBaseURL(readEnv('VISION_BASE_URL'));
const VISION_API_KEY = readEnv('VISION_API_KEY');
// Model eksplisit. Kosong berarti dipilih otomatis dari katalog.
const VISION_MODEL = readEnv('VISION_MODEL');
const VISION_TIMEOUT_MS = Number(readEnv('VISION_TIMEOUT_MS')) || 60000;
const VISION_MAX_DIMENSION = Number(readEnv('VISION_MAX_DIMENSION')) || 1024;
// Ambang minimum prompt_tokens untuk memastikan gambar benar-benar dicerna.
const MIN_IMAGE_PROMPT_TOKENS = Number(readEnv('VISION_MIN_PROMPT_TOKENS')) || 100;
// Jumlah kandidat model yang dicoba sebelum menyerah.
const MAX_VISION_ATTEMPTS = Number(readEnv('VISION_MAX_ATTEMPTS')) || 3;

// Model yang sudah terbukti tidak menerima gambar, supaya tidak dicoba ulang.
const failedVisionModels = new Set();

let visionClient = null;
let resolvedModel = null;

/**
 * Client OpenAI-compatible untuk provider vision.
 */
function getVisionClient() {
    if (!VISION_BASE_URL) {
        throw new Error(
            'VISION_BASE_URL belum diset. Isi dengan base URL provider ' +
            'OpenAI-compatible, misal https://zenmux.ai/api/v1 atau router lokal.'
        );
    }
    if (!visionClient) {
        visionClient = new OpenAI({
            apiKey: VISION_API_KEY || 'vision',
            baseURL: VISION_BASE_URL,
            // Retry otomatis memperlama kegagalan secara drastis: tiga kandidat
            // model dengan retry bisa jadi tiga menit. Vision manager hanya
            // jalur cadangan, jadi lebih baik cepat gagal lalu fallback.
            maxRetries: 0,
        });
    }
    return visionClient;
}

function isVisionProviderAvailable() {
    return Boolean(VISION_BASE_URL);
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
    if (VISION_MODEL) {
        resolvedModel = VISION_MODEL;
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
        const cat = await catalog.loadCatalog({
            baseURL: VISION_BASE_URL,
            apiKey: VISION_API_KEY,
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
async function fetchAndProcessImage(imageUrl, maxDimension = VISION_MAX_DIMENSION) {
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
            .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
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
        console.warn('[VisionManager] VISION_BASE_URL belum diset.');
        return null;
    }

    // Model eksplisit -> satu percobaan saja, karena user sudah menentukan.
    if (options.model || VISION_MODEL) {
        return tryDescribe(imageUrl, prompt, options.model || VISION_MODEL, options);
    }

    const candidates = await getVisionCandidates();
    if (!candidates.length) {
        return tryDescribe(imageUrl, prompt, await resolveVisionModel(), options);
    }

    // Coba beberapa kandidat teratas. Model yang gagal tidak dicoba lagi.
    const tried = [];
    for (const model of candidates.slice(0, MAX_VISION_ATTEMPTS)) {
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
        'Set VISION_MODEL untuk memilih model tertentu.'
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
            timeout: VISION_TIMEOUT_MS,
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
        if (promptTokens > 0 && promptTokens < MIN_IMAGE_PROMPT_TOKENS) {
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
    VISION_BASE_URL,
    VISION_API_KEY,
    VISION_MODEL,
    VISION_TIMEOUT_MS,
    VISION_MAX_DIMENSION,
    MIN_IMAGE_PROMPT_TOKENS,
    MAX_VISION_ATTEMPTS,
    isVisionProviderAvailable,
    getVisionClient,
    resolveVisionModel,
    getVisionCandidates,
    fetchAndProcessImage,
    describeImage,
    tryDescribe,
    extractTextFromImage,
    failedVisionModels,
    DEFAULT_DESCRIBE_PROMPT,
};
