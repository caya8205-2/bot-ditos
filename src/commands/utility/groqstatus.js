const { checkLocalLLMStatus } = require('../../utils/localLLMManager');
const { createStatusEmbed, replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'localstatus',
    description: 'Cek koneksi model lokal KoboldCpp',
    aliases: ['ls', 'llmstatus', 'groqstatus', 'gs'],
    async execute(message) {
        try {
            const status = await checkLocalLLMStatus();
            const embed = createStatusEmbed({
                title: 'Local LLM Status',
                color: '#4CAF50',
                description: 'KoboldCpp aktif dan dapat menerima request.',
                fields: [
                    { name: 'Endpoint', value: `\`${status.baseURL}\``, inline: false },
                    { name: 'Model', value: `\`${status.model}\``, inline: true },
                    { name: 'Latency', value: `${status.latencyMs} ms`, inline: true },
                    { name: 'Respons tes', value: status.response.slice(0, 200), inline: false },
                ],
            });

            return replyEmbedAndSave(message, { embeds: [embed] });
        } catch (error) {
            console.error('[LOCAL LLM STATUS ERROR]', error);
            const embed = createStatusEmbed({
                title: 'Local LLM Error',
                color: '#E53935',
                description: `KoboldCpp tidak dapat dihubungi:\n\`\`\`${error.message}\`\`\``,
            });

            return replyEmbedAndSave(message, { embeds: [embed] });
        }
    },
};
