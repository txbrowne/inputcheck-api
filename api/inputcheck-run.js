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

// Enforce that canonical_query is short and not just the raw_input
function normalizeCanonical(rawInput, canonicalRaw) {
  const base = (rawInput || "").toString().trim();
  const cand = (canonicalRaw || "").toString().trim();

  const baseNorm = base.toLowerCase().replace(/\s+/g, " ").trim();
  const candNorm = cand.toLowerCase().replace(/\s+/g, " ").trim();

  const wordCount = candNorm ? candNorm.split(" ").length : 0;
  const tooLong = wordCount > 12 || candNorm.length > 120;

  const tooSimilar =
    !!candNorm &&
    (candNorm === baseNorm ||
      // if candidate is just a long substring of the original or vice versa
      (baseNorm.includes(candNorm) && wordCount > 8) ||
      candNorm.includes(baseNorm));

  if (!candNorm || tooLong || tooSimilar) {
    // Force a compressed, Google-style query
    return buildCanonicalFromText(base);
  }

  return candNorm;
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
You are "InputCheck Raptor-3 Capsule Engine", a capsule-first AI Overview generator for theanswervault.com.

Your ONLY job for each request:
1) Read the user's raw_input.
2) Convert it into ONE short Google-style search query ("canonical_query").
3) Answer that query with ONE snippet-ready answer capsule (~20–25 words) and ONE short mini-answer (3–5 sentences).

Rules for "canonical_query":
- This is NOT the full question. It is a SHORT search phrase built from the question.
- It must ALWAYS be shorter than raw_input and must never simply copy or lightly rephrase the full sentence.
- 3–10 words, all lowercase.
- Only letters, numbers, spaces, and an optional question mark at the end.
- Strip personal chatter and platforms: remove age, "i / my / me", TikTok, YouTube, etc.
- Keep only: main condition or entity + key decision or problem.
- Example transforms:
  - raw_input: "I’m 52 with borderline diabetes and high cholesterol. TikTok says Ozempic and GLP-1 shots are a shortcut, but my doctor wants me to focus on diet and exercise first. Is it smarter to push for Ozempic now or stick with lifestyle changes only?"
  - canonical_query: "borderline diabetes ozempic vs lifestyle changes"
  - raw_input: "I’m 45 with a 6% mortgage and some extra cash each month. Is it smarter to pay extra on the mortgage or invest?"
  - canonical_query: "6 percent mortgage vs investing"
- If your first draft of canonical_query is more than 10 words OR looks very similar to raw_input, you MUST rewrite it until it is a compact phrase like the examples above.

Rules for "answer_capsule_25w":
- ONE sentence, roughly 20–25 words, that directly answers the canonical_query.
- For yes/no-style questions, start with an explicit stance:
  - "Yes, ...", "No, ...", or "It depends, but generally ...".
- Include at least one key condition, trade-off, or caveat when relevant.
- Use clear entities instead of vague pronouns.
- Do NOT include URLs.

Rules for "mini_answer":
- 3–5 short sentences.
- The FIRST sentence must NOT repeat the capsule's main claim in similar wording. It must add new information such as mechanism, who it applies to, timeline, or key limitation.
- Explain WHY the capsule is true, WHEN it might change, WHO is most affected, and WHAT simple steps the user should take next.
- One main idea per sentence. No bullets, no markdown, no rhetorical questions.
- Do NOT include URLs.

Safety:
- For health, legal, financial, or other high-stakes topics, keep guidance general, avoid detailed how-to instructions, and advise consulting qualified professionals.

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "raw_input": "string",
  "canonical_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string"
}

Do NOT add or remove keys.
All fields must be plain strings (never null).
Do NOT include any extra text, comments, or markdown.
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

    // Coerce and backfill fields
    const canonicalRaw = (payload.canonical_query || "").toString().trim();
    const capsuleRaw = (payload.answer_capsule_25w || "").toString().trim();
    const miniRaw = (payload.mini_answer || "").toString().trim();

    const canonical_query = normalizeCanonical(truncated, canonicalRaw);

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
