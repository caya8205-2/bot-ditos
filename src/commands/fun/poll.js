const { saveToChannelHistory } = require('../../utils/helpers');

module.exports = {
    name: 'poll',
    description: 'Buat poll sederhana di channel',
    aliases: ['vote'],
    async execute(message, args, client, prefix) {
        const contentWithoutPrefix = message.content.slice(prefix.length).trim();
        const afterCommand = contentWithoutPrefix.replace(/^[^\s]+\s*/, '').trim();

        if (!afterCommand) return message.reply('Contoh pakai: d!poll 1m; Enaknya ngapain?; Tidur; Ngoding; Main game');

        const parts = afterCommand.split(';').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return message.reply('Kasih pertanyaan dong.');

        let durationMs = 0;
        // optional duration in first segment if matches like 30s, 5m, 1h, 1d
        const durMatch = parts[0].match(/^(\d+)\s*(s|m|h|d)$/i);
        let questionIndex = 0;
        if (durMatch && parts.length > 1) {
            const n = parseInt(durMatch[1], 10);
            const unit = durMatch[2].toLowerCase();
            switch (unit) {
                case 's': durationMs = n * 1000; break;
                case 'm': durationMs = n * 60 * 1000; break;
                case 'h': durationMs = n * 60 * 60 * 1000; break;
                case 'd': durationMs = n * 24 * 60 * 60 * 1000; break;
            }
            questionIndex = 1;
        }

        const question = parts[questionIndex];
        const options = parts.slice(questionIndex + 1);

        if (!options.length) {
            // quick yes/no poll
            const pollContent = `📊 **Poll:** ${question}\nReact to vote: 👍 / 👎`;
            const msg = await message.channel.send(pollContent);
            await msg.react('👍');
            await msg.react('👎');

            saveToChannelHistory(message.channel.id, pollContent);

            if (durationMs > 0) {
                setTimeout(async () => {
                    try {
                        const fresh = await msg.fetch();
                        const yes = fresh.reactions.cache.get('👍')?.count ?? 0;
                        const no = fresh.reactions.cache.get('👎')?.count ?? 0;
                        const resultMsg = `📣 Poll ended: **${question}**\n👍: ${Math.max(0, yes - 1)}  👎: ${Math.max(0, no - 1)}`;
                        await message.channel.send(resultMsg);

                        saveToChannelHistory(message.channel.id, resultMsg);
                    } catch (e) { console.error('Poll end error:', e); }
                }, durationMs);
            }
            return;
        }

        if (options.length > 10) {
            return message.reply('Maks 10 opsi aja ya.');
        }

        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        let body = `📊 **Poll:** ${question}\n\n`;
        options.forEach((o, i) => body += `${numberEmojis[i]} ${o}\n`);
        if (durationMs > 0) body += `\n⏱ Poll akan berakhir dalam ${durationMs / 1000}s`;

        const pollMsg = await message.channel.send(body);

        saveToChannelHistory(message.channel.id, body);

        for (let i = 0; i < options.length; i++) {
            await pollMsg.react(numberEmojis[i]);
        }

        if (durationMs > 0) {
            setTimeout(async () => {
                try {
                    const fresh = await pollMsg.fetch();
                    const counts = options.map((_, i) => {
                        const emoji = numberEmojis[i];
                        const c = fresh.reactions.cache.get(emoji)?.count ?? 0;
                        return Math.max(0, c - 1);
                    });
                    const max = Math.max(...counts);
                    const winners = counts
                        .map((c, idx) => (c === max ? `${idx + 1}. ${options[idx]} (${c})` : null))
                        .filter(Boolean);
                    const resultText = winners.length ? winners.join('\n') : 'No votes cast.';
                    const finalResult = `📣 Poll ended: **${question}**\n\nWinner(s):\n${resultText}`;
                    await message.channel.send(finalResult);

                    saveToChannelHistory(message.channel.id, finalResult);
                } catch (e) {
                    console.error('Poll finalize error:', e);
                }
            }, durationMs);
        }
    },
};
