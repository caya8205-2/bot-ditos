const fs = require('fs');
const path = require('path');

const music = new Map();
const musicQueues = new Map();
const songCache = new Map();
const conversationHistory = new Map();
const channelHistory = new Map();
const activeTrivia = new Map();
const triviaTimers = new Map();
const recentTriviaTopics = [];
const CACHE_FILE = path.join(__dirname, 'songCache.json');

try {
    if (fs.existsSync(CACHE_FILE)) {
        const data = fs.readFileSync(CACHE_FILE, 'utf8');
        const json = JSON.parse(data);
        for (const [key, value] of Object.entries(json)) {
            songCache.set(key, value);
        }
        console.log(`[Cache] Loaded ${songCache.size} songs from disk.`);
    }
} catch (err) {
    console.error('[Cache] Failed to load cache:', err);
}

function saveSongToCache(key, value) {
    songCache.set(key, value);
    const obj = Object.fromEntries(songCache);
    fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), (err) => {
        if (err) console.error('[Cache] Failed to save:', err);
    });
}

let MEMORY_DATA = {};
let globalTriviaScore = {};
let settings = {};
const aiState = {
    loopActive: false,
    lastBotWhoSpoke: null,
    topicIndex: 0
};

const botActivityTracker = new Map();
const lastUserActivity = new Map();

module.exports = {
    music,
    musicQueues,
    songCache,
    saveSongToCache,
    conversationHistory,
    channelHistory,
    activeTrivia,
    triviaTimers,
    recentTriviaTopics,
    aiState,
    botActivityTracker,
    lastUserActivity,

    get memoryData() { return MEMORY_DATA; },
    setMemoryData: (data) => { MEMORY_DATA = data; },

    get triviaScore() { return globalTriviaScore; },
    setTriviaScore: (data) => { globalTriviaScore = data; },

    get settings() { return settings; },
    setSettings: (data) => { settings = data; }
};
