// api/inputcheck-run.js
// InputCheck Raptor-3.5 – raw_input -> cleaned_question -> google_style_query -> full AI Overview (capsule + mini-answer + AO-style block).

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

const ENGINE_VERSION = "inputcheck-raptor-3.5.0";

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
  return (
    safe
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "inputcheck-node"
  );
}

// Build a basic meta_title from the cleaned question or query
function buildMetaTitle(cleanedQuestion, googleQuery) {
  const base =
    (cleanedQuestion || "").toString().trim() ||
    (googleQuery || "").toString().trim();
  if (!base) return "InputCheck answer overview";
  // Light truncation; HTML layer can refine further.
  return base.length > 70 ? base.slice(0, 67) + "..." : base;
}

// Build a basic meta_summary from capsule + mini
function buildMetaSummary(answerCapsule, miniAnswer) {
  const capsule = (answerCapsule || "").toString().trim();
  const mini = (miniAnswer || "").toString().trim();
  const combined = (capsule + " " + mini).trim();
  if (!combined) {
    return "This answer overview summarizes likely causes, key factors, and practical next steps for this question.";
  }
  // Rough cap ~220 chars; HTML layer can further adjust.
  return combined.length > 220
    ? combined.slice(0, 217) + "..."
    : combined;
}

// Normalize an array of strings
function normalizeStringArray(arr, maxItems = 8) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => (v == null ? "" : v.toString().trim()))
    .filter(Boolean)
    .slice(0, maxItems);
}

// Normalize follow-up Q&A array
function normalizeFollowUpQA(arr, maxItems = 4) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const question = (item.question || "").toString().trim();
    const answer_capsule_15w = (item.answer_capsule_15w || "")
      .toString()
      .trim();
    if (!question && !answer_capsule_15w) continue;
    out.push({ question, answer_capsule_15w });
    if (out.length >= maxItems) break;
  }
  return out;
}

// Fallback payload if OpenAI fails
function buildFallback(rawInput, reason, wasTruncated) {
  const safeInput = (rawInput || "").toString().trim();
  const cleaned_question = safeInput || "InputCheck engine fallback answer";
  const google_style_query = buildGoogleStyleQuery(safeInput);
  const url_slug = buildSlug(google_style_query || cleaned_question);

  const capsule =
    "No detailed answer is available right now because the engine could not complete your request safely. Try again later or simplify the question.";
  const mini =
    "This is a temporary fallback response generated when the capsule engine hit a technical or safety limit. Do not rely on this for critical health, legal, or financial decisions. Try asking again with a clearer, more focused question or consult a qualified professional for personalized guidance.";

  const meta_title = buildMetaTitle(cleaned_question, google_style_query);
  const meta_summary = buildMetaSummary(capsule, mini);
  const next_best_question =
    "What is the very next detail you would want answered about this question?";

  return {
    raw_input: safeInput,
    cleaned_question,
    google_style_query,
    answer_capsule_25w: capsule,
    mini_answer: mini,
    next_best_question,
    url_slug,
    meta_title,
    meta_summary,
    full_ai_overview: {
      primary_answer: {
        answer_capsule_25w: capsule,
        mini_answer: mini
      },
      key_points: [
        "This is a fallback answer used when the main engine cannot complete a safe or valid response."
      ],
      step_by_step: [],
      critical_caveat:
        "Do not rely on this fallback for critical health, legal, or financial decisions; consult a qualified professional.",
      follow_up_qa: [],
      next_best_question
    },
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
You are "InputCheck Raptor-3.5 LITE AO Engine" for theanswervault.com.

Your job:
- Take one decision-style question that may also include an offer URL in the same line.
- Clean it into a clear, answerable question and a short Google-style query.
- Generate a tight AI Overview capsule + mini answer that is more honest, clearer, and more outcome-focused than typical AI overviews.
- Output ONE JSON object that my code can render directly into a Mini Answer page.

------------------------------------------------
0. Input you will receive (from my backend)
------------------------------------------------
You will be given a user message that looks like this JSON:

{
  "raw_input": "user's question and possibly an https:// offer URL",
  "original_length": number,
  "was_truncated": true_or_false
}

"raw_input" may look like:

- "Is my store big enough for Liquid Web’s managed hosting? ### https://example-offer-url.com"
- OR: "Is Beehiiv actually good for monetizing newsletters through ads and sponsorships? https://example-offer-url.com"

Rules:
- Treat **everything BEFORE the first "http"** as the question.
- Treat the first "http..." segment as an OFFER URL that is **NOT** to be printed.
- You may use the presence of the URL as a signal that this is a tools/platform/offer decision, but you must **never** include URLs, brand-specific CTAs, or affiliate language in your outputs.

------------------------------------------------
1. What you must output (top-level JSON shape)
------------------------------------------------
You MUST return a SINGLE JSON object with EXACTLY these top-level keys:

{
  "cleaned_question": "string",
  "google_style_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string",
  "sge_summary": "string",
  "url_slug": "string",
  "critical_caveat": "string",
  "meta": {
    "engine_version": "string",
    "model": "string"
  }
}

Do NOT add or remove top-level keys.
Do NOT wrap this object in an array.
Do NOT return markdown, prose, or any extra text outside the JSON.

------------------------------------------------
2. Field-by-field requirements
------------------------------------------------

1) "cleaned_question"
- One clear, answerable question in natural language.
- Strip away filler, chatter, and platform references (TikTok, YouTube, Reddit, etc.).
- KEEP any context that changes the answer (business size, stage, traffic level, constraints, etc.).
- Remove the URL entirely.
- Example:
  raw_input: "Is my WooCommerce store big enough for Liquid Web’s managed hosting? ### https://offer-url.com"
  cleaned_question: "Is my WooCommerce store big enough to benefit from upgrading to Liquid Web’s managed hosting?"

2) "google_style_query"
- A SHORT, Google-style search phrase built from the cleaned question.
- 3–10 words, all lowercase.
- Only letters, numbers, spaces, and an optional "?" at the end.
- Strip pronouns, filler, and platform names (i, my, tiktok, youtube, etc.).
- Focus on entity + condition + decision.
- Examples:
  cleaned_question: "Is my WooCommerce store big enough to benefit from Liquid Web’s managed hosting?"
  google_style_query: "liquid web managed hosting store size"
  cleaned_question: "Is Beehiiv the best choice to monetize my newsletter through ads and sponsorships?"
  google_style_query: "beehiiv newsletter monetization ads sponsorships"

