// api/inputcheck-run.js
// Input Check v1.4 – live engine calling OpenAI and returning the fixed JSON contract.

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
const ENGINE_VERSION = "inputcheck-v1.4.0";

// ----------------------------
// Helpers
// ----------------------------
function setCorsHeaders(res) {
  // If you ever want to lock this down, replace "*" with your domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Build a safe fallback payload if OpenAI fails or we hit an internal error
function buildFallback(rawInput, reason) {
  const safeInput = (rawInput || "").toString().trim();
  const cleaned = safeInput || "";

  const mini =
    "Input Check couldn’t reach the engine right now (" +
    reason +
    "). Please try again shortly.";

  const baseText = cleaned + (cleaned ? "\n\n" : "") + mini;

  return {
    inputcheck: {
      cleaned_question: cleaned,
      canonical_query: cleaned, // fallback: mirror cleaned_question
      flags: ["backend_error"],
      score_10: 0,
      grade_label: "Engine unavailable",
      clarification_required: false,
      next_best_question:
        "Try your question again in a moment — the engine had a connection issue.",
      engine_version: ENGINE_VERSION
    },
    mini_answer: mini,
    vault_node: {
      slug: "inputcheck-backend-error",
      vertical_guess: "general",
      cmn_status: "draft",
      public_url: null
    },
    share_blocks: {
      answer_only: baseText,
      answer_with_link:
        baseText +
        "\n\nRun this through Input Check at https://theanswervault.com/"
    },
    decision_frame: {
      question_type: "unknown",
      pros: [],
      cons: [],
      personal_checks: []
    },
    intent_map: {
      primary_intent: cleaned,
      sub_intents: []
    },
    action_protocol: {
      type: "none",
      steps: [],
      estimated_effort: "",
      recommended_tools: []
    },
    // New v1.4 fields
    answer_capsule_25w: "",
    owned_insight: ""
  };
}

// Simple request ID for logging
function makeRequestId() {
  return (
    "ic_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

// Ensure new blocks are always present and minimally sane
function normalizePayload(payload, fallbackBaseQuestion) {
  const baseQuestion = (fallbackBaseQuestion || "").toString();

  if (!payload || typeof payload !== "object") {
    return buildFallback(baseQuestion, "invalid payload shape");
  }

  // ---------- inputcheck ----------
  if (!payload.inputcheck || typeof payload.inputcheck !== "object") {
    payload.inputcheck = {
      cleaned_question: baseQuestion,
      canonical_query: baseQuestion,
      flags: ["backend_error"],
      score_10: 0,
      grade_label: "Engine unavailable",
      clarification_required: false,
      next_best_question:
        "Try your question again in a moment — the engine returned an incomplete result.",
      engine_version: ENGINE_VERSION
    };
  } else {
    payload.inputcheck.cleaned_question =
      (payload.inputcheck.cleaned_question || baseQuestion).toString();

    // Ensure canonical_query exists and is a simple string
    let cq = payload.inputcheck.canonical_query;
    if (typeof cq !== "string" || !cq.trim()) {
      cq = payload.inputcheck.cleaned_question || baseQuestion;
    }
    payload.inputcheck.canonical_query = cq.toString().trim();

    payload.inputcheck.flags = Array.isArray(payload.inputcheck.flags)
      ? payload.inputcheck.flags
      : [];
    payload.inputcheck.score_10 =
      typeof payload.inputcheck.score_10 === "number"
        ? payload.inputcheck.score_10
        : 0;
    payload.inputcheck.grade_label =
      payload.inputcheck.grade_label || "ok";
    payload.inputcheck.clarification_required = Boolean(
      payload.inputcheck.clarification_required
    );
    payload.inputcheck.next_best_question =
      payload.inputcheck.next_best_question || "";
    payload.inputcheck.engine_version =
      payload.inputcheck.engine_version || ENGINE_VERSION;
  }

  // ---------- mini_answer ----------
  if (typeof payload.mini_answer !== "string") {
    payload.mini_answer =
      "No mini answer available due to an engine error. Please run this question again.";
  }

  // ---------- vault_node ----------
  if (!payload.vault_node || typeof payload.vault_node !== "object") {
    payload.vault_node = {
      slug: "inputcheck-fallback",
      vertical_guess: "general",
      cmn_status: "draft",
      public_url: null
    };
  } else {
    payload.vault_node.slug =
      (payload.vault_node.slug || "inputcheck-fallback").toString();
    payload.vault_node.vertical_guess =
      (payload.vault_node.vertical_guess || "general").toString();
    payload.vault_node.cmn_status =
      payload.vault_node.cmn_status || "draft";
    if (
      typeof payload.vault_node.public_url !== "string" &&
      payload.vault_node.public_url !== null
    ) {
      payload.vault_node.public_url = null;
    }
  }

  // ---------- share_blocks ----------
  if (!payload.share_blocks || typeof payload.share_blocks !== "object") {
    const baseText =
      payload.inputcheck.cleaned_question +
      "\n\n" +
      payload.mini_answer;
    payload.share_blocks = {
      answer_only: baseText,
      answer_with_link:
        baseText +
        "\n\nRun this through Input Check at https://theanswervault.com/"
    };
  } else {
    const cqText = payload.inputcheck.cleaned_question;
    const ma = payload.mini_answer;
    const defaultBase = cqText + "\n\n" + ma;

    payload.share_blocks.answer_only =
      payload.share_blocks.answer_only || defaultBase;

    payload.share_blocks.answer_with_link =
      payload.share_blocks.answer_with_link ||
      defaultBase +
        "\n\nRun this through Input Check at https://theanswervault.com/";
  }

  // ---------- decision_frame ----------
  if (!payload.decision_frame || typeof payload.decision_frame !== "object") {
    payload.decision_frame = {
      question_type: "unknown",
      pros: [],
      cons: [],
      personal_checks: []
    };
  } else {
    payload.decision_frame.question_type =
      payload.decision_frame.question_type || "unknown";

    payload.decision_frame.pros = Array.isArray(payload.decision_frame.pros)
      ? payload.decision_frame.pros
      : [];
    payload.decision_frame.cons = Array.isArray(payload.decision_frame.cons)
      ? payload.decision_frame.cons
      : [];
    payload.decision_frame.personal_checks = Array.isArray(
      payload.decision_frame.personal_checks
    )
      ? payload.decision_frame.personal_checks
      : [];
  }

  // ---------- intent_map ----------
  if (!payload.intent_map || typeof payload.intent_map !== "object") {
    payload.intent_map = {
      primary_intent: payload.inputcheck.cleaned_question || baseQuestion,
      sub_intents: []
    };
  } else {
    payload.intent_map.primary_intent =
      payload.intent_map.primary_intent ||
      payload.inputcheck.cleaned_question ||
      baseQuestion ||
      "";
    payload.intent_map.sub_intents = Array.isArray(
      payload.intent_map.sub_intents
    )
      ? payload.intent_map.sub_intents
      : [];
  }

  // ---------- action_protocol ----------
  if (!payload.action_protocol || typeof payload.action_protocol !== "object") {
    payload.action_protocol = {
      type: "none",
      steps: [],
      estimated_effort: "",
      recommended_tools: []
    };
  } else {
    payload.action_protocol.type =
      payload.action_protocol.type || "none";
    payload.action_protocol.steps = Array.isArray(
      payload.action_protocol.steps
    )
      ? payload.action_protocol.steps
      : [];
    payload.action_protocol.estimated_effort =
      payload.action_protocol.estimated_effort || "";
    payload.action_protocol.recommended_tools = Array.isArray(
      payload.action_protocol.recommended_tools
    )
      ? payload.action_protocol.recommended_tools
      : [];
  }

  // ---------- answer_capsule_25w ----------
  if (typeof payload.answer_capsule_25w !== "string") {
    // Simple default: first ~25 words of mini_answer, or cleaned_question
    const source =
      typeof payload.mini_answer === "string" &&
      payload.mini_answer.trim().length > 0
        ? payload.mini_answer.trim()
        : payload.inputcheck.cleaned_question || baseQuestion;

    const words = source.split(/\s+/).slice(0, 25);
    payload.answer_capsule_25w = words.join(" ");
  } else {
    payload.answer_capsule_25w = payload.answer_capsule_25w.toString().trim();
  }

  // ---------- owned_insight ----------
  if (typeof payload.owned_insight !== "string") {
    payload.owned_insight = "";
  } else {
    payload.owned_insight = payload.owned_insight.toString().trim();
  }

  return payload;
}

// ----------------------------
// Main handler
// ----------------------------
export default async function handler(req, res) {
  const reqId = makeRequestId();
  setCorsHeaders(res);

  // Handle browser preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(`[${reqId}] Missing OPENAI_API_KEY`);
    const fallback = buildFallback("", "missing OPENAI_API_KEY on server");
    res.status(200).json(fallback);
    return;
  }

  const body = req.body || {};
  let raw_input = "";

  try {
    raw_input = (body.raw_input || "").toString();
  } catch (err) {
    console.error(`[${reqId}] Invalid raw_input in body:`, err);
    res.status(400).json({ error: "raw_input must be a string" });
    return;
  }

  raw_input = raw_input.trim();

  if (!raw_input) {
    res.status(400).json({ error: "raw_input is required" });
    return;
  }

  // Enforce max length to avoid runaway cost / prompt injection
  let truncated = raw_input;
  let wasTruncated = false;
  if (truncated.length > INPUTCHECK_MAX_CHARS) {
    truncated = truncated.slice(0, INPUTCHECK_MAX_CHARS);
    wasTruncated = true;
  }

  try {
    const systemPrompt = `
You are "Input Check v1.4", the question-cleaning and mini-answer engine for theanswervault.com.

Your job is to take a messy, real-world user question and:

1) Produce ONE clear, answerable "cleaned_question" that focuses on a single primary problem/intent.
2) Produce ONE concise "canonical_query" string that represents how this question would most likely be typed into a Google search box.
3) Generate an AI-Overview-style "mini_answer" (2–5 sentences) that directly answers the cleaned_question.
4) Suggest ONE "next_best_question" that naturally follows and could be answered as its own Q&A node.
5) Detect any "input viruses" in the question (vague scope, stacked asks, missing context, safety risk, off-topic) and encode them as flags.
6) Provide a simple guess at the vertical/topic and intent for vault routing.
7) Build three extra structured layers:
   - "decision_frame" (pros, cons, personal readiness checks),
   - "intent_map" (primary + sub-intents),
   - "action_protocol" (a short, ordered next-steps routine).
8) Create a 25-word "answer_capsule_25w" and an optional "owned_insight" line for deeper, branded context.

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "inputcheck": {
    "cleaned_question": "string",
    "canonical_query": "string",
    "flags": ["vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic"],
    "score_10": 0,
    "grade_label": "string",
    "clarification_required": false,
    "next_best_question": "string",
    "engine_version": "string"
  },
  "mini_answer": "string",
  "vault_node": {
    "slug": "string",
    "vertical_guess": "string",
    "cmn_status": "draft",
    "public_url": null
  },
  "share_blocks": {
    "answer_only": "string",
    "answer_with_link": "string"
  },
  "decision_frame": {
    "question_type": "string",
    "pros": [
      {
        "label": "string",
        "reason": "string",
        "tags": ["string"],
        "spawn_question_slug": "string"
      }
    ],
    "cons": [
      {
        "label": "string",
        "reason": "string",
        "tags": ["string"],
        "spawn_question_slug": "string"
      }
    ],
    "personal_checks": [
      {
        "label": "string",
        "prompt": "string",
        "dimension": "string"
      }
    ]
  },
  "intent_map": {
    "primary_intent": "string",
    "sub_intents": ["string"]
  },
  "action_protocol": {
    "type": "string",
    "steps": ["string"],
    "estimated_effort": "string",
    "recommended_tools": ["string"]
  },
  "answer_capsule_25w": "string",
  "owned_insight": "string"
}

CANONICAL_QUERY RULES

- "canonical_query" is a short, Google-style search phrase derived from the cleaned_question.
- It should look like what a user would actually type into the Google search bar.
- 3–12 words, lower friction, minimal punctuation. Prefer shorter when possible (around 5–9 words).
- Avoid pronouns like "I", "my", "me" unless truly necessary.
- Good examples:
  - "jeep jl front passenger floor leak fix"
  - "is smp better than hair transplant"
  - "how many hours of sleep do adult women need"
- Bad examples:
  - Full sentences with extra commentary.
  - Including "according to inputcheck" or references to the engine.

ANSWER CAPSULE (answer_capsule_25w)

- 1 sentence, roughly 20–25 words (about 120–150 characters).
- Must be LINK-FREE (no URLs, no "click here", no explicit brand plugs unless essential to the fact).
- Directly summarize the same primary intent as cleaned_question in neutral, factual tone.
- For clear yes/no or A-vs-B decisions (questions starting with "is", "are", "can", "will", "should", or "pay off X or invest Y"), start with an explicit stance:
  - "Yes, ..." when the answer is broadly yes.
  - "No, ..." when the answer is broadly no.
  - "It depends, but generally ..." when nuance is required.
- Written so it can be quoted alone as an AI Overview / featured snippet sentence.

OWNED INSIGHT (owned_insight)

- Optional short sentence with an original, branded, or framework-style insight that goes beyond generic web answers.
- If no meaningful owned insight exists, return an empty string "".
- Do NOT repeat the capsule; add something deeper (e.g. a data point, a rule-of-thumb, or a diagnostic heuristic).

MINI ANSWER (mini_answer)

- 2–5 sentences in AI-Overview style.
- Expand on the capsule instead of repeating it in different words.
- Explain WHY the answer is true, WHAT main tradeoffs matter, and WHAT simple next steps the user should consider.
- For personal finance questions, briefly mention:
  - emergency savings (or safety buffer) when relevant,
  - the tradeoff between guaranteed interest saved vs uncertain investment returns,
  - and overall risk level.
- For health, legal, or other high-stakes questions, keep guidance general and recommend consulting a qualified professional.

Other rules (cleaned_question, flags, decision_frame, intent_map, action_protocol, vault_node, share_blocks) follow the same logic as before:
- single primary intent in cleaned_question,
- flags only from the allowed list,
- decision_frame / intent_map / action_protocol populated consistently and concisely.

IMPORTANT:
- Return ONLY the JSON object described above.
- Do NOT include any extra text, commentary, or Markdown outside the JSON.
    `.trim();
