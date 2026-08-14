require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const sharp = require('sharp');
const { isVisionSupported } = require('./visionHelper');

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

/**
 * Fetch image and process to optimized buffer + base64 + data URL
 */
async function fetchAndProcessImage(imageUrl, maxDimension = 1024) {
    try {
        let buffer;
        if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            buffer = Buffer.from(base64Data, 'base64');
        } else {
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
            });
            buffer = Buffer.from(imageResponse.data);
        }

        const resizedBuffer = await sharp(buffer)
            .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();

        const base64 = resizedBuffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64}`;

        return {
            buffer: resizedBuffer,
            base64,
            mimeType: 'image/jpeg',
            dataUrl,
        };
    } catch (err) {
        console.error('[Vision] fetchAndProcessImage error:', err.message);
        throw err;
    }
}

/**
 * Deskripsikan gambar / OCR menggunakan Gemini Generative AI SDK sebagai fallback vision adapter
 */
async function analyzeImageWithGemini(imageUrl, prompt) {
    if (!genAI) {
        console.warn('[Gemini] GEMINI_API_KEY not configured in .env');
        return null;
    }

    try {
        console.log('[Gemini] Processing image with Gemini Vision...');
        const imageInfo = await fetchAndProcessImage(imageUrl, 1024);

        const model = genAI.getGenerativeModel({
            model: GEMINI_VISION_MODEL,
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gemini timeout after 45s')), 45000)
        );

        const defaultPrompt = 'Deskripsikan gambar ini dengan detail tapi jangan kepanjangan dalam bahasa Indonesia. Fokus ke hal-hal penting yang ada di gambar.';
        const result = await Promise.race([
            model.generateContent([
                {
                    inlineData: {
                        mimeType: imageInfo.mimeType,
                        data: imageInfo.base64,
                    },
                },
                prompt || defaultPrompt,
            ]),
            timeoutPromise,
        ]);

        const response = await result.response;
        const text = response.text();
        console.log('[Gemini] Response received:', text.substring(0, 100) + '...');
        return text;
    } catch (error) {
        console.error('[Gemini] Error:', error.message);
        return null;
    }
}

module.exports = {
    fetchAndProcessImage,
    analyzeImageWithGemini,
    isVisionSupported,
};
