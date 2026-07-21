(function() {
"use strict";

const {
  formatNumber, clamp, BALL_TYPES, createBall,
  initBallPhysics, updatePhysics, updateBattle,
  updateFloatingTexts, updateParticles, updateTrails,
  renderBattle, createBattle, BASE_SPEED,
} = window.GameCore;

// ══════════════════════════════════════
//  MAIN — UI + GAME LOOP
// ══════════════════════════════════════
const setupScreen = document.getElementById("setupScreen");
const battleScreen = document.getElementById("battleScreen");
const tourneyScreen = document.getElementById("tourneyScreen");
const picker1 = document.getElementById("picker1");
const picker2 = document.getElementById("picker2");
const selected1 = document.getElementById("selected1");
const selected2 = document.getElementById("selected2");
const startBtn = document.getElementById("startBtn");
const backBtn = document.getElementById("backBtn");
const canvas = document.getElementById("arenaCanvas");
const ctx = canvas.getContext("2d");
const sizeRange1 = document.getElementById("sizeRange1");
const sizeRange2 = document.getElementById("sizeRange2");
const sizeVal1 = document.getElementById("sizeVal1");
const sizeVal2 = document.getElementById("sizeVal2");

const battleQuestion = document.getElementById("battleQuestion");
const battleTimer = document.getElementById("battleTimer");
const ball1Name = document.getElementById("ball1Name");
const ball1Hp = document.getElementById("ball1Hp");
const ball2Name = document.getElementById("ball2Name");
const ball2Hp = document.getElementById("ball2Hp");
const damageDisplay = document.getElementById("damageDisplay");

const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 8];
let choice1 = null, choice2 = null, battle = null, animId = null;
let speedIdx = 2, speedMult = 1;
let currentMode = "duel";
let duelSizeCleanup = null;
let pendingTourneyAdvance = null;

// ── Mode tabs ──
document.querySelectorAll(".mode-tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    document.querySelectorAll(".mode-tab").forEach(function(t) { t.classList.remove("active"); });
    tab.classList.add("active");
    currentMode = tab.dataset.mode;
    document.querySelectorAll(".mode-content").forEach(function(c) { c.classList.remove("active"); });
    document.getElementById(currentMode === "duel" ? "duelSetup" : "tournamentSetup").classList.add("active");
  });
});

// ── Duel pickers ──
function buildPickers() {
  for (const key of Object.keys(BALL_TYPES)) {
    const type = BALL_TYPES[key];
    for (const [picker, num] of [[picker1, 1], [picker2, 2]]) {
      const div = document.createElement("div");
      div.className = "ball-option";
      div.dataset.key = key;
      div.style.setProperty("--c", type.color);
      div.innerHTML = '<span class="emoji">' + type.emoji + '</span><span class="name">' + type.name + '</span>';
      div.addEventListener("click", function() { selectBall(num, key); });
      picker.appendChild(div);
    }
  }
}

function selectBall(num, key) {
  const type = BALL_TYPES[key];
  const picker = num === 1 ? picker1 : picker2;
  const display = num === 1 ? selected1 : selected2;
  picker.querySelectorAll(".ball-option").forEach(function(o) { o.classList.remove("selected"); });
  picker.querySelector('[data-key="' + key + '"]').classList.add("selected");
  if (num === 1) choice1 = key; else choice2 = key;
  display.textContent = type.emoji + " " + type.name + " — " + type.desc;
}

function showScreen(screen) {
  [setupScreen, battleScreen, tourneyScreen].forEach(function(s) { s.classList.remove("active"); });
  screen.classList.add("active");
}

function cleanupBattleSession() {
  if (animId) cancelAnimationFrame(animId);
  animId = null;
  if (pendingTourneyAdvance) {
    clearTimeout(pendingTourneyAdvance);
    pendingTourneyAdvance = null;
  }
  if (duelSizeCleanup) {
    duelSizeCleanup();
    duelSizeCleanup = null;
  }
  battle = null;
}

