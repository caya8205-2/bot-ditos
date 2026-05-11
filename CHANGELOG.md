# 📜 Changelog — Bot Ditos

## [Unreleased]

## [2025-12-01] Major Feature Update
### ✨ Added
- **Google Search (`d!g`, `d!google`)**
  - Mencari 3 hasil teratas dengan AI summarization.
- **Trivia / Quiz System (`d!trivia`, `d!quiz`)**
  - Random kategori dengan pertanyaan dinamis.
  - Fuzzy answer matching.
  - Hint otomatis (15s) dan timeout (30s).
  - Auto-clean timers & explanation support.
- **Poll / Vote System (`d!poll`, `d!vote`)**
  - Buat vote cepat di channel.
- **Persistent Reminders (`d!remind`, `d!remi`)**
  - Reminder tetap aktif meskipun bot restart.
  - Auto-scheduler on startup.
  - Mendukung list, cancel, dan berbagai format waktu.
- **Dice Roll (`d!roll`, `d!dice`)**
  - Random number generator sederhana.
- **Queue System Enhancements (`d!queue`, `d!q`)**
  - Perbaikan tampilan antrian musik.

### 🔧 Improved
- **Chat context processing**
  - Perbaikan memory user, global memory, dan chat history handling.
- **Memory system**
  - Fix bug “amnesia” akibat konflik synchronous vs asynchronous FS.
  - Penggunaan `fsp` (fs.promises) yang lebih konsisten.
- **Command Help List**
  - Penjelasan lengkap untuk semua command.

### 🐛 Fixed
- Reminder tidak berjalan setelah restart.
- Trivia auto-timeout yang “nembak” terlalu cepat atau terlalu lambat.
- Bot tidak membaca memory.json meskipun file masih ada.
- Prefix detection untuk trivia answer checker.
- Crash: `ReferenceError: require is not defined in ES module scope` akibat penempatan await yang keliru.
- Beberapa bug kecil pada prefix dan parsing input.

### 🧹 Internal Cleanup
- `.gitignore` diperbarui:
  - `.env`
  - `memory.json`
  - `reminders.json`
- Struktur fs dirapikan agar load/save lebih aman.

---

## [2025-11] Initial Release
- Base LLM chat (`d!chat`)
- YouTube player (join/leave/play/skip/stop)
- Soundboard (acumalaka, ahlele, tengkorak rawr, ahaha)
- User Info / Server Info
- Weather (`d!w`)
- Stats (`d!stats`)
- Misc commands (pilih, joke, clear, rem/rec/forg)

