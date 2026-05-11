const { channelHistory } = require('../../data/state');

module.exports = {
    name: 'clear',
    aliases: ['clr'],
    description: 'Hapus history chat (sama bot) di channel ini',
    async execute(message, args, client) {
        const channelId = message.channel.id;

        if (channelHistory.has(channelId)) {
            channelHistory.delete(channelId);
        }

        return message.reply(
            'Oke, jurus lupa ingatan.. done.'
        );
    },
};
