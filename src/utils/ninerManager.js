require('dotenv').config();
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
const NINER_TIMEOUT_MS = Number(
    readEnv('NINER_TIMEOUT_MS', '9ROUTER_TIMEOUT_MS')
) || 120000;

let ninerClient = null;

function isNinerAvailable() {
    return Boolean(NINER_BASE_URL);
}

function getNinerClient() {
    if (!isNinerAvailable()) {
        throw new Error('Niner fallback tidak tersedia karena base URL belum dikonfigurasi.');
    }

    if (!ninerClient) {
        ninerClient = new OpenAI({
            apiKey: NINER_API_KEY || 'niner',
            baseURL: NINER_BASE_URL,
            timeout: NINER_TIMEOUT_MS,
            maxRetries: 0,
        });
    }

    return ninerClient;
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

module.exports = {
    NINER_BASE_URL,
    NINER_API_KEY,
    NINER_MODEL,
    NINER_TIMEOUT_MS,
    isNinerAvailable,
    getNinerClient,
    callNiner,
};
