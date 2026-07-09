const { createCanvas } = require("@napi-rs/canvas");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const G = require("./game-core.js");

const TTS_DIR = path.join(__dirname, "tts");
function ttsPath(key) { return path.join(TTS_DIR, key + ".mp3"); }
function hasTTS(key) { return fs.existsSync(ttsPath(key)); }

function mergeAudioChallenge(tempVideoPath, outputPath, ballKey, won, outroStart) {
  const audioClips = [];
  // Intro: "<ball name>" at 0.5s, "challenge" at ~1.5s
  if (hasTTS(ballKey)) audioClips.push({ file: ttsPath(ballKey), time: 0.5 });
  if (hasTTS("challenge")) audioClips.push({ file: ttsPath("challenge"), time: 1.5 });
  // Outro: "<ball name>" + "wins" OR "timeout"
  if (hasTTS(ballKey)) audioClips.push({ file: ttsPath(ballKey), time: outroStart + 0.3 });
  const endPhrase = won ? "wins" : "timeout";
  if (hasTTS(endPhrase)) audioClips.push({ file: ttsPath(endPhrase), time: outroStart + 1.2 });

  if (audioClips.length === 0) {
    fs.renameSync(tempVideoPath, outputPath);
    return;
  }

  const inputs = ["-i", tempVideoPath];
  const filterParts = [];
  for (let i = 0; i < audioClips.length; i++) {
    inputs.push("-i", audioClips[i].file);
    const delayMs = Math.round(audioClips[i].time * 1000);
    filterParts.push("[" + (i + 1) + ":a]volume=3.0,adelay=" + delayMs + "|" + delayMs + "[a" + i + "]");
  }
  const mixInputs = audioClips.map(function(_, i) { return "[a" + i + "]"; });
  const filterComplex =
    filterParts.join(";") + ";" +
    mixInputs.join("") + "amix=inputs=" + audioClips.length + ":dropout_transition=0:normalize=0[aout]";

  const args = inputs.concat([
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-y",
    outputPath,
  ]);

  console.log("\nMerging audio (" + audioClips.length + " clips)...");
  const mergeResult = require("child_process").spawnSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  const mergeErr = mergeResult.stderr ? mergeResult.stderr.toString("utf8") : "";
  if (mergeResult.status !== 0) {
    throw new Error("ffmpeg audio merge failed (code " + mergeResult.status + "): " + mergeErr.slice(-500));
  }
  fs.unlinkSync(tempVideoPath);
  console.log("Audio merged → " + outputPath);
}

// ══════════════════════════════════════
//  VIDEO SETTINGS
// ══════════════════════════════════════
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 60;
const DT = 1 / FPS;

const INTRO_DURATION = 3.5;
const PAUSE_BEFORE_RESULT = 1.5;
const OUTRO_DURATION = 5.0;
const CHALLENGE_DURATION = 60;

const FIELD_MARGIN_LEFT = 140;
const FIELD_MARGIN_RIGHT = 200;
const FIELD_MARGIN_TOP = 440;
const FIELD_MARGIN_BOTTOM = 260;
const FIELD_W = WIDTH - FIELD_MARGIN_LEFT - FIELD_MARGIN_RIGHT;
const FIELD_H = HEIGHT - FIELD_MARGIN_TOP - FIELD_MARGIN_BOTTOM;
const FIELD_X = FIELD_MARGIN_LEFT;
const FIELD_Y = FIELD_MARGIN_TOP;

// Simulation coords
const SIM_W = 220;
const SIM_H = 380;

const BALL_RADIUS = Math.min(SIM_W, SIM_H) * 0.13;
const BALL_HP = 1000;
const DEFAULT_BALL_SIZE_PERCENT = 100;
const DEFAULT_VIDEO_SPEED_MULT = 1.2;
const MIN_BALL_SIZE_PERCENT = 50;
const MAX_BALL_SIZE_PERCENT = 300;
const MIN_VIDEO_SPEED_MULT = 0.25;
const MAX_VIDEO_SPEED_MULT = 8;

