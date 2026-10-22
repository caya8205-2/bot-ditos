'use strict';
/**
 * Uji apakah model yang diklaim video-capable benar-benar bisa menerima video.
 *
 * Katalog provider sering salah: 9router menandai sebuah model `videoInput: true`
 * padahal model di baliknya menjawab "saya tidak bisa memproses video". Skrip ini
 * membuktikannya dengan video yang berisi dua fase teks berbeda, sehingga model
 * harus melaporkan keduanya secara berurutan. Model yang hanya melihat frame
 * pertama tidak akan lolos.
 *
 * Pemakaian:
 *   node scripts/probe-video-models.js                # provider aktif di config
 *   node scripts/probe-video-models.js zenmux         # provider tertentu
 *   node scripts/probe-video-models.js 9router-local --all   # termasuk non-video
 *
 * Hasil ditulis ke scripts/video-probe-result.json supaya bisa dibandingkan
 * antar waktu tanpa mengulang pengujian.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const ffmpegPath = require('ffmpeg-static');
const bc = require('../src/utils/botConfig');

const TMP = path.join(__dirname, '..', '_tmp_probe');
const RESULT_FILE = path.join(__dirname, 'video-probe-result.json');

const PHASE_A = 'FASE SATU';
const PHASE_B = 'FASE DUA';
const QUESTION =
    'Video ini berisi dua fase dengan teks berbeda. Sebutkan semua teks yang ' +
    'muncul secara berurutan, tanpa penjelasan lain.';

function run(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const err = [];
        child.stderr.on('data', (d) => err.push(d));
        child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(Buffer.concat(err).toString().slice(-300)))
        );
        child.on('error', reject);
    });
}

async function buildProbeVideo() {
    fs.mkdirSync(TMP, { recursive: true });
    const out = path.join(TMP, 'probe.mp4');
    await run([
        '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1.5:r=8',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1.5:r=8',
        '-filter_complex',
        `[0:v]drawtext=text='${PHASE_A}':fontsize=28:fontcolor=white:x=20:y=75[a];` +
        `[1:v]drawtext=text='${PHASE_B}':fontsize=28:fontcolor=white:x=20:y=75[b];` +
        '[a][b]concat=n=2:v=1:a=0[v]',
        '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p', '-y', out,
    ]);
    const bytes = fs.statSync(out).size;
    const dataUrl = `data:video/mp4;base64,${fs.readFileSync(out).toString('base64')}`;
    return { dataUrl, bytes };
}

async function fetchModels(provider, includeAll) {
    const res = await axios.get(`${provider.base_url.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        timeout: 30000,
    });
    const list = res.data?.data || res.data || [];

    return list
        .map((m) => {
            const inputModalities = m.input_modalities || m.architecture?.input_modalities || [];
            const caps = m.capabilities || {};
            const byModality = inputModalities.includes('video');
            const byCap = caps.videoInput === true || caps.video === true;
            return {
                id: m.id,
                claimsVideo: byModality || byCap,
                inputModalities,
                contextLength: m.context_length,
            };
        })
        .filter((m) => includeAll || m.claimsVideo)
        .filter((m) => m.id && !/^(sementara|9router)$/i.test(m.id));
}

function classify(text, promptTokens) {
    if (!text) {
        // Prompt besar tapi jawaban kosong biasanya berarti media diterima lalu
        // gagal diproses, atau model menolak tanpa mengucapkan apa pun.
        if (promptTokens && promptTokens > 1500) return 'kosong_ada_media';
        return 'kosong';
    }
    const lower = text.toLowerCase();

    const refusal = [
        /tidak (bisa|dapat|mampu).{0,40}(memproses|melihat|menonton|membuka|menerima|membaca|mengakses|mengekstrak).{0,40}(video|file)/,
        /tidak menerima (video|file)/,
        /(file|videonya?).{0,30}(tidak|gak|ga) (nyampe|sampai|masuk|terkirim|terlampir)/,
        /video.{0,30}tidak (dapat|bisa).{0,20}(diakses|dibaca|dilihat)/,
        /tidak (punya|memiliki) kemampuan.{0,50}(video|melihat|memproses)/,
        /terbatas pada gambar/,
        /hanya (bisa|dapat).{0,20}(gambar|teks|pdf)/,
        /cannot (process|view|watch|access|read).{0,40}(video|file)/,
        /no video.{0,30}(received|provided|attached)/,
        /not (able|support).{0,30}video/,
        /video (is )?not (available|accessible|attached)/,
        /skipped:.{0,40}video/,
    ];
    if (refusal.some((re) => re.test(lower))) return 'menolak';

    const sawA = /fase\s*satu/.test(lower);
    const sawB = /fase\s*dua/.test(lower);
    if (sawA && sawB) return 'bisa';

    if (promptTokens && promptTokens < 200) return 'tanpa_media';
    return 'tidak_jelas';
}

async function callOnce(provider, model, video, part) {
    const res = await axios.post(
        `${provider.base_url.replace(/\/+$/, '')}/chat/completions`,
        {
            model: model.id,
            messages: [{
                role: 'user',
                content: [{ type: 'text', text: QUESTION }, part],
            }],
            max_tokens: 300,
        },
        {
            headers: {
                Authorization: `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 90000,
            maxBodyLength: 100 * 1024 * 1024,
        }
    );
    const data = res.data;
    const text = (data.choices?.[0]?.message?.content || '').trim();
    const pt = data.usage?.prompt_tokens;
    return { text, pt, verdict: classify(text, pt) };
}

async function probeModel(provider, model, video) {
    const started = Date.now();
    const parts = [
        { label: 'video_url', part: { type: 'video_url', video_url: { url: video.dataUrl } } },
        { label: 'file', part: { type: 'file', file: { filename: 'probe.mp4', file_data: video.dataUrl } } },
    ];

    let last = null;
    for (const { label, part } of parts) {
        try {
            const result = await callOnce(provider, model, video, part);
            if (result.verdict === 'bisa') {
                return {
                    id: model.id,
                    verdict: 'bisa',
                    via: label,
                    promptTokens: result.pt,
                    ms: Date.now() - started,
                    sample: result.text.slice(0, 160),
                };
            }
            // Simpan percobaan pertama; format berikutnya hanya dicoba kalau
            // hasilnya belum meyakinkan.
            if (!last) last = { ...result, via: label };
        } catch (error) {
            const msg =
                error.response?.data?.error?.message ||
                error.response?.data?.message ||
                error.message;
            if (!last) last = { verdict: 'error', via: label, text: '', sample: String(msg) };
        }
    }

    return {
        id: model.id,
        verdict: last.verdict,
        via: last.via,
        promptTokens: last.pt,
        ms: Date.now() - started,
        sample: (last.text || last.sample || '').slice(0, 160),
    };
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            out[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return out;
}

const LABEL = {
    bisa: 'BISA VIDEO',
    menolak: 'MENOLAK   ',
    tanpa_media: 'TANPA MEDIA',
    kosong: 'KOSONG    ',
    kosong_ada_media: 'KOSONG+MEDIA',
    tidak_jelas: 'TIDAK JELAS',
    error: 'ERROR     ',
};

(async () => {
    const wanted = process.argv[2];
    const includeAll = process.argv.includes('--all');

    const provider = wanted
        ? bc.getProviderByName(wanted)
        : bc.getActiveProvider();

    if (!provider) {
        console.error(`Provider "${wanted}" tidak ditemukan di config.yaml`);
        process.exit(1);
    }

    console.log(`Provider : ${provider.name}`);
    console.log(`Base URL : ${provider.base_url}`);

    const video = await buildProbeVideo();
    console.log(`Video uji: ${(video.bytes / 1024).toFixed(0)}KB, dua fase (${PHASE_A} / ${PHASE_B})`);

    const models = await fetchModels(provider, includeAll);
    console.log(`Model    : ${models.length} ${includeAll ? '(semua)' : '(diklaim video-capable)'}`);
    if (!models.length) {
        console.log('Tidak ada model untuk diuji.');
        process.exit(0);
    }
    console.log('');

    let done = 0;
    const results = await mapLimit(models, 3, async (model) => {
        const result = await probeModel(provider, model, video);
        done += 1;
        console.log(
            `[${String(done).padStart(2)}/${models.length}] ${LABEL[result.verdict]} ` +
            `${result.id} (${result.ms}ms${result.promptTokens ? `, pt=${result.promptTokens}` : ''})`
        );
        if (result.verdict !== 'bisa') {
            console.log(`           -> ${result.sample.replace(/\s+/g, ' ').slice(0, 110)}`);
        }
        return result;
    });

    const grouped = results.reduce((acc, r) => {
        (acc[r.verdict] ||= []).push(r);
        return acc;
    }, {});

    console.log('\n=== ringkasan ===');
    for (const key of ['bisa', 'menolak', 'tanpa_media', 'tidak_jelas', 'kosong_ada_media', 'kosong', 'error']) {
        const list = grouped[key] || [];
        if (!list.length) continue;
        console.log(`${LABEL[key]} (${list.length})`);
        list.forEach((r) => console.log(`   ${r.id}`));
    }

    const payload = {
        provider: provider.name,
        baseURL: provider.base_url,
        testedAt: new Date().toISOString(),
        videoBytes: video.bytes,
        results,
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\nHasil disimpan: ${path.relative(process.cwd(), RESULT_FILE)}`);

    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(0);
})().catch((error) => {
    console.error('ERR:', error.message);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    process.exit(1);
});
