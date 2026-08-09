const { musicQueues } = require('../../data/state');
const { playPrevious } = require('../../utils/voiceManager');

module.exports = {
    name: 'previous',
    aliases: ['prev', 'back'],
    description: 'Putar lagu sebelumnya',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || !queue.nowPlaying) {
            return message.reply('Gak ada musik yang lagi diputar.');
        }

        const success = await playPrevious(guildId);
        if (!success) {
            return message.reply('Belum ada riwayat lagu sebelumnya.');
        }

        return message.reply('⏮ Memutar lagu sebelumnya...');
    },
};
