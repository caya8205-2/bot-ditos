require('dotenv').config();
const OpenAI = require('openai');
const { OWNER_ID } = require('../config');

function normalizeBaseURL(url) {
    const trimmed = (url || 'http://127.0.0.1:5001/v1').replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

const LOCAL_LLM_BASE_URL = normalizeBaseURL(process.env.LOCAL_LLM_BASE_URL);
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'Qwen3.5-2B-Q8_0.gguf';
const LOCAL_LLM_TIMEOUT_MS = Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 120000;

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
    getLocalLLMClient,
    callLocalLLM,
    checkLocalLLMStatus,
};
