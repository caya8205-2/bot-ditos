const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    description: 'Cek latency bot',
    async execute(message, args, client) {
        const msg = await message.reply('Testing ping...');
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

        // Warna
        const color = (ms) => {
            if (ms === null || typeof ms !== 'number') return '⚪ N/A';
            if (ms <= 60) return `🟢 ${ms}ms`;
            if (ms <= 120) return `🟡 ${ms}ms`;
            return `🔴 ${ms}ms`;
        };

        msg.edit(
            `**Ping Test untuk ${message.author.tag}**\n\n` +

            `**Round-trip Latency:** ${color(messagePing)}\n` +
            `${bar(messagePing)}\n` +
            `└─ Waktu dari kamu kirim command sampai bot reply\n` +
            `   (Ini termasuk ping kamu + ping bot)\n\n` +

            `**Bot Connection:** ${color(botGatewayPing)}\n` +
            `${bar(botGatewayPing)}\n` +
            `└─ Ping bot ke Discord server\n\n` +

            `⚠️ **Note:** Bot gak bisa ngecek ping kamu langsung.\n` +
            `Round-trip latency di atas adalah estimasi terbaik.`
        );
    },
};
