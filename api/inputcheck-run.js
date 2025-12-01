// /api/inputcheck-run.js
// Input Check v1.6 – live engine calling OpenAI and returning the fixed JSON contract
// with meta + banking_hint for AnswerVault + miner integration.

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL = process.env.INPUTCHECK_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const INPUTCHECK_MAX_CHARS = parseInt(
  process.env.INPUTCHECK_MAX_CHARS || "2000",
  10
);
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.INPUTCHECK_TIMEOUT_MS || "20000",
  10
);

// v1.6 engine version
const ENGINE_VERSION = "inputcheck-v1.6.0";

// Allowed verticals for routing
const ALLOWED_VERTICALS = [
  "jeep_leaks",
  "smp",
  "window_tint",
  "ai_systems",
  "general"
];

// Enums for new AI-era fields
const ENUM_AI_DISPLACEMENT_RISK = ["low", "medium", "high"];
const ENUM_QUERY_COMPLEXITY = [
  "simple_informational",
  "multi_step_howto",
  "diagnostic",
  "comparative_decision",
  "expert_advisory"
];
const ENUM_PUBLISHER_VULN = [
  "ad_sensitive",
  "affiliate_sensitive",
  "tool_friendly",
  "licensing_candidate"
];
const ENUM_AI_CITATION_POTENTIAL = [
  "baseline",
  "structured_capsule",
  "structured_capsule_plus_data"
];
const ENUM_AI_USAGE_POLICY_HINT = [
  "open_share",
  "limited_share",
  "no_training",
  "license_only"
];
const ENUM_YMYL_CATEGORY = [
  "none",
  "health",
  "financial",
  "legal",
  "career",
  "relationships",
  "other"
];
const ENUM_YMYL_RISK_LEVEL = ["low", "medium", "high", "critical"];

// ----------------------------
// Helpers
// ----------------------------
function setCorsHeaders(res) {
  // You can lock this down later by replacing "*" with a specific origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

// Normalize simple pro/con objects
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
      spawn_question_slug: (item.spawn_question_slug || "").toString().trim()
    };
  });
}

// Normalize personal_checks objects
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

// Normalize vertical_guess to allowed set
function normalizeVerticalGuess(v) {
  const val = (v || "").toString().trim();
  if (!val) return "general";
  const lower = val.toLowerCase();
  if (ALLOWED_VERTICALS.includes(lower)) return lower;
  return "general";
}

// Normalize enum-ish string with default + allowed set
function normalizeEnum(val, allowed, defaultVal) {
  if (typeof val !== "string") return defaultVal;
  const lower = val.toLowerCase().trim();
  if (!allowed.includes(lower)) return defaultVal;
  return lower;
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

  // Minimal, but structurally valid payload – normalizePayload will refine it
  const payload = {
    inputcheck: {
      cleaned_question: cleaned,
      canonical_query: cleaned,
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
    answer_capsule_25w: "",
    owned_insight: "",
    // New v1.6 semantic fields with conservative defaults
    ai_displacement_risk: "medium",
    query_complexity: "expert_advisory",
    publisher_vulnerability_profile: "tool_friendly",
    ai_citation_potential: "baseline",
    ai_usage_policy_hint: "open_share",
    ymyl_category: "none",
    ymyl_risk_level: "low"
  };

  return payload;
}

// Ensure new and existing blocks are always present and minimally sane
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
  } else {
    payload.mini_answer = payload.mini_answer.toString().trim();
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
    payload.vault_node.slug = (
      payload.vault_node.slug || "inputcheck-fallback"
    ).toString();

    payload.vault_node.vertical_guess = normalizeVerticalGuess(
      payload.vault_node.vertical_guess
    );

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
      payload.inputcheck.cleaned_question + "\n\n" + payload.mini_answer;
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

  // ---------- New v1.6 fields ----------

  payload.ai_displacement_risk = normalizeEnum(
    payload.ai_displacement_risk,
    ENUM_AI_DISPLACEMENT_RISK,
    "medium"
  );

  payload.query_complexity = normalizeEnum(
    payload.query_complexity,
    ENUM_QUERY_COMPLEXITY,
    "expert_advisory"
  );

  payload.publisher_vulnerability_profile = normalizeEnum(
    payload.publisher_vulnerability_profile,
    ENUM_PUBLISHER_VULN,
    "tool_friendly"
  );

  payload.ai_citation_potential = normalizeEnum(
    payload.ai_citation_potential,
    ENUM_AI_CITATION_POTENTIAL,
    "baseline"
  );

  payload.ai_usage_policy_hint = normalizeEnum(
    payload.ai_usage_policy_hint,
    ENUM_AI_USAGE_POLICY_HINT,
    "open_share"
  );

  payload.ymyl_category = normalizeEnum(
    payload.ymyl_category,
    ENUM_YMYL_CATEGORY,
    "none"
  );

  payload.ymyl_risk_level = normalizeEnum(
    payload.ymyl_risk_level,
    ENUM_YMYL_RISK_LEVEL,
    "low"
  );

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
    recommended_status, // draft / queued (advisory)
    confidence_bucket, // high / medium / low
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
You are "Input Check v1.6", the question-cleaning and mini-answer engine for theanswervault.com.

Your job is to take a messy, real-world user question and produce a single, stable JSON object that can be banked as a CMN and later surfaced by separate systems.

You operate strictly as the Raptor 3 engine layer:
- You clean and interpret the question.
- You generate the mini answer, answer capsule, and reasoning frames.
- You tag risk and environment semantics.
- You DO NOT make layout, SEO, or monetization decisions. Those belong to downstream systems.

You must output EXACTLY ONE JSON object with EXACTLY this shape:

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
    "vertical_guess": "jeep_leaks | smp | window_tint | ai_systems | general",
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
  "owned_insight": "string",

  "ai_displacement_risk": "low | medium | high",
  "query_complexity": "simple_informational | multi_step_howto | diagnostic | comparative_decision | expert_advisory",
  "publisher_vulnerability_profile": "ad_sensitive | affiliate_sensitive | tool_friendly | licensing_candidate",
  "ai_citation_potential": "baseline | structured_capsule | structured_capsule_plus_data",
  "ai_usage_policy_hint": "open_share | limited_share | no_training | license_only",
  "ymyl_category": "none | health | financial | legal | career | relationships | other",
  "ymyl_risk_level": "low | medium | high | critical"
}

