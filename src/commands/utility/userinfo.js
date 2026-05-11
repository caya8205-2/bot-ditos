const { replyAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'userinfo',
    aliases: ['ui'],
    description: 'Info user',
    async execute(message, args, client) {
        try {
            let targetUser = message.mentions.users.first() || message.author;
            let member = message.guild.members.cache.get(targetUser.id);

            if (!member) {
                return message.reply('User tidak ditemukan di server ini');
            }

            const joinedAt = member.joinedAt;
            const createdAt = targetUser.createdAt;
            const formatDate = (date) => date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const daysSinceJoin = Math.floor((Date.now() - joinedAt) / (1000 * 60 * 60 * 24));
            const daysSinceCreation = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
            const roles = member.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') || 'Tidak ada role';

            const statusEmoji = { online: '🟢 Online', idle: '🟡 Idle', dnd: '🔴 Do Not Disturb', offline: '⚫ Offline' };
            const status = statusEmoji[member.presence?.status] || '⚫ Offline';

            const infoText = `
      **👤 User Info: ${targetUser.tag}**
      **🆔 User ID:** ${targetUser.id}
      **📛 Server Nickname:** ${member.displayName}
      **📊 Status:** ${status}
      **📅 Akun Dibuat:** ${formatDate(createdAt)} (${daysSinceCreation} hari lalu)
      **📥 Join Server:** ${formatDate(joinedAt)} (${daysSinceJoin} hari lalu)
      **🎭 Roles (${member.roles.cache.size - 1}):** ${roles}
          `.trim();

            await replyAndSave(message, infoText);

            try {
                const avatarURL = targetUser.displayAvatarURL({ size: 256, dynamic: true });
                await message.channel.send({ embeds: [{ title: `Avatar ${targetUser.tag}`, image: { url: avatarURL } }] });
            } catch { }

        } catch (err) {
            console.error('Userinfo error:', err);
            return message.reply('Error pas ngambil info user nih');
        }
    }
}
