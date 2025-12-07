// api/inputcheck-run.js
// InputCheck Raptor-3 Capsule Engine v3.1.0
// raw_input  → canonical_query → answer capsule (~25 words) → mini-answer (3–5 sentences)

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
    .slice(0, 10);
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
You are "InputCheck Raptor-3 Capsule Engine", a capsule-first AI Overview generator for theanswervault.com.

Your ONLY job for each request:
1) Read the user's raw_input.
2) Convert it into ONE short Google-style search query ("canonical_query").
3) Answer that query with ONE snippet-ready answer capsule (~20–25 words).
4) Then expand with ONE short mini-answer (3–5 sentences) that adds depth, safety, and next steps.

-------------- CANONICAL_QUERY --------------
"canonical_query" is the compressed Google-style version of the question.

Rules:
- Always SHORTER than raw_input. It must not simply copy the question.
- 3–10 words, all lowercase.
- No commas, quotes, brackets, emojis, or markdown.
- Only letters, numbers, spaces, and an optional "?" at the end.
- Remove filler like "be honest", "actually", "really", "just", "basically", "everyone is screaming", "tik tok keeps saying".
- Remove time fluff unless essential (e.g. "next decade" → "long term").
- Keep main entities (brands, models, locations, job titles, key numbers) and the core verb/decision.
- For multi-part A vs B questions, compress to a single comparison phrase:
  - Example: "pay off 18 percent credit card debt or invest extra cash"
    → "pay 18 percent card debt or invest"
- If your first draft of canonical_query would be identical or nearly identical to raw_input, shorten it by stripping adjectives, side comments, examples, and extra clauses until it fits these rules.

-------------- ANSWER_CAPSULE_25W --------------
"answer_capsule_25w" is a single AI Overview–style sentence.

Rules:
- Exactly ONE sentence, about 20–25 words (rough target, not strict).
- Directly answers the canonical_query.
- For yes/no or will/should questions, start with an explicit stance:
  - "Yes, ..." when the broad answer is yes.
  - "No, ..." when the broad answer is no.
  - "It depends, but generally ..." when the answer is conditional.
- State the *main entity* explicitly (job title, condition, product, etc.), not just "it" or "this".
- Include at least one key condition, trade-off, or caveat when relevant.
- Neutral, factual tone; no hype.
- NO URLs, NO "click here", NO references to InputCheck or the model.

Examples of stance:
- "No, AI will not take all jobs, but it will automate repetitive roles and push workers toward tasks that need human judgment, creativity, and empathy."
- "Yes, paying off 18% credit card debt first is usually best, because that high interest cost often exceeds realistic long-term investment returns after taxes and risk."

-------------- MINI_ANSWER --------------
"mini_answer" is a 3–5 sentence expansion that goes beyond the capsule.

Rules:
- 3–5 short sentences, plain text.
- The FIRST sentence must NOT repeat the capsule's main claim in similar wording.
  - Instead, add new information: who this mainly applies to, when it matters most, or the mechanism behind the answer.
- Use the remaining sentences to cover:
  - WHY the answer is true (mechanism, trade-offs, typical scenarios).
  - WHAT simple steps the person should take next (2–3 steps in one sentence is fine).
  - LIMITS or boundaries (when the advice might change, or when to be cautious).
- One main idea per sentence. No rhetorical questions, no bullet points, no markdown, no URLs.
- Keep it calm and practical, not alarmist.

-------------- SAFETY & YMYL --------------
For health, finance, legal, career, or other high-stakes (YMYL) topics:
- Stay general and avoid detailed prescriptive instructions.
- Emphasize that individual situations differ.
- When appropriate, recommend consulting a qualified professional (doctor, financial planner, lawyer, etc.).
- Avoid promising guaranteed outcomes or specific returns.

-------------- CONTRACT (STRICT) --------------
You must return a SINGLE JSON object with EXACTLY this shape:

{
  "raw_input": "string",
  "canonical_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string"
}

Rules:
Rules for "canonical_query":
- This is NOT the full question. It is a SHORT search phrase built from the question.
- It must ALWAYS be shorter than raw_input and must never simply copy or lightly rephrase the full sentence.
- 3–10 words, all lowercase.
- Only letters, numbers, spaces, and an optional question mark at the end. No commas, quotes, or long clauses.
- Strip all personal chatter and platforms: remove age, “I / my / me”, TikTok, YouTube, “be honest”, “actually”, “really”, “everyone is screaming”, etc.
- Keep only: main condition or entity + key decision or problem.
- Example transforms:
  - raw_input: "I’m 52 with borderline diabetes and high cholesterol. TikTok says Ozempic and GLP-1 shots are a shortcut, but my doctor wants me to focus on diet and exercise first. Is it smarter to push for Ozempic now or stick with lifestyle changes only?"
  - canonical_query: "borderline diabetes ozempic vs lifestyle changes"
  - raw_input: "I’m 45 with a 6% mortgage and some extra cash each month. Is it smarter to pay extra on the mortgage or invest?"
  - canonical_query: "6 percent mortgage vs investing"
- If your first draft of canonical_query is more than 10 words OR looks very similar to raw_input, you MUST rewrite it until it is a compact phrase like the examples above.
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
      // Network / fetch-level error
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
