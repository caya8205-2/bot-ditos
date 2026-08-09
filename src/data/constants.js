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
    'chat/c': 'Ngobrol ama Bot Ditos pake model lokal',
    'join': 'Bot join vois',
    'leave': 'Bot keluar dari vois',
    'play/p': 'Setel lagu dari YouTube/Spotify',
    'previous/prev': 'Putar lagu sebelumnya dari riwayat',
    'seek': 'Lompat ke timestamp lagu (contoh: d!seek 02:30)',
    'ff/forward': 'Maju beberapa detik ke depan (contoh: d!ff 30)',
    'rw/rewind': 'Mundur beberapa detik ke belakang (contoh: d!rw 10)',
    'skip': 'Skip lagu yang lagi disetel',
    'stop': 'Berhenti play lagu dan hapus antrian',
    'pilih': 'Bot bakal milih satu dari pilihan yang dikasih',
    'g/google': 'Google search, nanti bot kasih 3 hasil teratas dengan bantuan AI',
    'global': 'tambahin ini di belakang rem, rec, forg buat command memory global',
    'queue/q': 'Liat antrian lagu yang lagi disetel',
    'remind/remi': 'Setel pengingat sederhana (contoh: d!remind 10m minum obat)',
    'poll/vote': 'Buat poll sederhana di channel',
    'roll/dice': 'Roll a Dice',
    'trivia/quiz': 'Random trivia question (jawab lewat reply)',
    'list, cancel': 'List atau batalin reminder yang lagi aktif, tambahin setelah d!remi',
    'localstatus/ls': 'Cek koneksi model lokal KoboldCpp',
    'quizscore/qscore': 'Cek skor minigame trivia',
    'quizleaderboard/qlb': 'Cek leaderboard',
    'code/dev': 'Bantu ngoding',
    'eli5': 'Explain Like I\'m 5',
    'ocr': 'Extract text from image',
    'gen': 'Generate image',
    'llmconfig': 'Lihat konfigurasi model lokal',
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
