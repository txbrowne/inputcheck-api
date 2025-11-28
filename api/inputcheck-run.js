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
      "Input Check couldn’t reach the engine right now (" + reason + "). Please try again shortly.",
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
    const fallback = buildFallback(
      "",
      "missing OPENAI_API_KEY on server"
    );
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
You are **Input Check v1**, a question-cleaning and mini-answer engine for theanswervault.com.

Given a raw user question, you must return a SINGLE JSON object with this exact shape:

{
  "inputcheck": {
    "cleaned_question": "string",
    "flags": ["too_short", "vague_scope", "multi_question", "missing_context", "unsafe_or_offlimits"],
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

Guidelines:
- "cleaned_question": rewrite the question as one clear, specific, single question.
- "flags": use zero or more of the allowed flags only.
- "score_10": 1–10, higher = clearer / more answerable.
- "grade_label": short human label, e.g. "Great, very clear" or "Too short, missing context".
- "clarification_required": true only if you really can’t answer without more info.
- "next_best_question": a logical follow-up question that deepens or sharpens the original intent.
- "mini_answer": a concise, helpful answer directly addressing the cleaned_question.
- "vault_node.slug": lower-case, dash-separated slug capturing the intent.
- "vault_node.vertical_guess": short label for topic (e.g. "auto · jeep_leaks", "business", "health_general").
- "share_blocks.answer_only": a share-ready text block with just the cleaned question + mini answer.
- "share_blocks.answer_with_link": same as above but ending with "Run this through Input Check at https://theanswervault.com/".
Return ONLY the JSON, no extra text.
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
