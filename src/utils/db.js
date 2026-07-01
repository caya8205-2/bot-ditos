'use strict';

// Database singleton menggunakan better-sqlite3.
// Init sekali saat startup, semua operasi synchronous.
//
// Tables:
//   memory              — long-term AI memory (ganti memory.json)
//   song_cache          — resolved track + audio URL (ganti data/songs.json)
//   query_index         — SHA1 query hash → video_id (bagian dari songs.json)
//   spotify_youtube_map — Spotify→YouTube match cache (ganti spotify-youtube-map.json)

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_DIR  = path.join(__dirname, '../../data');
const DB_FILE = path.join(DB_DIR, 'bot.db');

// JSON files yang akan di-migrate (lama)
const SONGS_JSON      = path.join(DB_DIR, 'songs.json');
const MATCHER_JSON    = path.join(DB_DIR, 'spotify-youtube-map.json');
const MEMORY_JSON     = path.join(__dirname, '../../memory.json');

let _db = null;

function getDb() {
    if (!_db) _db = initDb();
    return _db;
}

function initDb() {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

    const db = new Database(DB_FILE);

    // WAL mode — lebih cepat, aman untuk concurrent read
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    createTables(db);
    runMigrations(db);

    return db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function createTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS memory (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     TEXT NOT NULL,
            username    TEXT,
            note        TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory(user_id);

        CREATE TABLE IF NOT EXISTS song_cache (
            video_id          TEXT PRIMARY KEY,
            title             TEXT,
            artist            TEXT,
            duration          INTEGER DEFAULT 0,
            thumbnail         TEXT,
            audio_url         TEXT,
            audio_url_expiry  INTEGER,
            spotify_id        TEXT,
            cached_at         INTEGER,
            play_count        INTEGER DEFAULT 0,
            last_played       INTEGER
        );

        CREATE TABLE IF NOT EXISTS query_index (
            query_hash  TEXT PRIMARY KEY,
            video_id    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS spotify_youtube_map (
            spotify_id     TEXT PRIMARY KEY,
            youtube_id     TEXT NOT NULL,
            youtube_title  TEXT,
            youtube_artist TEXT,
            score          INTEGER DEFAULT 0,
            matched_at     INTEGER
        );

        CREATE TABLE IF NOT EXISTS _migrations (
            name        TEXT PRIMARY KEY,
            ran_at      INTEGER NOT NULL
        );
    `);
}

// ─── One-time migrations dari JSON lama ───────────────────────────────────────

function hasMigrated(db, name) {
    return !!db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name);
}

function markMigrated(db, name) {
    db.prepare('INSERT OR IGNORE INTO _migrations (name, ran_at) VALUES (?, ?)').run(name, Date.now());
}

function runMigrations(db) {
    migrateSongsJson(db);
    migrateMatcherJson(db);
    migrateMemoryJson(db);
}

function migrateSongsJson(db) {
    if (hasMigrated(db, 'songs_json')) return;

    if (!fs.existsSync(SONGS_JSON)) {
        markMigrated(db, 'songs_json');
        return;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(SONGS_JSON, 'utf-8'));
        const tracks = Object.values(raw.tracks ?? {});
        const queryIndex = raw.queryIndex ?? {};

        const insertSong = db.prepare(`
            INSERT OR IGNORE INTO song_cache
                (video_id, title, artist, duration, thumbnail, audio_url, audio_url_expiry,
                 spotify_id, cached_at, play_count, last_played)
            VALUES
                (@video_id, @title, @artist, @duration, @thumbnail, @audio_url, @audio_url_expiry,
                 @spotify_id, @cached_at, @play_count, @last_played)
        `);

        const insertQuery = db.prepare(`
            INSERT OR IGNORE INTO query_index (query_hash, video_id) VALUES (?, ?)
        `);

        const runAll = db.transaction(() => {
            for (const t of tracks) {
                insertSong.run({
                    video_id:         t.id ?? t.videoId,
                    title:            t.title ?? null,
                    artist:           t.artist ?? null,
                    duration:         t.duration ?? 0,
                    thumbnail:        t.thumbnail ?? null,
                    audio_url:        t.audioUrl ?? null,
                    audio_url_expiry: t.audioUrlExpiry ?? 0,
                    spotify_id:       t.spotifyId ?? null,
                    cached_at:        t.cachedAt ?? Date.now(),
                    play_count:       t.playCount ?? 0,
                    last_played:      t.lastPlayed ?? null,
                });
            }
            for (const [hash, videoId] of Object.entries(queryIndex)) {
                insertQuery.run(hash, videoId);
            }
        });

        runAll();

        fs.renameSync(SONGS_JSON, SONGS_JSON + '.migrated');
        markMigrated(db, 'songs_json');
        console.log(`[DB] Migrated ${tracks.length} songs from songs.json`);
    } catch (err) {
        console.error('[DB] songs.json migration failed:', err.message);
    }
}

function migrateMatcherJson(db) {
    if (hasMigrated(db, 'matcher_json')) return;

    if (!fs.existsSync(MATCHER_JSON)) {
        markMigrated(db, 'matcher_json');
        return;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(MATCHER_JSON, 'utf-8'));
        const matches = Object.values(raw.matches ?? {});

        const insert = db.prepare(`
            INSERT OR IGNORE INTO spotify_youtube_map
                (spotify_id, youtube_id, youtube_title, youtube_artist, score, matched_at)
            VALUES
                (@spotify_id, @youtube_id, @youtube_title, @youtube_artist, @score, @matched_at)
        `);

        const runAll = db.transaction(() => {
            for (const m of matches) {
                insert.run({
                    spotify_id:    m.spotifyId,
                    youtube_id:    m.youtubeId,
                    youtube_title: m.youtubeTitle ?? null,
                    youtube_artist: m.youtubeArtist ?? null,
                    score:         m.score ?? 0,
                    matched_at:    m.matchedAt ?? Date.now(),
                });
            }
        });

        runAll();

        fs.renameSync(MATCHER_JSON, MATCHER_JSON + '.migrated');
        markMigrated(db, 'matcher_json');
        console.log(`[DB] Migrated ${matches.length} Spotify→YouTube matches`);
    } catch (err) {
        console.error('[DB] matcher_json migration failed:', err.message);
    }
}

function migrateMemoryJson(db) {
    if (hasMigrated(db, 'memory_json')) return;

    if (!fs.existsSync(MEMORY_JSON)) {
        markMigrated(db, 'memory_json');
        return;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(MEMORY_JSON, 'utf-8'));

        const insert = db.prepare(`
            INSERT OR IGNORE INTO memory (user_id, username, note, updated_at, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);

        const runAll = db.transaction(() => {
            for (const [userId, data] of Object.entries(raw)) {
                const notes = Array.isArray(data.notes) ? data.notes : [];
                notes.forEach((n, i) => {
                    insert.run(userId, data.username ?? userId, n.note, n.updatedAt ?? new Date().toISOString(), i);
                });
            }
        });

        runAll();

        fs.renameSync(MEMORY_JSON, MEMORY_JSON + '.migrated');
        markMigrated(db, 'memory_json');
        const total = Object.values(raw).reduce((s, d) => s + (d.notes?.length ?? 0), 0);
        console.log(`[DB] Migrated ${total} memory notes from memory.json`);
    } catch (err) {
        console.error('[DB] memory_json migration failed:', err.message);
    }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function hashQuery(query) {
    return crypto.createHash('sha1').update(query.toLowerCase().trim()).digest('hex').slice(0, 12);
}

module.exports = { getDb, hashQuery };
