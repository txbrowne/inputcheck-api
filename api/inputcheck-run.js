// api/raptor4-entity-stack.js
// Raptor-4 Entity Stack Lane Engine – entity_root_url -> ENTITY + child_entities (CPDC-ready)

"use strict";

// ----------------------------
// Config
// ----------------------------
const OPENAI_MODEL = process.env.RAPTOR4_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

const ENGINE_VERSION = "raptor4-entity-stack-v1.0";

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

function buildFallback(entity_name, entity_root_url, reason) {
  const safeName = (entity_name || "").toString().trim() || "UNKNOWN_ENTITY";
  const safeUrl = (entity_root_url || "").toString().trim() || "";

  return {
    engine: "raptor4_entity_stack_v1",
    entity_name: safeName,
    entity_root_url: safeUrl,
    entity_type: "unknown",
    primary_lane: "unknown",
    short_handle: safeName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    summary_25w:
      "Fallback entity record returned when the Raptor-4 engine cannot complete; do not treat this as a canonical definition.",
    notes: reason || "fallback",
    child_entities: [],
    meta: {
      engine_version: ENGINE_VERSION,
      model: OPENAI_MODEL,
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
    res.status(200).json(fb);
    return;
  }

  // ----------------------------
  // Parse body
  // ----------------------------
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_err) {
      body = {};
    }
  }
  body = body || {};

  const entity_name = (body.entity_name || "").toString().trim();
  const entity_root_url = (body.entity_root_url || "").toString().trim();
  const entity_type_hint = (body.entity_type_hint || "").toString().trim();
  const primary_lane_hint = (body.primary_lane_hint || "").toString().trim();
  const notes = (body.notes || "").toString().trim();

  if (!entity_name || !entity_root_url) {
    res.status(400).json({
      error: "entity_name and entity_root_url are required"
    });
    return;
  }

  // ----------------------------
  // Raptor-4 Entity Stack System Prompt
  // ----------------------------
  const systemPrompt = `
RAPTOR-4 ENTITY STACK LANE ENGINE – v1.0

ROLE
You are Raptor-4, the Entity Stack Lane Engine for AnswerVault.
Your job: given ONE top-level entity (usually a company or flagship product) and its root URL,
you manufacture a high-resolution ENTITY STACK ready for Canonical Product Definition Capsules (CPDCs).

You DO NOT write sales copy.
You DO NOT output prose paragraphs.
You ONLY output ONE JSON object describing:
- the parent entity, and
- a focused list of child entities that each deserve their own CPDC later.

------------------------
INPUT (user message JSON)
------------------------
You will receive a JSON object like:

{
  "entity_name": "NVIDIA",
  "entity_root_url": "https://www.nvidia.com/en-us/",
  "entity_type_hint": "company | product | platform | brand | other",
  "primary_lane_hint": "optional lane / niche hint",
  "notes": "optional internal notes from the operator"
}

Semantics:
- entity_name: the canonical name of the parent entity.
- entity_root_url: the main, official URL that best represents this entity.
- entity_type_hint: optional; you may override if the web evidence clearly indicates a better type.
- primary_lane_hint: optional; rough lane like "AI & accelerated computing", "email marketing SaaS", etc.
- notes: optional operator hints; do not echo into output.

Research behaviour (conceptual, not literal browsing):
- Treat entity_root_url as your primary evidence anchor.
- Infer what this entity is, what lane it plays in, and what its major product lines / platforms are.
- Build a compact but complete mental map of:
  - who this entity serves,
  - how it makes money,
  - which products or platforms carry the most strategic weight.

High-level intent:
- The output will feed a Canonical Product Definition Capsule engine later.
- Every child entity you include should be important enough to merit its own “What is X and who is it for?” CPDC.
- Prioritize clarity, lane coverage, and monetizable / high-intent surfaces over long tail trivia.

------------------------
OUTPUT SCHEMA (JSON ONLY)
------------------------
Return EXACTLY ONE JSON object with these top-level keys:

{
  "engine": "raptor4_entity_stack_v1",
  "entity_name": "string",
  "entity_root_url": "string",
  "entity_type": "company | product | platform | brand | other",
  "primary_lane": "short lane description",
  "short_handle": "machine_friendly_handle",
  "summary_25w": "≈25-word canonical definition of the parent entity",
  "notes": "short operator-facing note about the scope of this entity stack",
  "child_entities": [ ... child objects ... ]
}

Rules:

- engine: ALWAYS "raptor4_entity_stack_v1".
- entity_name: cleaned, human-readable name.
- entity_root_url: echo the main URL.
- entity_type: your best fit (company, product, platform, brand, other).
- primary_lane: one concise lane like "AI & accelerated computing", "email marketing SaaS", "consumer EV manufacturer".
- short_handle: lower_snake_case or lower_kebab-case handle derived from the entity name (e.g. "nvidia_corporation").
- summary_25w: a tight, ≈25-word canonical definition suitable for an AI Overview.
- notes: 1–2 sentences, internal only, explaining what this stack covers.

child_entities: an ARRAY of child entity objects.
Each child entity MUST have at least:

{
  "name": "string",
  "entity_type": "product | product_family | platform | service | program | other",
  "tier_role": "core_flagship | mid_core | niche",
  "primary_customer_archetype": "1–2 sentence description of who buys/uses this",
  "lane": "short lane / category for this child",
  "canonical_question": "What is X and who is it for?",
  "search_intent_cluster": ["what is x", "x pricing", "x vs alternative", "x use cases"],
  "priority_score": 1–10,
  "cpdc_needed": true | false,
  "notes": "1–2 sentences of internal guidance for CPDC writers"
}

Guidance:

- 6–12 child_entities is usually ideal for a large company.
- Mark core strategic lines as "core_flagship" and give them higher priority_score (8–10).
- Mark important but secondary lines as "mid_core".
- Use "niche" sparingly for edge offerings that still attract meaningful search intent.
- Always set cpdc_needed = true for entities that clearly deserve their own “What is X?” definition node.
- Do NOT include resellers, distributors, or generic concepts (e.g. "AI", "cloud") as child entities.

------------------------
CONSTRAINTS
------------------------
- Output MUST be valid JSON, no comments, no markdown, no extra text.
- Do NOT invent products that obviously contradict the likely portfolio of the entity.
- Assume a smart, time-constrained operator who will use this as input to downstream engines.
- Be decisive: better to produce a sharp, opinionated entity stack than a vague or bloated one.
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
        temperature: 0.15,
        top_p: 0.9,
        max_tokens: 1400,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              entity_name,
              entity_root_url,
              entity_type_hint,
              primary_lane_hint,
              notes
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
        "OpenAI HTTP " + openaiRes.status
      );
      fb.meta.request_id = reqId;
      fb.meta.processing_time_ms = Date.now() - startTime;
      res.status(200).json(fb);
      return;
    }

    completion = await openaiRes.json();
  } catch (err) {
    console.error(`[${reqId}] OpenAI fetch error:`, err);
    const fb = buildFallback(
      entity_name,
      entity_root_url,
      "OpenAI network or fetch error"
    );
    fb.meta.request_id = reqId;
    fb.meta.processing_time_ms = Date.now() - startTime;
    res.status(200).json(fb);
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
    const fb = buildFallback(
      entity_name,
      entity_root_url,
      "invalid JSON from model"
    );
    fb.meta.request_id = reqId;
    fb.meta.processing_time_ms = Date.now() - startTime;
    res.status(200).json(fb);
    return;
  }

  // ----------------------------
  // Coerce + meta attach
  // ----------------------------
  if (!payload.engine) {
    payload.engine = "raptor4_entity_stack_v1";
  }
  if (!payload.entity_name) {
    payload.entity_name = entity_name;
  }
  if (!payload.entity_root_url) {
    payload.entity_root_url = entity_root_url;
  }
  if (!Array.isArray(payload.child_entities)) {
    payload.child_entities = [];
  }

  const processing_time_ms = Date.now() - startTime;

  payload.meta = {
    engine_version: ENGINE_VERSION,
    model: OPENAI_MODEL,
    backend_error: false,
    reason: "",
    request_id: reqId,
    processing_time_ms
  };

  res.status(200).json(payload);
}
