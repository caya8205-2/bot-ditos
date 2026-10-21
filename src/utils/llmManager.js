

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
    NINER_FALLBACK_MODEL,
    NINER_FALLBACK_BASE_URL,
    NINER_TIMEOUT_MS,
    isNinerAvailable,
    isFallbackProviderAvailable,
    callNiner,
    callNinerFallbackProvider,
} = require('./ninerManager');
const { isVisionSupported, isVideoSupported } = require('./visionHelper');

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

// Model yang sedang di-cooldown di dalam router, beserta waktu berakhirnya.
// Dipisah dari cooldown provider supaya satu model yang down tidak
// mematikan seluruh router untuk model lain.
const modelCooldownUntil = new Map();
const lastModelErrors = new Map();

function getRouterModelChain() {
    const chain = [NINER_MODEL];
    if (NINER_FALLBACK_MODEL && NINER_FALLBACK_MODEL !== NINER_MODEL) {
        chain.push(NINER_FALLBACK_MODEL);
    }
    return chain.filter(Boolean);
}

/**
 * Chain lengkap dengan provider masing-masing. Provider fallback memakai
 * base URL dan API key sendiri kalau dikonfigurasi berbeda dari utama.
 */
function getRouterProviderChain() {
    const chain = [{
        model: NINER_MODEL,
        provider: 'niner-primary',
        baseURL: NINER_BASE_URL,
        isFallbackProvider: false,
    }];

    if (NINER_FALLBACK_MODEL && NINER_FALLBACK_MODEL !== NINER_MODEL) {
        const useDedicatedProvider = isFallbackProviderAvailable();
        chain.push({
            model: NINER_FALLBACK_MODEL,
            provider: useDedicatedProvider ? 'niner-fallback' : 'niner-primary',
            baseURL: useDedicatedProvider ? NINER_FALLBACK_BASE_URL : NINER_BASE_URL,
            isFallbackProvider: useDedicatedProvider,
        });
    }

    return chain.filter((entry) => entry.model);
}

function isModelOnCooldown(model) {
    const until = modelCooldownUntil.get(model);
    if (!until) return false;
    if (Date.now() >= until) {
        modelCooldownUntil.delete(model);
        return false;
    }
    return true;
}

function markModelUnavailable(model, error) {
    lastModelErrors.set(model, error);
    modelCooldownUntil.set(model, Date.now() + NINER_FALLBACK_COOLDOWN_MS);
    console.warn(
        `[LLM] Model ${model} unavailable: ${error?.message || error}. ` +
        `Cooldown ${Math.ceil(NINER_FALLBACK_COOLDOWN_MS / 1000)}s.`
    );
}

function isRouterChainExhausted() {
    return getRouterModelChain().every((model) => isModelOnCooldown(model));
}

/**
 * Coba model utama router, lalu model fallback router, baru menyerah.
 * Melempar error terakhir kalau semua model di router gagal.
 */
async function callRouterChain(requestFn, options = {}) {
    const chain = getRouterProviderChain();
    const errors = [];
    let connectivityFailure = false;

    for (const entry of chain) {
        const { model, provider, baseURL, isFallbackProvider } = entry;

        if (isModelOnCooldown(model)) {
            const remaining = Math.ceil((modelCooldownUntil.get(model) - Date.now()) / 1000);
            console.log(`[LLM] Skip ${model}: masih cooldown (${remaining}s)`);
            continue;
        }

        try {
            // Provider fallback punya base URL & API key sendiri, jadi caller-nya
            // juga berbeda. Test bisa inject lewat ninerFallbackCaller.
            const caller = isFallbackProvider
                ? (options.ninerFallbackCaller || callNinerFallbackProvider)
                : (options.ninerCaller || callNiner);

            const result = await caller((client) => requestFn(
                createModelBoundClient(client, model),
                { provider, model, baseURL }
            ));

            const content = extractChoiceContent(result);
            if (!content) {
                throw new Error(`${model} returned empty response`);
            }

            lastNinerError = null;
            lastModelErrors.delete(model);
            if (isFallbackProvider) {
                console.log(`[LLM] Request dilayani provider fallback ${baseURL} dengan model ${model}`);
            } else if (model !== NINER_MODEL) {
                console.log(`[LLM] Request dilayani model fallback router: ${model}`);
            }
            return result;
        } catch (error) {
            errors.push(error);
            const fatal = isConnectivityError(error);
            if (fatal) {
                connectivityFailure = true;
                markModelUnavailable(model, error);
            } else {
                console.warn(
                    `[LLM] Model ${model} error non-fatal (${error.message}), coba model berikutnya.`
                );
            }
        }
    }

    const aggregate = new AggregateError(
        errors.length ? errors : [new Error('Semua model router sedang cooldown')],
        `Semua model provider gagal: ${chain.map((e) => e.model).join(' -> ')}`
    );
    aggregate.routerExhausted = true;
    aggregate.connectivityFailure = connectivityFailure;
    throw aggregate;
}

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
        `[LLM] Router unavailable: ${error?.message || error}. ` +
        `Semua model router di-cooldown ${Math.ceil(NINER_FALLBACK_COOLDOWN_MS / 1000)}s, pakai Groq.`
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
    if (!isNinerAvailable()) {
        return callGroqFallback(requestFn, options);
    }

    // Kalau semua model di router sedang cooldown, langsung ke Groq.
    if (Date.now() < ninerUnavailableUntil || isRouterChainExhausted()) {
        return callGroqFallback(requestFn, options);
    }

    try {
        // Coba model utama router dulu, lalu NINER_FALLBACK_MODEL, baru Groq.
        return await callRouterChain(requestFn, options);
    } catch (routerError) {
        if (routerError.connectivityFailure) {
            markNinerUnavailable(routerError);
        } else {
            console.warn(
                `[LLM] Router gagal non-fatal (${routerError.message}), fallback ke Groq tanpa cooldown provider.`
            );
        }

        try {
            return await callGroqFallback(requestFn, options);
        } catch (groqError) {
            throw new AggregateError(
                [routerError, groqError],
                `Fallback router dan Groq sama-sama gagal. Router: ${routerError.message}. Groq: ${groqError.message}`
            );
        }
    }
}

