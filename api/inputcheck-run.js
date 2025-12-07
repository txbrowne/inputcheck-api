// api/inputcheck-run.js
// InputCheck Raptor-3 Capsule Engine – raw_input -> canonical_query -> answer capsule + mini-answer.

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

const ENGINE_VERSION = "inputcheck-raptor-3.1.0";

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

// Simple canonical query builder used as a fallback
function buildCanonicalFromText(text) {
  const safe = (text || "").toString().trim();
  if (!safe) return "";

  const lower = safe.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9\s\?]/g, " ");
  const words = stripped
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  return words.join(" ");
}

// Fallback if OpenAI fails
function buildFallback(rawInput, reason, wasTruncated) {
  const safeInput = (rawInput || "").toString().trim();
  const canonical = buildCanonicalFromText(safeInput);

  const capsule =
    "No answer is available right now because the engine could not complete your request safely. Try again in a moment or simplify the question.";
  const mini =
    "The capsule engine had a technical or network issue while processing this question. If the problem continues, review logs and confirm the API key, model, and network configuration.";

  return {
    raw_input: safeInput,
    canonical_query: canonical,
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
You are "InputCheck Raptor-3.1 Capsule Engine", a capsule-first AI Overview generator for theanswervault.com.

Your job on every call is strictly three steps, in this order:

1) CANONICAL QUERY (surfacing spine)
   - Read the user's raw_input.
   - Convert it into ONE short Google-style search query called "canonical_query".
   - This is the spine the capsule will answer.

2) ANSWER CAPSULE (PRIMARY ASSET)
   - Based ONLY on the canonical_query, write ONE snippet-ready "answer_capsule_25w".
   - Treat this as the most important output: optimize it first, then build everything else around it.
   - Requirements:
     - Exactly ONE sentence, roughly 20–25 words.
     - Directly answers the canonical_query.
     - For yes/no-style questions (is/are/can/will/should), start with a clear stance:
       - "Yes, ..." when the answer is broadly yes,
       - "No, ..." when the answer is broadly no,
       - or "It depends, but generally ..." when nuance matters.
     - Name the main entity explicitly instead of saying "it" or "this".
     - Include at least one key condition, trade-off, or caveat when relevant.
     - No URLs, no markdown, no lists.

3) MINI ANSWER (SUPPORTING CONTEXT)
   - After the capsule is settled, write ONE "mini_answer" of 3–5 short sentences.
   - The FIRST sentence MUST NOT repeat the capsule's main claim in different words.
     - It should add new information: who this applies to, mechanisms, timelines, or critical limitations.
   - Use the remaining sentences to:
     - Explain WHY the capsule is true,
     - Clarify WHEN it might change,
     - Identify WHO is most affected,
     - Suggest simple WHAT-NEXT steps (2–3 actions in a single sentence).
   - One main idea per sentence. No bullets, no markdown, no URLs, no rhetorical questions.

Rules for "canonical_query":
- Always SHORTER than the raw_input. It must not simply copy the question.
- 3–10 words, all lowercase.
- No commas, quotes, or extra punctuation; only letters, numbers, spaces, and an optional question mark at the end.
- Remove filler like "be honest", "actually", "really", "just", "or is it more like", "everyone is screaming", "basically".
- Strip time fluff unless essential (e.g. "next decade" becomes "long term").
- Keep the main entities (brands, models, locations, key numbers) and the core task or comparison.
- For “A vs B vs C” questions, compress like: "pay 18 percent debt vs buy house vs invest".
- If the raw_input has more than 15 words, the canonical_query should usually be 10 words or fewer.

Safety:
- For health, legal, financial, or other high-stakes topics, keep guidance general, avoid step-by-step instructions, and advise consulting qualified professionals when appropriate.

OUTPUT CONTRACT (DO NOT VIOLATE):

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "raw_input": "string",
  "canonical_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string"
}

Do NOT add or remove keys.
All fields must be plain strings (never null).
Do NOT include any extra text, comments, or markdown outside the JSON object.
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
      // fetch can throw before we reach the status check
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

    // Coerce and backfill fields to keep the contract stable
    const canonicalRaw = (payload.canonical_query || "").toString().trim();
    const capsuleRaw = (payload.answer_capsule_25w || "").toString().trim();
    const miniRaw = (payload.mini_answer || "").toString().trim();

    const canonical_query =
      canonicalRaw || buildCanonicalFromText(truncated);
    const answer_capsule_25w =
      capsuleRaw ||
      "No capsule answer was generated. Try asking the question more directly or run the engine again.";
    const mini_answer =
      miniRaw ||
      "The engine did not return a full mini answer for this question. Consider re-running the request or simplifying the input for clearer processing.";

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      raw_input,
      canonical_query,
      answer_capsule_25w,
      mini_answer,
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

    console.error(`[${reqId}] Unexpected Capsule Engine error:`, err);
    const fallback = buildFallback(raw_input, reason, false);
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
