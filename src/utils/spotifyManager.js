const SpotifyWebApi = require('spotify-web-api-node');

const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

async function refreshSpotifyToken() {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body.access_token);
        console.log('[Spotify] Token refreshed');
    } catch (err) {
        console.error('[Spotify] Token refresh error:', err);
    }
}

// Auto-refresh loop
if (process.env.SPOTIFY_CLIENT_ID) {
    setInterval(refreshSpotifyToken, 3000 * 1000); // 50 menit
    refreshSpotifyToken(); // Initial
}

module.exports = { spotifyApi, refreshSpotifyToken };
