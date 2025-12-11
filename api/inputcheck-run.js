// api/raptor4-entity-stack.js
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

const ENGINE_VERSION = "raptor4-entity-stack-v1";

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
function buildFallback(entity_name, entity_root_url, reason) {
  const safeName = (entity_name || "").toString().trim() || "UNKNOWN_ENTITY";
  const safeUrl = (entity_root_url || "").toString().trim() || "";

  return {
    engine: ENGINE_VERSION,
    ok: false,
    entity_name: safeName,
    entity_root_url: safeUrl,
    cpdc: [],
    meta: {
      model: OPENAI_MODEL,
      engine_version: ENGINE_VERSION,
      backend_error: true,
      reason: reason || "fallback",
      request_id: null,
      processing_time_ms: null
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
    const fb = buildFallback("", "", "missing OPENAI_API_KEY on server");
    fb.meta.request_id = reqId;
    res.status(500).json(fb);
    return;
  }

  // ----------------------------
  // Parse body (full entity_stack JSON)
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

  const engine = (body.engine || "").toString().trim();
  const entity_name = (body.entity_name || "").toString().trim();
  const entity_root_url = (body.entity_root_url || "").toString().trim();
  const entity_type = (body.entity_type || "").toString().trim();
  const primary_lane = (body.primary_lane || "").toString().trim();
  const short_handle = (body.short_handle || "").toString().trim();
  const summary_25w = (body.summary_25w || "").toString().trim();
  const notes = (body.notes || "").toString().trim();
  const child_entities = Array.isArray(body.child_entities)
    ? body.child_entities
    : [];

  if (!entity_name || !entity_root_url) {
    res.status(400).json({
      error: "entity_name and entity_root_url are required"
    });
    return;
  }

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
      console.error(
        `[${reqId}] OpenAI error ${openaiRes.status}:`,
        text
      );
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

  const content = completion?.choices?.[0]?.message?.content || "{}";
  let payload;
  try {
    payload = JSON.parse(content);
  } catch (err) {
    console.error(
      `[${reqId}] JSON parse error from model content`,
      err,
      content
    );
    const fb = buildFallback(
      entity_name,
      entity_root_url,
      "invalid_json_from_model"
    );
    fb.meta.request_id = reqId;
    fb.meta.processing_time_ms = Date.now() - startTime;
    res.status(500).json(fb);
    return;
  }

  const processing_time_ms = Date.now() - startTime;

  const responseBody = {
    engine: ENGINE_VERSION,
    ok: true,
    entity_name,
    entity_root_url,
    cpdc: Array.isArray(payload.cpdc) ? payload.cpdc : [],
    meta: {
      model: OPENAI_MODEL,
      engine_version: ENGINE_VERSION,
      backend_error: false,
      reason: "",
      request_id: reqId,
      processing_time_ms
    }
  };

  res.status(200).json(responseBody);
}
