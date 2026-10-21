
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
const NINER_MODEL = readEnv('NINER_MODEL', '9ROUTER_MODEL') || 'auto';
// Model cadangan di router yang sama. Dicoba sebelum jatuh ke provider lain,
// supaya satu model yang sedang down tidak langsung membuang request ke Groq.
const NINER_FALLBACK_MODEL = readEnv('NINER_FALLBACK_MODEL', '9ROUTER_FALLBACK_MODEL') || '';

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
let ninerFallbackClient = null;

function isNinerAvailable() {
    return Boolean(NINER_BASE_URL);
}

/**
 * Provider fallback punya base URL sendiri dan berbeda dari provider utama.
 */
function isFallbackProviderDistinct() {
    return Boolean(NINER_FALLBACK_BASE_URL) && NINER_FALLBACK_BASE_URL !== NINER_BASE_URL;
}

function isFallbackProviderAvailable() {
    if (!NINER_FALLBACK_MODEL) return false;
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
    if (!isNinerAvailable()) {
        throw new Error('Niner fallback tidak tersedia karena base URL belum dikonfigurasi.');
    }

    if (!ninerClient) {
        ninerClient = buildClient(NINER_API_KEY, NINER_BASE_URL);
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
        throw new Error(`Niner fallback gagal di ${NINER_BASE_URL}: ${reason}`, {
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
    NINER_MODEL,
    NINER_FALLBACK_MODEL,
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
