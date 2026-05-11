const state = require('../../data/state');

module.exports = {
    name: 'rec',
    description: 'Ngecek Saved Memory',
    aliases: ['recall'],
    async execute(message, args, client) {
        const memory = state.memoryData;

        const scope = args[0]?.toLowerCase();
        const isGlobal = scope === 'global' || scope === 'g';

        const userId = isGlobal ? 'global' : message.author.id;
        const data = memory[userId];

        if (!data) {
            if (isGlobal) {
                return message.reply(
                    'Belum ada global memory yang di save. Coba pake `d!rem global <teks>` dulu.'
                );
            }
            return message.reply('Belum ada memory yang di save. Coba pake `d!remember/d!rem` dulu.');
        }

        let notes = [];
        if (Array.isArray(data.notes)) {
            notes = data.notes;
        } else if (data.note) {
            notes = [
                {
                    note: data.note,
                    updatedAt: data.updatedAt || new Date().toISOString(),
                },
            ];
        }

        if (!notes.length) {
            if (isGlobal) {
                return message.reply('Belum ada global memory yang di save.');
            }
            return message.reply('Belum ada memory yang di save.');
        }

        const lines = notes
            .map((n, idx) => {
                const date = new Date(n.updatedAt).toLocaleString('id-ID');
                return `**${idx + 1}.** ${n.note} (update: ${date})`;
            })
            .join('\n');

        if (isGlobal) {
            return message.reply(
                `Global memory yang gwe inget (berlaku buat semua user):\n${lines}`
            );
        }

        return message.reply(
            `Yang gwe inget tentang lu (${message.author.tag}):\n${lines}`);
    },
};
