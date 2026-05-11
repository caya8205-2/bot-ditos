const { musicQueues } = require('../../data/state');
const { playNext } = require('../../utils/voiceManager');
const { generateMusicEmbed, getMusicButtons } = require('../../utils/uiHelpers');

module.exports = {
    name: 'skip',
    aliases: ['s'],
    description: 'Skip lagu yang lagi diputer',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || !queue.songs.length) {
            return message.reply('Skip apaan, gada yang disetel');
        }

        queue.player.stop();
        const embed = generateMusicEmbed(guildId);
        if (embed) {
            return message.channel.send({ embeds: [embed], components: [getMusicButtons(guildId)] });
        }
        return message.reply('Oke, skip');
    },
};
