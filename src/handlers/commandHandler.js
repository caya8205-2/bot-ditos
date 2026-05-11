const fs = require('fs');
const path = require('path');

module.exports = (client) => {
    client.commands = new Map();
    client.aliases = new Map();

    const commandsPath = path.join(__dirname, '../commands');
    const readCommands = (dir) => {
        const files = fs.readdirSync(dir);

        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.lstatSync(fullPath);

            if (stat.isDirectory()) {
                readCommands(fullPath);
            } else if (file.endsWith('.js')) {
                const command = require(fullPath);
                if (command.name && command.execute) {
                    client.commands.set(command.name, command);
                    console.log(`[CMD] Loaded: ${command.name}`);

                    if (command.aliases && Array.isArray(command.aliases)) {
                        command.aliases.forEach(alias => client.aliases.set(alias, command.name));
                    }
                } else {
                    console.warn(`[CMD] Skipped ${file} (missing name or execute)`);
                }
            }
        }
    };

    if (fs.existsSync(commandsPath)) {
        readCommands(commandsPath);
    }
};
