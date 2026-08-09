const { musicQueues } = require('../../data/state');
const { seekAudio, getElapsedSeconds } = require('../../utils/voiceManager');

module.exports = {
    name: 'ff',
    aliases: ['forward'],
    description: 'Fast-forward lagu beberapa detik ke depan (default 10s)',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || !queue.nowPlaying) {
            return message.reply('Gak ada lagu yang lagi diputar.');
        }

        const offset = parseInt(args[0] || '10', 10);
        if (isNaN(offset) || offset <= 0) {
            return message.reply('Jumlah detik harus angka positif. Contoh: `d!ff 30`');
        }

        const elapsed = getElapsedSeconds(guildId);
        const target = elapsed + offset;

        await message.reply(`⏩ Maju **+${offset}s** ke depan...`);
        await seekAudio(guildId, target);
    },
};
