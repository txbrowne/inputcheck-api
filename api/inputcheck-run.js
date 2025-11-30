// api/inputcheck-run.js
// Input Check v1 – live engine calling OpenAI and returning the fixed JSON contract.

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
const ENGINE_VERSION = "inputcheck-v1.0.0";

function setCorsHeaders(res) {
  // If you ever want to lock this down, replace "*" with your domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Small helper to build a safe fallback payload if OpenAI fails
function buildFallback(rawInput, reason) {
  const safeInput = (rawInput || "").toString();
  return {
    inputcheck: {
      cleaned_question: safeInput,
      flags: ["backend_error"],
      score_10: 0,
      grade_label: "Engine unavailable",
      clarification_required: false,
      next_best_question:
        "Try your question again in a moment — the engine had a connection issue.",
      engine_version: ENGINE_VERSION
    },
    mini_answer:
      "Input Check couldn’t reach the engine right now (" +
      reason +
      "). Please try again shortly.",
    vault_node: {
      slug: "inputcheck-backend-error",
      vertical_guess: "general",
      cmn_status: "draft",
      public_url: null
    },
    share_blocks: {
      answer_only:
        "Input Check couldn’t reach the engine right now (" +
        reason +
        "). Please try again shortly.",
      answer_with_link:
        "Input Check couldn’t reach the engine right now (" +
        reason +
        "). Please try again shortly.\n\nRun this again at https://theanswervault.com/"
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
You are "Input Check v1", the question-cleaning and mini-answer engine for theanswervault.com.

Your job is to take a messy, real-world user question and:

1) Produce ONE clear, answerable "cleaned_question" that focuses on a single primary problem/intent.
2) Generate a short, practical "mini_answer" (2–5 sentences) that directly answers the cleaned_question.
3) Suggest ONE "next_best_question" that naturally follows and could be answered as its own Q&A node.
4) Detect any "input viruses" in the question (vague scope, stacked asks, missing context, safety risk, off-topic) and encode them as flags.
5) Provide a simple guess at the vertical/topic and intent for vault routing.

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

EXAMPLE FOR MULTI-ISSUE JEEP QUESTION

Raw input (summary):
"front passenger floor gets soaked, sometimes drips from freedom panel, crazy wind noise after dealer adjustment, they want $2500, is this a Jeep thing?"

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
        max_tokens: 800,
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

    // Ensure engine_version is always present
    if (payload && payload.inputcheck) {
      payload.inputcheck.engine_version =
        payload.inputcheck.engine_version || ENGINE_VERSION;
    }

    res.status(200).json(payload);
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
