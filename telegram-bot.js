require("dotenv").config();

const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const { spawn } = require("child_process");
const { Telegraf, Markup } = require("telegraf");

const G = require("./game-core.js");
const Render = require("./render-video.js");
const Challenge = require("./render-challenge.js");
const tiktok = require("./tiktok-publish.js");
const { generateCaption } = require("./generate-caption.js");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const OUTPUT_DIR = path.resolve(process.env.RENDER_OUTPUT_DIR || path.join(__dirname, "renders"));
const ALLOWED_CHAT_IDS = parseAllowedChatIds(process.env.BOT_ALLOWED_CHAT_IDS);
const PUBLISH_CHANNEL_ID = process.env.PUBLISH_CHANNEL_ID || "";

const BALL_KEYS = Object.keys(G.BALL_TYPES);
const BALLS_PER_PAGE = 9;
const SPEED_STEP = 0.1;
const SIZE_STEP = 10;

if (!BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN or BOT_TOKEN in environment.");
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();
const challengeSessions = new Map(); // chatId -> { ball, size, speed, lastAccess }
const pendingApprovals = new Map(); // jobId -> { chatId, outputPath, caption, videoMessageId }
const renderQueue = [];
let activeJob = null;
let nextJobId = 1;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function parseAllowedChatIds(rawValue) {
  if (!rawValue) return null;
  const ids = rawValue
    .split(",")
    .map(function(part) { return part.trim(); })
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function isChatAllowed(ctx) {
  if (!ALLOWED_CHAT_IDS) return true;
  const chatId = ctx.chat && ctx.chat.id ? String(ctx.chat.id) : "";
  return ALLOWED_CHAT_IDS.has(chatId);
}

function createDefaultConfig() {
  return {
    ball1: null,
    ball2: null,
    size1: Render.DEFAULT_BALL_SIZE_PERCENT,
    size2: Render.DEFAULT_BALL_SIZE_PERCENT,
    speed: Render.DEFAULT_VIDEO_SPEED_MULT,
  };
}

function getSession(chatId) {
  const now = Date.now();
  const existing = sessions.get(chatId);
  if (existing && (now - existing.lastAccess) < SESSION_TTL_MS) {
    existing.lastAccess = now;
    return existing;
  }
  const session = { config: createDefaultConfig(), lastAccess: now };
  sessions.set(chatId, session);
  return session;
}

function resetSession(chatId) {
  const session = { config: createDefaultConfig(), lastAccess: Date.now() };
  sessions.set(chatId, session);
  return session;
}

// Prune expired sessions every hour
setInterval(function() {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if ((now - session.lastAccess) >= SESSION_TTL_MS) {
      sessions.delete(chatId);
    }
  }
}, 60 * 60 * 1000).unref();

// ── Challenge sessions ──
function getChallengeSession(chatId) {
  const now = Date.now();
  const existing = challengeSessions.get(chatId);
  if (existing && (now - existing.lastAccess) < SESSION_TTL_MS) {
    existing.lastAccess = now;
    return existing;
  }
  const session = {
    ball: null,
    size: Challenge.DEFAULT_BALL_SIZE_PERCENT,
    speed: Challenge.DEFAULT_VIDEO_SPEED_MULT,
    lastAccess: now,
  };
  challengeSessions.set(chatId, session);
  return session;
}

function resetChallengeSession(chatId) {
  const session = {
    ball: null,
    size: Challenge.DEFAULT_BALL_SIZE_PERCENT,
    speed: Challenge.DEFAULT_VIDEO_SPEED_MULT,
    lastAccess: Date.now(),
  };
  challengeSessions.set(chatId, session);
  return session;
}

function formatChallengeConfig(session) {
  const lines = [
    "Challenge конфігурація:",
    "Куля: " + (session.ball ? formatBallChoice(session.ball) : "не вибрано"),
    "Розмір: " + session.size + "%",
    "Швидкість: " + session.speed + "x",
  ];
  if (!session.ball) {
    lines.push("");
    lines.push("Спочатку вибери кульку.");
  }
  return lines.join("\n");
}

function buildChallengeConfigKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Змінити кульку", "ch_change")],
    [
      Markup.button.callback("Розмір -10%", "ch_adjust:size:-10"),
      Markup.button.callback("Розмір +10%", "ch_adjust:size:10"),
    ],
    [
      Markup.button.callback("Speed -" + SPEED_STEP.toFixed(1), "ch_adjust:speed:-" + SPEED_STEP.toFixed(1)),
      Markup.button.callback("Speed +" + SPEED_STEP.toFixed(1), "ch_adjust:speed:" + SPEED_STEP.toFixed(1)),
    ],
    [Markup.button.callback("Старт!", "ch_render")],
    [
      Markup.button.callback("Скинути", "ch_reset"),
      Markup.button.callback("Скасувати", "ch_cancel"),
    ],
  ]);
}

async function showChallengeMenu(ctx, session, extraText) {
  const lines = [formatChallengeConfig(session), "", formatQueueStatus()];
  if (extraText) { lines.push(""); lines.push(extraText); }
  const text = lines.join("\n");
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, buildChallengeConfigKeyboard());
      return;
    }
  } catch (err) {
    if (!String(err.message || err).includes("message is not modified")) throw err;
  }
  await ctx.reply(text, buildChallengeConfigKeyboard());
}

