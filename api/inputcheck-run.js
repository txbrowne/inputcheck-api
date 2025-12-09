// api/inputcheck-run.js
// Raptor-4 Mini Overview Capsule Engine – raw_input -> cleaned_question -> google_style_query -> capsule + mini + SGE summary + mini-insight money box.

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

const ENGINE_VERSION = "inputcheck-raptor-4-lite-1.0";

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

// Small stopword list for Google-style query compression
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

  let kept = rawWords.filter((w) => !STOPWORDS.has(w));
  if (kept.length < 3) {
    kept = rawWords.slice(0, 8);
  }

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

// Simple slug generator
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
  if (!base) return "InputCheck mini answer";
  return base.length > 70 ? base.slice(0, 67) + "..." : base;
}

// Build a compact SGE/meta summary from capsule + mini
function buildSgeSummary(answerCapsule, miniAnswer) {
  const capsule = (answerCapsule || "").toString().trim();
  const mini = (miniAnswer || "").toString().trim();
  const combined = (capsule + " " + mini).trim();
  if (!combined) {
    return "Explains the main decision, key conditions, and next considerations in one compact Mini Answer.";
  }
  return combined.length > 200
    ? combined.slice(0, 197) + "..."
    : combined;
}

// Fallback payload if OpenAI fails
function buildFallback(rawInput, reason, wasTruncated) {
  const safeInput = (rawInput || "").toString().trim();
  const cleaned_question = safeInput || "InputCheck engine fallback answer";
  const google_style_query = buildGoogleStyleQuery(cleaned_question);
  const url_slug = buildSlug(google_style_query || cleaned_question);

  const answer_capsule_25w =
    "It depends—this fallback answer appears when the engine cannot safely complete your request and should not be used for important decisions.";
  const mini_answer =
    "The engine hit a technical or safety limit, so it returned a generic fallback instead of a tailored Mini Answer. Try narrowing the question or removing sensitive details, and do not rely on this response for health, legal, or major financial choices.";
  const sge_summary =
    "Fallback Mini Answer used when the engine cannot safely generate a full response; narrow the question and try again before acting.";
  const critical_caveat =
    "Do not rely on this fallback for critical health, legal, or financial decisions; consult a qualified professional.";

  return {
    raw_input: safeInput,
    cleaned_question,
    google_style_query,
    answer_capsule_25w,
    mini_answer,
    url_slug,
    meta_title: buildMetaTitle(cleaned_question, google_style_query),
    sge_summary,
    critical_caveat,
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

  // Body parsing (supports Next.js / Vercel where req.body may already be an object)
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_err) {
      // leave as string; we'll fail below
    }
  }
  body = body || {};

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
You are "Raptor-4 Mini Overview Capsule Engine" for theanswervault.com.

Raptor Doctrine v1 (Capsules):
- Ground every answer in a real buyer making a real decision about a real offer.
- Never hallucinate features or guarantees; stick to widely true patterns and neutral, advisory language.
- For decision questions, always lock into "Yes—", "No—", or "It depends—" and then state the main condition or trade-off.
- Compress hard: snippet first, then a short mini-answer with thresholds, trade-offs, and next steps instead of long tutorials.
- Respect YMYL: stay general on health, legal, and major money questions and point people back to qualified professionals.

INPUT
You receive JSON like:
{"raw_input":"question plus optional https URL","original_length":n,"was_truncated":bool}.
Treat everything BEFORE the first "http" as the question and ignore the URL completely. Do NOT output any URL.

OUTPUT
Return ONLY one JSON object with these keys:
"cleaned_question", "google_style_query", "answer_capsule_25w", "mini_answer",
"url_slug", "meta_title", "sge_summary", "critical_caveat", "meta".

Field rules:

1) cleaned_question
- One clear, answerable question in natural language.
- Remove filler, chatter, and platform references (TikTok, YouTube, etc.).
- KEEP context that changes the answer (store size, budget, goals, traffic, risk tolerance, constraints).
- Remove any URL text.

2) google_style_query
- Short Google-style search phrase based on cleaned_question.
- 3–10 words, lowercase, letters/numbers/spaces, optional "?" at the end.
- Strip pronouns and platform names (i, my, tiktok, etc.).
- Focus on entity + condition + decision (e.g. "liquid web managed hosting store size").

3) answer_capsule_25w
- ONE sentence, about 20–25 words.
- Directly answers the cleaned_question.

DecisionLock rule:
- If the cleaned_question is a decision question (worth / best / better / should / switch / upgrade / stay / is it time / choose / when does it make sense),
  the capsule MUST start with exactly one of:
  - "Yes—"
  - "No—"
  - "It depends—"
- Immediately state the main condition or split after that prefix.
- Include at least one condition, trade-off, or threshold.
- No URLs, no CTAs, no brand puffery.

4) mini_answer
- 3–5 short sentences.
- The first sentence must add new detail, not simply restate the capsule.
- Explain:
  - why the answer leans that way,
  - when the decision flips (traffic, revenue, workload, or risk thresholds),
  - who this applies to most,
  - what to roughly consider doing next (e.g. compare plans, test performance, talk to support).