function showBattle() {
  if (!choice1 || !choice2) return;
  cleanupBattleSession();
  showScreen(battleScreen);
  startGame();
}

function showSetup() {
  cleanupBattleSession();
  tourney = null;
  showScreen(setupScreen);
}

function syncBallScale(ball, sizePercent, baseR) {
  const scale = sizePercent / 100;
  ball.radius = baseR * scale;
  if (ball.isInfinite) return;
  const hpFrac = ball.maxHp > 0 ? clamp(ball.hp / ball.maxHp, 0, 1) : 1;
  ball.maxHp = Math.max(1, Math.round(1000 * scale));
  ball.hp = Math.round(ball.maxHp * hpFrac);
}

function bindDuelSizeControls(b1, b2, baseR) {
  if (duelSizeCleanup) duelSizeCleanup();
  function onSizeChange() {
    const s1 = parseInt(sizeRange1.value, 10);
    const s2 = parseInt(sizeRange2.value, 10);
    syncBallScale(b1, s1, baseR);
    syncBallScale(b2, s2, baseR);
    sizeVal1.textContent = s1 + "%";
    sizeVal2.textContent = s2 + "%";
  }
  sizeRange1.addEventListener("input", onSizeChange);
  sizeRange2.addEventListener("input", onSizeChange);
  onSizeChange();
  duelSizeCleanup = function() {
    sizeRange1.removeEventListener("input", onSizeChange);
    sizeRange2.removeEventListener("input", onSizeChange);
  };
}

function startGame() {
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * devicePixelRatio);
  canvas.height = Math.floor(rect.height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const W = rect.width, H = rect.height;

  const b1 = createBall(choice1, 0, 0);
  const b2 = createBall(choice2, 0, 0);
  const baseR = Math.min(W, H) * 0.09;
  bindDuelSizeControls(b1, b2, baseR);

  initBallPhysics(b1, W, H, 0);
  initBallPhysics(b2, W, H, 1);
  battle = createBattle(b1, b2);

  if (b1.isInfinite || b2.isInfinite) {
    const attacker = b1.isInfinite ? b2 : b1;
    battleQuestion.textContent = "How much damage can " + attacker.emoji + " " + attacker.name + " deal in 62s?";
  } else {
    battleQuestion.textContent = "Can " + b1.emoji + " " + b1.name + " beat " + b2.emoji + " " + b2.name + "?";
  }
  ball1Name.textContent = b1.emoji + " " + b1.name;
  ball2Name.textContent = b2.emoji + " " + b2.name;

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    const simDt = dt * speedMult;
    updatePhysics(battle.balls, W, H, simDt);
    updateBattle(battle, simDt);
    updateFloatingTexts(battle, simDt);
    updateParticles(battle, simDt);
    updateTrails(battle);
    renderBattle(ctx, battle, W, H);

    if (battle.maxTime > 0) {
      const rem = Math.max(0, battle.maxTime - battle.time);
      battleTimer.textContent = rem.toFixed(1) + "s";
    } else {
      battleTimer.textContent = battle.time.toFixed(1) + "s";
    }
    ball1Hp.textContent = "HP: " + formatNumber(b1.hp);
    ball2Hp.textContent = "HP: " + formatNumber(b2.hp);
    ball1Hp.style.color = b1.hp > 0 ? "#2ecc71" : "#e74c3c";
    ball2Hp.style.color = b2.hp > 0 ? "#2ecc71" : "#e74c3c";
    damageDisplay.textContent = b1.emoji + " Dmg: " + formatNumber(b1.totalDamage) + "  |  " + b2.emoji + " Dmg: " + formatNumber(b2.totalDamage);

    if (speedMult !== 1) {
      ctx.font = "bold 13px 'Inter', sans-serif";
      ctx.fillStyle = "#3b82f6";
      ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(speedMult + "\u00d7 speed", W - 8, 8);
    }

    if (battle.state === "running") animId = requestAnimationFrame(loop);
  }
  animId = requestAnimationFrame(loop);
}

// ── Speed controls ──
const speedLabel = document.getElementById("speedLabel");
const tSpeedLabel = document.getElementById("tSpeedLabel");

