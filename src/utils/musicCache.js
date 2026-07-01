'use strict';

// Music cache — menggunakan SQLite via better-sqlite3.
// API public identik dengan versi JSON lama — semua caller tidak perlu diubah.

const { getDb, hashQuery } = require('./db');

const URL_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam

// ─── Prepared statements (lazy, cached) ───────────────────────────────────────

let _stmts = null;

function stmts() {
    if (_stmts) return _stmts;
    const db = getDb();

    _stmts = {
        getByQuery: db.prepare(`
            SELECT s.* FROM song_cache s
            JOIN query_index q ON q.video_id = s.video_id
            WHERE q.query_hash = ?
        `),
        getById: db.prepare(`SELECT * FROM song_cache WHERE video_id = ?`),
        getBySpotifyId: db.prepare(`SELECT * FROM song_cache WHERE spotify_id = ? LIMIT 1`),
        upsert: db.prepare(`
            INSERT INTO song_cache
                (video_id, title, artist, duration, thumbnail, audio_url, audio_url_expiry,
                 spotify_id, cached_at, play_count, last_played)
            VALUES
                (@video_id, @title, @artist, @duration, @thumbnail, @audio_url, @audio_url_expiry,
                 @spotify_id, @cached_at, @play_count, @last_played)
            ON CONFLICT(video_id) DO UPDATE SET
                title            = excluded.title,
                artist           = excluded.artist,
                duration         = excluded.duration,
                thumbnail        = excluded.thumbnail,
                audio_url        = excluded.audio_url,
                audio_url_expiry = excluded.audio_url_expiry,
                spotify_id       = COALESCE(excluded.spotify_id, song_cache.spotify_id),
                play_count       = song_cache.play_count,
                last_played      = song_cache.last_played
        `),
        indexQuery: db.prepare(`
            INSERT OR REPLACE INTO query_index (query_hash, video_id) VALUES (?, ?)
        `),
        refreshUrl: db.prepare(`
            UPDATE song_cache SET audio_url = ?, audio_url_expiry = ? WHERE video_id = ?
        `),
        recordPlay: db.prepare(`
            UPDATE song_cache SET play_count = play_count + 1, last_played = ? WHERE video_id = ?
        `),
        stats: db.prepare(`SELECT COUNT(*) as total FROM song_cache`),
        statsQuery: db.prepare(`SELECT COUNT(*) as total FROM query_index`),
    };

    return _stmts;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function rowToTrack(row) {
    if (!row) return null;
    return {
        id:              row.video_id,
        title:           row.title,
        artist:          row.artist,
        duration:        row.duration,
        thumbnail:       row.thumbnail,
        audioUrl:        row.audio_url,
        audioUrlExpiry:  row.audio_url_expiry,
        spotifyId:       row.spotify_id,
        cachedAt:        row.cached_at,
        playCount:       row.play_count,
        lastPlayed:      row.last_played,
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Cek apakah URL stream masih valid (belum expired). */
function isUrlFresh(track) {
    return Boolean(track?.audioUrl) && Date.now() < track.audioUrlExpiry;
}

/** Lookup by search query string. */
function getCachedByQuery(query) {
    return rowToTrack(stmts().getByQuery.get(hashQuery(query)));
}

/** Lookup langsung by videoId. */
function getCachedById(videoId) {
    return rowToTrack(stmts().getById.get(videoId));
}

/** Lookup by Spotify track ID. */
function getCachedBySpotifyId(spotifyId) {
    return rowToTrack(stmts().getBySpotifyId.get(spotifyId));
}

/**
 * Simpan atau update track setelah resolve audio.
 * @param {string} query
 * @param {{ id, title, artist, duration, thumbnail }} track
 * @param {string} audioUrl
 * @param {string} [spotifyId]
 */
function upsertTrack(query, track, audioUrl, spotifyId) {
    const db = getDb();
    const existing = stmts().getById.get(track.id);

    const run = db.transaction(() => {
        stmts().upsert.run({
            video_id:         track.id,
            title:            track.title ?? null,
            artist:           track.artist ?? null,
            duration:         track.duration ?? 0,
            thumbnail:        track.thumbnail ?? null,
            audio_url:        audioUrl,
            audio_url_expiry: Date.now() + URL_TTL_MS,
            spotify_id:       spotifyId ?? existing?.spotify_id ?? null,
            cached_at:        existing?.cached_at ?? Date.now(),
            play_count:       existing?.play_count ?? 0,
            last_played:      existing?.last_played ?? null,
        });

        const hash = hashQuery(query);
        stmts().indexQuery.run(hash, track.id);
        // Juga index by videoId langsung
        stmts().indexQuery.run(hashQuery(track.id), track.id);
    });

    run();

    return getCachedById(track.id);
}

/** Refresh hanya URL-nya (saat URL expired tapi track sudah dikenal). */
function refreshTrackUrl(videoId, audioUrl) {
    if (!audioUrl) return; // null → skip (invalidate hanya via re-resolve)
    stmts().refreshUrl.run(audioUrl, Date.now() + URL_TTL_MS, videoId);
}

/** Catat play count setiap kali lagu dimainkan. */
function recordPlay(videoId) {
    stmts().recordPlay.run(Date.now(), videoId);
}

/** Stats. */
function getCacheStats() {
    return {
        total:        stmts().stats.get().total,
        totalQueries: stmts().statsQuery.get().total,
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
