const SOUNDBOARD_CLIPS = {
    acumalaka: {
        title: 'Acumalaka',
        file: './sounds/acumalaka.mp3',
    },
    tengkorak: {
        title: 'Tengkorak Rawr',
        file: './sounds/tengkorak-rawr.mp3',
    },
    ahlele: {
        title: 'Ahleleele ahlelas',
        file: './sounds/ahlele.mp3',
    },
    ahaha: {
        title: 'aha aha aha',
        file: './sounds/ninjalaughing.mp3',
    },
};

const COMMAND_LIST = {
    'help': 'Menampilkan semua command',
    'ping': 'Cek latency bot (bukan ping kamu ke Discord)',
    'chat/c': 'Ngobrol ama Bot Ditos pake LLM Groq',
    'join': 'Bot join vois',
    'leave': 'Bot keluar dari vois',
    'halo': 'Bot menyapa balik',
    'play/p': 'Setel lagu dari YouTube',
    'skip': 'Skip lagu yang lagi disetel',
    'stop': 'Berhenti play lagu dan keluar dari vois',
    'sb': 'Putar soundboard (list: acumalaka, ahlele, tengkorak, ahaha)',
    'joke': 'Random dad jokes',
    'ui': 'Info lengkap tentang user',
    'si': 'Info tentang server',
    'clear': 'Clear history chat dengan bot',
    'rem': 'Saved Memory kaya di ChatGPT',
    'rec': 'Ngecek Saved Memory',
    'forg': 'Menghapus Saved Memory, bisa hapus all atau berdasarkan nomor (d!rec buat liat nomornya)',
    'stats': 'Cek status bot dan resource usage',
    'w': 'Cek cuaca di lokasi tertentu',
    'pilih': 'Bot bakal milih satu dari pilihan yang dikasih',
    'g/google': 'Google search, nanti bot kasih 3 hasil teratas dengan bantuan AI',
    'global': 'tambahin ini di belakang rem, rec, forg buat command memory global',
    'queue/q': 'Liat antrian lagu yang lagi disetel',
    'remind/remi': 'Setel pengingat sederhana (contoh: d!remind 10m minum obat)',
    'poll/vote': 'Buat poll sederhana di channel',
    'roll/dice': 'Roll a Dice',
    'trivia/quiz': 'Random trivia question (jawab lewat reply)',
    'list, cancel': 'List atau batalin reminder yang lagi aktif, tambahin setelah d!remi',
    'groqstatus/gs': 'Cek apakah API masih bisa dipake',
    'quizscore/qscore': 'Cek skor minigame trivia',
    'quizleaderboard/qlb': 'Cek leaderboard',
    'code/dev': 'Bantu ngoding',
    'eli5': 'Explain Like I\'m 5',
    'ocr': 'Extract text from image',
    'gen': 'Generate image',
    'testkeys/keystat': 'Cek status semua API Keys',
};

const TOPICS = [
    "liburan",
    "teknologi",
    "game",
    "film",
    "makanan",
    "cuaca",
    "hal random",
];

const MAX_USER_NOTES = 20;
const MAX_GLOBAL_NOTES = 20;
const MAX_CONVERSATION_HISTORY = 15;
const MAX_CHANNEL_HISTORY = 50;
const MAX_CHANNEL_CONTEXT = 10;

module.exports = {
    SOUNDBOARD_CLIPS,
    TOPICS,
    MAX_USER_NOTES,
    MAX_GLOBAL_NOTES,
    MAX_CONVERSATION_HISTORY,
    MAX_CHANNEL_HISTORY,
    MAX_CHANNEL_CONTEXT,
    COMMAND_LIST
};
