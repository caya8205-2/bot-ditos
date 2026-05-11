const fs = require('fs');
const fsp = fs.promises;
const { EmbedBuilder } = require('discord.js');
const { channelHistory, setMemoryData, setTriviaScore } = require('../data/state');
const { MEMORY_FILE } = require('../config');
const path = require('path');
const TRIVIA_FILE_PATH = path.join(__dirname, '../../trivia-score.json');

const MAX_CHANNEL_HISTORY = 50;

function normalizeTrivia(text) {
    if (!text) return "";
    return text
        .trim()
        .toLowerCase()
        .replace(/[_\-]+/g, ' ')
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ");
}

function levenshtein(a, b) {
    const al = a.length;
    const bl = b.length;
    const matrix = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));

    for (let i = 0; i <= al; i++) matrix[i][0] = i;
    for (let j = 0; j <= bl; j++) matrix[0][j] = j;

    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[al][bl];
}

function similarity(a, b) {
    const na = normalizeTrivia(a);
    const nb = normalizeTrivia(b);

    const maxLen = Math.max(na.length, nb.length);
    if (maxLen === 0) return 0;

    const dist = levenshtein(na, nb);
    return 1 - dist / maxLen;
}

function isTriviaCorrect(userAnswer, correctAnswer) { // Cek jawaban benar (exact match + fuzzy match)
    const u = normalizeTrivia(userAnswer);
    const c = normalizeTrivia(correctAnswer);

    // exact match
    if (u === c) return true;

    // fuzzy match >= 70%
    if (similarity(u, c) >= 0.7) return true;

    return false;
}

function getLevelFromXP(xp) { // XP Rules
    return Math.floor(Math.sqrt(xp / 10));
}

function awardTriviaXP(userId, username, amount) { // Leaderboard
    const { triviaScore } = require('../data/state');

    if (!triviaScore[userId]) {
        triviaScore[userId] = {
            userId,
            username,
            xp: 0,
            correct: 0
        };
    }

    const userData = triviaScore[userId];
    userData.xp += amount;
    userData.correct += 1;

    return userData;
}

const { ERROR_CHANNEL_ID, OWNER_ID } = require('../config');

async function reportErrorToDiscord(client, err) { // Error message
    try {
        const channel = await client.channels.fetch(ERROR_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) return;

        const raw =
            err instanceof Error
                ? (err.stack || err.message || String(err))
                : String(err);

        const snippet =
            raw.length > 1500 ? raw.slice(0, 1500) + '\n...[dipotong]...' : raw;

        await channel.send({
            content: `Seseorang bilangin <@${OWNER_ID}> kalo bot nya error.\n\`\`\`\n${snippet}\n\`\`\``,
        });
    } catch (reportErr) {
        console.error('Gagal kirim laporan error ke Discord:', reportErr);
    }
}

function createStatusEmbed({ // Universal embed creator
    title = 'Status',
    description = ' ',
    fields = [],
    color = '#4CAF50',
}) {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(description)
        .addFields(...fields)
        .setTimestamp();
}

function createGroqStatusEmbed(meta) { // Limit check pake embed
    const reqLimit = meta['ratelimit-limit-requests'] ?? 'N/A';
    const reqRemaining = meta['ratelimit-remaining-requests'] ?? 'N/A';
    const reqReset = meta['ratelimit-reset-requests'] ?? 'N/A';

    const tokLimit = meta['ratelimit-limit-tokens'] ?? 'N/A';
    const tokRemaining = meta['ratelimit-remaining-tokens'] ?? 'N/A';
    const tokReset = meta['ratelimit-reset-tokens'] ?? 'N/A';

    // otomatis warna
    let color = '#4CAF50'; // hijau
    if (reqRemaining < reqLimit * 0.4) color = '#FFC107'; // kuning
    if (reqRemaining < reqLimit * 0.1) color = '#E53935'; // merah

    return createStatusEmbed({
        title: '🌐 Groq API Status',
        color,
        description: 'Groq API **aktif dan bisa dipake**.',
        fields: [
            {
                name: '🔢 Requests',
                value: `${reqRemaining}/${reqLimit}\nReset: ${reqReset}s`,
                inline: true,
            },
            {
                name: '🧮 Tokens',
                value: `${tokRemaining}/${tokLimit}\nReset: ${tokReset}s`,
                inline: true,
            },
        ],
    });
}

