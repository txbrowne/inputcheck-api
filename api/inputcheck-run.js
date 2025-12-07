// api/inputcheck-run.js
// InputCheck Raptor-3.4 – raw_input -> cleaned_question -> google_style_query -> answer capsule + mini-answer.

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

const ENGINE_VERSION = "inputcheck-raptor-3.4.0";

// ----------------------------
// Helpers
// ----------------------------
function setCorsHeaders(res) {
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

// Very small stopword list just to shorten Google-style queries
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "for",
  "with",
  "and",
  "or",
  "is",
  "are",
  "am",
  "be",
  "was",
  "were",
  "do",
  "does",
  "did",
  "on",
  "in",
  "at",
  "from",
  "about",
  "that",
  "this",
  "these",
  "those",
  "my",
  "our",
  "your",
  "their",
  "me",
  "i",
  "we",
  "you",
  "they",
  "just",
  "really",
  "actually",
  "kind",
  "sort",
  "like",
  "best",
  "order",
  "extra",
  "use",
  "using",
  "help",
  "need",
  "want",
  "should",
  "would",
  "could",
  "can",
  "will",
  "tiktok",
  "youtube",
  "reddit",
  "twitter",
  "facebook"
]);

// Build a compressed Google-style query from any source text
function buildGoogleStyleQuery(source) {
  const safe = (source || "").toString().toLowerCase().trim();
  if (!safe) return "";

  const hadQuestionMark = safe.includes("?");
  const stripped = safe.replace(/[^a-z0-9\s]/g, " ");
  const rawWords = stripped.split(/\s+/).filter(Boolean);

  // First pass: drop stopwords
  let kept = rawWords.filter((w) => !STOPWORDS.has(w));

  // If we removed too much, fall back to the first few raw words
  if (kept.length < 3) {
    kept = rawWords.slice(0, 8);
  }

  // Hard cap to keep it short
  kept = kept.slice(0, 10);

  let query = kept.join(" ").trim();
  if (!query) {
    query = rawWords.slice(0, 8).join(" ").trim();
  }

  if (!query) return "";

  if (hadQuestionMark && !query.endsWith("?")) {
    query += "?";
  }

  return query;
}

// Ensure google_style_query is short and not a near-duplicate of the question
function normalizeGoogleQuery(cleanedQuestion, googleRaw) {
  const base = (cleanedQuestion || "").toString().trim();
  const cand = (googleRaw || "").toString().trim();

  if (!base && !cand) return "";

  const baseNorm = base.toLowerCase().replace(/\s+/g, " ").trim();
  const candNorm = cand.toLowerCase().replace(/\s+/g, " ").trim();

  const wordCount = candNorm ? candNorm.split(" ").length : 0;
  const tooLong = wordCount > 10 || candNorm.length > 120;

  const tooSimilar =
    !!candNorm &&
    (candNorm === baseNorm ||
      baseNorm.includes(candNorm) ||
      candNorm.includes(baseNorm));

  if (!candNorm || tooLong || tooSimilar) {
    return buildGoogleStyleQuery(base || cand);
  }

  return candNorm;
}

// Simple slug generator from the Google-style query
function buildSlug(text) {
  const safe = (text || "").toString().toLowerCase().trim();
  if (!safe) return "inputcheck-node";
  return safe
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "inputcheck-node";
}

