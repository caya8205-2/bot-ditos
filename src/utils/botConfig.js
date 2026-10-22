'use strict';

/**
 * Konfigurasi runtime dari config.yaml.
 *
 * Prinsipnya: .env hanya untuk credentials (API key, token, path sensitif),
 * sedangkan pilihan model dan provider tinggal di config.yaml supaya bisa
 * diubah tanpa menyentuh env dan tanpa restart bot.
 *
 * Format YAML yang didukung sengaja dibatasi pada subset yang dipakai file ini:
 * nested map, list of map, string, dan komentar. Tidak ada dependency parser
 * YAML baru, karena kebutuhan kita hanya sesederhana itu.
 *
 * Contoh:
 *
 *   model:
 *     default: ag/gemini-3.8-flash-high
 *     provider: 9router-local
 *   providers:
 *     - name: 9router-local
 *       base_url: http://127.0.0.1:20128/v1
 *       key_env: NINER_API_KEY
 *   fallback_model:
 *     provider: 9router-local
 *     model: ag/gemini-3.8-flash-high
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.BOT_CONFIG_PATH
    ? path.resolve(process.env.BOT_CONFIG_PATH)
    : path.join(__dirname, '../../config.yaml');

let config = null;
let lastLoadError = null;
let lastLoadedAt = 0;

/**
 * Parser YAML minimal: cukup untuk struktur di atas.
 * Baris `- ` memulai item list; indentasi menentukan kedalaman.
 */
function parseSimpleYaml(text) {
    // Kumpulkan baris bermakna: { indent, content }
    const lines = [];
    for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
        lines.push({
            indent: rawLine.match(/^(\s*)/)[1].length,
            content: rawLine.trim(),
        });
    }

    let pos = 0;

    /**
     * Parse blok pada indentasi tertentu secara rekursif.
     * Kalau baris pertama adalah '- ', blok ini list; kalau tidak, map.
     */
    function parseBlock(indent) {
        if (pos >= lines.length) return null;
        const isList = lines[pos].content.startsWith('- ');
        return isList ? parseList(indent) : parseMap(indent);
    }

    function parseMap(indent) {
        const obj = {};
        while (pos < lines.length && lines[pos].indent === indent) {
            const { content } = lines[pos];
            if (content.startsWith('- ')) break;

            const colonIdx = content.indexOf(':');
            if (colonIdx < 0) { pos++; continue; }

            const key = content.slice(0, colonIdx).trim();
            const value = content.slice(colonIdx + 1).trim();
            pos++;

            if (value !== '') {
                obj[key] = stripQuotes(value);
                continue;
            }

            // Value kosong: cek baris berikutnya. Kalau indentasinya lebih
            // dalam, itu child block (map atau list). Kalau tidak, objek kosong.
            if (pos < lines.length && lines[pos].indent > indent) {
                obj[key] = parseBlock(lines[pos].indent);
            } else {
                obj[key] = {};
            }
        }
        return obj;
    }

    function parseList(indent) {
        const arr = [];
        while (pos < lines.length && lines[pos].indent === indent && lines[pos].content.startsWith('- ')) {
            const body = lines[pos].content.slice(2).trim();
            pos++;

            const colonIdx = body.indexOf(':');
            if (colonIdx > 0) {
                // Item berupa map, mungkin dengan key lanjutan di baris berikut.
                const item = {};
                const key = body.slice(0, colonIdx).trim();
                const value = body.slice(colonIdx + 1).trim();
                if (value !== '') item[key] = stripQuotes(value);

                // Key-key berikutnya lebih dalam dari indent item.
                if (pos < lines.length && lines[pos].indent > indent) {
                    const rest = parseMap(lines[pos].indent);
                    Object.assign(item, rest);
                }
                arr.push(item);
            } else {
                arr.push(stripQuotes(body));
                // Kalau item skalar diikuti blok lebih dalam, lewati.
                if (pos < lines.length && lines[pos].indent > indent) {
                    parseBlock(lines[pos].indent);
                }
            }
        }
        return arr;
    }

    return parseBlock(lines.length ? lines[0].indent : 0) || {};
}

function stripQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

/**
 * Baca config.yaml dari disk. Dipanggil sekali saat start, dan bisa dipanggil
 * ulang untuk reload tanpa restart.
 */
function loadConfig(force = false) {
    if (config && !force) return config;

    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            lastLoadError = `config.yaml tidak ditemukan di ${CONFIG_PATH}`;
            config = { model: {}, providers: [], fallback_model: {} };
            return config;
        }

        const text = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = parseSimpleYaml(text);

        // Kembalikan seluruh isi file; bagian yang dipakai modul lain tinggal
        // diakses lewat getSection(). Struktur inti tetap dinormalisasi supaya
        // pemanggil lama tidak pecah.
        config = {
            ...parsed,
            model: parsed.model && typeof parsed.model === 'object' ? parsed.model : {},
            providers: Array.isArray(parsed.providers) ? parsed.providers : [],
            fallback_model:
                parsed.fallback_model && typeof parsed.fallback_model === 'object'
                    ? parsed.fallback_model
                    : {},
        };
        lastLoadError = null;
        lastLoadedAt = Date.now();
        return config;
    } catch (error) {
        lastLoadError = error.message;
        console.error('[Config] Gagal baca config.yaml:', error.message);
        config = config || { model: {}, providers: [], fallback_model: {} };
        return config;
    }
}

function getConfig() {
    return loadConfig();
}

/**
 * Ambil satu bagian config sebagai objek.
 * @param {string} name misal 'vision', 'auto_chat', 'local_llm'
 * @param {object} [defaults] nilai bawaan kalau bagian itu tidak ada
 */
function getSection(name, defaults = {}) {
    const section = loadConfig()[name];
    if (section && typeof section === 'object' && !Array.isArray(section)) {
        return { ...defaults, ...section };
    }
    return { ...defaults };
}

/**
 * Resolve provider untuk sebuah section (misal vision.provider).
 * Kalau tidak ketemu, kembalikan null supaya pemanggil bisa memutuskan.
 */
function getProviderForSection(sectionName, defaults = {}) {
    const section = getSection(sectionName, defaults);
    const providerName = section.provider;
    const provider = getProviderByName(providerName);
    if (!provider) return { section, provider: null };
    return {
        section,
        provider: {
            ...provider,
            apiKey: resolveProviderKey(provider),
            source: 'config',
        },
    };
}

/**
 * Helper tipe: parser mengembalikan semua nilai sebagai string, jadi angka dan
 * boolean perlu dikonversi eksplisit.
 */
function asNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function asBool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fallback;
}

function getProviders() {
    return loadConfig().providers || [];
}

function getProviderByName(name) {
    if (!name) return null;
    const provider = getProviders().find((p) => p.name === name);
    if (!provider) return null;

    // Sertakan apiKey supaya pemanggil tidak perlu tahu soal key_env. Tanpa ini
    // provider yang diambil berdasarkan nama akan tampak tanpa kredensial dan
    // setiap request ditolak sebagai "Invalid API key".
    return { ...provider, apiKey: resolveProviderKey(provider) };
}

/**
 * API key sebuah provider dibaca dari env memakai nama variabel di key_env.
 * key_env boleh berisi beberapa nama dipisah koma; yang pertama terisi dipakai.
 */
function resolveProviderKey(provider) {
    if (!provider?.key_env) return '';
    const names = String(provider.key_env).split(',').map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }
    return '';
}

/**
 * Target model yang bisa diubah. Setiap target menunjuk satu bagian di
 * config.yaml, dengan nama key model dan provider masing-masing.
 */
const MODEL_TARGETS = [
    {
        key: 'chat',
        label: 'Chat',
        description: 'Model utama untuk chat & auto-chat',
        section: 'model',
        modelKey: 'default',
    },
    {
        key: 'vision',
        label: 'Vision (gambar)',
        description: 'Dipakai untuk deskripsi gambar dan OCR',
        section: 'vision',
        modelKey: 'model',
    },
    {
        key: 'vision_video',
        label: 'Vision (video)',
        description: 'Dipakai kalau model chat tidak bisa video',
        section: 'vision_video',
        modelKey: 'model',
    },
    {
        key: 'fallback',
        label: 'Fallback',
        description: 'Model cadangan sebelum jatuh ke Groq',
        section: 'fallback_model',
        modelKey: 'model',
    },
];

