'use strict';

// Spotify → YouTube matcher dengan sistem scoring.
// Port dari Noctune backend/src/services/youtubeMatcher.ts, diadaptasi ke CommonJS.
// Logika: multi-query fallback + scoring → cache hasil ke JSON.

const fs = require('fs');
const path = require('path');
const { searchTracks } = require('./youtubeResolver');

// p-queue: concurrency control untuk matcher queue (cegah thundering herd)
let PQueue;
let matchQueue;

async function getMatchQueue() {
    if (!matchQueue) {
        const mod = await import('p-queue');
        PQueue = mod.default;
        matchQueue = new PQueue({ concurrency: 2 });
    }
    return matchQueue;
}

// ─── Cache persistence ────────────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, '../../data/spotify-youtube-map.json');
const CACHE_VERSION = 1;

function ensureCacheDir() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadMatchStore() {
    ensureCacheDir();
    if (!fs.existsSync(CACHE_FILE)) {
        return { version: CACHE_VERSION, updatedAt: Date.now(), matches: {} };
    }
    try {
        const loaded = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        if (loaded.version !== CACHE_VERSION) {
            return { version: CACHE_VERSION, updatedAt: Date.now(), matches: {} };
        }
        return loaded;
    } catch {
        return { version: CACHE_VERSION, updatedAt: Date.now(), matches: {} };
    }
}

