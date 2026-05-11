const { ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { setBotName } = require('../utils/logger');
const { loadMemory, loadTriviaScore, setMemoryData, setTriviaScore } = require('../utils/helpers');
const { restartAllReminders } = require('../utils/reminderManager');
const { TEMP_DIR } = require('../config');
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
        setTimeout(refreshSpotifyToken, 50 * 60 * 1000);
    } catch (err) {
        console.error('[Spotify] Token refresh error:', err);
    }
}

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        setBotName(client.user.username);
        if (fs.existsSync(TEMP_DIR)) {
            try {
                const files = fs.readdirSync(TEMP_DIR);
                for (const file of files) {
                    fs.unlinkSync(path.join(TEMP_DIR, file));
                }
                console.log("[LOGGER] Folder _TEMP dibersihkan.");
            } catch (err) {
                console.log("[LOGGER] Gagal hapus _TEMP:", err);
            }
        }

        console.log(`Logged in as ${client.user.tag}`);

        // Load Memory
        try {
            const mem = await loadMemory();
            const { setMemoryData, setTriviaScore } = require('../data/state');
            setMemoryData(mem);
            console.log("[Bot Ditos] Memory loaded:", Object.keys(mem).length, "items");
        } catch (err) {
            console.error("[Bot Ditos] Failed to load memory:", err);
        }

        // Load Trivia
        try {
            const { loadTriviaScore } = require('../utils/helpers');
            const score = await loadTriviaScore();
            const { setTriviaScore } = require('../data/state');
            setTriviaScore(score);
            console.log("[Bot Ditos] Trivia score loaded");
        } catch (err) {
            console.error("[Bot Ditos] Failed to load trivia score:", err);
        }

        await restartAllReminders(client);

        const botStatus = [
            'd!help',
            'akulah mister D',
            `with ${client.users.cache.size} members in ${client.guilds.cache.size} servers!`,
        ];

        setInterval(() => {
            const status = botStatus[Math.floor(Math.random() * botStatus.length)];
            client.user.setActivity(status, { type: ActivityType.Listening });
        }, 5000);

        if (process.env.SPOTIFY_CLIENT_ID) {
            refreshSpotifyToken();
        }

        console.log(`${client.user.username} is online!`);
    },
};
