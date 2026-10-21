'use strict';

/**
 * d!model - ganti model/provider LLM tanpa restart bot.
 *
 * Alurnya: pilih provider dulu (kalau lebih dari satu), lalu pilih model dari
 * katalog provider itu. Model yang sedang dipakai ditandai "current".
 *
 * Perubahan hanya berlaku di runtime. Untuk menyimpannya ke config.yaml,
 * pakai tombol Simpan, atau d!model set <nama>.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    PermissionFlagsBits,
} = require('discord.js');

const botConfig = require('../../utils/botConfig');
const catalog = require('../../utils/modelCatalog');

const MODELS_PER_PAGE = 25;

// Sesi selector aktif per pesan, supaya tidak bocor antar pemakaian.
const sessions = new Map();

/**
 * Hanya pemegang izin Manage Server yang boleh mengganti model.
 */
function canManage(interaction) {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function truncate(text, max) {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildProviderEmbed(providers, activeProvider) {
    const lines = providers.map((p) => {
        const current = p.name === activeProvider ? ' ← aktif' : '';
        const key = botConfig.resolveProviderKey(p);
        const keyState = key ? '🔑' : '⚠️ key kosong';
        return `**${p.name}**${current}\n└ \`${p.base_url}\` · ${keyState}`;
    });

    return new EmbedBuilder()
        .setTitle('⚙ Model Configuration')
        .setDescription(
            'Pilih provider yang mau dipakai.\n\n' +
            (lines.length ? lines.join('\n\n') : 'Belum ada provider di config.yaml.')
        )
        .setFooter({ text: 'Hanya yang punya izin Manage Server yang bisa mengubah' })
        .setColor(0x5865f2);
}

function buildModelEmbed({ providerName, models, page, activeModel, total }) {
    const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
    return new EmbedBuilder()
        .setTitle('⚙ Model Configuration')
        .setDescription(
            `**Provider:** \`${providerName}\`\n` +
            `**Model aktif:** \`${activeModel || 'belum diset'}\`\n\n` +
            `Pilih model dari daftar di bawah. ` +
            `(${models.length} model, halaman ${page + 1}/${totalPages})`
        )
        .setFooter({
            text: total > models.length
                ? `Menampilkan ${models.length} dari ${total} model · pakai tombol navigasi`
                : `${models.length} model tersedia`,
        })
        .setColor(0x5865f2);
}

/**
 * Ambil daftar model dari katalog provider, urutkan: yang vision-capable
 * lebih dulu (berguna untuk chat dengan gambar), lalu alfabetis.
 */
async function fetchProviderModels(providerName) {
    const provider = botConfig.getProviderByName(providerName);
    if (!provider) return { models: [], total: 0 };

    const byId = await catalog.loadCatalog({
        baseURL: provider.base_url,
        apiKey: botConfig.resolveProviderKey(provider),
        label: provider.name,
    });

    if (!byId) return { models: [], total: 0 };

    const all = [...byId.entries()]
        .map(([id, info]) => ({
            id,
            vision: info.vision,
            video: info.video,
        }))
        // Sebagian katalog pihak ketiga memuat entri yang bukan model sama
        // sekali, misal "9router" atau "sementara". Entri seperti itu tidak
        // punya "/" dan hanya akan menghasilkan error kalau dipilih.
        .filter((m) => m.id.includes('/'));

    all.sort((a, b) => {
        if (a.vision !== b.vision) return a.vision ? -1 : 1;
        return a.id.localeCompare(b.id);
    });

    return { models: all, total: all.length };
}

function buildModelSelect(sessionId, page, models, activeModel) {
    const start = page * MODELS_PER_PAGE;
    const slice = models.slice(start, start + MODELS_PER_PAGE);

    const options = slice.map((m, i) => {
        const badges = [m.vision ? '👁' : null, m.video ? '🎬' : null]
            .filter(Boolean)
            .join('');
        const isCurrent = m.id === activeModel;
        return new StringSelectMenuOptionBuilder()
            .setLabel(truncate(m.id, 100))
            .setValue(m.id)
            .setDescription(
                truncate(
                    `${isCurrent ? 'sedang dipakai · ' : ''}${badges || 'teks'} · #${start + i + 1}`,
                    100
                )
            )
            .setDefault(isCurrent);
    });

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`model_pick:${sessionId}`)
            .setPlaceholder('Pilih model...')
            .addOptions(options)
    );
}

