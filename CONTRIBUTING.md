# Contributing to Bot Ditos

Bot ini adalah project pribadi yang self-hosted, jadi contribution dalam bentuk PR mungkin jarang terjadi — tapi kalau ada yang mau contribute, welcome.

---

## Setup Lokal

```bash
git clone https://github.com/caya8205-2/bot-ditos.git
cd bot-ditos
npm install
cp env.example .env   # isi token-token yang dibutuhkan
npm run dev           # development mode dengan nodemon
```

Untuk fitur AI, jalankan **KoboldCpp** di `http://127.0.0.1:5001` atau isi `9ROUTER_BASE_URL` / `GROQ_API_KEY` sebagai fallback.

---

## Struktur yang Perlu Dipahami

| Path | Fungsi |
|---|---|
| `src/commands/` | Satu file per command, auto-loaded oleh handler |
| `src/events/` | Event handlers (clientReady, messageCreate, dll) |
| `src/utils/` | Core logic — musik, AI, DB, voice, UI |
| `src/utils/db.js` | SQLite singleton — semua persistence lewat sini |
| `src/utils/promptBuilder.js` | System prompt & persona — ubah di sini untuk ganti personality |
| `src/data/state.js` | In-memory runtime state (queue musik, channel history, dll) |

---

## Cara Tambah Command Baru

1. Buat file di `src/commands/<kategori>/namaCommand.js`
2. Export objek dengan struktur:
   ```js
   module.exports = {
       name: 'namacommand',
       aliases: ['alias1'],         // opsional
       description: 'Deskripsi',
       async execute(message, args, client) {
           // logic di sini
       }
   };
   ```
3. Command auto-ter-load saat bot start — tidak perlu register manual.

---

## Hal yang Perlu Diperhatikan

- **Database**: Semua persistence pakai SQLite (`data/bot.db`). Jangan buat file JSON baru untuk nyimpen data — tambahkan tabel baru ke `src/utils/db.js`
- **Music**: Primary resolver adalah `youtubei.js`. Kalau mau ubah logic search/scoring, lihat `src/utils/youtubeResolver.js` dan `src/utils/youtubeMatcher.js`
- **LLM**: Stack fallback diatur di `src/utils/llmManager.js`. Jangan hardcode provider spesifik di command

---

## Pull Request

Kalau ada yang mau PR:
- Satu PR = satu perubahan yang jelas scope-nya
- Tulis di deskripsi PR: apa yang diubah dan kenapa
- Tidak ada format commit message yang ketat, tapi usahakan deskriptif
