const { fetchGroqLimits, getDailyResetInfo, createStatusEmbed, replyEmbedAndSave } = require('../../utils/helpers');

module.exports = {
    name: 'groqstatus',
    description: 'Cek apakah API masih bisa dipake',
    aliases: ['gs'],
    async execute(message, args, client) {
        try {
            const model = "llama-3.3-70b-versatile";
            const { limits, json, status } = await fetchGroqLimits(model);

            if (!limits || !status) {
                return replyEmbedAndSave(message, createStatusEmbed({ title: "Groq Error", description: "Unable to fetch limits" }));
            }

            if (!limits.reqLimit) {
                const daily = getDailyResetInfo();
                const embed = createStatusEmbed({
                    title: "🌐 Groq API Status",
                    color: "#FFC107",
                    description: "Groq API aktif, tapi server **tidak mengirim header rate-limit** untuk model ini.",
                    fields: [
                        { name: "Model", value: model, inline: true },
                        { name: "Catatan", value: "Coba model lain atau tunggu 1–2 menit saat rate limiter idle.", inline: false }
                    ]
                });
                return replyEmbedAndSave(message, { embeds: [embed] });
            }

            const reqLimit = Number(limits.reqLimit);
            const reqRemaining = Number(limits.reqRemaining);
            const tokLimit = Number(limits.tokLimit);
            const tokRemaining = Number(limits.tokRemaining);

            const reqUsed = reqLimit - reqRemaining;
            const tokUsed = tokLimit - tokRemaining;

            const reqPercent = ((reqUsed / reqLimit) * 100).toFixed(1);
            const tokPercent = ((tokUsed / tokLimit) * 100).toFixed(1);

            // Reset indicator
            let resetStatus = "⚪ Normal";
            if (reqUsed <= 1 && tokUsed <= 50) {
                resetStatus = "🟢 Baru reset (limit fresh)";
            } else if (reqPercent < 30 && tokPercent < 30) {
                resetStatus = "🟢 Aman";
            } else if (reqPercent < 70 && tokPercent < 70) {
                resetStatus = "🟡 Lumayan kepake";
            } else {
                resetStatus = "🔴 Hampir limit!";
            }

            // Tambahan short explanation
            let simpleStatus = "";
            if (resetStatus.includes("Baru reset")) {
                simpleStatus = "Limit baru ke-refresh, penggunaan masih sangat sedikit.";
            } else if (resetStatus.includes("Aman")) {
                simpleStatus = "Pemakaian rendah, API aman dipakai.";
            } else if (resetStatus.includes("Lumayan")) {
                simpleStatus = "Mulai kepake, tapi masih jauh dari limit.";
            } else {
                simpleStatus = "Warning! Limit sudah dekat, bot bisa error kalau spam.";
            }

            // Embed normal
            const daily = getDailyResetInfo();
            const embed = createStatusEmbed({
                title: "🌐 Groq API Status",
                color: "#4CAF50",
                description: "Groq API aktif dan bisa dipake.",
                fields: [
                    { name: "🔢 Requests", value: `${limits.reqRemaining}/${limits.reqLimit}\nReset: ${limits.reqReset}s`, inline: true },
                    {
                        name: "🧮 Tokens (Per Menit)",
                        value: `${limits.tokRemaining}/${limits.tokLimit}\nReset: ${limits.tokReset}s\n*Limit TPM (per menit), bukan limit harian.*`,
                        inline: true
                    },
                    { name: "📊 Pemakaian Requests", value: `${reqUsed}/${reqLimit} (${reqPercent}%)`, inline: true },
                    { name: "🔢 Pemakaian Tokens", value: `${tokUsed}/${tokLimit} (${tokPercent}%)`, inline: true },
                    { name: "🧭 Status Window", value: `${resetStatus}\n${simpleStatus}`, inline: false },
                    {
                        name: "📅 Token Harian (TPD)",
                        value: "Groq tidak mengirim info limit harian kecuali saat TPD tercapai.\nDefault: ±100.000 token/hari.",
                        inline: false
                    },
                    { name: "🗓 Reset Harian", value: `Setiap 07:00 WIB\nReset dalam: **${daily.inText}**`, inline: false },
                ]
            });

            return replyEmbedAndSave(message, { embeds: [embed] });

        } catch (err) {
            console.error("[GS ERROR]", err);

            // ⭐ NEW: TPD DETECTION
            const dailyRegex = /Limit (\d+)[^\d]+Used (\d+)[^\d]+Requested (\d+)/i;
            const match = err.message.match(dailyRegex);

            if (match) {
                const dailyLimit = Number(match[1]);
                const dailyInfo = getDailyResetInfo();
                const dailyUsed = Number(match[2]);
                const dailyRequested = Number(match[3]);
                const dailyRemaining = dailyLimit - dailyUsed;

                const percent = ((dailyUsed / dailyLimit) * 100).toFixed(1);

                const tpdEmbed = createStatusEmbed({
                    title: "🔴 Daily Token Limit (TPD) Habis",
                    color: "#E53935",
                    description: "Kamu sudah mencapai batas token harian (TPD) dari Groq.",
                    fields: [
                        { name: "🧮 Total Harian", value: dailyLimit.toLocaleString(), inline: true },
                        { name: "📊 Terpakai", value: dailyUsed.toLocaleString(), inline: true },
                        { name: "🔢 Sisa Harian", value: dailyRemaining.toLocaleString(), inline: true },
                        { name: "📈 Persentase Pemakaian", value: `${percent}%`, inline: true },
                        { name: "❗ Requested", value: dailyRequested.toLocaleString(), inline: true },
                        { name: "ℹ️ Info", value: "Limit ini **reset besok** (UTC). Kamu harus nunggu sampai reset harian selesai." },
                        { name: "🗓 Reset Harian", value: `Reset dalam: **${dailyInfo.inText}**\n(Reset pukul 07:00 WIB)`, inline: false },
                    ]
                });

                return replyEmbedAndSave(message, tpdEmbed);
            }

            // ⭐ FALLBACK error embed biasa
            const embed = createStatusEmbed({
                title: "❌ Groq API Error",
                color: "#E53935",
                description: `Terjadi error:\n\`\`\`${err.message}\`\`\`\n`,
            });

            return replyEmbedAndSave(message, { embeds: [embed] });
        }
    },
};
