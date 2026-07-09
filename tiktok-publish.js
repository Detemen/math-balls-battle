// TikTok video publishing module.
// Uses Content Posting API v2 — direct post, FILE_UPLOAD flow.
//
// Usage:
//   const tiktok = require("./tiktok-publish");
//   await tiktok.publishVideo("/path/to/video.mp4", "My caption #math");

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const querystring = require("querystring");

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || "";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || "";
let ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || "";
let REFRESH_TOKEN = process.env.TIKTOK_REFRESH_TOKEN || "";

// Chunk limits per TikTok API docs
const MIN_CHUNK_SIZE = 5 * 1024 * 1024;   // 5 MB minimum (except single-chunk files under 5 MB)
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;  // 64 MB maximum per chunk

function isConfigured() {
  return Boolean(CLIENT_KEY && CLIENT_SECRET && ACCESS_TOKEN);
}

// ── Generic HTTPS helpers ──

function httpsRequestJSON(options, body) {
  return new Promise(function(resolve, reject) {
    const req = https.request(options, function(res) {
      let buf = "";
      res.on("data", function(chunk) { buf += chunk; });
      res.on("end", function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsPostForm(hostname, reqPath, params) {
  var data = querystring.stringify(params);
  return httpsRequestJSON({
    hostname: hostname,
    port: 443,
    path: reqPath,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(data),
    },
  }, data);
}

// ── OAuth Token Management ──

async function refreshAccessToken() {
  if (!REFRESH_TOKEN) {
    throw new Error("No refresh_token. Run: node tiktok-auth.js");
  }

  var res = await httpsPostForm("open.tiktokapis.com", "/v2/oauth/token/", {
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
  });

  if (res.data && res.data.access_token) {
    ACCESS_TOKEN = res.data.access_token;
    if (res.data.refresh_token) {
      REFRESH_TOKEN = res.data.refresh_token;
    }
    updateEnvTokens(ACCESS_TOKEN, REFRESH_TOKEN);
    return ACCESS_TOKEN;
  }

  throw new Error("Token refresh failed: " + JSON.stringify(res.data));
}

function updateEnvTokens(accessToken, refreshToken) {
  var envPath = path.join(__dirname, ".env");
  try {
    var tmpPath = envPath + ".tmp." + process.pid;
    var content = fs.readFileSync(envPath, "utf8");
    content = content.replace(/^TIKTOK_ACCESS_TOKEN=.*$/m, "TIKTOK_ACCESS_TOKEN=" + accessToken);
    content = content.replace(/^TIKTOK_REFRESH_TOKEN=.*$/m, "TIKTOK_REFRESH_TOKEN=" + refreshToken);
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, envPath);
  } catch (err) {
    console.warn("Warning: could not persist tokens to .env:", err.message);
  }
}

// Retry a request once after refreshing an expired token
async function withTokenRefresh(fn) {
  var res = await fn();
  var errCode = res.data && res.data.error ? res.data.error.code : "";
  if (errCode === "access_token_invalid" || errCode === "token_not_authorized") {
    await refreshAccessToken();
    res = await fn();
  }
  return res;
}

// ── Creator Info — query allowed privacy levels and capabilities ──

async function queryCreatorInfo() {
  var res = await withTokenRefresh(function() {
    return httpsRequestJSON({
      hostname: "open.tiktokapis.com",
      port: 443,
      path: "/v2/post/publish/creator_info/query/",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + ACCESS_TOKEN,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": 2,
      },
    }, "{}");
  });

  if (!res.data || !res.data.data) {
    throw new Error("creator_info query failed: " + JSON.stringify(res.data));
  }

  return res.data.data;
}

// ── Step 1: Initialize video upload ──

async function initUpload(videoSize, caption, privacyLevel) {
  // Chunk sizing per API docs: min 5 MB, max 64 MB; single chunk if file < 5 MB
  var chunkSize = videoSize < MIN_CHUNK_SIZE
    ? videoSize
    : Math.min(MAX_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, videoSize));
  var totalChunks = Math.ceil(videoSize / chunkSize);

  // Title max 2200 UTF-16 code units
  var title = caption.length > 2200 ? caption.substring(0, 2200) : caption;

  var body = JSON.stringify({
    post_info: {
      title: title,
      privacy_level: privacyLevel || "PUBLIC_TO_EVERYONE",
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      is_aigc: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  });

  var res = await withTokenRefresh(function() {
    return httpsRequestJSON({
      hostname: "open.tiktokapis.com",
      port: 443,
      path: "/v2/post/publish/video/init/",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + ACCESS_TOKEN,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": Buffer.byteLength(body),
      },
    }, body);
  });

  if (!res.data || !res.data.data || !res.data.data.upload_url) {
    var errCode = res.data && res.data.error ? res.data.error.code : "";
    var errMsg = res.data && res.data.error ? res.data.error.message : JSON.stringify(res.data);
    throw new Error("Init upload failed [" + errCode + "]: " + errMsg);
  }

  return {
    publishId: res.data.data.publish_id,
    uploadUrl: res.data.data.upload_url,
    chunkSize: chunkSize,
    totalChunks: totalChunks,
  };
}

// ── Step 2: Upload video file in chunks ──

async function uploadFile(uploadUrl, filePath, chunkSize, totalChunks) {
  var fileBuffer = fs.readFileSync(filePath);
  var totalSize = fileBuffer.length;
  var parsed = new URL(uploadUrl);

  for (var i = 0; i < totalChunks; i++) {
    var start = i * chunkSize;
    var end = Math.min(start + chunkSize, totalSize);
    var chunk = fileBuffer.slice(start, end);

    var res = await new Promise(function(resolve, reject) {
      // NOTE: Do NOT add Authorization header — upload_url is pre-signed
      var req = https.request({
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": chunk.length,
          "Content-Range": "bytes " + start + "-" + (end - 1) + "/" + totalSize,
        },
      }, function(res) {
        var buf = "";
        res.on("data", function(c) { buf += c; });
        res.on("end", function() { resolve({ status: res.statusCode, data: buf }); });
      });
      req.on("error", reject);
      req.write(chunk);
      req.end();
    });

    // 206 = partial (more chunks), 201 = complete
    if (res.status !== 206 && res.status !== 201 && res.status !== 200) {
      throw new Error("Upload chunk " + (i + 1) + "/" + totalChunks +
        " failed (HTTP " + res.status + "): " + res.data);
    }
  }
}

// ── Step 3: Poll publish status ──

async function pollStatus(publishId) {
  var body = JSON.stringify({ publish_id: publishId });

  var terminalStatuses = ["PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX"];
  var lastStatus = "PROCESSING_UPLOAD";

  // Poll up to 12 times with 5s intervals = 60s total
  for (var i = 0; i < 12; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });

    var res = await httpsRequestJSON({
      hostname: "open.tiktokapis.com",
      port: 443,
      path: "/v2/post/publish/status/fetch/",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + ACCESS_TOKEN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, body);

    if (res.data && res.data.data && res.data.data.status) {
      lastStatus = res.data.data.status;
      if (lastStatus === "FAILED") {
        var reason = res.data.data.fail_reason || JSON.stringify(res.data.data);
        throw new Error("TikTok publish failed: " + reason);
      }
      if (terminalStatuses.indexOf(lastStatus) !== -1) break;
    }
  }

  return lastStatus;
}

