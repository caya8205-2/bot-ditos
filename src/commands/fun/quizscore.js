const { EmbedBuilder } = require('discord.js');
const state = require('../../data/state');
const { getLevelFromXP, replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'quizscore',
    aliases: ['qscore'],
    description: 'Cek skor trivia',
    async execute(message, args, client) {
        const user = message.mentions.users.first() || message.author;
        const data = state.triviaScore[user.id];

        if (!data) {
            return message.reply(`${user.username} belum punya score trivia.`);
        }

        const level = getLevelFromXP(data.xp);
        const avatarURL = user.displayAvatarURL({ size: 256, dynamic: true });

        const embed = new EmbedBuilder()
            .setTitle(`📊 Trivia Score: ${user.username}`)
            .setColor('#4CAF50')
            .setThumbnail(avatarURL)
            .addFields(
                { name: '✨ Total XP', value: `\`${data.xp}\` XP`, inline: true },
                { name: '⭐ Level', value: `Level \`${level}\``, inline: true },
                { name: '✅ Jawaban Benar', value: `\`${data.correct}\` Soal`, inline: true }
            )
            .setFooter({ text: 'Jawab trivia untuk menambah XP & Level!' })
            .setTimestamp();

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
