'use strict';

/**
 * Vision manager untuk VIDEO.
 *
 * Dipakai hanya ketika model utama TIDAK bisa menerima video. Kalau model utama
 * sudah video-capable, request video dikirim langsung ke model utama dan modul
 * ini tidak disentuh sama sekali.
 *
 * Konfigurasi dibaca dari config.yaml bagian `vision_video:`, yang merujuk
 * provider lewat `name`. Nilai API key tetap di .env lewat key_env provider.
 * Fallback ke env lama kalau bagian itu belum ada.
 */

const OpenAI = require('openai');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const { lookupModelCapabilities } = require('./modelCatalog');
const botConfig = require('./botConfig');

function readEnv(...keys) {
    for (const key of keys) {
        const value = process.env[key];
        if (value) return value;
    }
    return '';
}

function normalizeBaseURL(url) {
    return (url || '').replace(/\/+$/, '');
}

const VISION_VIDEO_DEFAULTS = {
    provider: null,
    model: '',
    timeout_ms: 240000,
    download_max_bytes: 104857600,
    target_bytes: 9437184,
    max_duration_s: 90,
    max_height: 480,
    min_prompt_tokens: 100,
};

/**
 * Konfigurasi video vision dari config.yaml bagian `vision_video:`.
 * Dibaca sebagai fungsi supaya perubahan config langsung berlaku.
 */
function getVideoConfig() {
    const { section, provider } = botConfig.getProviderForSection(
        'vision_video',
        VISION_VIDEO_DEFAULTS
    );

    const baseURL = provider
        ? normalizeBaseURL(provider.base_url)
        : normalizeBaseURL(
            readEnv('VISION_PROVIDER_BASE_URL', 'ZENMUX_BASE_URL', 'VISION_BASE_URL')
        );
    const apiKey = provider
        ? provider.apiKey
        : readEnv('VISION_PROVIDER_API_KEY', 'ZENMUX_API_KEY', 'VISION_API_KEY');

    return {
        baseURL,
        apiKey,
        providerName: provider?.name || null,
        model: section.model || readEnv('VISION_VIDEO_MODEL', 'ZENMUX_VIDEO_MODEL'),
        timeoutMs: botConfig.asNumber(section.timeout_ms, 240000),
        downloadMaxBytes: botConfig.asNumber(section.download_max_bytes, 104857600),
        targetBytes: botConfig.asNumber(section.target_bytes, 9437184),
        maxDurationS: botConfig.asNumber(section.max_duration_s, 90),
        maxHeight: botConfig.asNumber(section.max_height, 480),
        minPromptTokens: botConfig.asNumber(section.min_prompt_tokens, 100),
    };
}

// Model yang sudah terbukti tidak menerima input video. Setelah satu kegagalan
// nyata, jalur video dilewati untuk model itu supaya tidak membuang waktu dan
// token, dan langsung memakai grid frame sebagai gambar.
const videoUnsupportedModels = new Set();

function markModelVideoUnsupported(model) {
    if (model && !videoUnsupportedModels.has(model)) {
        videoUnsupportedModels.add(model);
        console.warn(
            `[VisionVideo] "${model}" ditandai tidak mendukung video; ` +
            'selanjutnya memakai jalur grid frame.'
        );
    }
}

function isModelMarkedVideoUnsupported(model) {
    return videoUnsupportedModels.has(model);
}

let visionClient = null;

function isVideoProviderAvailable() {
    const cfg = getVideoConfig();
    return Boolean(cfg.baseURL) && Boolean(cfg.model);
}

function getVisionClient() {
    if (!isVideoProviderAvailable()) {
        throw new Error(
            'Provider video belum dikonfigurasi. Isi bagian `vision_video:` ' +
            'di config.yaml (provider dan model).'
        );
    }

    if (!visionClient) {
        visionClient = new OpenAI({
            apiKey: cfg.apiKey || 'vision',
            baseURL: cfg.baseURL,
            timeout: cfg.timeoutMs,
            maxRetries: 0,
        });
    }

    return visionClient;
}

/**
 * Unduh video dari Discord, lalu kompres dengan ffmpeg sebelum dikirim.
 *
 * Video Discord umumnya ~50MB untuk clip 30 detik, dan base64 membengkak ~33%.
 * Mengirim mentah akan ditolak provider atau timeout, jadi video ditranscode
 * ke H.264 dengan resolusi dan bitrate yang disesuaikan target ukuran.
 */
