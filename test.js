'use strict';

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

    console.log('\nALL SUITE TESTS PASSED SUCCESSFULLY.');
}

testAll().catch((err) => {
    console.error('[TEST FAILED]', err);
    process.exit(1);
});
