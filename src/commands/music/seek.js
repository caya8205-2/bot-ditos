const { musicQueues } = require('../../data/state');
const { seekAudio } = require('../../utils/voiceManager');

function parseTimestamp(str) {
    if (!str) return null;
    str = str.trim();
    if (/^\d+$/.test(str)) {
        return parseInt(str, 10);
    }
    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
}

module.exports = {
    name: 'seek',
    description: 'Lompat ke timestamp tertentu (contoh: d!seek 02:30 atau d!seek 150)',
    aliases: [],
    async execute(message, args, client) {
        const { guildId } = message;
        const queue = musicQueues.get(guildId);

        if (!queue || !queue.nowPlaying) {
            return message.reply('Gak ada lagu yang lagi diputar.');
        }

        const input = args[0];
        if (!input) {
            return message.reply('Kasih timestamp dong! Contoh: `d!seek 02:30` atau `d!seek 90`');
        }

        const targetSeconds = parseTimestamp(input);
        if (targetSeconds === null || targetSeconds < 0) {
            return message.reply('Format timestamp gak valid. Gunakan format detik (`90`) atau mm:ss (`01:30`).');
        }

        await message.reply(`⏩ Lompat ke posisi \`${Math.floor(targetSeconds / 60)}:${String(targetSeconds % 60).padStart(2, '0')}\`...`);
        await seekAudio(guildId, targetSeconds);
    },
};
