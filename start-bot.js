const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const venvPython = path.join(__dirname, ".venv-bg-removal", "Scripts", "python.exe");
const python = process.env.BIREFNET_PYTHON || (fs.existsSync(venvPython) ? venvPython : "python");
const bgService = spawn(python, [path.join(__dirname, "tools", "birefnet_service.py")], {
  cwd: __dirname,
  stdio: "inherit",
});

bgService.on("error", (error) => {
  console.error(`[BiRefNet] Gagal menjalankan Python (${python}): ${error.message}`);
});

bgService.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(`[BiRefNet] Service berhenti (code=${code}, signal=${signal}). Bot tetap berjalan, tetapi command d!removebg tidak tersedia.`);
  }
});

let shuttingDown = false;
let botProcess;

function shutdown() {
  shuttingDown = true;
  if (botProcess && !botProcess.killed) botProcess.kill();
  if (!bgService.killed) bgService.kill();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function start() {
  if (shuttingDown) return;
  console.log("Starting Bot...");

  botProcess = spawn("node", ["src/index.js"], {
    stdio: "inherit",
    cwd: __dirname,
  });

  botProcess.on("close", (code) => {
    if (shuttingDown) return;
    console.log(`Ditos exited with code ${code}. Restarting in 2 seconds...`);
    setTimeout(start, 2000);
  });
}

start();
