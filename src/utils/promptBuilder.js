require('dotenv').config();

const DEFAULT_INPUT_TOKEN_BUDGET = 6000;
const INPUT_TOKEN_BUDGET = Math.max(
    1000,
    Number(process.env.LOCAL_LLM_INPUT_TOKEN_BUDGET) || DEFAULT_INPUT_TOKEN_BUDGET
);
const PROMPT_METRICS_ENABLED = process.env.PROMPT_METRICS_ENABLED !== 'false';

const EMOJI_GUIDE = `Emoji custom (maksimal satu per pesan dan hanya jika cocok):
- <:bwakakak3:1402586205669036063>: menertawakan orang secara bercanda
- <:bwakakak2:1299912831826788385>, <:xixixixi:1119669394822406264>: ikut tertawa
- <:acumalaka:1119639601099841689>: tertawa terbahak-bahak
- <:oranghitamnangis:1398551165872115712>: deadpan cry saat diolok bercanda
- <:hebat:1292785452339957790>: apresiasi atau bangga
- <:emotmarah:1299575975511851028>: marah atau kesal
- <:senyum:1126389211130511401>: senyum awkward atau mencurigakan
- <:maubagaimanalagi:1119637920278642728>: pasrah
- <:maafkak:1296306397356621904>: meminta maaf
- <:kaget2:1410339724744200323>: terkejut
- <:bahlil:1447840268131897485>, <:gokil:1460225804251435204>: reaksi absurd/random
Tulis emoji persis dalam format <:nama:id>, tanpa backslash atau backticks. Hindari emoji saat menjelaskan hal teknis serius.`;

const SHARED_PERSONA = `Kamu adalah Bot Ditos, member Discord yang chaotic-good: santai, moody, humoris, sarkastik, suka nyeletuk dan boleh nyolot atau me-roast ringan, tetapi tetap membantu saat konteks serius.
Gaya bicara:
- Campur Indonesia dengan sedikit English; jangan formal atau kepanjangan.
- Gunakan gue/gua/gwa untuk diri sendiri dan lo/lu/luwh untuk lawan bicara. Jangan gunakan aku/kamu.
- Jangan memanggil bro, bos, atau bang kecuali user memulai.
- Frasa frontal/absurd seperti "bjirlah", "anjeng", atau "goofy ahh" boleh sesekali, jangan berlebihan.
- Jangan mengarang kondisi manusia seperti capek, lapar, atau ngantuk. Jika tidak tahu atau tidak punya akses, katakan jujur.
${EMOJI_GUIDE}`;

const COMPACT_PROMPTS = {
    chat: `${SHARED_PERSONA}
Aturan chat command:
- Jawab isi setelah prefix d!c atau d!chat; jangan menyebut atau mengulang prefix.
- Jika ada [Ada gambar: ...], perlakukan sebagai deskripsi gambar yang kamu lihat. Beri insight/reaksi tanpa mengulang mentah dan jangan bilang tidak bisa melihat.
- Jika diminta pekerjaan ekstrem seperti 5000 kata, skripsi, atau spam, tolak singkat dengan gaya malas Ditos.
- Gunakan memory dan konteks channel sebagai referensi, tetapi fokus pada pertanyaan user saat ini.`,
    'auto-chat': `${SHARED_PERSONA}
Aturan auto-chat:
- Kamu sedang nimbrung sebagai teman, bukan dipanggil lewat command.
- Balas natural dan singkat, maksimal 1-3 kalimat; emoji saja boleh jika cocok.
- Jangan menawarkan bantuan secara generik dan jangan menyebut diri sebagai bot kecuali ditanya.
- Untuk topik teknis boleh memberi insight singkat; untuk obrolan casual cukup ikut suasana.
- Gunakan memory dan obrolan channel sebagai konteks sosial.`,
};

function estimateTokens(value) {
    if (!value) return 0;
    return Math.ceil(String(value).length / 4);
}

function getMessageTokens(message) {
    return estimateTokens(message?.content) + 4;
}

function classifyMessage(message, index, total) {
    const content = message?.content || '';

    if (index === 0 && message.role === 'system') return 'persona';
    if (index === total - 1 && message.role === 'user') return 'user_input';
    if (content.startsWith('Waktu sekarang')) return 'time';
    if (content.includes('Info tambahan global') || content.includes('Info global server')) return 'global_memory';
    if (content.includes('Info tambahan tentang user') || content.startsWith('Info tentang ')) return 'user_memory';
    if (content.includes('KONTEKS CHANNEL') || content.includes('Obrolan terakhir di channel')) return 'channel_history';
    if (content.includes('User minta mention')) return 'mention';
    return message.role === 'system' ? 'dynamic_system' : message.role;
}

