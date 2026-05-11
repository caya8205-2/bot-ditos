const { EmbedBuilder } = require('discord.js');
const { analyzeImageWithGemini } = require('../../utils/geminiManager');
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
                    'Extract text dari gambar pakai Gemini Vision!\n\n' +
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
                .setFooter({ text: 'Powered by Gemini Vision API' });

            return message.reply({ embeds: [usageEmbed] });
        }

        const attachment = message.attachments.first();

        if (!attachment.contentType?.startsWith('image/')) {
            return message.reply('Harus gambar ya, bukan file lain. Upload gambar dulu!');
        }

        try {
            await message.channel.send('🔍 Bentar, lagi baca textnya...');

            const prompt =
                'Extract ALL text from this image. ' +
                'Return ONLY the extracted text, preserve the original formatting and line breaks. ' +
                'If there is no text in the image, respond with "[No text found]". ' +
                'Do not add any commentary or explanation, just the text itself.';

            const extractedText = await analyzeImageWithGemini(attachment.url, prompt);

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
                    '⚠️ Kena rate limit dari Gemini. Tunggu sebentar ya (~1 menit).'
                );
            }

            return message.reply(
                `❌ Error pas extract text: ${error.message}\n` +
                `Coba lagi atau lapor ke <@${OWNER_ID}> ya!`
            );
        }
    },
};
