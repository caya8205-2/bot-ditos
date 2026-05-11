const { channelHistory, botActivityTracker, lastUserActivity, getMemoryData } = require('../data/state');
const { memoryData } = require('../data/state'); // This returns the object AT REQUIRE TIME. 
const state = require('../data/state');
const { callGroqWithFallback } = require('./groqManager');
const { MAX_CHANNEL_HISTORY } = require('../data/constants');

function filterChannelHistory(messages) {
    return messages.filter(m => {
        const isBotMessage = m.username?.includes('Bot');
        const isOurBot = m.username === 'Bot Ditos' || m.username === 'Bot Tia';
        if (isBotMessage && !isOurBot) return false;
        if (/^\*.*\*$/.test(m.content?.trim())) return false;
        return true;
    });
}

const AUTO_CHAT_CONFIG = {
    enabled: true,
    replyChance: 30, // 30% chance bakal reply
    minMessagesBetweenReplies: 6,
    replyCooldown: 2 * 60 * 1000, // 2 menit
    idleChat: {
        enabled: false,
        minIdleTime: 20 * 60 * 1000, // 20 menit sepi
        maxIdleTime: 2 * 60 * 60 * 1000, // 2 jam
    },
    triggerKeywords: [
        'ditos', 'bot', 'ai', 'gemini', 'groq',
        'coding', 'ngoding', 'error', 'bug', 'help',
        'musik', 'lagu', 'game', 'bot ditos', 'anime', 'gaming', 'geming',
    ],
    blacklistedChannels: [
        '1442463723385126933', // welcome channel
        '1218532327509065788', // info game dan kode redeem
        '1173032345582964798', // tutor build
        '1372884342165995593', // dummy
        '1372884376416813056', // dummy
        '1372884394985001100', // dummy
        '1110951940596174858', // spam command bot musik
        '1447134518262628373', // yona mansion
        '1442090815777280052', // rodes
        '1372884089253920808', // tempat garam
        '1279044696051810345', // minyak atas
        '1442006544030896138', // Bot Ditos
    ],
};

function shouldBotReply(message) {
    const channelId = message.channel.id;

    // Skip blacklist & cooldown
    if (AUTO_CHAT_CONFIG.blacklistedChannels.includes(channelId)) return false;

    if (message.author.bot) return false;

    const lastActivity = botActivityTracker.get(channelId);
    if (lastActivity && Date.now() - lastActivity.lastMessage < AUTO_CHAT_CONFIG.replyCooldown) {
        return false;
    }

    const activity = botActivityTracker.get(channelId) || { messageCount: 0 };
    if (activity.messageCount < AUTO_CHAT_CONFIG.minMessagesBetweenReplies) {
        return false;
    }

    let chance = AUTO_CHAT_CONFIG.replyChance;
    const content = message.content.toLowerCase();
    const hasTrigger = AUTO_CHAT_CONFIG.triggerKeywords.some(kw => content.includes(kw.toLowerCase()));
    if (hasTrigger) {
        chance = Math.min(chance * 2.5, 80);
    }

    if (message.mentions.has(message.client.user.id)) {
        chance = 90;
    }

    if (content.includes('?')) chance = Math.min(chance * 1.3, 70);

    if (message.content.length > 100) chance = Math.min(chance * 1.2, 65);

    const chHistory = channelHistory.get(channelId) || [];
    const recentMessages = filterChannelHistory(chHistory).slice(-5);

    let consecutiveCount = 0;
    for (let i = recentMessages.length - 1; i >= 0; i--) {
        if (recentMessages[i].username === message.author.username) consecutiveCount++;
        else break;
    }

    if (consecutiveCount >= 5) chance = Math.max(chance * 0.5, 5);
    else if (consecutiveCount >= 3) chance = Math.max(chance * 0.8, 8);

    const roll = Math.random() * 100;
    return roll < chance;
}