const PROVIDER_KEY = 'provider';

function getModelTargets() {
    return MODEL_TARGETS.map((t) => ({ ...t }));
}

function getModelTarget(targetKey) {
    return MODEL_TARGETS.find((t) => t.key === targetKey) || null;
}

/**
 * Override runtime per target: { model, provider }. Belum tentu ditulis ke
 * disk, jadi hilang saat restart kecuali disimpan.
 */
const runtimeOverrides = new Map();

function getTargetOverride(targetKey) {
    return runtimeOverrides.get(targetKey) || null;
}

/**
 * Hapus override runtime sebuah target, supaya kembali memakai nilai
 * config.yaml. Berguna saat pengujian atau saat ingin membatalkan perubahan.
 */
function clearTargetOverride(targetKey) {
    return runtimeOverrides.delete(targetKey);
}

/**
 * Nilai model dan provider efektif untuk sebuah target.
 * Prioritas: override runtime -> config.yaml -> env (khusus chat).
 */
function getTargetValue(targetKey) {
    const target = getModelTarget(targetKey);
    if (!target) return { model: null, provider: null };

    const override = runtimeOverrides.get(targetKey);
    const cfg = loadConfig();
    const section = cfg[target.section] || {};

    let model = override?.model || section[target.modelKey] || null;
    let provider = override?.provider || section[PROVIDER_KEY] || null;

    // Kompatibilitas: target chat masih menghormati env lama.
    if (targetKey === 'chat') {
        if (!model) model = process.env.NINER_MODEL || 'auto';
    }

    return { model, provider };
}

/**
 * Model aktif saat ini (target chat). Dipertahankan sebagai nama lama karena
 * banyak modul memakainya.
 */
function getActiveModel() {
    return getTargetValue('chat').model;
}

function getActiveProviderName() {
    return getTargetValue('chat').provider;
}

/**
 * Ganti model sebuah target tanpa restart.
 * @param {string} targetKey chat | vision | vision_video | fallback
 * @param {string} model
 * @param {string|null} providerName
 * @param {boolean} persist tulis ke config.yaml
 */
function setTargetModel(targetKey, model, providerName = null, persist = false) {
    const target = getModelTarget(targetKey);
    if (!target) throw new Error(`Target model tidak dikenal: ${targetKey}`);
    if (!model) throw new Error('Nama model wajib diisi');

    const current = getTargetValue(targetKey);
    runtimeOverrides.set(targetKey, {
        model,
        provider: providerName || current.provider,
    });

    if (persist) {
        return saveTargetToDisk(targetKey, model, providerName || current.provider);
    }
    return true;
}

function getActiveProvider() {
    const name = getActiveProviderName();
    const provider = getProviderByName(name);
    if (provider) {
        return {
            ...provider,
            apiKey: resolveProviderKey(provider),
            source: 'config',
        };
    }

    // Kompatibilitas: kalau config.yaml belum punya provider, pakai env lama.
    const baseURL = (process.env.NINER_BASE_URL || '').replace(/\/+$/, '');
    if (baseURL) {
        return {
            name: 'env-default',
            base_url: baseURL,
            apiKey: process.env.NINER_API_KEY || '',
            source: 'env',
        };
    }

    return null;
}

/**
 * Ganti model aktif tanpa restart.
 * @param {string} model
 * @param {string} [providerName]
 * @param {boolean} [persist] tulis ke config.yaml supaya bertahan setelah restart
 */
function setActiveModel(model, providerName = null, persist = false) {
    return setTargetModel('chat', model, providerName, persist);
}

/**
 * Tulis pilihan model ke config.yaml, mempertahankan isi lain apa adanya.
 * Hanya bagian `model:` yang ditulis ulang.
 */
