'use strict';

const metrics = require('./resolverMetrics');

// Primary YouTube resolver menggunakan youtubei.js (Innertube API).
// Port dari Noctune backend/src/services/youtubei.ts, diadaptasi ke CommonJS.
// - Primary resolver: Innertube (no subprocess, no scraping)
// - Multi-client fallback: ANDROID → IOS → WEB → MWEB → TV_SIMPLY → ANDROID_VR
// - Cookie support: Letakkan youtube-cookies.json di root untuk bypass datacenter IP block
//
// Cara export cookies:
// 1. Install browser extension "Get cookies.txt LOCALLY" (Chrome/Firefox)
// 2. Buka youtube.com (pastikan login)
// 3. Export cookies → pilih format "JSON" atau "Netscape"
// 4. Save sebagai youtube-cookies.json di project root
// 5. Restart bot
//
// Note: Cookies valid ~1 tahun, tapi bisa expire lebih cepat kalau YouTube detect abuse.
// Fallback yt-dlp masih aktif sebagai last resort (lambat, tapi lebih reliable dari nothing).

const YOUTUBEI_CLIENTS = ['ANDROID', 'IOS', 'WEB', 'MWEB', 'TV_SIMPLY', 'ANDROID_VR'];
const URL_EXPIRY_MS = (5 * 60 + 45) * 60 * 1000; // 5h45m — conservative YT URL expiry

// Singleton — lazy init
let innertubePromise = null;

async function getInnertube() {
    if (!innertubePromise) {
        innertubePromise = (async () => {
            const { Innertube } = await import('youtubei.js');
            const fs = require('fs');
            const path = require('path');
            
            let cookies;
            
            // Try Base64 env var first (for Railway deployment)
            if (process.env.YOUTUBE_COOKIES_B64) {
                try {
                    cookies = Buffer.from(process.env.YOUTUBE_COOKIES_B64, 'base64').toString('utf8');
                    console.log('[youtubeResolver] Loaded cookies from YOUTUBE_COOKIES_B64 env var');
                } catch (err) {
                    console.warn('[youtubeResolver] Failed to decode YOUTUBE_COOKIES_B64:', err.message);
                }
            }
            
            // Fallback to file (for local development)
            if (!cookies) {
                const cookiePath = process.env.YOUTUBE_COOKIES_PATH || path.join(process.cwd(), 'youtube-cookies.json');
                if (fs.existsSync(cookiePath)) {
                    try {
                        const cookieData = fs.readFileSync(cookiePath, 'utf8');
                        
                        // Detect format: Netscape vs JSON
                        if (cookieData.trim().startsWith('# Netscape HTTP Cookie File')) {
                            console.log('[youtubeResolver] Detected Netscape cookie format, converting...');
                            cookies = parseNetscapeCookies(cookieData);
                        } else {
                            cookies = cookieData;
                        }
                        
                        console.log(`[youtubeResolver] Loaded YouTube cookies from: ${cookiePath}`);
                    } catch (err) {
                        console.warn('[youtubeResolver] Failed to load cookies:', err.message);
                    }
                } else {
                    console.log('[youtubeResolver] No cookies found - resolver may fail on datacenter IPs');
                    console.log('[youtubeResolver] Tip: Export cookies and set YOUTUBE_COOKIES_B64 env var or save to youtube-cookies.json');
                }
            }
            
            const yt = await Innertube.create({
                cookie: cookies,
                // Use residential-like headers
                fetch: async (input, init) => {
                    const modifiedInit = {
                        ...init,
                        headers: {
                            ...init?.headers,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept-Language': 'en-US,en;q=0.9',
                        },
                    };
                    return fetch(input, modifiedInit);
                },
            });
            
            return yt;
        })();
    }
    return innertubePromise;
}

