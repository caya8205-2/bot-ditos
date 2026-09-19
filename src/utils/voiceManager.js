'use strict';

const {
    createAudioResource,
    StreamType,
    getVoiceConnection,
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { musicQueues } = require('../data/state');
const { SOUNDBOARD_CLIPS } = require('../data/constants');
const { GTTS_PATH, TEMP_DIR } = require('../config');
const { generateMusicEmbed, getMusicButtons } = require('./uiHelpers');
const youtubeResolver = require('./youtubeResolver');
const spotifyResolver = require('./spotifyResolver');
const musicCache = require('./musicCache');
const { getPrefetched, consumePrefetch, schedulePrefetch } = require('./prefetchManager');

const { PassThrough, Readable } = require('stream');
const {
    getAudioFilePath,
    getTempAudioFilePath,
    hasAudioCache,
    commitAudioCache,
    discardTempAudioCache,
    pruneCacheIfNeeded,
} = require('./audioFileCache');

// ─── Song Resolution ──────────────────────────────────────────────────────────

/**
 * Dapatkan stream URL untuk sebuah lagu.
 * Priority: prefetch memory → persistent cache (fresh) → resolve baru via youtubei.js
 *
 * @param {object} song - { videoId, title, url? }
 * @returns {Promise<string>} stream URL
 */
async function getStreamUrl(song) {
    const { videoId, title } = song;

    // 1. Prefetch memory hit — instant
    const prefetchHit = getPrefetched(videoId);
    if (prefetchHit) {
        console.log(`[Music] Prefetch hit → instant start: ${title}`);
        consumePrefetch(videoId);
        return prefetchHit.audioUrl;
    }

    // 2. Persistent cache — fresh URL
    const cached = musicCache.getCachedById(videoId);
    if (cached && musicCache.isUrlFresh(cached)) {
        console.log(`[Music] Cache hit: ${title}`);
        return cached.audioUrl;
    }

    // 3. Resolve baru via youtubei.js
    console.log(`[Music] Resolving stream: ${title}`);
    const audio = await youtubeResolver.resolveAudioUrl(videoId);

    // Simpan ke persistent cache
    if (cached) {
        musicCache.refreshTrackUrl(videoId, audio.url);
    } else {
        musicCache.upsertTrack(song.url || `https://www.youtube.com/watch?v=${videoId}`, {
            id: videoId,
            title: title || videoId,
            artist: song.artist || 'Unknown',
            duration: song.duration || 0,
            thumbnail: song.thumbnail || '',
        }, audio.url, song.spotifyId);
    }

    return audio.url;
}

// ─── Resolve song metadata (untuk lagu yang belum punya videoId) ──────────────

/**
 * Resolve videoId dari lagu yang hanya punya title/search query.
 * @param {object} song
 */
async function resolveSong(song) {
    if (song.videoId) return song;

    // Cache by query dulu
    const cachedByQuery = musicCache.getCachedByQuery(song.title);
    if (cachedByQuery) {
        console.log(`[Music] Query cache hit: ${song.title}`);
        song.videoId = cachedByQuery.id;
        song.title = cachedByQuery.title;
        song.artist = cachedByQuery.artist;
        song.isResolved = true;
        return song;
    }

    // Search via youtubei.js
    console.log(`[Music] Searching: ${song.title}`);
    const results = await youtubeResolver.searchTracks(song.title, 5);
    if (!results.length) return null;

    const best = results[0];
    song.videoId = best.id;
    song.title = best.title;
    song.artist = best.artist;
    song.duration = best.duration;
    song.isResolved = true;

    return song;
}

// ─── Core playback ────────────────────────────────────────────────────────────

async function playNext(guildId) {
    const queue = musicQueues.get(guildId);

    if (!queue || !queue.songs || queue.songs.length === 0) {
        if (queue?.stopOnIdle) {
            console.log(`[Music] Stopped manually in ${guildId}. Staying in VC.`);
            queue.stopOnIdle = false;
            return;
        }
        console.log(`[Music] Queue kosong di guild ${guildId}, stop.`);
        queue?.connection?.destroy();
        musicQueues.delete(guildId);
        return;
    }

    let song = queue.songs[0];

    // Resolve videoId jika belum ada (lazy legacy Spotify tracks yang bukan direct stream)
    if (song.source !== 'spotify' && !song.videoId) {
        if (song.isResolving) {
            console.log(`[Music] JIT: masih resolving ${song.title}...`);
        }
        console.log(`[Music] JIT resolve: ${song.title}`);
        const resolved = await resolveSong(song);
        if (!resolved) {
            queue.textChannel.send(`⚠️ Gagal memutar **${song.title}**, gak nemu di YouTube. Skip.`);
            queue.songs.shift();
            return playNext(guildId);
        }
        song = resolved;
    }

    queue.nowPlaying = song;

    if (queue.currentStreamSource) {
        try { queue.currentStreamSource.kill(); } catch {}
        queue.currentStreamSource = null;
    }

    try {
        const isSpotifyDirect = song.source === 'spotify' || (song.spotifyId && !song.videoId);
        const isLocalCache = song.videoId && hasAudioCache(song.videoId);
        let child;

        if (isSpotifyDirect) {
            console.log(`[Music] Direct Spotify streaming via spotstream: ${song.title} (${song.spotifyId})`);
            const ffmpegArgs = [
                '-f', 's16le',
                '-ar', '44100',
                '-ac', '2',
                '-i', 'pipe:0',
                '-loglevel', 'warning',
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-vbr', 'on',
                '-f', 'ogg',
                '-ar', '48000',
                '-ac', '2',
                'pipe:1',
            ];
            child = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
            child.stdin.on('error', () => {});

            const spotProc = spotifyResolver.spawnSpotifyStream(song.spotifyId);
            spotProc.stdout.pipe(child.stdin);
            spotProc.stdout.on('error', () => {});
            spotProc.on('error', (err) => {
                console.error('[Music] spotstream child error:', err.message);
                try { child.stdin.destroy(); } catch {}
            });

            queue.currentStreamSource = spotProc;
        } else if (isLocalCache) {
            console.log(`[Music] Local Audio Cache HIT: ${song.title}`);
            const ffmpegArgs = [
                '-i', getAudioFilePath(song.videoId),
                '-loglevel', 'warning',
                '-c:a', 'copy',
                '-f', 'ogg',
                'pipe:1',
            ];
            child = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        } else {
            const ffmpegArgs = [
                '-i', 'pipe:0',
                '-loglevel', 'warning',
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-vbr', 'on',
                '-f', 'ogg',
                '-ar', '48000',
                '-ac', '2',
                'pipe:1',
            ];
            child = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
            child.stdin.on('error', () => {});

            let piped = false;
            try {
                const streamUrl = await getStreamUrl(song);
                song.streamUrl = streamUrl;

                const headers = {
                    'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X; US)',
                    'Origin': 'https://www.youtube.com',
                    'Referer': 'https://www.youtube.com',
                };

                const res = await fetch(streamUrl, { headers: { ...headers, Range: 'bytes=0-1048576' } });
                if (res.ok) {
                    const fullRes = await fetch(streamUrl, { headers });
                    if (fullRes.ok) {
                        const bodyStream = Readable.fromWeb(fullRes.body);
                        bodyStream.pipe(child.stdin);
                        bodyStream.on('error', (err) => {
                            console.warn('[Music] Body stream error:', err.message);
                            try { child.stdin.destroy(); } catch {}
                        });
                        piped = true;
                    }
                }
            } catch (err) {
                console.warn(`[Music] Innertube stream error for ${song.title}:`, err.message);
            }

            if (!piped) {
                // Fallback otomatis ke yt-dlp jika Innertube 403 / diblokir
                console.log(`[Music] Streaming via yt-dlp fallback: ${song.title}`);
                const videoUrl = song.url || `https://www.youtube.com/watch?v=${song.videoId}`;
                const ytProc = spawn('yt-dlp', [
                    '-o', '-',
                    '-f', 'bestaudio/18/best',
                    '--extractor-args', 'youtube:player_client=android',
                    '--no-playlist',
                    '--quiet',
                    videoUrl
                ], { stdio: ['ignore', 'pipe', 'pipe'] });

                ytProc.stdout.pipe(child.stdin);
                ytProc.stdout.on('error', () => {});
                ytProc.on('error', (err) => {
                    console.error('[Music] yt-dlp process error:', err.message);
                    try { child.stdin.destroy(); } catch {}
                });
            }
        }

        child.on('error', (err) => {
            console.error('[Music] FFmpeg process error:', err.message);
            if (song.videoId) {
                discardTempAudioCache(song.videoId);
                musicCache.invalidateTrackUrl(song.videoId);
            }
        });

        child.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.warn(`[FFmpeg] ${msg}`);
        });

        child.on('close', () => {
            if (queue.currentStreamSource) {
                try { queue.currentStreamSource.kill(); } catch {}
                queue.currentStreamSource = null;
            }
        });

        // Simpan ke local disk cache secara atomic (hanya jika lagu selesai 100% tanpa di-stop/skip di tengah)
        if (!isLocalCache && song.videoId) {
            const tempPath = getTempAudioFilePath(song.videoId);
            const writeStream = fs.createWriteStream(tempPath);
            child.stdout.pipe(writeStream);
            child.on('close', (code) => {
                if (code === 0 && !queue.isSeeking && !queue.isPreviousAction) {
                    commitAudioCache(song.videoId);
                } else {
                    discardTempAudioCache(song.videoId);
                }
            });
            writeStream.on('error', (err) => {
                console.warn('[Music] Write local audio cache error:', err.message);
                discardTempAudioCache(song.videoId);
            });
        }

        const passThrough = new PassThrough();
        child.stdout.pipe(passThrough);

        const resource = createAudioResource(passThrough, {
            inputType: StreamType.OggOpus,
            inlineVolume: true,
        });

        queue.player.play(resource);
        resource.volume.setVolume(queue.volume || 1);
        queue.playbackStartTime = Date.now();

        // Catat play count
        musicCache.recordPlay(song.videoId);

        // Send embed
        const embed = generateMusicEmbed(guildId);
        if (embed && queue.textChannel) {
            queue.textChannel.send({
                embeds: [embed],
                components: getMusicButtons(guildId),
            }).catch(err => console.error('[Music] Gagal kirim embed:', err));
        }

        // Prefetch lagu ke-2 dan ke-3 dalam queue
        const upcomingIds = queue.songs.slice(1, 4)
            .filter(s => s.videoId)
            .map(s => s.videoId);

        if (upcomingIds.length > 0) {
            schedulePrefetch(upcomingIds).catch(err =>
                console.warn('[prefetch] schedule error:', err.message)
            );
        }

    } catch (err) {
        console.error('[Music] playNext error:', err.message);
        if (song?.videoId) musicCache.invalidateTrackUrl(song.videoId);
        queue.songs.shift();
        setTimeout(() => playNext(guildId), 1000);
    }
}

