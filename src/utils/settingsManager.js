const fs = require('fs').promises;
const path = require('path');

const SETTINGS_FILE = path.resolve(__dirname, '../../settings.json');
let settings = {};

async function loadSettings() {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf8');
        settings = JSON.parse(data);
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Error loading settings:', err);
        settings = {};
    }
    return settings;
}

async function saveSettings() {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function getPrefix(guildId) {
    if (!guildId) return 'd!';
    return settings[guildId]?.prefix || 'd!';
}

function setPrefix(guildId, prefix) {
    if (!settings[guildId]) settings[guildId] = {};
    settings[guildId].prefix = prefix;
    return saveSettings();
}

// Initial load
loadSettings();

module.exports = {
    loadSettings,
    saveSettings,
    getPrefix,
    setPrefix,
    settings
};
