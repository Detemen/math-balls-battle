const { createCanvas } = require("@napi-rs/canvas");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const G = require("./game-core.js");

const TTS_DIR = path.join(__dirname, "tts");

// ══════════════════════════════════════
//  VIDEO SETTINGS
// ══════════════════════════════════════
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 60;
const DT = 1 / FPS;

const INTRO_DURATION = 3.5;
const PAUSE_BEFORE_RESULT = 1.5; // freeze last frame before showing winner
const OUTRO_DURATION = 3.0;
const MAX_BATTLE_SECONDS = 60; // TikTok-friendly max length

// Layout: TikTok-safe margins (right for UI, top for status bar, left for balance)
const FIELD_MARGIN_LEFT = 140;   // extra left padding for visual balance
const FIELD_MARGIN_RIGHT = 200;  // dead zone for TikTok UI (likes, comments)
const FIELD_MARGIN_TOP = 380;    // more top space: status bar + title + ball1 info + gap
const FIELD_MARGIN_BOTTOM = 340; // bottom: ball2 info + timer + gap
const FIELD_W = WIDTH - FIELD_MARGIN_LEFT - FIELD_MARGIN_RIGHT;
const FIELD_H = HEIGHT - FIELD_MARGIN_TOP - FIELD_MARGIN_BOTTOM;
const FIELD_X = FIELD_MARGIN_LEFT;
const FIELD_Y = FIELD_MARGIN_TOP;

// Simulation coordinates (small, like browser)
const SIM_W = 220;
const SIM_H = 350;

// Ball config for video — bigger and faster
const BALL_RADIUS = Math.min(SIM_W, SIM_H) * 0.15; // ~52px in sim, 15% bigger
const BALL_HP = 1000;
const DEFAULT_BALL_SIZE_PERCENT = 100;
const MIN_BALL_SIZE_PERCENT = 50;
const MAX_BALL_SIZE_PERCENT = 300;
const DEFAULT_VIDEO_SPEED_MULT = 1.2; // simulate slightly faster
const MIN_VIDEO_SPEED_MULT = 0.25;
const MAX_VIDEO_SPEED_MULT = 8;

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function normalizeSizePercent(value, fallback) {
  const parsed = toFiniteNumber(value);
  const safeValue = parsed === null ? fallback : parsed;
  return roundTo(G.clamp(safeValue, MIN_BALL_SIZE_PERCENT, MAX_BALL_SIZE_PERCENT), 2);
}

function normalizeSpeedMultiplier(value, fallback) {
  const parsed = toFiniteNumber(value);
  const safeValue = parsed === null ? fallback : parsed;
  return roundTo(G.clamp(safeValue, MIN_VIDEO_SPEED_MULT, MAX_VIDEO_SPEED_MULT), 2);
}

function normalizeRenderOptions(options) {
  options = options || {};
  return {
    size1: normalizeSizePercent(options.size1, DEFAULT_BALL_SIZE_PERCENT),
    size2: normalizeSizePercent(options.size2, DEFAULT_BALL_SIZE_PERCENT),
    speed: normalizeSpeedMultiplier(options.speed, DEFAULT_VIDEO_SPEED_MULT),
  };
}

function applyBallVideoSettings(ball, sizePercent) {
  const scale = sizePercent / 100;
  ball.radius = BALL_RADIUS * scale;
  if (ball.isInfinite) return;
  ball.maxHp = Math.max(1, Math.round(BALL_HP * scale));
  ball.hp = ball.maxHp;
}

function buildDefaultOutputName(ball1Key, ball2Key) {
  return "battle_" + ball1Key + "_vs_" + ball2Key + ".mp4";
}

// ══════════════════════════════════════
//  ABBREVIATIONS for balls (node-canvas can't render emoji)
// ══════════════════════════════════════
const BALL_ABBREV = {
  addition: "+", multiplication: "x", exponential: "2n", factorial: "n!",
  fibonacci: "Fib", power: "n2", laser: "LAS", speed: "SPD",
  sniper: "SNP", vampire: "VMP", geometric: "x3", prime: "Prm",
  logarithm: "Log", sqrt: "Sq", harmonic: "Hrm", collatz: "Col",
  tetration: "Tet", golden: "Phi", pi: "Pi", random: "Rnd",
  catalan: "Cat", modular: "Mod", triangular: "Tri", cube: "n3",
  shield: "SHD", doubler: "x2", infinity: "Inf",
};

