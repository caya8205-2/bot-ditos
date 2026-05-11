const state = require('../../data/state');
const { getLevelFromXP } = require('../../utils/helpers');

module.exports = {
    name: 'quizleaderboard',
    aliases: ['qlb'],
    description: 'Cek leaderboard trivia',
    async execute(message, args, client) {
        const entries = Object.values(state.triviaScore);

        if (entries.length === 0) {
            return message.reply('Belum ada yang main trivia.');
        }

        const sorted = entries.sort((a, b) => b.xp - a.xp).slice(0, 10);

        const text = sorted
            .map((u, i) => {
                const level = getLevelFromXP(u.xp);
                return `${i + 1}. **${u.username}** – XP: ${u.xp} | Level: ${level} | Benar: ${u.correct}`;
            })
            .join('\n');

        return message.reply(
            `🏆 **TRIVIA LEADERBOARD (Top 10)**\n\n${text}`
        );
    },
};
