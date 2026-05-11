const { callGroqWithFallback } = require('../../utils/groqManager');
const { replyAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'joke',
    description: 'Dapetin dad joke receh',
    async execute(message, args, client) {
        try {
            const completion = await callGroqWithFallback(async (groq) => {
                return await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
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
                    max_completion_tokens: 100,
                });
            });

            const joke = completion.choices?.[0]?.message?.content?.trim();
            return replyAndSave(message, joke ? `${joke} 😂` : 'Eh joke nya ilang, coba lagi');
        } catch (err) {
            console.error('Groq joke error:', err);
            return message.reply('Error pas bikin joke nih');
        }
    },
};
