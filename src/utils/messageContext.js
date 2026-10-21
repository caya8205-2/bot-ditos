'use strict';

/**
 * Modul konteks multimodal untuk auto-chat.
 *
 * Tujuan:
 * - Memberi auto-chat kemampuan melihat gambar dari pesan saat ini, pesan yang
 *   direply, dan gambar yang tersimpan di riwayat channel.
 * - Memakai jalur vision yang sama seperti `d!chat`: kalau model aktif multimodal,
 *   gambar dikirim langsung sebagai image part. Kalau tidak, baru fallback ke
 *   adapter Gemini (deskripsi/OCR).
 * - Menyelesaikan pesan yang direply (message.reference) supaya bot tahu konteks
 *   pesan lama yang sedang dibalas.
 */

const { getActiveChatModelInfo } = require('./llmManager');
const { fetchAndProcessImage, analyzeImageWithGemini } = require('./geminiManager');
const { isVideoSupported } = require('./visionHelper');

// Batas gambar yang dikirim ke model per satu trigger auto-chat.
const MAX_IMAGES_PER_PROMPT = 3;

// Cache supaya riwayat yang dibaca berulang tidak memicu fetch/OCR berulang.
const DESCRIPTION_CACHE_LIMIT = 60;
const PROCESSED_IMAGE_CACHE_LIMIT = 12;

const descriptionCache = new Map();
const processedImageCache = new Map();
const videoCache = new Map();

// Batas video per prompt dan cache video.
const MAX_VIDEOS_PER_PROMPT = 1;
const VIDEO_CACHE_LIMIT = 6;

function cacheSet(map, key, value, limit) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
    }
}

function isImageAttachment(attachment) {
    const contentType = attachment?.contentType || '';
    if (contentType.startsWith('image/')) return true;
    // Discord tidak selalu mengisi contentType (misal gambar dari clipboard).
    return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(attachment?.name || '');
}

/**
 * Apakah attachment berupa video.
 * Catatan: Discord mengirim video sebagai content type video/*, dan terkadang
 * tidak mengisi contentType sehingga ekstensi jadi fallback.
 */
function isVideoAttachment(attachment) {
    const contentType = attachment?.contentType || '';
    if (contentType.startsWith('video/')) return true;
    return /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(attachment?.name || '');
}

function getVideoAttachments(message) {
    if (!message?.attachments?.size) return [];
    return [...message.attachments.values()].filter(isVideoAttachment);
}

function getImageAttachments(message) {
    if (!message?.attachments?.size) return [];
    return [...message.attachments.values()].filter(isImageAttachment);
}

/**
 * Proses satu attachment gambar.
 * Model multimodal -> image part langsung (tanpa OCR).
 * Model non-vision -> deskripsi Gemini sebagai teks.
 */
async function processImageAttachment(attachment) {
    const key = attachment?.url;
    if (!key) return null;

    if (processedImageCache.has(key)) return processedImageCache.get(key);
    if (descriptionCache.has(key)) {
        return { dataUrl: null, description: descriptionCache.get(key) };
    }

    const activeModel = getActiveChatModelInfo();

    if (activeModel.supportsVision) {
        try {
            const processed = await fetchAndProcessImage(key);
            const result = { dataUrl: processed.dataUrl, description: null };
            cacheSet(processedImageCache, key, result, PROCESSED_IMAGE_CACHE_LIMIT);
            return result;
        } catch (err) {
            console.warn(
                `[VisionContext] Direct vision gagal (${err.message}), fallback ke Gemini adapter.`
            );
        }
    }

    const description = await analyzeImageWithGemini(key);
    const result = { dataUrl: null, description: description || null };
    if (description) {
        cacheSet(descriptionCache, key, description, DESCRIPTION_CACHE_LIMIT);
    }
    return result;
}

/**
 * Bangun daftar gambar terpilih (maks MAX_IMAGES_PER_PROMPT, dedupe by URL).
 * @param {Array<{attachment: object, label: string}>} candidates
 */
async function buildImageContext(candidates = []) {
    const seenUrls = new Set();
    const picked = [];

    for (const candidate of candidates) {
        const url = candidate?.attachment?.url;
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        picked.push(candidate);
        if (picked.length >= MAX_IMAGES_PER_PROMPT) break;
    }

    const entries = [];
    for (const { attachment, label } of picked) {
        try {
            const processed = await processImageAttachment(attachment);
            if (!processed) continue;
            if (processed.dataUrl) {
                entries.push({ label, dataUrl: processed.dataUrl, description: null });
            } else if (processed.description) {
                entries.push({ label, dataUrl: null, description: processed.description });
            }
        } catch (err) {
            console.warn('[VisionContext] Gagal memproses gambar:', err.message);
        }
    }

    return entries;
}

