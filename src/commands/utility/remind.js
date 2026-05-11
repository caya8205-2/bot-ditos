const { loadReminders, saveReminders, parseDuration } = require('../../utils/reminderManager');
const { replyAndSave } = require('../../utils/helpers');

const MAX_DELAY = 2147483647;

module.exports = {
    name: 'remind',
    description: 'Setel pengingat sederhana (contoh: d!remind 10m minum obat)',
    aliases: ['remi'],
    async execute(message, args, client, prefix) {
        const userId = message.author.id;
        const action = args[0]?.toLowerCase();

        if (action === 'list' || action === 'ls') {
            const data = await loadReminders();
            const list = (data[userId] || []);
            if (!list.length) return message.reply('Lu ga punya reminder aktif.');
            const lines = list.map(r => `• [${r.text}] in ${Math.max(0, Math.ceil((r.remindAt - Date.now()) / 1000))}s`).join('\n');
            return message.reply(`Reminders List:\n${lines}\n\nId:\n${list.map(r => `• ${r.id} → ${r.text}`).join('\n')}`);
        }

        if (action === 'cancel' || action === 'del' || action === 'rm') {
            const id = args[1];
            if (!id) return message.reply('Cara pakai: d!remind cancel <id>');
            const data = await loadReminders();
            let list = data[userId] || [];
            const idx = list.findIndex(i => i.id === id);
            if (idx === -1) return message.reply('Gak nemu reminder dengan id itu.');
            const removed = list.splice(idx, 1)[0];
            if (list.length) data[userId] = list; else delete data[userId];
            await saveReminders(data);
            return message.reply(`Reminder dibatalkan: ${removed.text}`);
        }

        let timeToken = args[0];
        let textParts = args.slice(1);

        if (timeToken === 'in') {
            timeToken = args[1];
            textParts = args.slice(2);
        }

        const contentWithoutPrefix = message.content.slice(prefix.length).trim();
        const joined = contentWithoutPrefix.replace(/^[^\s]+\s*/, '').trim();
        if (joined.includes(';')) {
            const parts = joined.split(';').map(p => p.trim());
            if (parts.length >= 2) {
                timeToken = parts[0].split(/\s+/)[0];
                textParts = [parts.slice(1).join('; ')];
            }
        }

        if (!timeToken || !textParts.length) {
            return message.reply('Cara pakai: `d!remind 10m Hentikan kerja` atau `d!remind in 2h ; meeting` atau `d!remind list` `d!remind cancel <id>`');
        }

        const ms = parseDuration(timeToken);
        if (!ms) return message.reply('Format waktu gak valid. Contoh: 10s 5m 2h 1d');

        if (ms <= 0) return message.reply('Waktu harus lebih besar dari 0.');
        if (ms > MAX_DELAY) return message.reply('Durasi terlalu panjang (max ~24 hari).');

        const reminderText = textParts.join(' ').trim();
        if (!reminderText) return message.reply('Kasih pesan yang mau diingat juga.');

        const data = await loadReminders();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const remindAt = Date.now() + ms;
        const entry = {
            id,
            userId,
            channelId: message.channel.id,
            text: reminderText,
            remindAt,
            createdAt: Date.now(),
        };

        data[userId] = data[userId] || [];
        data[userId].push(entry);
        await saveReminders(data);

        setTimeout(async () => {
            try {
                const ch = await client.channels.fetch(entry.channelId).catch(() => null);
                const out = `<@${entry.userId}> Reminder: ${entry.text}`;
                if (ch && ch.isTextBased() && ch.send) {
                    ch.send(out).catch(() => null);
                } else {
                    (await client.users.fetch(entry.userId)).send(out).catch(() => null);
                }

                const loaded = await loadReminders();
                const arr = loaded[entry.userId] || [];
                const idx = arr.findIndex(r => r.id === entry.id);
                if (idx !== -1) {
                    arr.splice(idx, 1);
                    if (arr.length) loaded[entry.userId] = arr; else delete loaded[entry.userId];
                    await saveReminders(loaded);
                }
            } catch (e) {
                console.error('Reminder send error:', e);
            }
        }, ms);

        return replyAndSave(message, `Oke, gue bakal ingetin luwh dalam ${timeToken} tentang: **${reminderText}**`);
    },
};
