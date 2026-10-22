'use strict';

/**
 * Kontrol reasoning/thinking model.
 *
 * Sebagian model reasoning menulis proses berpikirnya sendiri. Kalau proses itu
 * sampai ke chat, yang dibaca user bukan jawaban melainkan catatan berpikir
 * model. Ada dua jalur yang harus ditutup:
 *
 *   1. Mematikan thinking di provider yang mendukung, supaya yang dihasilkan
 *      memang hanya output.
 *   2. Tidak pernah memakai isi reasoning sebagai jawaban ketika `content`
 *      kosong, karena itu menampilkan pikiran mentah model ke user.
 *
 * Nama parameter untuk mematikan thinking berbeda antar model, dan provider
 * memberi tahu formatnya lewat `capabilities.thinkingFormat` di katalog. Jadi
 * parameternya dipilih berdasarkan format, bukan ditebak.
 */

const catalog = require('./modelCatalog');

/**
 * Parameter untuk mematikan thinking, per format yang dilaporkan katalog.
 *
 * Nilai null berarti format itu tidak punya cara mematikan yang diketahui,
 * sehingga tidak ada parameter yang dikirim (mengirim parameter yang salah
 * membuat request ditolak 400).
 */
const DISABLE_PARAMS = {
    // Diuji: reasoning_tokens turun ke 0.
    deepseek: () => ({ thinking: { type: 'disabled' } }),
    // Qwen memakai flag terpisah, bukan objek thinking.
    qwen: () => ({ enable_thinking: false }),
    // Model OpenAI-compatible menerima effort; 'none' mematikan thinking.
    openai: () => ({ reasoning_effort: 'none' }),
    // Claude/Gemini lewat gateway memakai bentuk thinking yang sama.
    'claude-adaptive': () => ({ thinking: { type: 'disabled' } }),
    'claude-budget': () => ({ thinking: { type: 'disabled' } }),
    'gemini-level': () => ({ reasoning_effort: 'none' }),
    // Diuji: ditolak 400 "invalid params", jadi tidak ada param yang dikirim.
    minimax: null,
    // Belum terverifikasi; bentuknya sama dengan deepseek/zai.
    kimi: () => ({ thinking: { type: 'disabled' } }),
    zai: () => ({ thinking: { type: 'disabled' } }),
    // Katalog tidak menyebut formatnya (model OpenRouter/ollama). Diuji pada
    // nemotron-3.5-lightning: `reasoning_effort: 'none'` berhasil mematikan
    // (reasoning_tokens 2000 -> 0).
    'null': () => ({ reasoning_effort: 'none' }),
};

function getThinkingConfig() {
    const defaults = {
        // Matikan reasoning kalau model mengizinkannya.
        disable: true,
        // Jangan pernah pakai reasoning sebagai jawaban saat content kosong.
        never_use_as_reply: true,
    };
    try {
        const botConfig = require('./botConfig');
        const section = botConfig.getSection('thinking', {});
        return {
            disable: section.disable === undefined
                ? defaults.disable
                : botConfig.asBool(section.disable, defaults.disable),
            never_use_as_reply: section.never_use_as_reply === undefined
                ? defaults.never_use_as_reply
                : botConfig.asBool(section.never_use_as_reply, defaults.never_use_as_reply),
        };
    } catch {
        return defaults;
    }
}

/**
 * Bangun parameter tambahan untuk mematikan thinking.
 *
 * @returns {object} parameter tambahan, atau objek kosong kalau tidak berlaku
 */
function buildThinkingParams(modelName, options = {}) {
    const cfg = getThinkingConfig();
    const disable = options.disable === undefined ? cfg.disable : options.disable;
    if (!disable) return {};

    const info = catalog.lookupThinkingInfoSync(modelName);
    if (!info) return {};          // provider tidak memberi metadata thinking
    if (!info.reasoning) return {}; // model memang tidak berpikir
    if (!info.canDisable) {
        // Katalog menyatakan tidak bisa dimatikan. Mengirim parameter tetap
        // akan ditolak provider, jadi lebih baik tidak mengirim apa pun.
        return {};
    }

    const builder = DISABLE_PARAMS[info.format || 'null'];
    if (!builder) return {};

    return builder();
}

/**
 * Bersihkan sisa proses berpikir dari teks jawaban.
 *
 * Sebagian model menulis reasoning di dalam `content` meski sudah diminta
 * menjawab saja. Blok seperti ​`<thinking>...</thinking>` harus dibuang supaya
 * tidak ikut terkirim.
 */
function stripReasoning(text) {
    if (!text || typeof text !== 'string') return text;

    let out = text;

    // Blok berpikir yang ditandai tag.
    out = out.replace(/<(think|thinking|reasoning|analysis|scratchpad)>[\s\S]*?<\/\1>/gi, '');
    // Tag pembuka tanpa penutup: buang sampai akhir, isinya murni proses berpikir.
    out = out.replace(/<(think|thinking|reasoning|analysis|scratchpad)>[\s\S]*$/gi, '');
    // Penanda gaya model tertentu.
    out = out.replace(/^\s*【[^】]{0,40}】\s*/u, '');

    return out.trim();
}

/**
 * Apakah model ini punya thinking yang tidak bisa dimatikan.
 *
 * Dipakai untuk memberi tahu bahwa reasoning tetap terjadi (dan tokennya tetap
 * terpakai) meski hasilnya tidak ditampilkan.
 */
function isThinkingUnavoidable(modelName) {
    const info = catalog.lookupThinkingInfoSync(modelName);
    if (!info || !info.reasoning) return false;
    return !info.canDisable;
}

module.exports = {
    getThinkingConfig,
    buildThinkingParams,
    stripReasoning,
    isThinkingUnavoidable,
    DISABLE_PARAMS,
};
