const { replyAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'roll',
    description: 'Roll a Dice',
    aliases: ['dice'],
    async execute(message, args, client) {
        const token = args.join('').trim();
        if (!token) return message.reply('Cara pakai: d!roll NdM+K (contoh 2d6+3) atau d!roll d20 atau d!roll 6');

        // patterns: NdM +/-K or just M
        const diceMatch = token.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
        let rolls = [], total = 0, text = '';
        if (diceMatch) {
            const count = parseInt(diceMatch[1] || '1', 10);
            const sides = parseInt(diceMatch[2], 10);
            const modifier = diceMatch[3] ? parseInt(diceMatch[3], 10) : 0;
            if (count <= 0 || count > 50) return message.reply('Jumlah dice harus antara 1-50.');
            if (sides <= 1 || sides > 1000) return message.reply('Jumlah sisi dice valid antara 2-1000.');
            for (let i = 0; i < count; i++) {
                const r = Math.floor(Math.random() * sides) + 1;
                rolls.push(r);
                total += r;
            }
            total += modifier;
            text = `${token} → rolls: [${rolls.join(', ')}] ${modifier ? `modifier ${modifier}` : ''}\nTotal: **${total}**`;
            return message.reply(text);
        }

        // single number like "6" -> 1d6
        const m2 = token.match(/^(\d+)$/);
        if (m2) {
            const sides = parseInt(m2[1], 10);
            if (sides <= 1 || sides > 1000) return message.reply('Sisi dice valid antara 2-1000.');
            const r = Math.floor(Math.random() * sides) + 1;
            return replyAndSave(message, `🎲 1d${sides} → **${r}**`);
        }

        return replyAndSave(message, 'Format gak valid. Contoh: d!roll 2d6+3 atau d!roll d20 atau d!roll 6');
    },
};