function createGroqRateLimitEmbed(timeLeft) { // Token limit/waktu sampai reset token
    return createStatusEmbed({
        title: '❌ Groq Rate Limit',
        color: '#E53935',
        description: timeLeft
            ? `Kamu kena **rate limit**.\nCoba lagi dalam **${timeLeft}s**.`
            : 'Kena rate limit tapi Groq tidak memberi info cooldown.',
    });
}

function createGroqErrorEmbed(err) { // Token err catch
    return createStatusEmbed({
        title: '⚠️ Error Groq API',
        color: '#FBC02D',
        description: `Terjadi error:\n\`\`\`${err.message}\`\`\``,
    });
}

async function fetchGroqLimits(model) { // Cek limit API
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model ?? "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5
        })
    });

    const status = res.status;

    let json = null;
    try {
        json = await res.json();
    } catch { }

    // header might not exist, so fallback to null safely
    const limits = {
        reqLimit: res.headers.get("x-ratelimit-limit-requests"),
        reqRemaining: res.headers.get("x-ratelimit-remaining-requests"),
        reqReset: res.headers.get("x-ratelimit-reset-requests"),

        tokLimit: res.headers.get("x-ratelimit-limit-tokens"),
        tokRemaining: res.headers.get("x-ratelimit-remaining-tokens"),
        tokReset: res.headers.get("x-ratelimit-reset-tokens"),
    };

    return { limits, json, status };
}

function getDailyResetInfo() { // Timer daily reset token API
    const now = new Date();
    const indoTime = now.toLocaleString("id-ID", {
        dateStyle: "full",
        timeStyle: "medium"
    });

    // Reset harian Groq = 00:00 UTC → 07:00 WIB
    const resetUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

    // Convert ke WIB +7
    let resetWIB = new Date(resetUTC.getTime() + 7 * 60 * 60 * 1000);

    // Kalau waktu sekarang sudah lewat 07:00 WIB → reset besok
    if (now > resetWIB) {
        resetWIB = new Date(resetWIB.getTime() + 24 * 60 * 60 * 1000);
    }

    const diffMs = resetWIB - now;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

    return {
        resetAt: resetWIB,
        inText: `${hours} jam, ${mins} menit, ${secs} detik`
    };
}

