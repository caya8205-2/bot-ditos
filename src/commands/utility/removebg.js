const axios = require('axios');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const REMOVE_BG_URL = process.env.BIREFNET_URL || 'http://127.0.0.1:8765/remove-bg';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

module.exports = {
    name: 'removebg',
    description: 'Hapus background gambar',
    aliases: ['mbg'],
    async execute(message) {
        const attachment = message.attachments.find((item) => {
            const extension = path.extname(new URL(item.url).pathname).toLowerCase();
            return item.contentType?.startsWith('image/') || SUPPORTED_EXTENSIONS.has(extension);
        });

        if (!attachment) {
            return message.reply('Lampirkan gambar PNG, JPG, atau WEBP dengan command `d!removebg`.');
        }

        const extension = path.extname(new URL(attachment.url).pathname).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(extension)) {
            return message.reply('Format yang didukung: PNG, JPG, dan WEBP.');
        }

        if (attachment.size > MAX_IMAGE_BYTES) {
            return message.reply('Ukuran gambar maksimal 15 MB.');
        }

        const status = await message.reply('Sedang menghapus background…');

        try {
            const image = await axios.get(attachment.url, {
                responseType: 'arraybuffer',
                timeout: 60_000,
                maxContentLength: MAX_IMAGE_BYTES,
            });

            const result = await axios.post(REMOVE_BG_URL, Buffer.from(image.data), {
                headers: { 'Content-Type': 'application/octet-stream' },
                responseType: 'arraybuffer',
                timeout: 5 * 60_000,
                maxBodyLength: MAX_IMAGE_BYTES,
                maxContentLength: 25 * 1024 * 1024,
            });

            const output = new AttachmentBuilder(Buffer.from(result.data), {
                name: `${path.parse(attachment.name).name || 'ditos-cutout'}.png`,
            });
            return status.edit({ content: 'Selesai—background sudah dihapus.', files: [output] });
        } catch (error) {
            console.error('[removebg] Gagal memproses gambar:', error.message);

            if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
                return status.edit('Service BiRefNet lokal belum siap. Pastikan Python service berhasil dimuat saat bot dijalankan.');
            }

            if (error.response?.status === 413) {
                return status.edit('Gambar terlalu besar untuk diproses. Coba kirim gambar yang lebih kecil.');
            }

            return status.edit('Gagal menghapus background. Cek log service BiRefNet untuk detail error.');
        }
    },
};
