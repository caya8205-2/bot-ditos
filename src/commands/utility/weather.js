const { EmbedBuilder } = require('discord.js');
const { replyEmbedAndSave } = require('../../utils/helpers');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();

module.exports = {
    name: 'w',
    description: 'Cek cuaca di lokasi tertentu',
    aliases: ['weather'],
    async execute(message, args, client) {
        const location = args.join(' ').trim();
        if (!location) {
            return message.reply('Mau cek cuaca mana? Contoh: `d!weather jakarta`');
        }

        const apiKey = process.env.WEATHER_API_KEY;

        try {
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric&lang=id`;

            const res = await fetch(url);
            const data = await res.json();

            if (!data || data.cod !== 200) {
                console.log("[Weather Debug Response]", data);
                return message.reply('Gak bisa ambil data cuacanya, kotanya mungkin salah atau API key bermasalah.');
            }

            const name = data.name;
            const temp = data.main.temp;
            const feels = data.main.feels_like;
            const hum = data.main.humidity;
            const wind = data.wind.speed;
            const desc = data.weather[0].description;

            const weatherEmbed = new EmbedBuilder()
                .setTitle(`🌤 Cuaca: ${name}`)
                .setColor('#4FC3F7')
                .setDescription(`**${desc}**`)
                .addFields(
                    { name: "🌡 Suhu", value: `${temp}°C\n(kerasa: ${feels}°C)`, inline: true },
                    { name: "💧 Kelembaban", value: `${hum}%`, inline: true },
                    { name: "💨 Angin", value: `${wind} m/s`, inline: true }
                )
                .setTimestamp();

            return replyEmbedAndSave(message, { embeds: [weatherEmbed] });

        } catch (err) {
            console.error('Weather error:', err);

            const errEmbed = new EmbedBuilder()
                .setTitle("⛔ Weather Error")
                .setColor("#E53935")
                .setDescription("Server cuaca nya lagi error, coba sebentar lagi.");
            return replyEmbedAndSave(message, { embeds: [errEmbed] });
        }
    },
};
