'use strict';

// test.js dijalankan langsung dengan `node test.js`, bukan lewat bot, jadi
// .env tidak ikut dimuat. Tanpa ini semua pengecekan yang bergantung pada env
// (Groq, router, ZenMux) akan salah menyimpulkan key belum dikonfigurasi.
require('dotenv').config({ quiet: true });

const assert = require('assert');
const r = require('./src/utils/youtubeResolver');
const s = require('./src/utils/spotifyResolver');

async function testAll() {
    console.log('[TEST] Checking searchTracks (YouTube)...');
    const searchRes = await r.searchTracks('King Gnu SPECIALZ', 2);
    assert(Array.isArray(searchRes), 'Search result should be an array');
    assert(searchRes.length > 0, 'Search should return at least 1 track');
    assert(searchRes[0].id && searchRes[0].title, 'Track must have id and title');
    console.log(' -> PASS: searchTracks returned', searchRes.length, 'tracks');

    console.log('[TEST] Checking getYoutubeTrack...');
    const track = await r.getYoutubeTrack('fhzKLBZJC3w');
    assert(track.id === 'fhzKLBZJC3w', 'Track ID mismatch');
    assert(track.title.length > 0, 'Track title must not be empty');
    console.log(' -> PASS: getYoutubeTrack resolved', track.title);

    console.log('[TEST] Checking resolveAudioUrl...');
    const audio = await r.resolveAudioUrl('fhzKLBZJC3w');
    assert(typeof audio.url === 'string' && audio.url.startsWith('http'), 'Audio URL must be valid HTTP(S) URL');
    assert(audio.format === 'm4a' || audio.format === 'webm' || audio.format === 'audio', 'Audio format must be recognized');
    console.log(' -> PASS: resolveAudioUrl resolved audio format:', audio.format);

    console.log('[TEST] Checking getYoutubePlaylistTracks...');
    const pl = await r.getYoutubePlaylistTracks('PLcwSN1dMiPp7-zS0pz_uiRreJopx9EHpY', 2);
    assert(Array.isArray(pl.tracks), 'Playlist tracks must be an array');
    assert(pl.tracks.length > 0, 'Playlist must contain tracks');
    console.log(' -> PASS: getYoutubePlaylistTracks returned playlist:', pl.name, 'with', pl.tracks.length, 'tracks');

    console.log('\n[TEST] Checking SpotifyResolver URL matching & parsing...');
    assert(s.isSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=123'), 'Must detect Spotify track URL');
    assert(s.isSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), 'Must detect Spotify playlist URI');
    const parsedTrack = s.parseSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=123');
    assert(parsedTrack && parsedTrack.type === 'track' && parsedTrack.id === '4cOdK2wGLETKBW3PvgPWqT', 'Track URL parsing failed');
    console.log(' -> PASS: isSpotifyUrl & parseSpotifyUrl validated');

    console.log('[TEST] Checking spotstream authentication status...');
    const ready = await s.isSpotstreamReady();
    assert(ready === true, 'spotstream must be authenticated and ready');
    console.log(' -> PASS: spotstream authenticated: true');

    console.log('[TEST] Checking spotstream getTrackInfo...');
    const spotInfo = await s.getTrackInfo('4cOdK2wGLETKBW3PvgPWqT');
    assert(spotInfo.title && spotInfo.artists && spotInfo.artists.length > 0, 'Track info must have title and artists');
    console.log(' -> PASS: getTrackInfo resolved:', spotInfo.title, 'by', spotInfo.artists.join(', '));

    console.log('\n[TEST] Checking extractReactionAndCleanReply...');
    const { extractReactionAndCleanReply } = require('./src/utils/helpers');
    const parsedReact = extractReactionAndCleanReply('[react: <:bwakakak2:1299912831826788385>] wkwk kocak');
    assert.strictEqual(parsedReact.reaction, '1299912831826788385', 'Must extract emoji ID');
    assert.strictEqual(parsedReact.cleanText, 'wkwk kocak', 'Must strip reaction tag from reply text');
    console.log(' -> PASS: extractReactionAndCleanReply parsed and stripped correctly');

    console.log('\n[TEST] Checking messageContext (tone, image detection, history meta)...');
    const mc = require('./src/utils/messageContext');
    const seriousCase = mc.detectConversationTone(['kakek baru meninggal tadi pagi', 'sedih banget']);
    assert.strictEqual(seriousCase.tone, 'serious', 'Must detect serious conversation tone');
    const humorCase = mc.detectConversationTone(['wkwkwk anjir receh banget', '🗿']);
    assert.strictEqual(humorCase.tone, 'humor', 'Must detect humor conversation tone');
    assert.strictEqual(mc.isImageAttachment({ contentType: 'image/jpeg' }), true, 'PNG/JPEG must be recognized as image');
    assert.strictEqual(mc.isImageAttachment({ name: 'foto.PNG' }), true, 'Fallback by extension must work');
    assert.strictEqual(mc.isImageAttachment({ name: 'video.mp4' }), false, 'Non-image must be rejected');

    const meta = mc.buildHistoryMeta({
        attachments: new Map([['1', { url: 'https://cdn.discord/a.jpg', contentType: 'image/jpeg' }]]),
        reference: { messageId: '123' },
    }, { author: { username: 'udin' }, content: 'pesan asal' });
    assert.strictEqual(meta.imageUrls?.[0], 'https://cdn.discord/a.jpg', 'Image URLs must be stored in history meta');
    assert.strictEqual(meta.replyTo?.username, 'udin', 'Referenced author must be stored in history meta');
    console.log(' -> PASS: messageContext helpers passed unit checks');

    console.log('\n[TEST] Checking router model chain fallback (NINER_FALLBACK_MODEL)...');
    const llm = require('./src/utils/llmManager');
    const chain = llm.getRouterModelChain();
    assert(chain.length >= 1, 'Router chain must contain at least the primary model');
    assert.strictEqual(chain[0], llm.NINER_MODEL, 'Chain must start with the primary model');
    if (llm.NINER_FALLBACK_MODEL) {
        assert.strictEqual(chain[1], llm.NINER_FALLBACK_MODEL, 'Chain must include the router fallback model second');
    }

    {
        const calls = [];
        const okResult = (text) => ({ choices: [{ message: { content: text } }] });
        const fail500 = () => { const err = new Error('upstream 500'); err.status = 500; return err; };

        const routerPartial = async (fn) => fn({
            chat: { completions: { create: async (opts) => {
                calls.push(opts.model);
                if (opts.model === llm.NINER_MODEL) throw fail500();
                return okResult('fallback-router-answer');
            } } },
        });
        const groqSpy = async () => { calls.push('GROQ'); return okResult('groq-answer'); };

        // Model fallback router bisa berada di provider berbeda (base URL
        // sendiri), jadi caller-nya pun terpisah. Keduanya harus di-inject
        // supaya test tidak menembak jaringan sungguhan.
        const fallbackProviderSpy = async (fn) => fn({
            chat: { completions: { create: async (opts) => {
                calls.push(opts.model);
                if (opts.model === llm.NINER_MODEL) throw fail500();
                return okResult('fallback-router-answer');
            } } },
        });

        const result = await llm.callLLMWithFallback(
            async (client) => client.chat.completions.create({ model: 'x', messages: [] }),
            {
                ninerCaller: routerPartial,
                ninerFallbackCaller: fallbackProviderSpy,
                groqCaller: groqSpy,
            }
        );
        assert.strictEqual(result.choices[0].message.content, 'fallback-router-answer', 'Router fallback model must serve the request');
        assert(!calls.includes('GROQ'), 'Groq must not be called when a router fallback model succeeds');
        console.log(' -> PASS: router fallback model used before Groq');
    }

    console.log('\n[TEST] Checking fallback provider routing (separate base URL)...');
    {
        const nm = require('./src/utils/ninerManager');
        const providerChain = llm.getRouterProviderChain();
        assert(providerChain.length >= 1, 'Provider chain must not be empty');
        assert.strictEqual(providerChain[0].provider, 'niner-primary', 'First entry must use the primary provider');

        if (nm.isFallbackProviderAvailable()) {
            const fallbackEntry = providerChain.find((e) => e.isFallbackProvider);
            assert(fallbackEntry, 'Fallback provider entry must exist when configured');
            assert.strictEqual(fallbackEntry.baseURL, nm.NINER_FALLBACK_BASE_URL, 'Fallback entry must use its own base URL');
            assert.notStrictEqual(fallbackEntry.baseURL, nm.NINER_BASE_URL, 'Fallback base URL must differ from primary');
        }

        // Request harus diarahkan ke caller provider yang benar, bukan satu caller.
        const trace = [];
        const okResult = (text) => ({ choices: [{ message: { content: text } }] });
        const fail500 = () => { const err = new Error('upstream 500'); err.status = 500; return err; };

        const primaryCaller = async (fn) => {
            trace.push('primary-caller');
            return fn({ chat: { completions: { create: async () => { throw fail500(); } } } });
        };
        const fallbackCaller = async (fn) => {
            trace.push('fallback-caller');
            return fn({ chat: { completions: { create: async () => okResult('fallback-provider-answer') } } });
        };
        const groqSpy = async () => { trace.push('GROQ'); return okResult('groq-answer'); };

        const res = await llm.callLLMWithFallback(
            async (client) => client.chat.completions.create({ model: 'x', messages: [] }),
            { ninerCaller: primaryCaller, ninerFallbackCaller: fallbackCaller, groqCaller: groqSpy }
        );
        assert.strictEqual(res.choices[0].message.content, 'fallback-provider-answer', 'Fallback provider must serve the request');
        assert(trace.includes('fallback-caller'), 'Fallback provider caller must be invoked');
        assert(!trace.includes('GROQ'), 'Groq must not be called while fallback provider works');
        console.log(' -> PASS: fallback provider used with its own caller and base URL');
    }

    console.log('\n[TEST] Checking chat command reply context helper...');
    {
        // chat.js memakai resolveReferencedMessage yang sama dengan auto-chat.
        const mc = require('./src/utils/messageContext');
        const repliedMsg = {
            author: { username: 'rendi' },
            content: 'joke lama yang lucu',
            attachments: new Map([['a1', { url: 'https://cdn.discord/x.jpg', contentType: 'image/png' }]]),
        };
        const cmdMsg = { reference: { messageId: '999', message: repliedMsg } };

        const ref = await mc.resolveReferencedMessage(cmdMsg);
        assert.strictEqual(ref.author.username, 'rendi', 'Reply author must resolve');
        assert.strictEqual(ref.content, 'joke lama yang lucu', 'Reply content must resolve');
        assert.strictEqual(mc.getImageAttachments(ref).length, 1, 'Reply image must be detected');
        console.log(' -> PASS: chat reply context resolves with image');
    }

    console.log('\n[TEST] Checking video capability detection...');
    {
        const { isVideoSupported, isVisionSupported } = require('./src/utils/visionHelper');
        assert.strictEqual(isVideoSupported('gemini-2.5-flash'), true, 'Gemini 2.5 harus video-capable');
        assert.strictEqual(isVideoSupported('z-ai/glm-4.6v-flash-free'), true, 'GLM 4.6V harus video-capable');
        assert.strictEqual(isVideoSupported('gpt-4o'), false, 'GPT-4o vision tapi bukan video');
        assert.strictEqual(isVideoSupported('deepseek-chat'), false, 'DeepSeek bukan video');
        assert.strictEqual(isVisionSupported('z-ai/glm-4.6v-flash-free'), true, 'GLM 4.6V harus vision');
        console.log(' -> PASS: video/vision detection benar');

        const mc = require('./src/utils/messageContext');
        assert.strictEqual(mc.isVideoAttachment({ contentType: 'video/mp4' }), true);
        assert.strictEqual(mc.isVideoAttachment({ name: 'clip.MOV' }), true);
        assert.strictEqual(mc.isVideoAttachment({ contentType: 'image/png' }), false);
        console.log(' -> PASS: deteksi attachment video benar');
    }

    console.log('\n[TEST] Checking video compression settings...');
    {
        const vv = require('./src/utils/videoVisionManager');
        // Clip Discord ~50MB harus bisa diunduh, dan hasil kompresi di bawah target.
        assert(vv.VISION_VIDEO_DOWNLOAD_MAX_BYTES >= 50 * 1024 * 1024,
            'Batas unduh harus mengakomodasi clip Discord ~50MB');
        assert(vv.VISION_VIDEO_TARGET_BYTES <= 12 * 1024 * 1024,
            'Target kompresi harus cukup kecil untuk base64');
        assert(vv.VISION_VIDEO_MAX_HEIGHT >= 360,
            'Resolusi hasil minimal 360p supaya teks masih terbaca');
        console.log(' -> PASS: konfigurasi video masuk akal');
    }

    console.log('\n[TEST] Checking video format and fallback behaviour...');
    {
        const vv = require('./src/utils/videoVisionManager');
        const mc = require('./src/utils/messageContext');

        // ZenMux memakai tipe `file` untuk video, bukan `video_url`.
        const direct = mc.renderVideoParts([{
            mode: 'direct', dataUrl: 'data:video/mp4;base64,AAA', label: 'Video', filename: 'a.mp4',
        }]);
        assert(direct.some((p) => p.type === 'file'), 'Video direct harus jadi part file');
        assert(!direct.some((p) => p.type === 'video_url'), 'video_url bukan tipe yang dikenal');

        // Model yang tidak menerima video harus ditandai supaya tidak diulang.
        assert.strictEqual(vv.isModelMarkedVideoUnsupported('uji-model'), false);
        vv.markModelVideoUnsupported('uji-model');
        assert.strictEqual(vv.isModelMarkedVideoUnsupported('uji-model'), true);
        console.log(' -> PASS: format video dan penanda model benar');
    }

    console.log('\n[TEST] Checking vision manager generik...');
    {
        const vm = require('./src/utils/visionManager');
        // Modul tidak boleh lagi terikat Gemini.
        assert(typeof vm.describeImage === 'function', 'describeImage harus ada');
        assert(typeof vm.extractTextFromImage === 'function', 'extractTextFromImage harus ada');
        assert(typeof vm.getVisionCandidates === 'function', 'getVisionCandidates harus ada');

        // geminiManager hanya wrapper kompatibilitas, bukan SDK Gemini.
        const gm = require('./src/utils/geminiManager');
        assert(typeof gm.analyzeImageWithGemini === 'function', 'Wrapper lama harus tetap ada');
        assert.strictEqual(gm.describeImage, vm.describeImage, 'Wrapper harus meneruskan ke visionManager');
        console.log(' -> PASS: vision manager generik dan wrapper kompatibilitas benar');
    }

    console.log('\nALL SUITE TESTS PASSED SUCCESSFULLY.');
}

testAll().catch((err) => {
    console.error('[TEST FAILED]', err);
    process.exit(1);
});
