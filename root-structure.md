Bot-Ditos
├── Log
│   ├── _TEMP
│   ├── Bot Ditos (kalo di Tia nama folder nya otomatis Bot Tia)
├── node_modules
├── sounds (local soundboard)
├── src
│   ├── commands
│   │   ├── admin
│   │   │   ├── autochat.js (bot otomatis bales chat member)
│   │   │   ├── testkey.js (ngeliat key yang available)
│   │   ├── ai
│   │   │   ├── chat.js (chat dengan bot pake llm)
│   │   │   ├── code.js (dibantu coding sama bot)
│   │   │   ├── eli5 (explain like i'm 5)
│   │   │   ├── forg.js (hapus saved memory)
│   │   │   ├── gen.js (generate image, tapi lagi dimatiin karna boros token)
│   │   │   ├── rec.js (recall/liat saved memory)
│   │   │   └── rem.js (remember/saved memory)
│   │   ├── fun
│   │   │   ├── joke.js (bot lempar jokes bapak-bapak)
│   │   │   ├── poll.js (poll/vote)
│   │   │   ├── quizleaderboard.js (cek leaderboard quiz)
│   │   │   ├── quizscore.js (cek skor pribadi di minigame quiz/trivia)
│   │   │   ├── roll.js (roll a dice)
│   │   │   ├── soundboard.js (play soundboard)
│   │   │   └── trivia.js (minigame trivia)
│   │   ├── music
│   │   │   ├── join.js (join voice)
│   │   │   ├── leave.js (leave voice)
│   │   │   ├── play.js (play musik)
│   │   │   ├── queue.js (cek queue)
│   │   │   ├── skip.js (skip musik)
│   │   │   └── stop.js (stop musik)
│   │   └── utility
│   │   │   ├── choice.js (choice command)
│   │   │   ├── clear.js (clear history obrolan sama bot)
│   │   │   ├── google.js (google search)
│   │   │   ├── groqstatus.js (cek koneksi local LLM)
│   │   │   ├── help.js (list command)
│   │   │   ├── ocr.js (OCR image)
│   │   │   ├── ping.js (cek ping bot)
│   │   │   ├── remind.js (reminder)
│   │   │   ├── serverinfo.js (cek info server)
│   │   │   ├── stats.js (cek stats dan uptime bot)
│   │   │   ├── userinfo.js (cek info user)
│   │   │   └── weather.js (cek cuaca pake weatherAPI)
│   ├── data
│   │   ├── constants.js (constants)
│   │   ├── state.js (state)
│   ├── events
│   │   ├── guildMemberAdd.js (notif user join server)
│   │   ├── guildMemberRemove.js (notif user keluar server)
│   │   ├── interactionCreate.js (interaction create)
│   │   ├── messageCreate.js (message create)
│   │   └── ready.js (ready)
│   ├── handlers
│   │   ├── commandHandler.js (command handler)
│   │   └── eventHandler.js (event handler)
│   ├── utils
│   │   ├── autoChat.js (logic auto chat)
│   │   ├── civitaiManager.js
│   │   ├── geminiManager.js
│   │   ├── groqManager.js (alias kompatibilitas)
│   │   ├── localLLMManager.js (integrasi KoboldCpp)
│   │   ├── llmManager.js (router KoboldCpp dengan fallback Groq)
│   │   ├── promptBuilder.js (persona, token budget, dan metrik prompt)
│   │   ├── helpers.js
│   │   ├── logger.js
│   │   ├── reminderManager.js
│   │   ├── settingsManager.js
│   │   ├── spotifyManager.js
│   │   ├── uiHelpers.js
│   │   └── voiceManager.js
│   ├── config.js (config)
│   └── index.js (index)
├── temp
├── .env
├── .gitignore
├── CHANGELOG.md
├── index.js (yang lama, spaghetti 5.4k lines of code)
├── memory.json
├── nodemon.json
├── package-lock.json
├── package.json
├── README.md
├── reminders.json
├── root-structure.md (file ini)
├── settings.json
├── start-bot.js (autorestart bot)
└── trivia-score.json
