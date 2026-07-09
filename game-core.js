(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GameCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
"use strict";

// ══════════════════════════════════════
//  UTILS
// ══════════════════════════════════════
function formatNumber(n) {
  if (n === Infinity || n === -Infinity) return "∞";
  if (Number.isNaN(n)) return "NaN";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 1000) return sign + Math.floor(abs).toString();
  if (abs < 1e6) return sign + (abs / 1e3).toFixed(1) + "K";
  if (abs < 1e9) return sign + (abs / 1e6).toFixed(1) + "M";
  if (abs < 1e12) return sign + (abs / 1e9).toFixed(1) + "B";
  if (abs < 1e15) return sign + (abs / 1e12).toFixed(1) + "T";
  return sign + abs.toExponential(2);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ══════════════════════════════════════
//  BALL TYPES
// ══════════════════════════════════════
const BALL_TYPES = {
  addition: {
    name: "Addition", emoji: "➕", color: "#3b82f6",
    desc: "Damage +N per hit (1, 2, 3, 4...)",
    calcDamage(n) { return n; },
  },
  multiplication: {
    name: "Multiplication", emoji: "✖️", color: "#f59e0b",
    desc: "Damage ×2 per hit (1, 2, 4, 8...)",
    calcDamage(n) { return Math.pow(2, n - 1); },
  },
  exponential: {
    name: "Exponential", emoji: "📈", color: "#ef4444",
    desc: "Damage = 2^N (explosive growth)",
    calcDamage(n) { return Math.pow(2, n); },
  },
  factorial: {
    name: "Factorial", emoji: "❗", color: "#8b5cf6",
    desc: "Damage = N! (1, 2, 6, 24, 120...)",
    calcDamage(n) {
      let f = 1;
      for (let i = 2; i <= Math.min(n, 170); i++) f *= i;
      return f;
    },
  },
  fibonacci: {
    name: "Fibonacci", emoji: "🐚", color: "#14b8a6",
    desc: "Damage by Fibonacci (1,1,2,3,5,8...)",
    calcDamage(n) {
      let a = 0, b = 1;
      for (let i = 1; i < n; i++) { const t = a + b; a = b; b = t; }
      return b;
    },
  },
  power: {
    name: "Power", emoji: "🔋", color: "#f97316",
    desc: "Damage = N² (1, 4, 9, 16, 25...)",
    calcDamage(n) { return n * n; },
  },
  laser: {
    name: "Laser", emoji: "🔴", color: "#dc2626",
    desc: "Continuous beam — damage/sec",
    isLaser: true,
    calcDamage(n) { return 5 + n * 2; },
  },
  speed: {
    name: "Speed", emoji: "⚡", color: "#eab308",
    desc: "Low damage but attacks 3× faster",
    speedMult: 3,
    calcDamage(n) { return Math.ceil(n * 0.4); },
  },
  sniper: {
    name: "Sniper", emoji: "🎯", color: "#6366f1",
    desc: "Slow but ×10 damage each hit",
    speedMult: 0.3,
    calcDamage(n) { return n * 10; },
  },
  vampire: {
    name: "Vampire", emoji: "🧛", color: "#7c3aed",
    desc: "Steals HP from enemy, heals self",
    stealsHp: true,
    calcDamage(n) { return 3 + n * 2; },
  },
  geometric: {
    name: "Geometric", emoji: "📊", color: "#059669",
    desc: "Damage ×3 per hit (1, 3, 9, 27...)",
    calcDamage(n) { return Math.pow(3, n - 1); },
  },
  prime: {
    name: "Prime", emoji: "🔢", color: "#0ea5e9",
    desc: "Damage = Nth prime number",
    calcDamage(n) {
      const p = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
      return n <= p.length ? p[n - 1] : p[p.length - 1] + (n - p.length) * 10;
    },
  },
  logarithm: {
    name: "Logarithm", emoji: "📉", color: "#64748b",
    desc: "Damage = 10·ln(N+1) — slow but steady",
    calcDamage(n) { return Math.round(10 * Math.log(n + 1)); },
  },
  sqrt: {
    name: "Square Root", emoji: "√", color: "#06b6d4",
    desc: "Damage = 10·√N — balanced growth",
    calcDamage(n) { return Math.round(10 * Math.sqrt(n)); },
  },
  harmonic: {
    name: "Harmonic", emoji: "🎵", color: "#a855f7",
    desc: "Damage = sum of 1/k · 100",
    calcDamage(n) {
      let s = 0; for (let k = 1; k <= n; k++) s += 1 / k;
      return Math.round(s * 100);
    },
  },
  collatz: {
    name: "Collatz", emoji: "🌀", color: "#ec4899",
    desc: "Chaotic: odd→3N+1, even→N/2",
    calcDamage(n) {
      let v = n + 5, steps = 0;
      while (v > 1 && steps < 200) { v = v % 2 === 0 ? v / 2 : 3 * v + 1; steps++; }
      return steps * 3;
    },
  },
  tetration: {
    name: "Tetration", emoji: "🗼", color: "#b91c1c",
    desc: "2↑↑N — hyper-exponential growth",
    calcDamage(n) {
      let v = 1;
      for (let i = 0; i < Math.min(n, 5); i++) v = Math.pow(2, v);
      return Math.min(v, 1e15);
    },
  },
  golden: {
    name: "Golden Ratio", emoji: "🌻", color: "#d97706",
    desc: "Damage = φ^N (1.618... growth)",
    calcDamage(n) { return Math.round(Math.pow(1.618033988749, n)); },
  },
  pi: {
    name: "Pi", emoji: "π", color: "#4338ca",
    desc: "Damage = π^N (3.14... growth)",
    calcDamage(n) { return Math.round(Math.pow(Math.PI, n)); },
  },
  random: {
    name: "Random", emoji: "🎲", color: "#f43f5e",
    desc: "Damage = random 1 to N×20",
    calcDamage(n) { return Math.floor(Math.random() * n * 20) + 1; },
  },
  catalan: {
    name: "Catalan", emoji: "🌲", color: "#16a34a",
    desc: "Catalan numbers (1,1,2,5,14,42...)",
    calcDamage(n) {
      const k = Math.min(n, 20);
      let c = 1;
      for (let i = 0; i < k; i++) c = c * 2 * (2 * i + 1) / (i + 2);
      return Math.max(1, Math.round(c));
    },
  },
  modular: {
    name: "Modular", emoji: "♻️", color: "#0d9488",
    desc: "Cycles 5,15,50,150,50,15... repeating",
    calcDamage(n) {
      const cycle = [5, 15, 50, 150, 50, 15];
      return cycle[(n - 1) % cycle.length];
    },
  },
  triangular: {
    name: "Triangular", emoji: "🔺", color: "#ea580c",
    desc: "Damage = N·(N+1)/2 (1,3,6,10,15...)",
    calcDamage(n) { return n * (n + 1) / 2; },
  },
  cube: {
    name: "Cube", emoji: "🧊", color: "#2563eb",
    desc: "Damage = N³ (1, 8, 27, 64, 125...)",
    calcDamage(n) { return n * n * n; },
  },
  shield: {
    name: "Shield", emoji: "🛡️", color: "#78716c",
    desc: "Low dmg but heals self 20% of dmg dealt",
    stealsHp: true,
    calcDamage(n) { return Math.ceil(n * 0.8); },
  },
  doubler: {
    name: "Doubler", emoji: "🪞", color: "#7e22ce",
    desc: "Hits twice per contact, half damage each",
    speedMult: 2,
    calcDamage(n) { return Math.ceil(n * 0.6); },
  },
  infinity: {
    name: "Infinity", emoji: "∞", color: "#9ca3af",
    desc: "Infinite HP, deals 0 damage — punching bag",
    isInfinite: true,
    calcDamage() { return 0; },
  },
};

function createBall(typeKey, x, y) {
  const type = BALL_TYPES[typeKey];
  return {
    type: typeKey, name: type.name, emoji: type.emoji, color: type.color,
    isLaser: type.isLaser || false, stealsHp: type.stealsHp || false,
    speedMult: type.speedMult || 1,
    hp: type.isInfinite ? Infinity : 1000,
    maxHp: type.isInfinite ? Infinity : 1000,
    isInfinite: type.isInfinite || false,
    x, y, vx: 0, vy: 0, radius: 25,
    hitCount: 0, totalDamage: 0, lastHitTime: 0, _lastContactHit: -999,
    calcDamage() {
      this.hitCount++;
      return type.calcDamage(this.hitCount);
    },
  };
}

// ══════════════════════════════════════
//  PHYSICS
// ══════════════════════════════════════
const FRICTION = 0.998;
const BOUNCE_DAMP = 0.85;
const BASE_SPEED = 418;

function initBallPhysics(ball, W, H, side) {
  ball.x = side === 0 ? W * 0.25 : W * 0.75;
  ball.y = H / 2;
  const angle = Math.random() * Math.PI * 2;
  const spd = BASE_SPEED * (0.8 + Math.random() * 0.4);
  ball.vx = Math.cos(angle) * spd;
  ball.vy = Math.sin(angle) * spd;
}

var AURA_RADIUS_MULT = 2.25;
var AURA_GRAVITY = 30;

function updatePhysics(balls, W, H, dt) {
  // Aura gravity — balls gently pull each other when within aura range
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      if (a.hp <= 0 || b.hp <= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const auraRange = (a.radius + b.radius) * AURA_RADIUS_MULT;
      if (d < auraRange && d > a.radius + b.radius) {
        const strength = AURA_GRAVITY * (1 - d / auraRange) * dt;
        const nx = dx / d, ny = dy / d;
        a.vx += nx * strength; a.vy += ny * strength;
        b.vx -= nx * strength; b.vy -= ny * strength;
      }
    }
  }

  for (const b of balls) {
    if (b.hp <= 0) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= FRICTION;
    b.vy *= FRICTION;

    const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (spd < BASE_SPEED * 0.5) {
      const scale = (BASE_SPEED * 0.7) / Math.max(spd, 0.01);
      b.vx *= scale; b.vy *= scale;
    }

    if (b.x - b.radius < 0) { b.x = b.radius; b.vx = Math.abs(b.vx) * BOUNCE_DAMP; }
    if (b.x + b.radius > W) { b.x = W - b.radius; b.vx = -Math.abs(b.vx) * BOUNCE_DAMP; }
    if (b.y - b.radius < 0) { b.y = b.radius; b.vy = Math.abs(b.vy) * BOUNCE_DAMP; }
    if (b.y + b.radius > H) { b.y = H - b.radius; b.vy = -Math.abs(b.vy) * BOUNCE_DAMP; }
  }
}