async function callLLMWithFallback(requestFn, options = {}) {
    return callNinerFallback(requestFn, options);
}

/**
 * Cek model aktif yang akan digunakan di chat request berikutnya.
 * Memperhitungkan cooldown per-model di dalam router: kalau model utama
 * sedang cooldown tapi fallback router masih sehat, yang dilaporkan adalah
 * model fallback router (bukan langsung Groq).
 */
function getActiveChatModelInfo() {
    if (isNinerAvailable() && Date.now() >= ninerUnavailableUntil) {
        const chain = getRouterProviderChain();
        const active = chain.find((entry) => !isModelOnCooldown(entry.model));
        if (active) {
            return {
                provider: active.provider,
                baseURL: active.baseURL,
                model: active.model,
                supportsVision: isVisionSupported(active.model),
                isRouterFallback: active.model !== NINER_MODEL,
                isFallbackProvider: active.isFallbackProvider,
            };
        }
    }

    return {
        provider: 'groq',
        baseURL: null,
        model: GROQ_FALLBACK_MODEL,
        supportsVision: isVisionSupported(GROQ_FALLBACK_MODEL),
        isRouterFallback: false,
        isFallbackProvider: false,
    };
}

function getLLMProviderStatus() {
    const chain = getRouterProviderChain();
    const now = Date.now();
    const activeInfo = getActiveChatModelInfo();

    return {
        primary: {
            provider: 'niner-primary',
            baseURL: NINER_BASE_URL,
            model: NINER_MODEL,
            timeoutMs: NINER_TIMEOUT_MS,
            available: isNinerAvailable(),
            onCooldown: isModelOnCooldown(NINER_MODEL),
            unavailableUntil: modelCooldownUntil.get(NINER_MODEL) || 0,
            lastError: lastModelErrors.get(NINER_MODEL)?.message || null,
            supportsVision: isVisionSupported(NINER_MODEL),
        },
        secondary: {
            provider: isFallbackProviderAvailable() ? 'niner-fallback' : 'niner-primary',
            baseURL: isFallbackProviderAvailable() ? NINER_FALLBACK_BASE_URL : NINER_BASE_URL,
            model: NINER_FALLBACK_MODEL || null,
            timeoutMs: NINER_TIMEOUT_MS,
            configured: Boolean(NINER_FALLBACK_MODEL),
            dedicatedProvider: isFallbackProviderAvailable(),
            available: Boolean(NINER_FALLBACK_MODEL) && isNinerAvailable(),
            onCooldown: NINER_FALLBACK_MODEL ? isModelOnCooldown(NINER_FALLBACK_MODEL) : false,
            unavailableUntil: NINER_FALLBACK_MODEL ? (modelCooldownUntil.get(NINER_FALLBACK_MODEL) || 0) : 0,
            lastError: NINER_FALLBACK_MODEL
                ? (lastModelErrors.get(NINER_FALLBACK_MODEL)?.message || null)
                : null,
            supportsVision: isVisionSupported(NINER_FALLBACK_MODEL),
        },
        router: {
            baseURL: NINER_BASE_URL,
            fallbackBaseURL: NINER_FALLBACK_BASE_URL || null,
            chain: chain.map((entry) => entry.model),
            providerChain: chain,
            providerOnCooldown: now < ninerUnavailableUntil,
            providerUnavailableUntil: ninerUnavailableUntil,
            lastError: lastNinerError?.message || null,
            activeModel: activeInfo.model,
            activeProvider: activeInfo.provider,
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
    NINER_FALLBACK_MODEL,
    NINER_FALLBACK_COOLDOWN_MS,
    GROQ_FALLBACK_MODEL,
    LOCAL_LLM_FALLBACK_COOLDOWN_MS,
    callLLMWithFallback,
    createModelBoundClient,
    getRouterModelChain,
    getRouterProviderChain,
    getLLMProviderStatus,
    getActiveChatModelInfo,
    isVisionSupported,
    isVideoSupported,
};
