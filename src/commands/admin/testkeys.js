const { EmbedBuilder } = require('discord.js');
const {
    LOCAL_LLM_BASE_URL,
    LOCAL_LLM_MODEL,
    LOCAL_LLM_TIMEOUT_MS,
} = require('../../utils/localLLMManager');
const {
    getNinerModel,
    NINER_FALLBACK_COOLDOWN_MS,
    GROQ_FALLBACK_MODEL,
    LOCAL_LLM_FALLBACK_COOLDOWN_MS,
    getLLMProviderStatus,
} = require('../../utils/llmManager');
const { replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'llmconfig',
    description: 'Lihat konfigurasi provider LLM',
    aliases: ['testkeys', 'keystat'],
    async execute(message) {
        const status = getLLMProviderStatus();
        const routerChain = (status.router?.chain || []).map((m) => `\`${m}\``).join(' → ') || '`-`';
        const embed = new EmbedBuilder()
            .setTitle('Konfigurasi LLM')
            .setColor('#4CAF50')
            .setDescription('Urutan eksekusi: model utama router → model fallback router → Groq.')
            .addFields(
                { name: 'Endpoint', value: `\`${LOCAL_LLM_BASE_URL}\``, inline: false },
                { name: 'Model lokal', value: `\`${LOCAL_LLM_MODEL}\``, inline: true },
                { name: 'Timeout', value: `${LOCAL_LLM_TIMEOUT_MS} ms`, inline: true },
                { name: 'Chain router', value: routerChain, inline: false },
                { name: 'Model utama', value: `\`${getNinerModel()}\`\n\`${status.primary.baseURL}\``, inline: true },
                { name: 'Utama cooldown', value: status.primary.onCooldown ? 'Ya' : 'Tidak', inline: true },
                { name: 'Model fallback', value: status.secondary.configured ? `\`${status.secondary.model}\`\n\`${status.secondary.baseURL}\`` : 'Tidak diset', inline: true },
                { name: 'Provider terpisah', value: status.secondary.dedicatedProvider ? 'Ya' : 'Tidak (pakai base URL utama)', inline: true },
                { name: 'Fallback cooldown', value: status.secondary.onCooldown ? 'Ya' : 'Tidak', inline: true },
                { name: 'Model aktif', value: `\`${status.router?.activeModel || '-'}\`\nvia \`${status.router?.activeProvider || '-'}\``, inline: true },
                { name: 'Model Groq', value: `\`${GROQ_FALLBACK_MODEL}\``, inline: true },
                { name: 'Groq tersedia', value: status.fallback.available ? 'Ya' : 'Tidak', inline: true },
                { name: 'Cooldown lokal', value: `${LOCAL_LLM_FALLBACK_COOLDOWN_MS} ms`, inline: true },
                { name: 'Cooldown router', value: `${NINER_FALLBACK_COOLDOWN_MS} ms`, inline: true },
                { name: 'Lokal sedang cooldown', value: status.localOnCooldown ? 'Ya' : 'Tidak', inline: true },
            )
            .setTimestamp();

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
