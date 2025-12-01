// api/inputcheck-run.js
// Input Check v1.5 – live engine calling OpenAI and returning the fixed JSON contract
// with meta + banking_hint for AnswerVault + miner integration.

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL =
  process.env.INPUTCHECK_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

// Hard guardrails
const INPUTCHECK_MAX_CHARS = parseInt(
  process.env.INPUTCHECK_MAX_CHARS || "2000",
  10
);
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.INPUTCHECK_TIMEOUT_MS || "20000",
  10
);
const ENGINE_VERSION = "inputcheck-v1.5.0";

// Allowed vertical guesses for routing
const ALLOWED_VERTICALS = [
  "jeep_leaks",
  "smp",
  "window_tint",
  "ai_systems",
  "general"
];

// ----------------------------
// Helpers
// ----------------------------
function setCorsHeaders(res) {
  // If you ever want to lock this down, replace "*" with your domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
