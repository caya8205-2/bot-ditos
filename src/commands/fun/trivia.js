const { activeTrivia, triviaTimers, recentTriviaTopics } = require('../../data/state');
const { callGroqWithFallback } = require('../../utils/groqManager');
const { saveToChannelHistory } = require('../../utils/helpers');

module.exports = {
    name: 'trivia',
    description: 'Random trivia question (jawab lewat reply)',
    aliases: ['quiz'],
    async execute(message, args, client) {
        const channelId = message.channel.id;

        if (activeTrivia.has(channelId)) {
            return message.reply('Masih ada trivia yang belum dijawab di channel ini! Jawab dulu atau tunggu timeout.');
        }

        try {
            await message.channel.send('⏳ Bentar, lagi bikin pertanyaan trivia...');

            const categories = [
                'anime/manga', 'video games', 'teknologi/programming',
                'sejarah dunia', 'pop culture/music', 'sains/fisika',
                'geografi', 'film/series', 'olahraga', 'mitologi',
                'makanan/kuliner', 'biologi/alam', 'matematika'
            ];

            const availableCategories = categories.filter(
                cat => !recentTriviaTopics.includes(cat)
            );

            const selectedCategory = availableCategories.length > 0
                ? availableCategories[Math.floor(Math.random() * availableCategories.length)]
                : categories[Math.floor(Math.random() * categories.length)];

            recentTriviaTopics.push(selectedCategory);
            if (recentTriviaTopics.length > 5) {
                recentTriviaTopics.shift();
            }

            const subTopicPrompts = {
                'anime/manga': ['karakter side character yang underrated', 'studio animasi atau mangaka terkenal', 'judul anime/manga yang punya twist ending', 'teknik atau power system unik', 'anime/manga dengan setting non-Jepang'],
                'video games': ['game developer atau publisher', 'Easter egg atau secret terkenal', 'game dengan mechanic unik', 'karakter antagonis ikonik', 'soundtrack atau composer game'],
                'teknologi/programming': ['programming language dan penciptanya', 'algoritma atau data structure', 'tech company dan founder', 'framework atau library populer', 'konsep computer science fundamental'],
                'sejarah dunia': ['penemuan atau inventor', 'perang atau konflik besar', 'peradaban kuno', 'tokoh pemimpin dunia', 'peristiwa bersejarah abad 20'],
                'pop culture/music': ['band atau grup musik', 'album ikonik', 'music genre dan asal-usulnya', 'penyanyi solo terkenal', 'lagu yang jadi meme atau viral'],
                'sains/fisika': ['hukum fisika atau rumus terkenal', 'ilmuwan dan penemuannya', 'fenomena alam', 'partikel subatomik', 'konsep fisika modern'],
                'geografi': ['negara dan ibukotanya', 'landmark atau bangunan terkenal', 'gunung atau sungai terpanjang', 'pulau atau kepulauan', 'benua dan karakteristiknya'],
                'film/series': ['director terkenal', 'aktor/aktris pemenang Oscar', 'franchise film populer', 'film dengan budget tertinggi', 'series TV ikonik'],
                'olahraga': ['atlet legendaris', 'rekor dunia', 'turnamen atau liga terkenal', 'tim olahraga ikonik', 'aturan unik dalam olahraga'],
                'mitologi': ['dewa/dewi dari berbagai mitologi (Norse, Greek, Roman, Egyptian, dll)', 'makhluk mitologi', 'cerita atau legenda terkenal', 'artefak atau senjata mitologis', 'pahlawan atau hero mitologi'],
                'makanan/kuliner': ['hidangan khas negara', 'chef terkenal', 'teknik memasak', 'bahan makanan unik', 'minuman khas'],
                'biologi/alam': ['spesies hewan unik', 'tumbuhan atau ekosistem', 'proses biologis', 'ilmuwan biologi terkenal', 'fakta evolusi'],
                'matematika': ['matematikawan terkenal', 'teorema atau konsep matematika', 'konstanta matematika', 'teka-teki matematika klasik', 'aplikasi matematika di dunia nyata']
            };

            const subTopics = subTopicPrompts[selectedCategory] || ['fakta unik', 'trivia menarik', 'pengetahuan umum'];
            const randomSubTopic = subTopics[Math.floor(Math.random() * subTopics.length)];

            console.log('[Trivia] Selected category:', selectedCategory);
            console.log('[Trivia] Sub-topic:', randomSubTopic);
            console.log('[Trivia] Recent topics:', recentTriviaTopics);

            const difficulties = ['mudah tapi gak terlalu mainstream', 'medium difficulty', 'agak challenging'];
            const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];

            const completion = await callGroqWithFallback(async (groq) => {
                return await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content:
                                'Kamu adalah quiz master yang membuat pertanyaan trivia yang akurat secara fakta. ' +
                                'Format harus:\n' +
                                'PERTANYAAN: [pertanyaan]\n' +
                                'JAWABAN: [jawaban sangat singkat, 1-2 kata]\n' +
                                'HINT: [hint jelas dan tidak membingungkan]\n' +
                                'EXPLANASI: [penjelasan singkat 1-2 kalimat, fakta asli]\n\n' +
                                'PENTING:\n' +
                                '- JANGAN PERNAH membuat pertanyaan yang terlalu umum atau terlalu sering muncul di quiz.\n' +
                                '- HINDARI pertanyaan cliche seperti "siapa vokalis Queen" atau "dewa laut Norse" atau "fenomena cahaya melewati celah".\n' +
                                '- Cari angle yang BERBEDA dan UNIK dari topik yang diminta.\n' +
                                '- Jawaban harus akurat dan ada dalam literatur resmi.\n' +
                                '- Jangan membuat istilah baru yang tidak ada.\n' +
                                '- Jika ada beberapa jawaban mungkin, pilih yang PALING umum dalam konteks topik.\n' +
                                '- Jangan menggunakan jawaban panjang, hanya 1-2 kata.\n' +
                                '- Jangan memasukkan kata "bukan", "tidak", atau pengulangan kata dalam jawaban.\n' +
                                '- Variasikan level kesulitan: kadang mudah, kadang medium, kadang challenging.\n' +
                                '- Untuk setiap kategori, explore berbagai aspek: jangan stuck di satu sub-topik.\n'
                        },
                        {
                            role: 'user',
                            content:
                                `Bikin 1 pertanyaan trivia tentang: ${selectedCategory}\n` +
                                `Fokus ke sub-topik: ${randomSubTopic}\n` +
                                `Level kesulitan: ${difficulty}\n\n` +
                                `PENTING: Jangan buat pertanyaan yang terlalu mainstream atau sering muncul. ` +
                                `Cari fakta unik, trivia menarik, atau angle berbeda yang jarang orang tahu.`
                        }
                    ],
                    temperature: 0.95,
                    max_completion_tokens: 200,
                });
            });

            const response = completion.choices?.[0]?.message?.content?.trim();

            if (!response) {
                return message.reply('Gagal bikin pertanyaan, coba lagi');
            }

            const questionMatch = response.match(/PERTANYAAN:\s*(.+?)(?=\n|$)/i);
            const answerMatch = response.match(/JAWABAN:\s*(.+?)(?=\n|$)/i);
            const hintMatch = response.match(/HINT:\s*(.+?)(?=\n|$)/i);
            const explanationMatch = response.match(/EXPLANASI:\s*(.+?)(?=\n|$)/i);

            if (!questionMatch || !answerMatch) {
                console.error('[Trivia] Parse error:', response);
                return message.reply('Gagal parse pertanyaan, coba lagi');
            }

            const question = questionMatch[1].trim();
            const answer = answerMatch[1].trim().toLowerCase();
            const hint = hintMatch ? hintMatch[1].trim() : 'Gak ada hint :stuck_out_tongue_winking_eye:';
            const explanation = explanationMatch ? explanationMatch[1].trim() : null;

            const triviaContent =
                `**🎯 TRIVIA TIME!**\n\n` +
                `**Pertanyaan:** ${question}\n\n` +
                `⏱️ Waktu: 30 detik\n` +
                `💡 Ketik jawaban lu langsung di chat!`;

            const triviaMsg = await message.channel.send(triviaContent);

            saveToChannelHistory(message.channel.id, triviaContent);

            activeTrivia.set(channelId, {
                answer: answer,
                hint: hint,
                explanation: explanation,
                askedBy: message.author.id,
                messageId: triviaMsg.id,
                startTime: Date.now(),
            });

            if (triviaTimers.has(channelId)) {
                clearTimeout(triviaTimers.get(channelId).hint);
                clearTimeout(triviaTimers.get(channelId).timeout);
            }

            const hintTimer = setTimeout(async () => {
                if (activeTrivia.has(channelId)) {
                    await message.channel.send(`💡 **Hint:** ${hint}`);
                }
            }, 15000);

            const timeoutTimer = setTimeout(async () => {
                if (!activeTrivia.has(channelId)) return;

                const triviaData = activeTrivia.get(channelId);
                activeTrivia.delete(channelId);

                let extra = triviaData.explanation
                    ? `\n🧠 ${triviaData.explanation}`
                    : '';

                const timeoutMsg =
                    `⏰ **Waktu habis!**\n` +
                    `Jawaban yang bener: **${triviaData.answer}**\n` +
                    `Gak ada yang bisa jawab, coba lagi ya!` +
                    extra;

                await message.channel.send(timeoutMsg);

                saveToChannelHistory(message.channel.id, timeoutMsg);
            }, 30000);

            triviaTimers.set(channelId, {
                hint: hintTimer,
                timeout: timeoutTimer,
            });

        } catch (err) {
            console.error('Trivia error:', err);
            return message.reply('Error pas bikin trivia, coba lagi');
        }
    },
};
