const { musicQueues } = require('../../data/state');
const { seekAudio, getElapsedSeconds } = require('../../utils/voiceManager');

module.exports = {
    name: 'rw',
    aliases: ['rewind'],
    description: 'Rewind lagu beberapa detik ke belakang (default 10s)',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || !queue.nowPlaying) {
            return message.reply('Gak ada lagu yang lagi diputar.');
        }

        const offset = parseInt(args[0] || '10', 10);
        if (isNaN(offset) || offset <= 0) {
            return message.reply('Jumlah detik harus angka positif. Contoh: `d!rw 10`');
        }

        const elapsed = getElapsedSeconds(guildId);
        const target = Math.max(0, elapsed - offset);

        await message.reply(`⏪ Mundur **-${offset}s** ke belakang...`);
        await seekAudio(guildId, target);
    },
};
