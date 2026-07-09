const gtts = require("node-gtts")("en");
const fs = require("fs");
const path = require("path");
const G = require("./game-core.js");

const TTS_DIR = path.join(__dirname, "tts");

// All phrases to generate
const phrases = {};

// Ball names
for (const key of Object.keys(G.BALL_TYPES)) {
  phrases[key] = G.BALL_TYPES[key].name;
}

// Extra words
phrases["versus"] = "versus";
phrases["wins"] = "wins";

// Ensure tts/ directory exists
if (!fs.existsSync(TTS_DIR)) {
  fs.mkdirSync(TTS_DIR);
}

// Generate all phrases sequentially
async function generateAll() {
  const keys = Object.keys(phrases);
  let generated = 0;
  let skipped = 0;

  for (const key of keys) {
    const filePath = path.join(TTS_DIR, key + ".mp3");

    if (fs.existsSync(filePath)) {
      skipped++;
      continue;
    }

    const text = phrases[key];
    await new Promise(function (resolve, reject) {
      gtts.save(filePath, text, function (err) {
        if (err) {
          console.error("  FAILED: " + key + " — " + err.message);
          reject(err);
        } else {
          console.log("  Generated: " + key + ".mp3 (" + text + ")");
          generated++;
          resolve();
        }
      });
    });
  }

  console.log(
    "\nDone! Generated: " +
      generated +
      ", skipped (cached): " +
      skipped +
      ", total: " +
      keys.length
  );
  console.log("Output directory: " + TTS_DIR);
}

console.log("Generating TTS phrases...\n");
generateAll().catch(function (err) {
  console.error("Failed:", err);
  process.exit(1);
});
