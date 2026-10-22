'use strict';

/**
 * Deteksi kapabilitas model dari katalog provider (endpoint /models).
 *
 * Provider OpenAI-compatible seperti ZenMux mengekspos `input_modalities`
 * per model, jadi kapabilitas vision/video dibaca dari data asli alih-alih
 * menebak dari nama. Hasil di-cache karena katalog jarang berubah.
 *
 * Kalau katalog tidak tersedia (provider tidak mendukung /models atau
 * offline), dipakai fallback pola nama agar bot tetap jalan.
 */

const axios = require('axios');

const CATALOG_TTL_MS = (() => {
    try {
        const botConfig = require('./botConfig');
        const section = botConfig.getSection('model_catalog', { ttl_ms: 1800000 });
        return botConfig.asNumber(section.ttl_ms, 1800000);
    } catch {
        return Number(process.env.MODEL_CATALOG_TTL_MS) || 30 * 60 * 1000;
    }
})();

// Cache per base URL: { at, byId: Map<id, {vision, video}> }
const catalogCache = new Map();

// Fallback pola nama, hanya dipakai kalau katalog tidak bisa diambil.
const FALLBACK_VISION_PATTERNS = [
    'vision', '-vl', 'vl-', '/vl', '_vl', 'gemini', 'gpt-4o', 'gpt-4.5', 'gpt-5',
    'claude-3', 'claude-sonnet', 'claude-opus', 'claude-haiku', 'pixtral', 'llava',
    'gemma-3', 'minicpm-v', 'internvl', 'glm-4', 'glm-5', 'omni',
];

const FALLBACK_VIDEO_PATTERNS = [
    'gemini-2.5', 'gemini-3', 'gemini-4', 'glm-5', 'glm-4.5v', 'glm-4.6v',
    'glm-4v-plus', 'qwen2.5-vl', 'qwen3-vl', 'internvl', 'minicpm-v',
    'llava-video', 'video-llava', 'omni',
];

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

/**
 * Provider yang katalognya bisa dipakai untuk cek kapabilitas.
 * Mengembalikan daftar {baseURL, apiKey, label}.
 *
 * Provider vision diambil dari config.yaml bagian `vision:`; provider utama
 * dari `model.provider`. Variabel env lama tetap dibaca sebagai cadangan.
 */
function getCatalogProviders() {
    const providers = [];
    let botConfig = null;
    try {
        botConfig = require('./botConfig');
    } catch {
        // saat test terisolasi
    }

    const seen = new Set();

    // Vision provider (untuk model video/gambar khusus).
    if (botConfig) {
        const { provider } = botConfig.getProviderForSection('vision');
        if (provider?.base_url) {
            const baseURL = normalizeBaseURL(provider.base_url);
            seen.add(baseURL);
            providers.push({ baseURL, apiKey: provider.apiKey, label: 'vision-provider' });
        }
    }

    const visionBase = normalizeBaseURL(readEnv(
        'VISION_BASE_URL', 'VISION_PROVIDER_BASE_URL', 'ZENMUX_BASE_URL'
    ));
    if (visionBase && !seen.has(visionBase)) {
        seen.add(visionBase);
        providers.push({
            baseURL: visionBase,
            apiKey: readEnv('VISION_API_KEY', 'VISION_PROVIDER_API_KEY', 'ZENMUX_API_KEY'),
            label: 'vision-provider',
        });
    }

    // Provider utama (chat).
    if (botConfig) {
        const active = botConfig.getActiveProvider();
        if (active?.base_url) {
            const baseURL = normalizeBaseURL(active.base_url);
            if (!seen.has(baseURL)) {
                seen.add(baseURL);
                providers.push({ baseURL, apiKey: active.apiKey, label: 'main-router' });
            }
        }
    }

    const mainBase = normalizeBaseURL(readEnv('NINER_BASE_URL', '9ROUTER_BASE_URL'));
    if (mainBase && !seen.has(mainBase)) {
        providers.push({
            baseURL: mainBase,
            apiKey: readEnv('NINER_API_KEY', '9ROUTER_API_KEY'),
            label: 'main-router',
        });
    }

    return providers;
}

