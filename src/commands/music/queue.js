const { musicQueues } = require('../../data/state');

module.exports = {
    name: 'queue',
    aliases: ['q'],
    description: 'Liat antrian lagu',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || queue.songs.length === 0) {
            return message.reply('Antrian kosong melompong.');
        }

        const current = queue.songs[0];
        const list = queue.songs
            .slice(1, 11)
            .map((song, i) => `${i + 1}. **${song.title}** (req by ${song.requestedBy})`)
            .join('\n');

        let msg = `**🎶 Now Playing:**\n${current.title} (req by ${current.requestedBy})\n\n**Antrian Berikutnya:**\n${list || 'Belum ada lagi...'}`;

        if (queue.songs.length > 11) {
            msg += `\n\n...dan ${queue.songs.length - 11} lagu lainnya.`;
        }

        message.channel.send(msg);
    },
};