/**
 * Render entri gambar jadi content parts untuk OpenAI-compatible messages.
 * Model multimodal -> text + image_url. Model non-vision -> deskripsi inline.
 */
function renderImageParts(entries = []) {
    const parts = [];
    for (const entry of entries) {
        if (entry.dataUrl) {
            parts.push({ type: 'text', text: `${entry.label}:` });
            parts.push({ type: 'image_url', image_url: { url: entry.dataUrl } });
        } else if (entry.description) {
            parts.push({
                type: 'text',
                text: `${entry.label}: [isi gambar: ${entry.description}]`,
            });
        }
    }
    return parts;
}

/**
 * Ambil pesan yang sedang direply. Pakai cache Discord kalau ada,
 * kalau tidak fetch ulang. Gagal -> null (jangan sampai mematikan auto-chat).
 */
async function resolveReferencedMessage(message) {
    const reference = message?.reference;
    if (!reference?.messageId) return null;

    if (reference.message) {
        try {
            return await reference.message;
        } catch {
            // lanjut ke fetchReference
        }
    }

    try {
        return await message.fetchReference();
    } catch (err) {
        console.warn('[VisionContext] Gagal ambil pesan yang direply:', err.message);
        return null;
    }
}

/**
 * Proses satu attachment video, capability-gated:
 * 1. Kalau model yang dipakai video-capable -> kirim video langsung (tanpa OCR).
 * 2. Kalau tidak -> minta vision manager (provider video terpisah) deskripsikan.
 * 3. Kalau provider video tidak siap/gagal -> ekstrak frame jadi grid gambar,
 *    supaya model vision biasa tetap dapat gambaran isinya.
 *
 * @param {object} attachment
 * @param {string} modelName model yang akan melayani request
 */
async function processVideoAttachment(attachment, modelName) {
    const url = attachment?.url;
    if (!url) return null;

    if (videoCache.has(url)) return videoCache.get(url);

    // Jalur 1: model utama sudah bisa video, kirim langsung.
    if (isVideoSupported(modelName)) {
        try {
            const videoVision = require('./videoVisionManager');
            const video = await videoVision.fetchVideoAsDataUrl(url);
            const result = {
                mode: 'direct',
                dataUrl: video.dataUrl,
                mimeType: video.mimeType,
                description: null,
            };
            cacheSet(videoCache, url, result, VIDEO_CACHE_LIMIT);
            console.log(`[VisionContext] Video dikirim langsung ke model utama (${modelName})`);
            return result;
        } catch (err) {
            console.warn(`[VisionContext] Direct video gagal (${err.message}), coba vision manager.`);
        }
    }

    // Jalur 2: vision manager dengan model video terpisah.
    try {
        const videoVision = require('./videoVisionManager');
        if (videoVision.isVideoProviderAvailable()) {
            const description = await videoVision.analyzeVideoWithVisionModel(url);
            if (description) {
                const result = { mode: 'description', dataUrl: null, description };
                cacheSet(videoCache, url, result, VIDEO_CACHE_LIMIT);
                return result;
            }
        }
    } catch (err) {
        console.warn(`[VisionContext] Vision manager video gagal: ${err.message}`);
    }

    // Jalur 3: fallback frame sampling.
    try {
        const { extractFrameGrid } = require('./videoFrameSampler');
        const grid = await extractFrameGrid(url);
        if (grid) {
            const result = {
                mode: 'frames',
                dataUrl: grid.dataUrl,
                description: null,
                frameCount: grid.frames,
            };
            cacheSet(videoCache, url, result, VIDEO_CACHE_LIMIT);
            console.log(`[VisionContext] Video diubah jadi grid ${grid.frames} frame`);
            return result;
        }
    } catch (err) {
        console.warn(`[VisionContext] Frame sampling gagal: ${err.message}`);
    }

    return null;
}

/**
 * Bangun konteks video dari daftar kandidat, maksimal satu video per prompt.
 * @param {Array<{attachment: object, label: string}>} candidates
 * @param {string} modelName
 */
async function buildVideoContext(candidates = [], modelName) {
    const seen = new Set();
    const entries = [];

    for (const candidate of candidates) {
        const url = candidate?.attachment?.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const processed = await processVideoAttachment(candidate.attachment, modelName);
        if (!processed) continue;

        entries.push({ label: candidate.label, ...processed });
        if (entries.length >= MAX_VIDEOS_PER_PROMPT) break;
    }

    return entries;
}