function getNoPassthroughBaseURLs() {
    const blocked = new Set();
    let botConfig = null;
    try {
        botConfig = require('./botConfig');
    } catch {
        return blocked;
    }

    const section = botConfig.getSection('vision_video', {});
    const names = Array.isArray(section.no_passthrough_providers)
        ? section.no_passthrough_providers
        : [];

    for (const name of names) {
        const provider = botConfig.getProviderByName(String(name).trim());
        if (provider?.base_url) {
            blocked.add(normalizeBaseURL(provider.base_url));
        }
    }

    return blocked;
}

/**
 * Ambil dan cache katalog model dari sebuah provider.
 * @returns {Promise<Map<string, {vision: boolean, video: boolean}>|null>}
 */
async function loadCatalog(provider) {
    const cached = catalogCache.get(provider.baseURL);
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
        return cached.byId;
    }

    try {
        const res = await axios.get(`${provider.baseURL}/models`, {
            timeout: 15000,
            headers: provider.apiKey
                ? { Authorization: `Bearer ${provider.apiKey}` }
                : {},
        });

        const list = res.data?.data || res.data;
        if (!Array.isArray(list)) return null;

        const byId = new Map();
        for (const item of list) {
            const id = item?.id;
            if (!id) continue;

            // Dua format katalog yang beredar:
            // 1. ZenMux  -> input_modalities: ["text","image","video","file"]
            // 2. 9router -> capabilities: { vision: true, videoInput: true }
            // Keduanya harus dibaca, kalau tidak router akan dianggap tidak
            // punya model vision/video sama sekali.
            const inputs = item.input_modalities || item.architecture?.input_modalities || [];
            const caps = item.capabilities || {};

            const vision = inputs.includes('image') || caps.vision === true;
            const video = inputs.includes('video') || caps.videoInput === true;

            byId.set(id, {
                vision,
                video,
                providerBaseURL: provider.baseURL,
                displayName: item.display_name || item.name || null,
                // Metadata thinking (9router). ZenMux tidak menyediakannya,
                // jadi nilainya undefined dan dianggap tidak diketahui.
                thinking: {
                    reasoning: caps.reasoning === true,
                    format: caps.thinkingFormat || null,
                    canDisable: caps.thinkingCanDisable === true,
                    effortSupported: caps.thinkingEffortSupported === true,
                    known: caps.reasoning !== undefined,
                },
            });
        }

        catalogCache.set(provider.baseURL, { at: Date.now(), byId });
        console.log(
            `[ModelCatalog] ${provider.label}: ${byId.size} model dimuat ` +
            `(${[...byId.values()].filter((m) => m.video).length} video-capable)`
        );
        return byId;
    } catch (error) {
        console.warn(`[ModelCatalog] ${provider.label} gagal: ${error.message}`);
        // Pakai cache lama kalau ada, supaya tidak langsung jatuh ke fallback.
        return cached?.byId || null;
    }
}

/**
 * Cari kapabilitas sebuah model dari katalog semua provider yang dikenal.
 * @returns {Promise<{vision: boolean, video: boolean, source: string}|null>}
 */
async function lookupModelCapabilities(modelName) {
    if (!modelName || typeof modelName !== 'string') return null;

    for (const provider of getCatalogProviders()) {
        const catalog = await loadCatalog(provider);
        if (!catalog) continue;

        const entry = catalog.get(modelName);
        if (entry) {
            return {
                vision: entry.vision,
                video: entry.video,
                providerBaseURL: entry.providerBaseURL || provider.baseURL,
                source: 'catalog',
            };
        }
    }

    return null;
}

/**
 * Prefetch katalog di background supaya panggilan pertama tidak menunggu.
 */
function warmCatalog() {
    for (const provider of getCatalogProviders()) {
        loadCatalog(provider).catch(() => {});
    }
}

function isVisionSupportedFallback(modelName) {
    if (!modelName || typeof modelName !== 'string') return false;
    const lower = modelName.toLowerCase();
    if (lower.includes('deepseek') && !lower.includes('vl')) return false;
    if (lower.includes('gpt-3.5') || lower.includes('gpt-oss') || lower.includes('qwen2.5-coder')) return false;
    return FALLBACK_VISION_PATTERNS.some((p) => lower.includes(p));
}

