const ytSearch = require('yt-search');
const ytdlExec = require('yt-dlp-exec');
const musicCache = require('./musicCache');

class MusicService {
    cleanString(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async searchTrack(query, artistName = '') {
        const startTime = Date.now();
        const baseQuery = this.cleanString(query);
        const artist = this.cleanString(artistName);

        // Construct optimized query
        let searchQuery = artist ? `${baseQuery} ${artist}` : baseQuery;
        console.log(`[MusicService] Search: "${searchQuery}"`);

        let results = [];

        try {
            const res = await ytSearch(searchQuery);
            if (res && res.videos.length > 0) {
                results = res.videos;
            } else {
                console.log('[MusicService] Fallback to Official...');
                const resOfficial = await ytSearch(`${searchQuery} official`);
                if (resOfficial && resOfficial.videos.length > 0) {
                    results = resOfficial.videos;
                }
            }

            if (results.length === 0) return null;

            // --- SCORING & FILTERING ---
            const targetTitle = baseQuery;
            const scored = results.map(video => {
                let score = 0;
                const title = this.cleanString(video.title);
                const channel = this.cleanString(video.author.name);
                const rawTitle = video.title.toLowerCase();

                // Base Relevance (Token based)
                const targetTokens = targetTitle.split(' ');
                const titleTokens = title.split(' ');

                let matchedTokens = 0;
                for (const token of targetTokens) {
                    if (title.includes(token)) matchedTokens++;
                }

                // If >50% tokens matched, good score
                if (matchedTokens / targetTokens.length > 0.5) score += 50;
                if (title.includes(targetTitle)) score += 100; // Perfect phrase match

                // Official / Topic Boost
                if (channel.includes('topic') || channel.includes('vevo')) score += 80;
                if (rawTitle.includes('official')) score += 50;
                if (rawTitle.includes('audio')) score += 30; // "Official Audio" is good

                // Artist Match Boost - More lenient
                if (artist) {
                    if (channel.includes(artist)) score += 150; // Strong boost for channel match
                    else if (title.includes(artist)) score += 80;
                }

                // Penalties for Reviews/Reactions/Karaoke
                if (rawTitle.includes('reaction') || rawTitle.includes('react')) score -= 1000;
                if (rawTitle.includes('review')) score -= 1000;
                if (rawTitle.includes('karaoke') || rawTitle.includes('off vocal') || rawTitle.includes('instrumental')) score -= 1000;
                if (rawTitle.includes('cover') && !targetTitle.includes('cover')) score -= 500; // Only penalize cover if user didn't ask for it
                if (rawTitle.includes('lesson') || rawTitle.includes('tutorial')) score -= 1000;
                if (rawTitle.includes('live') && !targetTitle.includes('live')) score -= 50; // Prefer studio version

                return { video, score };
            });

            // Sort by Score Descending
            scored.sort((a, b) => b.score - a.score);

            const best = scored[0];
            console.log(`[MusicService] Best Match: "${best.video.title}" (Score: ${best.score}) by ${best.video.author.name}`);

            return {
                videoId: best.video.videoId,
                title: best.video.title,
                url: best.video.url,
                duration: best.video.duration
            };

        } catch (err) {
            console.error('[MusicService] Search Error:', err);
            return null;
        }
    }

    async getStreamUrl(videoId) {
        const cached = musicCache.getStream(videoId);
        if (cached) {
            console.log(`[MusicService] Stream Cache Hit: ${videoId}`);
            return cached;
        }

        // 2. Fetch via yt-dlp
        console.log(`[MusicService] Fetching fresh stream for ${videoId}...`);
        const startTime = Date.now();

        try {
            const url = `https://www.youtube.com/watch?v=${videoId}`;

            const output = await ytdlExec(url, {
                dumpSingleJson: true,
                noWarnings: true,
                noCheckCertificates: true,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true,
                forceIpv4: true
            });

            let streamUrl = null;
            const formats = output.formats || [];
            formats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
            const audioOnly = formats.find(f => f.acodec !== 'none' && f.vcodec === 'none');

            if (audioOnly) {
                streamUrl = audioOnly.url;
            } else {
                streamUrl = output.url;
            }

            if (!streamUrl) throw new Error('No stream URL found');

            // 3. Save to Cache
            musicCache.setStream(videoId, streamUrl);
            console.log(`[MusicService] Stream Fetched in ${Date.now() - startTime}ms`);

            return streamUrl;

        } catch (err) {
            console.error(`[MusicService] Stream Fetch Failed for ${videoId}:`, err.message);
            throw err;
        }
    }
}

module.exports = new MusicService();
