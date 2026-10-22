'use strict';

/**
 * d!model - ganti model tanpa restart bot.
 *
 * Satu selector untuk empat target: chat, vision (gambar), vision (video), dan
 * fallback. Alurnya: pilih target -> pilih model dari katalog provider.
 *
 * Perubahan berlaku langsung di runtime. Tombol Simpan menulis ke config.yaml
 * supaya bertahan setelah restart.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');

const botConfig = require('../../utils/botConfig');
const catalog = require('../../utils/modelCatalog');

const MODELS_PER_PAGE = 25;
// Selector kedaluwarsa supaya tidak menggantung selamanya kalau ditinggal.
const SESSION_TTL_MS = 5 * 60 * 1000;

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

/**
 * Buat sesi baru sekaligus menjadwalkan kedaluwarsa.
 * Timer di-unref supaya tidak menahan proses tetap hidup saat bot dimatikan.
 */
function createSession(sessionId, ownerId) {
    const timer = setTimeout(() => {
        sessions.delete(sessionId);
        console.log(`[Model] Sesi selector ${sessionId} kedaluwarsa`);
    }, SESSION_TTL_MS);
    if (typeof timer.unref === 'function') timer.unref();

    sessions.set(sessionId, {
        ownerId,
        targetKey: null,
        providerName: null,
        models: [],
        page: 0,
        activeModel: null,
        timer,
    });
}

function dropSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session?.timer) clearTimeout(session.timer);
    sessions.delete(sessionId);
}

/**
 * Ringkasan nilai efektif semua target, dipakai di embed utama.
 */
function buildTargetSummary() {
    return botConfig.getModelTargets().map((t) => {
        const value = botConfig.getTargetValue(t.key);
        const provider = value.provider ? ` · ${value.provider}` : '';
        const model = value.model || 'belum diset';
        return {
            ...t,
            model,
            provider: value.provider,
            line: `**${t.label}** — \`${model}\`${provider}`,
        };
    });
}

function buildTargetEmbed(summary) {
    return new EmbedBuilder()
        .setTitle('⚙ Model Configuration')
        .setDescription(
            'Pilih model apa yang mau diubah.\n\n' +
            summary.map((s) => s.line).join('\n')
        )
        .setFooter({ text: 'Berlaku langsung · tombol Simpan untuk permanen' })
        .setColor(0x5865f2);
}

function buildTargetSelect(sessionId, summary) {
    const options = summary.map((s) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(truncate(s.label, 100))
            .setValue(s.key)
            .setDescription(truncate(`${s.model}${s.provider ? ' · ' + s.provider : ''}`, 100))
    );

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`model_target:${sessionId}`)
            .setPlaceholder('Pilih yang mau diubah...')
            .addOptions(options)
    );
}

function buildModelEmbed({ target, providerName, models, page, activeModel, total }) {
    const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
    return new EmbedBuilder()
        .setTitle(`⚙ ${target.label}`)
        .setDescription(
            `**Provider:** \`${providerName}\`\n` +
            `**Sekarang:** \`${activeModel || 'belum diset'}\`\n\n` +
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
 * lebih dulu, lalu alfabetis.
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
            .setCustomId(`model_back:${sessionId}`)
            .setLabel('↩ Ganti target')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`model_save:${sessionId}`)
            .setLabel('💾 Simpan')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`model_cancel:${sessionId}`)
            .setLabel('Batal')
            .setStyle(ButtonStyle.Danger)
    );
}

/**
 * Tampilkan daftar model sebuah target.
 * @param {object} ctx message atau interaction
 */