async function fetchVideoAsDataUrl(videoUrl, options = {}) {
    const cfg = getVideoConfig();
    const downloadMax = options.downloadMaxBytes || cfg.downloadMaxBytes;
    const targetBytes = options.targetBytes || cfg.targetBytes;
    const maxDuration = options.maxDurationS || cfg.maxDurationS;
    const maxHeight = options.maxHeight || cfg.maxHeight;

    const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: downloadMax,
        maxBodyLength: downloadMax,
        headers: { 'User-Agent': 'BotDitos/2.2 (+discord)' },
    });

    const original = Buffer.from(response.data);
    if (original.length > downloadMax) {
        throw new Error(
            `Video terlalu besar untuk diunduh: ${(original.length / 1024 / 1024).toFixed(1)}MB ` +
            `(batas ${(downloadMax / 1024 / 1024).toFixed(0)}MB)`
        );
    }

    const contentType = response.headers?.['content-type']?.split(';')[0] || 'video/mp4';

    // Kalau sudah cukup kecil, tidak perlu transcode.
    if (original.length <= targetBytes) {
        return {
            dataUrl: `data:${contentType};base64,${original.toString('base64')}`,
            mimeType: contentType,
            bytes: original.length,
            originalBytes: original.length,
            transcoded: false,
        };
    }

    const compressed = await compressVideo(original, {
        targetBytes,
        maxDurationS: maxDuration,
        maxHeight,
    });

    if (!compressed) {
        throw new Error(
            `Video ${(original.length / 1024 / 1024).toFixed(1)}MB gagal dikompres ` +
            `ke target ${(targetBytes / 1024 / 1024).toFixed(0)}MB`
        );
    }

    console.log(
        `[VisionVideo] Dikompres ${(original.length / 1024 / 1024).toFixed(1)}MB -> ` +
        `${(compressed.length / 1024 / 1024).toFixed(1)}MB`
    );

    return {
        dataUrl: `data:video/mp4;base64,${compressed.toString('base64')}`,
        mimeType: 'video/mp4',
        bytes: compressed.length,
        originalBytes: original.length,
        transcoded: true,
    };
}

/**
 * Transcode video ke H.264 dengan bitrate yang dihitung dari target ukuran.
 * Beberapa percobaan dengan bitrate menurun kalau hasil masih kebesaran.
 */
async function compressVideo(inputBuffer, options = {}) {
    const cfg = getVideoConfig();
    const targetBytes = options.targetBytes || cfg.targetBytes;
    const maxDurationS = options.maxDurationS || cfg.maxDurationS;
    const maxHeight = options.maxHeight || cfg.maxHeight;

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ditos-vcompress-'));
    const inputPath = path.join(tmpDir, 'in.mp4');

    try {
        await fsp.writeFile(inputPath, inputBuffer);

        const { duration, hasAudio } = await probeMedia(inputPath);
        const effectiveDuration = duration ? Math.min(duration, maxDurationS) : maxDurationS;

        // Bitrate video = (target - audio overhead) / durasi, dikurangi margin.
        const audioBitrate = 48 * 1024;
        const margin = 0.85;
        let videoBitrate = Math.floor(
            ((targetBytes * margin * 8) / effectiveDuration) - audioBitrate
        );
        // Batas bawah supaya kualitas tidak hancur.
        videoBitrate = Math.max(videoBitrate, 150 * 1024);

        const attempts = [
            { bitrate: videoBitrate, height: maxHeight },
            { bitrate: Math.floor(videoBitrate * 0.6), height: Math.min(maxHeight, 360) },
            { bitrate: Math.floor(videoBitrate * 0.35), height: Math.min(maxHeight, 240) },
        ];

        let best = null;
        for (const attempt of attempts) {
            const outPath = path.join(tmpDir, `out-${attempt.height}-${attempt.bitrate}.mp4`);
            const args = [
                '-i', inputPath,
                '-t', String(effectiveDuration),
                '-vf', `scale=w=-2:h=${attempt.height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-b:v', String(attempt.bitrate),
                '-maxrate', String(Math.floor(attempt.bitrate * 1.2)),
                '-bufsize', String(attempt.bitrate * 2),
                // '-an' dipakai kalau sumber tidak punya audio, supaya ffmpeg
                // tidak gagal karena stream audio kosong.
                ...(hasAudio
                    ? ['-c:a', 'aac', '-b:a', String(audioBitrate), '-ac', '1']
                    : ['-an']),
                '-movflags', '+faststart',
                '-y', outPath,
            ];

            try {
                await runFfmpeg(args, 180000);
                const buf = await fsp.readFile(outPath);
                if (!best || buf.length < best.length) best = buf;
                if (buf.length <= targetBytes) {
                    return buf;
                }
                console.log(
                    `[VisionVideo] Percobaan ${attempt.height}p@${Math.round(attempt.bitrate / 1024)}k ` +
                    `= ${(buf.length / 1024 / 1024).toFixed(1)}MB, masih di atas target.`
                );
            } catch (err) {
                console.warn(`[VisionVideo] Percobaan ${attempt.height}p gagal: ${err.message}`);
            }
        }

        return best && best.length <= targetBytes ? best : null;
    } finally {
        fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

function runFfmpeg(args, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const errChunks = [];
        let timer = null;

        child.stderr.on('data', (c) => errChunks.push(c));
        child.on('error', reject);
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString().slice(-250)}`));
        });

        timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`ffmpeg timeout ${timeoutMs}ms`));
        }, timeoutMs);
    });
}