function updateSpeedLabel() {
  var txt = speedMult + "\u00d7";
  if (speedLabel) speedLabel.textContent = txt;
  if (tSpeedLabel) tSpeedLabel.textContent = txt;
}

function changeSpeed(dir) {
  speedIdx = clamp(speedIdx + dir, 0, SPEED_STEPS.length - 1);
  speedMult = SPEED_STEPS[speedIdx];
  updateSpeedLabel();
}

window.addEventListener("keydown", function(e) {
  if (e.key === "ArrowUp" || e.key === "=") changeSpeed(1);
  if (e.key === "ArrowDown" || e.key === "-") changeSpeed(-1);
});

// ══════════════════════════════════════
//  TOURNAMENT
// ══════════════════════════════════════
const tourneyPicker = document.getElementById("tourneyPicker");
const tourneyCount = document.getElementById("tourneyCount");
const startTourneyBtn = document.getElementById("startTourneyBtn");
let tourneySelection = [];

function buildTourneyPicker() {
  for (const key of Object.keys(BALL_TYPES)) {
    const type = BALL_TYPES[key];
    const div = document.createElement("div");
    div.className = "ball-option";
    div.dataset.key = key;
    div.style.setProperty("--c", type.color);
    div.innerHTML = '<span class="emoji">' + type.emoji + '</span><span class="name">' + type.name + '</span>';
    div.addEventListener("click", function() { toggleTourneyBall(key, div); });
    tourneyPicker.appendChild(div);
  }
}

function toggleTourneyBall(key, div) {
  const idx = tourneySelection.indexOf(key);
  if (idx >= 0) {
    tourneySelection.splice(idx, 1);
    div.classList.remove("selected");
  } else if (tourneySelection.length < 8) {
    tourneySelection.push(key);
    div.classList.add("selected");
  }
  tourneyCount.textContent = tourneySelection.length + " / 8 selected";
  startTourneyBtn.disabled = tourneySelection.length !== 8;
}

document.getElementById("tourneyRandom").addEventListener("click", function() {
  tourneySelection = [];
  tourneyPicker.querySelectorAll(".ball-option").forEach(function(d) { d.classList.remove("selected"); });
  const keys = Object.keys(BALL_TYPES);
  while (tourneySelection.length < 8) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    if (tourneySelection.indexOf(k) < 0) tourneySelection.push(k);
  }
  tourneySelection.forEach(function(k) {
    tourneyPicker.querySelector('[data-key="' + k + '"]').classList.add("selected");
  });
  tourneyCount.textContent = "8 / 8 selected";
  startTourneyBtn.disabled = false;
});

// Tournament state
let tourney = null;

function createTournament(keys) {
  // Shuffle
  const shuffled = keys.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  return {
    participants: shuffled,
    rounds: [
      // QF: 4 matches
      [{ a: shuffled[0], b: shuffled[1], winner: null },
       { a: shuffled[2], b: shuffled[3], winner: null },
       { a: shuffled[4], b: shuffled[5], winner: null },
       { a: shuffled[6], b: shuffled[7], winner: null }],
      // SF: 2 matches
      [{ a: null, b: null, winner: null },
       { a: null, b: null, winner: null }],
      // Final
      [{ a: null, b: null, winner: null }],
    ],
    currentRound: 0,
    currentMatch: 0,
    champion: null,
  };
}

const ROUND_NAMES = ["Quarter-final", "Semi-final", "Final"];

function startTournament() {
  if (tourneySelection.length !== 8) return;
  cleanupBattleSession();
  tourney = createTournament(tourneySelection);
  showScreen(tourneyScreen);
  runTourneyMatch();
}