async function showModels(ctx, sessionId, targetKey, isInteraction = false, opts = {}) {
    const session = sessions.get(sessionId);
    if (!session) return;

    const target = botConfig.getModelTarget(targetKey);
    if (!target) return;

    const value = botConfig.getTargetValue(targetKey);
    // Pakai provider target kalau ada, kalau tidak provider chat sebagai acuan.
    const providerName = value.provider || botConfig.getActiveProviderName();
    const provider = botConfig.getProviderByName(providerName);

    if (!provider) {
        const embed = new EmbedBuilder()
            .setTitle('⚙ Model Configuration')
            .setDescription(
                `❌ Target \`${target.label}\` belum punya provider yang valid ` +
                `(sekarang: \`${providerName || 'kosong'}\`).`
            )
            .setColor(0xed4245);
        return isInteraction
            ? ctx.editReply({ embeds: [embed], components: [] })
            : ctx.reply({ embeds: [embed] });
    }

    const { models, total } = await fetchProviderModels(providerName);
    session.models = models;
    session.providerName = providerName;
    session.targetKey = targetKey;
    session.activeModel = value.model;

    if (!models.length) {
        const embed = new EmbedBuilder()
            .setTitle(`⚙ ${target.label}`)
            .setDescription(
                `❌ Tidak bisa membaca daftar model dari \`${providerName}\`.\n` +
                'Pastikan base URL dan API key provider benar.'
            )
            .setColor(0xed4245);
        return isInteraction
            ? ctx.editReply({ embeds: [embed], components: [] })
            : ctx.reply({ embeds: [embed] });
    }

    const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
    const page = Math.min(session.page, totalPages - 1);
    session.page = page;

    const embed = buildModelEmbed({
        target,
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

    return isInteraction
        ? ctx.editReply({ embeds: [embed], components })
        : ctx.reply({ embeds: [embed], components });
}

/**
 * Kembali ke menu pilih target.
 */
async function showTargets(ctx, sessionId, isInteraction, notice = null) {
    const summary = buildTargetSummary();
    const embed = buildTargetEmbed(summary);
    if (notice) embed.setDescription(`${notice}\n\n${embed.data.description}`);

    const components = [buildTargetSelect(sessionId, summary)];
    return isInteraction
        ? ctx.editReply({ embeds: [embed], components })
        : ctx.reply({ embeds: [embed], components });
}

module.exports = {
    name: 'model',
    description: 'Ganti model chat, vision, video, atau fallback tanpa restart',
    aliases: ['models', 'llmmodel'],
    adminOnly: true,

    async execute(message, args) {
        // Ganti model memengaruhi semua orang di server, jadi dibatasi.
        if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ Kamu butuh izin **Manage Server** untuk memakai command ini.');
        }

        const sub = (args[0] || '').toLowerCase();

        // d!model set <target> <nama-model> [--save]
        if (sub === 'set') {
            const targetKey = (args[1] || '').toLowerCase();
            const model = args.slice(2).filter((a) => a !== '--save').join(' ').trim();
            const persist = args.includes('--save');

            if (!targetKey || !model) {
                const targets = botConfig.getModelTargets().map((t) => t.key).join(' | ');
                return message.reply(
                    `Format: \`d!model set <target> <nama-model> [--save]\`\nTarget: \`${targets}\``
                );
            }

            try {
                botConfig.setTargetModel(targetKey, model, null, persist);
                return message.reply(
                    `✅ ${targetKey} diganti ke \`${model}\`${persist ? ' dan disimpan' : ' (runtime saja)'}.`
                );
            } catch (error) {
                return message.reply(`❌ ${error.message}`);
            }
        }

        if (sub === 'info' || sub === 'status') {
            const summary = buildTargetSummary();
            const embed = new EmbedBuilder()
                .setTitle('⚙ Model Configuration')
                .addFields(
                    summary.map((s) => ({
                        name: s.label,
                        value: `\`${s.model}\`${s.provider ? `\n${s.provider}` : ''}`,
                        inline: true,
                    }))
                )
                .setFooter({ text: botConfig.getConfigPath() })
                .setColor(0x5865f2);
            return message.reply({ embeds: [embed] });
        }

        if (!botConfig.getProviders().length) {
            return message.reply(
                '❌ Belum ada provider di `config.yaml`. Tambahkan dulu daftar provider.'
            );
        }

        const sessionId = `${message.id}`;
        createSession(sessionId, message.author.id);
        return showTargets(message, sessionId, false);
    },

    /**
     * Handler interaksi untuk komponen yang dibuat command ini.
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

        if (kind === 'model_target' && interaction.isStringSelectMenu()) {
            const targetKey = interaction.values?.[0];
            if (!targetKey) return true;

            session.page = 0;
            await interaction.deferUpdate();
            await showModels(interaction, sessionId, targetKey, true);
            return true;
        }

        if (kind === 'model_back' && interaction.isButton()) {
            session.page = 0;
            await interaction.deferUpdate();
            await showTargets(interaction, sessionId, true);
            return true;
        }

        if (kind === 'model_page' && interaction.isButton()) {
            session.page = Math.max(0, Number(extra) || 0);
            await interaction.deferUpdate();
            await showModels(interaction, sessionId, session.targetKey, true);
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

            botConfig.setTargetModel(session.targetKey, model, session.providerName, false);
            session.activeModel = model;

            await interaction.deferUpdate();
            await showModels(interaction, sessionId, session.targetKey, true, {
                notice: `✅ Diganti ke \`${model}\` (runtime). Klik Simpan untuk permanen.`,
            });
            return true;
        }

        if (kind === 'model_save' && interaction.isButton()) {
            const model = session.activeModel;
            const targetKey = session.targetKey;
            const saved = botConfig.saveTargetToDisk(targetKey, model, session.providerName);

            // Embed selector dihapus setelah disimpan supaya tidak menggantung.
            await interaction.deferUpdate();
            await interaction.message.delete().catch(() => {});

            // Konfirmasi dikirim biasa (bukan ephemeral) supaya semua orang
            // di channel tahu model sudah berganti.
            await interaction.followUp({
                content: saved
                    ? `✅ ${targetKey} disimpan: \`${model}\``
                    : '❌ Gagal menyimpan model. Cek log bot.',
            });

            dropSession(sessionId);
            return true;
        }

        if (kind === 'model_cancel' && interaction.isButton()) {
            dropSession(sessionId);
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
    SESSION_TTL_MS,
};
