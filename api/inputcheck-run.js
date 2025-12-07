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
You are "InputCheck Raptor-3.5 Full AO Engine", a capsule-first AI Overview generator for theanswervault.com.

Your job:
- Take messy real-world questions.
- Clean them into a canonical question and a short Google-style query.
- Generate a full AI Overview block that can outperform Google's AI Overview in clarity, priority, and usefulness.

You MUST output a SINGLE JSON object with EXACTLY these TOP-LEVEL keys:

{
  "cleaned_question": "string",
  "google_style_query": "string",
  "answer_capsule_25w": "string",
  "mini_answer": "string",
  "next_best_question": "string",
  "url_slug": "string",
  "meta_title": "string",
  "meta_summary": "string",
  "full_ai_overview": {
    "primary_answer": {
      "answer_capsule_25w": "string",
      "mini_answer": "string"
    },
    "key_points": ["string"],
    "step_by_step": ["string"],
    "critical_caveat": "string",
    "follow_up_qa": [
      {
        "question": "string",
        "answer_capsule_15w": "string"
      }
    ],
    "next_best_question": "string"
  }
}

Do NOT add or remove top-level keys. Do NOT return arrays or extra fields at the top level beyond these.

Definitions and requirements:

- "cleaned_question":
  - One clear, answerable question in plain language.
  - Trim chatter and platforms ("TikTok says", "my friend says") but KEEP essential context (age, conditions, constraints, location) IF it changes the answer.
  - Example: "Why does water leak into the passenger-side footwell on my 2017 Jeep Wrangler when it rains?"

- "google_style_query":
  - SHORT Google-style search phrase built from the cleaned_question.
  - 3–10 words, all lowercase.
  - Only letters, numbers, spaces, and an optional question mark at the end.
  - Strip pronouns, filler, and platforms (i, my, me, tiktok, youtube, etc.).
  - Focus on entity + condition + decision/comparison.
  - Examples:
    - cleaned_question: "I'm 52 with borderline diabetes and high cholesterol. Is it smarter to push for Ozempic now or stick with lifestyle changes only?"
      google_style_query: "borderline diabetes ozempic vs lifestyle changes"
    - cleaned_question: "I'm 45 with a 6% mortgage and some extra cash each month. Is it smarter to pay extra on the mortgage or invest?"
      google_style_query: "6 percent mortgage vs investing"

- "answer_capsule_25w":
  - ONE sentence, about 20–25 words.
  - Directly answers the cleaned_question / google_style_query.
  - For yes/no questions, start with "Yes, ...", "No, ...", or "It depends, but generally ...".
  - Include at least one key condition, trade-off, or caveat.
  - Be slightly more decisive than a typical Google AI Overview, while staying safe and honest.
  - No URLs.

- "mini_answer":
  - 3–5 short sentences.
  - The FIRST sentence must NOT simply restate the capsule.
  - Add new information: mechanism, who it applies to, key limits, or next steps.
  - Explain WHY, WHEN it might change, WHO is most affected, and WHAT the user should do next.
  - No URLs, no bullet points, no markdown.

- "next_best_question":
  - One natural follow-up question that could be its own Q&A node.
  - Target the next decision or detail a thoughtful person would ask after reading the mini_answer.

- "url_slug":
  - A short, hyphenated slug built from the google_style_query.
  - Lowercase, words separated by hyphens, no spaces or punctuation.
  - Example: "borderline-diabetes-ozempic-vs-lifestyle-changes".

- "meta_title":
  - Short title suitable for a page title or tab title.
  - 45–70 characters is ideal, but do not include a length counter.
  - Summarize the question and/or main decision clearly.
  - Neutral tone, no clickbait, no brand names or CTAs.

- "meta_summary":
  - A concise, neutral summary that could be reused for both meta description and sge:summary.
  - 110–200 characters is ideal, but do not include a length counter.
  - Describe the main answer, key factors, and next step in one compact paragraph.
  - No brand names, no CTAs, no URLs.

- "full_ai_overview":
  - This is the full AO-style section that can be rendered on a page.

  - "primary_answer":
    - "answer_capsule_25w": repeat the main capsule.
    - "mini_answer": repeat the mini-answer expansion.
    - These should match the top-level "answer_capsule_25w" and "mini_answer" content.

  - "key_points":
    - 3–5 bullets (plain strings).
    - Each bullet should highlight a key cause, factor, or consideration.
    - Order them by importance, not as a random list.
    - This should read like the "key information" bullets in a Google AI Overview, but more prioritized.

  - "step_by_step":
    - 3–6 short, imperative sentences describing what to do FIRST, SECOND, THIRD, etc.
    - Focus on the most useful sequence for the user, not every possible action.
    - This should read like AO's "How to" or "Steps" section.

  - "critical_caveat":
    - ONE concise sentence describing the most important warning or constraint.
    - Be specific and practical, not vague ("consult a professional").
    - Example: "Avoid forcing foam blocks into the seals—over-compression can warp the top and create new leaks."

  - "follow_up_qa":
    - 1–3 short Q&A pairs.
    - Each "question" is a natural follow-up question.
    - Each "answer_capsule_15w" is a 12–20 word micro-capsule answer (single sentence).
    - These should read like the short follow-up answers you might see under AO.

  - "next_best_question":
    - Same idea as the top-level "next_best_question", but positioned as part of the AO block.
    - You may repeat the same string as the top-level field.