// ══════════════════════════════════════
//  BACKGROUND — warm beige like the screenshot
// ══════════════════════════════════════
// Sanitize desc text — replace Unicode that @napi-rs/canvas can't render
function sanitizeText(s) {
  return s.replace(/×/g, "x").replace(/²/g, "2").replace(/³/g, "3")
    .replace(/√/g, "sqrt").replace(/φ/g, "phi").replace(/π/g, "pi")
    .replace(/∞/g, "Inf");
}

const BG_COLOR = "#f5edd6";
const FIELD_BG = "#faf6eb";
const FIELD_BORDER = "#222222";

// ══════════════════════════════════════
//  INTRO SCENE
// ══════════════════════════════════════
function renderIntroFrame(ctx, ball1Key, ball2Key, t) {
  const W = WIDTH, H = HEIGHT;
  const b1t = G.BALL_TYPES[ball1Key];
  const b2t = G.BALL_TYPES[ball2Key];

  // Warm background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // Title
  const titleAlpha = G.clamp(t / 0.5, 0, 1);
  ctx.globalAlpha = titleAlpha;

  // Ball 1 name (above center)
  ctx.font = "bold 56px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = b1t.color;
  ctx.fillText(b1t.name, W / 2, H * 0.08);

  // "VS"
  ctx.font = "bold 60px Arial";
  ctx.fillStyle = "#333333";
  ctx.fillText("VS", W / 2, H * 0.12);

  // Ball 2 name (below VS)
  ctx.font = "bold 56px Arial";
  ctx.fillStyle = b2t.color;
  ctx.fillText(b2t.name, W / 2, H * 0.16);

  ctx.globalAlpha = 1;

  // Ease-out cubic for balls appearing
  const progress = G.clamp((t - 0.3) / 1.0, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 3);

  // Ball 1 — large, from left
  const bx1 = -200 + eased * (W * 0.3 + 200);
  drawIntroBallLarge(ctx, b1t, ball1Key, bx1, H * 0.42, 130);

  // Ball 2 — large, from right
  const bx2 = W + 200 - eased * (W * 0.3 + 200);
  drawIntroBallLarge(ctx, b2t, ball2Key, bx2, H * 0.62, 130);

  // Damage descriptions
  const descAlpha = G.clamp((t - 1.5) / 0.5, 0, 1);
  if (descAlpha > 0) {
    ctx.globalAlpha = descAlpha;
    ctx.font = "32px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = b1t.color;
    ctx.fillText(sanitizeText(b1t.desc), W / 2, H * 0.82);
    ctx.fillStyle = b2t.color;
    ctx.fillText("vs", W / 2, H * 0.86);
    ctx.fillText(sanitizeText(b2t.desc), W / 2, H * 0.90);
    ctx.globalAlpha = 1;
  }
}

function drawIntroBallLarge(ctx, type, key, x, y, radius) {
  const rgb = G.hexToRgb(type.color);

  // Shadow / glow
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.12)";
  ctx.fill();

  // Circle body — filled with color
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = type.color;
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Abbreviation
  const abbr = BALL_ABBREV[key] || key.charAt(0).toUpperCase();
  ctx.font = "bold " + (radius * 0.6) + "px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, x, y);

  // Name below
  ctx.font = "bold 48px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText(type.name, x, y + radius + 55);
}


