const path = require('path');

module.exports = {
    OWNER_ID: '756989869108101243',
    ERROR_CHANNEL_ID: '1442006544030896138',
    MAIN_GUILD_ID: '1110264688102617141',
    WELCOME_CHANNEL_ID: '1442463723385126933',
    GTTS_PATH: 'C:\\Users\\820g4\\AppData\\Local\\Programs\\Python\\Python310\\Scripts\\gtts-cli.exe',

    // Paths
    TEMP_DIR: path.join(__dirname, '../temp'),
    MEMORY_FILE: path.join(__dirname, '../memory.json'),
    getPath: (filename) => path.join(__dirname, '../..', filename),
    ROOT_DIR: path.resolve(__dirname, '../')
};