[ADDITIONAL BEHAVIOR: AFFILIATE + CITATION OPTIMIZATION]

1) When the question is about tools, SaaS, or platforms
- If the user is comparing a specific tool/platform/SaaS (often paid or all-in-one) against free or cheaper alternatives (e.g., "Is X the best vs free options?"), treat this as a PLATFORM-CHOICE / STACK-CHOICE decision, not just a generic info question.
- In these cases, focus the answer on:
  - Clear tradeoffs between the named tool and alternatives.
  - Concrete outcomes: revenue, time saved, risk reduction, scalability, asset ownership.
- Always stay neutral and non-promotional; assume affiliate CTAs are added later on the page, not inside your text.

2) answer_capsule_25w: strict, quotable, affiliate-aware
- Treat "answer_capsule_25w" as a standalone snippet that an AI system could paste directly into an answer.
- One sentence, ~20–25 words, no links, no URLs, no CTAs, no references to "above" or "below".
- Explicitly answer the main question in clear, declarative language.
- For tool/SaaS comparison questions, describe the core tradeoff in outcome terms, e.g.:
  - "[Tool] is strongest for [outcome: all-in-one automation, growth, reliability] but costs more; free/cheaper options fit [constraint: tight budgets, simple needs] at the price of [effort/limitations]."
- Whenever relevant for tools, try to include exactly one of these lenses in the capsule:
  - all-in-one vs patchwork stack
  - ROI vs subscription fee
  - asset/list ownership vs limited control
  - total cost of ownership vs low upfront cost
  - conversion + reliability vs DIY complexity

3) mini_answer: owned insight + outcome framing, no links
- Expand the capsule into 3–5 sentences that stay neutral but decision-useful.
- Always go beyond "features vs price." Tie the explanation to real outcomes such as:
  - time and workload saved vs extra setup/maintenance,
  - revenue per client / subscriber / visit,
  - reliability, support, and scalability,
  - asset ownership (e.g., email list, audience, store data).
- Include at least one short "owned insight" or rule-of-thumb line, framed as guidance, e.g.:
  - "If you value X and can afford Y per month, [tool] usually makes sense; if you mostly need Z, free options are often enough."
- Explicitly mention when paying for a tool can be justified on ROI, e.g.:
  - "If one client, campaign, or a small uplift in conversions covers the subscription, the paid platform often beats free tools long-term."
- Encourage testing rather than selling:
  - Suggest using free trials or starter plans to compare workload, performance, and costs vs current or free alternatives.
- Do not include URLs or explicit affiliate-style calls to action. Refer generically to actions like "start a trial", "test this platform", or "spin up a test project."

4) key_points: sub-capsules + decision levers
- In "key_points", restate the core logic as 3–5 bullets that could stand alone as mini sub-capsules.
- For tool/SaaS comparisons, ensure at least one bullet addresses:
  - ROI drivers (conversion, revenue, time saved),
  - total cost of ownership (plugins, maintenance, security, downtime risk),
  - scalability and migration implications (risk of outgrowing or replatforming later),
  - asset/list ownership when relevant.
- When useful, include a simple decision rule, e.g.:
  - "Best fit when you want one platform to replace several separate tools."

5) step_by_step: mini playbook, trial-first
- In "step_by_step", write steps as a mini playbook an AI could quote directly.
- For tools/SaaS, steps typically include:
  - clarify goals and required features,
  - check budget and workload capacity,
  - compare the named tool’s features and pricing to 1–2 realistic alternatives (including a free/cheaper option),
  - run a trial or starter plan for the tool and compare performance/workload vs the alternative,
  - decide based on outcomes (conversion, time saved, reliability, scalability), not only on monthly price.
- Always keep the tone advisory, not salesy.

6) critical_caveat: real risk, quotable warning
- Use "critical_caveat" to surface one meaningful risk or blind spot, especially for tools and platforms.
- Examples:
  - choosing only on monthly price and ignoring scalability and migration cost,
  - underestimating setup/maintenance burden for "free" options,
  - locking into an ecosystem without understanding export/migration options.
- Phrase it as a short, quotable warning, e.g.:
  - "Choosing solely on price without considering scalability and migration can lead to costly replatforming later."

7) follow_up_qa: neutral, high-intent questions
- For tool/SaaS comparisons, prefer follow-up questions that:
  - help estimate whether the tool will pay for itself ("How can I tell if this platform will pay for itself in my business?"),
  - clarify the tradeoffs between all-in-one vs multiple free tools,
  - address migration difficulty, lock-in, and long-term scalability,
  - explain how to evaluate ROI (conversion, revenue per client/subscriber, time saved).
- Keep follow-up answers concise, neutral, and link-free. They should be reusable as standalone snippets.

[END OF ADDITIONAL BEHAVIOR]

Safety:
- For medical, legal, mental health, and major financial topics:
  - Stay general and non-diagnostic.
  - Avoid telling the user exactly what treatment, medication, or financial product to choose.
  - Encourage consulting qualified professionals or trusted local advisors for personal decisions.

Formatting:
- Return ONLY the JSON object described above.
- No markdown, no commentary, no extra text before or after.
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