function buildChallengeBallPicker(page) {
  const totalPages = Math.ceil(BALL_KEYS.length / BALLS_PER_PAGE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * BALLS_PER_PAGE;
  const pageKeys = BALL_KEYS.slice(start, start + BALLS_PER_PAGE);
  const rows = [];
  for (let i = 0; i < pageKeys.length; i += 3) {
    const slice = pageKeys.slice(i, i + 3);
    rows.push(slice.map(function(key) {
      const type = G.BALL_TYPES[key];
      return Markup.button.callback(type.emoji + " " + type.name, "ch_pick:" + key);
    }));
  }
  const navRow = [];
  if (currentPage > 0) navRow.push(Markup.button.callback("← Назад", "ch_page:" + (currentPage - 1)));
  navRow.push(Markup.button.callback((currentPage + 1) + "/" + totalPages, "noop"));
  if (currentPage < totalPages - 1) navRow.push(Markup.button.callback("Далі →", "ch_page:" + (currentPage + 1)));
  rows.push(navRow);
  rows.push([Markup.button.callback("Скасувати", "ch_cancel")]);
  return Markup.inlineKeyboard(rows);
}

function normalizeConfig(config) {
  const normalized = Render.normalizeRenderOptions(config);
  return {
    ball1: config.ball1,
    ball2: config.ball2,
    size1: normalized.size1,
    size2: normalized.size2,
    speed: normalized.speed,
  };
}

function ensureConfigReady(config) {
  return Boolean(config.ball1 && config.ball2);
}

function formatBallChoice(key) {
  if (!key) return "не вибрано";
  const type = G.BALL_TYPES[key];
  return type.emoji + " " + type.name + " (" + key + ")";
}

function formatConfig(config) {
  const lines = [
    "Поточна конфігурація:",
    "Куля 1: " + formatBallChoice(config.ball1),
    "Куля 2: " + formatBallChoice(config.ball2),
    "Розмір 1: " + config.size1 + "%",
    "Розмір 2: " + config.size2 + "%",
    "Швидкість симуляції: " + config.speed + "x",
  ];

  if (!ensureConfigReady(config)) {
    lines.push("");
    lines.push("Спочатку вибери обидві кульки.");
  }

  return lines.join("\n");
}

function formatQueueStatus() {
  const queued = renderQueue.length;
  const active = activeJob ? ("Активний рендер: #" + activeJob.id) : "Активний рендер: немає";
  return active + "\nУ черзі: " + queued;
}

function buildBallPicker(stage, page) {
  const totalPages = Math.ceil(BALL_KEYS.length / BALLS_PER_PAGE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * BALLS_PER_PAGE;
  const pageKeys = BALL_KEYS.slice(start, start + BALLS_PER_PAGE);
  const rows = [];

  for (let i = 0; i < pageKeys.length; i += 3) {
    const slice = pageKeys.slice(i, i + 3);
    rows.push(
      slice.map(function(key) {
        const type = G.BALL_TYPES[key];
        return Markup.button.callback(type.emoji + " " + type.name, "pick:" + stage + ":" + key);
      })
    );
  }

  const navRow = [];
  if (currentPage > 0) {
    navRow.push(Markup.button.callback("← Назад", "page:" + stage + ":" + (currentPage - 1)));
  }
  navRow.push(Markup.button.callback((currentPage + 1) + "/" + totalPages, "noop"));
  if (currentPage < totalPages - 1) {
    navRow.push(Markup.button.callback("Далі →", "page:" + stage + ":" + (currentPage + 1)));
  }
  rows.push(navRow);
  rows.push([Markup.button.callback("Скасувати", "cancel")]);

  return Markup.inlineKeyboard(rows);
}

function buildConfigKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Змінити кулю 1", "change:ball1"),
      Markup.button.callback("Змінити кулю 2", "change:ball2"),
    ],
    [
      Markup.button.callback("Куля 1 -10%", "adjust:size1:-10"),
      Markup.button.callback("Куля 1 +10%", "adjust:size1:10"),
    ],
    [
      Markup.button.callback("Куля 2 -10%", "adjust:size2:-10"),
      Markup.button.callback("Куля 2 +10%", "adjust:size2:10"),
    ],
    [
      Markup.button.callback("Speed -" + SPEED_STEP.toFixed(1), "adjust:speed:-" + SPEED_STEP.toFixed(1)),
      Markup.button.callback("Speed +" + SPEED_STEP.toFixed(1), "adjust:speed:" + SPEED_STEP.toFixed(1)),
    ],
    [
      Markup.button.callback("Поміняти місцями", "swap"),
      Markup.button.callback("Рендерити", "render"),
    ],
    [
      Markup.button.callback("Скинути", "reset"),
      Markup.button.callback("Скасувати", "cancel"),
    ],
  ]);
}

async function renderInteractiveText(ctx, text, keyboard) {
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, keyboard);
      return;
    }
  } catch (err) {
    if (!String(err.message || err).includes("message is not modified")) {
      throw err;
    }
  }
  await ctx.reply(text, keyboard);
}

async function showBallPicker(ctx, stage, page) {
  const title = stage === "ball1" ? "Вибери першу кульку:" : "Вибери другу кульку:";
  await renderInteractiveText(ctx, title, buildBallPicker(stage, page));
}

async function showConfigMenu(ctx, session, extraText) {
  const lines = [formatConfig(session.config), "", formatQueueStatus()];
  if (extraText) {
    lines.push("");
    lines.push(extraText);
  }
  await renderInteractiveText(ctx, lines.join("\n"), buildConfigKeyboard());
}