function buildNavRow(sessionId, page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`model_page:${sessionId}:${page - 1}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
        new ButtonBuilder()
            .setCustomId(`model_page:${sessionId}:${page + 1}`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`model_save:${sessionId}`)
            .setLabel('💾 Simpan ke config.yaml')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`model_cancel:${sessionId}`)
            .setLabel('Batal')
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    name: 'model',
    description: 'Ganti model/provider LLM tanpa restart',
    aliases: ['models', 'llmmodel'],
    adminOnly: true,

    async execute(message, args) {
        // Ganti model memengaruhi semua orang di server, jadi dibatasi.
        if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ Kamu butuh izin **Manage Server** untuk memakai command ini.');
        }

        // Subcommand teks: d!model set <nama> / d!model info
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'set') {
            const model = args.slice(1).join(' ').trim();
            if (!model) {
                return message.reply('Format: `d!model set <nama-model>`');
            }
            const persist = args.includes('--save');
            botConfig.setActiveModel(model, null, persist);
            return message.reply(
                `✅ Model diganti ke \`${model}\`${persist ? ' dan disimpan ke config.yaml' : ' (runtime saja)'}.`
            );
        }

        if (sub === 'info' || sub === 'status') {
            const active = botConfig.getActiveModel();
            const provider = botConfig.getActiveProvider();
            const status = botConfig.getConfigStatus();
            const embed = new EmbedBuilder()
                .setTitle('⚙ Model Configuration')
                .addFields(
                    { name: 'Model aktif', value: `\`${active}\``, inline: true },
                    { name: 'Provider', value: provider ? `\`${provider.name}\`` : '—', inline: true },
                    { name: 'Base URL', value: provider ? `\`${provider.base_url}\`` : '—', inline: false },
                    { name: 'config.yaml', value: `\`${status.path}\``, inline: false }
                )
                .setColor(0x5865f2);
            return message.reply({ embeds: [embed] });
        }

        // Tanpa argumen: tampilkan selector interaktif.
        const providers = botConfig.getProviders();
        if (!providers.length) {
            return message.reply(
                '❌ Belum ada provider di `config.yaml`. Tambahkan dulu daftar provider.'
            );
        }

        const sessionId = `${message.id}`;
        sessions.set(sessionId, {
            ownerId: message.author.id,
            providerName: null,
            models: [],
            page: 0,
            activeModel: botConfig.getActiveModel(),
        });

        // Satu provider -> langsung ke daftar model.
        if (providers.length === 1) {
            return showModels(message, sessionId, providers[0].name);
        }

        const activeProvider = botConfig.getActiveProviderName();
        const select = new StringSelectMenuBuilder()
            .setCustomId(`model_provider:${sessionId}`)
            .setPlaceholder('Pilih provider...')
            .addOptions(
                providers.map((p) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(truncate(p.name, 100))
                        .setValue(p.name)
                        .setDescription(truncate(p.base_url, 100))
                        .setDefault(p.name === activeProvider)
                )
            );

        return message.reply({
            embeds: [buildProviderEmbed(providers, activeProvider)],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },

    /**
     * Handler interaksi untuk komponen yang dibuat command ini.
     * Dipanggil dari event interactionCreate.
     * @returns {Promise<boolean>} true kalau interaksi ini ditangani
     */
    async handleInteraction(interaction) {
        const id = interaction.customId || '';
        if (!id.startsWith('model_')) return false;

        const [kind, sessionId, extra] = id.split(':');
        const session = sessions.get(sessionId);

        if (!session) {
            await interaction.reply({
                content: '⌛ Selector ini sudah kedaluwarsa. Jalankan `d!model` lagi.',
                ephemeral: true,
            });
            return true;
        }

        if (!canManage(interaction)) {
            await interaction.reply({
                content: '❌ Kamu butuh izin **Manage Server** untuk mengganti model.',
                ephemeral: true,
            });
            return true;
        }

        if (kind === 'model_provider' && interaction.isStringSelectMenu()) {
            const providerName = interaction.values[0];
            session.providerName = providerName;
            session.page = 0;

            await interaction.deferUpdate();
            await showModels(interaction, sessionId, providerName, true);
            return true;
        }

        if (kind === 'model_page' && interaction.isButton()) {
            session.page = Math.max(0, Number(extra) || 0);
            await interaction.deferUpdate();
            await showModels(interaction, sessionId, session.providerName, true);
            return true;
        }

        if (kind === 'model_pick' && interaction.isStringSelectMenu()) {
            const model = interaction.values?.[0];
            if (!model) {
                await interaction.reply({
                    content: '❌ Tidak ada model yang dipilih.',
                    ephemeral: true,
                });
                return true;
            }

            botConfig.setActiveModel(model, session.providerName, false);
            session.activeModel = model;

            await interaction.deferUpdate();
            await showModels(interaction, sessionId, session.providerName, true, {
                notice: `✅ Model diganti ke \`${model}\` (runtime). Klik Simpan untuk permanen.`,
            });
            return true;
        }

        if (kind === 'model_save' && interaction.isButton()) {
            const model = session.activeModel;
            const saved = botConfig.saveActiveModelToDisk(model, session.providerName);
            await interaction.reply({
                content: saved
                    ? `💾 Tersimpan: \`${model}\` di provider \`${session.providerName}\`. Bertahan setelah restart.`
                    : '❌ Gagal menulis config.yaml. Cek log bot.',
                ephemeral: true,
            });
            return true;
        }

        if (kind === 'model_cancel' && interaction.isButton()) {
            sessions.delete(sessionId);
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⚙ Model Configuration')
                        .setDescription('⏱ Dibatalkan — tidak ada perubahan.')
                        .setColor(0x95a5a6),
                ],
                components: [],
            });
            return true;
        }

        return false;
    },

    sessions,
};

