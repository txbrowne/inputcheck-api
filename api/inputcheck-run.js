// api/inputcheck-run.js

// CORS helper (lets browsers talk to us)
function setCorsHeaders(res) {
  // For now, allow all origins; later you can lock this to your Squarespace domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Vercel serverless function entry point
export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle preflight (browser checks)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only POST is allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- Read raw_input from body ---
  let rawInput = "";
  try {
    if (typeof req.body === "string") {
      const parsed = JSON.parse(req.body);
      rawInput = (parsed.raw_input || "").toString();
    } else {
      rawInput = (req.body.raw_input || "").toString();
    }
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const trimmed = rawInput.trim();

  // --- Dummy "analysis" logic ---
  const flags = [];
  if (!trimmed) {
    flags.push("empty");
  } else if (trimmed.length < 20) {
    flags.push("too_short");
  }

  const isClear = flags.length === 0;
  const cleanedQuestion = trimmed || "Can you clarify what you want help with?";
  const score = isClear ? 8 : 5;
  const gradeLabel = isClear ? "Good, mostly clear" : "Needs a bit more detail";

  const miniAnswer = isClear
    ? "Here’s a first-pass answer based on your question. This is a dummy response from the v1 engine; soon it will be powered by the full AnswerVault Engine."
    : "Your question is almost there. Add a bit more context or specifics, and Input Check will be able to generate a sharper answer.";

  const nextBestQuestion = isClear
    ? "What extra context or constraints would make this answer more actionable for you?"
    : "Can you add one sentence about your goal, timeframe, or constraints so the answer can be more precise?";

  const slugBase =
    cleanedQuestion
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "input-check-question";

  // --- EngineResponse payload matching your v1 contract ---
  const responsePayload = {
    inputcheck: {
      cleaned_question: cleanedQuestion,
      flags,                       // e.g., ["too_short"]
      score_10: score,             // number 0–10
      grade_label: gradeLabel,     // e.g., "Good, mostly clear"
      clarification_required: !isClear,
      next_best_question: nextBestQuestion
    },
    mini_answer: miniAnswer,
    vault_node: {
      slug: slugBase,
      vertical_guess: "general",
      cmn_status: "draft",
      public_url: null
    },
    share_blocks: {
      answer_only: miniAnswer,
      answer_with_link:
        miniAnswer +
        "\n\nRe-run this question in Input Check: https://theanswervault.com/"
    }
  };

  return res.status(200).json(responsePayload);
}
