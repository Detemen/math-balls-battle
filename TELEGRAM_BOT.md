# Telegram Bot

## Setup

1. Create `.env` from `.env.example`.
2. Set `TELEGRAM_BOT_TOKEN` from BotFather.
3. Optional: set `BOT_ALLOWED_CHAT_IDS` to a comma-separated allowlist.
4. Optional: set `PUBLISH_CHANNEL_ID` for auto-posting (e.g. `@mychannel` or `-1001234567890`). The bot must be admin in the channel.
5. Ensure `ffmpeg` is installed and available in `PATH`.
6. Generate voice clips once if you want audio:

```bash
npm run tts
```

## Start

```bash
npm run bot
```

The bot uses long polling, so no webhook or public URL is required.

## Bot commands

- `/new` - interactive render setup with inline buttons
- `/render` - render the current interactive configuration
- `/render multiplication factorial --size1 120 --size2 90 --speed 1.5`
- `/balls` - list all ball ids
- `/status` - show current config and queue state
- `/cancel` - reset current config

## Render options

- `--size1` and `--size2` control ball size and starting HP in percent
- `--speed` controls simulation speed multiplier

Allowed ranges:

- `size1`, `size2`: `50` to `300`
- `speed`: `0.25` to `8`

Rendered files are stored in `./renders` by default.

## Auto-posting (Approve system)

After each render the bot sends the video with publish buttons (if any target is configured):

- **TG + TikTok** — posts to both Telegram channel and TikTok
- **TG канал** — posts only to Telegram channel
- **TikTok** — posts only to TikTok
- **Відхилити** — skips publishing

### Telegram channel

Set `PUBLISH_CHANNEL_ID` in `.env` (e.g. `@mychannel` or `-1001234567890`).
The bot must be admin in the channel with "Post Messages" permission.

### TikTok

1. Register app at developers.tiktok.com (Content Posting API).
2. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` in `.env`.
3. Run OAuth once to get tokens:

```bash
npm run tiktok-auth
```

4. Open the URL in browser, authorize, tokens are saved to `.env` automatically.
5. Tokens auto-refresh when expired.