function clampSize(value) {
  return Render.normalizeRenderOptions({ size1: value }).size1;
}

function clampSpeed(value) {
  return Render.normalizeRenderOptions({ speed: value }).speed;
}

function buildOutputPath(config, requestedName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeRequestedName = requestedName
    ? path.basename(requestedName).replace(/[^a-zA-Z0-9._-]/g, "_")
    : "";
  const filename = safeRequestedName || (
    "battle_" + config.ball1 + "_vs_" + config.ball2 + "_" + timestamp + ".mp4"
  );
  const resolved = path.resolve(OUTPUT_DIR, filename);
  // Ensure the resolved path stays within OUTPUT_DIR
  if (!resolved.startsWith(path.resolve(OUTPUT_DIR) + path.sep) && resolved !== path.resolve(OUTPUT_DIR)) {
    return path.join(OUTPUT_DIR, "battle_" + timestamp + ".mp4");
  }
  return resolved;
}

function buildRenderArgs(config, outputPath) {
  return [
    path.join(__dirname, "render-video.js"),
    config.ball1,
    config.ball2,
    outputPath,
    "--size1",
    String(config.size1),
    "--size2",
    String(config.size2),
    "--speed",
    String(config.speed),
  ];
}

function buildCaption(job, outputPath) {
  return [
    "Готово.",
    "Пара: " + formatBallChoice(job.config.ball1) + " vs " + formatBallChoice(job.config.ball2),
    "Розміри: " + job.config.size1 + "% / " + job.config.size2 + "%",
    "Швидкість: " + job.config.speed + "x",
    "Файл: " + path.basename(outputPath),
  ].join("\n");
}

function extractCommandArgs(text) {
  return text.replace(/^\/[^\s]+/, "").trim();
}

function parseRenderCommandArgs(rawArgs) {
  if (!rawArgs) return null;
  return Render.parseCliArgs(rawArgs.split(/\s+/).filter(Boolean));
}

async function enqueueRender(ctx, config, requestedName) {
  const normalizedConfig = normalizeConfig(config);
  const job = {
    id: nextJobId++,
    chatId: ctx.chat.id,
    config: normalizedConfig,
    outputPath: buildOutputPath(normalizedConfig, requestedName),
  };
  const jobsAhead = renderQueue.length + (activeJob ? 1 : 0);
  renderQueue.push(job);
  await ctx.reply(
    "Задачу #" + job.id + " додано в чергу.\n" +
    "Позиція: " + (jobsAhead + 1) + "\n" +
    "Пара: " + formatBallChoice(job.config.ball1) + " vs " + formatBallChoice(job.config.ball2)
  );
  processQueue().catch(function(err) {
    console.error("Queue processing failed:", err);
  });
}

function consumeLines(buffer, onLine) {
  let pending = buffer;
  let lineBreak = pending.indexOf("\n");
  while (lineBreak >= 0) {
    const line = pending.slice(0, lineBreak).replace(/\r/g, "").trim();
    pending = pending.slice(lineBreak + 1);
    if (line) onLine(line);
    lineBreak = pending.indexOf("\n");
  }
  return pending;
}

async function updateStatusMessage(chatId, messageId, text) {
  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, text);
  } catch (err) {
    if (!String(err.message || err).includes("message is not modified")) {
      console.error("Failed to update status message:", err.message || err);
    }
  }
}

