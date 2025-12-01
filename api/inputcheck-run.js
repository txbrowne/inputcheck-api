// api/inputcheck-run.js
// InputCheck Capsule Engine v1 – raw_input -> canonical_query -> answer capsule + mini-answer.

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

const ENGINE_VERSION = "inputcheck-capsule-v1.0.0";

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

// Light normalizer to enforce Google-style query constraints
function normalizeCanonicalQuery(canonical, rawInput) {
  const safeCanonical = (canonical || "").toString().toLowerCase();
  const safeRaw = (rawInput || "").toString();

  // Strip disallowed punctuation, keep letters, numbers, spaces, optional '?'
  let stripped = safeCanonical.replace(/[^a-z0-9\s\?]/g, " ");
  stripped = stripped.replace(/\s+/g, " ").trim();

  // Split words and clamp between 3 and 12 tokens
  let words = stripped.split(" ").filter(Boolean);
  if (words.length === 0) return "";

  if (words.length < 3 && safeRaw) {
    // If too short, rebuild from raw_input in a naive way
    const lower = safeRaw.toLowerCase();
    const rawStripped = lower.replace(/[^a-z0-9\s\?]/g, " ");
    words = rawStripped.split(/\s+/).filter(Boolean).slice(0, 6);
  }

  if (words.length > 12) {
    words = words.slice(0, 12);
  }

  let result = words.join(" ");

  // Enforce at least ~30% shorter than raw_input when possible
  if (safeRaw && result.length > safeRaw.length * 0.8) {
    const shorter = result.split(" ").slice(0, Math.max(3, Math.floor(words.length * 0.6)));
    result = shorter.join(" ");
  }

  // Optional trailing question mark only
  result = result.replace(/\?+/g, "");
  if (/^(is|are|can|will|should|do|does|did|why|how|what|when|where)\b/.test(result)) {
    result = result + "?";
  }

  return result.trim();
}

// Fallback if OpenAI fails
function buildFallback(rawInput, reason, wasTruncated) {
  const safeInput = (rawInput || "").toString().trim();

  // Naive canonical_query: lowercase, strip punctuation, trim to 12 words
  let canonical = "";
  if (safeInput) {
    const lower = safeInput.toLowerCase();
    const stripped = lower.replace(/[^a-z0-9\s\?]/g, " ");
    const words = stripped
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 12);
    canonical = words.join(" ");
  }

  const capsule =
    "No answer is available right now because the engine could not complete your request safely. Try again later or simplify the question.";
  const mini =
    "The capsule engine encountered a technical issue or timeout while processing this question. If it keeps happening, review logs and confirm the API key, model, and network are working correctly.";

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
    const fallback = buildFallback("", "missing OPENAI_API_KEY on server", false);
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
You are "InputCheck Capsule Engine Raptor-3", a capsule-first AI Overview generator for theanswervault.com.

The user message is ALWAYS a JSON object like:
{"raw_input":"...","original_length":123,"was_truncated":false}

Your ONLY job for each request:
1) Read the "raw_input" string from that JSON.
2) Convert it into ONE short Google-style search query called "canonical_query".
3) Answer that canonical query with ONE snippet-ready answer capsule ("answer_capsule_25w") and ONE short "mini_answer".

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "raw_input": "string",
  "canonical_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string"
}

Do NOT add or remove keys.
All fields must be plain strings (never null).
Do NOT include any extra text, comments, or markdown outside this JSON object.

------------------------------------------------
1) RAW INPUT → CANONICAL QUERY (GOOGLE-STYLE)
------------------------------------------------
Treat "canonical_query" as the main question of record.
You MUST base "answer_capsule_25w" and "mini_answer" on "canonical_query", not directly on the full raw_input, except when raw_input contains safety-critical details that must be referenced as caveats.

Rules for "canonical_query":
- MUST be between 3 and 10 words.
- MUST be all lowercase.
- MUST be at least 30% shorter in characters than raw_input, unless raw_input is already under 12 words.
- MUST NOT copy raw_input verbatim or preserve its full sentence structure.
- Use only letters, numbers, spaces, and an optional "?" at the end (no commas, quotes, or other punctuation).
- Keep the main entities (brands, models, locations, conditions) and the core task or comparison.
- Strip filler phrases such as: "basically", "actually", "really", "be honest", "or is it more like", "in the next decade", "if I’m being real".
- For "A vs B" or "A or B" style questions, keep both options in compressed form.
- For clearly time-bound questions, keep only an essential timeframe keyword if it matters (for example "in 10 years" → "next decade" or "2035" if that changes the meaning).

