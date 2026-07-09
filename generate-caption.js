// Caption/description generator for Math Balls Battle videos.
// Generates varied TikTok/Telegram captions from templates.
//
// Usage:
//   const { generateCaption } = require("./generate-caption");
//   const text = generateCaption("multiplication", "factorial", "Factorial");

const G = require("./game-core.js");

// ── Template pools ──

const HOOKS = [
  "Who would win?",
  "Place your bets!",
  "Can {ball1} survive against {ball2}?",
  "This battle is INSANE!",
  "{ball1} vs {ball2} - who wins?",
  "You won't believe who wins this one",
  "The result shocked me",
  "Nobody expected this outcome",
  "This matchup is WILD",
  "Math battle of the century!",
  "The ultimate math showdown!",
  "{ball1} thought it could win...",
  "Wait for it...",
  "I bet you can't guess the winner",
  "Which math power is stronger?",
];

const BATTLE_DESCRIPTIONS = [
  "{ball1} ({desc1}) goes head to head with {ball2} ({desc2})",
  "{ball1} with {desc1} takes on {ball2} with {desc2}",
  "It's {ball1} ({desc1}) versus {ball2} ({desc2})!",
  "{ball1} challenges {ball2} in an epic math duel",
  "Two math titans clash: {ball1} vs {ball2}",
  "The {ball1} ball faces the {ball2} ball in a brutal fight",
];

const WINNER_LINES = [
  "{winner} takes the W!",
  "{winner} absolutely destroyed!",
  "{winner} wins! Did you guess right?",
  "And the winner is... {winner}!",
  "{winner} comes out on top!",
  "Victory goes to {winner}!",
  "{winner} dominates!",
  "{winner} with the clutch win!",
];

const OUTROS = [
  "Follow for more math battles!",
  "Like if you guessed right!",
  "Comment who should fight next!",
  "Drop a comment with your prediction!",
  "Who should battle next? Comment below!",
  "More battles coming soon!",
  "Subscribe for daily math battles!",
  "Which ball is YOUR favorite?",
];

const HASHTAGS = [
  "#mathbattle",
  "#mathballs",
  "#ballbattle",
  "#mathfight",
  "#simulation",
  "#mathgame",
  "#versus",
  "#whowouldwin",
  "#mathisfun",
  "#satisfying",
  "#oddlysatisfying",
  "#viral",
  "#fyp",
  "#foryou",
  "#foryoupage",
  "#math",
  "#physics",
  "#animation",
];

// ── Helpers ──

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = arr.slice().sort(function() { return Math.random() - 0.5; });
  return shuffled.slice(0, n);
}

function fillTemplate(template, vars) {
  var result = template;
  for (var key in vars) {
    result = result.replace(new RegExp("\\{" + key + "\\}", "g"), vars[key]);
  }
  return result;
}

// Short description without Unicode
function shortDesc(key) {
  var desc = G.BALL_TYPES[key].desc;
  return desc
    .replace(/×/g, "x")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/[—–]/g, "-");
}

// ── Main generator ──

function generateCaption(ball1Key, ball2Key, winnerName) {
  var b1 = G.BALL_TYPES[ball1Key];
  var b2 = G.BALL_TYPES[ball2Key];

  var vars = {
    ball1: b1.name,
    ball2: b2.name,
    desc1: shortDesc(ball1Key),
    desc2: shortDesc(ball2Key),
    winner: winnerName || "???",
  };

  var lines = [];

  // Hook (always)
  lines.push(fillTemplate(pick(HOOKS), vars));
  lines.push("");

  // Battle description (~70% chance)
  if (Math.random() < 0.7) {
    lines.push(fillTemplate(pick(BATTLE_DESCRIPTIONS), vars));
    lines.push("");
  }

  // Winner line (if winner known)
  if (winnerName) {
    lines.push(fillTemplate(pick(WINNER_LINES), vars));
    lines.push("");
  }

  // Outro CTA
  lines.push(fillTemplate(pick(OUTROS), vars));
  lines.push("");

  // Hashtags (pick 6-9 random + always include #mathbattle #fyp)
  var mandatoryTags = ["#mathbattle", "#fyp", "#whowouldwin"];
  var optionalTags = HASHTAGS.filter(function(t) { return mandatoryTags.indexOf(t) === -1; });
  var extraCount = 3 + Math.floor(Math.random() * 4); // 3-6 extra
  var tags = mandatoryTags.concat(pickN(optionalTags, extraCount));
  lines.push(tags.join(" "));

  return lines.join("\n");
}

// Generate just hashtags (for short captions)
function generateHashtags(count) {
  var n = count || 7;
  var mandatory = ["#mathbattle", "#fyp"];
  var optional = HASHTAGS.filter(function(t) { return mandatory.indexOf(t) === -1; });
  return mandatory.concat(pickN(optional, n - mandatory.length)).join(" ");
}

module.exports = {
  generateCaption: generateCaption,
  generateHashtags: generateHashtags,
};