// Barrier config
const BARRIER_HPS = [100, 1000, 10000, 1000000];
const BARRIER_THICKNESS = 20; // sim units
const BARRIER_HIT_COOLDOWN = 0.3; // seconds between barrier hits

const BG_COLOR = "#f5edd6";
const FIELD_BG = "#faf6eb";
const FIELD_BORDER = "#222222";

const BARRIER_COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#7c3aed"]; // green / amber / red / purple
const BARRIER_LABELS = ["Lv.1", "Lv.2", "Lv.3", "BOSS"];

const BALL_ABBREV = {
  addition: "+", multiplication: "x", exponential: "2n", factorial: "n!",
  fibonacci: "Fib", power: "n2", laser: "LAS", speed: "SPD",
  sniper: "SNP", vampire: "VMP", geometric: "x3", prime: "Prm",
  logarithm: "Log", sqrt: "Sq", harmonic: "Hrm", collatz: "Col",
  tetration: "Tet", golden: "Phi", pi: "Pi", random: "Rnd",
  catalan: "Cat", modular: "Mod", triangular: "Tri", cube: "n3",
  shield: "SHD", doubler: "x2", infinity: "Inf",
};

function sanitizeText(s) {
  return s.replace(/×/g, "x").replace(/²/g, "2").replace(/³/g, "3")
    .replace(/√/g, "sqrt").replace(/φ/g, "phi").replace(/π/g, "pi")
    .replace(/∞/g, "Inf");
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(v, d) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function normalizeSizePercent(v, fb) {
  const n = toFiniteNumber(v);
  return roundTo(G.clamp(n === null ? fb : n, MIN_BALL_SIZE_PERCENT, MAX_BALL_SIZE_PERCENT), 2);
}

function normalizeSpeedMult(v, fb) {
  const n = toFiniteNumber(v);
  return roundTo(G.clamp(n === null ? fb : n, MIN_VIDEO_SPEED_MULT, MAX_VIDEO_SPEED_MULT), 2);
}

function normalizeOptions(options) {
  options = options || {};
  return {
    size: normalizeSizePercent(options.size, DEFAULT_BALL_SIZE_PERCENT),
    speed: normalizeSpeedMult(options.speed, DEFAULT_VIDEO_SPEED_MULT),
  };
}

// ══════════════════════════════════════
//  CHALLENGE STATE
// ══════════════════════════════════════
function createChallenge(ball) {
  // First 3 barriers divide field into 4 equal sections
  // Boss (index 3) sits at the very bottom, hidden until all 3 are beaten
  const regularCount = BARRIER_HPS.length - 1; // 3
  const barriers = BARRIER_HPS.map(function(hp, i) {
    const isBoss = i === BARRIER_HPS.length - 1;
    return {
      index: i,
      y: isBoss ? SIM_H - BARRIER_THICKNESS / 2 : SIM_H * (i + 1) / (regularCount + 1),
      hp: hp,
      maxHp: hp,
      broken: false,
      hidden: isBoss,      // boss is invisible until 3 regular barriers are beaten
      lastHitTime: -999,
      totalDamageReceived: 0,
    };
  });

  return {
    ball: ball,
    barriers: barriers,
    time: 0,
    state: "running",   // running | won | lost
    floatingTexts: [],
    particles: [],
    trails: [],
    barriersBeaten: 0,
  };
}

// ══════════════════════════════════════
//  CHALLENGE PHYSICS UPDATE
// ══════════════════════════════════════
function updateChallenge(challenge, dt) {
  if (challenge.state !== "running") return;
  const ball = challenge.ball;
  challenge.time += dt;

  // Time limit
  if (challenge.time >= CHALLENGE_DURATION) {
    challenge.state = "lost";
    return;
  }

  // Move ball
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vx *= G.FRICTION;
  ball.vy *= G.FRICTION;

  // Min speed
  const spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (spd < G.BASE_SPEED * 0.5) {
    const scale = (G.BASE_SPEED * 0.7) / Math.max(spd, 0.01);
    ball.vx *= scale;
    ball.vy *= scale;
  }

  // Wall bounces — left/right always, top always
  // Bottom: only above the lowest unbroken barrier (ball can't go below lowest active barrier)
  if (ball.x - ball.radius < 0) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * G.BOUNCE_DAMP; }
  if (ball.x + ball.radius > SIM_W) { ball.x = SIM_W - ball.radius; ball.vx = -Math.abs(ball.vx) * G.BOUNCE_DAMP; }
  if (ball.y - ball.radius < 0) { ball.y = ball.radius; ball.vy = Math.abs(ball.vy) * G.BOUNCE_DAMP; }

  // Barrier collision — only with lowest unbroken visible barrier
  const activeBarrier = challenge.barriers.find(function(b) { return !b.broken && !b.hidden; });
  if (activeBarrier) {
    const barY = activeBarrier.y;
    const halfT = BARRIER_THICKNESS / 2;

    // Ball bottom hits barrier top
    if (ball.y + ball.radius > barY - halfT && ball.y < barY + halfT) {
      // Push ball back above barrier
      ball.y = barY - halfT - ball.radius;
      ball.vy = -Math.abs(ball.vy) * G.BOUNCE_DAMP;

      // Apply damage on cooldown
      const cd = BARRIER_HIT_COOLDOWN / (ball.speedMult || 1);
      if (challenge.time - activeBarrier.lastHitTime >= cd) {
        activeBarrier.lastHitTime = challenge.time;
        const dmg = ball.calcDamage ? ball.calcDamage() : 1;
        ball.hitCount = (ball.hitCount || 0) + 1;
        activeBarrier.hp -= dmg;
        activeBarrier.totalDamageReceived += dmg;
        ball.totalDamage = (ball.totalDamage || 0) + dmg;

        // Floating text
        challenge.floatingTexts.push({
          x: ball.x + (Math.random() - 0.5) * 20,
          y: barY - 10,
          text: dmg,
          color: ball.color,
          age: 0,
        });
        G.spawnParticles({ particles: challenge.particles }, ball.x, barY, ball.color, 5);
      }

      // Break barrier
      if (activeBarrier.hp <= 0) {
        activeBarrier.hp = 0;
        activeBarrier.broken = true;
        challenge.barriersBeaten++;
        // Big burst of particles
        for (let p = 0; p < 20; p++) {
          G.spawnParticles({ particles: challenge.particles }, SIM_W / 2, barY, BARRIER_COLORS[activeBarrier.index], 1);
        }
        if (challenge.barriersBeaten === BARRIER_HPS.length) {
          challenge.state = "won";
        } else if (challenge.barriersBeaten === BARRIER_HPS.length - 1) {
          // Reveal the boss
          challenge.barriers[BARRIER_HPS.length - 1].hidden = false;
        }
      }
    }

    // Bottom wall = barrier top (ball stays above active barrier)
    if (ball.y + ball.radius > barY - halfT) {
      ball.y = barY - halfT - ball.radius;
    }
  } else {
    // No active visible barrier — bounce off floor
    if (ball.y + ball.radius > SIM_H) { ball.y = SIM_H - ball.radius; ball.vy = -Math.abs(ball.vy) * G.BOUNCE_DAMP; }
  }

  // Floating texts
  for (const ft of challenge.floatingTexts) { ft.age += dt; ft.y -= 40 * dt; }
  challenge.floatingTexts = challenge.floatingTexts.filter(function(ft) { return ft.age < 1.2; });

  // Particles
  for (const p of challenge.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
    p.age += dt;
  }
  challenge.particles = challenge.particles.filter(function(p) { return p.age < p.life; });

  // Trails
  challenge.trails.push({ x: ball.x, y: ball.y, color: ball.color, age: 0 });
  for (const t of challenge.trails) t.age += dt;
  if (challenge.trails.length > 32) challenge.trails = challenge.trails.slice(-32);
  challenge.trails = challenge.trails.filter(function(t) { return t.age < 0.55; });
}