// ── Draft: send video to TikTok inbox (user publishes manually from app) ──

async function draftVideo(filePath, caption) {
  if (!isConfigured()) {
    throw new Error("TikTok not configured. Set TIKTOK_ACCESS_TOKEN in .env (run: node tiktok-auth.js)");
  }

  var stat = fs.statSync(filePath);
  var videoSize = stat.size;

  var chunkSize = videoSize < MIN_CHUNK_SIZE ? videoSize : Math.min(MAX_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, videoSize));
  var totalChunks = Math.ceil(videoSize / chunkSize);
  var title = caption.length > 2200 ? caption.substring(0, 2200) : caption;

  var body = JSON.stringify({
    post_info: {
      title: title,
      privacy_level: "SELF_ONLY",
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  });

  // Inbox endpoint — sends to creator's draft inbox
  var res = await withTokenRefresh(function() {
    return httpsRequestJSON({
      hostname: "open.tiktokapis.com",
      port: 443,
      path: "/v2/post/publish/inbox/video/init/",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + ACCESS_TOKEN,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": Buffer.byteLength(body),
      },
    }, body);
  });

  console.log("TikTok draft: init response:", JSON.stringify(res.data));
  if (!res.data || !res.data.data || !res.data.data.upload_url) {
    var errCode = res.data && res.data.error ? res.data.error.code : "";
    var errMsg = res.data && res.data.error ? res.data.error.message : JSON.stringify(res.data);
    throw new Error("Draft init failed [" + errCode + "]: " + errMsg);
  }

  var init = {
    publishId: res.data.data.publish_id,
    uploadUrl: res.data.data.upload_url,
    chunkSize: chunkSize,
    totalChunks: totalChunks,
  };

  await uploadFile(init.uploadUrl, filePath, init.chunkSize, init.totalChunks);
  console.log("TikTok draft: file uploaded (" + init.totalChunks + " chunk(s))");

  // Poll until SEND_TO_USER_INBOX or FAILED
  var status = await pollStatus(init.publishId);
  console.log("TikTok draft: final status:", status);

  return { publishId: init.publishId, status: status };
}

// ── Main: publish video to TikTok ──

async function publishVideo(filePath, caption) {
  if (!isConfigured()) {
    throw new Error("TikTok not configured. Set TIKTOK_ACCESS_TOKEN in .env (run: node tiktok-auth.js)");
  }

  var stat = fs.statSync(filePath);
  var videoSize = stat.size;

  // Query creator info to pick an allowed privacy level
  var privacyLevel = "PUBLIC_TO_EVERYONE";
  try {
    var creatorInfo = await queryCreatorInfo();
    var allowed = creatorInfo.privacy_level_options || [];
    if (allowed.length > 0 && allowed.indexOf(privacyLevel) === -1) {
      privacyLevel = allowed[0];
      console.log("TikTok: privacy level adjusted to", privacyLevel, "(app may be unaudited)");
    }
  } catch (err) {
    console.warn("TikTok: could not query creator info, using default privacy level:", err.message);
  }

  // Step 1: Init
  var init = await initUpload(videoSize, caption, privacyLevel);
  console.log("TikTok: upload initialized, publish_id:", init.publishId);

  // Step 2: Upload
  await uploadFile(init.uploadUrl, filePath, init.chunkSize, init.totalChunks);
  console.log("TikTok: file uploaded (" + init.totalChunks + " chunk(s))");

  // Step 3: Poll status
  var status = await pollStatus(init.publishId);
  console.log("TikTok: final status:", status);

  return { publishId: init.publishId, status: status };
}

module.exports = {
  isConfigured: isConfigured,
  publishVideo: publishVideo,
  draftVideo: draftVideo,
  refreshAccessToken: refreshAccessToken,
  queryCreatorInfo: queryCreatorInfo,
};
