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
    NINE_ROUTER_BASE_URL,
    NINE_ROUTER_MODEL,
    NINE_ROUTER_TIMEOUT_MS,
    is9RouterAvailable,
    call9Router,
} = require('./9routerManager');

const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile';
const LOCAL_LLM_FALLBACK_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.LOCAL_LLM_FALLBACK_COOLDOWN_MS) || 5 * 60 * 1000
);
const NINE_ROUTER_FALLBACK_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.NINE_ROUTER_FALLBACK_COOLDOWN_MS || process.env['9ROUTER_FALLBACK_COOLDOWN_MS']) || 60 * 1000
);

let localUnavailableUntil = 0;
let lastLocalError = null;
let nineRouterUnavailableUntil = 0;
let last9RouterError = null;

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

function mark9RouterUnavailable(error) {
    last9RouterError = error;
    nineRouterUnavailableUntil = Date.now() + NINE_ROUTER_FALLBACK_COOLDOWN_MS;
    console.warn(
        `[LLM] 9router unavailable: ${error?.message || error}. ` +
        `Using Groq for ${Math.ceil(NINE_ROUTER_FALLBACK_COOLDOWN_MS / 1000)}s.`
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

async function call9RouterFallback(requestFn, options = {}) {
    if (Date.now() < nineRouterUnavailableUntil || !is9RouterAvailable()) {
        return callGroqFallback(requestFn, options);
    }

    try {
        const nineRouterCaller = options.nineRouterCaller || call9Router;
        const result = await nineRouterCaller((client) => requestFn(
            createModelBoundClient(client, NINE_ROUTER_MODEL),
            { provider: '9router', model: NINE_ROUTER_MODEL }
        ));
        last9RouterError = null;
        return result;
    } catch (nineRouterError) {
        mark9RouterUnavailable(nineRouterError);

        try {
            return await callGroqFallback(requestFn, options);
        } catch (groqError) {
            throw new AggregateError(
                [nineRouterError, groqError],
                `Fallback 9router dan Groq sama-sama gagal. 9router: ${nineRouterError.message}. Groq: ${groqError.message}`
            );
        }
    }
}

async function callLLMWithFallback(requestFn, options = {}) {
    if (Date.now() < localUnavailableUntil) {
        return call9RouterFallback(requestFn, options);
    }

    try {
        const result = await requestFn(
            createModelBoundClient(options.localClient || getLocalLLMClient(), LOCAL_LLM_MODEL),
            { provider: 'local', model: LOCAL_LLM_MODEL }
        );
        lastLocalError = null;
        return result;
    } catch (localError) {
        markLocalUnavailable(localError);

        try {
            return await call9RouterFallback(requestFn, options);
        } catch (fallbackError) {
            throw new AggregateError(
                [localError, fallbackError],
                `Model lokal, 9router, dan Groq sama-sama gagal. Local: ${localError.message}. Fallback: ${fallbackError.message}`
            );
        }
    }
}

function getLLMProviderStatus() {
    return {
        primary: { provider: 'local', model: LOCAL_LLM_MODEL },
        secondary: {
            provider: '9router',
            baseURL: NINE_ROUTER_BASE_URL,
            model: NINE_ROUTER_MODEL,
            timeoutMs: NINE_ROUTER_TIMEOUT_MS,
            available: is9RouterAvailable(),
            unavailableUntil: nineRouterUnavailableUntil,
            onCooldown: Date.now() < nineRouterUnavailableUntil,
            lastError: last9RouterError?.message || null,
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
    NINE_ROUTER_MODEL,
    NINE_ROUTER_FALLBACK_COOLDOWN_MS,
    GROQ_FALLBACK_MODEL,
    LOCAL_LLM_FALLBACK_COOLDOWN_MS,
    callLLMWithFallback,
    createModelBoundClient,
    getLLMProviderStatus,
};
