# Bot Ditos

Bot Discord modular fitur lengkap yang dibangun pake **Discord.js v14**. Bot ini dibuat iseng-iseng berhadiah, awalnya codingan spaghetti satu file doang (5,4k lines), sekarang udah di-refactor jadi arsitektur modular yang rapih, stabil, dan gampang dikembangin.

## Disclaimer: Soal Personality

**PENTING:** Bot ini dikasih nama "Ditos" karena terinspirasi dari temen gw yang namanya Ditos. Personality AI-nya itu dimodel 100% mirip dia.

Buat yang mau clone repo ini tapi gak sreg sama personality-nya (misal terlalu nyolot atau aneh), kalian bisa ganti System Prompt-nya.
**Lokasi file:** `src/commands/ai/chat.js`
Cari bagian `role: 'system'` terus ubah sesuka hati kalian.

## Fitur-Fitur Kece

### AI Persona (Integrasi Groq)
- **Ngobrol Santuy**: Pake command `d!chat` atau `d!c`. Bot-nya punya personality unik, lucu, dan kadang nyebelin (in a good way).
- **Ingetan Kuat**: Punya memori persisten per user & channel. Bisa nyimpen catetan pake `d!rem`, `d!rec`, `d!forg`.
- **Mata Batin (Vision)**: Bisa "liat" gambar yang kalian kirim dan komentarin.

### Music Player High-Quality
- **Support Luas**: Bisa puter lagu dari YouTube (Search/Playlist) dan Spotify (Track/Playlist).
- **Tombol Interaktif**: Ada tombol Play/Pause/Skip/Stop/Leave yang responsif.
- **Anti-Bug**: Udah dipasang logic anti "Race Condition", jadi aman kalo kalian spam tombol skip/stop.

### Fun & Games
- **Trivia**: Adu pinter sama temen server, lengkap sama leaderboard (`d!trivia` & `d!quizscore`).
- **Jokes**: Stok dad jokes receh (`d!joke`). Kalo jokes nya kadang ga nyambung, cek System Prompt-nya dan kurangin temperature nya (sekarang 1.0).
**Lokasi file:** `src/commands/fun/joke.js`
- **Soundboard**: Klip suara lokal buat ngeramein voice channel (`d!sb`).

### Utilities (Alat Bantu)
- **Cuaca**: Cek info cuaca real-time (`d!weather`).
- **Google Search**: Tanya mbah Google tapi ditambah AI (`d!google`).
- **Reminders**: Pasang alarm biar ga lupa daratan (`d!remind`).
- **Info Server/User**: Kepoin statistik (`d!si`, `d!ui`).

## Struktur Project

Sekarang kodingannya udah rapih, dipisah-pisah biar enak dibaca:

```bash
src/
├── commands/       # Tempat nyimpen command (dibagi jadi folder ai, fun, music, utility)
├── events/         # Event handler (buat ready, messageCreate, dll)
├── handlers/       # Loader otomatis buat commands & events
├── utils/          # Manager buat API, Voice, State, UI (otaknya di sini)
└── data/           # Buat nyimpen state sementara & constants
```

## Requirements
- Node.js >= 18
- Discord.js v14
- Akun Discord Developer

## Cara Pakenya

1. **Clone repo ini**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Bikin file `.env`**:
   Isi token-token rahasia kalian di sini:
   ```env
   TOKEN=token_discord_kalian (kalo gatau dapet dimana, cari discord dev portal dan buat bot disitu)
   GROQ_API_KEY=key_groq_kalian
   GROQ_API_KEY_BACKUP=key_groq_backup_kalian (gw punya backup 3)
   GEMINI_API_KEY=key (buat vision)
   WEATHER_API_KEY=key (buat cuaca)
   GOOGLE_CSE_KEY=key (buat google search)
   GOOGLE_CSE_CX=key (buat google search)
   SPOTIFY_CLIENT_ID=key (buat music player)
   SPOTIFY_CLIENT_SECRET=key (buat music player)
   ```
4. **Jalanin bot-nya**:
   ```bash
   npm start
   # atau
   npm run dev # buat pake nodemon/dev mode
   ```
   Disarankan PC/Laptop nyala 24/7 kalo gamau bot mati pas device sleep, atau pake termux. Dan pake pm2 biar bot-nya gak mati kalo ada error (yang sekarang juga udah auto restart dari /start-bot.js sih)

## Lisensi
Project Pribadi / Just for fun. Bebas dipelajari atau dimodif sesuka hati.
