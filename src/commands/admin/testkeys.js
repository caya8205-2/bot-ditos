const { EmbedBuilder } = require('discord.js');
const {
    LOCAL_LLM_BASE_URL,
    LOCAL_LLM_MODEL,
    LOCAL_LLM_TIMEOUT_MS,
} = require('../../utils/localLLMManager');
const {
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
            .setDescription('KoboldCpp menjadi provider utama, dengan Groq sebagai fallback otomatis.')
            .addFields(
                { name: 'Endpoint', value: `\`${LOCAL_LLM_BASE_URL}\``, inline: false },
                { name: 'Model lokal', value: `\`${LOCAL_LLM_MODEL}\``, inline: true },
                { name: 'Timeout', value: `${LOCAL_LLM_TIMEOUT_MS} ms`, inline: true },
                { name: 'Model fallback', value: `\`${GROQ_FALLBACK_MODEL}\``, inline: true },
                { name: 'Groq tersedia', value: status.fallback.available ? 'Ya' : 'Tidak', inline: true },
                { name: 'Cooldown lokal', value: `${LOCAL_LLM_FALLBACK_COOLDOWN_MS} ms`, inline: true },
                { name: 'Lokal sedang cooldown', value: status.localOnCooldown ? 'Ya' : 'Tidak', inline: true },
            )
            .setTimestamp();

        return replyEmbedAndSave(message, { embeds: [embed] });
    },
};
