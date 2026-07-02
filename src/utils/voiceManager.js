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
const musicCache = require('./musicCache');
const { getPrefetched, consumePrefetch, schedulePrefetch } = require('./prefetchManager');
const { recordCacheHit, recordCacheMiss } = require('./resolverMetrics');

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
        recordCacheHit();
        return prefetchHit.audioUrl;
    }

    // 2. Persistent cache — fresh URL
    const cached = musicCache.getCachedById(videoId);
    if (cached && musicCache.isUrlFresh(cached)) {
        console.log(`[Music] Cache hit: ${title}`);
        recordCacheHit();
        return cached.audioUrl;
    }

    // 3. Resolve baru via youtubei.js
    recordCacheMiss();
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

    console.log(`[Music] playNext called for guild ${guildId}`);
    console.log(`[Music] Queue state: ${queue ? `${queue.songs.length} songs` : 'no queue'}`);

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

    // Resolve videoId jika belum ada (lazy Spotify tracks)
    if (!song.videoId) {
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

    try {
        // Dapatkan stream URL (prefetch → cache → resolve)
        const streamUrl = await getStreamUrl(song);

        console.log(`[Music] Starting playback: ${song.title} (${song.videoId})`);
        console.log(`[Music] Stream URL: ${streamUrl.substring(0, 80)}...`);

        // Quick URL validity check
        try {
            const urlObj = new URL(streamUrl);
            console.log(`[Music] URL host: ${urlObj.hostname}`);
            
            // Test URL accessibility with HEAD request
            console.log(`[Music] Testing URL accessibility...`);
            const testRes = await fetch(streamUrl, { 
                method: 'HEAD',
                signal: AbortSignal.timeout(3000)
            });
            console.log(`[Music] URL test: ${testRes.status} ${testRes.statusText}`);
            console.log(`[Music] Content-Length: ${testRes.headers.get('content-length')}`);
            console.log(`[Music] Content-Type: ${testRes.headers.get('content-type')}`);
        } catch (urlErr) {
            console.error(`[Music] URL test failed: ${urlErr.message}`);
            throw new Error(`Stream URL not accessible: ${urlErr.message}`);
        }

        // Beri URL langsung ke FFmpeg — lebih reliable dari fetch+pipe.
        // FFmpeg handle HTTP reconnection dan range delivery dari YouTube secara native.
        const child = spawn(ffmpegPath, [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-headers',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\nReferer: https://www.youtube.com/\r\n',
            '-i', streamUrl,
            '-analyzeduration', '0',
            '-loglevel', 'error',
            '-c:a', 'libopus',
            '-f', 'opus',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let ffmpegErrorOutput = '';

        child.on('error', (err) => {
            console.error('[Music] FFmpeg process error:', err.message);
            ffmpegErrorOutput += `Process error: ${err.message}\n`;
        });

        child.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            ffmpegErrorOutput += msg + '\n';
            if (msg) console.error(`[FFmpeg] ${msg}`);
        });

        child.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.error(`[FFmpeg] Exited with code ${code}`);
                if (ffmpegErrorOutput) {
                    console.error(`[FFmpeg] Error output:\n${ffmpegErrorOutput}`);
                }
            } else {
                console.log(`[FFmpeg] Exited normally (code: ${code})`);
            }
        });

        // Check if stdout is readable
        if (!child.stdout || child.stdout.destroyed) {
            throw new Error('FFmpeg stdout not available');
        }


        const resource = createAudioResource(child.stdout, {
            inputType: StreamType.OggOpus,
            inlineVolume: true,
        });

        console.log(`[Music] Audio resource created, starting playback...`);

        // Check connection state
        const connState = queue.connection.state.status;
        console.log(`[Music] Voice connection state: ${connState}`);
        if (connState !== 'ready') {
            console.warn(`[Music] Connection not ready! Current state: ${connState}`);
        }

        queue.player.play(resource);
        resource.volume.setVolume(queue.volume || 1);

        // Log player state changes
        const currentState = queue.player.state.status;
        console.log(`[Music] Player state after play(): ${currentState}`);
        
        // Wait a bit to see if player actually starts
        setTimeout(() => {
            console.log(`[Music] Player state after 100ms: ${queue.player.state.status}`);
        }, 100);

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
        console.error('[Music] Full error stack:', err.stack);
        
        // Send user-facing error message
        if (queue.textChannel) {
            const errorMsg = err.message.includes('No client could resolve')
                ? `⚠️ YouTube nge-block IP server. **${song.title}** gak bisa diputar. Skip...`
                : `⚠️ Error pas mutar **${song.title}**: ${err.message}. Skip...`;
            queue.textChannel.send(errorMsg).catch(() => {});
        }
        
        queue.songs.shift();
        setTimeout(() => playNext(guildId), 1000);
    }
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

module.exports = { playNext, playLocalSound, ttsGoogle, resolveSong };
