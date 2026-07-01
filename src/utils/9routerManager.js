require('dotenv').config();
const OpenAI = require('openai');

function readEnv(primaryKey, fallbackKey) {
    return process.env[primaryKey] || process.env[fallbackKey];
}

function normalizeBaseURL(url) {
    return (url || '').replace(/\/+$/, '');
}

const NINE_ROUTER_BASE_URL = normalizeBaseURL(
    readEnv('9ROUTER_BASE_URL', 'NINE_ROUTER_BASE_URL')
);
const NINE_ROUTER_API_KEY = readEnv('9ROUTER_API_KEY', 'NINE_ROUTER_API_KEY');
const NINE_ROUTER_MODEL = readEnv('9ROUTER_MODEL', 'NINE_ROUTER_MODEL') || 'auto';
const NINE_ROUTER_TIMEOUT_MS = Number(
    readEnv('9ROUTER_TIMEOUT_MS', 'NINE_ROUTER_TIMEOUT_MS')
) || 120000;

let nineRouterClient = null;

function is9RouterAvailable() {
    return Boolean(NINE_ROUTER_BASE_URL);
}

function get9RouterClient() {
    if (!is9RouterAvailable()) {
        throw new Error('9router fallback tidak tersedia karena base URL belum dikonfigurasi.');
    }

    if (!nineRouterClient) {
        nineRouterClient = new OpenAI({
            apiKey: NINE_ROUTER_API_KEY || '9router',
            baseURL: NINE_ROUTER_BASE_URL,
            timeout: NINE_ROUTER_TIMEOUT_MS,
            maxRetries: 0,
        });
    }

    return nineRouterClient;
}

async function call9Router(requestFn) {
    try {
        return await requestFn(get9RouterClient());
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'Unknown error';
        throw new Error(`9router fallback gagal di ${NINE_ROUTER_BASE_URL}: ${reason}`, {
            cause: error,
        });
    }
}

module.exports = {
    NINE_ROUTER_BASE_URL,
    NINE_ROUTER_API_KEY,
    NINE_ROUTER_MODEL,
    NINE_ROUTER_TIMEOUT_MS,
    is9RouterAvailable,
    get9RouterClient,
    call9Router,
};