function runTourneyMatch() {
  pendingTourneyAdvance = null;
  const round = tourney.rounds[tourney.currentRound];
  const match = round[tourney.currentMatch];
  const roundName = ROUND_NAMES[tourney.currentRound];
  const matchNum = tourney.currentMatch + 1;
  const totalMatches = round.length;

  document.getElementById("tourneyRound").textContent = roundName + " " + matchNum + "/" + totalMatches;

  const tArena = document.getElementById("tourneyArena");
  const tCtx = tArena.getContext("2d");
  const wrap = tArena.parentElement;
  const rect = wrap.getBoundingClientRect();
  tArena.width = Math.floor(rect.width * devicePixelRatio);
  tArena.height = Math.floor(rect.height * devicePixelRatio);
  tCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const W = rect.width, H = rect.height;

  const b1 = createBall(match.a, 0, 0);
  const b2 = createBall(match.b, 0, 0);
  const baseR = Math.min(W, H) * 0.105;
  b1.radius = baseR; b2.radius = baseR;

  initBallPhysics(b1, W, H, 0);
  initBallPhysics(b2, W, H, 1);
  battle = createBattle(b1, b2);

  document.getElementById("tourneyMatchup").textContent = b1.emoji + " " + b1.name + "  vs  " + b2.emoji + " " + b2.name;
  document.getElementById("t1Name").textContent = b1.emoji + " " + b1.name;
  document.getElementById("t2Name").textContent = b2.emoji + " " + b2.name;

  renderBracket();

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    const simDt = dt * speedMult;
    updatePhysics(battle.balls, W, H, simDt);
    updateBattle(battle, simDt);
    updateFloatingTexts(battle, simDt);
    updateParticles(battle, simDt);
    updateTrails(battle);
    renderBattle(tCtx, battle, W, H);

    document.getElementById("t1Hp").textContent = "HP: " + formatNumber(b1.hp);
    document.getElementById("t2Hp").textContent = "HP: " + formatNumber(b2.hp);
    document.getElementById("t1Hp").style.color = b1.hp > 0 ? "#2ecc71" : "#e74c3c";
    document.getElementById("t2Hp").style.color = b2.hp > 0 ? "#2ecc71" : "#e74c3c";

    if (speedMult !== 1) {
      tCtx.font = "bold 13px 'Inter', sans-serif";
      tCtx.fillStyle = "#3b82f6";
      tCtx.textAlign = "right"; tCtx.textBaseline = "top";
      tCtx.fillText(speedMult + "\u00d7 speed", W - 8, 8);
    }

    if (battle.state === "running") {
      animId = requestAnimationFrame(loop);
    } else {
      // Match finished
      match.winner = battle.winner.type;
      renderBracket();
      pendingTourneyAdvance = setTimeout(advanceTourney, 1500);
    }
  }
  animId = requestAnimationFrame(loop);
}

function advanceTourney() {
  pendingTourneyAdvance = null;
  if (!tourney) return;
  const round = tourney.rounds[tourney.currentRound];
  tourney.currentMatch++;

  if (tourney.currentMatch >= round.length) {
    // Move to next round
    tourney.currentRound++;
    tourney.currentMatch = 0;

    if (tourney.currentRound >= tourney.rounds.length) {
      // Tournament over!
      tourney.champion = tourney.rounds[2][0].winner;
      renderBracket();
      var champ = BALL_TYPES[tourney.champion];
      document.getElementById("tourneyRound").textContent = "Champion: " + champ.emoji + " " + champ.name + "!";
      document.getElementById("tourneyMatchup").textContent = "";
      return;
    }

    // Fill next round matches from winners
    var prevRound = tourney.rounds[tourney.currentRound - 1];
    var nextRound = tourney.rounds[tourney.currentRound];
    for (var i = 0; i < nextRound.length; i++) {
      nextRound[i].a = prevRound[i * 2].winner;
      nextRound[i].b = prevRound[i * 2 + 1].winner;
    }
  }

  runTourneyMatch();
}

