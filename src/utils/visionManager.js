require('dotenv').config();
const axios = require('axios');
const sharp = require('sharp');
const {
    LOCAL_LLM_MODEL,
    LOCAL_LLM_TIMEOUT_MS,
    getLocalLLMClient,
} = require('./localLLMManager');
const { analyzeImageWithGemini } = require('./geminiManager');
const { createModelBoundClient } = require('./llmManager');

const LOCAL_VISION_FALLBACK_COOLDOWN_MS = Math.max(
    10000,
    Number(process.env.LOCAL_LLM_FALLBACK_COOLDOWN_MS) || 5 * 60 * 1000
);

let localVisionUnavailableUntil = 0;
let lastLocalVisionError = null;

function markLocalVisionUnavailable(error) {
    lastLocalVisionError = error;
    localVisionUnavailableUntil = Date.now() + LOCAL_VISION_FALLBACK_COOLDOWN_MS;
    console.warn(
        `[Vision] Local unavailable: ${error?.message || error}. ` +
        `Using Gemini fallback for ${Math.ceil(LOCAL_VISION_FALLBACK_COOLDOWN_MS / 1000)}s.`
    );
}

async function analyzeImageWithLocalModel(imageUrl, prompt) {
    console.log('[Vision] Downloading image:', imageUrl);

    const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
    });

    console.log('[Vision] Image downloaded, resizing...');

    const resizedBuffer = await sharp(imageResponse.data)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    const base64Image = resizedBuffer.toString('base64');
    const mimeType = 'image/png';

    console.log('[Vision] Resized to:', resizedBuffer.length, 'bytes');

    const defaultPrompt = prompt ||
        'Deskripsikan gambar ini dengan detail tapi jangan kepanjangan dalam bahasa Indonesia. Fokus ke hal-hal penting yang ada di gambar.';

    const messages = [
        {
            role: 'user',
            content: [
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64Image}`
                    }
                },
                {
                    type: 'text',
                    text: defaultPrompt
                }
            ]
        }
    ];

    const client = getLocalLLMClient();
    const boundClient = createModelBoundClient(client, LOCAL_LLM_MODEL);

    console.log('[Vision] Sending to local model...');

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Local vision timeout')), LOCAL_LLM_TIMEOUT_MS)
    );

    const result = await Promise.race([
        boundClient.chat.completions.create({
            messages,
            temperature: 0.7,
            max_tokens: 1000,
        }),
        timeoutPromise
    ]);

    const text = result.choices?.[0]?.message?.content?.trim();

    if (!text) {
        throw new Error('Local model returned empty response');
    }

    console.log('[Vision] Local response received:', text.substring(0, 100) + '...');

    return text;
}

async function analyzeImage(imageUrl, prompt) {
    if (Date.now() < localVisionUnavailableUntil) {
        console.log('[Vision] Local on cooldown, using Gemini directly');
        return analyzeImageWithGemini(imageUrl, prompt);
    }

    try {
        const result = await analyzeImageWithLocalModel(imageUrl, prompt);
        lastLocalVisionError = null;
        return result;
    } catch (localError) {
        markLocalVisionUnavailable(localError);

        console.log('[Vision] Falling back to Gemini...');
        return analyzeImageWithGemini(imageUrl, prompt);
    }
}

module.exports = { analyzeImage };
