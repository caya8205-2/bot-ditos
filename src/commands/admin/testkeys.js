const { EmbedBuilder } = require('discord.js');
const { getKeyStatus } = require('../../utils/groqManager');
const { replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'testkeys',
    description: 'Cek status Groq API Keys',
    aliases: ['keystat'],
    async execute(message, args, client) {
        const now = Date.now();
        const { keyStats, GROQ_KEYS, currentGroqKeyIndex } = getKeyStatus();

        const keyFields = keyStats.map(s => {
            const cooldownLeft = s.cooldownUntil
                ? Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000))
                : 0;

            const status = cooldownLeft > 0
                ? `🔴 Cooldown (${cooldownLeft}s left)`
                : '🟢 Available';

            const resetTime = s.cooldownUntil && cooldownLeft > 0
                ? `\nResets: <t:${Math.floor(s.cooldownUntil / 1000)}:R>`
                : '';

            return {
                name: `Key ${s.index} ${s.index === currentGroqKeyIndex ? '⭐ (Active)' : ''}`,
                value:
                    `${status}\n` +
                    `Failures: ${s.failures}x` +
                    resetTime,
                inline: true
            };
        });

        const availableCount = keyStats.filter(s =>
            !s.cooldownUntil || now >= s.cooldownUntil
        ).length;

        let embedColor;
        if (availableCount === GROQ_KEYS.length) {
            embedColor = '#00FF00';
        } else if (availableCount > 0) {
            embedColor = '#FFA500';
        } else {
            embedColor = '#FF0000';
        }

        let footerText = `Total Keys: ${GROQ_KEYS.length} | Available: ${availableCount}`;

        if (availableCount === 0) {
            const nextReset = keyStats
                .filter(s => s.cooldownUntil)
                .sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];

            if (nextReset) {
                const timeLeft = Math.ceil((nextReset.cooldownUntil - now) / 1000);
                footerText += ` | Reset selanjutnya tersedia dalam ${timeLeft}s`;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('🔑 Groq API Keys Status')
            .setColor(embedColor)
            .setDescription(
                availableCount === GROQ_KEYS.length
                    ? '✅ Semua API Keys tersedia dan siap digunakan!'
                    : availableCount > 0
                        ? `⚠️ ${GROQ_KEYS.length - availableCount} key(s) sedang cooldown`
                        : '🚨 Semua API Keys sedang cooldown!'
            )
            .addFields(...keyFields)
            .setFooter({ text: footerText })
            .setTimestamp();

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