function checkCollision(a, b) {
  return dist(a.x, a.y, b.x, b.y) < a.radius + b.radius;
}

function resolveCollision(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / d, ny = dy / d;
  const overlap = (a.radius + b.radius - d) / 2 + 1;
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;

  const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
  const dvDotN = dvx * nx + dvy * ny;
  if (dvDotN > 0) {
    a.vx -= dvDotN * nx * BOUNCE_DAMP; a.vy -= dvDotN * ny * BOUNCE_DAMP;
    b.vx += dvDotN * nx * BOUNCE_DAMP; b.vy += dvDotN * ny * BOUNCE_DAMP;
  }
}

// ══════════════════════════════════════
//  BATTLE LOGIC
// ══════════════════════════════════════
const HP_STEAL_FRACTION = 0.3;      // vampire: fraction of damage stolen as HP
const HIT_COOLDOWN = 0.45;          // seconds between contact-damage hits
const LASER_INTERVAL = 0.15;        // seconds between laser damage ticks

function createBattle(b1, b2) {
  const hasInfinite = b1.isInfinite || b2.isInfinite;
  return { balls: [b1, b2], time: 0, maxTime: hasInfinite ? 62 : 0, state: "running", winner: null, floatingTexts: [], particles: [], trails: [] };
}

function spawnParticles(battle, x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 100;
    battle.particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color, radius: 1.5 + Math.random() * 2.5, age: 0, life: 0.4 + Math.random() * 0.4,
    });
  }
}