// ─── Seek & Previous Controls ──────────────────────────────────────────────────

async function seekAudio(guildId, targetSeconds) {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.nowPlaying) return false;

    if (queue.currentStreamSource) {
        try { queue.currentStreamSource.kill(); } catch {}
        queue.currentStreamSource = null;
    }

    try {
        const song = queue.nowPlaying;
        const safeSeek = Math.max(0, Math.floor(targetSeconds));
        const isSpotifyDirect = song.source === 'spotify' || (song.spotifyId && !song.videoId);
        const isLocalCache = song.videoId && hasAudioCache(song.videoId);
        let child;

        if (isSpotifyDirect) {
            const ffmpegArgs = [
                '-f', 's16le',
                '-ar', '44100',
                '-ac', '2',
                '-i', 'pipe:0',
                '-ss', String(safeSeek),
                '-loglevel', 'warning',
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-vbr', 'on',
                '-f', 'ogg',
                '-ar', '48000',
                '-ac', '2',
                'pipe:1',
            ];
            child = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
            child.stdin.on('error', () => {});

            const spotProc = spotifyResolver.spawnSpotifyStream(song.spotifyId);
            spotProc.stdout.pipe(child.stdin);
            spotProc.stdout.on('error', () => {});
            queue.currentStreamSource = spotProc;
        } else if (isLocalCache) {
            const ffmpegArgs = [
                '-ss', String(safeSeek),
                '-i', getAudioFilePath(song.videoId),
                '-loglevel', 'warning',
                '-c:a', 'copy',
                '-f', 'ogg',
                'pipe:1',
            ];
            child = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        } else {
            const streamUrl = song.streamUrl || await getStreamUrl(song);
            const headers = {
                'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X; US)',
                'Origin': 'https://www.youtube.com',
                'Referer': 'https://www.youtube.com',
            };
            let res = await fetch(streamUrl, { headers: { ...headers, Range: 'bytes=0-' } });
            if (!res.ok) {
                console.warn(`[Music] Seek fetch status ${res.status}, re-resolving fresh URL: ${song.title}`);
                const freshAudio = await youtubeResolver.resolveAudioUrl(song.videoId);
                song.streamUrl = freshAudio.url;
                musicCache.refreshTrackUrl(song.videoId, freshAudio.url);
                res = await fetch(freshAudio.url, { headers: { ...headers, Range: 'bytes=0-' } });
                if (!res.ok) {
                    throw new Error(`Fetch audio stream for seek failed: ${res.status}`);
                }
            }

            const ffmpegArgs = [
                '-ss', String(safeSeek),
                '-i', 'pipe:0',
                '-loglevel', 'warning',
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-vbr', 'on',
                '-f', 'ogg',
                '-ar', '48000',
                '-ac', '2',
                'pipe:1',
            ];
            child = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
            child.stdin.on('error', () => {});

            const bodyStream = Readable.fromWeb(res.body);
            bodyStream.pipe(child.stdin);
            bodyStream.on('error', () => {
                try { child.stdin.destroy(); } catch {}
            });
        }

        child.on('error', (err) => {
            console.error('[Music] FFmpeg seek error:', err.message);
        });

        const passThrough = new PassThrough();
        child.stdout.pipe(passThrough);

        const resource = createAudioResource(passThrough, {
            inputType: StreamType.OggOpus,
            inlineVolume: true,
        });

        queue.isSeeking = true;
        queue.player.play(resource);
        resource.volume.setVolume(queue.volume || 1);
        queue.playbackStartTime = Date.now() - (safeSeek * 1000);
        return true;
    } catch (err) {
        console.error('[Music] seekAudio error:', err);
        return false;
    }
}

