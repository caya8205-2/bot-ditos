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

    console.log('\nALL SUITE TESTS PASSED SUCCESSFULLY (YouTube + Spotify Direct).');
}

testAll().catch((err) => {
    console.error('[TEST FAILED]', err);
    process.exit(1);
});
