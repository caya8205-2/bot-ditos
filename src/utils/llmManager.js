require('dotenv').config();

const {
    LOCAL_LLM_MODEL,
    getLocalLLMClient,
} = require('./localLLMManager');
const {
    GROQ_KEYS,
    callGroqWithFallback,
} = require('./groqManager');
const {
    NINER_BASE_URL,
    NINER_MODEL,
    NINER_TIMEOUT_MS,
    isNinerAvailable,
    callNiner,
} = require('./ninerManager');

const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile';
const LOCAL_LLM_FALLBACK_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.LOCAL_LLM_FALLBACK_COOLDOWN_MS) || 5 * 60 * 1000
);
const NINER_FALLBACK_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.NINER_FALLBACK_COOLDOWN_MS || process.env['9ROUTER_FALLBACK_COOLDOWN_MS']) || 60 * 1000
);

let localUnavailableUntil = 0;
let lastLocalError = null;
let ninerUnavailableUntil = 0;
let lastNinerError = null;

function createModelBoundClient(client, model, transformOptions = (options) => options) {
    return {
        chat: {
            completions: {
                create: (options = {}) => client.chat.completions.create(
                    transformOptions({ ...options, model })
                ),
            },
        },
    };
}

function isGroqFallbackAvailable() {
    return GROQ_KEYS.length > 0;
}

function markLocalUnavailable(error) {
    lastLocalError = error;
    localUnavailableUntil = Date.now() + LOCAL_LLM_FALLBACK_COOLDOWN_MS;
    console.warn(
        `[LLM] Local unavailable: ${error?.message || error}. ` +
        `Using fallback for ${Math.ceil(LOCAL_LLM_FALLBACK_COOLDOWN_MS / 1000)}s.`
    );
}

function markNinerUnavailable(error) {
    lastNinerError = error;
    ninerUnavailableUntil = Date.now() + NINER_FALLBACK_COOLDOWN_MS;
    console.warn(
        `[LLM] Niner unavailable: ${error?.message || error}. ` +
        `Using Groq for ${Math.ceil(NINER_FALLBACK_COOLDOWN_MS / 1000)}s.`
    );
}

async function callGroqFallback(requestFn, options = {}) {
    if (!isGroqFallbackAvailable() && !options.allowWithoutConfiguredKey) {
        throw new Error('Groq fallback tidak tersedia karena API key belum dikonfigurasi.');
    }

    const groqCaller = options.groqCaller || callGroqWithFallback;
    return groqCaller((groq) => requestFn(
        createModelBoundClient(groq, GROQ_FALLBACK_MODEL),
        { provider: 'groq', model: GROQ_FALLBACK_MODEL }
    ));
}

async function callNinerFallback(requestFn, options = {}) {
    if (Date.now() < ninerUnavailableUntil || !isNinerAvailable()) {
        return callGroqFallback(requestFn, options);
    }

    try {
        const ninerCaller = options.ninerCaller || callNiner;
        const result = await ninerCaller((client) => requestFn(
            createModelBoundClient(client, NINER_MODEL),
            { provider: 'niner', model: NINER_MODEL }
        ));
        lastNinerError = null;
        return result;
    } catch (ninerError) {
        markNinerUnavailable(ninerError);

        try {
            return await callGroqFallback(requestFn, options);
        } catch (groqError) {
            throw new AggregateError(
                [ninerError, groqError],
                `Fallback Niner dan Groq sama-sama gagal. Niner: ${ninerError.message}. Groq: ${groqError.message}`
            );
        }
    }
}

async function callLLMWithFallback(requestFn, options = {}) {
    return callNinerFallback(requestFn, options);
}

function getLLMProviderStatus() {
    return {
        primary: {
            provider: 'niner',
            baseURL: NINER_BASE_URL,
            model: NINER_MODEL,
            timeoutMs: NINER_TIMEOUT_MS,
            available: isNinerAvailable(),
            unavailableUntil: ninerUnavailableUntil,
            onCooldown: Date.now() < ninerUnavailableUntil,
            lastError: lastNinerError?.message || null,
        },
        secondary: {
            provider: 'niner',
            baseURL: NINER_BASE_URL,
            model: NINER_MODEL,
            timeoutMs: NINER_TIMEOUT_MS,
            available: isNinerAvailable(),
            unavailableUntil: ninerUnavailableUntil,
            onCooldown: Date.now() < ninerUnavailableUntil,
            lastError: lastNinerError?.message || null,
        },
        fallback: {
            provider: 'groq',
            model: GROQ_FALLBACK_MODEL,
            available: isGroqFallbackAvailable(),
        },
        localUnavailableUntil,
        localOnCooldown: Date.now() < localUnavailableUntil,
        lastLocalError: lastLocalError?.message || null,
    };
}

module.exports = {
    LLM_MODEL: LOCAL_LLM_MODEL,
    NINER_MODEL,
    NINER_FALLBACK_COOLDOWN_MS,
    GROQ_FALLBACK_MODEL,
    LOCAL_LLM_FALLBACK_COOLDOWN_MS,
    callLLMWithFallback,
    createModelBoundClient,
    getLLMProviderStatus,
};
