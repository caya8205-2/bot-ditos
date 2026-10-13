

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
const { isVisionSupported } = require('./visionHelper');

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

function isConnectivityError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    const code = error.code || error.cause?.code;
    const status = error.status || error.statusCode || error.cause?.status;

    if (code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
        return true;
    }
    if (status && (status >= 500 || status === 404)) {
        return true;
    }
    if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('network') || msg.includes('fetch failed')) {
        return true;
    }
    return false;
}

function extractChoiceContent(result) {
    const message = result?.choices?.[0]?.message;
    if (!message) return '';
    const content = message.content?.trim();
    if (content) return content;
    const reasoning = message.reasoning_content?.trim() || message.reasoning?.trim();
    if (reasoning) {
        message.content = reasoning;
        return reasoning;
    }
    return '';
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
    const result = await groqCaller((groq) => requestFn(
        createModelBoundClient(groq, GROQ_FALLBACK_MODEL),
        { provider: 'groq', model: GROQ_FALLBACK_MODEL }
    ));

    const content = extractChoiceContent(result);
    if (!content) {
        throw new Error('Groq returned empty response');
    }

    return result;
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

        const content = extractChoiceContent(result);
        if (!content) {
            throw new Error('Niner returned empty response');
        }

        lastNinerError = null;
        return result;
    } catch (ninerError) {
        if (isConnectivityError(ninerError)) {
            markNinerUnavailable(ninerError);
        } else {
            console.warn(`[LLM] Niner non-fatal error (${ninerError.message}), fallback to Groq without cooldown.`);
        }

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

/**
 * Cek model aktif yang akan digunakan di chat request berikutnya
 */
function getActiveChatModelInfo() {
    if (Date.now() < ninerUnavailableUntil || !isNinerAvailable()) {
        return {
            provider: 'groq',
            model: GROQ_FALLBACK_MODEL,
            supportsVision: isVisionSupported(GROQ_FALLBACK_MODEL),
        };
    }

    return {
        provider: 'niner',
        model: NINER_MODEL,
        supportsVision: isVisionSupported(NINER_MODEL),
    };
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
            supportsVision: isVisionSupported(NINER_MODEL),
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
            supportsVision: isVisionSupported(NINER_MODEL),
        },
        fallback: {
            provider: 'groq',
            model: GROQ_FALLBACK_MODEL,
            available: isGroqFallbackAvailable(),
            supportsVision: isVisionSupported(GROQ_FALLBACK_MODEL),
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
    getActiveChatModelInfo,
    isVisionSupported,
};
