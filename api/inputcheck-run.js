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
      engine_version: ENGINE_VERSION,
      backend_error: true
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

// Normalizers for decision_frame arrays
function normalizeProConArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (typeof item === "string") {
      const txt = item.toString().trim();
      return {
        label: txt,
        reason: txt,
        tags: [],
        spawn_question_slug: ""
      };
    }
    return {
      label: (item.label || "").toString().trim(),
      reason: (item.reason || "").toString().trim(),
      tags: Array.isArray(item.tags) ? item.tags : [],
      spawn_question_slug: (item.spawn_question_slug || "")
        .toString()
        .trim()
    };
  });
}

function normalizeChecksArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (typeof item === "string") {
      const txt = item.toString().trim();
      return {
        label: txt,
        prompt: txt,
        dimension: "general"
      };
    }
    return {
      label: (item.label || "").toString().trim(),
      prompt: (item.prompt || "").toString().trim(),
      dimension: (item.dimension || "general").toString().trim()
    };
  });
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
      engine_version: ENGINE_VERSION,
      backend_error: true
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

    // Explicit backend_error boolean for banking/miner logic
    if (typeof payload.inputcheck.backend_error !== "boolean") {
      payload.inputcheck.backend_error = false;
    }
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

    payload.decision_frame.pros = normalizeProConArray(
      payload.decision_frame.pros
    );

    payload.decision_frame.cons = normalizeProConArray(
      payload.decision_frame.cons
    );

    payload.decision_frame.personal_checks = normalizeChecksArray(
      payload.decision_frame.personal_checks
    );
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

// Banking hint helper for Vault Banking API / headless miner
function buildBankingHint(ic) {
  const flags = Array.isArray(ic.flags) ? ic.flags : [];
  const hardFlags = new Set(["safety_risk"]);
  const hardHit = flags.some((f) => hardFlags.has(f));
  const score = typeof ic.score_10 === "number" ? ic.score_10 : 0;

  let confidence_bucket = "low";
  if (score >= 8) confidence_bucket = "high";
  else if (score >= 6) confidence_bucket = "medium";

  let recommended_status = "draft";
  if (!hardHit && score >= 8) recommended_status = "queued";

  return {
    recommended_status,           // draft / queued (advisory)
    confidence_bucket,           // high / medium / low
    auto_bank_recommended: !hardHit && score >= 7,
    reason: hardHit
      ? "Hard flag present (e.g. safety_risk)."
      : `Score ${score}/10 with flags: ${flags.join(", ") || "none"}.`
  };
}

// Build final response with meta + banking_hint
function buildFinalResponse(payload, opts) {
  const { fallbackBaseQuestion, reqId, startTime, wasTruncated, raw_input } =
    opts || {};

  const normalized = normalizePayload(payload, fallbackBaseQuestion || "");

  // If input was truncated, add a flag so miners/banker can be cautious
  if (wasTruncated) {
    normalized.inputcheck.flags = normalized.inputcheck.flags || [];
    if (!normalized.inputcheck.flags.includes("truncated_input")) {
      normalized.inputcheck.flags.push("truncated_input");
    }
  }

  const banking_hint = buildBankingHint(normalized.inputcheck);

  const processing_time_ms =
    typeof startTime === "number" ? Date.now() - startTime : null;

  const meta = {
    request_id: reqId || null,
    engine_version: ENGINE_VERSION,
    model: OPENAI_MODEL,
    processing_time_ms,
    was_truncated: Boolean(wasTruncated),
    input_length_chars:
      typeof raw_input === "string" ? raw_input.length : null
  };

  return {
    ...normalized,
    banking_hint,
    meta
  };
}

// ----------------------------
// Main handler
// ----------------------------
export default async function handler(req, res) {
  const reqId = makeRequestId();
  const startTime = Date.now();
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
    const response = buildFinalResponse(fallback, {
      fallbackBaseQuestion: "",
      reqId,
      startTime,
      wasTruncated: false,
      raw_input: ""
    });
    res.status(200).json(response);
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

You operate as a **capsule-first** engine that turns a messy human question into:
- ONE cleaned, answerable question,
- ONE search-style canonical query,
- ONE snippet-ready answer capsule (~25 words),
- ONE short mini answer,
- PLUS light decision/intent/action structure for downstream tools.

Your output is consumed by:
- A VISUAL INSPECTOR used by analysts (not end users),
- A MINER that banks strong Q&A nodes into AnswerVault,
- Raptor analyzers that optimize content for Google AI Overviews and other AI surfaces.

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

Do NOT add or remove keys.
Do NOT change nesting.
All string fields must be plain strings (never null).
Return ONLY the JSON object with no extra commentary, no backticks, and no Markdown.

------------------------------------------------
PRIORITIES (IN ORDER)
------------------------------------------------
If you need to trade effort between fields, prioritize:

1) inputcheck.cleaned_question  
2) inputcheck.canonical_query  
3) answer_capsule_25w  
4) mini_answer  
5) inputcheck.flags, score_10, clarification_required  
6) intent_map + action_protocol  
7) decision_frame, vault_node, share_blocks, owned_insight  