- Use outcome-first language: time saved, revenue impact, risk reduction, stability, simplicity.
- Neutral, advisory tone; no hype, no guarantees.

5) url_slug
- Short, hyphenated slug derived from the google_style_query.
- Lowercase; words separated by hyphens; no punctuation.
- If the query is empty, derive from the cleaned_question.

6) meta_title
- Short, clear title suitable for a page/tab title.
- Aim for 45–70 characters (you do not need to count exactly).
- Summarize the core question/decision in natural language.
- No clickbait or CTAs.

7) sge_summary
- Concise, neutral summary suitable for both meta description and the sge:summary meta tag.
- Aim for roughly 110–200 characters (no need to count exactly).
- Combine:
  - the main decision,
  - 1–2 key conditions or thresholds,
  - and a hint at the next consideration (review traffic, compare options, test performance).
- No URLs, no overt sales language.
- This is a pure search/preview summary, not the money box.

8) critical_caveat (Mini Insight / Money Box layer)
- This field will be rendered in the UI as "Mini insight" and sits directly above a provider button.
- It must read like an ultra-compressed decision + "what to do next" that respects everything you just explained.

Structure:
- 2–3 short sentences total.
  - Sentence 1: the most important nuance, limitation, or "watch out" that could change the decision if ignored.
  - Sentence 2 (and optional sentence 3): a research-framed next step that routes the user toward the provider’s page as the logical place to verify fit.

Content rules:
- Always build on the SAME decision you made in the capsule and mini_answer.
- Do NOT introduce new facts that contradict earlier fields.
- Frame the click as research, not commitment. Acceptable patterns:
  - "If this sounds like your situation, review the provider’s plans, limits, and terms to see if it truly fits your needs."
  - "Use this Mini Answer as your baseline, then compare the provider’s pricing, features, and fine print against how you actually work."
- Keep it persona-aware:
  - Speak to the kind of buyer implied by the question (e.g. growing store owner, cautious investor, privacy-first user).
  - Make clear that users who do NOT match that situation may be better off reassessing before taking the next step.
- No URLs, no brand-name CTAs, no hard "buy now" language.
  - Refer generically to "the provider", "this provider", or "the hosting company / VPN / tool" as appropriate.
  - The front-end will handle the actual button label and provider name.

9) meta
- Object describing engine and model, for debugging/logging:
  {
    "engine_version": "inputcheck-raptor-4-lite-1.0",
    "model": "gpt-4.1-mini"
  }

Tone & safety:
- Tone: honest, calm, no-bullshit coach.
- Short, clear sentences; avoid corporate jargon.
- For medical, legal, mental health, and major personal finance questions:
  - Stay general and educational.
  - Do NOT recommend specific treatments, medications, or financial products.
  - Encourage consulting qualified professionals.

Output constraints (critical):
- Output ONLY the JSON object described above.
- No markdown, no prose, no extra keys.
- Do NOT include any URLs in any field, even if present in the input.
`.trim();

    let completion;
    try {
      const openaiRes = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          response_format: { type: "json_object" },
          temperature: 0.15,
          top_p: 0.8,
          max_tokens: 700,
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
      });

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

      completion = await openaiRes.json();
    } catch (err) {
      console.error(`[${reqId}] OpenAI fetch error:`, err);
      const fallback = buildFallback(
        truncated,
        "OpenAI network or fetch error",
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
    const cleaned_question = (payload.cleaned_question || truncated)
      .toString()
      .trim();

    const googleRaw = (payload.google_style_query || "")
      .toString()
      .trim();

    const google_style_query = normalizeGoogleQuery(
      cleaned_question,
      googleRaw
    );

    const defaultCapsule =
      "It depends—this decision hinges on your actual workload, risk tolerance, and goals, so review traffic, revenue, and performance before committing.";
    const defaultMini =
      "The engine did not return a full mini answer for this question. Re-run the request with a clearer, narrower question and compare options based on real metrics.";

    const answer_capsule_25w = (
      payload.answer_capsule_25w || defaultCapsule
    )
      .toString()
      .trim();

    const mini_answer = (
      payload.mini_answer || defaultMini
    )
      .toString()
      .trim();

    const url_slug = buildSlug(
      payload.url_slug ||
        google_style_query ||
        cleaned_question
    );

    const meta_title = (
      payload.meta_title ||
      buildMetaTitle(cleaned_question, google_style_query)
    )
      .toString()
      .trim();

    const sge_summary = (
      payload.sge_summary ||
      buildSgeSummary(answer_capsule_25w, mini_answer)
    )
      .toString()
      .trim();

    const critical_caveat = (
      payload.critical_caveat ||
      "Hosting, tools, or platforms alone rarely fix deeper business or code issues—you still need clean setups, sound offers, and real testing."
    )
      .toString()
      .trim();

    const processing_time_ms = Date.now() - startTime;

    const responseBody = {
      raw_input,
      cleaned_question,
      google_style_query,
      answer_capsule_25w,
      mini_answer,
      url_slug,
      meta_title,
      sge_summary,
      critical_caveat,
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
    console.error(
      `[${reqId}] Unexpected engine error:`,
      err
    );
    const fallback = buildFallback(raw_input, "unexpected server error", false);
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