function saveMatchStore(store) {
    ensureCacheDir();
    store.updatedAt = Date.now();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

let _matchStore = null;

function getMatchStore() {
    if (!_matchStore) _matchStore = loadMatchStore();
    return _matchStore;
}

// ─── Keyword Lists (ported from Noctune) ─────────────────────────────────────

const positiveTitleKeywords = [
    'official', 'official mv', 'official audio', 'official video',
    'official music video', 'official lyric video', 'music video',
    'lyric video', 'mv', 'original',
];

const positiveChannelKeywords = ['official', 'vevo', 'topic'];

const negativeKeywords = [
    'reaction', 'reacts', 'react', 'first time hearing', 'first time',
    'watching', 'review', 'breakdown', 'analysis', 'commentary',
    'trailer', 'movie', 'film', 'scene', 'clip', 'clips', 'shorts',
    'cover', 'covered', 'covers', 'covering', 'covered by',
    'ai cover', 'piano cover', 'piano version', 'piano arrangement',
    'piano instrumental', 'piano solo', 'instrumental cover',
    'guitar cover', 'guitar instrumental', 'drum cover', 'drums cover',
    'drum cam', 'drum playthrough', 'drum performance',
    'violin cover', 'orchestra cover', 'orchestral cover',
    'acoustic', 'acoustic cover', 'acoustic version', 'acoustic arrangement',
    'backing track', 'backtrack', 'minus one', 'off vocal', 'no vocal', 'no vocals',
    'sheet music', 'synthesia', 'parody', 'meme', 'karaoke', 'カラオケ',
    'instrumental', 'sped up', 'slowed', 'nightcore', 'tutorial', 'performance', '8d',
];

const instrumentalCoverKeywords = [
    'piano cover', 'piano version', 'piano arrangement', 'piano instrumental', 'piano solo',
    'instrumental cover', 'guitar cover', 'guitar instrumental',
    'drum cover', 'drums cover', 'drum cam', 'drum playthrough', 'drum performance',
    'violin cover', 'orchestra cover', 'orchestral cover',
    'acoustic', 'acoustic cover', 'acoustic version', 'acoustic arrangement',
    'backing track', 'backtrack', 'minus one', 'off vocal', 'no vocal', 'no vocals',
    'sheet music', 'synthesia',
];

const fanUploadKeywords = [
    'lyrics', 'rom', 'eng sub', 'sub indo', 'translation', 'translated',
    '中文', '翻譯', '字幕', 'sings', 'singing', 'sung by', 'covered by',
];

const liveVersionKeywords = [
    'live', 'live version', 'live performance', 'concert', 'stage', 'showcase', 'tour',
];

const alternateVersionKeywords = [
    'tv version', 'tv ver', 'tv size', 'television version',
    'short version', 'anime version', 'opening version', 'ending version',
    'op version', 'ed version',
];

// ─── String helpers ───────────────────────────────────────────────────────────

function normalize(value) {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function words(value) {
    return normalize(value).split(' ').filter(w => w.length > 1);
}

function hasKeyword(text, keyword) {
    if (keyword.length <= 3 || !keyword.includes(' ')) {
        return text.split(' ').includes(keyword);
    }
    return text.includes(keyword);
}

function keywordAllowed(keyword, spotifyTitle) {
    return hasKeyword(normalize(spotifyTitle), keyword);
}

function splitArtistNames(value) {
    return value
        .split(/,|&|\band\b|\bfeat\b|\bfeaturing\b|\sx\s/gi)
        .map(part => normalize(part))
        .filter(part => part.length > 1);
}

function titleWordStats(spotifyTitle, candidateTitle) {
    const titleWords = words(spotifyTitle);
    if (titleWords.length === 0) return { matched: 0, total: 0, ratio: 0 };
    const matched = titleWords.filter(word => candidateTitle.includes(word)).length;
    return { matched, total: titleWords.length, ratio: matched / titleWords.length };
}

function hasDateLikeTitle(value) {
    return (
        /\b(?:19|20)\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?\b/.test(value) ||
        /\b\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}\b/.test(value) ||
        /(?:19|20)\d{2}年\d{1,2}月(?:\d{1,2}日)?/.test(value)
    );
}

function hasLiveVisualSignal(value) {
    const lower = value.toLowerCase();
    return lower.includes('live映像') || lower.includes('ライブ映像') ||
        lower.includes('ライブ') || lower.includes('公演');
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a candidate YouTube track against a Spotify track.
 * @param {{ title: string, artist: string, duration: number, spotifyId?: string }} spotifyTrack
 * @param {{ title: string, artist: string, duration: number, id: string }} candidate
 */
function scoreCandidate(spotifyTrack, candidate) {
    const spotifyTitle = normalize(spotifyTrack.title);
    const spotifyArtist = normalize(spotifyTrack.artist);
    const candidateTitle = normalize(candidate.title);
    const candidateArtist = normalize(candidate.artist);
    const spotifyTitleCompact = spotifyTitle.replace(/\s+/g, '');
    const candidateTitleCompact = candidateTitle.replace(/\s+/g, '');
    const combined = `${candidateTitle} ${candidateArtist}`;
    const reasons = [];
    let score = 0;
    let hasArtistMatch = false;
    const titleStats = titleWordStats(spotifyTrack.title, candidateTitle);

    // Title word match
    if (titleStats.matched > 0) score += titleStats.matched * 10;
    if (titleStats.total > 0 && (titleStats.ratio >= 0.67 || titleStats.matched >= 3)) {
        reasons.push(`title-word-match:${titleStats.matched}/${titleStats.total}`);
    }

    // Artist/channel match
    for (const artistName of splitArtistNames(spotifyTrack.artist)) {
        if (candidateArtist.includes(artistName)) {
            hasArtistMatch = true;
            score += 90;
            reasons.push('artist-channel-match');
        } else if (artistName && combined.includes(artistName)) {
            score += 45;
            reasons.push('artist-match');
        }
    }

    // Title phrase match
    if (candidateTitle.includes(spotifyTitle)) {
        score += 60;
        reasons.push('title-phrase');
    }

    // Compact title match (handles CJK titles without spaces)
    if (spotifyTitleCompact.length >= 2 && spotifyTitleCompact !== spotifyTitle &&
        candidateTitleCompact.includes(spotifyTitleCompact)) {
        score += 60;
        reasons.push('title-compact');
    }

    // Positive title keywords
    for (const keyword of positiveTitleKeywords) {
        if (hasKeyword(candidateTitle, keyword)) {
            score += keyword.startsWith('official') ? 110
                : keyword === 'mv' || keyword === 'music video' ? 60
                : keyword === 'original' ? 45 : 30;
            reasons.push(`positive-title:${keyword}`);
        }
    }

    // Positive channel keywords
    for (const keyword of positiveChannelKeywords) {
        if (hasKeyword(candidateArtist, keyword)) {
            score += keyword === 'official' ? 80 : 55;
            reasons.push(`positive-channel:${keyword}`);
        }
    }

    // Negative keywords
    for (const keyword of negativeKeywords) {
        if (hasKeyword(combined, keyword) && !keywordAllowed(keyword, spotifyTrack.title)) {
            if ((keyword === 'film' || keyword === 'movie') && hasArtistMatch) {
                reasons.push(`ignored-negative:${keyword}`);
                continue;
            }
            const penalty = instrumentalCoverKeywords.includes(keyword) ? 240
                : keyword.includes('react') || keyword === 'reaction' ? 250
                : 120;
            score -= penalty;
            reasons.push(`negative:${keyword}`);
        }
    }

    // Fan upload detection
    const hasOfficialSignal = hasKeyword(candidateTitle, 'official') ||
        hasKeyword(candidateArtist, 'official') ||
        hasKeyword(candidateArtist, 'topic') ||
        hasKeyword(candidateArtist, 'vevo');

    for (const keyword of fanUploadKeywords) {
        if (hasKeyword(combined, keyword) && !hasOfficialSignal) {
            score -= keyword.includes('sing') ? 120 : 65;
            reasons.push(`fan-upload:${keyword}`);
        }
    }

    // Live version penalty
    for (const keyword of liveVersionKeywords) {
        if (hasKeyword(combined, keyword) && !keywordAllowed(keyword, spotifyTrack.title)) {
            score -= keyword === 'tour' ? 260 : 180;
            reasons.push(`live-version:${keyword}`);
        }
    }

    // Alternate version penalty
    for (const keyword of alternateVersionKeywords) {
        if (hasKeyword(combined, keyword) && !keywordAllowed(keyword, spotifyTrack.title)) {
            score -= 220;
            reasons.push(`alternate-version:${keyword}`);
        }
    }

    // Date-in-title penalty
    if (!hasDateLikeTitle(spotifyTrack.title) && hasDateLikeTitle(candidate.title)) {
        score -= 170;
        reasons.push('date-in-title');
    }

    // Japanese live visual signal
    if (hasLiveVisualSignal(candidate.title) && !hasLiveVisualSignal(spotifyTrack.title)) {
        score -= 210;
        reasons.push('live-visual');
    }

    // Duration match
    if (spotifyTrack.duration > 0 && candidate.duration > 0) {
        const diff = Math.abs(candidate.duration - spotifyTrack.duration);
        if (diff <= 5) {
            score += 90;
            reasons.push('duration-close');
        } else if (diff <= 15) {
            score += 50;
            reasons.push('duration-near');
        } else if (diff >= 45) {
            score -= diff >= 90 ? 110 : 70;
            reasons.push('duration-far');
        }
    }

    return { track: candidate, score, reasons };
}

function hasArtistChannelMatch(candidate) {
    return candidate.reasons.includes('artist-channel-match');
}

function hasTitleEvidence(candidate) {
    return (
        candidate.reasons.includes('title-phrase') ||
        candidate.reasons.includes('title-compact') ||
        candidate.reasons.some(r => r.startsWith('title-word-match:'))
    );
}

function isAcceptableCandidate(candidate) {
    return Boolean(candidate && candidate.score >= 100 && hasTitleEvidence(candidate));
}

function compareCandidates(a, b) {
    const aMatch = hasArtistChannelMatch(a);
    const bMatch = hasArtistChannelMatch(b);
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    return b.score - a.score;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function fromCache(spotifyTrack) {
    if (!spotifyTrack.spotifyId) return null;
    const cached = getMatchStore().matches[spotifyTrack.spotifyId];
    if (!cached) return null;

    // Rescore cached result to validate it's still acceptable
    const rescored = scoreCandidate(spotifyTrack, {
        ...spotifyTrack,
        id: cached.youtubeId,
        title: cached.youtubeTitle,
        artist: cached.youtubeArtist,
        duration: 0,
    });

    if (cached.score < 100 || !isAcceptableCandidate(rescored)) {
        console.log(`[matcher] cache rejected (rescore failed) spotifyId=${spotifyTrack.spotifyId}`);
        delete getMatchStore().matches[spotifyTrack.spotifyId];
        saveMatchStore(getMatchStore());
        return null;
    }

    console.log(`[matcher] cache hit spotifyId=${spotifyTrack.spotifyId} → ${cached.youtubeId} (score=${cached.score})`);
    return {
        ...spotifyTrack,
        id: cached.youtubeId,
        youtubeId: cached.youtubeId,
        youtubeTitle: cached.youtubeTitle,
        youtubeArtist: cached.youtubeArtist,
    };
}

function writeCache(spotifyTrack, candidate) {
    if (!spotifyTrack.spotifyId) return;
    const store = getMatchStore();
    store.matches[spotifyTrack.spotifyId] = {
        spotifyId: spotifyTrack.spotifyId,
        youtubeId: candidate.track.id,
        youtubeTitle: candidate.track.title,
        youtubeArtist: candidate.track.artist,
        score: candidate.score,
        matchedAt: Date.now(),
    };
    saveMatchStore(store);
}

// ─── Main matcher ─────────────────────────────────────────────────────────────

function stripPunctuation(value) {
    return value.replace(/[!?.…]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Match a Spotify track to the best YouTube result.
 * Cache hit → return immediately. Cache miss → multi-query search + score → writeCache.
 *
 * @param {{ title: string, artist: string, duration: number, spotifyId?: string }} spotifyTrack
 * @returns {Promise<Track | null>}
 */
async function matchSpotifyTrackToYoutube(spotifyTrack) {
    // 1. Cache check
    const cached = fromCache(spotifyTrack);
    if (cached) return cached;

    // 2. Build query variants (same strategy as Noctune)
    const titleOnly = stripPunctuation(spotifyTrack.title);
    const artistOnly = stripPunctuation(spotifyTrack.artist);
    const canonical = stripPunctuation(`${spotifyTrack.title} - ${spotifyTrack.artist}`);
    const titleWithoutSuffix = titleOnly.replace(/\s*[-–~|]\s*[^-–~|]+$/, '').trim();
    const asciiTitle = titleOnly.replace(/[^\x00-\x7F]/g, '').trim().replace(/\s+/g, ' ');
    const asciiArtist = artistOnly.replace(/[^\x00-\x7F]/g, '').trim().replace(/\s+/g, ' ');
    const asciiTitleOnly = asciiTitle.replace(/\s*[-–~|]\s*[^-–~|]+$/, '').trim();

    const queries = [...new Set([
        canonical, titleOnly,
        `${asciiTitle} ${artistOnly}`, `${asciiTitle} ${asciiArtist}`,
        asciiTitle, asciiTitleOnly,
        `${asciiTitleOnly} ${artistOnly}`, `${asciiTitleOnly} ${asciiArtist}`,
        artistOnly, asciiArtist,
    ].map(q => q.trim()))].filter(q => q.length > 0);

    // 3. Enqueue via p-queue (concurrency 2)
    const queue = await getMatchQueue();
    const result = await queue.add(async () => {
        const startedAt = Date.now();
        let accepted = null;
        let lastBest;
        let usedQuery = queries[0];
        let usedFallbackIndex = 0;

        for (const query of queries) {
            const candidates = await searchTracks(query, 12);
            const ranked = candidates
                .map(c => scoreCandidate(spotifyTrack, c))
                .sort(compareCandidates);

            const best = ranked[0];
            lastBest = best ?? lastBest;
            usedQuery = query;
            usedFallbackIndex = queries.indexOf(query);

            if (isAcceptableCandidate(best)) {
                accepted = best;
                break;
            }
        }

        console.log(`[matcher] spotify→youtube ${JSON.stringify({
            spotifyId: spotifyTrack.spotifyId,
            query: usedQuery,
            fallbackTried: usedFallbackIndex,
            bestId: accepted?.track.id ?? lastBest?.track.id,
            bestTitle: accepted?.track.title ?? lastBest?.track.title,
            score: accepted?.score ?? lastBest?.score,
            accepted: Boolean(accepted),
            elapsedMs: Date.now() - startedAt,
        })}`);

        if (!accepted) return null;

        writeCache(spotifyTrack, accepted);

        return {
            ...spotifyTrack,
            id: accepted.track.id,
            youtubeId: accepted.track.id,
            youtubeTitle: accepted.track.title,
            youtubeArtist: accepted.track.artist,
        };
    });

    return result ?? null;
}

/**
 * Match multiple Spotify tracks in parallel (each still queued internally).
 * @param {Array} tracks
 * @returns {Promise<Track[]>}
 */
async function matchSpotifyTracksToYoutube(tracks) {
    const matched = await Promise.all(tracks.map(t => matchSpotifyTrackToYoutube(t)));
    return matched.filter(Boolean);
}

// ─── Debug / management ───────────────────────────────────────────────────────

function getMatchCacheStats() {
    return { total: Object.keys(getMatchStore().matches).length };
}

module.exports = {
    matchSpotifyTrackToYoutube,
    matchSpotifyTracksToYoutube,
    getMatchCacheStats,
    scoreCandidate, // exposed for debug
};
