const { joinVoiceChannel } = require('@discordjs/voice');
const { playLocalSound } = require('../../utils/voiceManager');
const { generateMusicEmbed, getMusicButtons } = require('../../utils/uiHelpers');
const { OWNER_ID } = require('../../config');

module.exports = {
    name: 'join',
    description: 'Suruh bot masuk voice channel',
    async execute(message, args, client) {
        const { voice } = message.member;

        if (!voice.channel) {
            return message.reply('Minimal kalo mau command ini lu di vois dulu bos');
        }

        try {
            joinVoiceChannel({
                channelId: voice.channel.id,
                guildId: voice.channel.guild.id,
                adapterCreator: voice.channel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });

            console.log('Joined voice:', voice.channel.name);

            // Auto soundboard tengkorak
            await playLocalSound(voice.channel, 'tengkorak', message.channel);

            const embed = generateMusicEmbed(message.guild.id);
            if (embed) {
                return message.channel.send({
                    embeds: [embed],
                    components: [getMusicButtons(message.guild.id)]
                });
            }

            return message.reply(`mana nih..? **${voice.channel.name}**`);
        } catch (err) {
            console.error(err);
            return message.reply(`Seseorang bilangin <@${OWNER_ID}> kalo bot nya error`);
        }
    },
};