Do NOT add or remove keys.
Do NOT change nesting.
All string fields must be plain strings (no nulls).

FIELD RULES (high level)

1) inputcheck.cleaned_question
- One clear, answerable question focusing on a single primary problem or intent.
- Remove slang, side stories, and stacked asks.

2) inputcheck.canonical_query
- Short, Google-style search phrase derived from cleaned_question.
- 3–12 words, minimal punctuation, no quotes.

3) inputcheck.flags
- Subset of: ["vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic"].
- "safety_risk" for health, self-harm, dangerous DIY, severe financial/legal risk, etc.

4) inputcheck.score_10 and grade_label
- score_10 is 0–10 confidence that you can answer safely and accurately.
- grade_label is a short human label like "Too vague", "Good", "Strong answer", "Unsafe / needs expert".

5) inputcheck.clarification_required
- true only if the question cannot be responsibly answered without more information.

6) inputcheck.next_best_question
- ONE follow-up question that naturally follows and could be its own Q&A node.

7) inputcheck.engine_version
- Set to "inputcheck-v1.6.0".

8) mini_answer
- AI Overview–style answer, 2–5 sentences.
- First sentence directly answers cleaned_question in neutral, factual tone.
- Do NOT mention AI, JSON, prompts, or Input Check.

9) vault_node
- slug: URL-safe, hyphenated identifier based on cleaned_question.
- vertical_guess: ONE of ["jeep_leaks", "smp", "window_tint", "ai_systems", "general"].
- cmn_status: always "draft".
- public_url: always null.

10) share_blocks
- answer_only: cleaned_question + two newlines + mini_answer.
- answer_with_link: same as answer_only plus a final line suggesting running this issue through Input Check at theanswervault.com.

11) decision_frame
- question_type: short label like "diagnostic", "repair_decision", "strategy_planning", "lifestyle_choice".
- pros/cons: 0–5 items each, with label + reason, optional tags, optional spawn_question_slug.
- personal_checks: 0–5 reflective prompts with label, prompt, and dimension (e.g. "financial", "health", "time", "relationships", "general").

12) intent_map
- primary_intent: plain-language description of the user’s main intent.
- sub_intents: 0–5 additional intents (e.g. "save_money", "avoid_risk", "learn_basics", "find_professional_help").

13) action_protocol
- type: short label like "diagnostic_steps", "decision_checklist", "talk_to_pro", "self_education".
- steps: 3–7 ordered, concrete steps.
- estimated_effort: short phrase like "15–30 minutes", "a weekend", "ongoing habit".
- recommended_tools: 0–5 items (generic tools or categories).

14) answer_capsule_25w
- Single sentence, about 20–25 words.
- LINK-FREE (no URLs, no “click here”).
- Direct summary of the answer to cleaned_question.

15) owned_insight
- Optional short sentence (or "") with a proprietary framing, heuristic, or diagnostic rule-of-thumb that goes beyond generic web answers.

NEW AI-ERA SEMANTIC FIELDS

16) ai_displacement_risk
- "high": simple informational or generic how-to where AI can fully satisfy most users.
- "medium": mixed complexity; AI helps but many users still need more detail or tools.
- "low": complex, highly contextual, local, or strongly experiential questions.

17) query_complexity
- One of:
  - "simple_informational"
  - "multi_step_howto"
  - "diagnostic"
  - "comparative_decision"
  - "expert_advisory"
- Choose the dominant pattern of the cleaned_question.

18) publisher_vulnerability_profile
- One of:
  - "ad_sensitive"
  - "affiliate_sensitive"
  - "tool_friendly"
  - "licensing_candidate"
- Choose the most appropriate category for how this CMN would behave in a typical publishing ecosystem.

19) ai_citation_potential
- One of:
  - "baseline"
  - "structured_capsule"
  - "structured_capsule_plus_data"
- Evaluate based on whether you provide a clean capsule and hint at owned data or proprietary frameworks.

20) ai_usage_policy_hint
- One of:
  - "open_share"
  - "limited_share"
  - "no_training"
  - "license_only"
- Choose based on YMYL sensitivity and potential commercial value.

21) ymyl_category
- One of:
  - "none"
  - "health"
  - "financial"
  - "legal"
  - "career"
  - "relationships"
  - "other"

22) ymyl_risk_level
- One of: "low", "medium", "high", "critical".
- "critical": severe potential harm (self-harm, medical emergencies, catastrophic financial/legal impact).
- "high": serious long-term impact.
- "medium": meaningful but manageable impact.
- "low": everyday, low-risk queries.

GLOBAL RULES

- Do NOT talk about JSON, prompts, engines, Input Check, OpenAI, or models in any user-facing strings.
- Do NOT include URLs in mini_answer or answer_capsule_25w.
- Use clear, neutral, helpful language.
- When in doubt, honor safety first: set conservative flags and risk levels.

IMPORTANT:
- Return ONLY the JSON object described above.
- Do NOT include any extra text, comments, or Markdown outside the JSON.
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