// PERSISTENCE HELPERS
async function loadMemory() {
    try {
        const raw = await fsp.readFile(MEMORY_FILE, 'utf8'); // Requires valid MEMORY_FILE from config
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

async function saveMemory(data) {
    setMemoryData(data); // Sync state
    await fsp.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function loadTriviaScore() {
    try {
        console.log('[DEBUG] Loading trivia from:', TRIVIA_FILE_PATH);
        const raw = await fsp.readFile(TRIVIA_FILE_PATH, 'utf8');
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

async function saveTriviaScore(data) {
    setTriviaScore(data);
    await fsp.writeFile(TRIVIA_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}
// CHANNEL HISTORY helpers
function saveToChannelHistory(channelId, content, username = "Bot Ditos", role = "assistant") {
    try {
        let chHistory = channelHistory.get(channelId);
        if (!chHistory) {
            chHistory = [];
            channelHistory.set(channelId, chHistory);
        }

        // Handle payload objects (embeds etc)
        let textContent = content;
        if (typeof content !== "string") {
            if (content.content) textContent = content.content;
            else if (content.embeds) textContent = JSON.stringify(content.embeds).substring(0, 500);
            else textContent = JSON.stringify(content).substring(0, 500);
        }

        chHistory.push({
            role: role,
            username: username,
            content: textContent
        });

        if (chHistory.length > MAX_CHANNEL_HISTORY) {
            chHistory.splice(0, chHistory.length - MAX_CHANNEL_HISTORY);
        }
    } catch (e) {
        console.error("History save error", e);
    }
}

async function replyAndSave(message, payload) {
    let sent;
    if (payload.embeds || payload.components) {
        sent = await message.channel.send(payload);
    } else {
        sent = await message.reply(payload);
    }

    saveToChannelHistory(message.channel.id, payload, "Bot Ditos", "assistant");

    return sent;
}

async function replyEmbedAndSave(message, payload, username = "Bot Ditos") {
    try {
        const sent = await message.channel.send(payload);

        const embed = payload.embeds?.[0];
        if (embed) {
            const e = embed.data || embed;

            // ✅ Build full text (sama persis kayak yang disimpen)
            let text = '';

            if (e.title) {
                text += `# ${e.title}\n\n`;
            }

            if (e.description) {
                text += `${e.description}\n\n`;
            }

            if (e.fields?.length) {
                text += e.fields
                    .map(f => `• **${f.name}**: ${f.value}`)
                    .join("\n");
            }

            // ✅ LOG FULL TEXT (bukan object)
            console.log('[Embed Full Text]\n' + text);

            // Save to history (sama persis dengan yang di-log)
            let chHistory = channelHistory.get(message.channel.id);
            if (!chHistory) {
                chHistory = [];
                channelHistory.set(message.channel.id, chHistory);
            }

            chHistory.push({
                role: "assistant",
                username: username,
                content: text,
            });

            if (chHistory.length > MAX_CHANNEL_HISTORY) {
                chHistory.splice(0, chHistory.length - MAX_CHANNEL_HISTORY);
            }

            console.log(`[History] Saved ${text.length} chars`);
        } else {
            console.log('[Embed] No embed found');
        }

        return sent;
    } catch (err) {
        console.error("[replyEmbedAndSave error]", err);
    }
}
// FUZZY SEARCH
async function resolveMemberFuzzy(message, inputName, threshold = 0.7) {
    if (!message.guild) return null;

    if (!message.guild.members.cache.has(message.author.id)) {
        await message.guild.members.fetch();
    }

    const name = inputName.toLowerCase();
    const results = [];

    for (const member of message.guild.members.cache.values()) {
        const candidates = [
            member.user.username,
            member.displayName
        ].filter(Boolean);

        let bestScoreForMember = 0;
        const normInput = normalizeTrivia(inputName);

        for (const c of candidates) {
            const normCandidate = normalizeTrivia(c);
            if (normCandidate.startsWith(normInput) || normCandidate.includes(normInput)) {
                return member;
            }

            const score = similarity(name, c);
            if (score > bestScoreForMember) bestScoreForMember = score;
        }

        if (bestScoreForMember >= threshold) {
            results.push({ member, score: bestScoreForMember });
        }
    }

    if (results.length === 0) return null;
    results.sort((a, b) => b.score - a.score);
    return results[0].member;
}

async function searchWeb(query) { // Google search pake API Google CSE
    const apiKey = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_CX;

    if (!apiKey || !cx) {
        console.error('Google CSE key/cx belum diset di .env');
        return [];
    }

    const url =
        `https://www.googleapis.com/customsearch/v1` +
        `?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

    const res = await fetch(url);
    const data = await res.json();

    if (!data.items || !Array.isArray(data.items)) {
        console.log('Google CSE no items:', data);
        return [];
    }

    // ambil 3 hasil teratas
    return data.items.slice(0, 3).map((item) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
    }));
}

module.exports = {
    normalizeTrivia,
    levenshtein,
    similarity,
    loadMemory,
    saveMemory,
    loadTriviaScore,
    saveTriviaScore,
    saveToChannelHistory,
    replyAndSave,
    replyEmbedAndSave,
    resolveMemberFuzzy,
    isTriviaCorrect,
    getLevelFromXP,
    awardTriviaXP,
    createStatusEmbed,
    createGroqStatusEmbed,
    createGroqRateLimitEmbed,
    createGroqErrorEmbed,
    fetchGroqLimits,
    getDailyResetInfo,
    searchWeb,
    reportErrorToDiscord
};
