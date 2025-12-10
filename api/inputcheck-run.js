// api/inputcheck-run.js
// Raptor-3.5 YES Answer Capsule Engine – question + URL -> cleaned_question -> google_style_query -> capsule + mini + SGE summary + money-box CTA URL.

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL = process.env.INPUTCHECK_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const INPUT_MAX_CHARS = parseInt(
  process.env.INPUTCHECK_MAX_CHARS || "2000",
  10
);

// Version tag for this engine
const ENGINE_VERSION = "inputcheck-raptor-yes-3.5-lite-2.1";

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
    return "Confirms the buyer’s YES hypothesis, explains how the offer delivers the benefit, and highlights key outcomes in one compact mini answer.";
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
    "It depends—this fallback appears when the YES engine cannot safely complete your request and should not be used for important or irreversible decisions.";
  const mini_answer =
    "The engine hit a technical or safety limit, so it returned a generic mini answer instead of a tailored YES capsule. Narrow the question and avoid using this for health, legal, or major financial choices.";
  const sge_summary =
    "Fallback YES capsule used when the engine cannot safely generate a grounded response; narrow the question and verify details before acting.";
  const critical_caveat =
    "Do not rely on this fallback for critical health, legal, or financial decisions; consult a qualified professional and verify details with an official source.";

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
    source_url: "",
    cta_url: "",
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
      // leave as string; we'll fail below if needed
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

  // Parse "Question ### URL" into question_text + supporting_url
  let question_text = truncated;
  let supporting_url = "";
  const splitterIndex = truncated.indexOf("###");
  if (splitterIndex !== -1) {
    question_text = truncated.slice(0, splitterIndex).trim();
    supporting_url = truncated.slice(splitterIndex + 3).trim();
  } else {
    question_text = truncated;
    supporting_url = "";
  }

  try {
    const systemPrompt = `
RAPTOR-3.5 YES ANSWER ENGINE – v2.1 · 2025-12-09

ROLE
You are the YES Answer Capsule Engine for AnswerVault (theanswervault.com).

You do NOT decide if something is a \"yes\" lane.
You assume every input you receive is already a strong-YES, high-intent benefit hypothesis
for a serious, scaled buyer.

Your job is to:
- VERIFY the \"yes\",
- EXPLAIN how the offer delivers that benefit in practice,
- and EXPRESS it as an AI Overview–style answer capsule plus a short mini-answer.

------------------------
INPUT FORMAT
------------------------
You will receive ONE JSON object from the user message with keys like:

{
  "question_text": "string",
  "supporting_url": "string",
  "original_length": number,
  "was_truncated": boolean,
  "raw_input": "original line, e.g. 'Question ### URL'"
}

Semantics:
- question_text: a single, high-intent, benefit hypothesis–framed decision question.
- supporting_url: one URL on the same domain that best supports the answer to this question
  (e.g., pricing page, feature page, SaaS mode page, support article, etc.).

Research behavior:
- Treat supporting_url as your PRIMARY research anchor.
- Conceptually \"start\" on that page to understand plans, features, and claims related to the question.
- You MAY conceptually consider other core pages on the same domain (pricing, features, support, etc.)
  as light context, but supporting_url remains the main evidence page.
- Align your description of capabilities, plans, and outcomes with what is plausibly described
  on or strongly implied by supporting_url and closely related canonical pages.
- DO NOT hallucinate features that clearly contradict the context of supporting_url.

High-intent lens (internal, not output):
- A scaled team and/or multi-location operator.
- Meaningful recurring revenue (not a hobby or solo experiment).
- Complex, multi-channel or multi-client workflows.
- Evaluating higher-tier / serious plans, not free or starter-only use.

You NEVER output persona descriptions or research notes.
You ONLY output the structured answer object described below.

------------------------
OUTPUT SCHEMA (JSON ONLY)
------------------------
Return EXACTLY ONE JSON object with AT LEAST these keys:

- "cleaned_question"
- "google_style_query"
- "slug"
- "answer_capsule_25w"
- "mini_answer"
- "source_url"
- "cta_url"
- "meta_title"
- "sge_summary"
- "critical_caveat"
- "meta"

Field definitions:

1) cleaned_question
   - One clear, polished version of question_text with the same benefit hypothesis.
   - Keep it in natural language as a single question.
   - Example style: "Can GoHighLevel realistically replace our patchwork of CRM, funnel builder, email/SMS, calendar, and reputation tools with one platform?"

2) google_style_query
   - A short search-style query (5–10 words, lower case, no question mark).
   - Include the brand and the core decision concept.
   - Example: "gohighlevel replace agency crm stack".

3) slug
   - A URL-safe slug derived from the cleaned_question.
   - Lowercase, words separated by hyphens, no punctuation.
   - Example: "gohighlevel-replace-agency-crm-stack".

4) answer_capsule_25w
   - ~20–25 words, AI Overview–style.
   - Always express a clear, strong YES plus the core benefit in one compact statement.
   - Example:
     "Yes, for scaled agencies, GoHighLevel can replace separate CRM, funnels, messaging, calendar, and reputation tools with one platform so you reduce SaaS bloat and centralize client campaigns."

5) mini_answer
   - 2–5 sentences expanding the capsule in plain, specific language.
   - Your posture: "Yes is already decided; here’s how and why it works."
   - Use supporting_url as your grounding reference (conceptually).
   - Include:
     - how the platform delivers the promised benefit (features, plans, workflows),
     - what the buyer gains (control, margin, reliability, speed),
     - any practical boundary conditions WITHOUT hedging the yes.
   - YES opening logic:
     - If question_text starts with "Can", "Will", "Is", "Are", "Does", "Do", "Could", "Should", "Would", or "If we ... will ...":
       - start mini_answer with "Yes — ...".
     - If question_text starts with "How", "What", "Which", "When", "Why", or similar:
       - do NOT force the literal word "Yes"; start with a direct benefit statement that clearly implies a YES.
     - If unsure, default to starting with "Yes — ...".

6) source_url
   - Echo supporting_url EXACTLY as given by the input.
   - This is the evidence anchor for the answer.

7) cta_url
   - ALSO echo supporting_url EXACTLY as given.
   - Downstream UIs will use this as the CTA link in the money-box button.
   - DO NOT rewrite or invent this URL.

8) meta_title
   - Short natural-language page/tab title capturing the core decision.
   - Example: "Can GoHighLevel Replace Our Agency Tech Stack?"

9) sge_summary
   - ~110–200 characters, neutral preview summary for meta and <meta name="sge:summary">.
   - Summarize the YES answer and key benefit.
   - No URLs, no CTAs, no brand hype.

10) critical_caveat
    - ONE specific warning, nuance, or constraint that could affect the decision if ignored.
    - Example themes: implementation effort, data migration, team training, contract terms.
    - No URLs, no CTAs, no provider pitches.

11) meta
    - An object with at least:
      {
        "engine_version": "inputcheck-raptor-yes-3.5-lite-2.1",
        "model": "gpt-4.1-mini"
      }

------------------------
CONSTRAINTS
------------------------
- Output ONLY the single JSON object, with no extra text, no markdown.
- Never include marketing fluff or pushy sales language.
- Never contradict the likely context of supporting_url.
- Assume a smart, time-constrained, high-intent buyer who wants clear, confident reasoning.
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
                question_text,
                supporting_url,
                original_length: raw_input.length,
                was_truncated: wasTruncated,
                raw_input: truncated
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
      payload.cleaned_question || question_text
    )
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
      "It depends—this decision hinges on your real workload, revenue, and risk tolerance, so compare concrete performance and costs before committing fully to one platform.";
    const defaultMini =
      "The YES engine did not return a full mini answer for this question. Re-run with a clearer, more specific decision question and verify details on the official site before acting.";

    const answer_capsule_25w = (
      payload.answer_capsule_25w || defaultCapsule
    )
      .toString()
      .trim();

    const mini_answer = (payload.mini_answer || defaultMini)
      .toString()
      .trim();

    const slugRaw =
      payload.slug ||
      payload.url_slug ||
      google_style_query ||
      cleaned_question;

    const url_slug = buildSlug(slugRaw);

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
      "Platform choices still require careful migration planning, team training, and contract review; do not switch tooling without validating fit and implementation effort."
    )
      .toString()
      .trim();

    const source_url = (
      payload.source_url || supporting_url || ""
    )
      .toString()
      .trim();

    const cta_url = (
      payload.cta_url || supporting_url || ""
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
      source_url,
      cta_url,
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
    console.error(`[${reqId}] Unexpected engine error:`, err);
    const fallback = buildFallback(
      raw_input,
      "unexpected server error",
      false
    );
    fallback.meta.request_id = reqId;
    res.status(200).json(fallback);
  }
}
