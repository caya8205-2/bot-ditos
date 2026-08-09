const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    description: 'Cek latency bot',
    async execute(message, args, client) {
        const msg = await message.reply('🏓 Testing ping...');
        const messagePing = msg.createdTimestamp - message.createdTimestamp;
        const botGatewayPing = client.ws.ping;

        const bar = (ms) => {
            if (ms === null || typeof ms !== 'number') return '──────────';
            const max = 300;
            const percent = Math.min(ms / max, 1);
            const filled = Math.round(percent * 10);
            const empty = 10 - filled;
            return '▇'.repeat(filled) + '▁'.repeat(empty);
        };

        const color = (ms) => {
            if (ms === null || typeof ms !== 'number') return '⚪ N/A';
            if (ms <= 60) return `🟢 ${ms}ms`;
            if (ms <= 120) return `🟡 ${ms}ms`;
            return `🔴 ${ms}ms`;
        };

        const embed = new EmbedBuilder()
            .setTitle(`🏓 Ping Test untuk ${message.author.username}`)
            .setColor(botGatewayPing <= 100 ? '#4CAF50' : '#FF9800')
            .addFields(
                {
                    name: '⏱️ Round-trip Latency',
                    value: `${color(messagePing)}\n\`${bar(messagePing)}\`\n*Latency command sampai bot reply*`,
                    inline: false
                },
                {
                    name: '🌐 Bot Connection (Gateway)',
                    value: `${color(botGatewayPing)}\n\`${bar(botGatewayPing)}\`\n*Ping bot ke Discord server*`,
                    inline: false
                }
            )
            .setFooter({ text: 'Estimasi latency real-time' })
            .setTimestamp();

        return msg.edit({ content: null, embeds: [embed] });
    },
};