// ── Bracket rendering ──
function renderBracket() {
  var bc = document.getElementById("bracketCanvas");
  var bctx = bc.getContext("2d");
  var rect = bc.getBoundingClientRect();
  bc.width = Math.floor(rect.width * devicePixelRatio);
  bc.height = Math.floor(rect.height * devicePixelRatio);
  bctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  var W = rect.width, H = rect.height;

  bctx.fillStyle = "#fafafa";
  bctx.fillRect(0, 0, W, H);

  var colW = W / 4;
  var rounds = tourney.rounds;

  for (var r = 0; r < rounds.length; r++) {
    var matches = rounds[r];
    var x = colW * r + 10;
    var slotH = H / matches.length;

    for (var m = 0; m < matches.length; m++) {
      var match = matches[m];
      var cy = slotH * m + slotH / 2;
      var boxH = 28;
      var boxW = colW - 20;

      // Draw match box
      var isActive = r === tourney.currentRound && m === tourney.currentMatch && !tourney.champion;
      bctx.fillStyle = isActive ? "#eff6ff" : "#fff";
      bctx.strokeStyle = isActive ? "#3b82f6" : "#ddd";
      bctx.lineWidth = isActive ? 2 : 1;
      bctx.beginPath();
      bctx.roundRect(x, cy - boxH / 2, boxW, boxH, 4);
      bctx.fill(); bctx.stroke();

      // Ball names
      bctx.font = "bold 8px 'Inter', sans-serif";
      bctx.textAlign = "left"; bctx.textBaseline = "middle";

      if (match.a) {
        var ta = BALL_TYPES[match.a];
        var isLoserA = match.winner && match.winner !== match.a;
        bctx.fillStyle = isLoserA ? "#ccc" : "#333";
        bctx.fillText(ta.emoji + " " + ta.name, x + 4, cy - 5);
      } else {
        bctx.fillStyle = "#ccc";
        bctx.fillText("???", x + 4, cy - 5);
      }

      if (match.b) {
        var tb = BALL_TYPES[match.b];
        var isLoserB = match.winner && match.winner !== match.b;
        bctx.fillStyle = isLoserB ? "#ccc" : "#333";
        bctx.fillText(tb.emoji + " " + tb.name, x + 4, cy + 7);
      } else {
        bctx.fillStyle = "#ccc";
        bctx.fillText("???", x + 4, cy + 7);
      }

      // Connector line to next round
      if (r < rounds.length - 1) {
        var nextSlotH = H / rounds[r + 1].length;
        var nextM = Math.floor(m / 2);
        var nextCy = nextSlotH * nextM + nextSlotH / 2;
        var nextX = colW * (r + 1) + 10;
        bctx.strokeStyle = "#ddd";
        bctx.lineWidth = 1;
        bctx.beginPath();
        bctx.moveTo(x + boxW, cy);
        bctx.lineTo(x + boxW + 5, cy);
        bctx.lineTo(x + boxW + 5, nextCy);
        bctx.lineTo(nextX, nextCy);
        bctx.stroke();
      }
    }
  }

  // Champion column
  if (tourney.champion) {
    var champ = BALL_TYPES[tourney.champion];
    var cx = colW * 3 + colW / 2;
    bctx.font = "bold 14px sans-serif";
    bctx.textAlign = "center"; bctx.textBaseline = "middle";
    bctx.fillStyle = "#f59e0b";
    bctx.fillText("\ud83c\udfc6", cx, H / 2 - 10);
    bctx.font = "bold 10px 'Inter', sans-serif";
    bctx.fillStyle = "#333";
    bctx.fillText(champ.emoji + " " + champ.name, cx, H / 2 + 8);
  }
}

// ── Init ──
buildPickers();
buildTourneyPicker();

startBtn.addEventListener("click", showBattle);
backBtn.addEventListener("click", showSetup);
startTourneyBtn.addEventListener("click", startTournament);
document.getElementById("tourneyBackBtn").addEventListener("click", function() {
  showSetup();
});

selectBall(1, "multiplication");
selectBall(2, "exponential");

document.getElementById("speedUp").addEventListener("click", function() { changeSpeed(1); });
document.getElementById("speedDown").addEventListener("click", function() { changeSpeed(-1); });
document.getElementById("tSpeedUp").addEventListener("click", function() { changeSpeed(1); });
document.getElementById("tSpeedDown").addEventListener("click", function() { changeSpeed(-1); });

})();
