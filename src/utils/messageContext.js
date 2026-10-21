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

// Batas gambar yang dikirim ke model per satu trigger auto-chat.
const MAX_IMAGES_PER_PROMPT = 3;

// Cache supaya riwayat yang dibaca berulang tidak memicu fetch/OCR berulang.
const DESCRIPTION_CACHE_LIMIT = 60;
const PROCESSED_IMAGE_CACHE_LIMIT = 12;

const descriptionCache = new Map();
const processedImageCache = new Map();

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
 * Metadata tambahan yang disimpan ke channelHistory.
 * Menyimpan URL gambar supaya nanti bisa "dilihat" lagi dari riwayat.
 */
function buildHistoryMeta(message, referencedMessage = null) {
    const meta = {};

    const images = getImageAttachments(message);
    if (images.length) {
        meta.imageUrls = images.map((a) => a.url).filter(Boolean);
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
    isImageAttachment,
    getImageAttachments,
    processImageAttachment,
    buildImageContext,
    renderImageParts,
    resolveReferencedMessage,
    buildHistoryMeta,
    detectConversationTone,
};