// Fallback payload if OpenAI fails
function buildFallback(rawInput, reason, wasTruncated) {
  const safeInput = (rawInput || "").toString().trim();
  const cleaned_question = safeInput;
  const google_style_query = buildGoogleStyleQuery(safeInput);
  const url_slug = buildSlug(google_style_query || cleaned_question);

  const capsule =
    "No answer is available right now because the engine could not complete your request safely. Try again in a moment or simplify the question.";
  const mini =
    "The capsule engine had a technical or network issue while processing this question. If the problem continues, review logs and confirm the API key, model, and network configuration.";

  return {
    raw_input: safeInput,
    cleaned_question,
    google_style_query,
    answer_capsule_25w: capsule,
    mini_answer: mini,
    next_best_question:
      "What is the very next detail you would want answered about this question?",
    url_slug,
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

  // Enforce max length
  let truncated = raw_input;
  let wasTruncated = false;
  if (truncated.length > INPUT_MAX_CHARS) {
    truncated = truncated.slice(0, INPUT_MAX_CHARS);
    wasTruncated = true;
  }

  try {
    const systemPrompt = `
You are "InputCheck Raptor-3 Capsule Engine", a capsule-first AI Overview generator for theanswervault.com.

For each request you MUST output a SINGLE JSON object with EXACTLY these keys:

{
  "cleaned_question": "string",
  "google_style_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string",
  "next_best_question": "string",
  "url_slug": "string"
}

Definitions:

- "cleaned_question":
  - One clear, answerable question in plain language.
  - You may trim chatter and platforms ("TikTok says", "my friend says", etc.) but keep essential context (age, condition, constraints) when it changes the answer.

- "google_style_query":
  - A SHORT Google-style search phrase built from the cleaned_question.
  - NOT the full sentence, NOT a rephrased paragraph.
  - 3–10 words, all lowercase.
  - Only letters, numbers, spaces, and an optional question mark at the end.
  - Strip pronouns, filler, and platforms (I, my, me, TikTok, YouTube, etc.).
  - Keep the condition/entity + key decision or comparison.
  - Examples:
    - cleaned_question: "I'm 52 with borderline diabetes and high cholesterol. Is it smarter to push for Ozempic now or stick with lifestyle changes only?"
      google_style_query: "borderline diabetes ozempic vs lifestyle changes"
    - cleaned_question: "I'm 45 with a 6% mortgage and some extra cash each month. Is it smarter to pay extra on the mortgage or invest?"
      google_style_query: "6 percent mortgage vs investing"

- "answer_capsule_25w":
  - ONE sentence, about 20–25 words.
  - Directly answers the cleaned_question / google_style_query.
  - For yes/no-style questions, start with "Yes, ...", "No, ...", or "It depends, but generally ...".
  - Include at least one key condition, trade-off, or caveat.
  - No URLs.

- "mini_answer":
  - 3–5 short sentences.
  - The FIRST sentence must NOT simply restate the capsule.
  - Add new information: mechanism, who it applies to, key limits, or next steps.
  - Explain WHY, WHEN it might change, WHO is most affected, and WHAT the user should do next.
  - No URLs, no bullet points, no markdown.

- "next_best_question":
  - One natural follow-up question that could be its own Q&A node.
  - Target the next decision or detail a careful person would ask.

- "url_slug":
  - A short, hyphenated slug built from the google-style query.
  - Lowercase, words separated by hyphens, no spaces or punctuation.
  - Example: "borderline-diabetes-ozempic-vs-lifestyle-changes".

Safety:
- For health, legal, and financial topics, keep guidance general and recommend consulting qualified professionals for personal decisions.

Return ONLY the JSON object. No markdown, no commentary.
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
        temperature: 0.15,
        top_p: 0.8,
        max_tokens: 500,
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

    // Coerce + backfill fields
    const cleaned_question = (
      payload.cleaned_question || truncated
    )
      .toString()
      .trim();

    const googleRaw = (
      payload.google_style_query || cleaned_question
    )
      .toString()
      .trim();

    const google_style_query = normalizeGoogleQuery(
      cleaned_question,
      googleRaw
    );

    const answer_capsule_25w = (
      payload.answer_capsule_25w ||
      "No capsule answer was generated. Try asking the question more directly or run the engine again."
    )
      .toString()
      .trim();

    const mini_answer = (
      payload.mini_answer ||
      "The engine did not return a full mini answer for this question. Consider re-running the request or simplifying the input for clearer processing."
    )
      .toString()
      .trim();

    const next_best_question = (
      payload.next_best_question ||
      "What is the very next detail you would want answered about this question?"
    )
      .toString()
      .trim();

    const url_slug = buildSlug(
      payload.url_slug || google_style_query || cleaned_question
    );

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      raw_input,
      cleaned_question,
      google_style_query,
      answer_capsule_25w,
      mini_answer,
      next_best_question,
      url_slug,
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
