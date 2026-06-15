const { callLLMWithFallback, LLM_MODEL } = require('../../utils/llmManager');
const { replyAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'joke',
    description: 'Dapetin dad joke receh',
    async execute(message, args, client) {
        try {
            const completion = await callLLMWithFallback(async (client) => {
                return await client.chat.completions.create({
                    model: LLM_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: 'Kamu adalah comedian yang ahli bikin dad jokes Indonesia yang lucu dan konyol. Kasih 1 joke singkat aja, gak usah panjang-panjang. Jangan repetitif juga jokes nya.'
                        },
                        {
                            role: 'user',
                            content: 'Kasih dad joke yang lucu dong'
                        }
                    ],
                    temperature: 1.0,
                    max_tokens: 100,
                });
            });

            const joke = completion.choices?.[0]?.message?.content?.trim();
            return replyAndSave(message, joke ? `${joke} 😂` : 'Eh joke nya ilang, coba lagi');
        } catch (err) {
            console.error('Local LLM joke error:', err);
            return message.reply('Error pas bikin joke nih');
        }
    },
};
