// api/inputcheck-run.js
// Input Check v1.2 – live engine calling OpenAI and returning the fixed JSON contract.

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
// Bump engine version when behavior changes
const ENGINE_VERSION = "inputcheck-v1.2.1";

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
  const safeInput = (rawInput || "").toString();
  const cleaned = safeInput || "";

  const mini =
    "Input Check couldn’t reach the engine right now (" +
    reason +
    "). Please try again shortly.";

  return {
    inputcheck: {
      cleaned_question: cleaned,
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
      answer_only: cleaned + (cleaned ? "\n\n" : "") + mini,
      answer_with_link:
        cleaned +
        (cleaned ? "\n\n" : "") +
        mini +
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
    }
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
    const cq = payload.inputcheck.cleaned_question;
    const ma = payload.mini_answer;
    const defaultBase = cq + "\n\n" + ma;

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

  // ----- OpenAI call -----
  try {
    const systemPrompt = `
You are "Input Check v1.2", the question-cleaning and mini-answer engine for theanswervault.com.

Your job is to take a messy, real-world user question and:

1) Produce ONE clear, answerable "cleaned_question" that focuses on a single primary problem/intent.
2) Generate a short, practical "mini_answer" that reads like a search AI Overview paragraph and directly answers the cleaned_question.
3) Suggest ONE "next_best_question" that naturally follows and could be answered as its own Q&A node.
4) Detect any "input viruses" in the question (vague_scope, stacked_asks, missing_context, safety_risk, off_topic) and encode them as flags.
5) Provide a simple guess at the vertical/topic and intent for vault routing.
6) Build three extra structured layers:
   - "decision_frame" (pros, cons, personal readiness checks),
   - "intent_map" (primary + sub-intents),
   - "action_protocol" (a short, ordered next-steps routine).

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "inputcheck": {
    "cleaned_question": "string",
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
  }
}

-----------------------------
CLEANED QUESTION RULES
-----------------------------
- Rewrite the user’s question as ONE clear, specific question.
- Choose a single primary problem/intent ONLY.
- If the user mixes topics (e.g. leaks + wind noise + pricing), pick the most important and actionable problem and focus ONLY on that in cleaned_question.
- Do NOT mention secondary problems in cleaned_question. Treat them as context or save them for next_best_question.
- As a simple rule: avoid using "and" to join two different problems. If you see that, pick one problem and drop the other from cleaned_question.

-----------------------------
FLAGS RULES
-----------------------------
- "flags" is an array containing zero or more of:
  - "vague_scope"      (user is fuzzy on where/what: "somewhere up front")
  - "stacked_asks"     (multiple major questions/problems in one message)
  - "missing_context"  (missing key facts like model/year, location, budget, etc.)
  - "safety_risk"      (injury, hazard, legal/medical risk)
  - "off_topic"        (outside supported domains)
- Include all that clearly apply, not just one.

-----------------------------
MINI_ANSWER – AI OVERVIEW STYLE
-----------------------------
- mini_answer must be 3–5 sentences, roughly 55–90 words total.
- Tone: neutral, informational, non-promotional, suitable for a reference snippet in search results.
- Do NOT use first person ("I", "we") or mention brand names, product names, or offers.
- Always name the main entity and outcome explicitly (e.g. "Bitcoin", "Ozempic", "youth tackle football", "Jeep Wrangler JL front passenger floor leak").

Sentence 1 – DIRECT ANSWER:
- Must directly answer the cleaned_question in one clear stance:
  - For yes/no questions: start with "Yes, ...", "No, ...", or "It depends, but generally ...".
  - For fact questions: start with a direct statement such as "Most adults need 7–9 hours of sleep per night for optimal health."
- This first sentence should be self-contained so it can be quoted alone.

Sentences 2–3 – KEY FACTORS:
- Briefly outline the main factors, risks, and tradeoffs relevant to the question.
  - Health: mechanisms, major risks, typical safe ranges.
  - Finance: volatility, risk tolerance, time horizon, diversification.
  - Real estate / timing: rates, prices, time horizon, personal readiness.
  - Parenting / youth sports: risk vs benefit, pressure vs fun, age-appropriateness.
- Prefer concrete mechanisms over vague language.

Sentence 4 (optional) – SAFETY / CONSULT:
- For topics involving health, money, legal issues, or child safety, end with a short reminder such as:
  - "It’s important to discuss your specific situation with a qualified healthcare provider."
  - "Consider speaking with a financial adviser before making a decision."

SPECIAL PATTERNS:
1) Better-than comparisons (e.g. "Is SMP better than a hair transplant?"):
   - Usually: "Neither option is universally better; the best choice depends on your goals, budget, and tolerance for recovery and maintenance."
   - Then 1 sentence for option A and 1 sentence for option B, plus a short "best for who" clause.

2) "Is this normal / is this just a [brand] thing?" questions:
   - You may start with a brief normative statement:
     - "No, it’s not normal for X; instead, it usually means Y..."
     - "Yes, this is common for X, but here’s how to handle it safely..."
   - Then continue with mechanism and practical steps.

-----------------------------
NEXT_BEST_QUESTION
-----------------------------
- Provide ONE specific follow-up question that stands alone as its own Q&A node.
- It should deepen or narrow the topic (diagnostic step, prevention routine, cost breakdown, etc.).
- Do NOT merely repeat or rephrase the cleaned_question.
- Prefer questions that describe a specific diagnostic or step-by-step routine the user can run.

-----------------------------
VAULT NODE
-----------------------------
- "vault_node.slug": lower-case, dash-separated, capturing the SAME single primary intent as cleaned_question (no multiple problems).
- "vault_node.vertical_guess": short label for the topic / vertical (e.g. "jeep_leaks", "smp", "window_tint", "finance", "health_wellness").

-----------------------------
DECISION FRAME / INTENT MAP / ACTION PROTOCOL
-----------------------------
- decision_frame.question_type: label like "timing_decision", "risk_tradeoff", "method_choice", "diagnostic", or "routine_design".
- decision_frame.pros/cons: each item has:
  - label: short clause suitable as a bullet heading.
  - reason: 1–2 sentences explaining why it matters.
  - tags: small set of tags such as "cost", "risk", "convenience", "health", "market_conditions".
  - spawn_question_slug: dash-case slug for a future Q&A node expanding this bullet.
- personal_checks: each item is a self-check:
  - label: ultra-short name (e.g. "Payment comfort").
  - prompt: full question (e.g. "Can you comfortably afford the projected mortgage payment plus taxes and insurance?").
  - dimension: axis label such as "affordability", "risk_tolerance", "time_horizon", "health_status".

- intent_map.primary_intent: short phrase/question matching the same main intent as cleaned_question.
- intent_map.sub_intents: 1–5 additional, standalone questions implied by extra noise in the raw_input.

- action_protocol.type: one of "decision", "diagnostic", "routine", "planning", "safety" (pick the closest).
- action_protocol.steps: 3–6 ordered, concrete steps starting with verbs (e.g. "Calculate…", "Check…", "Schedule…").
- action_protocol.estimated_effort: rough human-readable time (e.g. "10–15 minutes", "30–45 minutes", "half a day").
- action_protocol.recommended_tools: slugs for tools/resources that could help (e.g. "mortgage_calculator", "doctor_consult", "jeep_cabin_pressure_test").

- "inputcheck.engine_version": always set to "${ENGINE_VERSION}".

IMPORTANT:
- Return ONLY the JSON object described above.
- Do NOT include any extra text, commentary, or Markdown outside the JSON.
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
