const { EmbedBuilder } = require('discord.js');
const { replyEmbedAndSave } = require('../../utils/helpers');

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

            const embed = new EmbedBuilder()
                .setTitle(`🏠 Server Info: ${guild.name}`)
                .setColor('#5865F2')
                .addFields(
                    { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
                    { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
                    { name: '📅 Dibuat', value: `${formatDate(guild.createdAt)}\n*(${daysSinceCreation} hari lalu)*`, inline: true },
                    { name: `👥 Members (${guild.memberCount})`, value: `👤 Human: ${humans}\n🤖 Bot: ${bots}`, inline: true },
                    { name: `💬 Channels (${guild.channels.cache.size})`, value: `📝 Text: ${textChannels}\n🔊 Voice: ${voiceChannels}`, inline: true },
                    { name: '✨ Boost Level', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true }
                )
                .setFooter({ text: `Total Roles: ${guild.roles.cache.size - 1}` })
                .setTimestamp();

            if (guild.iconURL()) {
                embed.setThumbnail(guild.iconURL({ dynamic: true, size: 512 }));
            }

            return replyEmbedAndSave(message, { embeds: [embed] });
        } catch (err) {
            console.error('Serverinfo error:', err);
            return message.reply('Gagal mengambil info server.');
        }
    }
};
