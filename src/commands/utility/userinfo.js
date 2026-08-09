const { EmbedBuilder } = require('discord.js');
const { replyEmbedAndSave } = require('../../utils/helpers');

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

            const avatarURL = targetUser.displayAvatarURL({ size: 512, dynamic: true });

            const embed = new EmbedBuilder()
                .setTitle(`👤 User Info: ${targetUser.tag}`)
                .setColor('#9B59B6')
                .setThumbnail(avatarURL)
                .addFields(
                    { name: '🆔 User ID', value: `\`${targetUser.id}\``, inline: true },
                    { name: '📛 Nickname', value: member.displayName, inline: true },
                    { name: '📊 Status', value: status, inline: true },
                    { name: '📅 Akun Dibuat', value: `${formatDate(createdAt)}\n*(${daysSinceCreation} hari lalu)*`, inline: true },
                    { name: '📥 Join Server', value: `${formatDate(joinedAt)}\n*(${daysSinceJoin} hari lalu)*`, inline: true },
                    { name: `🎭 Roles (${member.roles.cache.size - 1})`, value: roles.length > 500 ? roles.substring(0, 500) + '...' : roles, inline: false }
                )
                .setTimestamp();

            return replyEmbedAndSave(message, { embeds: [embed] });

        } catch (err) {
            console.error('Userinfo error:', err);
            return message.reply('Error pas ngambil info user nih');
        }
    }
};
