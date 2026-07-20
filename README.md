# math-balls-battle

![Node.js](https://img.shields.io/badge/Node.js-canvas%20renderer-339933?logo=node.js&logoColor=white)
![TikTok](https://img.shields.io/badge/TikTok-Content%20Posting%20API-000000?logo=tiktok&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-bot-26A5E4?logo=telegram&logoColor=white)

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
