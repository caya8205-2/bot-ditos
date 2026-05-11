const { spawn } = require("child_process");

function start() {
  console.log("Starting Bot...");

  const child = spawn("node", ["src/index.js"], {
    stdio: "inherit",
  });

  child.on("close", (code) => {
    console.log(`Ditos exited with code ${code}. Restarting in 2 seconds...`);
    setTimeout(start, 2000);
  });
}

start();