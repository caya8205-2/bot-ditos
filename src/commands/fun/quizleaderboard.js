const { EmbedBuilder } = require('discord.js');
const state = require('../../data/state');
const { getLevelFromXP, replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'quizleaderboard',
    aliases: ['qlb'],
    description: 'Cek leaderboard trivia',
    async execute(message, args, client) {
        const entries = Object.values(state.triviaScore);

        if (entries.length === 0) {
            const emptyEmbed = new EmbedBuilder()
                .setTitle('🏆 Trivia Leaderboard')
                .setColor('#FFC107')
                .setDescription('Belum ada yang main trivia. Jawab trivia pertama pakai `d!trivia`!')
                .setTimestamp();
            return replyEmbedAndSave(message, { embeds: [emptyEmbed] });
        }

        const sorted = entries.sort((a, b) => b.xp - a.xp).slice(0, 10);

        const medals = ['🥇', '🥈', '🥉'];
        const text = sorted
            .map((u, i) => {
                const level = getLevelFromXP(u.xp);
                const rank = medals[i] || `**#${i + 1}**`;
                return `${rank} **${u.username}** — **${u.xp}** XP *(Lvl ${level})* | **${u.correct}** Benar`;
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('🏆 Trivia Leaderboard (Top 10)')
            .setColor('#FFD700')
            .setDescription(text)
            .setFooter({ text: 'Mainkan d!trivia untuk menaikkan skor!' })
            .setTimestamp();

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
