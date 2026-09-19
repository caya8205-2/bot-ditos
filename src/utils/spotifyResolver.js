'use strict';

/**
 * Spotify Resolver & Direct Streamer adapter
 * Interfaces with the native Rust `spotstream` CLI binary for
 * low-latency, direct 320kbps Spotify playback without YouTube conversion.
 */

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let cachedAuthStatus = null;
let lastStatusCheck = 0;
const STATUS_CACHE_TTL_MS = 60 * 1000; // 1 minute

function getSpotstreamBinary() {
    if (process.env.SPOTSTREAM_BIN && fs.existsSync(process.env.SPOTSTREAM_BIN)) {
        return process.env.SPOTSTREAM_BIN;
    }

    const localAppData = process.env.LOCALAPPDATA ||
        (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');

    const avpullBin = path.join(localAppData, 'avpull', 'spotstream.exe');
    if (fs.existsSync(avpullBin)) {
        return avpullBin;
    }

    return 'spotstream';
}

/**
 * Check whether spotstream is installed and authenticated.
 * @returns {Promise<boolean>}
 */
async function isSpotstreamReady() {
    const now = Date.now();
    if (cachedAuthStatus !== null && (now - lastStatusCheck < STATUS_CACHE_TTL_MS)) {
        return cachedAuthStatus;
    }

    return new Promise((resolve) => {
        const bin = getSpotstreamBinary();
        execFile(bin, ['status'], { timeout: 5000 }, (err, stdout) => {
            lastStatusCheck = Date.now();
            if (err) {
                cachedAuthStatus = false;
                return resolve(false);
            }
            try {
                const data = JSON.parse(stdout.trim());
                cachedAuthStatus = Boolean(data.authenticated);
                resolve(cachedAuthStatus);
            } catch {
                cachedAuthStatus = false;
                resolve(false);
            }
        });
    });
}

/**
 * Check if a query string is a Spotify URL or URI.
 * @param {string} query
 * @returns {boolean}
 */
function isSpotifyUrl(query) {
    if (!query || typeof query !== 'string') return false;
    return query.includes('spotify.com/') || query.startsWith('spotify:');
}

/**
 * Parse a Spotify URL or URI into its resource type and ID.
 * @param {string} query
 * @returns {{ type: 'track' | 'playlist' | 'album', id: string } | null}
 */
function parseSpotifyUrl(query) {
    if (!query || typeof query !== 'string') return null;

    // Standard URL: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=...
    const urlMatch = query.match(/spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/i);
    if (urlMatch) {
        return { type: urlMatch[1].toLowerCase(), id: urlMatch[2] };
    }

    // Spotify URI: spotify:track:4cOdK2wGLETKBW3PvgPWqT
    const uriMatch = query.match(/^spotify:(track|playlist|album):([a-zA-Z0-9]+)/i);
    if (uriMatch) {
        return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
    }

    return null;
}

/**
 * Spawn spotstream stream process to output raw PCM (s16le 44.1kHz stereo) to stdout.
 * @param {string} trackId
 * @returns {import('child_process').ChildProcess}
 */
function spawnSpotifyStream(trackId) {
    const bin = getSpotstreamBinary();
    const proc = spawn(bin, ['stream', trackId], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) console.log(`[spotstream:${trackId}] ${msg}`);
    });

    return proc;
}

/**
 * Request device authorization pairing code for Discord command or GUI flow.
 * @returns {Promise<{ device_code: string, user_code: string, verification_uri: string, verification_uri_complete: string, expires_in: number, interval: number }>}
 */
function requestDevicePairing() {
    return new Promise((resolve, reject) => {
        const bin = getSpotstreamBinary();
        execFile(bin, ['auth-code'], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`Failed to request pairing code: ${stderr || err.message}`));
            }
            try {
                const data = JSON.parse(stdout.trim());
                resolve(data);
            } catch (parseErr) {
                reject(new Error(`Failed to parse auth-code response: ${parseErr.message}`));
            }
        });
    });
}

/**
 * Poll Spotify until pairing code is approved, saving credentials.
 * @param {string} deviceCode
 * @param {number} expiresIn
 * @param {number} interval
 * @returns {Promise<boolean>}
 */
function pollDevicePairing(deviceCode, expiresIn = 3600, interval = 5) {
    return new Promise((resolve, reject) => {
        const bin = getSpotstreamBinary();
        const args = [
            'auth-poll',
            '--device-code', String(deviceCode),
            '--expires-in', String(expiresIn),
            '--interval', String(interval),
        ];

        execFile(bin, args, { timeout: (expiresIn + 30) * 1000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`Pairing polling failed: ${stderr || err.message}`));
            }
            try {
                const data = JSON.parse(stdout.trim());
                cachedAuthStatus = true;
                lastStatusCheck = Date.now();
                resolve(Boolean(data.authenticated));
            } catch {
                cachedAuthStatus = true;
                resolve(true);
            }
        });
    });
}

/**
 * Fetch track metadata via spotstream info CLI.
 * @param {string} trackId
 * @returns {Promise<{ id: string, title: string, artists: string[], album: string, duration_ms: number }>}
 */
function getTrackInfo(trackId) {
    return new Promise((resolve, reject) => {
        const bin = getSpotstreamBinary();
        execFile(bin, ['info', trackId], { timeout: 10000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`spotstream info failed: ${stderr || err.message}`));
            }
            try {
                const data = JSON.parse(stdout.trim());
                resolve(data);
            } catch (e) {
                reject(new Error(`Failed to parse track info: ${e.message}`));
            }
        });
    });
}

/**
 * Fetch playlist metadata and track list via spotstream.
 * Supported for all playlists including personalized Made for You / Daily Mix!
 * @param {string} playlistInput - ID, URI, or URL
 * @returns {Promise<{ name: string, description: string, tracks: Array<{ id: string, uri: string }> }>}
 */
function getPlaylistInfo(playlistInput) {
    return new Promise((resolve, reject) => {
        const bin = getSpotstreamBinary();
        execFile(bin, ['playlist', playlistInput], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`spotstream playlist failed: ${stderr || err.message}`));
            }
            try {
                const data = JSON.parse(stdout.trim());
                resolve(data);
            } catch (e) {
                reject(new Error(`Failed to parse playlist info: ${e.message}`));
            }
        });
    });
}

module.exports = {
    getSpotstreamBinary,
    isSpotstreamReady,
    isSpotifyUrl,
    parseSpotifyUrl,
    spawnSpotifyStream,
    requestDevicePairing,
    pollDevicePairing,
    getTrackInfo,
    getPlaylistInfo,
};