All fields must still be valid, but these come first in quality.

------------------------------------------------
1) CLEANED QUESTION & CANONICAL QUERY
------------------------------------------------
"cleaned_question":
- Rewrite the raw input into ONE clear, answerable question with a single dominant intent.
- Strip slang, side stories, rants, and stacked asks.
- If multiple topics appear, choose the dominant one; represent secondary goals as sub_intents (see below).

"canonical_query":
- Short, realistic Google-style search phrase derived from cleaned_question.
- 3–12 words, minimal punctuation, no quotes.
- Prefer “entity + attribute/task” phrases, e.g.:
  - "jeep jl passenger floor leak cause"
  - "is smp better than hair transplant"
  - "how many hours sleep adult woman"
- Avoid “I / my / me” unless truly needed; focus on the general problem.

The cleaned_question and canonical_query MUST reflect the same primary intent:
- cleaned_question = natural-language question.
- canonical_query = how a search-heavy user would type it.

------------------------------------------------
2) FLAGS, SCORE, AND CLARIFICATION
------------------------------------------------
"flags": subset of ["vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic"].
- "vague_scope": too broad, fuzzy, or undefined (e.g. “tell me everything about SEO”).
- "stacked_asks": clearly multiple separate questions in one.
- "missing_context": key variables omitted (budget, timeframe, location, health factors, etc.) where answers could change materially.
- "safety_risk": health/self-harm, dangerous DIY, severe financial/legal risk, or other high-stakes decisions.
- "off_topic": spam, non-questions, or nonsense.

"score_10":
- 0–10 rating of how safely and precisely you can answer now.
- 8–10 only if the question is:
  - Focused on one dominant intent,
  - Clear enough for a strong AI Overview–style answer,
  - Safe at general-information level.

"grade_label":
- Short human label summarizing quality, e.g.:
  - "Too vague", "Good", "Strong answer", "Unsafe / needs expert", "Stacked asks".

"clarification_required":
- true ONLY when you should not answer directly without more info (usually serious health/legal/financial cases).
- If you can give a safe, high-level answer with disclaimers, keep this false and use flags + cautious wording instead.

"next_best_question":
- ONE follow-up question that:
  - Stays in the same domain,
  - Goes one level deeper or more specific,
  - Would be valuable as its own Q&A node.
- Examples:
  - From "is dropshipping a good way to make money?" →
    "What are realistic startup costs, timelines, and risk factors for a new dropshipping business?"
  - From "is cbd bad for you?" →
    "What are the most important CBD side effects and medication interactions people should know before using it?"

------------------------------------------------
3) ANSWER CAPSULE & MINI ANSWER (AI OVERVIEW LAYER)
------------------------------------------------
"answer_capsule_25w":
- ONE sentence, roughly 20–25 words, that directly answers cleaned_question.
- LINK-FREE: no URLs, no “click here”, no site names.
- Write it so it can be used as a standalone AI Overview / featured snippet:
  - Clear stance (yes / no / it depends, with nuance),
  - At least one key condition or caveat if relevant,
  - Main trade-off or benefit vs. risk,
  - Use clear entities (“Jeep Wrangler JL A-pillar”, “scalp micropigmentation”, “CBD”) instead of vague pronouns.

"mini_answer":
- 2–5 sentences expanding the capsule.
- FIRST sentence must NOT simply repeat the capsule; add at least one new detail or nuance.
- Remaining sentences:
  - Give short explanations, examples, or scenarios,
  - Highlight key caveats and edge cases,
  - Offer simple, action-oriented next steps aligned with action_protocol.
- Do NOT mention AI, JSON, prompts, or Input Check.
- Do NOT include URLs.

------------------------------------------------
4) VAULT NODE & SHARE BLOCKS
------------------------------------------------
"vault_node":
- "slug": URL-safe, lowercase, hyphenated identifier from cleaned_question, e.g.:
  - "jeep-jl-passenger-floor-leak-cause"
  - "is-smp-better-than-hair-transplant"
- "vertical_guess":
  - Short label for routing, e.g. "jeep_leaks", "smp", "window_tint", "ai_systems", "general".
  - If unsure, use "general".
- "cmn_status": always "draft".
- "public_url": always null.

