const { replyAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'serverinfo',
    aliases: ['si'],
    description: 'Info server',
    async execute(message, args, client) {
        try {
            const guild = message.guild;
            const formatDate = (date) => date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            const daysSinceCreation = Math.floor((Date.now() - guild.createdAt) / (1000 * 60 * 60 * 24));

            const bots = guild.members.cache.filter(m => m.user.bot).size;
            const humans = guild.memberCount - bots;
            const textChannels = guild.channels.cache.filter(c => c.type === 0).size;
            const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;

            const serverInfo = `
      **🏠 Server Info: ${guild.name}**
      **🆔 Server ID:** ${guild.id}
      **👑 Owner:** <@${guild.ownerId}>
      **📅 Dibuat:** ${formatDate(guild.createdAt)} (${daysSinceCreation} hari lalu)
      **👥 Members:** ${guild.memberCount} total (👤 ${humans} | 🤖 ${bots})
      **💬 Channels:** ${guild.channels.cache.size} total (📝 ${textChannels} | 🔊 ${voiceChannels})
      **🎭 Roles:** ${guild.roles.cache.size - 1}
      **✨ Boost:** Level ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)
          `.trim();

            if (guild.iconURL()) {
                await message.reply({
                    content: serverInfo,
                    files: [guild.iconURL({ dynamic: true, size: 512 })]
                });
            } else {
                await replyAndSave(message, serverInfo);
            }
        } catch (err) {
            console.error(err);
        }
    }
}
