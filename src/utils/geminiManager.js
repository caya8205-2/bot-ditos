require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const sharp = require('sharp');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function analyzeImageWithGemini(imageUrl, prompt) { // Liat gambar pake Gemini
    try {
        console.log('[Gemini] Downloading image:', imageUrl);

        const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 10000
        });

        console.log('[Gemini] Image downloaded, resizing...');

        const resizedBuffer = await sharp(imageResponse.data)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .toBuffer();

        const base64Image = resizedBuffer.toString('base64');

        console.log('[Gemini] Resized to:', resizedBuffer.length, 'bytes');

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash' // RESTORED USER VERSION
        });

        console.log('[Gemini] Sending to Gemini API...');

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gemini timeout after 45s')), 45000)
        );

        const result = await Promise.race([
            model.generateContent([
                {
                    inlineData: {
                        mimeType: 'image/png',
                        data: base64Image,
                    },
                },
                prompt || 'Deskripsikan gambar ini dengan detail tapi jangan kepanjangan dalam bahasa Indonesia. Fokus ke hal-hal penting yang ada di gambar.',
            ]),
            timeoutPromise
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

module.exports = { analyzeImageWithGemini };
