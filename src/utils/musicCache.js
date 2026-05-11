const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../data/songCache.json');

class MusicCache {
    constructor() {
        this.learningCache = new Map();
        this.streamCache = new Map();
        this.load();
    }

    setStream(videoId, url) {
        this.streamCache.set(videoId, {
            url,
            expires: Date.now() + (6 * 60 * 60 * 1000)
        });
    }

    getStream(videoId) {
        const item = this.streamCache.get(videoId);
        if (!item) return null;

        if (Date.now() > item.expires) {
            this.streamCache.delete(videoId);
            return null;
        }
        return item.url;
    }

    // Maps a Spotify Track ID to a known "correct" YouTube Video ID
    setLearnedMatch(spotifyId, videoId) {
        if (!spotifyId || !videoId) return;
        this.learningCache.set(spotifyId, videoId);
        this.save();
    }

    getLearnedMatch(spotifyId) {
        return this.learningCache.get(spotifyId);
    }

    // --- PERSISTENCE ---
    load() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

                if (data.learningCache) {
                    this.learningCache = new Map(Object.entries(data.learningCache));
                } else {
                    for (const [key, value] of Object.entries(data)) {
                        // If value looks like a video ID (11 chars)
                        if (typeof value === 'string' && value.length === 11) {
                            this.learningCache.set(key, value);
                        }
                        // If it's a full URL, extract ID
                        else if (typeof value === 'string' && (value.includes('youtube.com') || value.includes('youtu.be'))) {
                            let id = null;
                            if (value.includes('v=')) id = value.split('v=')[1].split('&')[0];
                            else if (value.includes('youtu.be/')) id = value.split('youtu.be/')[1].split('?')[0];

                            if (id) this.learningCache.set(key, id);
                        }
                    }
                }

                console.log(`[MusicCache] Loaded ${this.learningCache.size} learned matches.`);
            }
        } catch (err) {
            console.error('[MusicCache] Failed to load cache:', err);
        }
    }

    save() {
        try {
            // We save safely in a structure that allows expansion
            const data = {
                learningCache: Object.fromEntries(this.learningCache),
                lastSaved: new Date().toISOString()
            };

            // Async write to not block event loop
            fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), (err) => {
                if (err) console.error('[MusicCache] Save failed:', err);
            });
        } catch (err) {
            console.error('[MusicCache] Save failed (Sync):', err);
        }
    }
}

module.exports = new MusicCache();
