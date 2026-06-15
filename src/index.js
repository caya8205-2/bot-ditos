require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const { applyLogger } = require('./utils/logger');
const loadEvents = require('./handlers/eventHandler');
const loadCommands = require('./handlers/commandHandler');
const { reportErrorToDiscord } = require('./utils/helpers');
const { loadSettings } = require('./utils/settingsManager');

// 1. START LOGGER
const path = require('path'); // Ensure path is imported
applyLogger(path.resolve(__dirname, '../'));

// 2. CLIENT SETUP
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Load settings
loadSettings();

// Load Handlers
loadEvents(client);
loadCommands(client);

// 3. GLOBAL ERROR HANDLING
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Optional: report to discord if client is ready?
    if (client.isReady()) reportErrorToDiscord(client, reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    if (client.isReady()) reportErrorToDiscord(client, err);
});

// 4. LOGIN
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ Token Discord gak ada di .env! (DISCORD_TOKEN)');
    process.exit(1);
}

client.login(token);
