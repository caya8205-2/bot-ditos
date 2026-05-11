const path = require('path');
const fs = require('fs');

let BOT_NAME = null;
let _pendingLogs = [];
const _originalLog = console.log;

const util = require('util');

// Intercept console.log immediately when module is loaded
console.log = (...args) => {
    const msg = util.format(...args);
    _pendingLogs.push(msg);
    _originalLog(msg);
};

// Helper untuk set nama bot (dipanggil nanti)
const setBotName = (name) => {
    BOT_NAME = name;
};

const applyLogger = (rootDir) => {
    // pilih nama folder aman (hindari Unknown)
    const getSafeFolder = () => BOT_NAME || "_TEMP";

    function writeLog(text) {
        const logDir = path.join(rootDir, "Log", getSafeFolder());
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        const logfile = path.join(
            logDir,
            `${new Date().toISOString().slice(0, 10)}.log`
        );

        fs.appendFileSync(logfile, `[${new Date().toISOString()}] ${text}\n`);
    }

    // console.log setelah logger aktif
    console.log = (...args) => {
        const msg = util.format(...args);

        let color = "\x1b[36m"; // default cyan
        if (BOT_NAME === "Bot Tia") color = "\x1b[35m";   // ungu
        if (BOT_NAME === "Bot Ditos") color = "\x1b[32m"; // hijau

        writeLog(msg);
        _originalLog(color + msg + "\x1b[0m");
    };

    // Flush log awal yg belum sempat disimpan
    for (const p of _pendingLogs) writeLog(p);
    _pendingLogs = [];

    // Export internal writeLog for external use
    module.exports.writeLog = writeLog;
};

module.exports = { setBotName, applyLogger };
