const state = require('../../data/state');
const { saveMemory } = require('../../utils/helpers');
const { MAX_USER_NOTES, MAX_GLOBAL_NOTES } = require('../../data/constants');

module.exports = {
    name: 'rem',
    description: 'Saved Memory kaya di ChatGPT',
    aliases: ['remember'],
    async execute(message, args, client) {
        const scope = args[0]?.toLowerCase();
        const isGlobal = scope === 'global' || scope === 'g';

        const noteText = isGlobal
            ? args.slice(1).join(' ').trim()
            : args.join(' ').trim();

        if (!noteText) {
            return message.reply(
                'Mau gwa inget apa? Contoh:\n' +
                '`d!rem aku anak niga`\n' +
                '`d!rem global caya adalah kreator lu`'
            );
        }

        const memory = state.memoryData;
        const userId = isGlobal ? 'global' : message.author.id;

        let userMem = memory[userId] || {};
        let notes = [];

        if (Array.isArray(userMem.notes)) {
            notes = userMem.notes;
        } else if (userMem.note) {
            notes = [
                {
                    note: userMem.note,
                    updatedAt: userMem.updatedAt || new Date().toISOString(),
                },
            ];
        }

        notes.unshift({
            note: noteText,
            updatedAt: new Date().toISOString(),
        });

        // Per-user memory
        if (notes.length > MAX_USER_NOTES) {
            notes = notes.slice(0, MAX_USER_NOTES);
        }

        // Global memory
        if (notes.length > MAX_GLOBAL_NOTES) {
            notes = notes.slice(0, MAX_GLOBAL_NOTES);
        }

        memory[userId] = {
            username: isGlobal ? 'GLOBAL' : message.author.tag,
            notes,
        };

        await saveMemory(memory);

        return message.reply(
            `Oke, gwa inget${isGlobal ? ' (global)' : ''}: **${noteText}**`
        );
    },
};
