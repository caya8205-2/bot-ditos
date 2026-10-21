const { channelHistory, botActivityTracker, lastUserActivity } = require('../data/state');
const state = require('../data/state');
const { callLLMWithFallback, LLM_MODEL, getActiveChatModelInfo } = require('./llmManager');
const { preparePromptMessages } = require('./promptBuilder');
const { extractReactionAndCleanReply } = require('./helpers');
const {
    getImageAttachments,
    getVideoAttachments,
    buildImageContext,
    buildVideoContext,
    renderImageParts,
    renderVideoParts,
    resolveReferencedMessage,
    detectConversationTone,
} = require('./messageContext');

function filterChannelHistory(messages) {
    return messages.filter(m => {
        const isBotMessage = m.username?.includes('Bot');
        const isOurBot = m.username === 'Bot Ditos' || m.username === 'Bot Tia' || m.username === 'Kumarine';
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
    // Jendela debounce: pesan beruntun dari orang yang sama dianggap
    // satu giliran bicara, bukan beberapa trigger terpisah.
    burstWindowMs: 2500,
    idleChat: {
        enabled: false,
        minIdleTime: 20 * 60 * 1000, // 20 menit sepi
        maxIdleTime: 2 * 60 * 60 * 1000, // 2 jam
    },
    triggerKeywords: [
        'ditos', 'bot', 'ai', 'gemini', 'kobold',
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

// ── Guard anti-burst ────────────────────────────────────────────────────────
// pendingBurst: menampung pesan beruntun per channel sebelum memanggil LLM.
// inFlight: channel yang sedang generate, supaya tidak ada generate paralel.
const pendingBurst = new Map();
const inFlight = new Set();

function shouldBotReply(message, textContent) {
    if (!AUTO_CHAT_CONFIG.enabled) return false;

    const channelId = message.channel.id;

    // Skip blacklist & cooldown
    if (AUTO_CHAT_CONFIG.blacklistedChannels.includes(channelId)) return false;

    if (message.author.bot) return false;

    // Sedang generate untuk channel ini -> jangan spawn paralel.
    if (inFlight.has(channelId)) {
        console.log(`[AutoChat] [${message.channel.name || channelId}] Skip: masih generate balasan sebelumnya`);
        return false;
    }

    const lastActivity = botActivityTracker.get(channelId);
    if (lastActivity && Date.now() - lastActivity.lastMessage < AUTO_CHAT_CONFIG.replyCooldown) {
        const remaining = Math.ceil((AUTO_CHAT_CONFIG.replyCooldown - (Date.now() - lastActivity.lastMessage)) / 1000);
        console.log(`[AutoChat] [${message.channel.name || channelId}] Skip: cooldown aktif (${remaining}s tersisa)`);
        return false;
    }

    const content = (textContent || message.content || '').toLowerCase();
    const matchedTriggers = AUTO_CHAT_CONFIG.triggerKeywords.filter(kw => content.includes(kw.toLowerCase()));
    const hasTrigger = matchedTriggers.length > 0;
    const hasMention = Boolean(message.mentions?.has?.(message.client.user.id));

    const activity = botActivityTracker.get(channelId) || { messageCount: 0 };

    // Kalau belum cukup pesan dan tidak ada trigger/mention khusus, skip
    if (!hasTrigger && !hasMention && activity.messageCount < AUTO_CHAT_CONFIG.minMessagesBetweenReplies) {
        console.log(`[AutoChat] [${message.channel.name || channelId}] Skip: pesan baru ${activity.messageCount}/${AUTO_CHAT_CONFIG.minMessagesBetweenReplies} (belum ada trigger/mention)`);
        return false;
    }

    let chance = AUTO_CHAT_CONFIG.replyChance;
    if (hasTrigger) {
        chance = Math.min(chance * 2.5, 80);
    }

    if (hasMention) {
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

    // Baca suasana: kalau channel sedang membahas hal serius dan bot tidak
    // dipanggil langsung, jangan nimbrung dengan becanda.
    const tone = detectConversationTone([
        ...recentMessages.map((m) => m.content),
        content,
    ]);
    if (tone.tone === 'serious' && !hasMention) {
        chance = Math.max(chance * 0.2, 2);
    }

    const roll = Math.random() * 100;
    const willReply = roll < chance;

    console.log(`[AutoChat] [${message.channel.name || channelId}] MsgCount: ${activity.messageCount} | Triggers: ${hasTrigger ? matchedTriggers.join(', ') : 'none'} | Mention: ${hasMention} | Tone: ${tone.tone} | Chance: ${chance.toFixed(1)}% | Roll: ${roll.toFixed(1)}% | Reply: ${willReply ? 'YES' : 'NO'}`);

    return willReply;
}

/**
 * Kumpulkan pesan beruntun dari author yang sama dalam satu jendela debounce,
 * lalu generate satu balasan saja. Mencegah bot membalas berkali-kali saat user
 * mengirim pikirannya dalam beberapa pesan terpisah.
 */
function scheduleAutoReply(message, textContent, { onSent } = {}) {
    const channelId = message.channel.id;
    const existing = pendingBurst.get(channelId);

    const texts = existing ? existing.texts : [];
    const incoming = (textContent || message.content || '').trim();
    if (incoming) texts.push(incoming);

    if (existing?.timer) clearTimeout(existing.timer);

    const entry = {
        texts,
        latestMessage: message,
        timer: null,
        authorId: message.author.id,
    };

    entry.timer = setTimeout(async () => {
        pendingBurst.delete(channelId);

        if (inFlight.has(channelId)) {
            console.log(`[AutoChat] [${message.channel.name || channelId}] Skip burst: channel masih in-flight`);
            return;
        }

        inFlight.add(channelId);
        // Reservasi cooldown lebih awal supaya pesan yang masuk selama proses
        // generate tidak ikut memicu balasan baru.
        botActivityTracker.set(channelId, { lastMessage: Date.now(), messageCount: 0 });

        try {
            const mergedText = entry.texts.join('\n').trim();
            const reply = await generateAutoReply(entry.latestMessage, mergedText);
            if (reply) {
                await entry.latestMessage.channel.send(reply);
                if (typeof onSent === 'function') onSent(reply);
            } else {
                // Tidak jadi balas -> lepas reservasi supaya channel tidak
                // "terkunci" tanpa alasan.
                botActivityTracker.set(channelId, { lastMessage: 0, messageCount: 0 });
            }
        } catch (err) {
            console.error('[AutoChat] Gagal kirim auto-reply:', err);
            botActivityTracker.set(channelId, { lastMessage: 0, messageCount: 0 });
        } finally {
            inFlight.delete(channelId);
        }
    }, AUTO_CHAT_CONFIG.burstWindowMs);

    pendingBurst.set(channelId, entry);
}

async function generateAutoReply(message, textContent) {
    const channelId = message.channel.id;
    const userText = textContent || message.content || '';

    try {
        const now = new Date();
        const localTime = now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) + " " + now.toLocaleTimeString("id-ID");

        const chHistory = channelHistory.get(channelId) || [];
        const recentMessages = filterChannelHistory(chHistory).slice(-8);

        // ── Konteks pesan yang direply ──────────────────────────────────────
        // Kalau user me-reply pesan lama (misal joke), isi pesan itu ikut
        // dibaca supaya bot paham apa yang sedang dikomentari.
        const referencedMessage = await resolveReferencedMessage(message);
        let replyContext = '';
        if (referencedMessage) {
            const refAuthor = referencedMessage.author?.username || 'seseorang';
            const refText = (referencedMessage.content || '').trim();
            const refHasImage = getImageAttachments(referencedMessage).length > 0;
            const refBody = refText || (refHasImage ? '[mengirim gambar]' : '[pesan kosong]');
            replyContext = `\nPesan yang sedang dibalas oleh ${message.author.username} (dari ${refAuthor}):\n"${refBody.slice(0, 400)}"\n`;
        }

        const contextPrompt = recentMessages.length > 0
            ? recentMessages.map((m) => {
                const text = m.content?.trim() || "";
                if (/^\*.*\*$/.test(text)) return `${m.username}: [aksi RP]`;

                const bits = [];
                if (m.replyTo?.messageId) {
                    const target = m.replyTo.username ? `@${m.replyTo.username}` : 'pesan lain';
                    const snippet = m.replyTo.content ? `: "${m.replyTo.content.slice(0, 120)}"` : '';
                    bits.push(`(membalas ${target}${snippet})`);
                }
                if (Array.isArray(m.imageUrls) && m.imageUrls.length) {
                    bits.push('[mengirim gambar]');
                }

                const suffix = bits.length ? ` ${bits.join(' ')}` : '';
                const body = text || (bits.length ? '' : '[pesan kosong]');
                return `${m.username}${suffix}: ${body}`.trimEnd();
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

        // ── Konteks gambar (multimodal) ─────────────────────────────────────
        // Prioritas: gambar pesan saat ini -> gambar pesan yang direply ->
        // gambar terbaru di riwayat channel. Kalau model aktif multimodal,
        // gambar dikirim langsung sebagai image part tanpa OCR (jalur yang
        // sama dengan command d!chat). Kalau tidak, fallback ke Gemini adapter.
        const imageCandidates = [];

        for (const attachment of getImageAttachments(message)) {
            imageCandidates.push({
                attachment,
                label: `Gambar yang dikirim ${message.author.username} sekarang`,
            });
        }

        if (referencedMessage) {
            for (const attachment of getImageAttachments(referencedMessage)) {
                imageCandidates.push({
                    attachment,
                    label: `Gambar dari ${referencedMessage.author?.username || 'user'} pada pesan yang direply`,
                });
            }
        }

        for (const m of [...recentMessages].reverse()) {
            if (!Array.isArray(m.imageUrls)) continue;
            for (const url of m.imageUrls) {
                imageCandidates.push({
                    attachment: { url },
                    label: `Gambar dari ${m.username} di obrolan sebelumnya`,
                });
            }
        }

        const imageEntries = await buildImageContext(imageCandidates);
        const imageParts = renderImageParts(imageEntries);

        // ── Konteks video ───────────────────────────────────────────────────
        // Sama seperti d!chat: capability-gated, model video-capable menerima
        // video langsung, selain itu lewat vision manager / frame sampling.
        const videoCandidates = [];

        for (const attachment of getVideoAttachments(message)) {
            videoCandidates.push({
                attachment,
                label: `Video yang dikirim ${message.author.username} sekarang`,
            });
        }

        if (referencedMessage) {
            for (const attachment of getVideoAttachments(referencedMessage)) {
                videoCandidates.push({
                    attachment,
                    label: `Video dari ${referencedMessage.author?.username || 'user'} pada pesan yang direply`,
                });
            }
        }

        const videoEntries = await buildVideoContext(videoCandidates, getActiveChatModelInfo().model);
        const videoParts = renderVideoParts(videoEntries);

        if (videoEntries.length) {
            console.log(`[AutoChat] Menyertakan ${videoEntries.length} video (mode: ${videoEntries.map((v) => v.mode).join(',')})`);
        }

        if (imageEntries.length) {
            console.log(`[AutoChat] Menyertakan ${imageEntries.length} gambar ke prompt (model: ${getActiveChatModelInfo().model})`);
        }

        // Deskripsi teks (hasil OCR/vision manager) disisipkan ke baseText
        // supaya model non-vision tetap dapat informasinya.
        const mediaDescriptions = [
            ...imageEntries.filter((e) => e.description).map((e) => `${e.label}: ${e.description}`),
            ...videoEntries.filter((e) => e.description).map((e) => `${e.label}: ${e.description}`),
        ];
        const userTextWithMedia = mediaDescriptions.length
            ? `${userText}\n\n[Media:\n${mediaDescriptions.join('\n')}]`
            : userText;

        // Sinyal suasana untuk instruksi tambahan.
        const tone = detectConversationTone([
            ...recentMessages.map((m) => m.content),
            userText,
        ]);
        const toneInstruction = tone.tone === 'serious'
            ? "Suasana obrolan terakhir terasa SERIUS atau sensitif. Turunkan nada bercanda: jangan nge-roast, jangan nyeletuk absurd, jangan nyolot. Tanggapi dengan empatik dan wajar, atau kalau memang tidak ada yang perlu ditambahkan, diam saja."
            : "Suasana obrolan terakhir santai. Kamu boleh nimbrung dengan nada biasa, tetap baca situasi sebelum nyeletuk.";

            const completion = await callLLMWithFallback(async (client) => {
            return await client.chat.completions.create({
                    model: LLM_MODEL,
                messages: preparePromptMessages([
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
                            "- Kadang kamu boleh memberi reaction emoji ke pesan user dengan tag `[react: <emoji>]` (misal `[react: <:bwakakak2:1299912831826788385>]` atau `[react: 🗿]`). Cukup sesekali saja kalau pas, jangan tiap saat.\n" +
                            "- Kalau topiknya technical (coding, troubleshooting), boleh kasih insight singkat\n" +
                            "- Kalau casual chat, ya nyantai aja, gausah kaku\n" +
                            "- Kalau ada gambar (baik dari pesan sekarang, pesan yang direply, atau obrolan sebelumnya), komentari isinya secara natural. Jangan bilang tidak bisa melihat gambar.\n\n" +

                            "BACA RUANGAN:\n" +
                            "- " + toneInstruction + "\n" +
                            "- Kalau obrolan sedang ramai dan banyak orang bicara, jangan balas setiap pesan; cukup satu komentar yang nyambung.\n" +
                            "- Kalau ada yang sedang curhat, kena masalah, atau bahas hal berat, prioritaskan empati di atas jokes.\n\n" +

                            "Style:\n" +
                            "- Pake 'gue/gua/gwa' dan 'lo/lu/luwh'\n" +
                            "- Sesekali frontal ('bjirlah', 'anjeng', 'goofy ahh') tapi jangan berlebihan\n" +
                            "- Boleh nge-roast dikit, tapi jangan toxic\n\n" +

                            memoryContext +
                            (replyContext ? "\n" + replyContext : "") +

                            "\nObrolan terakhir di channel:\n" +
                            contextPrompt
                    },
                    {
                        role: 'user',
                        content: (imageParts.length || videoParts.length)
                            ? [
                                {
                                    type: 'text',
                                    text: `Ini pesan terbaru dari ${message.author.username}:\n"${userTextWithMedia}"\n\nReply secara natural dan singkat.`,
                                },
                                ...imageParts,
                                ...videoParts,
                            ]
                            : `Ini pesan terbaru dari ${message.author.username}:\n"${userTextWithMedia}"\n\nReply secara natural dan singkat.`
                    }
                ], { label: 'auto-chat' }),
                temperature: 0.85,
                max_tokens: 600
            });
        });

        const rawReply = completion.choices?.[0]?.message?.content?.trim();
        if (!rawReply) return null;

        const { reaction, cleanText } = extractReactionAndCleanReply(rawReply, message.guild);
        if (reaction) {
            message.react(reaction).catch((err) => {
                console.warn('[AutoChat] Gagal react:', err.message);
            });
        }

        if (cleanText && cleanText.length >= 2) return cleanText;
        return null;

    } catch (e) {
        console.error("[AutoChat] Error:", e);
        return null;
    }
}

async function sendIdleMessage(channel) {
    try {
        const now = new Date();
        const localTime = now.toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric"
        }) + " " + now.toLocaleTimeString("id-ID");

        const chHistory = channelHistory.get(channel.id) || [];
        const recentMessages = filterChannelHistory(chHistory).slice(-8);

        const contextPrompt = recentMessages.length > 0
            ? recentMessages
                .map((m) => `${m.username}: ${m.content}`)
                .join("\n")
            : "Belum ada obrolan sebelumnya.";

        const completion = await callLLMWithFallback(async (client) => {
            return await client.chat.completions.create({
                model: LLM_MODEL,
                messages: preparePromptMessages([
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

                            "PENTING - ATURAN IDLE CHAT:\n" +
                            "- Channel ini lagi sepi banget (20+ menit gak ada yang chat).\n" +
                            "- Tugas kamu: Bikin 1 pesan singkat (1-2 kalimat) buat 'nyentil' user supaya ngobrol lagi.\n" +
                            "- Boleh nanya random, nyeletuk soal topik obrolan terakhir, atau nge-roast karena server sepi kayak kuburan.\n" +
                            "- Jangan nanya 'ada yang butuh bantuan?' atau 'ada orang gak?'. Buat senatural mungkin.\n" +
                            "- Keep it SHORT (1-2 kalimat max).\n\n" +

                            "Style:\n" +
                            "- Pake 'gue/gua/gwa' dan 'lo/lu/luwh'\n" +
                            "- Sesekali frontal ('bjirlah', 'anjeng', 'goofy ahh') tapi jangan berlebihan\n" +
                            "- Boleh nge-roast dikit, tapi jangan toxic\n\n" +

                            `Context obrolan terakhir:\n${contextPrompt}`
                    },
                    {
                        role: 'user',
                        content: 'Bikin pesan idle chat yang natural dan engaging!'
                    }
                ], { label: 'idle-chat' }),
                temperature: 0.9,
                max_tokens: 400
            });
        });

        const idleMessage = completion.choices?.[0]?.message?.content?.trim();

        if (!idleMessage || idleMessage.length < 3) {
            const fallbacks = [
                "Sepi amat nih...",
                "Halo? Ada orang? 🦗",
                "Lagi pada ngapain sih?",
                "Kuburan mode on <:senyum:1126389211130511401>"
            ];
            await channel.send(fallbacks[Math.floor(Math.random() * fallbacks.length)]).catch(() => {});
        } else {
            await channel.send(idleMessage).catch(() => {});
        }

        botActivityTracker.set(channel.id, {
            lastMessage: Date.now(),
            messageCount: 0
        });

        console.log(`[IdleChat] Sent message to ${channel.name || channel.id}`);

    } catch (error) {
        console.error('[IdleChat] Error:', error);
        const fallbacks = ["Sepi amat nih...", "Boring banget gak ada yang ngobrol"];
        await channel.send(fallbacks[Math.floor(Math.random() * fallbacks.length)]).catch(() => {});
    }
}

function startIdleChecker(client) {
    setInterval(async () => {
        if (!AUTO_CHAT_CONFIG.enabled || !AUTO_CHAT_CONFIG.idleChat.enabled) return;

        const now = Date.now();

        for (const [channelId, lastActivity] of lastUserActivity) {
            const idleTime = now - lastActivity;

            if (idleTime < AUTO_CHAT_CONFIG.idleChat.minIdleTime) continue;

            const maxIdle = AUTO_CHAT_CONFIG.idleChat.maxIdleTime;
            const idlePercent = Math.min(idleTime / maxIdle, 1);
            const chance = idlePercent * 30; // Max 30% chance

            if (Math.random() * 100 > chance) continue;

            try {
                const channel = await client.channels.fetch(channelId).catch(() => null);

                if (!channel || !channel.isTextBased()) continue;
                if (AUTO_CHAT_CONFIG.blacklistedChannels.includes(channelId)) continue;

                const lastBot = botActivityTracker.get(channelId);
                if (lastBot && now - lastBot.lastMessage < 30 * 60 * 1000) continue;

                await sendIdleMessage(channel);
                lastUserActivity.set(channelId, now);

            } catch (error) {
                console.error('[IdleChecker] Error:', error);
            }
        }
    }, 5 * 60 * 1000);
}

module.exports = {
    shouldBotReply,
    generateAutoReply,
    scheduleAutoReply,
    sendIdleMessage,
    startIdleChecker,
    AUTO_CHAT_CONFIG,
};
