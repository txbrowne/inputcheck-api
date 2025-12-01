// api/inputcheck-run.js
// InputCheck Raptor-3 – raw_input -> answer capsule + mini-answer (AI Overview style)

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL =
  process.env.INPUTCHECK_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const INPUT_MAX_CHARS = parseInt(
  process.env.INPUTCHECK_MAX_CHARS || "2000",
  10
);
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.INPUTCHECK_TIMEOUT_MS || "20000",
  10
);

const ENGINE_VERSION = "inputcheck-raptor-3.0.0";

// ----------------------------
// Helpers
// ----------------------------
function setCorsHeaders(res) {
  // If you ever want to lock this down, replace "*" with your domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function makeRequestId() {
  return (
    "ic_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

// Fallback if OpenAI fails or we hit an internal error
function buildFallback(rawInput, reason, wasTruncated) {
  const safeInput = (rawInput || "").toString().trim();

  const capsule =
    "No answer is available right now because the engine could not complete your request safely. Try again soon or simplify the question.";
  const mini =
    "The capsule engine had a technical issue or timeout while processing this question. If the problem continues, review logs and confirm the API key, model, and network are working.";

  return {
    raw_input: safeInput,
    answer_capsule_25w: capsule,
    mini_answer: mini,
    meta: {
      request_id: null,
      engine_version: ENGINE_VERSION,
      model: OPENAI_MODEL,
      processing_time_ms: null,
      input_length_chars: safeInput.length,
      was_truncated: Boolean(wasTruncated),
      backend_error: true,
      reason: reason || "fallback"
    }
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
    const fallback = buildFallback(
      "",
      "missing OPENAI_API_KEY on server",
      false
    );
    fallback.meta.request_id = reqId;
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

  // Enforce max length to avoid runaway cost / injection
  let truncated = raw_input;
  let wasTruncated = false;
  if (truncated.length > INPUT_MAX_CHARS) {
    truncated = truncated.slice(0, INPUT_MAX_CHARS);
    wasTruncated = true;
  }

  try {
    const systemPrompt = `
You are "InputCheck Raptor-3", a capsule-first AI Overview engine for theanswervault.com.

Your ONLY job for each request:
1) Read the user's raw_input (a messy natural-language question or rant).
2) Generate ONE snippet-ready answer capsule (~20–25 words).
3) Generate ONE short mini-answer (3–5 sentences) that supports and extends the capsule.

You are NOT cleaning or rewriting the question into a separate query string.
Treat raw_input as the question you are answering.

------------------------------------------------
OUTPUT JSON SHAPE
------------------------------------------------
You must return a SINGLE JSON object with EXACTLY this shape:

{
  "answer_capsule_25w": "string",
  "mini_answer": "string"
}

Do NOT add or remove keys.
Do NOT include raw_input, meta, or any other fields.
All fields must be plain strings (never null).
Do NOT include any extra text, comments, or markdown outside the JSON.

------------------------------------------------
ANSWER CAPSULE ("answer_capsule_25w")
------------------------------------------------
- ONE sentence, roughly 20–25 words, that directly answers the question implied by raw_input.
- Write it as if it were the lead sentence of a high-quality Google AI Overview.
- No URLs, no "click here", no site names.

Stance rules for yes/no-style questions:
- If the question is essentially "is/are/can/will/should X ...", start with:
  - "Yes, ..." when the answer is broadly yes;
  - "No, ..." when the answer is broadly no;
  - or "It depends, but generally ..." when nuance is important.
- Include at least one key condition, caveat, or trade-off when relevant.
- Use clear entities ("Jeep Wrangler JL A-pillar", "CBD oil", "intermittent fasting") instead of vague pronouns.

------------------------------------------------
MINI ANSWER ("mini_answer")
------------------------------------------------
- 3–5 short sentences.
- The FIRST sentence must NOT repeat the capsule's main claim in similar wording.
  - It must add new information, such as:
    - the key mechanism,
    - who it applies to,
    - typical timeline,
    - or the main limitation or exception.
- Use the mini_answer to explain:
  - WHY the capsule is true,
  - WHEN it might change,
  - WHO is most affected,
  - and WHAT simple next steps the user should take.
- One main idea per sentence.
- No bullets, no lists, no markdown, no rhetorical questions.
- Do NOT include URLs.

------------------------------------------------
SAFETY & HIGH-STAKES TOPICS
------------------------------------------------
For health, legal, financial, and other safety-sensitive or high-impact topics:
- Keep guidance general and high-level.
- Do NOT provide detailed instructions that enable unsafe, illegal, or irreversible actions.
- Emphasize that individual situations vary (health conditions, jurisdiction, financial situation, skills).
- Encourage consulting qualified professionals (doctors, lawyers, financial advisors, certified technicians) before making major decisions.
- Avoid absolute guarantees; prefer cautious language such as "often", "may", "typically", "in many cases".

Remember:
- Answer directly and clearly.
- Prioritize decision-ready clarity over exhaustive detail.
- Return ONLY the JSON object described above.
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
        max_tokens: 400,
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
        "OpenAI HTTP " + openaiRes.status,
        wasTruncated
      );
      fallback.meta.request_id = reqId;
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
        "invalid JSON from OpenAI",
        wasTruncated
      );
      fallback.meta.request_id = reqId;
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
      const fallback = buildFallback(
        truncated,
        "invalid JSON from model",
        wasTruncated
      );
      fallback.meta.request_id = reqId;
      res.status(200).json(fallback);
      return;
    }

    const capsule = (payload.answer_capsule_25w || "").toString().trim();
    const mini = (payload.mini_answer || "").toString().trim();

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      raw_input,
      answer_capsule_25w: capsule,
      mini_answer: mini,
      meta: {
        request_id: reqId,
        engine_version: ENGINE_VERSION,
        model: OPENAI_MODEL,
        processing_time_ms,
        input_length_chars: raw_input.length,
        was_truncated: wasTruncated,
        backend_error: false,
        reason: ""
      }
    };

    res.status(200).json(responseBody);
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? "OpenAI request timeout"
        : "unexpected server error";

    console.error(`[${reqId}] Unexpected Raptor-3 engine error:`, err);
    const fallback = buildFallback(raw_input, reason, false);
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