function applyDamage(battle, attacker, target, dmg) {
  target.hp -= dmg;
  attacker.totalDamage += dmg;
  if (attacker.stealsHp) attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.floor(dmg * HP_STEAL_FRACTION));
  battle.floatingTexts.push({
    x: target.x + (Math.random() - 0.5) * 20,
    y: target.y - target.radius - 5,
    text: dmg, color: attacker.color, age: 0,
  });
  spawnParticles(battle, target.x, target.y, attacker.color, 6);
}

function updateBattle(battle, dt) {
  if (battle.state !== "running") return;
  battle.time += dt;

  // Timer only in timed mode (maxTime > 0)
  if (battle.maxTime > 0 && battle.time >= battle.maxTime) {
    battle.state = "finished";
    // Against infinity: non-infinite ball "wins" by total damage dealt
    const [a, b] = battle.balls;
    if (a.isInfinite && !b.isInfinite) battle.winner = b;
    else if (b.isInfinite && !a.isInfinite) battle.winner = a;
    else battle.winner = a.totalDamage >= b.totalDamage ? a : b;
    return;
  }

  // Laser balls
  for (let i = 0; i < 2; i++) {
    const atk = battle.balls[i], tgt = battle.balls[1 - i];
    if (!atk.isLaser || atk.hp <= 0 || tgt.hp <= 0) continue;
    atk.lastHitTime += dt;
    if (atk.lastHitTime >= LASER_INTERVAL / atk.speedMult) {
      atk.lastHitTime = 0;
      applyDamage(battle, atk, tgt, atk.calcDamage());
    }
  }

  // Contact collision
  const [a, b] = battle.balls;
  if (a.hp > 0 && b.hp > 0 && checkCollision(a, b)) {
    resolveCollision(a, b);
    for (let i = 0; i < 2; i++) {
      const atk = battle.balls[i], tgt = battle.balls[1 - i];
      if (atk.isLaser || atk.hp <= 0 || tgt.hp <= 0) continue;
      const cd = HIT_COOLDOWN / atk.speedMult;
      if (battle.time - atk._lastContactHit >= cd) {
        atk._lastContactHit = battle.time;
        applyDamage(battle, atk, tgt, atk.calcDamage());
      }
    }
  }

  // Death check — check both before assigning winner (simultaneous kill)
  const dead0 = battle.balls[0].hp <= 0;
  const dead1 = battle.balls[1].hp <= 0;
  if (dead0 || dead1) {
    battle.balls[0].hp = dead0 ? 0 : battle.balls[0].hp;
    battle.balls[1].hp = dead1 ? 0 : battle.balls[1].hp;
    battle.state = "finished";
    if (dead0 && dead1) {
      // Simultaneous kill — higher total damage wins
      battle.winner = battle.balls[0].totalDamage >= battle.balls[1].totalDamage
        ? battle.balls[0] : battle.balls[1];
    } else {
      battle.winner = dead0 ? battle.balls[1] : battle.balls[0];
    }
  }
}

