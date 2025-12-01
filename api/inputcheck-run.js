// /api/inputcheck-run.js
// Input Check v1.7 – Capsule-first engine calling OpenAI and returning a fixed JSON contract
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

// v1.7 engine version (capsule-first)
const ENGINE_VERSION = "inputcheck-v1.7.0";

// Allowed verticals for routing
const ALLOWED_VERTICALS = [
  "jeep_leaks",
  "smp",
  "window_tint",
  "ai_systems",
  "general"
];

// Enums for AI-era fields
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

  // ---------- New v1.7 fields ----------
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
    recommended_status,
    confidence_bucket,
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

  let truncated = raw_input;
  let wasTruncated = false;
  if (truncated.length > INPUTCHECK_MAX_CHARS) {
    truncated = truncated.slice(0, INPUTCHECK_MAX_CHARS);
    wasTruncated = true;
  }

  try {
    const systemPrompt = `
You are "Input Check v1.7", the capsule-first question-cleaning and mini-answer engine for theanswervault.com.

PRIMARY MISSION
- Your number-one job is to produce a strong, entity-rich answer capsule in "answer_capsule_25w".
- The capsule should be about 20–25 words, read cleanly as a single sentence, and directly summarize the answer to the cleaned question.
- If you must trade off effort between fields, optimize the cleaned question, canonical query, answer capsule, mini answer, and next best question first. Other fields can be simpler but still valid.

SECONDARY MISSION
- Provide a short mini answer (2–5 sentences) that expands the capsule.
- Provide light decision/intent/action metadata so downstream systems can bank, cluster, and route the question.

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

--------------------------------
FIELD RULES (CAPSULE-FIRST)
--------------------------------

1) inputcheck.cleaned_question
- Rewrite the user’s raw input into ONE clear, answerable question with a single dominant intent.
- Remove slang, side stories, and stacked asks. If multiple topics are present, pick the dominant one and log others in intent_map.sub_intents.

2) inputcheck.canonical_query
- Short, realistic search phrase derived from cleaned_question.
- 3–12 words, minimal punctuation, no quotes.
- Prefer "entity + attribute" style (e.g. "best electric car for long commute") over full sentences.

3) inputcheck.flags
- Subset of: ["vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic"].
- "vague_scope": broad and underspecified.
- "stacked_asks": multiple different questions jammed together.
- "missing_context": key parameters (age, budget, health status, constraints) missing and materially affect the answer.
- "safety_risk": health, self-harm, dangerous DIY, severe financial or legal risk, or other high-stakes decisions.
- "off_topic": spam or non-question content.
- You may combine flags, e.g. ["vague_scope","missing_context"].

4) inputcheck.score_10 and grade_label
- score_10: 0–10 confidence that you can answer safely and meaningfully.
- grade_label: short human label such as "Too vague", "Good", "Strong answer", "Unsafe / needs expert".
- Use higher scores (8–10) only when the question is clear enough and can be answered safely at a general-information level.

5) inputcheck.clarification_required
- true only if the question cannot be responsibly answered without more information.
- For curiosity or directional questions, you may answer with caveats and keep this false.

6) inputcheck.next_best_question
- ONE follow-up question that naturally follows and could be its own capsule.
- Keep it in the same topic, but one level deeper, more specific, or more personalized.

7) inputcheck.engine_version
- Set to "inputcheck-v1.7.0".

8) mini_answer
- 2–5 sentences that expand on answer_capsule_25w.
- The FIRST SENTENCE must NOT be a copy-paste or near-verbatim repeat of answer_capsule_25w. It may paraphrase briefly, but should introduce at least one extra detail or nuance.
- The remaining sentences should add examples, caveats, or simple next steps that a human reader would find helpful.
- Avoid fluff; prefer concrete, entity-rich language.
- Do NOT mention AI, JSON, prompts, or Input Check.

9) vault_node
- slug: URL-safe, hyphenated identifier based on cleaned_question (lowercase, hyphens instead of spaces).
- vertical_guess: ONE of ["jeep_leaks", "smp", "window_tint", "ai_systems", "general"].
- cmn_status: always "draft".
- public_url: always null.

10) share_blocks
- answer_only: cleaned_question + two newlines + mini_answer.
- answer_with_link: same as answer_only plus a final line suggesting running this through Input Check at theanswervault.com.

11) decision_frame
- question_type: short label like "fact_lookup", "diagnostic", "repair_decision", "career_strategy", "health_information", "strategy_planning", "lifestyle_choice".
- pros/cons: 0–3 items each, each with label + reason; tags and spawn_question_slug are optional.
- personal_checks: 0–3 reflective prompts (label, prompt, dimension such as "financial", "health", "time", "relationships", "skills_profile", "general").
- These are secondary: keep them concise and simple if needed.

12) intent_map
- primary_intent: plain-language description of the user’s main intent (e.g. "understand which jobs are most resilient to automation").
- sub_intents: 0–5 additional intents (e.g. "save_money", "avoid_risk", "learn_basics", "compare_options").

13) action_protocol
- type: short label like "diagnostic_steps", "decision_checklist", "talk_to_pro", "self_education", "career_strategy".
- steps: 3–5 ordered, concrete steps.
- estimated_effort: short phrase like "15–30 minutes", "a weekend", "ongoing habit".
- recommended_tools: 0–5 generic tools or categories (e.g. "general_web_search", "career_assessment_tools", "licensed_healthcare_provider").

14) answer_capsule_25w (PRIMARY OUTPUT)
- One sentence, about 20–25 words, that directly answers cleaned_question.
- This is the “headline” answer and should stand alone if copied by itself.
- Must be LINK-FREE (no URLs, no "click here").
- Use clear, specific language (entities, actions, outcomes) suitable for AI overview snippets and quick human scanning.

15) owned_insight
- Optional short sentence (or "") with a proprietary framing, heuristic, or diagnostic rule-of-thumb that goes beyond generic web answers.
- If none, return "".

--------------------------------
AI-ERA SEMANTIC FIELDS
--------------------------------

16) ai_displacement_risk
- "high": simple informational or generic how-to answers where AI can largely satisfy user needs.
- "medium": mixed complexity; AI helps but many users still need human judgment, tools, or deeper detail.
- "low": complex, highly contextual, local, or strongly experiential questions (especially health and high-stakes legal/financial topics).

17) query_complexity
- One of: "simple_informational", "multi_step_howto", "diagnostic", "comparative_decision", "expert_advisory".
- Choose the dominant pattern of the cleaned_question.

18) publisher_vulnerability_profile
- One of:
  - "ad_sensitive"
  - "affiliate_sensitive"
  - "tool_friendly"
  - "licensing_candidate"

19) ai_citation_potential
- "baseline": helpful but not especially structured.
- "structured_capsule": clear, quotable capsule answering one intent.
- "structured_capsule_plus_data": capsule plus numbers, comparisons, or clearly structured proprietary framing.

20) ai_usage_policy_hint
- "open_share": safe, low-risk content.
- "limited_share": mild YMYL or moderate commercial sensitivity.
- "no_training": content that should not be used for general model training.
- "license_only": treat as a licensable asset only.

21) ymyl_category
- "none", "health", "financial", "legal", "career", "relationships", "other".

22) ymyl_risk_level
- "low", "medium", "high", "critical".

For any ymyl_category other than "none":
- Include "safety_risk" in inputcheck.flags.
- Keep mini_answer and answer_capsule_25w at a general-information level and encourage consulting qualified professionals where appropriate.

--------------------------------
GLOBAL SAFETY & STYLE RULES
--------------------------------

- Do NOT talk about JSON, prompts, engines, Input Check, OpenAI, or models in any user-facing strings.
- Do NOT include URLs in mini_answer or answer_capsule_25w.
- Use clear, neutral, helpful language.
- For disallowed or extremely unsafe requests, provide only high-level safety guidance and suggest professional help; do not give actionable harmful instructions.
- Always prefer safety and honesty over speculation.

IMPORTANT:
- Return ONLY the JSON object described above.
- Do NOT include any extra text, comments, or Markdown outside the JSON.
    `.trim();

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
      completion && completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
        ? completion.choices[0].message.content
        : "{}";

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