// ══════════════════════════════════════
//  BATTLE SCENE
// ══════════════════════════════════════
function renderBattleFrame(ctx, battle) {
  const W = WIDTH, H = HEIGHT;
  const [b1, b2] = battle.balls;

  // Warm background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // ── TOP: Title — stacked "Name1 VS Name2" ──
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const cx = FIELD_X + FIELD_W / 2;

  ctx.font = "bold 42px Arial";
  ctx.fillStyle = b1.color;
  ctx.fillText(b1.name, cx, 100);

  ctx.font = "bold 34px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText("VS", cx, 145);

  ctx.font = "bold 42px Arial";
  ctx.fillStyle = b2.color;
  ctx.fillText(b2.name, cx, 190);

  // ── Ball 1 info line (above field, with gap) ──
  const info1NameY = FIELD_Y - 90;
  ctx.font = "bold 32px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = b1.color;
  ctx.fillText(b1.name, FIELD_X, info1NameY);
  // Damage
  ctx.textAlign = "right";
  ctx.fillText("Dmg: " + G.formatNumber(b1.totalDamage), FIELD_X + FIELD_W, info1NameY);
  // HP bar — gap between name and bar
  drawHpBar(ctx, b1, FIELD_X, info1NameY + 22, FIELD_W, 24);

  // ── FIELD ──
  ctx.save();
  // Field background
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  // Field border — thick black like in the screenshot
  ctx.strokeStyle = FIELD_BORDER;
  ctx.lineWidth = 4;
  ctx.strokeRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);

  // Clip to field
  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  ctx.clip();

  // Translate + scale from sim coords to field display
  ctx.translate(FIELD_X, FIELD_Y);
  const sx = FIELD_W / SIM_W;
  const sy = FIELD_H / SIM_H;
  ctx.scale(sx, sy);

  // Render game content
  renderBattleContent(ctx, battle);
  ctx.restore();

  // ── Ball 2 info line (below field) ──
  // HP bar first, then name with gap
  const hp2Y = FIELD_Y + FIELD_H + 20;
  drawHpBar(ctx, b2, FIELD_X, hp2Y, FIELD_W, 24);
  const info2NameY = hp2Y + 52;
  ctx.font = "bold 32px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = b2.color;
  ctx.fillText(b2.name, FIELD_X, info2NameY);
  ctx.textAlign = "right";
  ctx.fillText("Dmg: " + G.formatNumber(b2.totalDamage), FIELD_X + FIELD_W, info2NameY);

  // ── Timer (bottom center, small) ──
  ctx.font = "bold 36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#666";
  const timerY = info2NameY + 60;
  if (battle.maxTime > 0) {
    const rem = Math.max(0, battle.maxTime - battle.time);
    ctx.fillText(rem.toFixed(1) + "s", FIELD_X + FIELD_W / 2, timerY);
  } else {
    ctx.fillText(battle.time.toFixed(1) + "s", FIELD_X + FIELD_W / 2, timerY);
  }
}

function drawHpBar(ctx, ball, x, y, w, h) {
  const hpFrac = ball.isInfinite ? 1 : G.clamp(ball.hp / ball.maxHp, 0, 1);
  // Background
  ctx.fillStyle = "#d0d0d0";
  ctx.fillRect(x, y, w, h);
  // Fill
  ctx.fillStyle = ball.isInfinite ? "#9ca3af" : (hpFrac > 0.5 ? "#2ecc71" : hpFrac > 0.2 ? "#f39c12" : "#e74c3c");
  ctx.fillRect(x, y, w * hpFrac, h);
  // Border
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  // HP text centered
  ctx.font = "bold " + (h + 4) + "px Arial";
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(G.formatNumber(ball.hp), x + w / 2, y + h / 2);
}