function updateFloatingTexts(battle, dt) {
  for (const ft of battle.floatingTexts) { ft.age += dt; ft.y -= 40 * dt; }
  battle.floatingTexts = battle.floatingTexts.filter(ft => ft.age < 1.2);
}

function updateParticles(battle, dt) {
  for (const p of battle.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
    p.age += dt;
  }
  battle.particles = battle.particles.filter(p => p.age < p.life);
}

const TRAIL_MAX_POINTS = 32;   // points per ball
const TRAIL_LIFETIME = 0.55;   // seconds each point lives

function updateTrails(battle) {
  for (let bi = 0; bi < battle.balls.length; bi++) {
    const b = battle.balls[bi];
    if (b.hp <= 0) continue;
    battle.trails.push({ x: b.x, y: b.y, color: b.color, ballIndex: bi, age: 0 });
  }
  for (const t of battle.trails) t.age += 1 / 60;

  // Keep at most TRAIL_MAX_POINTS per ball, drop oldest first
  for (let bi = 0; bi < battle.balls.length; bi++) {
    const pts = battle.trails.filter(t => t.ballIndex === bi);
    if (pts.length > TRAIL_MAX_POINTS) {
      const excess = pts.slice(0, pts.length - TRAIL_MAX_POINTS);
      for (const p of excess) {
        const idx = battle.trails.indexOf(p);
        if (idx !== -1) battle.trails.splice(idx, 1);
      }
    }
  }
  battle.trails = battle.trails.filter(t => t.age < TRAIL_LIFETIME);
}