3) "answer_capsule_25w"
- ONE sentence, about 20–25 words, written in clear natural language.
- It must directly answer the cleaned question in a way that a searcher could copy/paste as a snippet.

DECISIONLOCK (non-negotiable):
- If the cleaned_question is a **decision question** (worth/best/better/should/switch/upgrade/stay/is it time/when does it make sense/try this vs that), then:
  - The capsule MUST begin with EXACTLY one of:
    - "Yes—"
    - "No—"
    - "It depends—"
- After that prefix, immediately state the main condition or split.
- Examples:
  - "It depends—upgrading to Liquid Web’s managed hosting makes sense once your store’s traffic and downtime risk justify a higher monthly bill."
  - "Yes—Beehiiv is a strong choice if you plan to monetize heavily through built-in ads and sponsorships and are comfortable with a focused newsletter-first platform."

Additional capsule rules:
- Include at least one key condition, trade-off, or threshold.
- No URLs, no CTAs, no brand puffery, no "click here".
- Tone: direct, calm, non-corporate, and honest.

4) "mini_answer"
- 3–5 short sentences that expand the capsule.
- The FIRST sentence must NOT simply restate the capsule; add new detail.
- Explain:
  - WHY the answer leans the way it does,
  - WHEN the decision flips (thresholds, traffic/revenue conditions),
  - WHO this applies to most,
  - and WHAT the user should roughly consider doing next (at a high level).
- Use outcome-first framing:
  - Talk about time saved, revenue impact, risk reduction, stability, simplicity, peace of mind.
- Stay neutral and advisory:
  - Prefer language like "often", "can", "usually", "for many stores/agencies in this situation".
- No URLs, no brand slogans, no affiliate-style language.

5) "sge_summary"
- A concise, neutral summary that can be used BOTH as meta description **and** `<meta name="sge:summary">`.
- 110–200 characters is ideal (but you do not need to count explicitly).
- One compact paragraph that:
  - states the decision in plain language,
  - highlights 1–2 key factors or thresholds,
  - and hints at the next step (evaluate traffic/revenue, test, compare).
- No brand hype, no URLs, no CTAs.
- Example skeleton:
  - "Explains when upgrading to managed hosting makes sense based on your store’s size, traffic, and downtime risk, and when cheaper options are still enough."

6) "url_slug"
- A short, hyphenated slug built from the google_style_query.
- lowercased; words separated by hyphens; no spaces or punctuation.
- If the query is empty, fall back to cleaned_question.
- Example:
  google_style_query: "liquid web managed hosting store size"
  url_slug: "liquid-web-managed-hosting-store-size"

7) "critical_caveat"
- ONE sentence with the most important warning, nuance, or "watch out" constraint for this decision.
- Make it specific and quotable, not generic.
- Examples:
  - "Upgrading too early can lock you into higher monthly costs without a clear revenue or stability benefit."
  - "Hosting alone won’t fix inefficient code or bloated plugins—those still need attention."

