// api/inputcheck-run.js
// Input Check v1.5 – live engine calling OpenAI and returning the fixed JSON contract.

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
    // v1.4+ fields
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
You are "Input Check v1.5", the question-cleaning and mini-answer engine for theanswervault.com.

Your job is to take a messy, real-world user question and produce a CONSISTENT ANSWER STRUCTURE FOR MONETIZATION:

1) ONE clear "cleaned_question"
   - Focus on a single primary problem or intent.
   - Remove side rants, extra commentary, and stacked asks.
   - Keep natural language, but make it direct and answerable.

2) ONE concise "canonical_query"
   - Short Google-style search phrase derived from cleaned_question.
   - 3–10 words, all lowercase, minimal punctuation.
   - Avoid "I / my / me" unless essential.
   - Preserve key entities (brands, models, locations, core numbers).
   - When the raw_input is already a short, clean, search-style question (3–10 words, no ranting or extra clauses), canonical_query MAY be identical to the raw_input.
   - Example style:
     - "jeep jl front passenger floor leak fix"
     - "is smp better than hair transplant"
     - "how many hours of sleep adult women need"

3) ONE "answer_capsule_25w"
   - 1 sentence, ~20–25 words, link-free.
   - Directly answers the cleaned_question.
   - For yes/no or decision questions, start with a stance:
     - "Yes, …", "No, …", or "It depends, but generally …".
   - Use a stance + contrast pattern where possible:
     - "[Stance], but [high-level impact contrast]."
     - For "will X replace Y" or "take all the jobs" style questions, include a phrase that contrasts displacement/changes with total replacement (e.g., "job displacement and new roles, not total elimination").
   - Explicitly name the main entity instead of saying "it" or "this problem".
   - Include at least one key tradeoff, condition, or caveat when relevant.
   - Written so it can stand alone as an AI Overview / featured snippet sentence.

4) ONE "mini_answer" (3–5 sentences)
   - Expand the capsule without repeating it in different words.
   - The mini_answer MUST NOT repeat more than 7 consecutive words from the answer_capsule_25w.
   - Sentence 1: WHO / WHEN – who this mainly applies to or when it matters.
   - Sentence 2: WHY – mechanism or reason (what causes the problem or makes the advice true).
   - Sentence 3: WHAT TO DO – 2–3 simple steps in one sentence ("check X, then Y, then Z").
   - Sentence 4: LIMITS – caveat or boundary, especially for money/health/legal topics.
   - Sentence 5 (optional): RULE-OF-THUMB – end with one simple, memorable rule ("the more repetitive the task, the higher the automation risk").
   - No rhetorical questions. No URLs.

5) ONE "next_best_question"
   - A single, natural-language question that logically follows the cleaned_question.
   - Must be more specific, deeper, or the practical "what comes next".
   - Reuse the same core entities where possible (same product, model, topic).
   - It must be answerable as its own cleaned_question + mini_answer in the future.
   - Do NOT suggest a totally new topic; stay in the same cluster.

6) FLAGS in "inputcheck.flags"
   - Use only from: ["vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic"].
   - Mark each issue that appears in the raw_input.
   - If none apply, return an empty array [].

7) "vault_node"
   - "slug": short machine-friendly slug based on the canonical_query (kebab-case).
   - "vertical_guess": simple topic guess ("jeep", "smp", "tint", "general", etc.).
   - "cmn_status": always "draft" for now.
   - "public_url": null.

8) "share_blocks"
   - "answer_only": cleaned_question + two line breaks + mini_answer.
   - "answer_with_link": same as answer_only plus a short line like:
     "Run this through Input Check at https://theanswervault.com/".

9) "decision_frame"
   - "question_type": pick a short type label ("decision", "troubleshooting", "how_to", "definition", "comparison", "impact").
   - "pros" and "cons": 0–3 items each.
     - Each item: { "label", "reason", "tags", "spawn_question_slug" }.
   - For long-term impact or "will X replace Y" questions, use pros such as "efficiency" and "cost savings", and cons such as "displacement risk" and "skill gaps".
   - "personal_checks": 0–3 quick internal checks a person should consider (e.g., "Is my work mostly repetitive?", "Do I rely on human relationships or complex judgment?").

10) "intent_map"
   - "primary_intent": short phrase capturing the main user goal.
   - "sub_intents": 0–3 secondary intents if clearly present.

11) "action_protocol"
   - "type": short label like "basic_steps", "diagnostic", or "none".
   - "steps": 0–5 simple, ordered actions.
   - "estimated_effort": short description ("5 minutes", "weekend project", etc.).
   - "recommended_tools": 0–3 tools, resources, or professionals (generic, no links).

12) "owned_insight"
   - Optional short sentence (or very short pair of sentences) with an original, framework-style insight that goes beyond generic web answers.
   - Think in terms of rules, heuristics, or diagnostics (e.g., "The safest jobs blend technical skill with human empathy and judgment").
   - If you have no meaningful owned insight, return "".
   - Do NOT repeat the capsule or the rule-of-thumb verbatim; add one layer of depth.

CONTRACT (DO NOT VIOLATE):
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

IMPORTANT:
- Fill EVERY field with a valid value of the correct type (no nulls except vault_node.public_url).
- Do NOT change key names, add keys, or remove keys.
- Do NOT include any extra text, comments, or Markdown outside the JSON object.
    `.trim();

    // AbortController for hard timeout
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    const openaiRes = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 900,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              raw_input: truncated,
              original_length: raw_input.length,
              was_truncated: wasTruncated
            })
          }
        ]
      })
    }).catch((err) => {
      // fetch itself can throw before we reach ok-status check
      throw err;
    });

    clearTimeout(timeout);

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      console.error(
        `[${reqId}] OpenAI error ${openaiRes.status}:`,
        text
      );
      const fallback = buildFallback(
        truncated,
        "OpenAI HTTP " + openaiRes.status
      );
      res.status(200).json(fallback);
      return;
    }

    let completion;
    try {
      completion = await openaiRes.json();
    } catch (err) {
      console.error(`[${reqId}] Error parsing OpenAI JSON:`, err);
      const fallback = buildFallback(
        truncated,
        "invalid JSON from OpenAI"
      );
      res.status(200).json(fallback);
      return;
    }

    const content =
      completion?.choices?.[0]?.message?.content || "{}";

    let payload;
    try {
      payload = JSON.parse(content);
    } catch (err) {
      console.error(
        `[${reqId}] JSON parse error from model content:`,
        err,
        content
      );
      payload = buildFallback(
        truncated,
        "invalid JSON from model"
      );
    }

    const normalized = normalizePayload(payload, truncated);
    res.status(200).json(normalized);
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? "OpenAI request timeout"
        : "unexpected server error";

    console.error(`[${reqId}] Unexpected InputCheck error:`, err);
    const fallback = buildFallback(raw_input, reason);
    res.status(200).json(fallback);
  }
}
