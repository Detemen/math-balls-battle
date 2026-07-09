// One-time OAuth flow to get TikTok access_token + refresh_token.
// Run: node tiktok-auth.js
// Opens a local HTTP server on port 3456, prints the auth URL.
// After you authorize in the browser, tokens are saved to .env automatically.

require("dotenv").config();

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const url = require("url");
const querystring = require("querystring");

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_PORT = 3456;
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || "https://detemen.github.io/callback";

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env first.");
  process.exit(1);
}

// Scopes needed for video upload
const SCOPES = "user.info.basic,video.publish,video.upload";

// PKCE: generate code_verifier and code_challenge (S256)
const codeVerifier = crypto.randomBytes(64).toString("base64url").substring(0, 96);
const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

const authUrl =
  "https://www.tiktok.com/v2/auth/authorize/" +
  "?client_key=" + CLIENT_KEY +
  "&response_type=code" +
  "&scope=" + SCOPES +
  "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
  "&state=mathballs" +
  "&code_challenge=" + codeChallenge +
  "&code_challenge_method=S256";

console.log("\n========================================");
console.log("  TikTok OAuth Authorization (PKCE)");
console.log("========================================\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Authorize the app.");
console.log("3. You'll be redirected back here automatically.\n");

function httpsPostForm(hostname, reqPath, params) {
  return new Promise(function(resolve, reject) {
    const data = querystring.stringify(params);
    const req = https.request({
      hostname: hostname,
      port: 443,
      path: reqPath,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    }, function(res) {
      let buf = "";
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
  const envPath = path.join(__dirname, ".env");
  let content = fs.readFileSync(envPath, "utf8");
  content = content.replace(/^TIKTOK_ACCESS_TOKEN=.*$/m, "TIKTOK_ACCESS_TOKEN=" + accessToken);
  content = content.replace(/^TIKTOK_REFRESH_TOKEN=.*$/m, "TIKTOK_REFRESH_TOKEN=" + refreshToken);
  fs.writeFileSync(envPath, content, "utf8");
}

const server = http.createServer(async function(req, res) {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = parsed.query.code;
  const error = parsed.query.error;

  if (error) {
    res.writeHead(400);
    res.end("Authorization failed: " + error + " — " + (parsed.query.error_description || ""));
    console.error("Authorization failed:", error);
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(400);
    res.end("Missing authorization code.");
    server.close();
    return;
  }

  console.log("Received authorization code. Exchanging for tokens...");

  try {
    const tokenRes = await httpsPostForm("open.tiktokapis.com", "/v2/oauth/token/", {
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code: code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    if (tokenRes.error || !tokenRes.access_token) {
      const errMsg = tokenRes.error_description || tokenRes.error || JSON.stringify(tokenRes);
      res.writeHead(500);
      res.end("Token exchange failed: " + errMsg);
      console.error("Token exchange failed:", errMsg);
      server.close();
      return;
    }

    const accessToken = tokenRes.access_token;
    const refreshToken = tokenRes.refresh_token;
    const expiresIn = tokenRes.expires_in;

    // Save to .env
    updateEnvTokens(accessToken, refreshToken);

    console.log("\nTokens saved to .env!");
    console.log("  access_token expires in: " + Math.round(expiresIn / 3600) + " hours");
    console.log("  refresh_token: saved (use to renew access_token)\n");

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<html><body style='font-family:Arial;text-align:center;padding:60px'>" +
      "<h1>Authorization successful!</h1>" +
      "<p>Tokens saved to .env. You can close this tab.</p>" +
      "</body></html>"
    );
  } catch (err) {
    res.writeHead(500);
    res.end("Error: " + err.message);
    console.error("Error:", err);
  }

  setTimeout(function() { server.close(); }, 1000);
});

server.listen(REDIRECT_PORT, function() {
  console.log("Waiting for callback on http://localhost:" + REDIRECT_PORT + "/callback ...\n");
});
