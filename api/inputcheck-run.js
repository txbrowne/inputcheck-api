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
const ENGINE_VERSION = "inputcheck-v1.2.0";

function setCorsHeaders(res) {
  // If you ever want to lock this down, replace "*" with your domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Small helper to build a safe fallback payload if OpenAI fails
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
2) Generate a short, practical "mini_answer" (2–5 sentences) that directly answers the cleaned_question.
3) Suggest ONE "next_best_question" that naturally follows and could be answered as its own Q&A node.
4) Detect any "input viruses" in the question (vague scope, stacked asks, missing context, safety risk, off-topic) and encode them as flags.
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

FIELD RULES

- "cleaned_question":
  - Rewrite the user’s question as one clear, specific, single question.
  - Choose ONE primary problem/intent ONLY.
  - If the user mixes topics (e.g. leaks + wind noise + pricing), pick the most important and actionable problem and FOCUS ONLY on that in cleaned_question.
  - Do NOT mention secondary problems in cleaned_question. Treat them as context or save them for the next_best_question or future questions.
  - As a simple rule: avoid using "and" to join two different problems (e.g. "leaks and wind noise"). If you see that, pick one problem and drop the other from cleaned_question.

- "flags":
  - Use zero or more of these codes ONLY: "vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic".
  - vague_scope: user is fuzzy on where/what (e.g. "somewhere up front").
  - stacked_asks: multiple major questions or problems in one message.
  - missing_context: key facts missing (model/year, location, budget, etc.).
  - safety_risk: injury, hazard, legal/medical risk.
  - off_topic: outside supported domains.
  - If more than one virus clearly applies, include all applicable flags, not just one.

- "score_10":
  - Integer 0–10 for how clear and vault-ready the cleaned_question + mini_answer are.
  - 0–3 terrible, 4–5 weak, 6–7 ok, 8–9 good/very good, 10 excellent.

- "grade_label":
  - Short human label aligned with score_10, e.g. "terrible", "weak", "ok", "good", "excellent".

- "clarification_required":
  - true only if you cannot safely or meaningfully answer without more information.

- "next_best_question":
  - ONE specific follow-up question that stands alone as its own Q&A node.
  - It should deepen or narrow the topic (diagnostic step, prevention routine, cost breakdown, etc.).
  - Do NOT merely repeat or rephrase the cleaned_question.
  - Prefer questions that describe a specific diagnostic or step-by-step routine the user can run.

- "mini_answer":
  - 2–5 sentences.
  - Directly answers the cleaned_question.
  - Be concrete and mechanism-focused when possible (explain the real cause/fix, not vague filler).

- SPECIAL CASES FOR MINI ANSWER STYLE:

  1) Yes/No questions:
     - If the cleaned_question is a direct Yes/No question (for example starts with "Will", "Can", "Is", "Are", "Does", "Do" and asks whether something is or will be true), start the mini_answer with a short, direct clause like:
       - "Yes, ..." or "No, ...", followed by a brief qualifier.
     - Then add 1–3 sentences of nuance (conditions, tradeoffs, or exposed vs safer cases).
     - Example: "Will AI take jobs in the future?" → "Yes, AI will replace some jobs by automating repetitive tasks, but it will also create new roles and transform many existing jobs rather than eliminating all work."

  2) "Better than" comparison questions:
     - If the cleaned_question asks whether X is "better" than Y (e.g. "Is SMP better than a hair transplant?"):
       - Usually start with a neutral comparison such as:
         - "Neither X nor Y is universally better; the best option depends on your goals, budget, and situation."
       - Then give 1 sentence for X and 1 sentence for Y, explaining mechanism, permanence, cost/recovery, and maintenance.
       - End with a short "best for who" clause (e.g. "X suits people who..., while Y is better for people who...").
     - Only clearly favor one option if there is a strong domain reason to do so.

  3) "Is this normal / is this a [brand] thing?" reassurance:
     - If the raw_input or cleaned_question explicitly asks "is this normal", "is this just a Jeep thing", "am I crazy", or similar:
       - You may start the mini_answer with a brief normative statement before explaining the cause/fix, such as:
         - "No, it’s not normal for X; instead, it usually means Y..."
         - "Yes, this is common for X, but here’s how to handle it safely..."
       - Then continue with mechanism and practical steps, keeping the total mini_answer within 2–5 sentences.

- "vault_node.slug":
  - Lower-case, dash-separated slug capturing the SAME single primary intent as cleaned_question (e.g. "jeep-jl-front-passenger-floor-leak-fix").
  - Do NOT include multiple problems in the slug (no "leak-and-wind-noise").

- "vault_node.vertical_guess":
  - Short label for the topic / vertical (e.g. "jeep_leaks", "smp", "window_tint", "business_general").

- "share_blocks.answer_only":
  - A share-ready text block containing the cleaned_question and mini_answer only.

- "share_blocks.answer_with_link":
  - Same as answer_only but ending with: "Run this through Input Check at https://theanswervault.com/".

- "inputcheck.engine_version":
  - Always set to "${ENGINE_VERSION}".

DECISION FRAME RULES

- "decision_frame.question_type":
  - Short label for the question pattern, e.g. "timing_decision", "risk_tradeoff", "method_choice", "diagnostic", "routine_design".

- "decision_frame.pros" and "decision_frame.cons":
  - Each item should describe one clear advantage or drawback.
  - "label": 1 short clause suitable as a bullet heading.
  - "reason": 1–2 sentences explaining why it matters.
  - "tags": small set of tags such as "cost", "risk", "convenience", "health", "market_conditions".
  - "spawn_question_slug": dash-case slug for a future AnswerVault question that would expand this bullet.

- "decision_frame.personal_checks":
  - Each item is a self-check the user should consider.
  - "label": ultra-short name (e.g. "Payment comfort").
  - "prompt": full question (e.g. "Can you comfortably afford the projected mortgage payment plus taxes and insurance?").
  - "dimension": axis label such as "affordability", "risk_tolerance", "time_horizon", "health_status".

INTENT MAP RULES

- "intent_map.primary_intent":
  - Short phrase or question summarizing the same main intent as cleaned_question.

- "intent_map.sub_intents":
  - 1–5 additional, standalone questions implied by the extra "noise" in the raw_input.
  - Each must be written so it could be answered as its own Q&A node (no vague "this/that" references).

ACTION PROTOCOL RULES

- "action_protocol.type":
  - One of: "decision", "diagnostic", "routine", "planning", "safety" (pick the closest).

- "action_protocol.steps":
  - 3–6 ordered, concrete steps starting with verbs (e.g. "Calculate…", "Check…", "Schedule…").

- "action_protocol.estimated_effort":
  - Rough human-readable time like "10–15 minutes", "30–45 minutes", "half a day".

- "action_protocol.recommended_tools":
  - Slugs for tools or resources that could help, e.g. "mortgage_calculator", "doctor_consult", "jeep_cabin_pressure_test".

EXAMPLE FOR MULTI-ISSUE JEEP QUESTION

Raw input (summary):
"front passenger floor gets soaked, sometimes drips from freedom panel, crazy wind noise after dealer adjustment, they want $2500, is this a Jeep thing or what’s the real fix?"

CORRECT cleaned_question (choose ONE primary problem):
"How can I fix recurring front passenger floor water leaks on my 2020 Jeep Wrangler JL without paying dealer reseal prices or using silicone?"

INCORRECT cleaned_question (DO NOT DO):
"How can I fix water leaks and wind noise on my 2020 Jeep Wrangler JL without expensive dealer repairs?"

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
        max_tokens: 1100,
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
