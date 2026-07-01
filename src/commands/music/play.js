'use strict';

const {
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const ytdlExec = require('yt-dlp-exec'); // fallback untuk YouTube playlist
const { musicQueues } = require('../../data/state');
const { playNext, resolveSong } = require('../../utils/voiceManager');
const { spotifyApi } = require('../../utils/spotifyManager');
const { generateMusicEmbed, getMusicButtons } = require('../../utils/uiHelpers');
const youtubeResolver = require('../../utils/youtubeResolver');
const youtubeMatcher = require('../../utils/youtubeMatcher');
const { schedulePrefetch } = require('../../utils/prefetchManager');

// ─── Helper: buat queue baru (listener dipasang sekali) ──────────────────────

function createQueue(guildId, voiceChannel, textChannel) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
    });

    const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    connection.subscribe(player);

    const queue = {
        voiceChannel,
        textChannel,
        connection,
        player,
        songs: [],
        volume: 1,
    };

    musicQueues.set(guildId, queue);

    // Listener dipasang SEKALI per sesi
    player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        playNext(guildId);
    });

    player.on('error', (err) => {
        console.error('[Music] Player error:', err);
        queue.songs.shift();
        playNext(guildId);
    });

    return queue;
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
    name: 'play',
    aliases: ['p'],
    description: 'Setel lagu dari YouTube/Spotify',
    async execute(message, args, client) {
        const { guildId } = message;
        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply('Minimal kalo mau dengerin musik, lu di vois dulu bos');
        }

        const query = args.join(' ');
        if (!query) {
            return message.reply('Kasih judul atau link lagunya dong, contoh: `d!play blinding lights`');
        }

        // ── 1. YouTube Playlist ──────────────────────────────────────────────
        const isYtPlaylist = query.includes('list=') &&
            (query.includes('youtube.com') || query.includes('youtu.be'));

        if (isYtPlaylist) {
            try {
                await message.reply('Lagi ngambil data playlist, tunggu bentar...');

                // Coba youtubei.js dulu, fallback ke yt-dlp-exec
                let playlistName;
                let newSongs;

                try {
                    const result = await youtubeResolver.getYoutubePlaylistTracks(query, 100);
                    playlistName = result.name;
                    newSongs = result.tracks.map(t => ({
                        title: t.title,
                        artist: t.artist,
                        videoId: t.id,
                        url: `https://www.youtube.com/watch?v=${t.id}`,
                        duration: t.duration,
                        requestedBy: message.author.tag,
                    }));
                } catch (ytErr) {
                    console.warn('[Play] youtubei playlist failed, fallback ke yt-dlp:', ytErr.message);
                    const output = await ytdlExec(query, {
                        flatPlaylist: true,
                        dumpSingleJson: true,
                        noWarnings: true,
                    });
                    if (!output?.entries) throw new Error('Playlist kosong atau gak kebaca.');
                    playlistName = output.title || 'YouTube Playlist';
                    newSongs = output.entries.map(item => ({
                        title: item.title,
                        videoId: item.id,
                        url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
                        requestedBy: message.author.tag,
                    }));
                }

                let queue = musicQueues.get(guildId);
                const wasEmpty = !queue?.songs?.length;

                if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);
                queue.songs.push(...newSongs);

                await message.channel.send(
                    `✅ Berhasil nambahin playlist **${playlistName}** (${newSongs.length} lagu) ke antrian.`
                );

                if (wasEmpty) playNext(guildId);
                return;

            } catch (err) {
                console.error('[Play] Playlist fail:', err);
                message.channel.send('Gagal baca sebagai playlist, nyoba mode single video...');
            }
        }

        // ── 2. Spotify ───────────────────────────────────────────────────────
        if (query.includes('spotify.com')) {
            try {
                await message.reply('Bentar ya, lagi convert dari Spotify...');
                const spotifyRegex = /spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/;
                const match = query.match(spotifyRegex);

                if (!match) return message.reply('Link Spotify-nya gak valid');

                const [, type, id] = match;

                // TRACK
                if (type === 'track') {
                    const { body: track } = await spotifyApi.getTrack(id);
                    const spotifyTrack = {
                        title: track.name,
                        artist: track.artists.map(a => a.name).join(', '),
                        duration: Math.round(track.duration_ms / 1000),
                        spotifyId: track.id,
                    };

                    // Match ke YouTube pakai youtubeMatcher
                    const matched = await youtubeMatcher.matchSpotifyTrackToYoutube(spotifyTrack);
                    if (!matched) return message.reply(`Gak nemu "${track.name}" di YouTube`);

                    const song = {
                        title: matched.youtubeTitle || track.name,
                        artist: matched.youtubeArtist || spotifyTrack.artist,
                        videoId: matched.youtubeId,
                        url: `https://www.youtube.com/watch?v=${matched.youtubeId}`,
                        spotifyId: track.id,
                        requestedBy: message.author.tag,
                    };

                    let queue = musicQueues.get(guildId);
                    const wasEmpty = !queue?.songs?.length;
                    if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

                    queue.songs.push(song);
                    await message.reply(`Nambahin **${song.title}** ke antrian`);
                    if (wasEmpty) playNext(guildId);
                    return;
                }

                // PLAYLIST
                if (type === 'playlist') {
                    const { body: playlist } = await spotifyApi.getPlaylist(id);
                    const tracks = playlist.tracks.items.slice(0, 100)
                        .filter(item => item.track)
                        .map(item => ({
                            title: item.track.name,
                            artist: item.track.artists.map(a => a.name).join(', '),
                            duration: Math.round(item.track.duration_ms / 1000),
                            spotifyId: item.track.id,
                        }));

                    let queue = musicQueues.get(guildId);
                    const wasEmpty = !queue?.songs?.length;
                    if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

                    // Lazy: push dulu tanpa videoId, resolve saat giliran play (JIT)
                    const newSongs = tracks.map(t => ({
                        title: `${t.title} - ${t.artist}`,
                        artist: t.artist,
                        duration: t.duration,
                        spotifyId: t.spotifyId,
                        videoId: null,
                        url: null,
                        isResolved: false,
                        requestedBy: message.author.tag,
                    }));

                    queue.songs.push(...newSongs);
                    await message.reply(
                        `✅ Berhasil nambahin playlist Spotify **${playlist.name}** (${newSongs.length} lagu).`
                    );

                    if (wasEmpty && queue.songs.length > 0) {
                        // Resolve lagu pertama sebelum play
                        const first = queue.songs[0];
                        const matchedFirst = await youtubeMatcher.matchSpotifyTrackToYoutube({
                            title: first.title.split(' - ')[0],
                            artist: first.artist,
                            duration: first.duration,
                            spotifyId: first.spotifyId,
                        });
                        if (matchedFirst) {
                            first.videoId = matchedFirst.youtubeId;
                            first.url = `https://www.youtube.com/watch?v=${matchedFirst.youtubeId}`;
                            first.isResolved = true;
                        }
                        playNext(guildId);
                    }

                    // Background: match + prefetch lagu ke-2 dan ke-3
                    (async () => {
                        const toMatch = newSongs.slice(1, 3).filter(s => !s.videoId);
                        for (const s of toMatch) {
                            const m = await youtubeMatcher.matchSpotifyTrackToYoutube({
                                title: s.title.split(' - ')[0],
                                artist: s.artist,
                                duration: s.duration,
                                spotifyId: s.spotifyId,
                            }).catch(() => null);
                            if (m) {
                                s.videoId = m.youtubeId;
                                s.url = `https://www.youtube.com/watch?v=${m.youtubeId}`;
                                s.isResolved = true;
                            }
                        }
                        const ids = newSongs.slice(1, 4).filter(s => s.videoId).map(s => s.videoId);
                        if (ids.length) schedulePrefetch(ids).catch(() => {});
                    })();

                    return;
                }

                // ALBUM
                if (type === 'album') {
                    const { body: album } = await spotifyApi.getAlbum(id);
                    const newSongs = album.tracks.items.map(track => ({
                        title: `${track.name} - ${track.artists[0].name}`,
                        artist: track.artists[0].name,
                        duration: Math.round(track.duration_ms / 1000),
                        spotifyId: track.id,
                        videoId: null,
                        url: null,
                        isResolved: false,
                        requestedBy: message.author.tag,
                    }));

                    let queue = musicQueues.get(guildId);
                    const wasEmpty = !queue?.songs?.length;
                    if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

                    queue.songs.push(...newSongs);
                    await message.reply(
                        `✅ Berhasil nambahin album **${album.name}** (${newSongs.length} lagu).`
                    );

                    if (wasEmpty && queue.songs.length > 0) {
                        const first = queue.songs[0];
                        const matchedFirst = await youtubeMatcher.matchSpotifyTrackToYoutube({
                            title: first.title.split(' - ')[0],
                            artist: first.artist,
                            duration: first.duration,
                            spotifyId: first.spotifyId,
                        });
                        if (matchedFirst) {
                            first.videoId = matchedFirst.youtubeId;
                            first.url = `https://www.youtube.com/watch?v=${matchedFirst.youtubeId}`;
                            first.isResolved = true;
                        }
                        playNext(guildId);
                    }

                    return;
                }

            } catch (err) {
                console.error('[Play] Spotify error:', err);
                if (err.statusCode === 401) return message.reply('Spotify API token expired.');
                if (err.statusCode === 404) return message.reply('Playlist/album Spotify not found (mungkin private?).');
                return message.reply('Error pas convert dari Spotify: ' + (err.message || err));
            }
        }

        // ── 3. YouTube direct URL atau text search ────────────────────────────
        try {
            let song;

            const isYtUrl = query.includes('youtube.com/watch') || query.includes('youtu.be/');

            if (isYtUrl) {
                // Direct YouTube URL
                const track = await youtubeResolver.getYoutubeTrack(query, query);
                song = {
                    title: track.title,
                    artist: track.artist,
                    videoId: track.id,
                    url: `https://www.youtube.com/watch?v=${track.id}`,
                    duration: track.duration,
                    requestedBy: message.author.tag,
                };
            } else {
                // Text search via youtubei.js
                const results = await youtubeResolver.searchTracks(query, 10);
                if (!results.length) return message.reply(`Gak nemu lagu yang cocok untuk "${query}"`);

                const best = results[0];
                song = {
                    title: best.title,
                    artist: best.artist,
                    videoId: best.id,
                    url: `https://www.youtube.com/watch?v=${best.id}`,
                    duration: best.duration,
                    requestedBy: message.author.tag,
                };
            }

            let queue = musicQueues.get(guildId);
            const wasEmpty = !queue?.songs?.length;
            if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

            queue.songs.push(song);
            await message.reply(`Nambahin **${song.title}** ke antrian`);

            if (wasEmpty) {
                playNext(guildId);
            } else {
                // Prefetch lagu ke-2 dan ke-3 jika ada videoId
                const ids = queue.songs.slice(1, 4).filter(s => s.videoId).map(s => s.videoId);
                if (ids.length) schedulePrefetch(ids).catch(() => {});
            }

        } catch (err) {
            console.error('[Play] Error:', err);
            return message.reply('Ada yang error pas nyari lagunya: ' + (err.message || err));
        }
    },
};
