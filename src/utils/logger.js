const path = require('path');
const fs = require('fs');

let BOT_NAME = null;
let _pendingLogs = [];
const _originalLog = console.log;

const util = require('util');

function getJakartaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);

    return Object.fromEntries(
        parts
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value])
    );
}

function formatLogTimestamp(date = new Date()) {
    const { day, month, year, hour, minute, second } = getJakartaDateParts(date);
    return `${day}/${month}/${year} ${hour}:${minute}:${second} WIB`;
}

function formatLogDate(date = new Date()) {
    const { day, month, year } = getJakartaDateParts(date);
    return `${year}-${month}-${day}`;
}

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
            `${formatLogDate()}.log`
        );

        fs.appendFileSync(logfile, `[${formatLogTimestamp()}] ${text}\n`);
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

module.exports = { setBotName, applyLogger, formatLogTimestamp, formatLogDate };
