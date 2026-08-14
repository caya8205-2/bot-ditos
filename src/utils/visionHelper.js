/**
 * Helper deteksi apakah suatu nama model mendukung Vision / Multimodal input
 */
function isVisionSupported(modelName) {
    if (!modelName || typeof modelName !== 'string') return false;
    const lower = modelName.toLowerCase();

    // Model teks murni spesifik yang sering mengecoh
    if (lower.includes('llama-3.3') || lower.includes('llama-3.1') || lower.includes('llama-3-') || lower.includes('llama3-') || lower.includes('llama-3.2-1b') || lower.includes('llama-3.2-3b')) {
        if (!lower.includes('vision')) return false;
    }
    if (lower.includes('deepseek') && !lower.includes('vl')) return false;
    if (lower.includes('gpt-3.5') || lower.includes('gpt-oss') || lower.includes('qwen2.5-coder')) return false;

    // Pattern nama model multimodal/vision
    const visionKeywords = [
        'vision',
        '-vl',
        'vl-',
        '/vl',
        '_vl',
        'gemini',
        'gpt-4o',
        'gpt-4.5',
        'gpt-5',
        'claude-3',
        'claude-sonnet',
        'claude-opus',
        'claude-haiku',
        'pixtral',
        'llava',
        'gemma-3',
        'minicpm-v',
        'internvl',
        'glm-4v',
        'omni',
    ];

    return visionKeywords.some(keyword => lower.includes(keyword));
}

module.exports = {
    isVisionSupported,
};
