'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { OWNER_ID } = require('../../config');
const spotifyResolver = require('../../utils/spotifyResolver');

module.exports = {
    name: 'spotauth',
    aliases: ['spotifyauth', 'spotstat', 'spotstatus'],
    description: 'Cek status atau inisialisasi otorisasi Spotify Premium (spotstream)',
    async execute(message, args) {
        if (message.author.id !== OWNER_ID && !message.member?.permissions.has('Administrator')) {
            return message.reply('Cuma owner atau admin yang bisa atur otorisasi Spotify.');
        }

        const sub = (args[0] || '').toLowerCase();

        // Check status
        if (sub === 'status' || message.content.includes('stat')) {
            const isReady = await spotifyResolver.isSpotstreamReady();
            const embed = new EmbedBuilder()
                .setTitle('🟢 Status Spotstream (Spotify Direct)')
                .setColor(isReady ? '#1DB954' : '#E74C3C')
                .addFields(
                    { name: 'Status', value: isReady ? '✅ Terautentikasi & Siap Stream (320kbps)' : '❌ Belum Terautentikasi', inline: true },
                    { name: 'Binary', value: `\`${spotifyResolver.getSpotstreamBinary()}\``, inline: false }
                )
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        try {
            await message.reply('⏳ Menghubungi Spotify untuk meminta kode pairing...');
            const authData = await spotifyResolver.requestDevicePairing();

            const pairUrl = authData.verification_uri_complete ||
                `${authData.verification_uri}?code=${authData.user_code}`;

            const embed = new EmbedBuilder()
                .setTitle('🔐 Otorisasi Spotify Premium (RFC 8628)')
                .setColor('#1DB954')
                .setDescription(
                    `Buka link di bawah ini, login dengan akun Spotify Premium kamu, lalu klik **Setuju / Approve**.\n\n` +
                    `🔑 **Kode:** \`${authData.user_code}\`\n` +
                    `🔗 **URL:** [${pairUrl}](${pairUrl})`
                )
                .setFooter({ text: `Kode kedaluwarsa dalam ${Math.round(authData.expires_in / 60)} menit` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Buka Halaman Pairing')
                    .setStyle(ButtonStyle.Link)
                    .setURL(pairUrl)
            );

            const promptMsg = await message.channel.send({ embeds: [embed], components: [row] });

            // Background poll
            spotifyResolver.pollDevicePairing(authData.device_code, authData.expires_in, authData.interval)
                .then((success) => {
                    if (success) {
                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ Spotify Premium Terhubung!')
                            .setColor('#1DB954')
                            .setDescription('Sesi Spotify berhasil disimpan. Semua link Spotify sekarang akan di-stream langsung secara instan (320kbps).')
                            .setTimestamp();
                        promptMsg.reply({ embeds: [successEmbed] }).catch(() => {});
                    }
                })
                .catch((err) => {
                    promptMsg.reply(`⚠️ Otorisasi Spotify gagal atau kedaluwarsa: ${err.message}`).catch(() => {});
                });

        } catch (err) {
            console.error('[spotauth] Error:', err);
            return message.reply(`Gagal memulai pairing Spotify: ${err.message}`);
        }
    },
};
