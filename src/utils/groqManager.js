require('dotenv').config();
const Groq = require('groq-sdk');

const GROQ_KEYS = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_BACKUP,
    process.env.GROQ_API_KEY_BACKUP_1,
    process.env.GROQ_API_KEY_BACKUP_2,
].filter(Boolean);

let currentGroqKeyIndex = 0;
const keyStats = GROQ_KEYS.map((key, i) => ({
    index: i,
    key: key.substring(0, 10) + '...', // untuk log
    cooldownUntil: null,
    failures: 0,
}));

function getGroqClient() { // Get Groq client with current key
    if (GROQ_KEYS.length === 0) {
        throw new Error('No Groq API keys available in .env');
    }

    // Cari key yang available
    const now = Date.now();

    for (let i = 0; i < GROQ_KEYS.length; i++) {
        const idx = (currentGroqKeyIndex + i) % GROQ_KEYS.length;
        const stat = keyStats[idx];

        if (!stat.cooldownUntil || now >= stat.cooldownUntil) {
            currentGroqKeyIndex = idx;
            if (i > 0) {
                console.log(`[Groq] Using key ${idx} (skipped ${i} cooldown keys)`);
            }
            return new Groq({ apiKey: GROQ_KEYS[idx] });
        }
    }

    // Semua cooldown → pake yang paling cepet reset
    const nextKey = keyStats
        .filter(s => s.cooldownUntil)
        .sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];

    currentGroqKeyIndex = nextKey?.index || 0;

    console.log(
        `[Groq] All keys in cooldown, using key ${currentGroqKeyIndex} ` +
        `(resets in ${Math.ceil((nextKey.cooldownUntil - now) / 1000)}s)`
    );

    return new Groq({ apiKey: GROQ_KEYS[currentGroqKeyIndex] });
}

function rotateGroqKey() { // Rotate to next key
    const oldIndex = currentGroqKeyIndex;
    currentGroqKeyIndex = (currentGroqKeyIndex + 1) % GROQ_KEYS.length;

    console.log(
        `[Groq] Key rotated: ${oldIndex} -> ${currentGroqKeyIndex} ` +
        `(${GROQ_KEYS.length} keys available)`
    );

    return getGroqClient();
}

async function callGroqWithFallback(requestFn) { // Call Groq with fallback
    let lastError = null;

    for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
        try {
            const groq = getGroqClient();
            const result = await requestFn(groq);
            return result;
        } catch (error) {
            lastError = error;

            const isRateLimit =
                error.message?.includes('rate_limit') ||
                error.status === 429 ||
                error.statusCode === 429;

            if (isRateLimit) {
                // ✅ NEW: Mark key cooldown
                const stat = keyStats[currentGroqKeyIndex];
                stat.failures++;

                const retryAfter = error.headers?.['retry-after'] ||
                    error.error?.headers?.['retry-after'];
                const cooldownSeconds = retryAfter ? parseInt(retryAfter) : 60;

                stat.cooldownUntil = Date.now() + (cooldownSeconds * 1000);

                console.log(
                    `[Groq] Key ${currentGroqKeyIndex} rate limited. ` +
                    `Cooldown: ${cooldownSeconds}s`
                );

                if (attempt < GROQ_KEYS.length - 1) {
                    rotateGroqKey();
                    continue;
                }
            }

            throw error;
        }
    }

    throw new Error(
        `All ${GROQ_KEYS.length} Groq API keys exhausted. ` +
        `Last error: ${lastError?.message}`
    );
}


function getKeyStatus() {
    return {
        keyStats,
        GROQ_KEYS,
        currentGroqKeyIndex
    };
}

module.exports = {
    getGroqClient,
    rotateGroqKey,
    callGroqWithFallback,
    getKeyStatus
};