"share_blocks":
- "answer_only":
  - cleaned_question + "\\n\\n" + mini_answer.
- "answer_with_link":
  - same as answer_only, plus one final line:
    "Run this through Input Check at https://theanswervault.com/"

------------------------------------------------
5) DECISION FRAME & PERSONAL CHECKS
------------------------------------------------
"decision_frame.question_type":
- Short label capturing the question pattern, for example:
  - "fact_lookup", "diagnostic", "repair_decision",
  - "business_strategy", "career_strategy",
  - "health_information", "lifestyle_choice".

"pros" and "cons":
- 0–3 items each.
- "label": short phrase summarizing the point.
- "reason": one short sentence explaining why it matters.
- "tags": optional, only when obvious and helpful (e.g. ["cost"], ["risk"], ["time"]).
- "spawn_question_slug": slug-style follow-up idea this point could generate, or "" if none.

"personal_checks":
- 0–3 prompts a human should ask themselves before acting.
- Each item:
  - "label": short name, e.g. "Budget fit", "Health profile", "Time commitment".
  - "prompt": the reflective question.
  - "dimension": one of "financial", "health", "time", "relationships", "skills_profile", "general".

------------------------------------------------
6) INTENT MAP & ACTION PROTOCOL
------------------------------------------------
"intent_map":
- "primary_intent":
  - Plain-language description of what the user is really trying to achieve.
  - Should align with how an AI Overview would summarize the goal.
- "sub_intents":
  - 0–5 short tags or phrases, e.g.:
    - "save_money", "avoid_risk", "learn_basics",
      "compare_options", "validate_plan", "understand_side_effects".

"action_protocol":
- "type":
  - Short label like "diagnostic_steps", "decision_checklist", "self_education", "talk_to_pro", "business_strategy".
- "steps":
  - 3–5 concrete, ordered steps from first to last, written at a high-level overview depth.
- "estimated_effort":
  - Simple phrase like "15–30 minutes", "a few hours", "a weekend", "ongoing habit".
- "recommended_tools":
  - 0–5 generic tools or categories, e.g.:
    - "general_web_search", "spreadsheet", "licensed_healthcare_provider", "leak_detection_spray", "professional_mechanic".

------------------------------------------------
7) OWNED INSIGHT
------------------------------------------------
"owned_insight":
- Whenever possible, include one short proprietary framing, rule-of-thumb, or heuristic that goes beyond generic web answers.
- Example:
  - "Treat dropshipping as a low-risk lab to test products you later move into higher-margin branded inventory."
- If there is no meaningful proprietary angle, use an empty string "".
- Do NOT repeat the capsule; add depth or a more strategic viewpoint.

------------------------------------------------
GLOBAL STYLE & SAFETY
------------------------------------------------
- Do NOT mention JSON, prompts, engines, Input Check, OpenAI, or models in any user-facing fields.
- Do NOT include URLs in "answer_capsule_25w" or "mini_answer".
- Use clear, neutral, helpful language similar to high-quality Google AI Overview answers.
- For disallowed or highly unsafe requests:
  - Provide only high-level safety guidance,
  - Encourage consulting qualified professionals,
  - Do NOT give detailed harmful instructions.

REMINDER:
Return ONLY the JSON object described above. No extra text, no explanations, no Markdown.
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
        temperature: 0.1,
        top_p: 0.8,
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
      const response = buildFinalResponse(fallback, {
        fallbackBaseQuestion: truncated,
        reqId,
        startTime,
        wasTruncated,
        raw_input
      });
      res.status(200).json(response);
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
      const response = buildFinalResponse(fallback, {
        fallbackBaseQuestion: truncated,
        reqId,
        startTime,
        wasTruncated,
        raw_input
      });
      res.status(200).json(response);
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
      const fallback = buildFallback(
        truncated,
        "invalid JSON from model"
      );
      const response = buildFinalResponse(fallback, {
        fallbackBaseQuestion: truncated,
        reqId,
        startTime,
        wasTruncated,
        raw_input
      });
      res.status(200).json(response);
      return;
    }

    const response = buildFinalResponse(payload, {
      fallbackBaseQuestion: truncated,
      reqId,
      startTime,
      wasTruncated,
      raw_input
    });

    res.status(200).json(response);
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? "OpenAI request timeout"
        : "unexpected server error";

    console.error(`[${reqId}] Unexpected InputCheck error:`, err);
    const fallback = buildFallback(raw_input, reason);
    const response = buildFinalResponse(fallback, {
      fallbackBaseQuestion: raw_input,
      reqId,
      startTime,
      wasTruncated,
      raw_input
    });
    res.status(200).json(response);
  }
}