async function generateAutoReply(message) {
    const channelId = message.channel.id;

    try {
        const now = new Date();
        const localTime = now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) + " " + now.toLocaleTimeString("id-ID");

        const chHistory = channelHistory.get(channelId) || [];
        const recentMessages = filterChannelHistory(chHistory).slice(-8);

        const contextPrompt = recentMessages.length > 0
            ? recentMessages.map((m) => {
                const text = m.content?.trim() || "";
                if (/^\*.*\*$/.test(text)) return `${m.username}: [aksi RP]`;
                return `${m.username}: ${m.content}`;
            }).join("\n")
            : "Belum ada obrolan sebelumnya.";

        // Memory Context
        const memory = state.memoryData || {}; // Use getter via module
        const userMemory = memory[message.author.id];
        const globalMemory = memory.global;

        let memoryContext = "";
        if (userMemory?.notes?.length) {
            memoryContext += `\nInfo tentang ${message.author.username}:\n` + userMemory.notes.map(n => `- ${n.note}`).join('\n') + `\n`;
        }
        if (globalMemory?.notes?.length) {
            memoryContext += `\nInfo global server:\n` + globalMemory.notes.map(n => `- ${n.note}`).join('\n') + `\n`;
        }

        const completion = await callGroqWithFallback(async (groq) => {
            return await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content:
                            "Waktu sekarang (dari PC user): " + localTime + "\n" +
                            "Kamu boleh sesekali memakai emoji custom server ini sebagai reaksi (jangan berlebihan, biasanya maksimal 1 emoji per pesan):\n" +
                            "- <:bwakakak3:1402586205669036063> → menertawakan orang lain secara bercanda (playful mockery).\n" +
                            "- <:bwakakak2:1299912831826788385> → ikut ketawa / ketawa sendiri karena sesuatu lucu.\n" +
                            "- <:acumalaka:1119639601099841689> → tertawa terbahak-bahak karena sangat lucu.\n" +
                            "- <:oranghitamnangis:1398551165872115712> → reaksi diolok-olok bercanda / deadpan cry yang lucu.\n" +
                            "- <:hebat:1292785452339957790> → apresiasi, bangga, atau achievement.\n" +
                            "- <:emotmarah:1299575975511851028> → marah atau kesel.\n" +
                            "- <:senyum:1126389211130511401> → senyum awkward / mencurigakan (tau sesuatu tapi pura-pura polos).\n" +
                            "- <:maubagaimanalagi:1119637920278642728> → pasrah / it is what it is.\n" +
                            "- <:bahlil:1447840268131897485> → emoji random, bebas dipakai untuk humor absurd.\n" +
                            "- <:maafkak:1296306397356621904> → minta maaf.\n" +
                            "- <:xixixixi:1119669394822406264> → ketawa, penggunaannya mirip sama bwakakak2.\n" +
                            "- <:kaget2:1410339724744200323> → kaget.\n" +
                            "Gunakan emoji hanya sebagai reaksi pendukung, bukan di setiap kalimat, dan hindari emoji saat menjelaskan hal teknis serius.\n\n" +

                            "Kamu adalah Bot Ditos, bot Discord yang suka ikut ngobrol secara natural di server.\n" +
                            "Gaya bicara santai, casual, campur Indonesia + English dikit.\n" +
                            "Nada kamu moody, suka nyeletuk, kadang nyolot halus.\n\n" +

                            "PENTING - ATURAN AUTO-CHAT:\n" +
                            "- Kamu TIDAK dipanggil dengan command, kamu cuma ikut nimbrung obrolan\n" +
                            "- Jangan nanya 'ada yang bisa gue bantu?' atau 'butuh bantuan?' (cringe banget)\n" +
                            "- Reply secara NATURAL kayak temen yang lagi dengerin obrolan terus ikut komen\n" +
                            "- Gak usah nyebut kalau lu bot kecuali ditanya\n" +
                            "- Keep it SHORT (1-3 kalimat max)\n" +
                            "- Boleh cuma emoji reaction kalau emang gak ada yang perlu dikomen\n" +
                            "- Kalau topiknya technical (coding, troubleshooting), boleh kasih insight singkat\n" +
                            "- Kalau casual chat, ya nyantai aja, gausah kaku\n\n" +

                            "Style:\n" +
                            "- Pake 'gue/gua/gwa' dan 'lo/lu/luwh'\n" +
                            "- Sesekali frontal ('bjirlah', 'anjeng', 'goofy ahh') tapi jangan berlebihan\n" +
                            "- Boleh nge-roast dikit, tapi jangan toxic\n\n" +

                            memoryContext +

                            "\nObrolan terakhir di channel:\n" +
                            contextPrompt
                    },
                    {
                        role: 'user',
                        content: `Ini pesan terbaru dari ${message.author.username}:\n"${message.content}"\n\nReply secara natural dan singkat.`
                    }
                ],
                temperature: 0.85,
                max_completion_tokens: 150
            });
        });

        const reply = completion.choices?.[0]?.message?.content?.trim();
        if (reply && reply.length >= 2) return reply;
        return null;

    } catch (e) {
        console.error("[AutoChat] Error:", e);
        return null;
    }
}
module.exports = { shouldBotReply, generateAutoReply, AUTO_CHAT_CONFIG };
