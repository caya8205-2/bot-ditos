const { EmbedBuilder } = require('discord.js');
const {
    LOCAL_LLM_BASE_URL,
    LOCAL_LLM_MODEL,
    LOCAL_LLM_TIMEOUT_MS,
} = require('../../utils/localLLMManager');
const {
    NINE_ROUTER_MODEL,
    NINE_ROUTER_FALLBACK_COOLDOWN_MS,
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
        const embed = new EmbedBuilder()
            .setTitle('Konfigurasi LLM')
            .setColor('#4CAF50')
            .setDescription('KoboldCpp menjadi provider utama, lalu 9router, lalu Groq sebagai fallback terakhir.')
            .addFields(
                { name: 'Endpoint', value: `\`${LOCAL_LLM_BASE_URL}\``, inline: false },
                { name: 'Model lokal', value: `\`${LOCAL_LLM_MODEL}\``, inline: true },
                { name: 'Timeout', value: `${LOCAL_LLM_TIMEOUT_MS} ms`, inline: true },
                { name: 'Model 9router', value: `\`${NINE_ROUTER_MODEL}\``, inline: true },
                { name: '9router tersedia', value: status.secondary.available ? 'Ya' : 'Tidak', inline: true },
                { name: '9router cooldown', value: status.secondary.onCooldown ? 'Ya' : 'Tidak', inline: true },
                { name: 'Model Groq', value: `\`${GROQ_FALLBACK_MODEL}\``, inline: true },
                { name: 'Groq tersedia', value: status.fallback.available ? 'Ya' : 'Tidak', inline: true },
                { name: 'Cooldown lokal', value: `${LOCAL_LLM_FALLBACK_COOLDOWN_MS} ms`, inline: true },
                { name: 'Cooldown 9router', value: `${NINE_ROUTER_FALLBACK_COOLDOWN_MS} ms`, inline: true },
                { name: 'Lokal sedang cooldown', value: status.localOnCooldown ? 'Ya' : 'Tidak', inline: true },
            )
            .setTimestamp();

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