/**
 * Tampilkan daftar model sebuah provider.
 * @param {object} ctx message atau interaction
 */
async function showModels(ctx, sessionId, providerName, isInteraction = false, opts = {}) {
    const session = sessions.get(sessionId);
    if (!session) return;

    const { models, total } = await fetchProviderModels(providerName);
    session.models = models;
    session.providerName = providerName;

    if (!models.length) {
        const embed = new EmbedBuilder()
            .setTitle('⚙ Model Configuration')
            .setDescription(
                `❌ Tidak bisa membaca daftar model dari \`${providerName}\`.\n` +
                'Pastikan base URL dan API key provider benar.'
            )
            .setColor(0xed4245);

        if (isInteraction) {
            return ctx.editReply({ embeds: [embed], components: [] });
        }
        return ctx.reply({ embeds: [embed] });
    }

    const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
    const page = Math.min(session.page, totalPages - 1);
    session.page = page;

    const embed = buildModelEmbed({
        providerName,
        models,
        page,
        activeModel: session.activeModel,
        total,
    });
    if (opts.notice) embed.setDescription(`${opts.notice}\n\n${embed.data.description}`);

    const components = [
        buildModelSelect(sessionId, page, models, session.activeModel),
        buildNavRow(sessionId, page, totalPages),
    ];

    if (isInteraction) {
        return ctx.editReply({ embeds: [embed], components });
    }
    return ctx.reply({ embeds: [embed], components });
}