function saveActiveModelToDisk(model, providerName) {
    return saveTargetToDisk('chat', model, providerName);
}

/**
 * Tulis model sebuah target ke config.yaml.
 *
 * Hanya baris model (dan provider, kalau target punya provider) di dalam blok
 * bagian itu yang diganti. Komentar dan bagian lain dibiarkan utuh, jadi file
 * tetap enak dibaca dan tidak teracak.
 *
 * @param {string} targetKey chat | vision | vision_video | fallback
 * @param {string} model
 * @param {string|null} providerName
 */
function saveTargetToDisk(targetKey, model, providerName) {
    const target = getModelTarget(targetKey);
    if (!target) {
        console.error(`[Config] Target tidak dikenal: ${targetKey}`);
        return false;
    }

    try {
        const text = fs.readFileSync(CONFIG_PATH, 'utf8');
        const lines = text.split(/\r?\n/);
        const out = [];

        const sectionHeader = new RegExp(`^${target.section}:\\s*$`);
        const modelLine = new RegExp(`^(\\s+)${target.modelKey}:`);
        const providerLine = /^(\s+)provider:/;

        let inSection = false;
        let wroteModel = false;
        let wroteProvider = false;
        let sectionFound = false;

        for (const line of lines) {
            const isTopLevel = /^\S/.test(line);

            if (sectionHeader.test(line)) {
                inSection = true;
                sectionFound = true;
                out.push(line);
                continue;
            }

            if (inSection) {
                // Bagian berakhir saat ada key top-level lain.
                if (isTopLevel) {
                    if (!wroteModel) out.push(`  ${target.modelKey}: ${model}`);
                    if (providerName && !wroteProvider) out.push(`  provider: ${providerName}`);
                    inSection = false;
                    out.push(line);
                    continue;
                }

                if (modelLine.test(line)) {
                    out.push(`  ${target.modelKey}: ${model}`);
                    wroteModel = true;
                    continue;
                }

                if (providerLine.test(line)) {
                    if (providerName) {
                        out.push(`  provider: ${providerName}`);
                        wroteProvider = true;
                    } else {
                        out.push(line);
                    }
                    continue;
                }

                out.push(line);
                continue;
            }

            out.push(line);
        }

        // Bagian belum ada di file: tambahkan di akhir.
        if (!sectionFound) {
            out.push(
                '',
                `${target.section}:`,
                `  ${target.modelKey}: ${model}`,
                ...(providerName ? [`  provider: ${providerName}`] : [])
            );
        } else if (inSection) {
            // Bagian ada di akhir file dan belum menulis nilainya.
            if (!wroteModel) out.push(`  ${target.modelKey}: ${model}`);
            if (providerName && !wroteProvider) out.push(`  provider: ${providerName}`);
        }

        fs.writeFileSync(CONFIG_PATH, out.join('\n'), 'utf8');
        loadConfig(true);
        console.log(`[Config] ${targetKey} disimpan ke config.yaml: ${model}`);
        return true;
    } catch (error) {
        console.error('[Config] Gagal menyimpan config.yaml:', error.message);
        return false;
    }
}

function getConfigPath() {
    return CONFIG_PATH;
}

function getConfigStatus() {
    return {
        path: CONFIG_PATH,
        loaded: Boolean(config),
        lastLoadedAt,
        lastError: lastLoadError,
        providers: getProviders().length,
    };
}

module.exports = {
    CONFIG_PATH,
    loadConfig,
    getConfig,
    getSection,
    getProviderForSection,
    asNumber,
    asBool,
    getProviders,
    getProviderByName,
    resolveProviderKey,
    getActiveModel,
    getActiveProvider,
    getActiveProviderName,
    getModelTargets,
    getModelTarget,
    getTargetValue,
    getTargetOverride,
    clearTargetOverride,
    setTargetModel,
    setActiveModel,
    saveActiveModelToDisk,
    saveTargetToDisk,
    getConfigPath,
    getConfigStatus,
    parseSimpleYaml,
};
