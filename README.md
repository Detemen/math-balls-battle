# math-balls-battle

Generates short "math battle" videos — two physics-driven ball simulations (e.g. multiplication vs. factorial growth) rendered frame-by-frame with canvas, narrated with TTS, captioned, and optionally published to Telegram/TikTok.

Sample output: `battle_multiplication_vs_factorial.mp4`.

## Pipeline

- `render-video.js` / `game-core.js` — physics simulation + canvas rendering (`@napi-rs/canvas`)
- `generate-tts.js` — text-to-speech narration (`node-gtts`)
- `generate-caption.js` — auto-generated captions
- `render-challenge.js` — assembles a full challenge video
- `telegram-bot.js` — Telegram bot for triggering renders (Telegraf)
- `tiktok-auth.js`, `tiktok-callback.html`, `tiktok-publish.js` — TikTok Content Posting API OAuth + publish flow

## Stack

Node.js, `@napi-rs/canvas`, Telegraf, TikTok Content Posting API.

## Running locally

```bash
npm install
cp .env.example .env   # bot token, TikTok API credentials
npm run render          # render a video
npm run bot              # start the Telegram bot
```
