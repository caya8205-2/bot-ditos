# Bot Ditos

[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Local-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![youtubei.js](https://img.shields.io/badge/youtubei.js-Innertube-FF0000?logo=youtube&logoColor=white)](https://github.com/LuanRT/YouTube.js)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Audio-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![MIT](https://img.shields.io/badge/License-MIT-white)](./LICENSE)

Bot Discord modular fitur lengkap yang dibangun pake **Discord.js v14**. Bot ini dibuat iseng-iseng berhadiah, awalnya codingan spaghetti satu file doang (5,4k lines), sekarang udah di-refactor jadi arsitektur modular yang rapih, stabil, dan gampang dikembangin.

> **v2.1.0** — Music system rewrite (youtubei.js + scoring matcher + prefetch), SQLite persistence, FFmpeg stream fix.

---

## ⚠️ Disclaimer: Soal Personality

Bot ini dikasih nama **"Ditos"** karena terinspirasi dari temen gw yang namanya Ditos. Personality AI-nya itu dimodel 100% mirip dia — bisa nyolot, bisa receh, tapi tetap helpful.

Kalau mau clone dan gak sreg sama personality-nya, tinggal ubah System Prompt di:
**`src/utils/promptBuilder.js`** → bagian `SHARED_PERSONA`

---

## Fitur

### 🤖 AI Persona
- **Chat**: `d!chat` / `d!c` — ngobrol santai sama bot, punya personality unik
- **Memory Persisten**: Bot bisa inget info per user & server via `d!rem`, `d!rec`, `d!forg` — disimpan ke SQLite, aman dari corrupt
- **Vision**: Bisa "lihat" dan komentarin gambar yang dikirim
- **LLM Stack**: Local LLM (KoboldCpp) → 9router → Groq sebagai fallback bertingkat. Auto-switch kalau salah satu down

### 🎵 Music Player
- **Resolver**: `youtubei.js` (Innertube API) sebagai primary, `yt-dlp-exec` sebagai fallback
- **Spotify → YouTube Matcher**: Scoring system dengan 40+ keyword filter (official/reaction/cover/live detection), multi-query fallback, duration matching
- **Prefetch**: Stream URL lagu ke-2 dan ke-3 di-resolve di background sebelum giliran main → ganti lagu instant
- **Cache**: SQLite dual-index — hit by query string atau video ID langsung, URL TTL 6 jam
- **Source**: YouTube search, YouTube URL, YouTube playlist, Spotify track/playlist/album
- **Kontrol**: Tombol interaktif Play/Pause/Skip/Stop/Leave

### 🎮 Fun & Games
- **Trivia**: `d!trivia` + `d!quizscore` — leaderboard antar member
- **Jokes**: `d!joke` — dad jokes receh
- **Soundboard**: `d!sb` — klip suara lokal di voice channel

### 🛠️ Utilities
- **Cuaca**: `d!weather`
- **Google + AI**: `d!google`
- **Reminders**: `d!remind`
- **Info Server/User**: `d!si`, `d!ui`

---

## Struktur Project

```bash
bot-ditos/
├── src/
│   ├── commands/       # Command files (ai/, fun/, music/, utility/)
│   ├── events/         # Event handlers (clientReady, messageCreate, dll)
│   ├── handlers/       # Auto-loader untuk commands & events
│   ├── utils/          # Core logic — AI, music, DB, voice, UI
│   │   ├── db.js              # SQLite singleton + schema + auto-migration
│   │   ├── youtubeResolver.js # Primary resolver via youtubei.js
│   │   ├── youtubeMatcher.js  # Spotify→YouTube scoring system
│   │   ├── prefetchManager.js # Background prefetch untuk instant playback
│   │   ├── musicCache.js      # SQLite cache (audio URL + metadata)
│   │   ├── llmManager.js      # LLM fallback chain (Local→9router→Groq)
│   │   └── promptBuilder.js   # System prompt + persona builder
│   └── data/           # State sementara & constants
├── data/               # Runtime data (bot.db, *.migrated) — gitignored
├── legacy/             # File asli sebelum refactor (lihat bagian Legacy)
├── sounds/             # Audio clips untuk soundboard
└── start-bot.js        # Entry point dengan auto-restart
```

---

## Requirements

- **Node.js** >= 18
- **KoboldCpp** (opsional, untuk local LLM) — jalankan di `http://127.0.0.1:5001`
- Akun Discord Developer (bot token)
- Spotify Developer Web API Key (buat spotify metadata, berguna buat fitur play musik)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/caya8205-2/bot-ditos.git
cd bot-ditos
npm i
```

### 2. Buat file `.env`

Copy dari `env.example`, lalu isi:

```bash
# Discord
DISCORD_TOKEN=token_discord_kamu

# LLM — Local (primary)
# Opsional, bisa ganti urutan fallback nya di `src/utils/llmManager.js`
LOCAL_LLM_BASE_URL=http://127.0.0.1:5001/v1
LOCAL_LLM_MODEL=Qwen2-VL-2B-Instruct-Q8_0.gguf
LOCAL_LLM_TIMEOUT_MS=120000
LOCAL_LLM_FALLBACK_COOLDOWN_MS=300000
LOCAL_LLM_INPUT_TOKEN_BUDGET=6000

# LLM — 9router (fallback 1)
9ROUTER_BASE_URL=
9ROUTER_API_KEY=
9ROUTER_MODEL=auto
9ROUTER_TIMEOUT_MS=120000
9ROUTER_FALLBACK_COOLDOWN_MS=60000

# LLM — Groq (fallback 2)
GROQ_API_KEY=
GROQ_FALLBACK_MODEL=llama-3.3-70b-versatile

# External APIs
GEMINI_API_KEY=       # Vision
WEATHER_API_KEY=      # d!weather
GOOGLE_CSE_KEY=       # d!google
GOOGLE_CSE_CX=        # d!google
SPOTIFY_CLIENT_ID=    # Music player
SPOTIFY_CLIENT_SECRET=
CIVITAI_API_KEY=      # Opsional, gak di maintain code nya
```

> `PROMPT_METRICS_ENABLED=true` bisa ditambahkan untuk log estimasi token di console.

### 3. Jalankan

```bash
npm start       # Production (dengan auto-restart via start-bot.js)
npm run dev     # Development (nodemon)
```

Bot self-hosted di PC sendiri. Disarankan pakai **pm2** atau biarkan `start-bot.js` handle auto-restart — sudah built-in.

> **Database**: Saat pertama kali start setelah upgrade ke v2.1.0, bot otomatis migrasi data lama dari JSON ke SQLite (`data/bot.db`). File JSON lama di-rename jadi `.migrated` sebagai backup.

---

## Legacy

Di folder `legacy/` masih tersimpan versi asli bot ini — **satu file JavaScript tunggal dengan ~5.400 baris kode**. Ini adalah versi dari 2024, ditulis pas masih iseng belajar Discord.js v13, sebelum akhirnya di-rewrite total ke arsitektur modular yang sekarang.

Dibiarkan di sini bukan karena masih dipakai, tapi karena jadi bukti perjalanan — dari spaghetti code anak kuliah sampai ke yang sekarang.

---

## Lisensi

[MIT](LICENSE) — bebas dipelajari, dimodif, atau dijadiin base project sendiri. Kalau mau nulis credit, boleh. Kalau enggak, juga gapapa.
