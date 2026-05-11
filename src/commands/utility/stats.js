const os = require('os');

module.exports = {
    name: 'stats',
    description: 'Cek status bot dan resource usage',
    aliases: ['status'],
    async execute(message, args, client) {
        const load = os.loadavg()[0];
        const cpuCount = os.cpus().length;
        const cpuPercent = Math.min((load / cpuCount) * 100, 100).toFixed(1);

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const botUptimeSec = process.uptime();
        const botHours = Math.floor(botUptimeSec / 3600);
        const botMinutes = Math.floor((botUptimeSec % 3600) / 60);
        const botSeconds = Math.floor(botUptimeSec % 60);

        const pcUptimeSec = os.uptime();
        const pcHours = Math.floor(pcUptimeSec / 3600);
        const pcMinutes = Math.floor((pcUptimeSec % 3600) / 60);
        const pcSeconds = Math.floor(pcUptimeSec % 60);

        const formatBytes = (bytes) => {
            const gb = bytes / 1024 / 1024 / 1024;
            return gb.toFixed(2) + 'GB';
        };

        return message.reply(
            `**System Status**\n` +
            `> **CPU Load:** ${cpuPercent}%\n` +
            `> **RAM Usage:** ${formatBytes(usedMem)} / ${formatBytes(totalMem)}\n` +
            `> **Bot Uptime:** ${botHours}j ${botMinutes}m ${botSeconds}d\n` +
            `> **PC Uptime:** ${pcHours}j ${pcMinutes}m ${pcSeconds}d`
        );
    },
};