// ══════════════════════════════════════
//  DRAW HELPERS
// ══════════════════════════════════════
function drawHpBar(ctx, current, max, x, y, w, h, color) {
  const frac = G.clamp(current / max, 0, 1);
  ctx.fillStyle = "#d0d0d0";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * frac, h);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.font = "bold " + (h + 2) + "px Arial";
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(G.formatNumber(current) + " / " + G.formatNumber(max), x + w / 2, y + h / 2);
}

// ══════════════════════════════════════
//  INTRO SCENE
// ══════════════════════════════════════
function renderIntroFrame(ctx, ballKey, t) {
  const bt = G.BALL_TYPES[ballKey];
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const titleAlpha = G.clamp(t / 0.5, 0, 1);
  ctx.globalAlpha = titleAlpha;

  ctx.font = "bold 60px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = bt.color;
  ctx.fillText(bt.name, WIDTH / 2, HEIGHT * 0.08);

  ctx.font = "bold 52px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText("VS", WIDTH / 2, HEIGHT * 0.12);

  ctx.font = "bold 56px Arial";
  ctx.fillStyle = "#888";
  ctx.fillText("3 BARRIERS", WIDTH / 2, HEIGHT * 0.16);

  ctx.globalAlpha = 1;

  // Ball sliding in from left
  const progress = G.clamp((t - 0.3) / 1.0, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  const bx = -180 + eased * (WIDTH * 0.3 + 180);
  drawIntroBall(ctx, bt, ballKey, bx, HEIGHT * 0.38, 120);

  // Three barrier blocks sliding in from right
  const beased = G.clamp((t - 0.5) / 1.2, 0, 1);
  const beaseOut = 1 - Math.pow(1 - beased, 3);
  for (let i = 0; i < 3; i++) {
    const bkX = WIDTH + 200 - beaseOut * (WIDTH * 0.3 + 200);
    const bkY = HEIGHT * 0.52 + i * 100;
    const alpha = G.clamp((t - 0.7 - i * 0.15) / 0.4, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = BARRIER_COLORS[i];
    ctx.fillRect(bkX - 140, bkY - 18, 280, 36);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 3;
    ctx.strokeRect(bkX - 140, bkY - 18, 280, 36);
    ctx.font = "bold 28px Arial";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(BARRIER_LABELS[i] + "  " + G.formatNumber(BARRIER_HPS[i]) + " HP", bkX, bkY);
    ctx.globalAlpha = 1;
  }

  // Ball description
  const descAlpha = G.clamp((t - 1.8) / 0.4, 0, 1);
  if (descAlpha > 0) {
    ctx.globalAlpha = descAlpha;
    ctx.font = "28px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = bt.color;
    ctx.fillText(sanitizeText(bt.desc), WIDTH / 2, HEIGHT * 0.88);
    ctx.font = "bold 32px Arial";
    ctx.fillStyle = "#555";
    ctx.fillText("60 seconds to break all 3", WIDTH / 2, HEIGHT * 0.93);
    ctx.globalAlpha = 1;
  }
}

function drawIntroBall(ctx, type, key, x, y, radius) {
  const rgb = G.hexToRgb(type.color);
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = type.color;
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 4;
  ctx.stroke();

  const abbr = BALL_ABBREV[key] || key.charAt(0).toUpperCase();
  ctx.font = "bold " + (radius * 0.6) + "px Arial";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, x, y);

  ctx.font = "bold 44px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText(type.name, x, y + radius + 52);
}

// ══════════════════════════════════════
//  BATTLE SCENE
// ══════════════════════════════════════
function renderChallengeFrame(ctx, challenge, ballKey) {
  const ball = challenge.ball;
  const bt = G.BALL_TYPES[ballKey];

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // ── Top title ──
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const cx = FIELD_X + FIELD_W / 2;

  ctx.font = "bold 44px Arial";
  ctx.fillStyle = bt.color;
  ctx.fillText(bt.name, cx, 90);

  ctx.font = "bold 32px Arial";
  ctx.fillStyle = "#555";
  ctx.fillText("CHALLENGE", cx, 135);

  // ── Timer ──
  const rem = Math.max(0, CHALLENGE_DURATION - challenge.time);
  const timerColor = rem < 10 ? "#e74c3c" : rem < 20 ? "#f39c12" : "#333";
  ctx.font = "bold 52px Arial";
  ctx.fillStyle = timerColor;
  ctx.fillText(rem.toFixed(1) + "s", cx, 195);

  // ── Barrier HP bars (above field) — only visible barriers ──
  const barH = 18;
  const barSpacing = 6;
  const visibleCount = challenge.barriers.filter(function(b) { return !b.hidden; }).length;
  const totalBarH = visibleCount * barH + Math.max(0, visibleCount - 1) * barSpacing;
  let barY = FIELD_Y - totalBarH - 20;

  for (let i = 0; i < challenge.barriers.length; i++) {
    const barrier = challenge.barriers[i];
    if (barrier.hidden) continue;
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "left";
    ctx.fillStyle = barrier.broken ? "#aaa" : BARRIER_COLORS[i];
    ctx.textBaseline = "middle";
    ctx.fillText(BARRIER_LABELS[i], FIELD_X, barY + barH / 2);
    if (barrier.broken) {
      ctx.fillStyle = "#aaa";
      ctx.fillRect(FIELD_X + 48, barY, FIELD_W - 48, barH);
      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = 2;
      ctx.strokeRect(FIELD_X + 48, barY, FIELD_W - 48, barH);
      ctx.font = "bold " + (barH - 2) + "px Arial";
      ctx.fillStyle = "#bbb";
      ctx.textAlign = "center";
      ctx.fillText("BROKEN", FIELD_X + 48 + (FIELD_W - 48) / 2, barY + barH / 2);
    } else {
      drawHpBar(ctx, barrier.hp, barrier.maxHp, FIELD_X + 48, barY, FIELD_W - 48, barH, BARRIER_COLORS[i]);
    }
    barY += barH + barSpacing;
  }

  // ── Field ──
  ctx.save();
  ctx.fillStyle = FIELD_BG;
  ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  ctx.strokeStyle = FIELD_BORDER;
  ctx.lineWidth = 4;
  ctx.strokeRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);

  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  ctx.clip();

  ctx.translate(FIELD_X, FIELD_Y);
  const sx = FIELD_W / SIM_W;
  const sy = FIELD_H / SIM_H;
  ctx.scale(sx, sy);

  renderChallengeContent(ctx, challenge);
  ctx.restore();

  // ── Ball damage total (below field) ──
  ctx.font = "bold 30px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = bt.color;
  ctx.textBaseline = "middle";
  ctx.fillText(bt.name, FIELD_X, FIELD_Y + FIELD_H + 36);
  ctx.textAlign = "right";
  ctx.fillText("Total dmg: " + G.formatNumber(ball.totalDamage || 0), FIELD_X + FIELD_W, FIELD_Y + FIELD_H + 36);
  ctx.textAlign = "center";
  ctx.fillStyle = "#888";
  ctx.font = "bold 26px Arial";
  ctx.fillText("Barriers: " + challenge.barriersBeaten + " / " + challenge.barriers.length, cx, FIELD_Y + FIELD_H + 76);
}

