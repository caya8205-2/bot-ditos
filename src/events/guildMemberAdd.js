const { MAIN_GUILD_ID, WELCOME_CHANNEL_ID } = require('../config');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        if (member.guild.id !== MAIN_GUILD_ID) return;

        const channel =
            member.guild.channels.cache.get(WELCOME_CHANNEL_ID) ||
            member.guild.systemChannel;

        if (!channel || !channel.isTextBased()) {
            console.log('Welcome: channel welcome gak ketemu / bukan text channel');
            return;
        }

        const me = member.guild.members.me;
        if (!channel.permissionsFor(me)?.has('SendMessages')) {
            console.log('Welcome: bot gak punya permission buat kirim pesan di channel welcome');
            return;
        }

        const avatarURL = member.user.displayAvatarURL({
            size: 256,
            dynamic: true,
        });

        const embed = new EmbedBuilder()
            .setTitle('👋 Selamat Datang!')
            .setDescription(
                `Halo ${member}!\n` +
                `Selamat datang di **${member.guild.name}**.\n` +
                `Coba \`d!help\` buat liat list command yang gwe punya.`
            )
            .setColor(0x57f287) // hijau soft
            .setThumbnail(avatarURL)
            .addFields(
                {
                    name: 'Akun',
                    value: `${member.user.tag}`,
                    inline: true,
                },
                {
                    name: 'User ID',
                    value: member.id,
                    inline: true,
                },
                {
                    name: 'Member ke-',
                    value: `${member.guild.memberCount}`,
                    inline: true,
                },
            )
            .setTimestamp()
            .setFooter({
                text: 'Welcome to the server 🌟',
            });

        try {
            await channel.send({ embeds: [embed] });
            console.log('Welcome embed terkirim untuk', member.user.tag);
        } catch (err) {
            console.error('Welcome error:', err);
        }
    },
};