function isVideoSupportedFallback(modelName) {
    if (!modelName || typeof modelName !== 'string') return false;
    const lower = modelName.toLowerCase();
    if (!isVisionSupportedFallback(modelName)) return false;
    return FALLBACK_VIDEO_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Model dianggap tidak bisa video kalau providernya membuang lampiran video.
 *
 * 9router melaporkan `videoInput: true` untuk banyak model, termasuk model yang
 * aslinya bisa video (Gemini). Begitu dipanggil lewat 9router, lampirannya tidak
 * pernah sampai dan model menjawab bahwa tidak ada file. Karena itu klaim
 * katalog tidak bisa dipercaya untuk provider seperti ini, dan video harus
 * selalu lewat vision manager.
 */
function isVideoPassthroughBlocked(entry) {
    if (!entry?.providerBaseURL) return false;
    return getNoPassthroughBaseURLs().has(normalizeBaseURL(entry.providerBaseURL));
}

/**
 * Apakah provider chat aktif membuang lampiran video.
 *
 * Dipakai saat katalog belum ter-cache: pola nama tidak boleh membuat model
 * dianggap video-capable hanya karena namanya mengandung "glm-5" atau "gemini",
 * padahal providernya tetap tidak meneruskan video.
 */
function isActiveChatProviderBlocked() {
    const blocked = getNoPassthroughBaseURLs();
    if (!blocked.size) return false;
    try {
        const botConfig = require('./botConfig');
        const active = botConfig.getActiveProvider();
        if (!active?.base_url) return false;
        return blocked.has(normalizeBaseURL(active.base_url));
    } catch {
        return false;
    }
}

/**
 * Metadata thinking sebuah model dari cache katalog.
 *
 * Mengembalikan null kalau provider tidak menyediakan metadata thinking
 * (mis. ZenMux), supaya pemanggil bisa membedakan "tidak mendukung" dari
 * "tidak diketahui".
 */
function lookupThinkingInfoSync(modelName) {
    const hit = findCached(modelName);
    if (!hit?.thinking?.known) return null;
    return hit.thinking;
}

async function lookupThinkingInfo(modelName) {
    if (!modelName || typeof modelName !== 'string') return null;
    for (const provider of getCatalogProviders()) {
        const catalog = await loadCatalog(provider);
        if (!catalog) continue;
        const entry = catalog.get(modelName);
        if (entry?.thinking?.known) return entry.thinking;
    }
    return null;
}

/**
 * Versi sinkron: pakai cache katalog kalau sudah ada, selain itu pola nama.
 * Dipakai di jalur yang tidak bisa await (mis. getActiveChatModelInfo).
 */
function isVisionSupportedSync(modelName) {
    const hit = findCached(modelName);
    if (hit) return hit.vision;
    return isVisionSupportedFallback(modelName);
}

function isVideoSupportedSync(modelName) {
    const hit = findCached(modelName);
    if (!hit) {
        // Katalog belum ter-cache: jangan percaya pola nama kalau provider chat
        // aktif memang membuang lampiran video.
        if (isActiveChatProviderBlocked()) return false;
        return isVideoSupportedFallback(modelName);
    }
    if (!hit.video) return false;
    return !isVideoPassthroughBlocked(hit);
}

function findCached(modelName) {
    if (!modelName) return null;
    for (const provider of getCatalogProviders()) {
        const cached = catalogCache.get(provider.baseURL);
        if (!cached) continue;
        const entry = cached.byId.get(modelName);
        if (entry) return entry;
    }
    return null;
}

/**
 * Versi async: tanya katalog dulu (bisa fetch kalau cache kosong).
 */
async function isVisionSupportedAsync(modelName) {
    const hit = await lookupModelCapabilities(modelName);
    if (hit) return hit.vision;
    return isVisionSupportedFallback(modelName);
}

async function isVideoSupportedAsync(modelName) {
    const hit = await lookupModelCapabilities(modelName);
    if (!hit) {
        if (isActiveChatProviderBlocked()) return false;
        return isVideoSupportedFallback(modelName);
    }
    if (!hit.video) return false;
    return !isVideoPassthroughBlocked(hit);
}

module.exports = {
    CATALOG_TTL_MS,
    getCatalogProviders,
    loadCatalog,
    lookupModelCapabilities,
    isVideoPassthroughBlocked,
    getNoPassthroughBaseURLs,
    lookupThinkingInfoSync,
    lookupThinkingInfo,
    warmCatalog,
    isVisionSupportedSync,
    isVideoSupportedSync,
    isVisionSupportedAsync,
    isVideoSupportedAsync,
    isVisionSupportedFallback,
    isVideoSupportedFallback,
};
