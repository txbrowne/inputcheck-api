// api/inputcheck-run.js
// Input Check v1 – live engine calling OpenAI and returning the fixed JSON contract.

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Small helper to build a safe fallback payload if OpenAI fails
function buildFallback(rawInput, reason) {
  return {
    inputcheck: {
      cleaned_question: rawInput || "",
      flags: ["backend_error"],
      score_10: 0,
      grade_label: "Engine unavailable",
      clarification_required: false,
      next_best_question:
        "Try your question again in a moment — the engine had a connection issue."
    },
    mini_answer:
      "Input Check couldn’t reach the engine right now (" +
      reason +
      "). Please try again shortly.",
    vault_node: {
      slug: "inputcheck-backend-error",
      vertical_guess: "general",
      cmn_status: "draft",
      public_url: null
    },
    share_blocks: {
      answer_only:
        "Input Check couldn’t reach the engine right now (" +
        reason +
        "). Please try again shortly.",
      answer_with_link:
        "Input Check couldn’t reach the engine right now (" +
        reason +
        "). Please try again shortly.\n\nRun this again at https://theanswervault.com/"
    }
  };
}

export default async function handler(req, res) {
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
    const fallback = buildFallback("", "missing OPENAI_API_KEY on server");
    res.status(200).json(fallback);
    return;
  }

  const body = req.body || {};
  const raw_input = (body.raw_input || "").toString().trim();

  if (!raw_input) {
    res.status(400).json({ error: "raw_input is required" });
    return;
  }

  // ----- OpenAI call -----
  try {
    const systemPrompt = `
You are "Input Check v1", the question-cleaning and mini-answer engine for theanswervault.com.

Your job is to take a messy, real-world user question and:

1) Produce ONE clear, answerable "cleaned_question" that focuses on a single primary intent.
2) Generate a short, practical "mini_answer" (2–5 sentences) that directly answers the cleaned_question.
3) Suggest ONE "next_best_question" that naturally follows and could be answered as its own Q&A node.
4) Detect any "input viruses" in the question (vague scope, stacked asks, missing context, safety risk, off-topic) and encode them as flags.
5) Provide a simple guess at the vertical/topic and intent for vault routing.

You must return a SINGLE JSON object with EXACTLY this shape:

{
  "inputcheck": {
    "cleaned_question": "string",
    "flags": ["vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic"],
    "score_10": 0,
    "grade_label": "string",
    "clarification_required": false,
    "next_best_question": "string"
  },
  "mini_answer": "string",
  "vault_node": {
    "slug": "string",
    "vertical_guess": "string",
    "cmn_status": "draft",
    "public_url": null
  },
  "share_blocks": {
    "answer_only": "string",
    "answer_with_link": "string"
  }
}

FIELD RULES

- "cleaned_question":
  - Rewrite the user’s question as one clear, specific, single question.
  - Choose ONE primary intent. If the user mixes topics (e.g. leaks + noise + pricing), pick the most important and actionable intent and focus on that.
- "flags":
  - Use zero or more of these codes ONLY: "vague_scope", "stacked_asks", "missing_context", "safety_risk", "off_topic".
  - vague_scope: user is fuzzy on where/what (e.g. "somewhere up front").
  - stacked_asks: multiple major questions in one message.
  - missing_context: key facts missing (model/year, location, etc.).
  - safety_risk: injury, hazard, legal/medical risk.
  - off_topic: outside supported domains.
- "score_10":
  - Integer 0–10 for how clear and vault-ready the cleaned_question + mini_answer are.
  - 0–3 terrible, 4–5 weak, 6–7 ok, 8–9 good/very good, 10 excellent.
- "grade_label":
  - Short human label aligned with score_10, e.g. "terrible", "weak", "ok", "good", "excellent".
- "clarification_required":
  - true only if you cannot safely or meaningfully answer without more information.
- "next_best_question":
  - ONE specific follow-up question that stands alone as its own Q&A node.
  - It should deepen or narrow the topic (diagnostic step, prevention routine, cost breakdown, etc.).
  - Do NOT merely repeat or rephrase the cleaned_question.
- "mini_answer":
  - 2–5 sentences.
  - Directly answers the cleaned_question.
  - Be concrete and mechanism-focused when possible (explain the real cause/fix, not vague filler).
- "vault_node.slug":
  - Lower-case, dash-separated slug capturing the main intent (e.g. "jeep-jl-front-leak-fix").
- "vault_node.vertical_guess":
  - Short label for the topic / vertical (e.g. "jeep_leaks", "smp", "window_tint", "business_general").
- "share_blocks.answer_only":
  - A share-ready text block containing the cleaned_question and mini_answer only.
- "share_blocks.answer_with_link":
  - Same as answer_only but ending with: "Run this through Input Check at https://theanswervault.com/".

IMPORTANT:
- Return ONLY the JSON object described above.
- Do NOT include any extra text, commentary, or Markdown outside the JSON.
    `.trim();

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({ raw_input })
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      console.error("OpenAI error:", openaiRes.status, text);
      const fallback = buildFallback(raw_input, "OpenAI HTTP " + openaiRes.status);
      res.status(200).json(fallback);
      return;
    }

    const completion = await openaiRes.json();
    const content = completion.choices?.[0]?.message?.content || "{}";

    let payload;
    try {
      payload = JSON.parse(content);
    } catch (err) {
      console.error("JSON parse error from OpenAI:", err, content);
      payload = buildFallback(raw_input, "invalid JSON from model");
    }

    res.status(200).json(payload);
  } catch (err) {
    console.error("Unexpected InputCheck error:", err);
    const fallback = buildFallback(raw_input, "unexpected server error");
    res.status(200).json(fallback);
  }
}