// ══════════════════════════════════════
//  RENDERER
// ══════════════════════════════════════
function renderBattle(ctx, battle, W, H) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#e5e5e5";
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  // Trails — tapered glow ribbon
  for (let bi = 0; bi < battle.balls.length; bi++) {
    const pts = battle.trails.filter(t => t.ballIndex === bi);
    if (pts.length < 2) continue;
    const ball = battle.balls[bi];
    const rgb = hexToRgb(pts[0].color);
    const maxW = ball.radius * 0.7;

    // Draw back-to-front so newer (thicker) segments paint over older ones
    // Two passes: glow (wide, low alpha) then core (narrow, high alpha)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length; i++) {
        const t = i / (pts.length - 1);           // 0 = oldest, 1 = newest
        const ageFade = clamp(1 - pts[i].age / TRAIL_LIFETIME, 0, 1);
        const alpha = t * ageFade;
        if (alpha < 0.01) continue;

        if (pass === 0) {
          // Glow layer: wide + very transparent
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.lineWidth = maxW * 2.2 * t;
          ctx.lineCap = "round";
          ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + (alpha * 0.18) + ")";
          ctx.stroke();
        } else {
          // Core layer: thin, bright
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.lineWidth = maxW * t;
          ctx.lineCap = "round";
          ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + (alpha * 0.75) + ")";
          ctx.stroke();
        }
      }
    }
  }

  // Laser beams
  for (let i = 0; i < 2; i++) {
    const atk = battle.balls[i], tgt = battle.balls[1 - i];
    if (!atk.isLaser || atk.hp <= 0) continue;
    const rgb = hexToRgb(atk.color);
    ctx.beginPath(); ctx.moveTo(atk.x, atk.y); ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.15)";
    ctx.lineWidth = 10; ctx.stroke();
    ctx.strokeStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.7)";
    ctx.lineWidth = 2.5; ctx.stroke();
  }

  // Balls
  for (const ball of battle.balls) {
    if (ball.hp <= 0) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ddd"; ctx.fill();
      ctx.font = ball.radius + "px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("\u{1F480}", ball.x, ball.y);
      ctx.globalAlpha = 1;
      continue;
    }

    const { x, y, radius, color, emoji } = ball;
    const rgb = hexToRgb(color);

    // Glow
    ctx.beginPath(); ctx.arc(x, y, radius * 2.25, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.10)";
    ctx.fill();

    // Body
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#f5f5f5"; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();

    // Emoji
    ctx.font = (radius * 1.1) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(emoji, x, y + 1);

    // HP bar
    const barW = radius * 2.2, barH = 5;
    const bx = x - barW / 2, by = y - radius - 12;
    const hpFrac = ball.isInfinite ? 1 : clamp(ball.hp / ball.maxHp, 0, 1);
    ctx.fillStyle = "#e0e0e0"; ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = ball.isInfinite ? "#9ca3af" : (hpFrac > 0.5 ? "#2ecc71" : hpFrac > 0.2 ? "#f39c12" : "#e74c3c");
    ctx.fillRect(bx, by, barW * hpFrac, barH);
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1; ctx.strokeRect(bx, by, barW, barH);

    ctx.font = "bold 8px sans-serif";
    ctx.fillStyle = "#333"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(formatNumber(ball.hp), x, by - 1);

    // Name
    ctx.font = "bold 9px sans-serif";
    ctx.fillStyle = "#666"; ctx.textBaseline = "top";
    ctx.fillText(ball.name, x, y + radius + 14);
  }

  // Floating texts
  for (const ft of battle.floatingTexts) {
    const alpha = clamp(1 - ft.age / 1.2, 0, 1);
    const scale = 1 + ft.age * 0.5;
    ctx.save();
    ctx.translate(ft.x, ft.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = ft.color;
    ctx.textAlign = "center";
    ctx.fillText(formatNumber(ft.text), 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Winner overlay
  if (battle.state === "finished" && battle.winner) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "bold 28px sans-serif";
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(battle.winner.emoji + " WINS!", W / 2, H / 2 - 10);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#ddd";
    ctx.fillText("Total damage: " + formatNumber(battle.winner.totalDamage), W / 2, H / 2 + 20);
  }
}

return {
  formatNumber, clamp, dist, hexToRgb,
  BALL_TYPES, createBall,
  FRICTION, BOUNCE_DAMP, BASE_SPEED, HIT_COOLDOWN, LASER_INTERVAL,
  initBallPhysics, updatePhysics, checkCollision, resolveCollision,
  createBattle, spawnParticles, applyDamage, updateBattle,
  updateFloatingTexts, updateParticles, updateTrails,
  renderBattle,
};

});
