'use strict';

const {
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const { musicQueues } = require('../../data/state');
const { playNext, resolveSong } = require('../../utils/voiceManager');
const { spotifyApi } = require('../../utils/spotifyManager');
const { generateMusicEmbed, getMusicButtons } = require('../../utils/uiHelpers');
const youtubeResolver = require('../../utils/youtubeResolver');
const youtubeMatcher = require('../../utils/youtubeMatcher');
const spotifyResolver = require('../../utils/spotifyResolver');
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
        previousHistory: [],
        volume: 1,
    };

    musicQueues.set(guildId, queue);

    // Listener dipasang SEKALI per sesi
    player.on(AudioPlayerStatus.Idle, () => {
        if (queue.isSeeking) {
            queue.isSeeking = false;
            return;
        }
        if (queue.isPreviousAction) {
            queue.isPreviousAction = false;
            return playNext(guildId);
        }
        if (queue.nowPlaying) {
            if (!queue.previousHistory) queue.previousHistory = [];
            queue.previousHistory.push(queue.nowPlaying);
        }
        queue.songs.shift();
        playNext(guildId);
    });

    player.on('error', (err) => {
        console.error('[Music] Player error:', err);
        if (queue.nowPlaying) {
            if (!queue.previousHistory) queue.previousHistory = [];
            queue.previousHistory.push(queue.nowPlaying);
        }
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

                const result = await youtubeResolver.getYoutubePlaylistTracks(query, 100);
                const playlistName = result.name;
                const newSongs = result.tracks.map(t => ({
                    title: t.title,
                    artist: t.artist,
                    videoId: t.id,
                    url: `https://www.youtube.com/watch?v=${t.id}`,
                    duration: t.duration,
                    requestedBy: message.author.tag,
                }));

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
        if (spotifyResolver.isSpotifyUrl(query)) {
            try {
                const parsed = spotifyResolver.parseSpotifyUrl(query);
                if (!parsed) return message.reply('Link Spotify-nya gak valid');

                const { type, id } = parsed;
                const spotstreamActive = await spotifyResolver.isSpotstreamReady();

                // TRACK
                if (type === 'track') {
                    const { body: track } = await spotifyApi.getTrack(id);

                    let queue = musicQueues.get(guildId);
                    const wasEmpty = !queue?.songs?.length;
                    if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

                    if (spotstreamActive) {
                        const song = {
                            title: track.name,
                            artist: track.artists.map(a => a.name).join(', '),
                            duration: Math.round(track.duration_ms / 1000),
                            spotifyId: track.id,
                            source: 'spotify',
                            url: `https://open.spotify.com/track/${track.id}`,
                            thumbnail: track.album?.images?.[0]?.url || '',
                            requestedBy: message.author.tag,
                        };

                        queue.songs.push(song);
                        await message.reply(`Nambahin **${song.title}** ke antrian (🟢 Spotify Direct 320kbps)`);
                        if (wasEmpty) playNext(guildId);
                        return;
                    } else {
                        // Fallback YouTube Matcher
                        const spotifyTrack = {
                            title: track.name,
                            artist: track.artists.map(a => a.name).join(', '),
                            duration: Math.round(track.duration_ms / 1000),
                            spotifyId: track.id,
                        };
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

                        queue.songs.push(song);
                        await message.reply(`Nambahin **${song.title}** ke antrian (YouTube Fallback)`);
                        if (wasEmpty) playNext(guildId);
                        return;
                    }
                }

                // PLAYLIST
                if (type === 'playlist') {
                    let playlistName = 'Spotify Playlist';
                    let tracks = [];

                    let queue = musicQueues.get(guildId);
                    const wasEmpty = !queue?.songs?.length;
                    if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

                    // 1. Coba ambil via spotstream dulu (support playlist personalisasi Daily Mix / Made for You)
                    if (spotstreamActive) {
                        try {
                            const spotPl = await spotifyResolver.getPlaylistInfo(id);
                            if (spotPl && spotPl.tracks && spotPl.tracks.length > 0) {
                                playlistName = spotPl.name || 'Spotify Playlist';
                                const trackIds = spotPl.tracks.map(t => t.id).filter(Boolean);

                                // Batch fetch track metadata via Spotify Web API (50 per batch)
                                const batchSize = 50;
                                for (let i = 0; i < Math.min(trackIds.length, 100); i += batchSize) {
                                    const chunk = trackIds.slice(i, i + batchSize);
                                    try {
                                        const res = await spotifyApi.getTracks(chunk);
                                        const fullTracks = (res.body.tracks || []).filter(Boolean);
                                        tracks.push(...fullTracks);
                                    } catch (err) {
                                        console.warn('[Play] getTracks chunk error:', err.message);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('[Play] spotstream getPlaylistInfo failed, fallback to Web API:', err.message);
                        }
                    }

                    // 2. Jika belum dapet (misal spotstream mati atau bukan personalized), ambil via spotifyApi standard
                    if (tracks.length === 0) {
                        const { body: playlist } = await spotifyApi.getPlaylist(id);
                        playlistName = playlist.name;
                        tracks = (playlist.tracks.items || [])
                            .filter(item => item.track)
                            .map(item => item.track)
                            .slice(0, 100);
                    }

                    if (tracks.length === 0) {
                        return message.reply('Playlist ini kosong atau gak bisa dibaca.');
                    }

                    if (spotstreamActive) {
                        const newSongs = tracks.map(track => ({
                            title: track.name,
                            artist: (track.artists || []).map(a => a.name).join(', ') || 'Unknown',
                            duration: Math.round((track.duration_ms || 0) / 1000),
                            spotifyId: track.id,
                            source: 'spotify',
                            url: `https://open.spotify.com/track/${track.id}`,
                            thumbnail: track.album?.images?.[0]?.url || '',
                            requestedBy: message.author.tag,
                        }));

                        queue.songs.push(...newSongs);
                        await message.reply(
                            `✅ Berhasil nambahin playlist Spotify **${playlistName}** (${newSongs.length} lagu, 🟢 Spotify Direct 320kbps).`
                        );
                        if (wasEmpty) playNext(guildId);
                        return;
                    } else {
                        // Legacy lazy YouTube resolve
                        const newSongs = tracks.map(track => ({
                            title: `${track.name} - ${(track.artists || []).map(a => a.name).join(', ') || 'Unknown'}`,
                            artist: (track.artists || []).map(a => a.name).join(', ') || 'Unknown',
                            duration: Math.round((track.duration_ms || 0) / 1000),
                            spotifyId: track.id,
                            videoId: null,
                            url: null,
                            isResolved: false,
                            requestedBy: message.author.tag,
                        }));

                        queue.songs.push(...newSongs);
                        await message.reply(
                            `✅ Berhasil nambahin playlist Spotify **${playlistName}** (${newSongs.length} lagu).`
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
                }

                // ALBUM
                if (type === 'album') {
                    const { body: album } = await spotifyApi.getAlbum(id);
                    const tracks = album.tracks.items || [];

                    let queue = musicQueues.get(guildId);
                    const wasEmpty = !queue?.songs?.length;
                    if (!queue) queue = createQueue(guildId, voiceChannel, message.channel);

                    if (spotstreamActive) {
                        const newSongs = tracks.map(track => ({
                            title: track.name,
                            artist: track.artists.map(a => a.name).join(', '),
                            duration: Math.round(track.duration_ms / 1000),
                            spotifyId: track.id,
                            source: 'spotify',
                            url: `https://open.spotify.com/track/${track.id}`,
                            thumbnail: album.images?.[0]?.url || '',
                            requestedBy: message.author.tag,
                        }));

                        queue.songs.push(...newSongs);
                        await message.reply(
                            `✅ Berhasil nambahin album Spotify **${album.name}** (${newSongs.length} lagu, 🟢 Spotify Direct 320kbps).`
                        );
                        if (wasEmpty) playNext(guildId);
                        return;
                    } else {
                        // Legacy lazy YouTube resolve
                        const newSongs = tracks.map(track => ({
                            title: `${track.name} - ${track.artists[0]?.name || ''}`,
                            artist: track.artists[0]?.name || '',
                            duration: Math.round(track.duration_ms / 1000),
                            spotifyId: track.id,
                            videoId: null,
                            url: null,
                            isResolved: false,
                            requestedBy: message.author.tag,
                        }));

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
