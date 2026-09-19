const { musicQueues } = require('../../data/state');
const { generateMusicEmbed, getMusicButtons } = require('../../utils/uiHelpers');

module.exports = {
    name: 'stop',
    aliases: ['leave', 'dc', 'disconnect'],
    description: 'Stop musik & disconnect bot',
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue) {
            return message.reply('Stop apaan, gada yang disetel');
        }

        queue.songs = [];
        queue.nowPlaying = null;
        queue.stopOnIdle = true;
        queue.player.stop();

        const embed = generateMusicEmbed(guildId);
        if (embed) {
            return message.channel.send({
                content: '⏹ Musik distop, antrian dihapus. (Bot stay di voice)',
                embeds: [embed],
                components: getMusicButtons(guildId),
            });
        }
        return message.reply('⏹ Musik distop, antrian dihapus. (Bot stay di voice)');
    },
};
