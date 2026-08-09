'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../../data/cache/audio');
const MAX_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // Limit 2 GB

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function getAudioFilePath(videoId) {
    ensureCacheDir();
    return path.join(CACHE_DIR, `${videoId}.opus`);
}

function hasAudioCache(videoId) {
    if (!videoId) return false;
    const filePath = getAudioFilePath(videoId);
    if (!fs.existsSync(filePath)) return false;
    try {
        const stats = fs.statSync(filePath);
        return stats.size > 50000; // Minimal 50KB untuk file audio yang valid
    } catch {
        return false;
    }
}

function pruneCacheIfNeeded() {
    try {
        ensureCacheDir();
        const files = fs.readdirSync(CACHE_DIR);
        let totalSize = 0;
        const fileStats = [];

        for (const file of files) {
            if (!file.endsWith('.opus')) continue;
            const fullPath = path.join(CACHE_DIR, file);
            try {
                const stat = fs.statSync(fullPath);
                totalSize += stat.size;
                fileStats.push({
                    file,
                    fullPath,
                    size: stat.size,
                    mtime: stat.mtimeMs,
                });
            } catch { }
        }

        if (totalSize > MAX_CACHE_SIZE_BYTES) {
            // Hapus yang paling lama tidak diakses (mtime terkecil)
            fileStats.sort((a, b) => a.mtime - b.mtime);
            for (const item of fileStats) {
                if (totalSize <= MAX_CACHE_SIZE_BYTES * 0.8) break; // Turunkan sampai 80% dari limit
                try {
                    fs.unlinkSync(item.fullPath);
                    totalSize -= item.size;
                    console.log(`[AudioCache] Menghapus cache lama: ${item.file}`);
                } catch { }
            }
        }
    } catch (err) {
        console.error('[AudioCache] Prune error:', err.message);
    }
}

module.exports = {
    getAudioFilePath,
    hasAudioCache,
    pruneCacheIfNeeded,
};
