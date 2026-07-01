'use strict';

// Primary YouTube resolver menggunakan youtubei.js (Innertube API).
// Port dari Noctune backend/src/services/youtubei.ts, diadaptasi ke CommonJS.
// - Primary resolver: Innertube (no subprocess, no scraping)
// - Multi-client fallback: ANDROID → IOS → WEB → MWEB → TV_SIMPLY → ANDROID_VR

const YOUTUBEI_CLIENTS = ['ANDROID', 'IOS', 'WEB', 'MWEB', 'TV_SIMPLY', 'ANDROID_VR'];
const URL_EXPIRY_MS = (5 * 60 + 45) * 60 * 1000; // 5h45m — conservative YT URL expiry

// Singleton — lazy init
let innertubePromise = null;

async function getInnertube() {
    if (!innertubePromise) {
        innertubePromise = (async () => {
            const { Innertube } = await import('youtubei.js');
            return Innertube.create();
        })();
    }
    return innertubePromise;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractVideoId(urlOrVideoId) {
    try {
        const url = new URL(urlOrVideoId);
        if (url.hostname.includes('youtu.be')) {
            return url.pathname.replace(/^\//, '').split('/')[0] || urlOrVideoId;
        }
        if (url.pathname.startsWith('/shorts/')) {
            return url.pathname.split('/')[2] || urlOrVideoId;
        }
        return url.searchParams.get('v') || urlOrVideoId;
    } catch {
        return urlOrVideoId;
    }
}

function extractPlaylistId(url) {
    try {
        return new URL(url).searchParams.get('list') || url;
    } catch {
        return url;
    }
}

function pickThumbnail(thumbnails) {
    if (!thumbnails?.length) return '';
    const sorted = [...thumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    const medium = sorted.find(t => (t.width ?? 0) <= 480);
    return medium?.url ?? sorted[0]?.url ?? '';
}

function isYoutubeVideoId(id) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function toTrack(video, query) {
    const id = video.video_id ?? video.id;
    if (!id || !isYoutubeVideoId(id)) return null;

    return {
        id,
        title: video.title?.toString?.() ?? video.title?.text ?? id,
        artist: video.author?.name ?? video.author ?? 'Unknown',
        duration: video.duration?.seconds ?? 0,
        thumbnail: video.best_thumbnail?.url ?? pickThumbnail(video.thumbnails),
        query,
    };
}

function trackFromInfo(info, originalQuery) {
    const basic = info.basic_info ?? {};
    const id = basic.id ?? extractVideoId(originalQuery);
    return {
        id,
        title: basic.title ?? id,
        artist: basic.author ?? basic.channel?.name ?? 'Unknown',
        duration: basic.duration ?? 0,
        thumbnail: pickThumbnail(basic.thumbnail),
        query: originalQuery,
    };
}

// ─── Multi-client fallback helpers ────────────────────────────────────────────

async function getBasicInfoWithFallback(videoId) {
    const youtube = await getInnertube();
    const failures = [];

    for (const client of YOUTUBEI_CLIENTS) {
        try {
            const info = await youtube.getBasicInfo(videoId, { client });
            return { info, client };
        } catch (err) {
            failures.push(`${client}: ${err.message}`);
        }
    }

    throw new Error(`No client could load metadata for ${videoId}. ${failures.join(' | ')}`);
}

async function getStreamingDataWithFallback(videoId) {
    const youtube = await getInnertube();
    const failures = [];

    // Try audio/mp4 first (most compatible), then any audio format
    const optionSets = [
        { type: 'audio', quality: 'best', format: 'mp4' },
        { type: 'audio', quality: 'best', format: 'any' },
    ];

    for (const client of YOUTUBEI_CLIENTS) {
        for (const options of optionSets) {
            try {
                const format = await youtube.getStreamingData(videoId, {
                    ...options,
                    client,
                });

                if (!format.url) throw new Error('No playable URL returned');

                // Skip limited iOS streams (known to fail)
                if (isLimitedIosStream(format.url)) throw new Error('Skipping limited iOS stream');

                return { format: { ...format, url: format.url }, client };
            } catch (err) {
                failures.push(`${client}/${options.format}: ${err.message}`);
            }
        }
    }

    throw new Error(`No client could resolve audio for ${videoId}. ${failures.join(' | ')}`);
}

function isLimitedIosStream(url) {
    try {
        return new URL(url).searchParams.get('c')?.toUpperCase() === 'IOS';
    } catch {
        return url.includes('c=IOS');
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search YouTube and return up to `limit` track candidates.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Track[]>}
 */
async function searchTracks(query, limit = 10) {
    const youtube = await getInnertube();
    const search = await youtube.search(query);
    const results = Array.from(search.results ?? []);

    const tracks = results
        .map(result => toTrack(result, query))
        .filter(Boolean)
        .slice(0, limit);

    console.log(`[youtubeResolver:search] "${query}" → ${tracks.length} results`);
    return tracks;
}

/**
 * Get track metadata for a YouTube URL or video ID.
 * @param {string} urlOrVideoId
 * @param {string} [originalQuery]
 * @returns {Promise<Track>}
 */
async function getYoutubeTrack(urlOrVideoId, originalQuery = urlOrVideoId) {
    const videoId = extractVideoId(urlOrVideoId);
    const { info } = await getBasicInfoWithFallback(videoId);
    return trackFromInfo(info, originalQuery);
}

/**
 * Get all tracks from a YouTube playlist URL.
 * @param {string} url
 * @param {number} limit
 * @returns {Promise<{ name: string, tracks: Track[] }>}
 */
async function getYoutubePlaylistTracks(url, limit = 100) {
    const youtube = await getInnertube();
    let playlist = await youtube.getPlaylist(extractPlaylistId(url));
    const tracks = [];

    while (tracks.length < limit) {
        for (const item of Array.from(playlist.items ?? [])) {
            const track = toTrack(item, item.title?.toString?.() ?? url);
            if (track) tracks.push(track);
            if (tracks.length >= limit) break;
        }

        if (tracks.length >= limit || !playlist.has_continuation) break;
        playlist = await playlist.getContinuation();
    }

    return {
        name: playlist.info?.title ?? 'YouTube Playlist',
        tracks,
    };
}

/**
 * Resolve a direct audio stream URL for a videoId.
 * @param {string} videoId
 * @returns {Promise<{ videoId: string, url: string, expiry: number, format: string }>}
 */
async function resolveAudioUrl(videoId) {
    const { format } = await getStreamingDataWithFallback(videoId);

    return {
        videoId,
        url: format.url,
        expiry: Date.now() + URL_EXPIRY_MS,
        format: parseAudioFormat(format.mime_type),
    };
}

/**
 * Resolve track metadata + audio URL in one call.
 * @param {string} videoId
 * @param {string} originalQuery
 * @returns {Promise<{ track: Track, audio: AudioStreamInfo }>}
 */
async function resolveTrack(videoId, originalQuery) {
    const [{ info }, audio] = await Promise.all([
        getBasicInfoWithFallback(videoId),
        resolveAudioUrl(videoId),
    ]);

    return {
        track: trackFromInfo(info, originalQuery),
        audio,
    };
}

function parseAudioFormat(mimeType) {
    const mime = (mimeType ?? '').toLowerCase();
    if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
    if (mime.includes('webm')) return 'webm';
    return 'audio';
}

module.exports = {
    searchTracks,
    getYoutubeTrack,
    getYoutubePlaylistTracks,
    resolveAudioUrl,
    resolveTrack,
};
