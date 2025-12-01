// api/query-condense.js
// Query Condenser v1 – turns messy natural language into a short Google-style query.

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL =
  process.env.QUERYCONDENSE_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const INPUT_MAX_CHARS = parseInt(
  process.env.QUERYCONDENSE_MAX_CHARS || "2000",
  10
);
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.QUERYCONDENSE_TIMEOUT_MS || "15000",
  10
);

const ENGINE_VERSION = "query-condenser-v1.0.0";

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
    "qc_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

// Simple fallback condenser if OpenAI fails
function buildFallback(rawInput, reason) {
  const safeInput = (rawInput || "").toString().trim();

  if (!safeInput) {
    return {
      canonical_query: "",
      meta: {
        request_id: null,
        engine_version: ENGINE_VERSION,
        model: OPENAI_MODEL,
        processing_time_ms: null,
        input_length_chars: 0,
        was_truncated: false,
        backend_error: true,
        reason: reason || "empty input"
      }
    };
  }

  // naive normalization: lowercase, strip most punctuation, compress whitespace
  const lower = safeInput.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9\s\?\-]/g, " ");
  const words = stripped
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  const canonical = words.join(" ");

  return {
    canonical_query: canonical,
    meta: {
      request_id: null,
      engine_version: ENGINE_VERSION,
      model: OPENAI_MODEL,
      processing_time_ms: null,
      input_length_chars: safeInput.length,
      was_truncated: safeInput.length > INPUT_MAX_CHARS,
      backend_error: true,
      reason: reason || "fallback condenser used"
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
    const fallback = buildFallback("", "missing OPENAI_API_KEY on server");
    // inject request_id into meta
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
You are "Query Condenser v1", a tiny engine that converts messy natural language questions into short, search-style Google queries.

Your ONLY job:
- Read the user's raw_input.
- Produce ONE short canonical search query that a user would realistically type into Google to get a good answer.

Rules for "canonical_query":
- 3–12 words.
- All lowercase.
- No punctuation except spaces and an optional question mark.
- Use generic language, not "I" / "my", unless absolutely necessary for meaning.
- Always keep the main entities and task or comparison.
- Remove emotional language, side stories, and extra details unless they materially change the intent.

Examples:
- raw_input: "Why does the front passenger floor of my 2019 Jeep JL keep getting soaked after storms even though the dealer said they fixed the leak?"
  → canonical_query: "jeep jl 2019 passenger floor wet after rain"

- raw_input: "At almost 40 with kids and a full-time job, is it too late to pivot into AI or learn coding seriously?"
  → canonical_query: "is it too late to learn coding at 40"

- raw_input: "For thinning hair, is SMP or a hair transplant actually the smarter move when you factor cost and downtime?"
  → canonical_query: "smp vs hair transplant cost and downtime"

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "canonical_query": "string"
}

Do NOT add or remove keys.
Do NOT include any explanations, comments, or markdown.
Return ONLY the JSON object.
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
        max_tokens: 150,
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
        "invalid JSON from OpenAI"
      );
      fallback.meta.request_id = reqId;
      res.status(200).json(fallback);
      return;
    }

    const content = completion?.choices?.[0]?.message?.content || "{}";

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
      fallback.meta.request_id = reqId;
      res.status(200).json(fallback);
      return;
    }

    const canonical = (payload.canonical_query || "").toString().trim();

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      canonical_query: canonical,
      meta: {
        request_id: reqId,
        engine_version: ENGINE_VERSION,
        model: OPENAI_MODEL,
        processing_time_ms,
        input_length_chars: raw_input.length,
        was_truncated: wasTruncated,
        backend_error: false
      }
    };

    res.status(200).json(responseBody);
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? "OpenAI request timeout"
        : "unexpected server error";

    console.error(`[${reqId}] Unexpected Query Condenser error:`, err);
    const fallback = buildFallback(raw_input, reason);
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
