const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const REMINDERS_FILE = path.join(__dirname, '../../reminders.json');
async function loadReminders() {
    try {
        const raw = await fsp.readFile(REMINDERS_FILE, 'utf8');
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

async function saveReminders(data) {
    try {
        await fsp.writeFile(REMINDERS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Reminders save error:', e);
    }
}

function parseDuration(s) {
    if (!s) return null;
    const m = s.toLowerCase().match(/^(\d+)\s*(s|m|h|d)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    switch (unit) {
        case 's': return n * 1000;
        case 'm': return n * 60 * 1000;
        case 'h': return n * 60 * 60 * 1000;
        case 'd': return n * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

async function restartAllReminders(client) {
    const data = await loadReminders();
    const now = Date.now();

    for (const [userId, list] of Object.entries(data)) {
        if (!Array.isArray(list)) continue;

        for (const entry of list) {

            // Validasi lengkap
            if (!entry.remindAt || !entry.id || !entry.text || !entry.channelId) {
                console.warn("Reminder invalid, skip:", entry);
                continue;
            }

            let delay = entry.remindAt - now;

            // Kalau waktunya sudah lewat → kirim langsung
            if (delay <= 0) delay = 1000;

            setTimeout(async () => {
                try {
                    const out = `<@${entry.userId}> Reminder: ${entry.text}`;

                    // coba kirim ke channel dulu
                    let ch = null;
                    try { ch = await client.channels.fetch(entry.channelId); } catch { }

                    if (ch && ch.isTextBased() && ch.send) {
                        await ch.send(out).catch(() => null);
                    } else {
                        // fallback DM
                        const u = await client.users.fetch(entry.userId).catch(() => null);
                        if (u) await u.send(out).catch(() => null);
                    }

                    // remove dari file setelah terkirim
                    const loaded = await loadReminders();
                    const arr = loaded[entry.userId] || [];
                    const idx = arr.findIndex(r => r.id === entry.id);

                    if (idx !== -1) {
                        arr.splice(idx, 1);
                        if (arr.length) loaded[entry.userId] = arr;
                        else delete loaded[entry.userId];
                        await saveReminders(loaded);
                    }
                } catch (err) {
                    console.error("Reminder restart send error:", err);
                }
            }, delay);
        }
    }
}

module.exports = { loadReminders, saveReminders, parseDuration, restartAllReminders };
