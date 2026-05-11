const { searchWeb, replyAndSave } = require('../../utils/helpers');
const { callGroqWithFallback } = require('../../utils/groqManager');

module.exports = {
    name: 'google',
    description: 'Google search, nanti bot kasih 3 hasil teratas dengan bantuan AI',
    aliases: ['g'],
    async execute(message, args, client) {
        const query = args.join(' ').trim();

        if (!query) {
            return message.reply(
                'Mau nanya apa ke Google? Contoh:\n' +
                '`d!g berita teknologi hari ini`'
            );
        }

        try {
            await message.channel.send('Bentar, gwe cek Google dulu...');

            const results = await searchWeb(query);

            if (!results.length) {
                return message.reply('Gak nemu apa-apa dari Google, coba kata kunci lain.');
            }

            const webContext = results
                .map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`)
                .join('\n\n');

            const completion = await callGroqWithFallback(async (groq) => {
                return await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content:
                                'Kamu adalah bot Discord bernama Ditos. Gaya bicara santai, campur Indonesia dan sedikit English. ' +
                                'Suka ngejokes, konyol, kadang nyolot dikit tapi tetap bantu jelasin dengan jelas dan ringkas. ' +
                                'Jangan terlalu panjang, jangan formal. ' +
                                'Kamu juga jarang tetapi akan menggunakan kata seperti "Bjirlah, anjeng, biji".' +
                                'Kamu akan berbicara seadanya dan frontal (Contoh: "Lah gwa mah vergil, lah elu mirror demon", "Goofy ass looking ahh". ' +
                                'Jangan campur-campur panggilan "Aku, Kamu" sama "lo, Gwe", kalo mau pakai "Aku" lawan katanya itu "Kamu" bukan "Gwe" dan sebaliknya.' +
                                'Tugas kamu sekarang: jawab pertanyaan user berdasarkan hasil pencarian web yang diberikan. ' +
                                'Kalau infonya kurang, bilang aja gak yakin, jangan ngarang.'
                        },
                        {
                            role: 'user',
                            content:
                                `Pertanyaan user: ${query}\n\n` +
                                `Berikut hasil pencarian web (Google):\n` +
                                webContext
                        }
                    ],
                    temperature: 0.4,
                    max_completion_tokens: 300,
                });
            });

            const answer = completion.choices?.[0]?.message?.content?.trim();

            if (!answer) {
                return message.reply('Ai-nya lagi bengong habis baca Google, coba tanya lagi bentar.');
            }

            const sumberList = results
                .map((r, i) => `${i + 1}. ${r.title}\n   Sumber: <${r.link}>`)
                .join('\n');

            return replyAndSave(message,
                `**🔍 Jawaban (pakai Google + ai):**\n` +
                `${answer}\n\n` +
                `**Sumber singkat:**\n` +
                sumberList
            );

        } catch (err) {
            console.error('Google search error:', err);
            return message.reply('Lagi gak bisa nyambung ke Google, coba lagi nanti.');
        }
    },
};
