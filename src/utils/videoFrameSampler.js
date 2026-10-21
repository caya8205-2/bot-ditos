'use strict';

/**
 * Ekstraksi frame dari video sebagai fallback.
 *
 * Dipakai ketika model utama tidak bisa video DAN provider video belum
 * dikonfigurasi atau gagal. Beberapa frame diambil lalu digabung jadi satu
 * grid supaya model vision biasa tetap dapat gambaran isi video.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

const DEFAULT_FRAME_COUNT = 4;
const GRID_COLUMNS = 2;
const FRAME_MAX_DIMENSION = 640;

function runFfmpeg(args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const errChunks = [];
        let timer = null;

        child.stderr.on('data', (c) => errChunks.push(c));
        child.on('error', reject);
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString().slice(-300)}`));
        });

        timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`ffmpeg timeout setelah ${timeoutMs}ms`));
        }, timeoutMs);
    });
}

async function getVideoDuration(filePath) {
    return new Promise((resolve) => {
        const child = spawn(ffmpegPath, ['-i', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        child.stderr.on('data', (c) => chunks.push(c));
        child.on('close', () => {
            const text = Buffer.concat(chunks).toString();
            const match = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
            if (!match) return resolve(null);
            const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
            resolve(seconds);
        });
        child.on('error', () => resolve(null));
    });
}

/**
 * Ekstrak beberapa frame lalu gabung jadi satu gambar grid (JPEG data URL).
 * @returns {Promise<{dataUrl: string, frames: number}|null>}
 */
async function extractFrameGrid(videoUrl, options = {}) {
    const frameCount = options.frameCount || DEFAULT_FRAME_COUNT;
    const maxBytes = options.maxBytes
        || Number(process.env.VISION_VIDEO_DOWNLOAD_MAX_BYTES)
        || 100 * 1024 * 1024;
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ditos-vid-'));

    try {
        const videoPath = path.join(tmpDir, 'input.mp4');

        // Unduh video dulu karena ffmpeg butuh file lokal.
        // Batas ukuran mengikuti VISION_VIDEO_DOWNLOAD_MAX_BYTES supaya clip
        // Discord ~50MB tidak ditolak seperti batas 40MB sebelumnya.
        const axios = require('axios');
        const res = await axios.get(videoUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: maxBytes,
            maxBodyLength: maxBytes,
            headers: { 'User-Agent': 'BotDitos/2.2 (+discord)' },
        });
        await fsp.writeFile(videoPath, Buffer.from(res.data));

        const duration = await getVideoDuration(videoPath);
        const timestamps = [];

        if (duration && duration > 0.5) {
            // Ambil frame tersebar, hindari detik paling awal/akhir.
            for (let i = 0; i < frameCount; i++) {
                const t = duration * ((i + 1) / (frameCount + 1));
                timestamps.push(Math.max(0, Math.min(duration - 0.1, t)));
            }
        } else {
            timestamps.push(0);
        }

        const frames = [];
        for (let i = 0; i < timestamps.length; i++) {
            const outPath = path.join(tmpDir, `frame-${i}.jpg`);
            try {
                await runFfmpeg([
                    '-ss', String(timestamps[i]),
                    '-i', videoPath,
                    '-frames:v', '1',
                    '-vf', `scale=${FRAME_MAX_DIMENSION}:-2`,
                    '-y', outPath,
                ], 30000);
                const buf = await fsp.readFile(outPath);
                if (buf.length) frames.push(buf);
            } catch (err) {
                console.warn(`[VideoFrames] Frame ${i} gagal: ${err.message}`);
            }
        }

        if (!frames.length) return null;

        // Gabung jadi grid.
        const processed = await Promise.all(
            frames.map((buf) => sharp(buf)
                .resize(FRAME_MAX_DIMENSION, FRAME_MAX_DIMENSION, {
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .jpeg({ quality: 82 })
                .toBuffer()
                .then((b) => sharp(b).metadata().then((m) => ({ buf: b, width: m.width, height: m.height })))
            )
        );

        const cellW = Math.max(...processed.map((p) => p.width));
        const cellH = Math.max(...processed.map((p) => p.height));
        const rows = Math.ceil(processed.length / GRID_COLUMNS);
        const composites = processed.map((p, i) => ({
            input: p.buf,
            left: (i % GRID_COLUMNS) * cellW,
            top: Math.floor(i / GRID_COLUMNS) * cellH,
        }));

        const grid = await sharp({
            create: {
                width: cellW * GRID_COLUMNS,
                height: cellH * rows,
                channels: 3,
                background: { r: 20, g: 20, b: 20 },
            },
        })
            .composite(composites)
            .jpeg({ quality: 82 })
            .toBuffer();

        return {
            dataUrl: `data:image/jpeg;base64,${grid.toString('base64')}`,
            frames: processed.length,
        };
    } catch (error) {
        console.error('[VideoFrames] Gagal ekstrak frame:', error.message);
        return null;
    } finally {
        fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = {
    extractFrameGrid,
    getVideoDuration,
    DEFAULT_FRAME_COUNT,
};
