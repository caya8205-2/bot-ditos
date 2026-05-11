const { EmbedBuilder } = require('discord.js');
const { callGroqWithFallback } = require('../../utils/groqManager');
const { analyzeImageWithGemini } = require('../../utils/geminiManager');
const { replyEmbedAndSave, saveToChannelHistory, createStatusEmbed } = require('../../utils/helpers');
const { channelHistory, MAX_CHANNEL_HISTORY } = require('../../data/state');
const { OWNER_ID } = require('../../config');

module.exports = {
    name: 'eli5',
    description: 'Explain Like I\'m 5',
    aliases: [],
    async execute(message, args, client) {
        const topic = args.join(' ').trim();

        if (!topic) {
            const usageEmbed = new EmbedBuilder()
                .setTitle('👶 ELI5 - Explain Like I\'m 5')
                .setColor('#FFA500')
                .setDescription(
                    'Jelasin konsep kompleks dengan cara yang **super gampang dipahami**!\n\n' +
                    'Perfect buat:\n' +
                    '• Konsep programming yang susah\n' +
                    '• Topik sains/fisika\n' +
                    '• Istilah teknis\n' +
                    '• Apa aja yang bikin pusing! 🤯'
                )
                .addFields(
                    {
                        name: '📖 Cara Pakai',
                        value:
                            '```\nd!eli5 [topik/konsep]\n\n' +
                            'Contoh:\n' +
                            'd!eli5 blockchain\n' +
                            'd!eli5 quantum computing\n' +
                            'd!eli5 recursion\n' +
                            'd!eli5 kenapa langit biru```',
                        inline: false
                    },
                    {
                        name: '💡 Tips',
                        value:
                            '• Semakin spesifik topiknya, semakin bagus penjelasannya\n' +
                            '• Bisa tanya tentang konsep programming, sains, atau daily life\n' +
                            '• Bisa juga upload gambar buat dijelasin!',
                        inline: false
                    }
                )
                .setFooter({ text: 'Bot Ditos - Making complex things simple! ✨' });

            return replyEmbedAndSave(message, { embeds: [usageEmbed] });
        }

        try {
            const now = new Date();
            const localTime = now.toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric"
            }) + " " + now.toLocaleTimeString("id-ID");

            // Check for image attachment
            let imageDescription = null;
            if (message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment.contentType?.startsWith('image/')) {
                    await message.channel.send('🔍 Bentar, lagi analisa gambarnya...');
                    imageDescription = await analyzeImageWithGemini(attachment.url);
                    console.log('[ELI5] Image analyzed:', imageDescription?.substring(0, 100));
                }
            }

            // Build final prompt
            let finalPrompt = topic;
            if (imageDescription) {
                finalPrompt = `${topic}\n\n[Context dari gambar: ${imageDescription}]`;
            }

            await message.channel.send('🤔 Hmm, let me think...');

            // Call Groq with special ELI5 system prompt
            const completion = await callGroqWithFallback(async (groq) => {
                return await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content:
                                "Waktu sekarang: " + localTime + "\n" +
                                "Kamu boleh sesekali memakai emoji custom server ini sebagai reaksi (jangan berlebihan, biasanya maksimal 1 emoji per pesan):\n" +
                                "- <:bwakakak3:1402586205669036063> → menertawakan orang lain secara bercanda (playful mockery).\n" +
                                "- <:bwakakak2:1299912831826788385> → ikut ketawa / ketawa sendiri karena sesuatu lucu.\n" +
                                "- <:acumalaka:1119639601099841689> → tertawa terbahak-bahak karena sangat lucu.\n" +
                                "- <:oranghitamnangis:1398551165872115712> → reaksi diolok-olok bercanda / deadpan cry yang lucu.\n" +
                                "- <:hebat:1292785452339957790> → apresiasi, bangga, atau achievement.\n" +
                                "- <:emotmarah:1299575975511851028> → marah atau kesel.\n" +
                                "- <:senyum:1126389211130511401> → senyum awkward / mencurigakan (tau sesuatu tapi pura-pura polos).\n" +
                                "- <:maubagaimanalagi:1119637920278642728> → pasrah / it is what it is.\n" +
                                "- <:bahlil:1447840268131897485> → emoji random, bebas dipakai untuk humor absurd.\n" +
                                "- <:maafkak:1296306397356621904> → minta maaf.\n" +
                                "- <:xixixixi:1119669394822406264> → ketawa, penggunaannya mirip sama bwakakak2.\n" +
                                "- <:kaget2:1410339724744200323> → kaget.\n" +
                                "Gunakan emoji hanya sebagai reaksi pendukung, bukan di setiap kalimat, dan hindari emoji saat menjelaskan hal teknis serius.\n\n" +

                                "Kamu adalah Bot Ditos. Gaya bicara santai, casual, campur Indonesia + English dikit. " +
                                "Nada kamu moody, suka nyeletuk, kadang nyolot halus, tapi tetap informatif kalau user beneran butuh bantuan.\n\n" +

                                "Gaya omongan:\n" +
                                "- Pake 'gue/gua/gwa' dan 'lo/lu/luwh', jangan pernah pakai aku/kamu.\n" +
                                "- 'luwh'/'lo' adalah varian dari 'lu', fungsinya sama sebagai kata ganti orang kedua, BUKAN panggilan.\n" +
                                "- Ketiga pronoun ('lo', 'lu', 'luwh') artinya sama, bebas dipakai bergantian.\n" +
                                "- Jangan pake panggilan kayak 'bro', 'bos', 'bang', kecuali user duluan.\n" +
                                "- Sesekali ngomong frontal atau absurd ('bjirlah', 'anjeng', 'goofy ahh', 'lah gue mah Vergil, lah elu Mirror Demon'), " +
                                "tapi JANGAN kebanyakan supaya tetap variatif.\n" +
                                "- Boleh ngatain, nge-roast dikit, tapi jangan toxic berat.\n\n" +

                                "Kepribadian:\n" +
                                "- Humoris, sarkas, kadang males nanggepin kalau pertanyaan konyol.\n" +
                                "- Tapi tetap bantu kalau konteksnya serius.\n" +
                                "- Mood swing boleh, asal alasan tetap jujur.\n\n" +

                                "Batasan:\n" +
                                "- Dilarang ngarang alasan manusiawi kayak capek, lapar, ngantuk.\n" +
                                "- Kalau gak tau sesuatu, bilang jujur 'ga tau' atau 'gabisa akses itu'.\n" +
                                "- Jangan ngomong formal.\n" +
                                "- Jangan ceramah kepanjangan—jawaban pendek atau sedang aja.\n\n" +

                                "TUGAS KHUSUS: ELI5 (Explain Like I'm 5)\n" +
                                "Lu diminta jelasin konsep kompleks dengan cara yang GAMPANG BANGET dipahami.\n\n" +

                                "ATURAN ELI5:\n" +
                                "1. Jelasin seolah ngomong ke anak 5 tahun (atau pemula total)\n" +
                                "2. Pakai analogi yang relate ke kehidupan sehari-hari ('kayak lu lagi... gitu deh')\n" +
                                "3. Hindari jargon teknis yang bikin pusing, kalau terpaksa pakai ya jelasin juga\n" +
                                "4. Pakai contoh konkret dan visual\n" +
                                "5. Breakdown step-by-step kalau perlu\n" +
                                "6. Keep it fun dan engaging, jangan bikin ngantuk!\n" +
                                "7. Boleh nyolot dikit di awal, tapi tetep jelasin dengan jelas\n\n" +

                                "FORMAT JAWABAN:\n" +
                                "• Start dengan hook yang menarik (bisa sedikit sarkastik/lucu)\n" +
                                "• Kasih analogi yang relate banget\n" +
                                "• Jelasin konsepnya step by step dengan gaya santai\n" +
                                "• Kasih contoh real-world\n" +
                                "• Summary singkat di akhir\n\n" +

                                "TONE: Santai, kocak, helpful. Bikin orang merasa 'oh gitu doang?!' setelah baca.\n" +
                                "Kesimpulan: Ditos itu chaotic-good—kocak, lumayan nyolot, tapi berguna dan jelasinnya on point."
                        },
                        {
                            role: 'user',
                            content: `Jelasin ini dengan cara yang SUPER gampang dipahami: ${finalPrompt}`
                        }
                    ],
                    temperature: 0.8,
                    max_completion_tokens: 800,
                });
            });

            const explanation = completion.choices?.[0]?.message?.content?.trim();

            if (!explanation) {
                return message.reply('Aduh, gue lagi bengong nih. Coba tanya lagi ya!');
            }
            saveToChannelHistory(message.channel.id, `[ELI5: ${topic}] ${explanation.substring(0, 200)}...`, 'Bot Ditos', 'assistant');

            // Split reply helper
            function sendLongReply(msg, text) {
                const MAX_LENGTH = 1900;
                if (text.length <= MAX_LENGTH) {
                    return msg.reply(text);
                }

                const chunks = [];
                let currentChunk = '';

                const lines = text.split('\n');
                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > MAX_LENGTH) {
                        chunks.push(currentChunk);
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }

                if (currentChunk) chunks.push(currentChunk);

                msg.reply(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    msg.channel.send(chunks[i]);
                }
            }

            const formattedReply =
                `👶 **ELI5: ${topic}**\n\n` +
                explanation +
                `\n\n💡 *Udah paham? Kalau masih bingung, tanya lagi aja!*`;

            return sendLongReply(message, formattedReply);

        } catch (error) {
            console.error('ELI5 command error:', error);

            if (error.message?.includes('rate_limit')) {
                return message.reply(
                    '⚠️ Kena rate limit dari Groq. Tunggu sebentar ya (~30 detik), atau cek: `d!gs`'
                );
            }

            if (error.message?.includes('Gemini timeout')) {
                return message.reply(
                    '⏱️ Gemini timeout pas analisa gambar. Coba upload gambar yang lebih kecil atau coba lagi.'
                );
            }

            return message.reply(
                `Error pas jelasin: ${error.message}\n` +
                `Coba lagi atau lapor ke <@${OWNER_ID}> ya!`
            );
        }
    },
};