8) "meta"
- A small object describing the engine and model.
- Example:
  "meta": {
    "engine_version": "inputcheck-raptor-3.5-lite-1.0",
    "model": "gpt-4.1-mini"
  }

If you are unsure of the exact engine_version, you may leave a reasonable placeholder; my backend can overwrite these fields if needed.

------------------------------------------------
3. Tone and style
------------------------------------------------
- Write like a smart, no-bullshit coach who respects the reader’s time.
- Natural language, not stiff corporate jargon.
- Short, direct sentences; avoid long, tangled paragraphs.
- Honest about tradeoffs. Do NOT oversell any tool or platform.
- You may gently suggest testing a tool when it is reasonable, but never guarantee results.

------------------------------------------------
4. Safety rules (YMYL)
------------------------------------------------
For medical, legal, mental health, and major personal finance questions:
- Stay general and educational.
- Do NOT tell the user exactly what treatment, medication, or financial product to choose.
- Encourage consulting qualified professionals or trusted local advisors for personal decisions.
- No specific product nudges in those domains.

------------------------------------------------
5. Output format constraints (VERY IMPORTANT)
------------------------------------------------
- You must return ONLY the JSON object described in section 1.
- No markdown, no triple backticks, no explanation text.
- No comments or trailing commas.
- Do not echo the URL or include any URL in any field.
- Before you respond, quickly check:
  - Does "answer_capsule_25w" start with "Yes—", "No—", or "It depends—" when the question is a decision question?
  - Are all required keys present?
  - Are there any URLs or CTAs? If yes, remove them.

Once the self-check passes, output the final JSON object.
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

    // ----------------------------
    // Coerce + backfill fields
    // ----------------------------
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

    // Full AO raw object (may be missing / partial)
    const full_raw =
      payload.full_ai_overview && typeof payload.full_ai_overview === "object"
        ? payload.full_ai_overview
        : {};

    const primary_raw =
      full_raw.primary_answer && typeof full_raw.primary_answer === "object"
        ? full_raw.primary_answer
        : {};

    // Answer capsule and mini answer: prefer top-level, then primary_answer, then defaults
    const defaultCapsule =
      "No capsule answer was generated. Try asking the question more directly or run the engine again.";
    const defaultMini =
      "The engine did not return a full mini answer for this question. Consider re-running the request or simplifying the input for clearer processing.";

    let answer_capsule_25w = (
      payload.answer_capsule_25w ||
      primary_raw.answer_capsule_25w ||
      defaultCapsule
    )
      .toString()
      .trim();

    let mini_answer = (
      payload.mini_answer ||
      primary_raw.mini_answer ||
      defaultMini
    )
      .toString()
      .trim();

    // Next best question: prefer AO-level, then top-level, then default
    const nbfDefault =
      "What is the very next detail you would want answered about this question?";

    const nbqRaw = (
      full_raw.next_best_question ||
      payload.next_best_question ||
      nbfDefault
    )
      .toString()
      .trim();

    const next_best_question = nbqRaw || nbfDefault;

    // Meta fields
    const meta_title = (
      payload.meta_title ||
      buildMetaTitle(cleaned_question, google_style_query)
    )
      .toString()
      .trim();

    const meta_summary = (
      payload.meta_summary ||
      buildMetaSummary(answer_capsule_25w, mini_answer)
    )
      .toString()
      .trim();

    // url_slug from payload or built from query/question
    const url_slug = buildSlug(
      payload.url_slug ||
        google_style_query ||
        cleaned_question
    );

    // Normalize AO block
    const key_points = normalizeStringArray(full_raw.key_points, 6);
    const step_by_step = normalizeStringArray(full_raw.step_by_step, 8);
    const critical_caveat = (
      full_raw.critical_caveat || ""
    )
      .toString()
      .trim();

    const follow_up_qa = normalizeFollowUpQA(
      full_raw.follow_up_qa,
      4
    );

    const full_ai_overview = {
      primary_answer: {
        answer_capsule_25w,
        mini_answer
      },
      key_points,
      step_by_step,
      critical_caveat,
      follow_up_qa,
      next_best_question
    };

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      raw_input,
      cleaned_question,
      google_style_query,
      answer_capsule_25w,
      mini_answer,
      next_best_question,
      url_slug,
      meta_title,
      meta_summary,
      full_ai_overview,
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

    console.error(
      `[${reqId}] Unexpected Capsule Engine error:`,
      err
    );
    const fallback = buildFallback(raw_input, reason, false);
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
