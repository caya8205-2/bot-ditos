const {
    joinVoiceChannel,
    createAudioPlayer,
    NoSubscriberBehavior,
    AudioPlayerStatus
} = require('@discordjs/voice');
const ytdlExec = require('yt-dlp-exec'); // [RESTORED] Needed for playlists
const ytSearch = require('yt-search');
const { musicQueues } = require('../../data/state');
const { playNext } = require('../../utils/voiceManager');
const { spotifyApi } = require('../../utils/spotifyManager');
const { generateMusicEmbed, getMusicButtons } = require('../../utils/uiHelpers');
const musicService = require('../../utils/musicService');
const musicCache = require('../../utils/musicCache');

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
            return message.reply('Kasih judul atau link bok- lagunya dong, contoh: `d!play blinding lights atau d!play https://www.youtube.com/watch?v=xxx`');
        }

        let url;
        let title;

        // --- YOUTUBE PLAYLIST (via yt-dlp) ---
        // Detect playlist URL pattern simple
        const isPlaylist = query.includes('list=') && (query.includes('youtube.com') || query.includes('youtu.be'));

        if (isPlaylist) {
            try {
                await message.reply('Lagi ngambil data playlist, tunggu bentar...');

                // Fetch metadata ONLY using yt-dlp (fast)
                const output = await ytdlExec(query, {
                    flatPlaylist: true,
                    dumpSingleJson: true,
                    noWarnings: true,
                });

                if (!output || !output.entries) {
                    throw new Error('Playlist kosong atau gak kebaca.');
                }

                let queue = musicQueues.get(guildId);
                let wasEmpty = !queue || !queue.songs || queue.songs.length === 0;

                if (!queue) {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                        selfDeaf: false,
                    });

                    const player = createAudioPlayer({
                        behaviors: {
                            noSubscriber: NoSubscriberBehavior.Play,
                        },
                    });

                    connection.subscribe(player);

                    queue = {
                        voiceChannel,
                        textChannel: message.channel,
                        connection,
                        player,
                        songs: [],
                        volume: 1, // Default volume
                    };

                    musicQueues.set(guildId, queue);

                    player.on(AudioPlayerStatus.Idle, () => {
                        queue.songs.shift();
                        playNext(guildId);
                    });

                    player.on('error', (err) => {
                        console.error('Player error:', err);
                        queue.songs.shift();
                        playNext(guildId);
                    });

                    wasEmpty = true;
                }

                const newSongs = output.entries.map(item => ({
                    title: item.title,
                    url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
                    requestedBy: message.author.tag
                }));

                queue.songs.push(...newSongs);

                await message.channel.send(
                    `✅ Berhasil nambahin playlist **${output.title || 'Unknown Playlist'}** (${newSongs.length} lagu) ke antrian.`
                );

                if (wasEmpty) {
                    playNext(guildId);
                }
                return;

            } catch (err) {
                console.error('[Play] Playlist Fail:', err);
                // Jangan return, lanjut coba anggap sebagai single video siapa tau linknya aneh
                message.channel.send('Gagal baca sebagai playlist, nyoba mode single video...');
            }
        }

        // --- SPOTIFY ---
        if (query.includes('spotify.com')) {
            try {
                await message.reply('Bentar ya, lagi convert dari Spotify...');
                const spotifyRegex = /spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/;
                const match = query.match(spotifyRegex);

                if (!match) {
                    return message.reply('Link Spotify nya gak valid');
                }

                const [, type, id] = match;

                // TRACK
                if (type === 'track') {
                    const trackData = await spotifyApi.getTrack(id);
                    const track = trackData.body;
                    const spotifyId = track.id;
                    const searchQuery = `${track.name} ${track.artists.map(a => a.name).join(' ')}`;

                    // [CACHE CHECK FIRST]
                    const cachedVideoId = musicCache.getLearnedMatch(spotifyId);

                    if (cachedVideoId) {
                        console.log(`[Spotify→Cache Hit] ${spotifyId} -> ${cachedVideoId}`);
                        url = `https://www.youtube.com/watch?v=${cachedVideoId}`;
                        title = `${track.name} - ${track.artists[0].name}`;
                    } else {
                        const res = await musicService.searchTrack(searchQuery);

                        if (!res) {
                            return message.reply(`Gak nemu "${searchQuery}" di YouTube`);
                        }

                        url = res.url;
                        title = `${track.name} - ${track.artists[0].name}`;

                        // [SAVE TO CACHE]
                        musicCache.setLearnedMatch(spotifyId, res.videoId);
                        console.log(`[Spotify→YT] Track: ${searchQuery} → ${res.title} (Cached)`);
                    }
                }
                // PLAYLIST
                else if (type === 'playlist') {
                    const playlistData = await spotifyApi.getPlaylist(id);
                    const playlist = playlistData.body;

                    let queue = musicQueues.get(guildId);
                    let wasEmpty = !queue || !queue.songs || queue.songs.length === 0;

                    if (!queue) {
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

                        queue = {
                            voiceChannel,
                            textChannel: message.channel,
                            connection,
                            player,
                            songs: [],
                            volume: 1,
                        };
                        musicQueues.set(guildId, queue);

                        // Basic event listeners handling
                        player.on(AudioPlayerStatus.Idle, () => {
                            queue.songs.shift();
                            playNext(guildId);
                        });
                        player.on('error', (err) => {
                            console.error('Player error:', err);
                            queue.songs.shift();
                            playNext(guildId);
                        });

                        wasEmpty = true;
                    }

                    // [LAZY LOAD] Convert to metadata first
                    const tracks = playlist.tracks.items.slice(0, 100); // Limit 100 or higher
                    const newSongs = [];

                    for (const item of tracks) {
                        if (item.track) {
                            const track = item.track;
                            const simpleTitle = `${track.name} - ${track.artists[0].name}`;
                            newSongs.push({
                                title: simpleTitle,
                                url: null, // Unresolved
                                isResolved: false,
                                spotifyId: track.id, // [SPOTIFY CACHE KEY]
                                requestedBy: message.author.tag,
                            });
                        }
                    }

                    queue.songs.push(...newSongs);

                    await message.reply(
                        `✅ Berhasil nambahin playlist **${playlist.name}** (${newSongs.length} lagu) ke antrian (Mode Cepat).`
                    );

                    if (wasEmpty && queue.songs.length > 0) {
                        playNext(guildId);
                    }
                    return;
                }
                // ALBUM
                else if (type === 'album') {
                    const albumData = await spotifyApi.getAlbum(id);
                    const album = albumData.body;

                    let queue = musicQueues.get(guildId);
                    let wasEmpty = !queue || !queue.songs || queue.songs.length === 0;

                    if (!queue) {
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
                        queue = {
                            voiceChannel,
                            textChannel: message.channel,
                            connection,
                            player,
                            songs: [],
                            volume: 1,
                        };
                        musicQueues.set(guildId, queue);

                        player.on(AudioPlayerStatus.Idle, () => {
                            queue.songs.shift();
                            playNext(guildId);
                        });
                        player.on('error', (err) => {
                            console.error('Player error:', err);
                            queue.songs.shift();
                            playNext(guildId);
                        });
                        wasEmpty = true;
                    }

                    // [LAZY LOAD] Album tracks
                    const tracks = album.tracks.items;
                    const newSongs = [];

                    for (const track of tracks) {
                        const simpleTitle = `${track.name} - ${track.artists[0].name}`;
                        newSongs.push({
                            title: simpleTitle,
                            url: null,
                            isResolved: false,
                            spotifyId: track.id, // [SPOTIFY CACHE KEY]
                            requestedBy: message.author.tag,
                        });
                    }

                    queue.songs.push(...newSongs);
                    await message.reply(
                        `✅ Berhasil nambahin album **${album.name}** (${newSongs.length} lagu) ke antrian.`
                    );

                    if (wasEmpty && queue.songs.length > 0) {
                        playNext(guildId);
                    }
                    return;
                }

            } catch (err) {
                console.error('Spotify error:', err);
                if (err.statusCode === 401) return message.reply('Spotify API token expired.');
                if (err.statusCode === 404) return message.reply('Spotify playlist not found (mungkin private?).');
                return message.reply('Error pas convert dari Spotify: ' + (err.message || err));
            }
        }

        // --- YOUTUBE DIRECT / SEARCH ---
        try {
            if (!url) {
                const isYTUrl = query.includes('youtube.com/watch') || query.includes('youtu.be/');

                if (isYTUrl) {
                    let videoId = null;
                    if (query.includes('watch?v=')) {
                        videoId = query.split('v=')[1].split('&')[0];
                    } else if (query.includes('youtu.be/')) {
                        videoId = query.split('youtu.be/')[1].split('?')[0];
                    }

                    if (videoId) {
                        const info = await ytSearch({ videoId });
                        if (!info || !info.title) {
                            return message.reply('Gak bisa ambil info videonya');
                        }
                        url = `https://www.youtube.com/watch?v=${videoId}`;
                        title = info.title;
                    } else {
                        url = query;
                        title = query;
                    }
                } else {
                    // Search
                    // Use MusicService for consistent scoring
                    const res = await musicService.searchTrack(query);
                    if (!res) {
                        return message.reply(`Gak nemu lagu yang cocok`);
                    }
                    url = res.url;
                    title = res.title;
                }
            }
        } catch (err) {
            console.error('Play command error:', err);
            return message.reply('Ada yang error pas nyari lagunya');
        }

        // --- QUEUE LOGIC ---
        let queue = musicQueues.get(guildId);
        const wasEmpty = !queue || !queue.songs || queue.songs.length === 0;

        if (!queue) {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });

            const player = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play,
                },
            });

            connection.subscribe(player);

            queue = {
                voiceChannel,
                textChannel: message.channel,
                connection,
                player,
                songs: [],
                volume: 1
            };

            musicQueues.set(guildId, queue);

            // Reminder: Embed sent in voiceManager on play

            player.on(AudioPlayerStatus.Idle, () => {
                queue.songs.shift();
                playNext(guildId);
            });

            player.on('error', (err) => {
                console.error('Player error:', err);
                queue.songs.shift();
                playNext(guildId);
            });
        }

        queue.songs.push({ title, url, requestedBy: message.author.tag });

        await message.reply(`Nambahin **${title}** ke antrian`);

        if (wasEmpty) {
            playNext(guildId);
        } else {
            if (queue.songs.length === 2 && !queue.songs[1].isResolved) {
                const nextSong = queue.songs[1];
                console.log(`[Music] Proactive Prefetch: ${nextSong.title}`);
                nextSong.isResolving = true;
                musicService.searchTrack(nextSong.title).then(res => {
                    if (res) {
                        nextSong.url = res.url;
                        nextSong.videoId = res.videoId;
                        nextSong.title = res.title;
                        nextSong.isResolved = true;

                        if (nextSong.spotifyId) {
                            musicCache.setLearnedMatch(nextSong.spotifyId, res.videoId);
                        }
                        musicService.getStreamUrl(res.videoId).catch(console.error);

                        console.log(`[Music] Proactive Prefetch DONE: ${nextSong.title}`);
                    }
                }).catch(console.error);
            }
        }
    },
};
