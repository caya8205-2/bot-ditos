const state = require('../../data/state'); // Access state objects dynamically to avoid stale references
const { getLevelFromXP } = require('../../utils/helpers');

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

        return message.reply(
            `📊 **Trivia Score – ${user.username}**\n` +
            `XP: ${data.xp}\n` +
            `Level: ${level}\n` +
            `Jawaban benar: ${data.correct}`
        );
    },
};