/**
 * Baca durasi dan keberadaan stream audio dari file video.
 * @returns {Promise<{duration: number|null, hasAudio: boolean}>}
 */
function probeMedia(filePath) {
    return new Promise((resolve) => {
        const child = spawn(ffmpegPath, ['-i', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
        const chunks = [];
        child.stderr.on('data', (c) => chunks.push(c));
        child.on('close', () => {
            const text = Buffer.concat(chunks).toString();
            const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
            const duration = m
                ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
                : null;
            const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(text);
            resolve({ duration, hasAudio });
        });
        child.on('error', () => resolve({ duration: null, hasAudio: false }));
    });
}

function probeDuration(filePath) {
    return probeMedia(filePath).then((r) => r.duration);
}

/**
 * Minta model vision mendeskripsikan sebuah GAMBAR (data URL).
 *
 * Dipakai untuk dua hal: mendeskripsikan frame grid video ketika model utama
 * tidak bisa vision, dan sebagai jalur alternatif ketika provider video tidak
 * benar-benar menerima input video. Model vision yang hanya bisa gambar tetap
 * berguna lewat jalur ini.
 *
 * @returns {Promise<string|null>}
 */
async function analyzeImageWithVisionModel(imageDataUrl, prompt = null, options = {}) {
    if (!isVideoProviderAvailable()) return null;

    try {
        const model = options.model || getVideoConfig().model;
        const client = getVisionClient();
        const completion = await client.chat.completions.create({
            model,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt ||
                                'Gambar ini berisi beberapa frame yang diambil dari sebuah video, ' +
                                'tersusun sebagai grid. Jelaskan isi videonya secara detail tapi ringkas ' +
                                'dalam bahasa Indonesia: apa yang terjadi, objek/orang yang muncul, ' +
                                'suasana, dan teks yang terlihat di layar.',
                        },
                        { type: 'image_url', image_url: { url: imageDataUrl } },
                    ],
                },
            ],
            max_tokens: 2000,
        });

        const text = completion.choices?.[0]?.message?.content?.trim();
        if (!text) {
            console.warn('[VisionVideo] Deskripsi gambar kosong.');
            return null;
        }
        return text;
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'unknown error';
        console.warn(`[VisionVideo] Gagal deskripsikan gambar: ${reason}`);
        return null;
    }
}

/**
 * Minta model video mendeskripsikan isi video.
 * Mengembalikan string deskripsi, atau null kalau gagal (caller akan fallback
 * ke frame sampling supaya video tetap terbaca dalam bentuk gambar).
 */
