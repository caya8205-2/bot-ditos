'use strict';

// Music cache dengan dual-index dan URL TTL.
// Port dari Noctune backend/src/services/cache.ts, diadaptasi ke CommonJS.
//
// Struktur penyimpanan:
//   tracks    : { [videoId]: CachedTrack }
//   queryIndex: { [sha1Hash(query)]: videoId }
//
// Load sekali saat startup, write-through setiap ada perubahan.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = path.join(__dirname, '../../data/songs.json');
const CACHE_VERSION = 1;
const URL_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam — sesuai expiry URL YouTube

// ─── Store helpers ────────────────────────────────────────────────────────────

function ensureDataDir() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hashQuery(query) {
    return crypto
        .createHash('sha1')
        .update(query.toLowerCase().trim())
        .digest('hex')
        .slice(0, 12);
}

function emptyStore() {
    return { version: CACHE_VERSION, updatedAt: Date.now(), tracks: {}, queryIndex: {} };
}

function loadStore() {
    ensureDataDir();
    if (!fs.existsSync(CACHE_FILE)) return emptyStore();
    try {
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch {
        console.warn('[musicCache] File corrupt, reset.');
        return emptyStore();
    }
}

function saveStore(store) {
    ensureDataDir();
    store.updatedAt = Date.now();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// Singleton in-memory store (load once, write-through)
let _store = null;

function getStore() {
    if (!_store) _store = loadStore();
    return _store;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Cek apakah URL stream masih valid (belum expired). */
function isUrlFresh(track) {
    return Date.now() < track.audioUrlExpiry;
}

/** Lookup by search query string. */
function getCachedByQuery(query) {
    const store = getStore();
    const videoId = store.queryIndex[hashQuery(query)];
    if (!videoId) return null;
    return store.tracks[videoId] ?? null;
}

/** Lookup langsung by videoId. */
function getCachedById(videoId) {
    return getStore().tracks[videoId] ?? null;
}

/** Lookup by Spotify track ID. */
function getCachedBySpotifyId(spotifyId) {
    return Object.values(getStore().tracks).find(t => t.spotifyId === spotifyId) ?? null;
}

/**
 * Simpan atau update track setelah resolve audio.
 * @param {string} query - Query yang dipakai untuk search
 * @param {object} track - { id, title, artist, duration, thumbnail }
 * @param {string} audioUrl - Direct stream URL
 * @param {string} [spotifyId] - Spotify track ID (optional)
 */
function upsertTrack(query, track, audioUrl, spotifyId) {
    const store = getStore();
    const hash = hashQuery(query);
    const existing = store.tracks[track.id];

    const cached = {
        ...track,
        audioUrl,
        audioUrlExpiry: Date.now() + URL_TTL_MS,
        spotifyId: spotifyId ?? existing?.spotifyId,
        cachedAt: existing?.cachedAt ?? Date.now(),
        playCount: existing?.playCount ?? 0,
        lastPlayed: existing?.lastPlayed,
    };

    store.tracks[track.id] = cached;
    store.queryIndex[hash] = track.id;

    // Juga index by videoId sebagai direct query key
    store.queryIndex[hashQuery(track.id)] = track.id;

    saveStore(store);
    return cached;
}

/** Refresh hanya URL-nya (saat URL expired tapi track sudah dikenal). */
function refreshTrackUrl(videoId, audioUrl) {
    const store = getStore();
    const track = store.tracks[videoId];
    if (!track) return;
    track.audioUrl = audioUrl;
    track.audioUrlExpiry = Date.now() + URL_TTL_MS;
    saveStore(store);
}

/** Catat play count setiap kali lagu dimainkan. */
function recordPlay(videoId) {
    const store = getStore();
    const track = store.tracks[videoId];
    if (!track) return;
    track.playCount = (track.playCount ?? 0) + 1;
    track.lastPlayed = Date.now();
    saveStore(store);
}

/** Stats. */
function getCacheStats() {
    const store = getStore();
    return {
        total: Object.keys(store.tracks).length,
        totalQueries: Object.keys(store.queryIndex).length,
    };
}

module.exports = {
    isUrlFresh,
    getCachedByQuery,
    getCachedById,
    getCachedBySpotifyId,
    upsertTrack,
    refreshTrackUrl,
    recordPlay,
    getCacheStats,
};