function getElapsedSeconds(guildId) {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.playbackStartTime) return 0;
    return Math.max(0, (Date.now() - queue.playbackStartTime) / 1000);
}

async function playPrevious(guildId) {
    const queue = musicQueues.get(guildId);
    if (!queue || !queue.previousHistory || queue.previousHistory.length === 0) {
        return false;
    }

    const prevSong = queue.previousHistory.pop();
    if (queue.nowPlaying) {
        queue.songs.unshift(queue.nowPlaying);
    }
    queue.songs.unshift(prevSong);
    queue.isPreviousAction = true;
    queue.player.stop();
    return true;
}

// ─── Soundboard ───────────────────────────────────────────────────────────────

async function playLocalSound(voiceChannel, key, textChannel) {
    const clip = SOUNDBOARD_CLIPS[key];
    if (!clip) {
        if (textChannel) await textChannel.send(`Soundboard \`${key}\` belum ada.`);
        return;
    }
    if (!fs.existsSync(clip.file)) {
        if (textChannel) await textChannel.send(`File soundboard untuk \`${key}\` nggak ketemu.`);
        return;
    }

    const connection = getVoiceConnection(voiceChannel.guild.id) || joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
    });

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const stream = fs.createReadStream(clip.file);
    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

    connection.subscribe(player);
    player.play(resource);

    player.once(AudioPlayerStatus.Playing, () => {
        if (textChannel) textChannel.send(`🗣️ 🔊 Soundboard: **${clip.title}**`);
    });
    player.once(AudioPlayerStatus.Idle, () => player.stop());
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

async function ttsGoogle(text, outputFileName) {
    return new Promise((resolve, reject) => {
        const safe = text.replace(/"/g, '\\"');
        const outPath = path.join(TEMP_DIR, outputFileName);
        const cmd = `"${GTTS_PATH}" "${safe}" --lang id --output "${outPath}"`;
        exec(cmd, (err) => {
            if (err) return reject(err);
            resolve(outPath);
        });
    });
}

module.exports = { playNext, playLocalSound, ttsGoogle, resolveSong, seekAudio, getElapsedSeconds, playPrevious };
