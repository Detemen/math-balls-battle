# Math Balls Battle

Math ball battle simulator inspired by @mathballsleague (TikTok). Two balls with different mathematical damage mechanics fight each other on an arena. Primary use: generating vertical 9:16 TikTok videos.

## Architecture

Single-page browser app + Node.js video renderer. No bundler, no ES modules — works from `file://`.

### Files

| File | Purpose |
|------|---------|
| `game-core.js` | **Shared game logic** (UMD module). All physics, ball types, battle logic, canvas rendering. Used by both browser and Node.js. Exports `GameCore` object. |
| `main.js` | **Browser UI only**. Destructures from `window.GameCore`. Handles DOM: pickers, mode tabs, game loop (requestAnimationFrame), speed/size controls, tournament bracket. |
| `index.html` | HTML structure. Three screens: `setupScreen` (duel/tournament pickers), `battleScreen` (arena + HUD), `tourneyScreen` (bracket + arena). Loads `game-core.js` then `main.js`. |
| `styles.css` | Light theme, 440px max-width mobile-first. Arena aspect-ratio 1:1, side controls for size sliders. |
| `render-video.js` | **Node.js offline video renderer**. Renders 1080×1920 MP4 via ffmpeg. Three phases: Intro → Battle → Pause → Outro. Uses `@napi-rs/canvas` for server-side Canvas 2D. |
| `package.json` | Node deps: `@napi-rs/canvas`. Script: `npm run render`. |

### game-core.js exports (GameCore)

**Utils:** `formatNumber(n)`, `clamp(v,lo,hi)`, `dist(x1,y1,x2,y2)`, `hexToRgb(hex)`

**Ball types:** `BALL_TYPES` — object with 27 types. Each has `name`, `emoji`, `color`, `desc`, `calcDamage(hitCount)`. Special flags: `isLaser`, `stealsHp`, `speedMult`, `isInfinite`.

**Ball creation:** `createBall(typeKey, x, y)` → `{type, name, emoji, color, hp, maxHp, x, y, vx, vy, radius, hitCount, totalDamage, ...}`

**Physics:** `initBallPhysics(ball, W, H, side)`, `updatePhysics(balls, W, H, dt)`, `checkCollision(a,b)`, `resolveCollision(a,b)`. Constants: `BASE_SPEED=144`, `FRICTION=0.998`, `BOUNCE_DAMP=0.85`.

**Battle:** `createBattle(b1, b2)` → `{balls, time, maxTime, state, winner, floatingTexts, particles, trails}`. `maxTime=0` means fight to death; `maxTime=62` when one ball is infinite. `updateBattle(battle, dt)` handles laser ticks, contact collision, damage, death check.

**Effects:** `applyDamage(battle, attacker, target, dmg)`, `spawnParticles(...)`, `updateFloatingTexts(battle, dt)`, `updateParticles(battle, dt)`, `updateTrails(battle)`.

**Rendering:** `renderBattle(ctx, battle, W, H)` — draws everything on a Canvas 2D context (trails, laser beams, balls with emoji/HP bar/name, floating damage text, particles, winner overlay).

### 27 Ball Types

`addition`, `multiplication`, `exponential`, `factorial`, `fibonacci`, `power`, `laser`, `speed`, `sniper`, `vampire`, `geometric`, `prime`, `logarithm`, `sqrt`, `harmonic`, `collatz`, `tetration`, `golden`, `pi`, `random`, `catalan`, `modular`, `triangular`, `cube`, `shield`, `doubler`, `infinity`

### Browser Modes

1. **Duel** — pick 2 balls, fight to death. Live size sliders (50-300%) on sides of arena. Speed controls (0.25×–8×) via buttons or ↑↓ keys.
2. **Tournament** — pick 8 balls, auto-play QF → SF → Final with bracket visualization.
3. **Infinity mode** — when one ball is `infinity` type (infinite HP, 0 damage), battle uses 62s timer. Non-infinite ball wins by total damage dealt.

### Video Renderer (render-video.js)

**Usage:** `node render-video.js <ball1> <ball2> [output.mp4]`

**Output:** 1080×1920 MP4, 60fps, H.264

**Layout:** Warm beige background. Field narrower than full width (right 200px reserved for TikTok UI). Ball names + damage shown outside field in ball's color. HP bars above/below field.

**Phases:**
1. Intro (3.5s) — balls slide in, VS text, descriptions
2. Battle (variable, max 60s real time) — sim runs at 2.5× speed, arena 220×350 scaled to display
3. Pause (1.5s) — freeze last frame
4. Outro (3s) — winner display with stats

**Technical:** Simulation runs at small scale (220×350) matching browser physics, then ctx.scale() up to display area. Emoji replaced with colored circles + text abbreviations (node-canvas can't render color emoji). Frames piped as raw RGBA to ffmpeg stdin.

## Running

```bash
# Browser version
python -m http.server 8080
# open http://localhost:8080

# Render video
npm install          # first time only
node render-video.js multiplication factorial output.mp4
node render-video.js --help   # list all ball types
```

## Key Constants

- `BASE_SPEED = 144` — ball movement speed (pixels/sec in sim coords)
- `HIT_COOLDOWN = 0.45` — seconds between contact hits
- `LASER_INTERVAL = 0.15` — seconds between laser ticks
- `BALL_HP = 1000` — default HP for all balls
- `VIDEO_SPEED_MULT = 2.5` — simulation speed multiplier for video
- `SIM_W = 220, SIM_H = 350` — video simulation arena size
