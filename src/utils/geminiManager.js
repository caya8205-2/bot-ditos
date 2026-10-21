
/**
 * Kompatibilitas: dulu modul ini terikat ke Gemini, sekarang memakai vision
 * manager generik (VISION_BASE_URL / VISION_API_KEY). Nama fungsi lama
 * dipertahankan supaya pemanggil yang sudah ada (d!ocr, d!eli5,
 * messageContext) tidak perlu diubah sekaligus.
 *
 * Untuk kode baru, pakai ./visionManager langsung.
 */

const visionManager = require('./visionManager');
const { isVisionSupported } = require('./visionHelper');

/**
 * Fetch image and process to optimized buffer + base64 + data URL
 */
async function fetchAndProcessImage(imageUrl, maxDimension) {
    return visionManager.fetchAndProcessImage(imageUrl, maxDimension);
}

/**
 * Dulu "analyzeImageWithGemini". Sekarang memakai provider vision generik,
 * jadi bisa diarahkan ke 9router, ZenMux, atau provider OpenAI-compatible lain.
 */
async function analyzeImageWithGemini(imageUrl, prompt) {
    return visionManager.describeImage(imageUrl, prompt);
}

module.exports = {
    fetchAndProcessImage,
    analyzeImageWithGemini,
    // Nama netral provider untuk kode baru.
    describeImage: visionManager.describeImage,
    extractTextFromImage: visionManager.extractTextFromImage,
    isVisionProviderAvailable: visionManager.isVisionProviderAvailable,
    resolveVisionModel: visionManager.resolveVisionModel,
    isVisionSupported,
};
