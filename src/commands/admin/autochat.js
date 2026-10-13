const { AUTO_CHAT_CONFIG } = require('../../utils/autoChat');
const { OWNER_ID } = require('../../config');

module.exports = {
    name: 'autochat',
    description: 'Konfigurasi Auto-Chat',
    aliases: ['ac'],
    async execute(message, args, client) {
        const action = args[0]?.toLowerCase();
        const subAction = args[1]?.toLowerCase();

        if (!action || action === 'status') {
            const status = AUTO_CHAT_CONFIG.enabled ? '🟢 **ON**' : '🔴 **OFF**';
            const idleStatus = AUTO_CHAT_CONFIG.idleChat.enabled ? '✅ Enabled' : '❌ Disabled';

            return message.reply(
                `**🤖 Auto-Chat Status**\n\n` +
                `Status: ${status}\n` +
                `Reply Chance: ${AUTO_CHAT_CONFIG.replyChance}%\n` +
                `Min Messages Between: ${AUTO_CHAT_CONFIG.minMessagesBetweenReplies}\n` +
                `Cooldown: ${AUTO_CHAT_CONFIG.replyCooldown / 1000 / 60} menit\n` +
                `Idle Chat: ${idleStatus}\n\n` +
                `Commands:\n` +
                `\`d!autochat on\` - Enable auto-chat\n` +
                `\`d!autochat off\` - Disable auto-chat\n` +
                `\`d!autochat idle [on|off]\` - Toggle idle chat saat sepi\n` +
                `\`d!autochat config\` - Show detailed config`
            );
        }

        if (message.author.id !== OWNER_ID) {
            return message.reply('Cuma owner yang bisa ubah setting auto-chat');
        }

        if (action === 'on') {
            AUTO_CHAT_CONFIG.enabled = true;
            return message.reply('✅ Auto-chat **diaktifkan**. Bot sekarang bisa nimbrung obrolan!');
        }

        if (action === 'off') {
            AUTO_CHAT_CONFIG.enabled = false;
            return message.reply('🔴 Auto-chat **dimatikan**. Bot bakal diem aja kecuali dipanggil.');
        }

        if (action === 'idle') {
            if (subAction === 'on') {
                AUTO_CHAT_CONFIG.idleChat.enabled = true;
                return message.reply('✅ Idle-chat **diaktifkan**. Bot bakal nyentil kalau channel sepi!');
            } else if (subAction === 'off') {
                AUTO_CHAT_CONFIG.idleChat.enabled = false;
                return message.reply('🔴 Idle-chat **dimatikan**.');
            } else {
                AUTO_CHAT_CONFIG.idleChat.enabled = !AUTO_CHAT_CONFIG.idleChat.enabled;
                const status = AUTO_CHAT_CONFIG.idleChat.enabled ? 'diaktifkan' : 'dimatikan';
                return message.reply(`ℹ️ Idle-chat sekarang **${status}**.`);
            }
        }

        if (action === 'config') {
            return message.reply(
                `**⚙️ Auto-Chat Configuration**\n\n` +
                `\`\`\`json\n${JSON.stringify(AUTO_CHAT_CONFIG, null, 2)}\n\`\`\``
            );
        }

        return message.reply('Usage: `d!autochat [on|off|idle [on|off]|status|config]`');
    },
};
