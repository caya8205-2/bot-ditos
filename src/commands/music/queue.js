const { EmbedBuilder } = require('discord.js');
const { musicQueues } = require('../../data/state');
const { replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'queue',
    aliases: ['q'],
    description: 'Liat antrian lagu',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || queue.songs.length === 0) {
            const emptyEmbed = new EmbedBuilder()
                .setTitle('🎶 Antrian Musik')
                .setColor('#FF9800')
                .setDescription('Antrian kosong melompong. Tambah lagu pakai `d!play`!')
                .setTimestamp();
            return replyEmbedAndSave(message, { embeds: [emptyEmbed] });
        }

        const current = queue.songs[0];
        const upcoming = queue.songs.slice(1, 11);

        const listText = upcoming.length > 0
            ? upcoming
                .map((song, i) => `**${i + 1}.** ${song.title} *(req by ${song.requestedBy})*`)
                .join('\n')
            : 'Belum ada lagu berikutnya...';

        const embed = new EmbedBuilder()
            .setTitle('🎶 Antrian Musik')
            .setColor('#1DB954')
            .addFields(
                {
                    name: '▶️ Now Playing',
                    value: `**${current.title}**\n*Requested by:* ${current.requestedBy}`,
                    inline: false,
                },
                {
                    name: `📜 Next Queue (${queue.songs.length - 1} lagu)`,
                    value: listText,
                    inline: false,
                }
            )
            .setFooter({
                text: queue.songs.length > 11
                    ? `...dan ${queue.songs.length - 11} lagu lainnya.`
                    : `Total ${queue.songs.length} lagu di queue`
            })
            .setTimestamp();

        if (current.thumbnail) {
            embed.setThumbnail(current.thumbnail);
        }

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
