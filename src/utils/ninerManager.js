
const OpenAI = require('openai');

function readEnv(primaryKey, fallbackKey) {
    return process.env[primaryKey] || process.env[fallbackKey];
}

function normalizeBaseURL(url) {
    return (url || '').replace(/\/+$/, '');
}

const NINER_BASE_URL = normalizeBaseURL(
    readEnv('NINER_BASE_URL', '9ROUTER_BASE_URL')
);
const NINER_API_KEY = readEnv('NINER_API_KEY', '9ROUTER_API_KEY');

/**
 * Model aktif dibaca dari config.yaml lewat botConfig, dengan env sebagai
 * cadangan. Sengaja berupa fungsi, bukan konstanta, supaya model bisa diganti
 * saat bot berjalan tanpa restart.
 */
function getNinerModel() {
    try {
        const botConfig = require('./botConfig');
        const fromConfig = botConfig.getActiveModel();
        if (fromConfig) return fromConfig;
    } catch {
        // botConfig belum tersedia (misal saat test terisolasi).
    }
    return readEnv('NINER_MODEL', '9ROUTER_MODEL') || 'auto';
}

/**
 * Base URL dan API key provider aktif. Kalau config.yaml punya daftar provider,
 * nilai dari sana yang dipakai; kalau tidak, jatuh ke env lama.
 */
function getNinerProvider() {
    try {
        const botConfig = require('./botConfig');
        const provider = botConfig.getActiveProvider();
        if (provider?.base_url) {
            return {
                baseURL: normalizeBaseURL(provider.base_url),
                apiKey: provider.apiKey || NINER_API_KEY,
                name: provider.name,
            };
        }
    } catch {
        // abaikan, pakai env
    }
    return { baseURL: NINER_BASE_URL, apiKey: NINER_API_KEY, name: 'env-default' };
}

/**
 * Model cadangan di router. Diambil dari config.yaml (fallback_model.model),
 * dengan env NINER_FALLBACK_MODEL sebagai cadangan supaya konfigurasi lama
 * tetap jalan.
 */
function getNinerFallbackModel() {
    try {
        const botConfig = require('./botConfig');
        const cfg = botConfig.getConfig();
        const fromConfig = cfg.fallback_model?.model;
        if (fromConfig) return fromConfig;
    } catch {
        // abaikan
    }
    return readEnv('NINER_FALLBACK_MODEL', '9ROUTER_FALLBACK_MODEL') || '';
}

// Provider fallback terpisah (base URL + API key sendiri). Dipakai kalau model
// cadangan di atas di-set untuk endpoint yang berbeda dari provider utama.
// Contoh: NINER_BASE_URL_2 / NINER_API_KEY_2.
const NINER_FALLBACK_BASE_URL = normalizeBaseURL(
    readEnv('NINER_FALLBACK_BASE_URL', '9ROUTER_FALLBACK_BASE_URL') ||
    readEnv('NINER_BASE_URL_2', '9ROUTER_BASE_URL_2')
);
const NINER_FALLBACK_API_KEY =
    readEnv('NINER_FALLBACK_API_KEY', '9ROUTER_FALLBACK_API_KEY') ||
    readEnv('NINER_API_KEY_2', '9ROUTER_API_KEY_2') ||
    NINER_API_KEY;

const NINER_TIMEOUT_MS = Number(
    readEnv('NINER_TIMEOUT_MS', '9ROUTER_TIMEOUT_MS')
) || 120000;

let ninerClient = null;
let ninerClientBaseURL = null;
let ninerFallbackClient = null;

function isNinerAvailable() {
    return Boolean(getNinerProvider().baseURL);
}

/**
 * Provider fallback punya base URL sendiri dan berbeda dari provider utama.
 */
function isFallbackProviderDistinct() {
    return Boolean(NINER_FALLBACK_BASE_URL) &&
        NINER_FALLBACK_BASE_URL !== getNinerProvider().baseURL;
}

function isFallbackProviderAvailable() {
    if (!getNinerFallbackModel()) return false;
    if (!NINER_FALLBACK_BASE_URL) return false;
    return isFallbackProviderDistinct();
}

function buildClient(apiKey, baseURL) {
    return new OpenAI({
        apiKey: apiKey || 'niner',
        baseURL,
        timeout: NINER_TIMEOUT_MS,
        maxRetries: 0,
    });
}

function getNinerClient() {
    const provider = getNinerProvider();
    if (!provider.baseURL) {
        throw new Error('Niner fallback tidak tersedia karena base URL belum dikonfigurasi.');
    }

    // Client di-cache per base URL, supaya ganti provider saat runtime
    // langsung memakai client baru tanpa restart.
    if (!ninerClient || ninerClientBaseURL !== provider.baseURL) {
        ninerClient = buildClient(provider.apiKey, provider.baseURL);
        ninerClientBaseURL = provider.baseURL;
    }

    return ninerClient;
}

function getNinerFallbackClient() {
    if (!isFallbackProviderAvailable()) {
        throw new Error(
            'Provider fallback belum dikonfigurasi (butuh NINER_FALLBACK_MODEL, ' +
            'NINER_FALLBACK_BASE_URL atau NINER_BASE_URL_2, dan berbeda dari provider utama).'
        );
    }

    if (!ninerFallbackClient) {
        ninerFallbackClient = buildClient(NINER_FALLBACK_API_KEY, NINER_FALLBACK_BASE_URL);
    }

    return ninerFallbackClient;
}

async function callNiner(requestFn) {
    try {
        return await requestFn(getNinerClient());
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'Unknown error';
        throw new Error(`Niner fallback gagal di ${getNinerProvider().baseURL}: ${reason}`, {
            cause: error,
        });
    }
}

async function callNinerFallbackProvider(requestFn) {
    try {
        return await requestFn(getNinerFallbackClient());
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'Unknown error';
        throw new Error(`Provider fallback gagal di ${NINER_FALLBACK_BASE_URL}: ${reason}`, {
            cause: error,
        });
    }
}

module.exports = {
    NINER_BASE_URL,
    NINER_API_KEY,
    getNinerModel,
    getNinerProvider,
    getNinerFallbackModel,
    NINER_FALLBACK_BASE_URL,
    NINER_FALLBACK_API_KEY,
    NINER_TIMEOUT_MS,
    isNinerAvailable,
    isFallbackProviderDistinct,
    isFallbackProviderAvailable,
    getNinerClient,
    getNinerFallbackClient,
    callNiner,
    callNinerFallbackProvider,
};
