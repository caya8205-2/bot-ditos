'use strict';

// Prefetch manager untuk pre-resolve stream URL lagu berikutnya.
// Port dari Noctune backend/src/services/prefetch.ts, diadaptasi ke CommonJS.
//
// Flow:
//   schedulePrefetch([videoIds]) → enqueue jobs (max 5, concurrency 2)
//   getPrefetched(videoId)       → ambil hasil dari memory map
//   consumePrefetch(videoId)     → hapus dari memory setelah dikonsumsi
//   isPrefetching(videoId)       → cek apakah sedang in-flight

const { resolveAudioUrl } = require('./youtubeResolver');
const musicCache = require('./musicCache');

// p-queue: lazy init (ESM)
let prefetchQueue = null;
const inFlight = new Set();
const prefetched = new Map(); // videoId → { audioUrl, expiry }

async function getPrefetchQueue() {
    if (!prefetchQueue) {
        const mod = await import('p-queue');
        const PQueue = mod.default;
        prefetchQueue = new PQueue({ concurrency: 2 });
    }
    return prefetchQueue;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Ambil hasil prefetch dari memory. */
function getPrefetched(videoId) {
    return prefetched.get(videoId) ?? null;
}

/** Cek apakah videoId sedang dalam proses resolve. */
function isPrefetching(videoId) {
    return inFlight.has(videoId);
}

/** Hapus dari memory setelah dikonsumsi player. */
function consumePrefetch(videoId) {
    const had = prefetched.has(videoId);
    prefetched.delete(videoId);
    console.log(`[prefetch] consume ${had ? 'hit' : 'miss'}: ${videoId}`);
}

/**
 * Enqueue prefetch jobs untuk daftar videoId.
 * @param {string[]} videoIds - Max 5 yang akan diambil
 */
async function schedulePrefetch(videoIds) {
    const targets = videoIds.slice(0, 5);
    const queue = await getPrefetchQueue();

    console.log(`[prefetch] schedule requested: ${targets.join(', ')}`);

    for (const videoId of targets) {
        if (inFlight.has(videoId)) {
            console.log(`[prefetch] skip in-flight: ${videoId}`);
            continue;
        }

        if (prefetched.has(videoId)) {
            console.log(`[prefetch] skip already prefetched: ${videoId}`);
            continue;
        }

        // Cek persistent cache — kalau URL masih fresh, promote ke memory map
        const cached = musicCache.getCachedById(videoId);
        if (cached && musicCache.isUrlFresh(cached)) {
            prefetched.set(videoId, { audioUrl: cached.audioUrl, expiry: cached.audioUrlExpiry });
            console.log(`[prefetch] promoted from cache: ${videoId} (${cached.title})`);
            continue;
        }

        // Perlu resolve
        inFlight.add(videoId);
        console.log(`[prefetch] enqueue: ${videoId} (${cached ? 'refresh-url' : 'full-resolve'})`);

        queue.add(async () => {
            const startedAt = Date.now();
            try {
                const audio = await resolveAudioUrl(videoId);
                prefetched.set(videoId, { audioUrl: audio.url, expiry: audio.expiry });

                // Juga update persistent cache jika track sudah ada
                if (cached) {
                    musicCache.refreshTrackUrl(videoId, audio.url);
                }

                console.log(`[prefetch] done: ${videoId} (${Date.now() - startedAt}ms)`);
            } catch (err) {
                console.warn(`[prefetch] failed: ${videoId} — ${err.message}`);
            } finally {
                inFlight.delete(videoId);
            }
        });
    }
}

/** Bersihkan seluruh memory prefetch state. */
function clearPrefetchCache() {
    const snapshot = { prefetched: prefetched.size, inFlight: inFlight.size };
    prefetched.clear();
    inFlight.clear();
    if (prefetchQueue) prefetchQueue.clear();
    console.log('[prefetch] cleared', snapshot);
    return snapshot;
}

/** Status snapshot (untuk debug). */
function getPrefetchStatus() {
    return {
        queueSize: prefetchQueue?.size ?? 0,
        pending: prefetchQueue?.pending ?? 0,
        inFlight: [...inFlight],
        prefetched: [...prefetched.keys()],
    };
}

module.exports = {
    schedulePrefetch,
    getPrefetched,
    consumePrefetch,
    isPrefetching,
    clearPrefetchCache,
    getPrefetchStatus,
};