Examples:
- raw_input:
  "Is AI basically going to wipe out most normal office and support jobs in the next decade, or is it more like it just changes what we do and we adapt?"
  canonical_query:
  "will ai eliminate most office jobs"

- raw_input:
  "Is it actually safe to do one of those 48–72 hour water fasts every week to drop weight fast if I already feel tired and don’t really work out?"
  canonical_query:
  "is weekly 72 hour water fast safe"

- raw_input:
  "My Jeep JL passenger floor is soaked after heavy rain even though the top looks fine, what’s the most likely leak and how do I fix it?"
  canonical_query:
  "jeep jl passenger floor wet after rain"

- raw_input:
  "Which is better for hair loss overall, smp or a hair transplant, if I care more about cost and downtime than about it being 100 percent real hair?"
  canonical_query:
  "smp vs hair transplant cost and downtime"

INTERNALLY, always follow this order:
1) Read raw_input.
2) Write "canonical_query" as a short Google-style search phrase.
3) Treat "canonical_query" as the question you are answering.
4) Generate "answer_capsule_25w" and "mini_answer" for that canonical query.

------------------------------------------------
2) ANSWER CAPSULE – 20–25 WORD VERDICT
------------------------------------------------
"answer_capsule_25w":
- ONE sentence, roughly 20–25 words, that directly answers the "canonical_query".
- Write it as if it were the featured snippet for that query on a search result page.
- For yes/no-style queries (starting with "is", "are", "can", "will", "should" and having one dominant claim), start with an explicit stance:
  - "Yes, ..." when the answer is broadly yes.
  - "No, ..." when the answer is broadly no.
  - Or "It depends, but generally ..." when nuance is important.
- Include at least one key condition, trade-off, or caveat when relevant.
- Use clear entities from the canonical_query (for example "weekly 72-hour water fasts", "Jeep Wrangler JL A-pillar leaks") instead of vague pronouns.
- Do NOT include URLs.

------------------------------------------------
3) MINI ANSWER – 3–5 SENTENCES, ALL NEW INFORMATION
------------------------------------------------
"mini_answer":
- 3–5 short sentences.
- The first sentence must NOT restate the capsule’s main claim in similar wording. It must add new information such as:
  - mechanism (how or why it works or fails),
  - who it usually applies to,
  - typical timeframe or intensity,
  - key limitation or risk tier.
- Use the mini_answer to explain:
  - WHY the capsule verdict is true or uncertain,
  - WHEN the answer might change,
  - WHO is most affected or at risk,
  - WHAT simple, sensible next steps a person could take.
- One main idea per sentence; keep sentences straightforward.
- Do NOT use bullets, markdown, or rhetorical questions.
- Do NOT include URLs.

------------------------------------------------
4) SAFETY & TONE
------------------------------------------------
- For health, legal, financial, or safety-sensitive topics:
  - Keep guidance general and high-level.
  - Do NOT provide detailed instructions that could enable unsafe, illegal, or high-risk actions.
  - Emphasize that individual situations vary (health conditions, jurisdiction, financial situation, skill level).
  - Encourage consulting qualified professionals (licensed healthcare providers, lawyers, financial advisors, certified technicians) for important decisions.
- When raw_input includes strong risk factors, you may reference those factors in "mini_answer" as reasons for added caution, even if they are not all repeated in "canonical_query".
- Keep language neutral, clear, and helpful, similar to a high-quality AI Overview.

REMINDER:
Return ONLY the JSON object:

{
  "raw_input": "string",
  "canonical_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string"
}

No extra keys. No markdown. No commentary.
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

    // Normalize outputs
    let canonical = (payload.canonical_query || "").toString().trim();
    canonical = normalizeCanonicalQuery(canonical, raw_input);

    let capsule = (payload.answer_capsule_25w || "").toString().trim();
    let mini = (payload.mini_answer || "").toString().trim();

    if (!capsule) {
      capsule =
        "No definitive capsule is available for this query yet; more context or expert input may be needed before giving a clear overview answer.";
    }

    if (!mini) {
      mini =
        "There is not enough reliable information to expand this answer safely. Consider refining the question or consulting a qualified professional for more specific guidance.";
    }

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      raw_input,
      canonical_query: canonical,
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

    console.error(`[${reqId}] Unexpected Capsule Engine error:`, err);
    const fallback = buildFallback(raw_input, reason, false);
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