/**
 * Render entri video jadi content parts.
 * - direct: video_url part (model video-capable)
 * - frames: image_url part berisi grid frame
 * - description: teks hasil vision manager
 */
function renderVideoParts(entries = []) {
    const parts = [];
    for (const entry of entries) {
        if (entry.mode === 'direct' && entry.dataUrl) {
            parts.push({ type: 'text', text: `${entry.label}:` });
            parts.push({ type: 'video_url', video_url: { url: entry.dataUrl } });
        } else if (entry.mode === 'frames' && entry.dataUrl) {
            parts.push({
                type: 'text',
                text: `${entry.label} (rangkaian ${entry.frameCount || 'beberapa'} frame dari video):`,
            });
            parts.push({ type: 'image_url', image_url: { url: entry.dataUrl } });
        } else if (entry.description) {
            parts.push({
                type: 'text',
                text: `${entry.label}: [isi video: ${entry.description}]`,
            });
        }
    }
    return parts;
}

/**
 * Metadata tambahan yang disimpan ke channelHistory.
 * Menyimpan URL gambar & video supaya nanti bisa "dilihat" lagi dari riwayat.
 */
function buildHistoryMeta(message, referencedMessage = null) {
    const meta = {};

    const images = getImageAttachments(message);
    if (images.length) {
        meta.imageUrls = images.map((a) => a.url).filter(Boolean);
    }

    const videos = getVideoAttachments(message);
    if (videos.length) {
        meta.videoUrls = videos.map((a) => a.url).filter(Boolean);
    }

    const reference = message?.reference;
    if (reference?.messageId) {
        const target = referencedMessage || reference.message || null;
        meta.replyTo = {
            messageId: reference.messageId,
            username: target?.author?.username || null,
            content: (target?.content || '').trim().slice(0, 240) || null,
        };
    }

    return meta;
}

/**
 * Sinyal suasana obrolan. Dipakai untuk menurunkan peluang nimbrung
 * saat channel sedang membahas hal serius.
 */
const SERIOUS_SIGNALS = [
    'meninggal', 'wafat', 'takziah', 'duka', 'musibah', 'kecelakaan',
    'sakit', 'opname', 'rumah sakit', 'rawat inap', 'diagnosa',
    'depresi', 'stress', 'stres', 'panik', 'cemas', 'anxiety',
    'sedih', 'nangis', 'curhat', 'putus', 'cerai', 'patah hati',
    'bangkrut', 'kehilangan', 'phk', 'dipecat', 'utang', 'hutang',
    'darurat', 'urgent', 'jangan becanda', 'bukan bercanda', 'serius nih',
    'kenapa begini', 'gagal terus', 'nyerah',
];

const HUMOR_SIGNALS = [
    'wkwk', 'wkwkwk', 'haha', 'hehe', 'lol', 'anjir', 'anjay', 'bjir',
    'kocak', 'receh', 'garing', 'meme', '🗿', '💀', '😂', '🤣', '😭',
];

/**
 * @param {string[]} texts pesan-pesan terakhir (termasuk pesan saat ini)
 * @returns {{tone: 'serious'|'humor'|'neutral', seriousHits: number, humorHits: number}}
 */
function detectConversationTone(texts = []) {
    const blob = texts
        .filter((t) => typeof t === 'string' && t.trim())
        .join(' ')
        .toLowerCase();

    if (!blob) return { tone: 'neutral', seriousHits: 0, humorHits: 0 };

    let seriousHits = 0;
    for (const signal of SERIOUS_SIGNALS) {
        if (blob.includes(signal)) seriousHits++;
    }

    let humorHits = 0;
    for (const signal of HUMOR_SIGNALS) {
        if (blob.includes(signal)) humorHits++;
    }

    let tone = 'neutral';
    if (seriousHits > 0 && seriousHits >= humorHits) tone = 'serious';
    else if (humorHits > 0) tone = 'humor';

    return { tone, seriousHits, humorHits };
}

module.exports = {
    MAX_IMAGES_PER_PROMPT,
    MAX_VIDEOS_PER_PROMPT,
    isImageAttachment,
    isVideoAttachment,
    getImageAttachments,
    getVideoAttachments,
    processImageAttachment,
    processVideoAttachment,
    buildImageContext,
    buildVideoContext,
    renderImageParts,
    renderVideoParts,
    resolveReferencedMessage,
    buildHistoryMeta,
    detectConversationTone,
};
