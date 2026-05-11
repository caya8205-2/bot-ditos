const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    name: 'leave',
    description: 'Leave vois',
    async execute(message, args, client) {
        const connection = getVoiceConnection(message.guild.id);
        if (!connection) {
            return message.reply('Gwa aja gada di vois');
        }

        connection.destroy();
        return message.reply('Nooo aku di kik :sob:');
    },
};
