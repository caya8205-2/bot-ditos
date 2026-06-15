require('dotenv').config();

const {
    LOCAL_LLM_MODEL,
    getLocalLLMClient,
} = require('./localLLMManager');
const {
    GROQ_KEYS,
    callGroqWithFallback,
} = require('./groqManager');

const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile';
const LOCAL_LLM_FALLBACK_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.LOCAL_LLM_FALLBACK_COOLDOWN_MS) || 5 * 60 * 1000
);

let localUnavailableUntil = 0;
let lastLocalError = null;

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
        `Using Groq for ${Math.ceil(LOCAL_LLM_FALLBACK_COOLDOWN_MS / 1000)}s.`
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

async function callLLMWithFallback(requestFn, options = {}) {
    if (Date.now() < localUnavailableUntil) {
        return callGroqFallback(requestFn, options);
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
            return await callGroqFallback(requestFn, options);
        } catch (groqError) {
            throw new AggregateError(
                [localError, groqError],
                `Model lokal dan fallback Groq sama-sama gagal. Local: ${localError.message}. Groq: ${groqError.message}`
            );
        }
    }
}

function getLLMProviderStatus() {
    return {
        primary: { provider: 'local', model: LOCAL_LLM_MODEL },
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
    GROQ_FALLBACK_MODEL,
    LOCAL_LLM_FALLBACK_COOLDOWN_MS,
    callLLMWithFallback,
    createModelBoundClient,
    getLLMProviderStatus,
};
