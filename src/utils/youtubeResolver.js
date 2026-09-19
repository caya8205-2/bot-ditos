'use strict';

/**
 * YouTube resolver menggunakan innertube-rs CLI adapter binary.
 * Menghilangkan warning parser JS dan deciphering bottleneck dengan memanfaatkan
 * binary Rust native (innertube.exe).
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// Path resolver ke innertube CLI
function getInnertubeBinary() {
    // 1. Env override
    if (process.env.INNERTUBE_BIN && fs.existsSync(process.env.INNERTUBE_BIN)) {
        return process.env.INNERTUBE_BIN;
    }
    // 2. Local appdata avpull path
    const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
    const avpullBin = path.join(localAppData, 'avpull', 'innertube.exe');
    if (fs.existsSync(avpullBin)) {
        return avpullBin;
    }
    // 3. Fallback ke PATH command
    return 'innertube';
}

const URL_EXPIRY_MS = (5 * 60 + 45) * 60 * 1000; // 5h45m — conservative YT URL expiry

function runInnertubeCli(args, options = {}) {
    return new Promise((resolve, reject) => {
        const bin = getInnertubeBinary();
        execFile(bin, args, { maxBuffer: 10 * 1024 * 1024, timeout: options.timeout || 30000 }, (error, stdout, stderr) => {
            if (error) {
                const errOut = stderr ? stderr.trim() : error.message;
                return reject(new Error(`innertube-rs error: ${errOut}`));
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            } catch (err) {
                reject(new Error(`Failed to parse innertube-rs output: ${err.message}. Raw: ${stdout.slice(0, 100)}`));
            }
        });
    });
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

function isYoutubeVideoId(id) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function parseAudioFormat(mimeType) {
    const mime = (mimeType ?? '').toLowerCase();
    if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
    if (mime.includes('webm')) return 'webm';
    return 'audio';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search YouTube and return up to `limit` track candidates.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{ id: string, title: string, artist: string, duration: number, thumbnail: string, query: string }>>}
 */
async function searchTracks(query, limit = 10) {
    try {
        const results = await runInnertubeCli(['search', query, '--limit', String(limit)]);
        if (!Array.isArray(results)) return [];

        const tracks = results.map(t => ({
            id: t.id,
            title: t.title || t.id,
            artist: t.artist || 'Unknown',
            duration: Number(t.duration) || 0,
            thumbnail: t.thumbnail || '',
            query,
        })).filter(t => isYoutubeVideoId(t.id));

        console.log(`[youtubeResolver:search] "${query}" → ${tracks.length} results`);
        return tracks;
    } catch (err) {
        console.error(`[youtubeResolver:search] failed for "${query}":`, err.message);
        return [];
    }
}

/**
 * Get track metadata for a YouTube URL or video ID.
 * @param {string} urlOrVideoId
 * @param {string} [originalQuery]
 * @returns {Promise<{ id: string, title: string, artist: string, duration: number, thumbnail: string, query: string }>}
 */
async function getYoutubeTrack(urlOrVideoId, originalQuery = urlOrVideoId) {
    const videoId = extractVideoId(urlOrVideoId);
    const data = await runInnertubeCli(['info', videoId]);
    const details = data.videoDetails || {};

    let thumb = '';
    if (details.thumbnail && details.thumbnail.thumbnails && details.thumbnail.thumbnails.length > 0) {
        const sorted = [...details.thumbnail.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
        thumb = sorted[0].url || '';
    }

    return {
        id: details.videoId || videoId,
        title: details.title || videoId,
        artist: details.author || 'Unknown',
        duration: Number(details.lengthSeconds) || 0,
        thumbnail: thumb,
        query: originalQuery,
    };
}

/**
 * Get all tracks from a YouTube playlist URL.
 * @param {string} url
 * @param {number} limit
 * @returns {Promise<{ name: string, tracks: Array<{ id: string, title: string, artist: string, duration: number, thumbnail: string, query: string }> }>}
 */
async function getYoutubePlaylistTracks(url, limit = 100) {
    const playlistId = extractPlaylistId(url);
    const data = await runInnertubeCli(['playlist', playlistId, '--limit', String(limit)]);

    const tracks = (data.tracks || []).map(t => ({
        id: t.id,
        title: t.title || t.id,
        artist: t.artist || data.author || 'Unknown',
        duration: Number(t.duration) || 0,
        thumbnail: t.thumbnail || '',
        query: url,
    })).filter(t => isYoutubeVideoId(t.id));

    return {
        name: data.name || 'YouTube Playlist',
        tracks,
    };
}

/**
 * Resolve a direct audio stream URL for a videoId.
 * @param {string} videoId
 * @returns {Promise<{ videoId: string, url: string, expiry: number, format: string }>}
 */
async function resolveAudioUrl(videoId) {
    const stream = await runInnertubeCli(['stream', videoId]);
    if (!stream || !stream.audio || !stream.audio.url) {
        throw new Error(`No audio stream resolved for video ${videoId}`);
    }

    return {
        videoId,
        url: stream.audio.url,
        expiry: Date.now() + URL_EXPIRY_MS,
        format: parseAudioFormat(stream.audio.mimeType),
    };
}

/**
 * Resolve track metadata + audio URL in one call.
 * @param {string} videoId
 * @param {string} originalQuery
 * @returns {Promise<{ track: object, audio: object }>}
 */
async function resolveTrack(videoId, originalQuery) {
    const [track, audio] = await Promise.all([
        getYoutubeTrack(videoId, originalQuery),
        resolveAudioUrl(videoId),
    ]);

    return { track, audio };
}

module.exports = {
    searchTracks,
    getYoutubeTrack,
    getYoutubePlaylistTracks,
    resolveAudioUrl,
    resolveTrack,
};
