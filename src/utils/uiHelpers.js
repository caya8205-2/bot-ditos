const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { musicQueues } = require('../data/state');

function generateMusicEmbed(guildId) { // Embed music player premium
    const queue = musicQueues.get(guildId);
    if (!queue) return null;

    if (!queue.nowPlaying) {
        // IDLE EMBED
        const volume = typeof queue.volume === "number" ? queue.volume : 1;
        const volumePercent = Math.round(volume * 100);

        return new EmbedBuilder()
            .setTitle("🎧 Ditos Music Player (Idle)")
            .setDescription("Gak ada lagu yang lagi diputer. Tambahin lagu atau klik tombol di bawah.")
            .addFields(
                {
                    name: "📻 Voice Channel",
                    value: queue.voiceChannel ? `<#${queue.voiceChannel.id}>` : "Tidak terhubung",
                    inline: true,
                },
                {
                    name: "🔊 Volume",
                    value: `${volumePercent}%`,
                    inline: true,
                },
                {
                    name: "🎶 Antrian",
                    value: "Kosong",
                    inline: false,
                }
            )
            .setColor("#95a5a6"); // Greyish color for idle
    }

    const track = queue.nowPlaying;

    // Volume (default 100% kalau belum pernah di-set)
    const volume = typeof queue.volume === "number" ? queue.volume : 1;
    const volumePercent = Math.round(volume * 100);

    // Antrian setelah lagu yang sedang diputar
    const upcoming = queue.songs.slice(1, 6); // max 5 lagu ke depan
    let queueText;

    if (upcoming.length > 0) {
        queueText = upcoming
            .map((s, i) => `\`${i + 1}.\` ${s.title}`)
            .join("\n");

        const more = queue.songs.length - 1 - upcoming.length;
        if (more > 0) {
            queueText += `\n… dan ${more} lagu lagi`;
        }
    } else {
        queueText = "Tidak ada lagu berikutnya.";
    }

    const requestedByLine = track.requestedBy
        ? `\n👤 **Requested by:** ${track.requestedBy}`
        : "";

    return new EmbedBuilder()
        .setTitle("🎧 Ditos Music Player")
        .setDescription(
            `**Sedang diputar**\n` +
            `▶ **${track.title}**\n` +
            `${track.url || ""}\n\n` +
            requestedByLine
        )
        .addFields(
            {
                name: "📻 Voice Channel",
                value: queue.voiceChannel ? `<#${queue.voiceChannel.id}>` : "Tidak terhubung",
                inline: true,
            },
            {
                name: "🔊 Volume",
                value: `${volumePercent}%`,
                inline: true,
            },
            {
                name: `🎶 Antrian (${Math.max(0, queue.songs.length - 1)} lagu)`,
                value: queueText,
                inline: false,
            },
        )
        .setColor("#1DB954");
}

function getMusicButtons(guildId) { // Tombol
    const data = musicQueues.get(guildId);
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("music_seek_minus_10").setLabel("⏪ -10s").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_seek_minus_5").setLabel("◀ -5s").setStyle(ButtonStyle.Secondary),
        data?.player?.state?.status === AudioPlayerStatus.Paused
            ? new ButtonBuilder().setCustomId("music_resume").setLabel("▶ Resume").setStyle(ButtonStyle.Success)
            : new ButtonBuilder().setCustomId("music_pause").setLabel("⏸ Pause").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("music_seek_plus_5").setLabel("▶ +5s").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_seek_plus_10").setLabel("⏩ +10s").setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("music_prev").setLabel("⏮ Prev").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_skip").setLabel("⏭ Skip").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_vol_down").setLabel("🔉 -10%").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music_vol_up").setLabel("🔊 +10%").setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("music_stop").setLabel("⏹ Stop").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("music_leave").setLabel("⏏ Leave").setStyle(ButtonStyle.Secondary),
    );

    return [row1, row2, row3];
}

module.exports = { generateMusicEmbed, getMusicButtons };
