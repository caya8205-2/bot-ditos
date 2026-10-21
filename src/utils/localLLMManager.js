
const OpenAI = require('openai');
const { OWNER_ID } = require('../config');
const botConfig = require('./botConfig');

function normalizeBaseURL(url) {
    const trimmed = (url || 'http://127.0.0.1:5001/v1').replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Konfigurasi LLM lokal dari config.yaml bagian `local_llm:`.
 * API key tetap di .env (LOCAL_LLM_API_KEY); KoboldCpp biasanya tidak butuh.
 */
function getLocalLLMConfig() {
    const section = botConfig.getSection('local_llm', {
        base_url: 'http://127.0.0.1:5001/v1',
        model: 'Qwen3.5-2B-Q8_0.gguf',
        timeout_ms: 120000,
    });

    return {
        baseURL: normalizeBaseURL(section.base_url || process.env.LOCAL_LLM_BASE_URL),
        model: section.model || process.env.LOCAL_LLM_MODEL || 'Qwen3.5-2B-Q8_0.gguf',
        timeoutMs: botConfig.asNumber(section.timeout_ms, 120000),
    };
}

const LOCAL_LLM_CONFIG = getLocalLLMConfig();
const LOCAL_LLM_BASE_URL = LOCAL_LLM_CONFIG.baseURL;
const LOCAL_LLM_MODEL = LOCAL_LLM_CONFIG.model;
const LOCAL_LLM_TIMEOUT_MS = LOCAL_LLM_CONFIG.timeoutMs;

const localLLMClient = new OpenAI({
    apiKey: process.env.LOCAL_LLM_API_KEY || 'koboldcpp',
    baseURL: LOCAL_LLM_BASE_URL,
    timeout: LOCAL_LLM_TIMEOUT_MS,
    maxRetries: 0,
});

function getLocalLLMClient() {
    return localLLMClient;
}

async function callLocalLLM(requestFn) {
    try {
        return await requestFn(localLLMClient);
    } catch (error) {
        const reason = error?.error?.message || error?.message || 'Unknown error';
        throw new Error(`Lagi error nih di ${LOCAL_LLM_BASE_URL}: ${reason}\nTunggu <@${OWNER_ID}> benerin ya`, {
            cause: error,
        });
    }
}

async function checkLocalLLMStatus() {
    const startedAt = Date.now();
    const completion = await callLocalLLM((client) => client.chat.completions.create({
        model: LOCAL_LLM_MODEL,
        messages: [{ role: 'user', content: 'Balas hanya dengan OK.' }],
        temperature: 0,
        max_tokens: 8,
    }));

    return {
        baseURL: LOCAL_LLM_BASE_URL,
        model: LOCAL_LLM_MODEL,
        latencyMs: Date.now() - startedAt,
        response: completion.choices?.[0]?.message?.content?.trim() || '(respons kosong)',
    };
}

module.exports = {
    LOCAL_LLM_BASE_URL,
    LOCAL_LLM_MODEL,
    LOCAL_LLM_TIMEOUT_MS,
    getLocalLLMConfig,
    getLocalLLMClient,
    callLocalLLM,
    checkLocalLLMStatus,
};
