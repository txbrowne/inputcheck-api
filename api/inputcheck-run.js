// api/raptor4-entity-stack-run.js
// Raptor-4 Entity Stack → CPDC Engine
// Input: full entity_stack JSON (parent + child_entities)
// Output: Canonical Product Definition Capsules (CPDC) JSON

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL = process.env.RAPTOR4_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

// Engine ID used in responses
const ENGINE_ID = "raptor4_entity_stack_v1";

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
    "r4_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

// Fallback error payload if OpenAI or server fails
function buildFallback(entity_name, entity_root_url, reason, rawModelContent) {
  const safeName = (entity_name || "").toString().trim() || "UNKNOWN_ENTITY";
  const safeUrl = (entity_root_url || "").toString().trim() || "";

  const payload = {
    engine: ENGINE_ID,
    ok: false,
    entity_name: safeName,
    entity_root_url: safeUrl,
    cpdc: [],
    meta: {
      model: OPENAI_MODEL,
      engine_version: ENGINE_ID,
      backend_error: true,
      reason: reason || "fallback",
      request_id: null,
      processing_time_ms: null
    }
  };

  // Optional: expose raw model content for debugging if parse fails
  if (rawModelContent) {
    payload.raw_model_content = rawModelContent;
  }

  return payload;
}

// Try to robustly parse model JSON, handling common issues like ```json fences
function safeParseModelContent(raw) {
  if (typeof raw !== "string") return null;

  // First attempt: strict parse
  try {
    return JSON.parse(raw);
  } catch (_err) {
    // fall through
  }

  let cleaned = raw.trim();

  // Strip markdown code fences like ```json ... ```
  if (cleaned.startsWith("```")) {
    // Remove opening fence and optional language tag
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
    // Remove trailing fence
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();
  }

  // Second attempt: parse cleaned JSON
  try {
    return JSON.parse(cleaned);
  } catch (_err2) {
    // If this still fails, give up and let the caller decide
    return null;
  }
}

// ----------------------------
// Main handler
// ----------------------------
export default async function handler(req, res) {
  const reqId = makeRequestId();
  const startTime = Date.now();
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    // CORS preflight
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
    const fb = buildFallback("", "", "missing_OPENAI_API_KEY_on_server");
    fb.meta.request_id = reqId;
    res.status(500).json(fb);
    return;
  }

  // ----------------------------
  // Parse body (full entity_stack JSON – same as your NVIDIA blob)
  // ----------------------------
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (err) {
      console.error(`[${reqId}] Invalid JSON body`, err);
      res.status(400).json({ error: "Body must be valid JSON" });
      return;
    }
  }
  body = body || {};

  const entity_name = (body.entity_name || "").toString().trim();
  const entity_root_url = (body.entity_root_url || "").toString().trim();

  if (!entity_name || !entity_root_url) {
    res.status(400).json({
      error: "entity_name and entity_root_url are required"
    });
    return;
  }

  // Pull out fields we care about (and pass child_entities through)
  const engine = (body.engine || "").toString().trim();
  const entity_type = (body.entity_type || "").toString().trim();
  const primary_lane = (body.primary_lane || "").toString().trim();
  const short_handle = (body.short_handle || "").toString().trim();
  const summary_25w = (body.summary_25w || "").toString().trim();
  const notes = (body.notes || "").toString().trim();
  const child_entities = Array.isArray(body.child_entities)
    ? body.child_entities
    : [];

  // ----------------------------
  // Raptor-4 CPDC System Prompt
  // ----------------------------
  const systemPrompt = `
RAPTOR-4 CPDC ENGINE – v1.0 · 2025-12-11

You take ONE entity stack JSON (a parent entity plus child entities) and emit
Canonical Product Definition Capsules (CPDCs).

You do NOT need to browse the web. Treat the incoming JSON as already researched.
Your job is to compress it into AI Overview–style product definition capsules.

You will receive a JSON object with fields like:
- engine
- entity_name
- entity_root_url
- entity_type
- primary_lane
- short_handle
- summary_25w
- notes
- child_entities[] with keys:
  - name
  - entity_type
  - tier_role
  - primary_customer_archetype
  - lane
  - canonical_question
  - search_intent_cluster[]
  - priority_score
  - cpdc_needed (boolean)
  - notes

Your output is a JSON object with:
{
  "engine": "raptor4_entity_stack_v1",
  "entity_name": "...",
  "entity_root_url": "...",
  "cpdc": [
    {
      "entity": "parent or child name",
      "entity_type": "company|product|product_family|platform|...",
      "lane": "short lane descriptor",
      "priority_score": number,
      "canonical_question": "string",
      "definition_capsule_25w": "≈25 word AI Overview–style definition.",
      "definition_expanded": "2–5 sentences expanding the capsule in clear language.",
      "meta": {
        "tier_role": "core_flagship|mid_core|niche",
        "primary_customer_archetype": "one-sentence archetype",
        "search_intent_cluster": ["...", "..."]
      }
    }
  ]
}

Rules:
- Only include child_entities where cpdc_needed is true.
- Also include ONE parent-level CPDC for the main entity_name.
- Keep capsules concrete, neutral, and definitional (like a high-quality dictionary for products).
- Never write sales copy or hype.
- Answer canonical_question implicitly: define the entity and who/when it’s for.
- Output MUST be valid JSON, no markdown, no code fences, no extra commentary.
`.trim();

  // ----------------------------
  // Call OpenAI
  // ----------------------------
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
        temperature: 0.1,
        max_tokens: 1400,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            // Pass the entity stack through, already cleaned
            content: JSON.stringify({
              engine,
              entity_name,
              entity_root_url,
              entity_type,
              primary_lane,
              short_handle,
              summary_25w,
              notes,
              child_entities
            })
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      console.error(`[${reqId}] OpenAI error ${openaiRes.status}:`, text);
      const fb = buildFallback(
        entity_name,
        entity_root_url,
        "openai_http_" + openaiRes.status
      );
      fb.meta.request_id = reqId;
      fb.meta.processing_time_ms = Date.now() - startTime;
      res.status(500).json(fb);
      return;
    }

    completion = await openaiRes.json();
  } catch (err) {
    console.error(`[${reqId}] OpenAI fetch error`, err);
    const fb = buildFallback(
      entity_name,
      entity_root_url,
      "openai_network_error"
    );
    fb.meta.request_id = reqId;
    fb.meta.processing_time_ms = Date.now() - startTime;
    res.status(500).json(fb);
    return;
  }

  const rawContent = completion?.choices?.[0]?.message?.content || "{}";

  let payload = safeParseModelContent(rawContent);
  if (!payload) {
    console.error(
      `[${reqId}] JSON parse error from model content; returning fallback`
    );
    const fb = buildFallback(
      entity_name,
      entity_root_url,
      "invalid_json_from_model",
      rawContent
    );
    fb.meta.request_id = reqId;
    fb.meta.processing_time_ms = Date.now() - startTime;
    res.status(500).json(fb);
    return;
  }

  const processing_time_ms = Date.now() - startTime;

  const responseBody = {
    engine: ENGINE_ID,
    ok: true,
    entity_name,
    entity_root_url,
    cpdc: Array.isArray(payload.cpdc) ? payload.cpdc : [],
    meta: {
      model: OPENAI_MODEL,
      engine_version: ENGINE_ID,
      backend_error: false,
      reason: "",
      request_id: reqId,
      processing_time_ms
    }
  };

  res.status(200).json(responseBody);
}
