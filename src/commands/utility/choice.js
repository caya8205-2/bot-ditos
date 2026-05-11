const { callGroqWithFallback } = require('../../utils/groqManager');
const { replyAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'choice',
    aliases: ['pilih'],
    description: 'Minta bot milihin sesuatu dari opsi yang dikasih',
    async execute(message, args, client, prefix) {
        // Re-construct logic
        const sub = 'choice'; // simplified assumption, or check alias
        const lowerContent = message.content.toLowerCase();
        let cmdUsed = 'choice';
        if (lowerContent.startsWith(prefix + 'pilih')) cmdUsed = 'pilih';

        const full = message.content.slice(prefix.length).trim();
        const afterCommand = full.slice(cmdUsed.length).trim();

        if (!afterCommand) {
            return message.reply(
                'Kasih pilihan dong.\n' +
                'Contoh:\n' +
                '```d!choice\n' +
                'tidur\n' +
                'ngoding 8 jam\n' +
                'scroll tiktok```'
            );
        }

        // Split per baris, buang kosong
        const options = afterCommand
            .split('\n')
            .map(o => o.trim())
            .filter(o => o.length > 0);

        if (options.length < 2) {
            return message.reply('Minimal kasih 2 pilihan lah, gimana gwe mau milih kalo cuma 1');
        }

        try {
            const listText = options
                .map((opt, i) => `${i + 1}. ${opt}`)
                .join('\n');

            const completion = await callGroqWithFallback(async (groq) => {
                return await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content:
                                'Kamu adalah bot Discord bernama Ditos. Gaya bicara santai, campur Indonesia dan sedikit English. ' +
                                'Suka ngejokes, konyol, kadang nyolot dikit tapi tetap bantu jelasin dengan jelas dan ringkas. Jangan terlalu panjang, jangan formal. ' +
                                'Kamu juga jarang tetapi akan menggunakan kata seperti "Bjirlah, anjeng, biji" Kamu akan berbicara seadanya dan frontal (Contoh: "Lah gwa mah vergil, lah elu mirror demon", "Goofy ass looking ahh". ' +
                                'Kamu tidak akan menggunakan emoji. Kamu juga akan memberi informasi sesingkat mungkin. ' +
                                'PENTING: Kalo ada text "[Ada gambar: ...]" di pesan user, itu artinya user kirim gambar dan kamu bisa "liat" gambar tersebut lewat deskripsi yang dikasih. ' +
                                'Jangan bilang kamu gak bisa liat gambar, langsung aja respon sesuai deskripsinya. Jangan repetitif, jangan keseringan pake kata-kata yang "lah gw mah vergil" dll, sesekali aja biar terasa moody. ' +
                                'Jangan campur-campur panggilan "Aku, Kamu" sama "lo, Gwe", kalo mau pakai "Aku" lawan katanya itu "Kamu" bukan "Gwe" dan sebaliknya.',
                        },
                        {
                            role: 'user',
                            content:
                                'Gue lagi bingung milih salah satu dari pilihan ini:\n' +
                                listText +
                                '\n\nPilih satu yang paling cocok buat gue sekarang, terus jelasin singkat kenapa.'
                        }
                    ],
                    temperature: 0.8,
                    max_completion_tokens: 150
                });
            });

            const replyText = completion.choices?.[0]?.message?.content?.trim();

            if (!replyText) {
                return message.reply('Ai-nya lagi bengong, coba ulangi lagi pilihan lu barusan.');
            }

            // Tampilkan juga list pilihannya biar jelas
            return replyAndSave(message,
                `**🎲 Pilihan gwej:**\n${replyText}\n\n` +
                '```' + listText + '```'
            );
        } catch (err) {
            console.error('Groq choice error:', err);
            return message.reply('Ai-nya lagi error pas milih pilihan, coba lagi bentar lagi ya.');
        }
    },
};