async function processJob(job) {
  const statusMessage = await bot.telegram.sendMessage(
    job.chatId,
    "Почав рендер #" + job.id + ".\n" +
    "Пара: " + formatBallChoice(job.config.ball1) + " vs " + formatBallChoice(job.config.ball2) + "\n" +
    "Розміри: " + job.config.size1 + "% / " + job.config.size2 + "%\n" +
    "Швидкість: " + job.config.speed + "x"
  );

  let winnerKey = "";

  return new Promise(function(resolve, reject) {
    const child = spawn(process.execPath, buildRenderArgs(job.config, job.outputPath), {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutTail = "";
    let stderrTail = "";

    child.stdout.on("data", function(chunk) {
      stdoutTail = consumeLines(stdoutTail + chunk.toString("utf8"), function(line) {
        // Parse winner key from renderer output
        const winnerMatch = line.match(/^WINNER_KEY:(.+)$/);
        if (winnerMatch) {
          winnerKey = winnerMatch[1];
          return;
        }
        if (/^Phase /.test(line) || /Battle ended:/.test(line) || /^Video rendered:/.test(line)) {
          updateStatusMessage(
            job.chatId,
            statusMessage.message_id,
            "Рендер #" + job.id + " виконується...\n" + line
          );
        }
      });
    });

    child.stderr.on("data", function(chunk) {
      stderrTail += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", function(code) {
      if (code === 0) {
        resolve();
      } else {
        const errorText = (stderrTail || stdoutTail || "Unknown error").trim();
        reject(new Error("Renderer exited with code " + code + ": " + errorText));
      }
    });
  }).then(async function() {
    await updateStatusMessage(
      job.chatId,
      statusMessage.message_id,
      "Рендер #" + job.id + " завершено. Надсилаю файл..."
    );
    const caption = buildCaption(job, job.outputPath);
    var videoMsg;
    try {
      videoMsg = await bot.telegram.sendVideo(
        job.chatId,
        { source: job.outputPath },
        { caption: caption, supports_streaming: true }
      );
    } catch (videoError) {
      try {
        videoMsg = await bot.telegram.sendDocument(
          job.chatId,
          { source: job.outputPath },
          { caption: caption }
        );
      } catch (documentError) {
        throw new Error(
          "Не вдалося надіслати файл у Telegram. Video error: " +
          (videoError.message || videoError) +
          ". Document error: " +
          (documentError.message || documentError)
        );
      }
    }

    // Generate public caption for publishing
    const winnerName = winnerKey && G.BALL_TYPES[winnerKey] ? G.BALL_TYPES[winnerKey].name : "";
    const publicCaption = generateCaption(job.config.ball1, job.config.ball2, winnerName);

    // Send approve/reject buttons
    const canPublish = PUBLISH_CHANNEL_ID || tiktok.isConfigured();
    if (canPublish) {
      pendingApprovals.set(job.id, {
        chatId: job.chatId,
        outputPath: job.outputPath,
        caption: caption,
        publicCaption: publicCaption,
        videoMessageId: videoMsg.message_id,
      });
      // Auto-expire approval after 24 hours
      setTimeout(function() { pendingApprovals.delete(job.id); }, 24 * 60 * 60 * 1000).unref();
      const buttons = [];
      if (PUBLISH_CHANNEL_ID && tiktok.isConfigured()) {
        buttons.push([
          Markup.button.callback("TG + TikTok", "approve:" + job.id + ":both"),
        ]);
        buttons.push([
          Markup.button.callback("TG канал", "approve:" + job.id + ":tg"),
          Markup.button.callback("TikTok", "approve:" + job.id + ":tt"),
        ]);
        buttons.push([
          Markup.button.callback("Чернетка TikTok", "approve:" + job.id + ":draft"),
        ]);
      } else if (PUBLISH_CHANNEL_ID) {
        buttons.push([
          Markup.button.callback("TG канал", "approve:" + job.id + ":tg"),
        ]);
      } else if (tiktok.isConfigured()) {
        buttons.push([
          Markup.button.callback("TikTok", "approve:" + job.id + ":tt"),
          Markup.button.callback("Чернетка TikTok", "approve:" + job.id + ":draft"),
        ]);
      }
      buttons.push([
        Markup.button.callback("Відхилити", "reject:" + job.id),
      ]);
      await bot.telegram.sendMessage(
        job.chatId,
        "Опублікувати відео #" + job.id + "?\n\n--- Опис ---\n" + publicCaption,
        Markup.inlineKeyboard(buttons)
      );
    }

    await updateStatusMessage(
      job.chatId,
      statusMessage.message_id,
      "Рендер #" + job.id + " готовий.\n" + path.basename(job.outputPath)
    );
  });
}

async function processQueue() {
  if (activeJob || renderQueue.length === 0) return;
  const job = renderQueue.shift();
  activeJob = job;

  try {
    if (job.type === "challenge") {
      await processChallengeJob(job);
    } else {
      await processJob(job);
    }
  } catch (err) {
    console.error("Render job failed:", err);
    await bot.telegram.sendMessage(
      job.chatId,
      "Рендер #" + job.id + " завершився з помилкою.\n" + (err.message || err)
    );
  } finally {
    activeJob = null;
    if (renderQueue.length > 0) {
      processQueue().catch(function(err) {
        console.error("Queue processing failed:", err);
      });
    }
  }
}

// ══════════════════════════════════════
//  CHALLENGE JOB
// ══════════════════════════════════════
async function processChallengeJob(job) {
  const statusMessage = await bot.telegram.sendMessage(
    job.chatId,
    "Challenge #" + job.id + " починається.\n" +
    "Куля: " + formatBallChoice(job.ballKey) + "\n" +
    "Розмір: " + job.options.size + "%, Швидкість: " + job.options.speed + "x"
  );

  return new Promise(function(resolve, reject) {
    const args = [
      path.join(__dirname, "render-challenge.js"),
      job.ballKey,
      job.outputPath,
      "--size", String(job.options.size),
      "--speed", String(job.options.speed),
    ];
    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutTail = "";
    let stderrTail = "";

    child.stdout.on("data", function(chunk) {
      stdoutTail = consumeLines(stdoutTail + chunk.toString("utf8"), function(line) {
        if (/^Phase /.test(line) || /Challenge ended/.test(line) || /^Done!/.test(line)) {
          updateStatusMessage(job.chatId, statusMessage.message_id,
            "Challenge #" + job.id + " виконується...\n" + line);
        }
      });
    });
    child.stderr.on("data", function(c) { stderrTail += c.toString("utf8"); });
    child.on("error", reject);
    child.on("close", function(code) {
      if (code === 0) resolve();
      else reject(new Error("Renderer exited with code " + code + ": " + (stderrTail || stdoutTail || "").trim()));
    });
  }).then(async function() {
    await updateStatusMessage(job.chatId, statusMessage.message_id,
      "Challenge #" + job.id + " готовий. Надсилаю...");

    const caption = [
      "Challenge готово!",
      "Куля: " + formatBallChoice(job.ballKey),
      "Розмір: " + job.options.size + "%, Швидкість: " + job.options.speed + "x",
      "Файл: " + path.basename(job.outputPath),
    ].join("\n");

    var videoMsg;
    try {
      videoMsg = await bot.telegram.sendVideo(job.chatId, { source: job.outputPath },
        { caption: caption, supports_streaming: true });
    } catch (e) {
      videoMsg = await bot.telegram.sendDocument(job.chatId, { source: job.outputPath }, { caption: caption });
    }

    const canPublish = PUBLISH_CHANNEL_ID || tiktok.isConfigured();
    if (canPublish) {
      pendingApprovals.set(job.id, {
        chatId: job.chatId,
        outputPath: job.outputPath,
        caption: caption,
        publicCaption: caption,
        videoMessageId: videoMsg.message_id,
      });
      setTimeout(function() { pendingApprovals.delete(job.id); }, 24 * 60 * 60 * 1000).unref();

      const buttons = [];
      if (PUBLISH_CHANNEL_ID && tiktok.isConfigured()) {
        buttons.push([Markup.button.callback("TG + TikTok", "approve:" + job.id + ":both")]);
        buttons.push([
          Markup.button.callback("TG канал", "approve:" + job.id + ":tg"),
          Markup.button.callback("TikTok", "approve:" + job.id + ":tt"),
        ]);
        buttons.push([Markup.button.callback("Чернетка TikTok", "approve:" + job.id + ":draft")]);
      } else if (PUBLISH_CHANNEL_ID) {
        buttons.push([Markup.button.callback("TG канал", "approve:" + job.id + ":tg")]);
      } else if (tiktok.isConfigured()) {
        buttons.push([
          Markup.button.callback("TikTok", "approve:" + job.id + ":tt"),
          Markup.button.callback("Чернетка TikTok", "approve:" + job.id + ":draft"),
        ]);
      }
      buttons.push([Markup.button.callback("Відхилити", "reject:" + job.id)]);
      await bot.telegram.sendMessage(job.chatId,
        "Опублікувати Challenge #" + job.id + "?",
        Markup.inlineKeyboard(buttons));
    }

    await updateStatusMessage(job.chatId, statusMessage.message_id,
      "Challenge #" + job.id + " готовий.\n" + path.basename(job.outputPath));
  });
}

async function enqueueChallenge(ctx, ballKey, options) {
  const opts = {
    size: Challenge.normalizeOptions({ size: options.size }).size,
    speed: Challenge.normalizeOptions({ speed: options.speed }).speed,
  };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(OUTPUT_DIR, "challenge_" + ballKey + "_" + timestamp + ".mp4");
  const job = {
    id: nextJobId++,
    chatId: ctx.chat.id,
    type: "challenge",
    ballKey: ballKey,
    options: opts,
    outputPath: outputPath,
  };
  const jobsAhead = renderQueue.length + (activeJob ? 1 : 0);
  renderQueue.push(job);
  await ctx.reply(
    "Challenge #" + job.id + " додано в чергу.\n" +
    "Позиція: " + (jobsAhead + 1) + "\n" +
    "Куля: " + formatBallChoice(ballKey)
  );
  processQueue().catch(function(err) { console.error("Queue error:", err); });
}

bot.use(async function(ctx, next) {
  if (isChatAllowed(ctx)) {
    return next();
  }
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery("Цей чат не дозволений для бота.", { show_alert: true });
    return;
  }
  await ctx.reply("Цей чат не дозволений для бота.");
});

bot.start(async function(ctx) {
  resetSession(ctx.chat.id);
  await ctx.reply(
    "Бот для Math Balls Battle готовий.\n" +
    "Команди:\n" +
    "/new - новий рендер через кнопки\n" +
    "/render - рендер поточної конфігурації\n" +
    "/render ball1 ball2 --size1 120 --size2 90 --speed 1.5 - швидкий запуск\n" +
    "/balls - список кульок\n" +
    "/status - конфігурація і стан черги\n" +
    "/cancel - скинути конфігурацію"
  );
  await showBallPicker(ctx, "ball1", 0);
});

bot.command("help", async function(ctx) {
  await ctx.reply(
    "Використання:\n" +
    "/new - вибрати кульки і налаштування кнопками\n" +
    "/render - запустити рендер поточної конфігурації\n" +
    "/render multiplication factorial --size1 110 --size2 90 --speed 1.4\n" +
    "/balls - всі доступні id\n" +
    "/status - поточна конфігурація та черга\n" +
    "/cancel - скинути поточний вибір"
  );
});

bot.command("balls", async function(ctx) {
  const lines = BALL_KEYS.map(function(key) {
    const type = G.BALL_TYPES[key];
    return key + " - " + type.name;
  });
  await ctx.reply("Доступні кульки:\n" + lines.join("\n"));
});

bot.command("challenge", async function(ctx) {
  resetChallengeSession(ctx.chat.id);
  const session = getChallengeSession(ctx.chat.id);
  await ctx.reply("Вибери кульку для Challenge:", buildChallengeBallPicker(0));
});

// ── Challenge button actions ──

bot.action("ch_cancel", async function(ctx) {
  resetChallengeSession(ctx.chat.id);
  await ctx.answerCbQuery("Скасовано.");
  await ctx.editMessageText("Challenge скасовано. /challenge — почати знову.");
});

bot.action("ch_reset", async function(ctx) {
  resetChallengeSession(ctx.chat.id);
  await ctx.answerCbQuery("Скинуто.");
  await ctx.reply("Вибери кульку для Challenge:", buildChallengeBallPicker(0));
});

bot.action("ch_change", async function(ctx) {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Вибери кульку:", buildChallengeBallPicker(0));
});

bot.action(/^ch_page:(\d+)$/, async function(ctx) {
  const page = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageText("Вибери кульку:", buildChallengeBallPicker(page));
});

bot.action(/^ch_pick:([a-z0-9_]+)$/, async function(ctx) {
  const key = ctx.match[1];
  if (!G.BALL_TYPES[key]) {
    await ctx.answerCbQuery("Невідома кулька.", { show_alert: true });
    return;
  }
  const session = getChallengeSession(ctx.chat.id);
  session.ball = key;
  await ctx.answerCbQuery("Кульку вибрано.");
  await showChallengeMenu(ctx, session);
});

bot.action(/^ch_adjust:(size|speed):(-?\d+(?:\.\d+)?)$/, async function(ctx) {
  const field = ctx.match[1];
  const delta = Number(ctx.match[2]);
  const session = getChallengeSession(ctx.chat.id);
  if (field === "size") {
    session.size = Challenge.normalizeOptions({ size: session.size + delta }).size;
  } else {
    session.speed = Challenge.normalizeOptions({ speed: session.speed + delta }).speed;
  }
  await ctx.answerCbQuery("Оновлено.");
  await showChallengeMenu(ctx, session);
});

bot.action("ch_render", async function(ctx) {
  const session = getChallengeSession(ctx.chat.id);
  if (!session.ball) {
    await ctx.answerCbQuery("Спочатку вибери кульку.", { show_alert: true });
    return;
  }
  await ctx.answerCbQuery("Додаю в чергу...");
  await enqueueChallenge(ctx, session.ball, { size: session.size, speed: session.speed });
});

bot.command("new", async function(ctx) {
  resetSession(ctx.chat.id);
  await showBallPicker(ctx, "ball1", 0);
});

bot.command("cancel", async function(ctx) {
  resetSession(ctx.chat.id);
  await ctx.reply("Поточну конфігурацію скинуто.");
});

bot.command("status", async function(ctx) {
  const session = getSession(ctx.chat.id);
  await ctx.reply(formatConfig(session.config) + "\n\n" + formatQueueStatus());
});

bot.command("render", async function(ctx) {
  const session = getSession(ctx.chat.id);
  const rawArgs = extractCommandArgs(ctx.message.text || "");

  if (!rawArgs) {
    if (!ensureConfigReady(session.config)) {
      await ctx.reply("Спочатку задай пару через /new або передай аргументи прямо в /render.");
      return;
    }
    await enqueueRender(ctx, session.config);
    return;
  }

  let parsed;
  try {
    parsed = parseRenderCommandArgs(rawArgs);
  } catch (err) {
    await ctx.reply("Не вдалося розібрати команду: " + err.message);
    return;
  }

  if (!parsed || !parsed.ball1 || !parsed.ball2) {
    await ctx.reply("Приклад: /render multiplication factorial --size1 120 --size2 90 --speed 1.5");
    return;
  }

  if (!G.BALL_TYPES[parsed.ball1] || !G.BALL_TYPES[parsed.ball2]) {
    await ctx.reply("Одна з кульок невідома. Використай /balls для списку id.");
    return;
  }

  session.config = normalizeConfig({
    ball1: parsed.ball1,
    ball2: parsed.ball2,
    size1: parsed.options.size1,
    size2: parsed.options.size2,
    speed: parsed.options.speed,
  });
  await enqueueRender(ctx, session.config, parsed.output);
});

bot.action("noop", async function(ctx) {
  await ctx.answerCbQuery();
});

bot.action("cancel", async function(ctx) {
  resetSession(ctx.chat.id);
  await ctx.answerCbQuery("Скасовано.");
  await renderInteractiveText(ctx, "Конфігурацію скинуто. Використай /new, щоб почати заново.");
});

bot.action("reset", async function(ctx) {
  resetSession(ctx.chat.id);
  await ctx.answerCbQuery("Скинуто.");
  await showBallPicker(ctx, "ball1", 0);
});

bot.action("swap", async function(ctx) {
  const session = getSession(ctx.chat.id);
  const current = session.config;
  session.config = normalizeConfig({
    ball1: current.ball2,
    ball2: current.ball1,
    size1: current.size2,
    size2: current.size1,
    speed: current.speed,
  });
  await ctx.answerCbQuery("Кульки поміняно місцями.");
  await showConfigMenu(ctx, session);
});

bot.action("render", async function(ctx) {
  const session = getSession(ctx.chat.id);
  if (!ensureConfigReady(session.config)) {
    await ctx.answerCbQuery("Спочатку вибери обидві кульки.", { show_alert: true });
    return;
  }
  await ctx.answerCbQuery("Додаю в чергу...");
  await enqueueRender(ctx, session.config);
});

bot.action(/^page:(ball1|ball2):(\d+)$/, async function(ctx) {
  const stage = ctx.match[1];
  const page = Number(ctx.match[2]);
  await ctx.answerCbQuery();
  await showBallPicker(ctx, stage, page);
});

bot.action(/^pick:(ball1|ball2):([a-z0-9_]+)$/, async function(ctx) {
  const stage = ctx.match[1];
  const key = ctx.match[2];
  const session = getSession(ctx.chat.id);

  if (!G.BALL_TYPES[key]) {
    await ctx.answerCbQuery("Невідома кулька.", { show_alert: true });
    return;
  }

  if (stage === "ball1") {
    session.config.ball1 = key;
    session.config = normalizeConfig(session.config);
    await ctx.answerCbQuery("Першу кульку вибрано.");
    await showBallPicker(ctx, "ball2", 0);
    return;
  }

  session.config.ball2 = key;
  session.config = normalizeConfig(session.config);
  await ctx.answerCbQuery("Другу кульку вибрано.");
  await showConfigMenu(ctx, session);
});

bot.action(/^change:(ball1|ball2)$/, async function(ctx) {
  const stage = ctx.match[1];
  await ctx.answerCbQuery();
  await showBallPicker(ctx, stage, 0);
});

bot.action(/^adjust:(size1|size2|speed):(-?\d+(?:\.\d+)?)$/, async function(ctx) {
  const field = ctx.match[1];
  const delta = Number(ctx.match[2]);
  const session = getSession(ctx.chat.id);
  const nextConfig = {
    ball1: session.config.ball1,
    ball2: session.config.ball2,
    size1: session.config.size1,
    size2: session.config.size2,
    speed: session.config.speed,
  };

  if (field === "speed") {
    nextConfig.speed = clampSpeed(nextConfig.speed + delta);
  } else if (field === "size1") {
    nextConfig.size1 = clampSize(nextConfig.size1 + delta);
  } else {
    nextConfig.size2 = clampSize(nextConfig.size2 + delta);
  }

  session.config = normalizeConfig(nextConfig);
  await ctx.answerCbQuery("Оновлено.");
  await showConfigMenu(ctx, session);
});

// ── Approve / Reject publishing ──
async function publishToTelegram(approval) {
  var pubCaption = approval.publicCaption || approval.caption;
  try {
    await bot.telegram.sendVideo(
      PUBLISH_CHANNEL_ID,
      { source: approval.outputPath },
      { caption: pubCaption, supports_streaming: true }
    );
    return "TG: OK";
  } catch (err) {
    try {
      await bot.telegram.sendDocument(
        PUBLISH_CHANNEL_ID,
        { source: approval.outputPath },
        { caption: pubCaption }
      );
      return "TG: OK (документ)";
    } catch (docErr) {
      return "TG: помилка — " + (docErr.message || docErr);
    }
  }
}

async function publishToTikTok(approval) {
  var pubCaption = approval.publicCaption || approval.caption;
  try {
    const result = await tiktok.publishVideo(approval.outputPath, pubCaption);
    if (result.status === "PUBLISH_COMPLETE") {
      return "TikTok: опубліковано ✓";
    }
    return "TikTok: обробляється (publish_id: " + result.publishId + ")";
  } catch (err) {
    return "TikTok: помилка — " + (err.message || err);
  }
}

async function draftToTikTok(approval) {
  var pubCaption = approval.publicCaption || approval.caption;
  try {
    const result = await tiktok.draftVideo(approval.outputPath, pubCaption);
    if (result.status === "SEND_TO_USER_INBOX") {
      return "TikTok чернетка: відправлено в inbox ✓\nВідкрий TikTok → Inbox → опублікуй вручну";
    }
    return "TikTok чернетка: " + result.status + " (publish_id: " + result.publishId + ")";
  } catch (err) {
    return "TikTok чернетка: помилка — " + (err.message || err);
  }
}

bot.action(/^approve:(\d+):(tg|tt|both|draft)$/, async function(ctx) {
  const jobId = Number(ctx.match[1]);
  const target = ctx.match[2];
  const approval = pendingApprovals.get(jobId);

  if (!approval) {
    await ctx.answerCbQuery("Це відео вже оброблено або не знайдено.", { show_alert: true });
    return;
  }

  pendingApprovals.delete(jobId);

  if (target === "draft") {
    await ctx.answerCbQuery("Відправляю в чернетки...");
    await ctx.editMessageText("Відео #" + jobId + " — відправляю в TikTok inbox...");
    const result = await draftToTikTok(approval);
    await ctx.editMessageText("Відео #" + jobId + " — " + result);
    return;
  }

  await ctx.answerCbQuery("Публікую...");
  await ctx.editMessageText("Відео #" + jobId + " — публікую...");

  const results = [];
  if (target === "tg" || target === "both") {
    results.push(await publishToTelegram(approval));
  }
  if (target === "tt" || target === "both") {
    results.push(await publishToTikTok(approval));
  }

  await ctx.editMessageText("Відео #" + jobId + " — результат:\n" + results.join("\n"));
});

bot.action(/^reject:(\d+)$/, async function(ctx) {
  const jobId = Number(ctx.match[1]);
  pendingApprovals.delete(jobId);
  await ctx.answerCbQuery("Відхилено.");
  await ctx.editMessageText("Відео #" + jobId + " відхилено. Не буде опубліковано.");
});

// ── TikTok OAuth via Telegram bot (with PKCE S256) ──
const crypto = require("crypto");
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || "";
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || "";
const TIKTOK_REDIRECT_URI = "https://detemen.github.io/callback";
const TIKTOK_SCOPES = "user.info.basic,video.publish,video.upload";

const tiktokAuthSessions = new Map(); // chatId -> { verifier, expiresAt }

// Generate PKCE code_verifier (43-128 chars, unreserved chars)
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString("base64url").substring(0, 96);
}

