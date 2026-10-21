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

        // Normalisasi: providers harus array, model harus objek.
        config = {
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

function getProviders() {
    return loadConfig().providers || [];
}

function getProviderByName(name) {
    if (!name) return null;
    return getProviders().find((p) => p.name === name) || null;
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
 * Model aktif saat ini. Urutan prioritas:
 * 1. Override runtime (dipilih lewat selector, belum tentu ditulis ke disk)
 * 2. config.yaml -> model.default
 * 3. env NINER_MODEL (kompatibilitas)
 */
let runtimeModelOverride = null;

function getActiveModel() {
    if (runtimeModelOverride) return runtimeModelOverride;
    const cfg = loadConfig();
    return cfg.model?.default || process.env.NINER_MODEL || 'auto';
}

function getActiveProviderName() {
    if (runtimeProviderOverride) return runtimeProviderOverride;
    const cfg = loadConfig();
    return cfg.model?.provider || null;
}

let runtimeProviderOverride = null;

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
    if (!model) throw new Error('Nama model wajib diisi');
    runtimeModelOverride = model;
    if (providerName) runtimeProviderOverride = providerName;

    if (persist) {
        return saveActiveModelToDisk(model, providerName || getActiveProviderName());
    }
    return true;
}

/**
 * Tulis pilihan model ke config.yaml, mempertahankan isi lain apa adanya.
 * Hanya bagian `model:` yang ditulis ulang.
 */
function saveActiveModelToDisk(model, providerName) {
    try {
        const text = fs.readFileSync(CONFIG_PATH, 'utf8');
        const lines = text.split(/\r?\n/);
        const out = [];
        let inModelBlock = false;
        let wroteDefault = false;
        let wroteProvider = false;

        for (const line of lines) {
            const isTopLevel = /^\S/.test(line);
            const isModelKey = /^model:\s*$/.test(line);

            if (isModelKey) {
                inModelBlock = true;
                out.push(line);
                continue;
            }

            if (inModelBlock) {
                // Blok model berakhir saat ada key top-level lain.
                if (isTopLevel && !isModelKey) {
                    // Sisipkan nilai yang belum tertulis sebelum keluar blok.
                    if (!wroteDefault) out.push(`  default: ${model}`);
                    if (providerName && !wroteProvider) out.push(`  provider: ${providerName}`);
                    inModelBlock = false;
                    out.push(line);
                    continue;
                }

                if (/^\s+default:/.test(line)) {
                    out.push(`  default: ${model}`);
                    wroteDefault = true;
                    continue;
                }
                if (/^\s+provider:/.test(line)) {
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

        // Kalau blok model tidak ada sama sekali, tambahkan di awal.
        if (!wroteDefault && !lines.some((l) => /^model:\s*$/.test(l))) {
            out.unshift('model:', `  default: ${model}`, ...(providerName ? [`  provider: ${providerName}`] : []));
        }

        fs.writeFileSync(CONFIG_PATH, out.join('\n'), 'utf8');
        loadConfig(true);
        console.log(`[Config] Model aktif disimpan ke config.yaml: ${model}`);
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
    getProviders,
    getProviderByName,
    resolveProviderKey,
    getActiveModel,
    getActiveProvider,
    getActiveProviderName,
    setActiveModel,
    saveActiveModelToDisk,
    getConfigPath,
    getConfigStatus,
    parseSimpleYaml,
};
