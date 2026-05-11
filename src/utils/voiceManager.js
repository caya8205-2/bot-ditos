const {
    createAudioResource,
    StreamType,
    getVoiceConnection,
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    AudioPlayerStatus
} = require('@discordjs/voice');
const ytSearch = require('yt-search');
const ytdlExec = require('yt-dlp-exec'); // Keep for backup or specific needs
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { musicQueues, songCache, saveSongToCache } = require('../data/state');
const { SOUNDBOARD_CLIPS } = require('../data/constants');
const { GTTS_PATH, TEMP_DIR } = require('../config');
const { generateMusicEmbed, getMusicButtons } = require('./uiHelpers');
const musicService = require('./musicService'); // [CRITICAL] Use this for efficient streaming
const musicCache = require('./musicCache');

async function resolveSong(song) {
    if (!song || song.url) return song; // Already resolved or null

    // [CACHE CHECK]
    if (songCache.has(song.title)) {
        console.log(`[Music] Cache hit: ${song.title}`);
        song.url = songCache.get(song.title);
        song.isResolved = true;
        // Try to get Video ID from URL if possible
        if (song.url.includes('v=')) song.videoId = song.url.split('v=')[1].split('&')[0];
        else if (song.url.includes('youtu.be/')) song.videoId = song.url.split('youtu.be/')[1].split('?')[0];
        return song;
    }

    try {
        console.log(`[Music] Resolving: ${song.title}`);
        // Use musicService search for consistent scoring
        const res = await musicService.searchTrack(song.title);

        if (res) {
            song.url = res.url;
            song.videoId = res.videoId;
            song.title = res.title;
            song.isResolved = true;

            // [CACHE SAVE]
            saveSongToCache(song.title, res.url);

            // Save to Learning Cache too if needed
            if (song.spotifyId) {
                musicCache.setLearnedMatch(song.spotifyId, res.videoId);
            }

            console.log(`[Music] Resolved & Cached: ${song.title}`);
            return song;
        } else {
            console.warn(`[Music] Failed to resolve: ${song.title}`);
            return null;
        }
    } catch (err) {
        console.error(`[Music] Resolve error for ${song.title}:`, err);
        return null;
    }
}

async function playNext(guildId) {
    const queue = musicQueues.get(guildId);

    if (!queue || !queue.songs || queue.songs.length === 0) {
        if (queue && queue.stopOnIdle) {
            console.log(`[Music] Stopped manually in ${guildId}. Staying in VC.`);
            queue.stopOnIdle = false;
            return;
        }
        console.log(`[Music] Queue kosong di guild ${guildId}, stop.`);
        if (queue && queue.connection) {
            queue.connection.destroy();
        }
        musicQueues.delete(guildId);
        return;
    }

    let song = queue.songs[0];

    // [JIT RESOLVE]
    if (!song.url) {
        if (song.isResolving) {
            console.log(`[Music] JIT: Song is currently pre-fetching.`);
        }
        console.log(`[Music] PlayNext: URL Missing for ${song.title}. Triggering JIT Resolve.`);
        const resolved = await resolveSong(song);
        if (!resolved) {
            queue.textChannel.send(`⚠️ Gagal memutar **${song.title}**, gak nemu di YouTube. Skip.`);
            queue.songs.shift();
            return playNext(guildId);
        }
        song = resolved;
    } else {
        console.log(`[Music] PlayNext: URL Ready! (Instant Start) -> ${song.title}`);
    }

    queue.nowPlaying = song;

    try {
        // [VALIDATION] Ensure videoId exists
        if (!song.videoId && song.url) {
            if (song.url.includes('v=')) song.videoId = song.url.split('v=')[1].split('&')[0];
            else if (song.url.includes('youtu.be/')) song.videoId = song.url.split('youtu.be/')[1].split('?')[0];
        }

        if (!song.videoId) throw new Error("Could not extract Video ID");

        console.log(`[Music] Streaming: ${song.title}`);
        const streamUrl = await musicService.getStreamUrl(song.videoId);
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://www.youtube.com/',
            'Origin': 'https://www.youtube.com'
        };

        const response = await fetch(streamUrl, { headers });

        if (!response.ok) {
            if (response.status === 403) {
                console.warn("[Music] 403 Forbidden on Cached URL. Invalidating and Retrying...");
                musicCache.streamCache.delete(song.videoId); // Manually clear
                throw new Error("Stream 403 Forbidden");
            }
            throw new Error(`Stream fetch failed: ${response.status}`);
        }

        const { Readable } = require('stream');
        let inputStream = Readable.fromWeb(response.body);

        // FFmpeg Logic: Decode input -> Encode Opus -> Output Ogg
        const child = spawn(ffmpegPath, [
            '-i', 'pipe:0',
            '-analyzeduration', '0',
            '-loglevel', 'warning',
            '-c:a', 'libopus',   // Encode to Opus
            '-f', 'opus',        // Ogg Opus container
            '-ar', '48000',
            '-ac', '2',
            'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        inputStream.pipe(child.stdin);

        // [FIX] Prevent EPIPE crash if FFmpeg exits early
        child.stdin.on('error', (err) => {
            if (err.code === 'EPIPE') return;
            console.error('[FFmpeg Stdin] Error:', err);
        });

        inputStream.on('error', err => {
            try { child.kill(); } catch (e) { }
        });

        const resource = createAudioResource(child.stdout, {
            inputType: StreamType.OggOpus,
            inlineVolume: true,
        });

        queue.player.play(resource);
        resource.volume.setVolume(queue.volume || 1);

        const embed = generateMusicEmbed(guildId);
        if (embed && queue.textChannel) {
            queue.textChannel.send({
                embeds: [embed],
                components: getMusicButtons(guildId)
            }).catch(err => console.error("Gagal kirim embed music:", err));
        }

        // [PROACTIVE PRE-FETCH]
        if (queue.songs.length > 1) {
            const nextSong = queue.songs[1];
            if (!nextSong.displayUrl && !nextSong.videoId && !nextSong.isResolving) {
                console.log(`[Music] Prefetch START: ${nextSong.title}`);
                nextSong.isResolving = true;

                // Run in background
                (async () => {
                    try {
                        const res = await resolveSong(nextSong);
                        if (res && res.videoId) {
                            // ALSO PRE-FETCH AUDIO STREAM
                            // This is key for "Instant Start"
                            await musicService.getStreamUrl(res.videoId);
                            console.log(`[Music] Prefetch DONE (Audio Ready): ${nextSong.title}`);
                        }
                    } catch (e) {
                        console.error("[Prefetch] Failed", e);
                    } finally {
                        nextSong.isResolving = false;
                    }
                })();
            }
        }

    } catch (err) {
        console.error('PlayNext error:', err);
        // Invalid URL or error? Try standard ytdl-exec as LAST RESORT fallback?
        // Or just skip.
        queue.songs.shift(); // remove failed song
        setTimeout(() => playNext(guildId), 1000); // Retry next
    }
}

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

    let connection = getVoiceConnection(voiceChannel.guild.id) || joinVoiceChannel({
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

module.exports = { playNext, playLocalSound, ttsGoogle };