function splitPrimarySystem(message, label) {
    if (!message || message.role !== 'system' || typeof message.content !== 'string') {
        return { staticMessage: message, dynamicMessages: [] };
    }

    let content = message.content;
    const dynamicMessages = [];
    const timeMatch = content.match(/^(Waktu sekarang[^\n]*\n)/);

    if (timeMatch) {
        dynamicMessages.push({ role: 'system', content: timeMatch[1].trim() });
        content = content.slice(timeMatch[1].length);
    }

    const dynamicMarkers = [
        '\nInfo tentang ',
        '\nInfo global server:',
        '\nObrolan terakhir di channel:',
    ];
    const markerIndexes = dynamicMarkers
        .map((marker) => content.indexOf(marker))
        .filter((index) => index >= 0);

    if (markerIndexes.length) {
        const firstDynamicIndex = Math.min(...markerIndexes);
        const dynamicContent = content.slice(firstDynamicIndex).trim();
        content = content.slice(0, firstDynamicIndex).trim();
        if (dynamicContent) {
            const sections = dynamicContent
                .split(/(?=Info tentang |Info global server:|Obrolan terakhir di channel:)/)
                .map((section) => section.trim())
                .filter(Boolean)
                .map((section) => ({ role: 'system', content: section }));
            dynamicMessages.unshift(...sections);
        }
    }

    content = COMPACT_PROMPTS[label] || content;

    return {
        staticMessage: { ...message, content: content.trim() },
        dynamicMessages,
    };
}

function truncateContent(content, targetTokens, keepTail = false) {
    const maxChars = Math.max(0, targetTokens * 4);
    if (content.length <= maxChars) return content;
    if (maxChars < 80) return content.slice(0, maxChars);

    if (keepTail) {
        const headLength = Math.floor(maxChars * 0.25);
        const tailLength = maxChars - headLength - 24;
        return `${content.slice(0, headLength)}\n...[dipangkas]...\n${content.slice(-tailLength)}`;
    }

    return `${content.slice(0, maxChars - 18)}\n...[dipangkas]`;
}

function applyTokenBudget(messages, budget) {
    const prepared = messages.map((message) => ({ ...message }));
    let total = prepared.reduce((sum, message) => sum + getMessageTokens(message), 0);
    if (total <= budget) return { messages: prepared, trimmed: false, beforeTokens: total };

    const beforeTokens = total;
    const trimOrder = ['channel_history', 'dynamic_system', 'user_memory', 'global_memory'];
    const minimumTokens = {
        channel_history: 180,
        dynamic_system: 140,
        user_memory: 120,
        global_memory: 120,
    };

    for (const section of trimOrder) {
        for (let index = 0; index < prepared.length && total > budget; index++) {
            if (classifyMessage(prepared[index], index, prepared.length) !== section) continue;

            const currentTokens = getMessageTokens(prepared[index]);
            const minimum = minimumTokens[section];
            const removable = Math.max(0, currentTokens - minimum);
            if (!removable) continue;

            const reduction = Math.min(removable, total - budget);
            const targetTokens = Math.max(minimum, currentTokens - reduction) - 4;
            prepared[index].content = truncateContent(
                prepared[index].content,
                targetTokens,
                section === 'channel_history' || section === 'dynamic_system'
            );
            total = prepared.reduce((sum, message) => sum + getMessageTokens(message), 0);
        }
    }

    return { messages: prepared, trimmed: total < beforeTokens, beforeTokens };
}

function collectMetrics(messages, beforeTokens, trimmed, label) {
    const sections = {};
    messages.forEach((message, index) => {
        const section = classifyMessage(message, index, messages.length);
        sections[section] = (sections[section] || 0) + getMessageTokens(message);
    });

    return {
        label,
        budget: INPUT_TOKEN_BUDGET,
        estimatedTokens: messages.reduce((sum, message) => sum + getMessageTokens(message), 0),
        beforeTokens,
        trimmed,
        sections,
    };
}

function logPromptMetrics(metrics) {
    if (!PROMPT_METRICS_ENABLED) return;
    const sections = Object.entries(metrics.sections)
        .map(([name, tokens]) => `${name}=${tokens}`)
        .join(' ');
    console.log(
        `[PromptMetrics] ${metrics.label} total~${metrics.estimatedTokens}/${metrics.budget} ` +
        `before~${metrics.beforeTokens} trimmed=${metrics.trimmed} ${sections}`
    );
}

function preparePromptMessages(rawMessages, { label = 'llm' } = {}) {
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        throw new Error('Prompt messages tidak boleh kosong.');
    }

    const [primary, ...rest] = rawMessages;
    const { staticMessage, dynamicMessages } = splitPrimarySystem(primary, label);
    const finalUserIndex = rest.length - 1;
    const finalUser = finalUserIndex >= 0 && rest[finalUserIndex]?.role === 'user'
        ? rest[finalUserIndex]
        : null;
    const middleMessages = finalUser ? rest.slice(0, -1) : rest;

    const priority = {
        global_memory: 10,
        user_memory: 20,
        channel_history: 30,
        mention: 40,
        dynamic_system: 50,
        time: 60,
    };
    const dynamic = [...middleMessages, ...dynamicMessages]
        .map((message, index) => ({ message, index }))
        .sort((a, b) => {
            const aSection = classifyMessage(a.message, 1, 3);
            const bSection = classifyMessage(b.message, 1, 3);
            return (priority[aSection] || 50) - (priority[bSection] || 50) || a.index - b.index;
        })
        .map(({ message }) => message);

    const reordered = [
        staticMessage,
        ...dynamic,
        ...(finalUser ? [finalUser] : []),
    ].filter((message) => message?.content);

    const budgeted = applyTokenBudget(reordered, INPUT_TOKEN_BUDGET);
    const metrics = collectMetrics(
        budgeted.messages,
        budgeted.beforeTokens,
        budgeted.trimmed,
        label
    );
    logPromptMetrics(metrics);

    return budgeted.messages;
}

module.exports = {
    INPUT_TOKEN_BUDGET,
    PROMPT_METRICS_ENABLED,
    estimateTokens,
    preparePromptMessages,
};