async function analyzeVideoWithVisionModel(videoUrl, prompt = null, options = {}) {
    if (!isVideoProviderAvailable()) {
        console.warn('[VisionVideo] Provider video belum dikonfigurasi.');
        return null;
    }

    try {
        const model = options.model || getVideoConfig().model;

        // Kalau model ini sudah terbukti gagal menerima video, jangan ulangi.
        if (isModelMarkedVideoUnsupported(model)) {
            return null;
        }

        // Kapabilitas dicek dari katalog provider; kalau model tidak ada di
        // katalog, tetap dicoba (jangan blokir) tapi beri peringatan.
        const fromCatalog = await lookupModelCapabilities(model);
        if (fromCatalog && !fromCatalog.video && !options.force) {
            console.warn(
                `[VisionVideo] Katalog menyatakan "${model}" tidak menerima video. ` +
                'Tetap dicoba karena vision_video.model di-set eksplisit.'
            );
        }

        console.log(`[VisionVideo] Memproses video dengan ${model}...`);
        const video = await fetchVideoAsDataUrl(videoUrl);

        const defaultPrompt =
            'Deskripsikan isi video ini secara detail tapi ringkas, dalam bahasa Indonesia. ' +
            'Sebutkan apa yang terjadi, urutan kejadian penting, objek/orang yang muncul, ' +
            'dan teks yang terlihat di layar (jika ada). Fokus ke hal yang penting saja.';

        const client = getVisionClient();
        const completion = await client.chat.completions.create({
            model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt || defaultPrompt },
                        // ZenMux menerima video lewat tipe `file` pada Chat
                        // Completion. Field `file_data` boleh berisi data URL.
                        {
                            type: 'file',
                            file: {
                                filename: options.filename || 'video.mp4',
                                file_data: video.dataUrl,
                            },
                        },
                    ],
                },
            ],
            // Model reasoning seperti GLM bisa menghabiskan seluruh budget di
            // proses berpikir dan mengembalikan content kosong, jadi beri ruang.
            max_tokens: 2000,
        });

        const choice = completion.choices?.[0];
        const text = choice?.message?.content?.trim();
        const promptTokens = completion.usage?.prompt_tokens || 0;

        // Model yang tidak benar-benar menerima video akan mengabaikan
        // lampiran dan hanya memproses teks, sehingga prompt_tokens tetap
        // kecil (puluhan). Video yang benar-benar dicerna menaikkan token
        // jauh lebih banyak. Ini mencegah deskripsi halusinasi dipakai.
        if (!text) {
            console.warn(
                `[VisionVideo] Respons kosong (finish=${choice?.finish_reason}, ` +
                `prompt_tokens=${promptTokens}).`
            );
            markModelVideoUnsupported(model);
            return null;
        }

        if (promptTokens < getVideoConfig().minPromptTokens) {
            console.warn(
                `[VisionVideo] Video tidak ikut diproses: prompt_tokens hanya ${promptTokens} ` +
                `(minimum ${getVideoConfig().minPromptTokens}). Model "${model}" kemungkinan tidak ` +
                'benar-benar menerima input video meski katalog menyatakannya.'
            );
            markModelVideoUnsupported(model);
            return null;
        }

        console.log(
            `[VisionVideo] Selesai (${(video.bytes / 1024 / 1024).toFixed(1)}MB) -> ` +
            `${text.length} karakter`
        );
        return text;
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'unknown error';
        console.error(`[VisionVideo] Gagal: ${reason}`);

        // Kegagalan yang menunjukkan model tidak menerima format video
        // (bukan sekadar rate limit atau gangguan jaringan) membuat model
        // ditandai, supaya percobaan berikutnya langsung ke jalur gambar.
        const model = options.model || getVideoConfig().model;
        const isFormatRejection = /invalid input|参数有误|格式|unsupported|not support/i.test(reason);
        const isRateLimit = /usage limit|rate limit|quota|balance/i.test(reason);
        if (isFormatRejection && !isRateLimit) {
            markModelVideoUnsupported(model);
        }
        return null;
    }
}

module.exports = {
    getVideoConfig,
    isVideoProviderAvailable,
    getVisionClient,
    fetchVideoAsDataUrl,
    compressVideo,
    probeMedia,
    probeDuration,
    analyzeVideoWithVisionModel,
    analyzeImageWithVisionModel,
    markModelVideoUnsupported,
    isModelMarkedVideoUnsupported,
    videoUnsupportedModels,
};