// ══════════════════════════════════════
//  BATTLE CONTENT (inside simulation coords)
// ══════════════════════════════════════
function renderBattleContent(ctx, battle) {
  // Trails — tapered glow ribbon (matches game-core renderBattle)
  const TRAIL_LIFETIME_V = 0.55;
  for (let bi = 0; bi < battle.balls.length; bi++) {
    const pts = battle.trails.filter(t => t.ballIndex === bi);
    if (pts.length < 2) continue;
    const ball = battle.balls[bi];
    const rgb = G.hexToRgb(pts[0].color);
    const maxW = ball.radius * 0.7;

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length; i++) {
        const t = i / (pts.length - 1);
        const ageFade = G.clamp(1 - pts[i].age / TRAIL_LIFETIME_V, 0, 1);
        const alpha = t * ageFade;
        if (alpha < 0.01) continue;

        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.lineCap = "round";

        if (pass === 0) {
          ctx.lineWidth = maxW * 2.2 * t;
          ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + (alpha * 0.18) + ")";
        } else {
          ctx.lineWidth = maxW * t;
          ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + (alpha * 0.75) + ")";
        }
        ctx.stroke();
      }
    }
  }

  // Laser beams
  for (let i = 0; i < 2; i++) {
    const atk = battle.balls[i], tgt = battle.balls[1 - i];
    if (!atk.isLaser || atk.hp <= 0) continue;
    const rgb = G.hexToRgb(atk.color);
    ctx.beginPath();
    ctx.moveTo(atk.x, atk.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.15)";
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Balls
  for (const ball of battle.balls) {
    if (ball.hp <= 0) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ccc";
      ctx.fill();
      ctx.font = "bold " + (ball.radius * 0.6) + "px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#999";
      ctx.fillText("X", ball.x, ball.y);
      ctx.globalAlpha = 1;
      continue;
    }

    const { x, y, radius, color } = ball;

    // Body — filled with ball color (like the screenshot)
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Abbreviation text inside
    const abbr = BALL_ABBREV[ball.type] || ball.type.charAt(0).toUpperCase();
    ctx.font = "bold " + (radius * 0.55) + "px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(abbr, x, y);

  }

  // Floating damage texts
  for (const ft of battle.floatingTexts) {
    const alpha = G.clamp(1 - ft.age / 1.2, 0, 1);
    const scale = 1 + ft.age * 0.4;
    ctx.save();
    ctx.translate(ft.x, ft.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 16px Arial";
    ctx.fillStyle = ft.color;
    ctx.textAlign = "center";
    ctx.fillText(G.formatNumber(ft.text), 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

}

// ══════════════════════════════════════
//  OUTRO / WINNER SCENE
// ══════════════════════════════════════
function renderOutroFrame(ctx, battle, t) {
  const W = WIDTH, H = HEIGHT;
  const winner = battle.winner;
  const loser = battle.balls.find(function(b) { return b !== winner; });
  const rgb = G.hexToRgb(winner.color);

  // Warm background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // Winner ball — large, bouncing
  const bounceT = Math.min(t / 0.5, 1.0);
  const scale = 1 + 0.15 * Math.sin(bounceT * Math.PI);

  ctx.save();
  ctx.translate(W / 2, H * 0.35);
  ctx.scale(scale, scale);

  // Glow
  ctx.beginPath();
  ctx.arc(0, 0, 200, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.15)";
  ctx.fill();

  // Ball
  ctx.beginPath();
  ctx.arc(0, 0, 140, 0, Math.PI * 2);
  ctx.fillStyle = winner.color;
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 5;
  ctx.stroke();

  const abbr = BALL_ABBREV[winner.type] || "?";
  ctx.font = "bold 90px Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, 0, 0);
  ctx.restore();

  // "WINS!" text
  ctx.font = "bold 80px Arial";
  ctx.fillStyle = winner.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(winner.name + " WINS!", W / 2, H * 0.53);

  // Stats
  const statsAlpha = G.clamp((t - 0.5) / 0.5, 0, 1);
  ctx.globalAlpha = statsAlpha;

  ctx.font = "bold 40px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText("Total damage: " + G.formatNumber(winner.totalDamage), W / 2, H * 0.62);
  ctx.fillText("Hits: " + winner.hitCount, W / 2, H * 0.67);
  ctx.fillText("Time: " + battle.time.toFixed(1) + "s", W / 2, H * 0.72);

  // Loser info
  if (loser) {
    ctx.font = "bold 32px Arial";
    ctx.fillStyle = loser.color;
    ctx.fillText(loser.name + " dealt " + G.formatNumber(loser.totalDamage) + " damage", W / 2, H * 0.82);
  }

  ctx.globalAlpha = 1;
}

// ══════════════════════════════════════
//  MAIN RENDER PIPELINE
// ══════════════════════════════════════
// ══════════════════════════════════════
//  TTS AUDIO MIXING
// ══════════════════════════════════════
function ttsPath(key) {
  return path.join(TTS_DIR, key + ".mp3");
}

function hasTTS(key) {
  return fs.existsSync(ttsPath(key));
}

function mergeAudio(tempVideoPath, outputPath, ball1Key, ball2Key, winnerKey, outroStart) {
  // Audio placement timestamps (in seconds)
  const audioClips = [];

  // Intro: ball1 name → versus → ball2 name
  if (hasTTS(ball1Key)) audioClips.push({ file: ttsPath(ball1Key), time: 0.5 });
  if (hasTTS("versus")) audioClips.push({ file: ttsPath("versus"), time: 1.5 });
  if (hasTTS(ball2Key)) audioClips.push({ file: ttsPath(ball2Key), time: 2.3 });

  // Outro: winner name → wins
  if (hasTTS(winnerKey)) audioClips.push({ file: ttsPath(winnerKey), time: outroStart + 0.3 });
  if (hasTTS("wins")) audioClips.push({ file: ttsPath("wins"), time: outroStart + 1.2 });

  if (audioClips.length === 0) {
    // No audio files, just rename temp
    fs.renameSync(tempVideoPath, outputPath);
    return;
  }

  // Build ffmpeg command with adelay + volume boost per clip, then amix
  const inputs = ["-i", tempVideoPath];
  const filterParts = [];
  const mixInputs = [];

  for (let i = 0; i < audioClips.length; i++) {
    inputs.push("-i", audioClips[i].file);
    const delayMs = Math.round(audioClips[i].time * 1000);
    // Boost volume 3x and delay each clip to its timestamp
    filterParts.push("[" + (i + 1) + "]volume=3.0,adelay=" + delayMs + "|" + delayMs + "[a" + i + "]");
    mixInputs.push("[a" + i + "]");
  }

  // Use amix with dropout_transition=0 so clips don't fade, normalize=0 to keep volume
  const filterComplex = filterParts.join(";") + ";" +
    mixInputs.join("") + "amix=inputs=" + audioClips.length + ":dropout_transition=0:normalize=0[aout]";

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    outputPath,
  ];

  console.log("\nMerging audio (" + audioClips.length + " clips)...");
  try {
    var mergeResult = require("child_process").spawnSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    if (mergeResult.status !== 0) {
      var mergeErr = (mergeResult.stderr || Buffer.alloc(0)).toString("utf8").trim();
      throw new Error("ffmpeg audio merge failed (code " + mergeResult.status + "): " + mergeErr);
    }
  } finally {
    // Clean up temp file regardless of success/failure
    if (fs.existsSync(tempVideoPath)) {
      fs.unlinkSync(tempVideoPath);
    }
  }
}

async function renderVideo(ball1Key, ball2Key, outputPath, options) {
  const renderOptions = normalizeRenderOptions(options);
  console.log("Rendering: " + G.BALL_TYPES[ball1Key].name + " vs " + G.BALL_TYPES[ball2Key].name);
  console.log("Output: " + outputPath);
  console.log("Resolution: " + WIDTH + "x" + HEIGHT + " @ " + FPS + "fps");
  console.log(
    "Sim arena: " + SIM_W + "x" + SIM_H +
    ", base radius: " + BALL_RADIUS.toFixed(0) +
    ", sizes: " + renderOptions.size1 + "% vs " + renderOptions.size2 + "%"
  );
  console.log("Speed multiplier: " + renderOptions.speed + "x");
  console.log("");

  // Check TTS files
  const hasTTSFiles = fs.existsSync(TTS_DIR) &&
    (hasTTS(ball1Key) || hasTTS(ball2Key) || hasTTS("versus") || hasTTS("wins"));
  if (!hasTTSFiles) {
    console.log("Warning: TTS files not found. Run 'node generate-tts.js' first for voice-over.");
    console.log("Rendering without audio...\n");
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  const tempPath = hasTTSFiles ? outputPath + ".tmp.mp4" : outputPath;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.antialias = "subpixel";
  ctx.patternQuality = "best";
  ctx.quality = "best";

  // Spawn ffmpeg
  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-f", "rawvideo",
    "-vcodec", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", WIDTH + "x" + HEIGHT,
    "-r", String(FPS),
    "-i", "-",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "10",
    "-b:v", "15M",
    "-maxrate", "20M",
    "-bufsize", "30M",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    tempPath,
  ]);

  let ffmpegErrorOutput = "";
  let ffmpegStreamError = null;
  ffmpeg.stderr.on("data", function(chunk) {
    ffmpegErrorOutput += chunk.toString("utf8");
  });
  ffmpeg.stdin.on("error", function(err) {
    ffmpegStreamError = err;
  });

  let totalFrames = 0;

  async function writeFrame() {
    if (ffmpegStreamError) throw ffmpegStreamError;
    if (ffmpeg.exitCode !== null && ffmpeg.exitCode !== 0) {
      throw new Error("ffmpeg exited early: " + ffmpegErrorOutput.trim());
    }
    const rawBuf = canvas.data();
    return new Promise(function(resolve, reject) {
      function cleanup() {
        ffmpeg.stdin.off("drain", onDrain);
        ffmpeg.stdin.off("error", onError);
      }
      function onDrain() {
        cleanup();
        resolve();
      }
      function onError(err) {
        cleanup();
        reject(err);
      }
      const ok = ffmpeg.stdin.write(rawBuf);
      if (ok) resolve();
      else {
        ffmpeg.stdin.on("drain", onDrain);
        ffmpeg.stdin.on("error", onError);
      }
    });
  }

  // ── Phase 1: Intro ──
  const introFrames = Math.round(INTRO_DURATION * FPS);
  console.log("Phase 1: Intro (" + introFrames + " frames, " + INTRO_DURATION + "s)");
  for (let i = 0; i < introFrames; i++) {
    renderIntroFrame(ctx, ball1Key, ball2Key, i * DT);
    await writeFrame();
    totalFrames++;
  }

  // ── Phase 2: Battle ──
  console.log("Phase 2: Battle (simulating at " + renderOptions.speed + "x speed...)");
  const b1 = G.createBall(ball1Key, 0, 0);
  const b2 = G.createBall(ball2Key, 0, 0);
  applyBallVideoSettings(b1, renderOptions.size1);
  applyBallVideoSettings(b2, renderOptions.size2);

  G.initBallPhysics(b1, SIM_W, SIM_H, 0);
  G.initBallPhysics(b2, SIM_W, SIM_H, 1);
  const battle = G.createBattle(b1, b2);

  let battleFrames = 0;
  const maxBattleFrames = MAX_BATTLE_SECONDS * FPS;
  const simDt = DT * renderOptions.speed;

  while (battle.state === "running" && battleFrames < maxBattleFrames) {
    G.updatePhysics(battle.balls, SIM_W, SIM_H, simDt);
    G.updateBattle(battle, simDt);
    G.updateFloatingTexts(battle, simDt);
    G.updateParticles(battle, simDt);
    G.updateTrails(battle);

    renderBattleFrame(ctx, battle);
    await writeFrame();
    battleFrames++;
    totalFrames++;

    if (battleFrames % (FPS * 5) === 0) {
      console.log("  " + (battleFrames / FPS).toFixed(0) + "s — HP: " +
        G.formatNumber(b1.hp) + " vs " + G.formatNumber(b2.hp) +
        " | Dmg: " + G.formatNumber(b1.totalDamage) + " vs " + G.formatNumber(b2.totalDamage));
    }
  }
  // If no winner (timeout), pick by total damage
  if (!battle.winner) {
    battle.winner = b1.totalDamage >= b2.totalDamage ? b1 : b2;
    battle.state = "finished";
  }
  const winnerKey = battle.winner.type;
  console.log("  Battle ended: " + (battleFrames / FPS).toFixed(1) + "s (sim time: " +
    battle.time.toFixed(1) + "s), winner: " + battle.winner.name);
  console.log("WINNER_KEY:" + winnerKey);

  // ── Phase 2.5: Pause — freeze last battle frame ──
  const pauseFrames = Math.round(PAUSE_BEFORE_RESULT * FPS);
  console.log("Phase 2.5: Pause (" + pauseFrames + " frames, " + PAUSE_BEFORE_RESULT + "s)");
  for (let i = 0; i < pauseFrames; i++) {
    // Re-render the last battle frame (frozen)
    renderBattleFrame(ctx, battle);
    await writeFrame();
    totalFrames++;
  }

  // ── Phase 3: Outro ──
  const outroFrames = Math.round(OUTRO_DURATION * FPS);
  console.log("Phase 3: Outro (" + outroFrames + " frames, " + OUTRO_DURATION + "s)");
  for (let i = 0; i < outroFrames; i++) {
    renderOutroFrame(ctx, battle, i * DT);
    await writeFrame();
    totalFrames++;
  }

  // Close ffmpeg
  ffmpeg.stdin.end();
  await new Promise(function(resolve, reject) {
    ffmpeg.on("close", function(code) {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg exited with code " + code + ": " + ffmpegErrorOutput.trim()));
    });
  });

  const totalSeconds = (totalFrames / FPS).toFixed(1);
  console.log("");
  console.log("Video rendered: " + totalFrames + " frames, " + totalSeconds + "s");

  // ── Merge TTS audio ──
  if (hasTTSFiles) {
    const outroStart = INTRO_DURATION + battleFrames / FPS + PAUSE_BEFORE_RESULT;
    mergeAudio(tempPath, outputPath, ball1Key, ball2Key, winnerKey, outroStart);
    console.log("Audio merged successfully!");
  }

  console.log("Done! Output: " + outputPath);
  return {
    outputPath: outputPath,
    winner: winnerKey,
    options: renderOptions,
    durationSeconds: Number(totalSeconds),
    battleSeconds: roundTo(battle.time, 2),
  };
}