// Generate PKCE code_challenge = BASE64URL(SHA256(code_verifier))
function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function httpsPostForm(hostname, reqPath, params) {
  return new Promise(function(resolve, reject) {
    var data = querystring.stringify(params);
    var req = require("https").request({
      hostname: hostname,
      port: 443,
      path: reqPath,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    }, function(res) {
      var buf = "";
      res.on("data", function(chunk) { buf += chunk; });
      res.on("end", function() {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error("Invalid JSON: " + buf)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function updateEnvTokens(accessToken, refreshToken) {
  var envPath = path.join(__dirname, ".env");
  var tmpPath = envPath + ".tmp." + process.pid;
  var content = fs.readFileSync(envPath, "utf8");
  content = content.replace(/^TIKTOK_ACCESS_TOKEN=.*$/m, "TIKTOK_ACCESS_TOKEN=" + accessToken);
  content = content.replace(/^TIKTOK_REFRESH_TOKEN=.*$/m, "TIKTOK_REFRESH_TOKEN=" + refreshToken);
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, envPath);
}

async function exchangeTikTokCode(code, chatId) {
  var session = tiktokAuthSessions.get(String(chatId));
  if (!session) throw new Error("No auth session. Run /tiktok_auth first.");
  tiktokAuthSessions.delete(String(chatId));

  var tokenRes = await httpsPostForm("open.tiktokapis.com", "/v2/oauth/token/", {
    client_key: TIKTOK_CLIENT_KEY,
    client_secret: TIKTOK_CLIENT_SECRET,
    code: code,
    grant_type: "authorization_code",
    redirect_uri: TIKTOK_REDIRECT_URI,
    code_verifier: session.verifier,
  });

  if (tokenRes.error || !tokenRes.access_token) {
    var errMsg = tokenRes.error_description || tokenRes.error || JSON.stringify(tokenRes);
    await bot.telegram.sendMessage(chatId, "TikTok token exchange failed: " + errMsg);
    return;
  }

  updateEnvTokens(tokenRes.access_token, tokenRes.refresh_token);
  process.env.TIKTOK_ACCESS_TOKEN = tokenRes.access_token;
  process.env.TIKTOK_REFRESH_TOKEN = tokenRes.refresh_token;

  var expiresHours = Math.round((tokenRes.expires_in || 86400) / 3600);
  await bot.telegram.sendMessage(chatId,
    "TikTok successfully authorized!\n" +
    "Access token expires in: " + expiresHours + " hours\n" +
    "Tokens saved to .env. Auto-refresh enabled."
  );
}

bot.command("tiktok_auth", async function(ctx) {
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    await ctx.reply("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET not set in .env");
    return;
  }

  // Generate fresh PKCE pair for this auth session (per-chat)
  var verifier = generateCodeVerifier();
  tiktokAuthSessions.set(String(ctx.chat.id), { verifier: verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
  var codeChallenge = generateCodeChallenge(verifier);

  var authUrl =
    "https://www.tiktok.com/v2/auth/authorize/" +
    "?client_key=" + TIKTOK_CLIENT_KEY +
    "&response_type=code" +
    "&scope=" + TIKTOK_SCOPES +
    "&redirect_uri=" + encodeURIComponent(TIKTOK_REDIRECT_URI) +
    "&state=mathballs" +
    "&code_challenge=" + codeChallenge +
    "&code_challenge_method=S256";

  await ctx.reply(
    "Відкрий це посилання для авторизації TikTok:\n\n" + authUrl + "\n\n" +
    "Після авторизації ти побачиш код на сторінці.\n" +
    "Скопіюй його і надішли сюди командою:\n" +
    "/tiktok_code КОД"
  );
});

bot.command("tiktok_code", async function(ctx) {
  var rawArgs = extractCommandArgs(ctx.message.text || "").trim();
  if (!rawArgs) {
    await ctx.reply("Використання: /tiktok_code КОД\n\nСпочатку виконай /tiktok_auth щоб отримати посилання.");
    return;
  }

  var authSession = tiktokAuthSessions.get(String(ctx.chat.id));
  if (!authSession) {
    await ctx.reply("Спочатку виконай /tiktok_auth щоб почати авторизацію.");
    return;
  }
  if (Date.now() > authSession.expiresAt) {
    tiktokAuthSessions.delete(String(ctx.chat.id));
    await ctx.reply("Час авторизації вийшов (10 хв). Запусти /tiktok_auth ще раз.");
    return;
  }

  await ctx.reply("Обмінюю код на токени...");

  try {
    await exchangeTikTokCode(rawArgs, ctx.chat.id);
  } catch (err) {
    await ctx.reply("TikTok auth error: " + err.message);
  }
});

bot.catch(function(err, ctx) {
  console.error("Telegram bot error:", err);
  if (ctx && ctx.chat && ctx.reply) {
    ctx.reply("Сталася помилка: " + (err.message || err)).catch(function() {});
  }
});

async function bootstrap() {
  await bot.telegram.setMyCommands([
    { command: "new", description: "Новий батл через кнопки" },
    { command: "render", description: "Запустити батл" },
    { command: "challenge", description: "Challenge — одна кулька vs 3 перешкоди" },
    { command: "balls", description: "Список кульок" },
    { command: "status", description: "Стан черги і конфігурації" },
    { command: "cancel", description: "Скинути конфігурацію" },
    { command: "tiktok_auth", description: "Авторизувати TikTok" },
    { command: "tiktok_code", description: "Ввести код авторизації TikTok" },
    { command: "help", description: "Довідка" },
  ]);
  await bot.launch();
  console.log("Telegram bot started. Output dir:", OUTPUT_DIR);
}

bootstrap().catch(function(err) {
  console.error("Failed to start Telegram bot:", err);
  process.exit(1);
});

process.once("SIGINT", function() {
  bot.stop("SIGINT");
});

process.once("SIGTERM", function() {
  bot.stop("SIGTERM");
});