// Parse Netscape cookie format to JSON array
function parseNetscapeCookies(netscapeStr) {
    const lines = netscapeStr.split('\n');
    const cookies = [];
    
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || !line.trim()) continue;
        
        const parts = line.split('\t');
        if (parts.length < 7) continue;
        
        const [domain, flag, path, secure, expiration, name, value] = parts;
        
        cookies.push({
            domain: domain.trim(),
            path: path.trim(),
            secure: secure.trim() === 'TRUE',
            expires: parseInt(expiration.trim()),
            name: name.trim(),
            value: value.trim(),
        });
    }
    
    return JSON.stringify(cookies);
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
    const startTime = Date.now();

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

                const elapsedMs = Date.now() - startTime;
                metrics.recordResolveAttempt(videoId, client, true, elapsedMs, null);
                
                return { format: { ...format, url: format.url }, client };
            } catch (err) {
                const failMsg = `${client}/${options.format}: ${err.message}`;
                failures.push(failMsg);
                console.log(`[youtubeResolver:fallback] ${failMsg}`);
            }
        }
    }

    const fullError = `No client could resolve audio for ${videoId}. ${failures.join(' | ')}`;
    console.error(`[youtubeResolver:fallback] EXHAUSTED ALL CLIENTS: ${fullError}`);
    
    // Try yt-dlp as last resort fallback (if enabled)
    const ytDlpEnabled = process.env.YOUTUBE_YTDLP_FALLBACK === 'true';
    
    if (ytDlpEnabled) {
        console.log(`[youtubeResolver:fallback] Attempting yt-dlp fallback for ${videoId}...`);
        try {
            const result = await getStreamingDataViaYtDlp(videoId);
            const elapsedMs = Date.now() - startTime;
            metrics.recordResolveAttempt(videoId, 'yt-dlp', true, elapsedMs, null);
            return result;
        } catch (ytDlpErr) {
            console.error(`[youtubeResolver:fallback] yt-dlp also failed: ${ytDlpErr.message}`);
            const elapsedMs = Date.now() - startTime;
            const combinedError = new Error(`${fullError} | yt-dlp: ${ytDlpErr.message}`);
            metrics.recordResolveAttempt(videoId, 'yt-dlp', false, elapsedMs, combinedError);
            throw combinedError;
        }
    } else {
        console.log(`[youtubeResolver:fallback] yt-dlp fallback disabled (set YOUTUBE_YTDLP_FALLBACK=true to enable)`);
        const elapsedMs = Date.now() - startTime;
        const error = new Error(fullError);
        metrics.recordResolveAttempt(videoId, 'all-clients', false, elapsedMs, error);
        throw error;
    }
}

async function getStreamingDataViaYtDlp(videoId) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    
    // yt-dlp command to get direct audio URL (best audio, m4a/opus preferred)
    const cmd = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" --get-url "${url}"`;
    
    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
        
        if (stderr && !stdout) {
            throw new Error(stderr.trim());
        }
        
        const audioUrl = stdout.trim().split('\n')[0]; // Get first line (audio URL)
        
        if (!audioUrl || !audioUrl.startsWith('http')) {
            throw new Error('Invalid URL returned from yt-dlp');
        }
        
        console.log(`[youtubeResolver:yt-dlp] Successfully resolved ${videoId}`);
        
        return {
            format: {
                url: audioUrl,
                mime_type: 'audio/mp4', // Assume m4a
            },
            client: 'yt-dlp',
        };
    } catch (err) {
        // yt-dlp might not be installed or failed
        if (err.message.includes('yt-dlp') && err.code === 'ENOENT') {
            throw new Error('yt-dlp not installed on system');
        }
        throw err;
    }
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
    // Check throttle status
    const throttle = metrics.shouldThrottle();
    if (throttle.throttled) {
        const waitSec = Math.round(throttle.waitMs / 1000);
        throw new Error(`Resolver throttled due to repeated failures. Retry in ${waitSec}s`);
    }
    
    try {
        const { format, client } = await getStreamingDataWithFallback(videoId);

        console.log(`[youtubeResolver:stream] ${videoId} resolved via client: ${client}`);

        return {
            videoId,
            url: format.url,
            expiry: Date.now() + URL_EXPIRY_MS,
            format: parseAudioFormat(format.mime_type),
        };
    } catch (err) {
        console.error(`[youtubeResolver:stream] FAILED for ${videoId}:`, err.message);
        throw err;
    }
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
    getMetrics: () => metrics.getMetrics(),
    resetMetrics: () => metrics.resetMetrics(),
};