// ══════════════════════════════════════
//  CLI
// ══════════════════════════════════════
function parseCliArgs(argv) {
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--size1" || arg === "--size2" || arg === "--speed") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("Missing value for " + arg);
      }
      options[arg.slice(2)] = value;
      i++;
      continue;
    }
    positional.push(arg);
  }

  return {
    help: false,
    ball1: positional[0],
    ball2: positional[1],
    output: positional[2],
    options: normalizeRenderOptions(options),
  };
}

function printHelp() {
  console.log("Usage: node render-video.js <ball1> <ball2> [output.mp4]");
  console.log("       node render-video.js <ball1> <ball2> [output.mp4] --size1 120 --size2 80 --speed 1.5");
  console.log("");
  console.log("Options:");
  console.log("  --size1 <50-300>   Size/HP percent for ball 1");
  console.log("  --size2 <50-300>   Size/HP percent for ball 2");
  console.log("  --speed <0.25-8>   Simulation speed multiplier");
  console.log("");
  console.log("Available balls:");
  const keys = Object.keys(G.BALL_TYPES);
  for (const k of keys) {
    console.log("  " + k.padEnd(16) + " " + G.BALL_TYPES[k].name + " — " + G.BALL_TYPES[k].desc);
  }
}

if (require.main === module) {
  let parsedArgs;
  try {
    parsedArgs = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error("Invalid arguments:", err.message);
    process.exit(1);
  }

  if (parsedArgs.help || !parsedArgs.ball1 || !parsedArgs.ball2) {
    printHelp();
    process.exit(parsedArgs.help ? 0 : 1);
  }

  const ball1 = parsedArgs.ball1;
  const ball2 = parsedArgs.ball2;
  const output = parsedArgs.output || buildDefaultOutputName(ball1, ball2);

  if (!G.BALL_TYPES[ball1]) {
    console.error("Unknown ball type: " + ball1);
    console.error("Run with --help to see available types");
    process.exit(1);
  }
  if (!G.BALL_TYPES[ball2]) {
    console.error("Unknown ball type: " + ball2);
    console.error("Run with --help to see available types");
    process.exit(1);
  }

  renderVideo(ball1, ball2, output, parsedArgs.options).catch(function(err) {
    console.error("Render failed:", err);
    process.exit(1);
  });
}

module.exports = {
  renderVideo: renderVideo,
  normalizeRenderOptions: normalizeRenderOptions,
  buildDefaultOutputName: buildDefaultOutputName,
  parseCliArgs: parseCliArgs,
  DEFAULT_BALL_SIZE_PERCENT: DEFAULT_BALL_SIZE_PERCENT,
  DEFAULT_VIDEO_SPEED_MULT: DEFAULT_VIDEO_SPEED_MULT,
  MIN_BALL_SIZE_PERCENT: MIN_BALL_SIZE_PERCENT,
  MAX_BALL_SIZE_PERCENT: MAX_BALL_SIZE_PERCENT,
  MIN_VIDEO_SPEED_MULT: MIN_VIDEO_SPEED_MULT,
  MAX_VIDEO_SPEED_MULT: MAX_VIDEO_SPEED_MULT,
};
