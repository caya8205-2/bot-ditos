const state = require('../data/state');
const { activeTrivia, triviaTimers, botActivityTracker, lastUserActivity } = state;
const { saveToChannelHistory, isTriviaCorrect, awardTriviaXP, getLevelFromXP, normalizeTrivia, saveTriviaScore, replyAndSave, reportErrorToDiscord } = require('../utils/helpers');
const { shouldBotReply, generateAutoReply } = require('../utils/autoChat');
const { getPrefix } = require('../utils/settingsManager');
const { OWNER_ID } = require('../config');
const { writeLog } = require('../utils/logger');
function isTriviaCorrectInner(answer, key) {
    return normalizeTrivia(answer) === normalizeTrivia(key);
}

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        const isBot = message.author.bot;
        const isAllowedBot = message.author.username === 'Bot Ditos' || message.author.username === 'Bot Tia';

        if (isBot && !isAllowedBot) {
            return;
        }

        if (message.content) {
            console.log(`[${new Date().toISOString()}] Message from ${message.author.username}: ${message.content}`);
        }

        if (message.author.id === client.user.id) return;

        if (!message.guild) return;

        const channelId = message.channel.id;
        lastUserActivity.set(channelId, Date.now());

        if (activeTrivia.has(channelId)) {
            const triviaData = activeTrivia.get(channelId);
            const userAnswer = message.content.trim().toLowerCase();
            // [CHANGED] Gunakan fuzzy checker
            const isCorrect = isTriviaCorrect(userAnswer, triviaData.answer);

            if (isCorrect) {
                const rewardXP = Math.floor(Math.random() * 8) + 5;
                const updated = awardTriviaXP(message.author.id, message.author.username, rewardXP);
                await saveTriviaScore(state.triviaScore);

                const level = getLevelFromXP(updated.xp);

                await message.channel.send(
                    `🏆 **${message.author.username} menjawab benar!**\n` +
                    `+${rewardXP} XP | Total XP: ${updated.xp} | Level: ${level}`
                );

                if (triviaTimers.has(channelId)) {
                    clearTimeout(triviaTimers.get(channelId).hint);
                    clearTimeout(triviaTimers.get(channelId).timeout);
                    triviaTimers.delete(channelId);
                }

                activeTrivia.delete(channelId);

                const timeTaken = ((Date.now() - triviaData.startTime) / 1000).toFixed(1);

                return replyAndSave(message,
                    `🎉 **BENAR!**\n` +
                    `Jawaban: **${triviaData.answer}**\n` +
                    `Waktu: ${timeTaken} detik\n\n` +
                    `GG ${message.author.tag}! 🔥`
                );
            }
        }

        if (!message.content.toLowerCase().startsWith('d!')) {
            if (!message.author.bot || isAllowedBot) {
                const role = message.author.bot ? 'assistant' : 'user';
                saveToChannelHistory(channelId, message.content, message.author.username, role);
            }
        }

        if (message.author.bot) return;

        const prefix = getPrefix(message.guild.id);
        if (message.content.toLowerCase().startsWith(prefix)) {
            const args = message.content.slice(prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            const command = client.commands.get(commandName) || client.commands.get(client.aliases.get(commandName));

            if (command) {
                try {
                    await command.execute(message, args, client, prefix);
                } catch (error) {
                    console.error(error);
                    reportErrorToDiscord(client, error);
                }
                return;
            } else {
                return message.reply('Salah command luwh, coba `d!help` buat liat list command gwej');
            }
        }

        if (shouldBotReply(message)) {
            await generateAutoReply(message);
        }
    },
};
