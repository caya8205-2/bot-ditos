const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { COMMAND_LIST } = require('../../data/constants');
const { replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'help',
    description: 'Menampilkan semua command',
    async execute(message, args, client) {
        const prefix = "d!";

        const parsed = Object.entries(COMMAND_LIST).map(([raw, desc]) => {
            const aliases = raw
                .split(/\/|, ?/)       // "play/p" → ["play","p"]
                .map(a => a.trim());
            return { aliases, desc };
        });

        const header =
            `**Ditos Help Menu**\n` +
            `Version   : 2.0\n` +
            `Prefix    : ${prefix}\n` +
            `Developer : Caya8205 & AI\n\n`;

        const footerText =
            `Tip:\n` +
            `• Semua command pakai prefix \`${prefix}\`\n` +
            `• \`${prefix}help\` selalu update otomatis\n` +
            `• Untuk tag user, pakai format: \`tag: <nama>\``;

        const commandLines = parsed.map(obj => {
            const aliasJoined = obj.aliases
                .map(a => `**${prefix}${a}**`)
                .join(", ");
            return `${aliasJoined} — ${obj.desc}`;
        });

        const PAGE_SIZE = 16;
        const pages = [];

        for (let i = 0; i < commandLines.length; i += PAGE_SIZE) {
            pages.push(commandLines.slice(i, i + PAGE_SIZE));
        }

        let pageIndex = 0;

        const makeEmbed = (i) => {
            return new EmbedBuilder()
                .setColor("#1DB954")
                .setDescription(
                    header +
                    pages[i].join("\n")
                )
                .setFooter({
                    text: `Halaman ${i + 1} dari ${pages.length} • ${footerText}`
                });
        };

        const makeRow = (i) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("help_prev")
                    .setStyle(ButtonStyle.Secondary)
                    .setLabel("⬅ Kembali")
                    .setDisabled(i === 0),

                new ButtonBuilder()
                    .setCustomId("help_home")
                    .setStyle(ButtonStyle.Primary)
                    .setLabel("⬆ Balik"),

                new ButtonBuilder()
                    .setCustomId("help_next")
                    .setStyle(ButtonStyle.Secondary)
                    .setLabel("Lanjut ➡")
                    .setDisabled(i === pages.length - 1)
            );
        };

        const msg = await replyEmbedAndSave(message, {
            embeds: [makeEmbed(pageIndex)],
            components: [makeRow(pageIndex)]
        });

        const collector = msg.createMessageComponentCollector({
            time: 300_000
        });

        collector.on("collect", async (btn) => {
            switch (btn.customId) {
                case "help_prev":
                    pageIndex--;
                    break;
                case "help_next":
                    pageIndex++;
                    break;
                case "help_home":
                    pageIndex = 0;
                    break;
            }

            await btn.update({
                embeds: [makeEmbed(pageIndex)],
                components: [makeRow(pageIndex)]
            });
        });

        return;
    }
}