// ══════════════════════════════════════
//  FIELD CONTENT (sim coords)
// ══════════════════════════════════════
function renderChallengeContent(ctx, challenge) {
  const ball = challenge.ball;
  const TRAIL_LIFETIME = 0.55;

  // Trails
  const pts = challenge.trails;
  if (pts.length >= 2) {
    const rgb = G.hexToRgb(ball.color);
    const maxW = ball.radius * 0.7;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length; i++) {
        const t = i / (pts.length - 1);
        const ageFade = G.clamp(1 - pts[i].age / TRAIL_LIFETIME, 0, 1);
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

  // Section divider lines (broken barriers become faint lines; hidden barriers not drawn)
  for (let i = 0; i < challenge.barriers.length; i++) {
    const barrier = challenge.barriers[i];
    if (barrier.hidden) continue;
    const barY = barrier.y;
    const halfT = BARRIER_THICKNESS / 2;

    if (barrier.broken) {
      // Faint broken line
      ctx.beginPath();
      ctx.moveTo(0, barY);
      ctx.lineTo(SIM_W, barY);
      ctx.strokeStyle = "rgba(150,150,150,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Solid barrier with HP-colored fill
      const hpFrac = G.clamp(barrier.hp / barrier.maxHp, 0, 1);
      const color = BARRIER_COLORS[i];
      const rgb = G.hexToRgb(color);

      // Background track
      ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.15)";
      ctx.fillRect(0, barY - halfT, SIM_W, BARRIER_THICKNESS);

      // HP fill (left to right)
      ctx.fillStyle = color;
      ctx.fillRect(0, barY - halfT, SIM_W * hpFrac, BARRIER_THICKNESS);

      // Border
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, barY - halfT, SIM_W, BARRIER_THICKNESS);

      // Label inside barrier
      ctx.font = "bold " + (BARRIER_THICKNESS * 0.85) + "px Arial";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(BARRIER_LABELS[i] + " " + G.formatNumber(barrier.hp), SIM_W / 2, barY);
    }
  }

  // Particles
  for (const p of challenge.particles) {
    const alpha = G.clamp(1 - p.age / p.life, 0, 1);
    const rgb = G.hexToRgb(p.color);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
    ctx.fill();
  }

  // Ball
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = ball.color;
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.stroke();

  const abbr = BALL_ABBREV[ball.type] || ball.type.charAt(0).toUpperCase();
  ctx.font = "bold " + (ball.radius * 0.55) + "px Arial";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, ball.x, ball.y);

  // Floating texts
  for (const ft of challenge.floatingTexts) {
    const alpha = G.clamp(1 - ft.age / 1.2, 0, 1);
    const scale = 1 + ft.age * 0.4;
    ctx.save();
    ctx.translate(ft.x, ft.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 14px Arial";
    ctx.fillStyle = ft.color;
    ctx.textAlign = "center";
    ctx.fillText(G.formatNumber(ft.text), 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// ══════════════════════════════════════
//  OUTRO SCENE
// ══════════════════════════════════════
function renderOutroFrame(ctx, challenge, ballKey, t) {
  const won = challenge.state === "won";
  const bt = G.BALL_TYPES[ballKey];
  const rgb = G.hexToRgb(bt.color);

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Ball — large, bouncing on win
  const bounceT = Math.min(t / 0.5, 1.0);
  const scale = won ? 1 + 0.15 * Math.sin(bounceT * Math.PI) : 1;

  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT * 0.32);
  ctx.scale(scale, scale);

  ctx.beginPath();
  ctx.arc(0, 0, 150, 0, Math.PI * 2);
  ctx.fillStyle = won ? bt.color : "#888";
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 5;
  ctx.stroke();

  const abbr = BALL_ABBREV[ballKey] || "?";
  ctx.font = "bold 90px Arial";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, 0, 0);
  ctx.restore();

  // Result text
  ctx.font = "bold 80px Arial";
  ctx.fillStyle = won ? bt.color : "#e74c3c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(won ? bt.name + " WINS!" : "TIME OUT!", WIDTH / 2, HEIGHT * 0.52);

  // Stats
  const statsAlpha = G.clamp((t - 0.5) / 0.5, 0, 1);
  ctx.globalAlpha = statsAlpha;
  ctx.font = "bold 38px Arial";
  ctx.fillStyle = "#333";

  ctx.fillText("Barriers broken: " + challenge.barriersBeaten + " / " + challenge.barriers.length, WIDTH / 2, HEIGHT * 0.62);
  ctx.fillText("Total damage: " + G.formatNumber(challenge.ball.totalDamage || 0), WIDTH / 2, HEIGHT * 0.68);
  ctx.fillText("Time: " + challenge.time.toFixed(1) + "s", WIDTH / 2, HEIGHT * 0.74);

  if (won) {
    ctx.font = "bold 32px Arial";
    ctx.fillStyle = bt.color;
    ctx.fillText("All " + challenge.barriers.length + " barriers destroyed!", WIDTH / 2, HEIGHT * 0.81);
  } else {
    ctx.font = "bold 32px Arial";
    ctx.fillStyle = "#888";
    ctx.fillText("Only " + challenge.barriersBeaten + " barrier" + (challenge.barriersBeaten === 1 ? "" : "s") + " broken", WIDTH / 2, HEIGHT * 0.81);
  }

  ctx.globalAlpha = 1;
}

// ══════════════════════════════════════
//  MAIN RENDER PIPELINE
// ══════════════════════════════════════
async function renderChallenge(ballKey, outputPath, options) {
  const opts = normalizeOptions(options);

  if (!G.BALL_TYPES[ballKey]) {
    throw new Error("Unknown ball type: " + ballKey);
  }

  console.log("Challenge render: " + G.BALL_TYPES[ballKey].name);
  console.log("Output: " + outputPath);
  console.log("Resolution: " + WIDTH + "x" + HEIGHT + " @ " + FPS + "fps");
  console.log("Size: " + opts.size + "%, Speed: " + opts.speed + "x\n");

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const hasTTSFiles = fs.existsSync(TTS_DIR) && (hasTTS(ballKey) || hasTTS("challenge") || hasTTS("wins") || hasTTS("timeout"));
  if (!hasTTSFiles) {
    console.log("Warning: TTS files not found. Run 'node generate-tts.js' first for voice-over.");
  }
  const tempPath = hasTTSFiles ? outputPath + ".tmp.mp4" : outputPath;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.antialias = "subpixel";
  ctx.patternQuality = "best";
  ctx.quality = "best";

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

  let ffmpegError = "";
  let ffmpegStreamError = null;
  ffmpeg.stderr.on("data", function(c) { ffmpegError += c.toString("utf8"); });
  ffmpeg.stdin.on("error", function(e) { ffmpegStreamError = e; });

  let totalFrames = 0;

  async function writeFrame() {
    if (ffmpegStreamError) throw ffmpegStreamError;
    if (ffmpeg.exitCode !== null && ffmpeg.exitCode !== 0) {
      throw new Error("ffmpeg exited early: " + ffmpegError.trim());
    }
    const raw = canvas.data();
    return new Promise(function(resolve, reject) {
      function cleanup() {
        ffmpeg.stdin.off("drain", onDrain);
        ffmpeg.stdin.off("error", onError);
      }
      function onDrain() { cleanup(); resolve(); }
      function onError(e) { cleanup(); reject(e); }
      const ok = ffmpeg.stdin.write(raw);
      if (ok) resolve();
      else {
        ffmpeg.stdin.on("drain", onDrain);
        ffmpeg.stdin.on("error", onError);
      }
    });
  }

  // ── Phase 1: Intro ──
  const introFrames = Math.round(INTRO_DURATION * FPS);
  console.log("Phase 1: Intro (" + introFrames + " frames)");
  for (let i = 0; i < introFrames; i++) {
    renderIntroFrame(ctx, ballKey, i * DT);
    await writeFrame();
    totalFrames++;
  }

  // ── Phase 2: Challenge ──
  console.log("Phase 2: Challenge (60s max, sim speed " + opts.speed + "x)");

  const ball = G.createBall(ballKey, 0, 0);
  const scale = opts.size / 100;
  ball.radius = BALL_RADIUS * scale;
  ball.maxHp = Math.max(1, Math.round(BALL_HP * scale));
  ball.hp = ball.maxHp;
  ball.totalDamage = 0;
  ball.hitCount = 0;

  // Start ball in top section center, moving down-right
  ball.x = SIM_W / 2;
  ball.y = SIM_H / 8;
  const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.5;
  const spd = G.BASE_SPEED * (0.8 + Math.random() * 0.3);
  ball.vx = Math.cos(angle) * spd;
  ball.vy = Math.sin(angle) * spd;

  const challenge = createChallenge(ball);
  const simDt = DT * opts.speed;
  const maxChallengeFrames = Math.ceil(CHALLENGE_DURATION / simDt) + FPS * 2;

  let challengeFrames = 0;
  while (challenge.state === "running" && challengeFrames < maxChallengeFrames) {
    updateChallenge(challenge, simDt);
    renderChallengeFrame(ctx, challenge, ballKey);
    await writeFrame();
    challengeFrames++;
    totalFrames++;

    if (challengeFrames % (FPS * 10) === 0) {
      console.log("  " + challenge.time.toFixed(0) + "s — barriers: " + challenge.barriersBeaten + "/" + BARRIER_HPS.length +
        " | dmg: " + G.formatNumber(ball.totalDamage || 0));
    }
  }

  const result = challenge.state === "won" ? "WON" : "LOST";
  console.log("  Challenge ended: " + result + " in " + challenge.time.toFixed(1) + "s");

  // ── Phase 2.5: Pause ──
  const pauseFrames = Math.round(PAUSE_BEFORE_RESULT * FPS);
  console.log("Phase 2.5: Pause (" + pauseFrames + " frames)");
  for (let i = 0; i < pauseFrames; i++) {
    renderChallengeFrame(ctx, challenge, ballKey);
    await writeFrame();
    totalFrames++;
  }

  // ── Phase 3: Outro ──
  const outroFrames = Math.round(OUTRO_DURATION * FPS);
  console.log("Phase 3: Outro (" + outroFrames + " frames)");
  for (let i = 0; i < outroFrames; i++) {
    renderOutroFrame(ctx, challenge, ballKey, i * DT);
    await writeFrame();
    totalFrames++;
  }

  ffmpeg.stdin.end();
  await new Promise(function(resolve, reject) {
    ffmpeg.on("close", function(code) {
      if (code === 0) resolve();
      else reject(new Error("ffmpeg exited with code " + code + ": " + ffmpegError.trim()));
    });
  });

  const outroStart = INTRO_DURATION + (totalFrames - Math.round(INTRO_DURATION * FPS) - Math.round(OUTRO_DURATION * FPS)) / FPS + PAUSE_BEFORE_RESULT;
  if (hasTTSFiles) {
    mergeAudioChallenge(tempPath, outputPath, ballKey, result === "WON", outroStart);
  }

  const totalSec = (totalFrames / FPS).toFixed(1);
  console.log("\nDone! " + totalFrames + " frames, " + totalSec + "s → " + outputPath);

  return {
    outputPath: outputPath,
    result: result,
    barriersBeaten: challenge.barriersBeaten,
    durationSeconds: Number(totalSec),
    challengeSeconds: roundTo(challenge.time, 2),
  };
}

// ══════════════════════════════════════
//  CLI
// ══════════════════════════════════════
if (require.main === module) {
  const args = process.argv.slice(2);
  const ballKey = args[0];
  const outputArg = args[1] || ("challenge_" + ballKey + ".mp4");

  const options = {};
  for (let i = 2; i < args.length; i++) {
    if ((args[i] === "--size") && args[i + 1]) { options.size = args[++i]; }
    else if ((args[i] === "--speed") && args[i + 1]) { options.speed = args[++i]; }
  }

  if (!ballKey || !G.BALL_TYPES[ballKey]) {
    console.log("Usage: node render-challenge.js <ball> [output.mp4] [--size 100] [--speed 1.2]");
    console.log("\nAvailable balls:");
    for (const k of Object.keys(G.BALL_TYPES)) {
      console.log("  " + k.padEnd(16) + G.BALL_TYPES[k].name);
    }
    process.exit(ballKey ? 1 : 0);
  }

  renderChallenge(ballKey, outputArg, options).catch(function(err) {
    console.error("Render failed:", err);
    process.exit(1);
  });
}

module.exports = {
  renderChallenge: renderChallenge,
  normalizeOptions: normalizeOptions,
  DEFAULT_BALL_SIZE_PERCENT: DEFAULT_BALL_SIZE_PERCENT,
  DEFAULT_VIDEO_SPEED_MULT: DEFAULT_VIDEO_SPEED_MULT,
  MIN_BALL_SIZE_PERCENT: MIN_BALL_SIZE_PERCENT,
  MAX_BALL_SIZE_PERCENT: MAX_BALL_SIZE_PERCENT,
  MIN_VIDEO_SPEED_MULT: MIN_VIDEO_SPEED_MULT,
  MAX_VIDEO_SPEED_MULT: MAX_VIDEO_SPEED_MULT,
};
