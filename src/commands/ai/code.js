const { EmbedBuilder } = require('discord.js');
const { callGroqWithFallback } = require('../../utils/groqManager');
const { replyEmbedAndSave } = require('../../utils/helpers');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

module.exports = {
    name: 'code',
    description: 'Bantu ngoding',
    aliases: ['dev'],
    async execute(message, args, client) {
        const action = args[0]?.toLowerCase();
        const validActions = ['ask', 'debug', 'explain', 'refactor', 'review'];

        // Helper function untuk extract code dari markdown
        function extractCode(text) {
            const codeBlockMatch = text.match(/```[\s\S]*?\n([\s\S]*?)```/);
            if (codeBlockMatch) {
                return codeBlockMatch[1].trim();
            }
            return text.trim();
        }

        // USAGE INFO
        if (!action || !validActions.includes(action)) {
            const usageEmbed = new EmbedBuilder()
                .setTitle('💻 Code Assistant - Usage')
                .setColor('#5865F2')
                .setDescription(
                    'Bot Ditos bisa bantu lu coding! Pakai sub-command berikut:\n\n' +
                    '**Available Commands:**'
                )
                .addFields(
                    {
                        name: '🔍 d!code ask',
                        value: 'Tanya soal coding, konsep, atau best practice\nContoh: `d!code ask cara bikin async function di JS`',
                        inline: false
                    },
                    {
                        name: '🐛 d!code debug',
                        value: 'Debug code yang error\nContoh: `d!code debug` lalu paste code kamu',
                        inline: false
                    },
                    {
                        name: '📖 d!code explain',
                        value: 'Jelasin cara kerja code\nContoh: `d!code explain` lalu paste code',
                        inline: false
                    },
                    {
                        name: '✨ d!code refactor',
                        value: 'Improve code quality & performance\nContoh: `d!code refactor` lalu paste code',
                        inline: false
                    },
                    {
                        name: '👀 d!code review',
                        value: 'Review code + kasih saran improvement\nContoh: `d!code review` lalu paste code',
                        inline: false
                    }
                )
                .setFooter({ text: 'Tip: Support markdown code blocks (```code```)' });

            return replyEmbedAndSave(message, { embeds: [usageEmbed] });
        }

        try {
            const now = new Date();
            const localTime = now.toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric"
            }) + " " + now.toLocaleTimeString("id-ID");

            // Get input text (everything after the action)
            let inputText = args.slice(1).join(' ').trim();

            // Check if user attached a file (for code snippets)
            if (message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment.contentType?.startsWith('text/')) {
                    try {
                        const response = await fetch(attachment.url);
                        const fileContent = await response.text();
                        inputText = fileContent;
                    } catch (err) {
                        console.error('File read error:', err);
                    }
                }
            }

            if (!inputText) {
                return message.reply(
                    `Kasih input dong! Contoh:\n` +
                    `\`d!code ${action} cara pakai async/await\`\n` +
                    `atau paste code kamu langsung (support markdown \`\`\`code\`\`\`)`
                );
            }

            // Extract code if in markdown format
            const codeContent = extractCode(inputText);

            // Build system prompt based on action
            let systemPrompt = '';
            let userPrompt = '';

            switch (action) {
                case 'ask':
                    systemPrompt =
                        "Waktu sekarang: " + localTime + "\n" +
                        "Kamu adalah senior software engineer yang expert di berbagai bahasa programming. " +
                        "Kamu adalah Bot Ditos dalam mode 'Code Ask'.\n" +
                        "Gaya bicara santai, casual, campur Indonesia + English.\n" +
                        "Pakai 'gue' dan 'lu'/'luwh', jangan aku/kamu.\n" +
                        "Sedikit nyeletuk boleh, tapi tetep jelas.\n\n" +
                        "Tugas kamu:\n" +
                        "- Jawab pertanyaan soal coding atau konsep programming\n" +
                        "- Jelasin dengan cara yang gampang dicerna\n" +
                        "- Boleh kasih contoh code yang praktis\n\n" +
                        "- Jelasin konsep coding dengan cara yang mudah dipahami, kasih contoh code yang praktis. " +
                        "- Jangan terlalu formal, tapi tetep akurat secara teknis. " +
                        "- Fokus ke solusi praktis yang bisa langsung dipake.";
                    "Batasan:\n" +
                        "- Jangan sok textbook\n" +
                        "- Jangan terlalu formal\n" +
                        "- Jangan masukin emoji ke dalam code block\n" +
                        "- 1 emoji custom boleh di luar code block maksimum.";
                    userPrompt = inputText; // Use inputText for 'ask' as it might not be code
                    break;

                case 'debug':
                    systemPrompt =
                        "Waktu sekarang: " + localTime + "\n" +
                        "Kamu adalah debugging expert yang bisa identify dan fix bugs dengan cepat. " +
                        "Kamu adalah Bot Ditos dalam mode 'Code Debug'.\n" +
                        "Pakai 'gue' dan 'lu'/'luwh', jangan aku/kamu.\n" +
                        "Kamu santai, nyeletuk halus kalau error-nya basic, tapi tetep bantu.\n" +
                        "Tetap campur Indo + English, to the point.\n\n" +
                        "Tugas kamu:\n" +
                        "1. Identify error atau potential bugs\n" +
                        "2. Jelasin kenapa error itu terjadi (root cause)\n" +
                        "3. Kasih solusi/fixed code yang langsung bisa dipake\n" +
                        "4. Kasih tips biar gak error lagi di future\n\n" +
                        "Tone: semi-nyolot tapi tetap solutif. Jangan formal textbook.";
                    "Format jawaban:\n" +
                        "❌ PROBLEM: [penjelasan error]\n" +
                        "💡 ROOT CAUSE: [kenapa error]\n" +
                        "✅ SOLUTION: [code yang udah difix]\n" +
                        "📌 TIPS: [best practice]";
                    userPrompt = `Debug code ini:\n\`\`\`\n${codeContent}\n\`\`\``;
                    break;

                case 'explain':
                    systemPrompt =
                        "Waktu sekarang: " + localTime + "\n" +
                        "Kamu adalah code explainer yang bisa jelasin code dengan cara yang gampang dimengerti. " +
                        "Kamu adalah Bot Ditos dalam mode 'Code Explain'.\n" +
                        "Gaya: casual, friendly, kayak ngajarin temen.\n" +
                        "Pakai 'gue' dan 'lu'/'luwh', jangan aku/kamu.\n" +
                        "Tugas kamu:\n" +
                        "1. Jelasin cara kerja code step by step\n" +
                        "2. Highlight bagian-bagian penting\n" +
                        "3. Jelasin konsep yang mungkin belum dipahami\n" +
                        "4. Kasih analogi atau contoh real-world kalo perlu\n\n" +
                        "Jangan copas code-nya lagi, fokus ke PENJELASAN.";
                    userPrompt = `Jelasin cara kerja code ini:\n\`\`\`\n${codeContent}\n\`\`\``;
                    break;

                case 'refactor':
                    systemPrompt =
                        "Waktu sekarang: " + localTime + "\n" +
                        "Kamu adalah code refactoring specialist yang fokus ke clean code & performance. " +
                        "Kamu adalah Bot Ditos dalam mode 'Code Refactor'.\n" +
                        "Gaya ngomong santai, confident sedikit nyeletuk, tapi tetep jelas.\n" +
                        "Pakai 'gue' dan 'lu'/'luwh', jangan aku/kamu.\n" +
                        "Tugas kamu:\n" +
                        "1. Improve code quality (readability, maintainability)\n" +
                        "2. Optimize performance kalo ada bottleneck\n" +
                        "3. Apply best practices & design patterns yang cocok\n" +
                        "4. Jelasin perubahan yang kamu buat dan alasannya\n\n" +
                        "Batasan:\n" +
                        "- Code dalam blok ``` tanpa emoji\n" +
                        "- 1 emoji custom boleh di luar code\n" +
                        "- Jelasin point-point refactor-nya.";
                    userPrompt = `Refactor code ini:\n\`\`\`\n${codeContent}\n\`\`\``;
                    break;

                case 'review':
                    systemPrompt =
                        "Waktu sekarang: " + localTime + "\n" +
                        "Kamu adalah code reviewer yang teliti dan berpengalaman. " +
                        "Kamu adalah Bot Ditos dalam mode 'Code Review'.\n" +
                        "Gaya: constructive, direct, supportive.\n" +
                        "Pakai 'gue' dan 'lu'/'luwh', jangan aku/kamu.\n" +
                        "Tugas kamu:\n" +
                        "1. Analisis code structure dan logic\n" +
                        "2. Identify potential issues (bugs, security, performance)\n" +
                        "3. Kasih saran improvement yang concrete\n" +
                        "4. Rate code quality (1-10) dengan alasan singkat\n\n" +
                        "Format:\n" +
                        "📊 SCORE: [1-10]/10\n" +
                        "🔍 ANALYSIS: [analisis singkat]\n" +
                        "⚠️ ISSUES: [jika ada]\n" +
                        "✨ SUGGESTIONS: [saran improvement]";
                    userPrompt = `Review code ini:\n\`\`\`\n${codeContent}\n\`\`\``;
                    break;
            }

            await message.reply(`👨‍💻 **Code ${action.charAt(0).toUpperCase() + action.slice(1)}** sedang diproses...`);

            const completion = await callGroqWithFallback(async (groq) => {
                return await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.3,
                    max_completion_tokens: 1000,
                });
            });

            const response = completion.choices?.[0]?.message?.content?.trim();

            if (!response) {
                return message.reply('Gagal dapet respon dari AI, coba lagi nanti.');
            }

            // Split response if too long (> 2000)
            if (response.length > 2000) {
                // Simple splitting logic (similar to chat command)
                const parts = response.match(/[\s\S]{1,1900}/g) || [response];
                for (const part of parts) {
                    await message.channel.send(part);
                }
            } else {
                await replyEmbedAndSave(message, response);
            }

        } catch (err) {
            console.error('Code command error:', err);
            return message.reply('Ada error pas proses code command.');
        }
    },
};
