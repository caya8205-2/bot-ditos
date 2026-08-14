const { EmbedBuilder } = require('discord.js');
const { callLLMWithFallback, LLM_MODEL, getActiveChatModelInfo } = require('../../utils/llmManager');
const { fetchAndProcessImage, analyzeImageWithGemini } = require('../../utils/geminiManager');
const { OWNER_ID } = require('../../config');

module.exports = {
    name: 'ocr',
    description: 'Extract text dari gambar',
    aliases: [],
    async execute(message, args, client) {
        if (message.attachments.size === 0) {
            const usageEmbed = new EmbedBuilder()
                .setTitle('📸 OCR - Text Extraction')
                .setColor('#00D9FF')
                .setDescription(
                    'Extract text dari gambar pakai Model Vision / OCR!\n\n' +
                    '**Cara pakai:**\n' +
                    '1. Upload gambar (screenshot, foto dokumen, meme, dll)\n' +
                    '2. Ketik `d!ocr` di caption atau setelah upload\n\n' +
                    '**Supported:**\n' +
                    '✅ Screenshot code\n' +
                    '✅ Meme dengan text\n' +
                    '✅ Dokumen/nota\n' +
                    '✅ Handwriting (tergantung kejelasan)\n' +
                    '✅ Multi-language'
                )
                .addFields(
                    {
                        name: '💡 Tips',
                        value:
                            '• Pastikan gambar jelas dan tidak blur\n' +
                            '• Text yang terlalu kecil mungkin susah dibaca\n' +
                            '• Bisa combine dengan `d!translate` buat translate hasil OCR',
                        inline: false
                    }
                )
                .setFooter({ text: 'Powered by Vision & Gemini API' });

            return message.reply({ embeds: [usageEmbed] });
        }

        const attachment = message.attachments.first();

        if (!attachment.contentType?.startsWith('image/')) {
            return message.reply('Harus gambar ya, bukan file lain. Upload gambar dulu!');
        }

        try {
            await message.channel.send('🔍 Bentar, lagi baca textnya...');

            const ocrInstruction =
                'Extract ALL text from this image. ' +
                'Return ONLY the extracted text, preserve the original formatting and line breaks. ' +
                'If there is no text in the image, respond with "[No text found]". ' +
                'Do not add any commentary or explanation, just the text itself.';

            const activeModel = getActiveChatModelInfo();
            let extractedText = null;

            // 1. Coba gunakan model utama jika support vision
            if (activeModel.supportsVision) {
                try {
                    console.log(`[OCR] Menggunakan direct vision dari model chat (${activeModel.model})...`);
                    const imageInfo = await fetchAndProcessImage(attachment.url);

                    const completion = await callLLMWithFallback(async (llmClient) => {
                        return await llmClient.chat.completions.create({
                            model: LLM_MODEL,
                            messages: [
                                {
                                    role: 'user',
                                    content: [
                                        {
                                            type: 'text',
                                            text: ocrInstruction,
                                        },
                                        {
                                            type: 'image_url',
                                            image_url: {
                                                url: imageInfo.dataUrl,
                                            },
                                        },
                                    ],
                                },
                            ],
                            temperature: 0,
                            max_tokens: 1500,
                        });
                    });

                    extractedText = completion.choices?.[0]?.message?.content?.trim();
                } catch (directVisionErr) {
                    console.warn(`[OCR] Gagal OCR dengan model utama (${activeModel.model}), fallback ke Gemini Vision:`, directVisionErr.message);
                    extractedText = null;
                }
            }

            // 2. Fallback atau jika model chat tidak support vision -> lempar ke Gemini Vision adapter
            if (!extractedText) {
                console.log('[OCR] Melempar OCR ke Gemini Vision adapter...');
                extractedText = await analyzeImageWithGemini(attachment.url, ocrInstruction);
            }

            if (!extractedText || extractedText.trim() === '') {
                return message.reply('❌ Gak nemu text di gambar ini. Mungkin gambarnya blur atau emang gak ada text.');
            }

            if (extractedText.includes('[No text found]')) {
                return message.reply('❌ Gak ada text yang bisa di-extract dari gambar ini.');
            }

            const resultText = extractedText.trim();
            const MAX_LENGTH = 1800;

            if (resultText.length <= MAX_LENGTH) {
                return message.reply(
                    `📝 **Text yang gue temukan:**\n\`\`\`\n${resultText}\n\`\`\`\n\n` +
                    `💡 *Total: ${resultText.length} karakter*`
                );
            } else {
                const chunks = [];
                let currentChunk = '';
                const lines = resultText.split('\n');

                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > MAX_LENGTH) {
                        chunks.push(currentChunk);
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }

                if (currentChunk) chunks.push(currentChunk);

                await message.reply(
                    `📝 **Text yang gue temukan (Part 1/${chunks.length}):**\n\`\`\`\n${chunks[0]}\n\`\`\``
                );

                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(
                        `📝 **Part ${i + 1}/${chunks.length}:**\n\`\`\`\n${chunks[i]}\n\`\`\``
                    );
                }

                await message.channel.send(
                    `✅ **Done!** Total: ${resultText.length} karakter`
                );
            }

        } catch (error) {
            console.error('OCR command error:', error);

            if (error.message?.includes('Gemini timeout')) {
                return message.reply(
                    '⏱️ Gemini timeout pas analisa gambar. Coba upload gambar yang lebih kecil atau coba lagi.'
                );
            }

            if (error.message?.includes('rate_limit')) {
                return message.reply(
                    '⚠️ Kena rate limit. Tunggu sebentar ya (~1 menit).'
                );
            }

            return message.reply(
                `❌ Error pas extract text: ${error.message}\n` +
                `Coba lagi atau lapor ke <@${OWNER_ID}> ya!`
            );
        }
    },
};
