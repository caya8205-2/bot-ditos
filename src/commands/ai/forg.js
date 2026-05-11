const state = require('../../data/state');
const { saveMemory } = require('../../utils/helpers');

module.exports = {
    name: 'forg',
    description: 'Menghapus Saved Memory, bisa hapus all atau berdasarkan nomor',
    aliases: ['forget'],
    async execute(message, args, client) {
        const memory = state.memoryData;
        const scope = args[0]?.toLowerCase();
        const isGlobal = scope === 'global' || scope === 'g';

        if (isGlobal) {
            const data = memory.global;

            if (!data) {
                return message.reply('Gwe gak punya global memory apa-apa, jadi gak ada yang bisa dihapus.');
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

            const arg = args[1]?.toLowerCase();

            if (arg === 'all') {
                delete memory.global;
                await saveMemory(memory);
                return message.reply('Semua global memory udah gwe hapus. 🧹');
            }

            const index = parseInt(arg, 10);

            if (!index || index < 1 || index > notes.length) {
                return message.reply(
                    `Pilih global memory nomor berapa yang mau dihapus (1-${notes.length}), atau pake:\n` +
                    '`d!forg global all` buat hapus semua global memory.'
                );
            }

            const removed = notes.splice(index - 1, 1)[0];

            if (notes.length === 0) {
                delete memory.global;
            } else {
                memory.global = {
                    username: 'GLOBAL',
                    notes,
                };
            }

            await saveMemory(memory);

            return message.reply(
                `Oke, global memory nomor ${index} udah gwe hapus:\n> ${removed.note}`
            );
        }

        // MODE USER
        const userId = message.author.id;
        const data = memory[userId];

        if (!data) {
            return message.reply('Gwe gak inget apa-apa tentang lu, jadi gak ada yang bisa dihapus.');
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

        const arg = args[0]?.toLowerCase();

        if (arg === 'all') {
            delete memory[userId];
            await saveMemory(memory);
            return message.reply('Semua memory tentang lu udah gue hapus. 🧹');
        }

        const index = parseInt(arg, 10);

        if (!index || index < 1 || index > notes.length) {
            return message.reply(
                `Pilih memory nomor berapa yang mau dihapus (1-${notes.length}), atau pake:\n` +
                '`d!forget all` buat hapus semuanya.'
            );
        }

        const removed = notes.splice(index - 1, 1)[0];

        if (notes.length === 0) {
            delete memory[userId];
        } else {
            memory[userId] = {
                username: data.username,
                notes,
            };
        }

        await saveMemory(memory);

        return message.reply(
            `Oke, memory nomor ${index} udah gwe hapus:\n> ${removed.note}`);
    },
};
