// ─────────────────────────────────────────────────────────────────────────────
// suggest-escalation-rate
//
// Given a CSA-section category (PRELIMINARIES, MAIN WORKS, EXTERNAL WORKS,
// PROVISIONAL SUMS, DEFAULT), asks Claude — with web search enabled — to
// propose a sensible annual price-escalation percentage for UK construction
// in that category, plus a short rationale grounded in current market
// commentary.
//
// This is an ADVISORY helper. The admin reviews the suggestion and decides
// whether to use it; the number is never written to the rates table by this
// function. Material price moves (esp. geopolitical) aren't reliably
// predictable, so a human stays in control of the figure that prices a job.
//
// Requires secret ANTHROPIC_API_KEY (already set for other functions).
//
// Request:  { category: string }
// Response: { ok: boolean, annual_pct: number|null, rationale: string,
//             error?: string, model?: string, usage?: object }
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
}

// Map a CSA section to a plain-English description of what it covers, so
// the model prices the right basket of work.
const CATEGORY_HINTS: Record<string, string> = {
  "PRELIMINARIES": "site setup, management, welfare, plant, scaffolding, site overheads",
  "MAIN WORKS": "structural and building works — groundworks, concrete, steel, masonry, carpentry, roofing, finishes",
  "EXTERNAL WORKS": "hard and soft landscaping, drainage, roads, paving, boundary works",
  "PROVISIONAL SUMS": "allowances for as-yet-undefined work — treat as general building cost inflation",
  "DEFAULT": "general UK construction works (mixed basket)",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret not set")

    const { category } = await req.json()
    const cat = String(category || "DEFAULT").toUpperCase().trim()
    const hint = CATEGORY_HINTS[cat] || CATEGORY_HINTS["DEFAULT"]

    const today = new Date().toISOString().slice(0, 10)

    const systemPrompt =
      "You are a UK quantity-surveying assistant helping a construction company " +
      "set an annual price-escalation rate for tender estimating. You give a single " +
      "sensible annual percentage for the named category of work, grounded in recent " +
      "UK construction cost trends. Use web search to check current figures (BCIS, ONS " +
      "construction material price indices, trade press). Be conservative and honest: " +
      "if the outlook is uncertain, say so and lean to a moderate figure. Material and " +
      "labour costs can move sharply with geopolitical events, so frame your number as " +
      "a reasonable planning assumption, not a prediction.\n\n" +
      "Respond with ONLY a JSON object, no prose, no markdown fences:\n" +
      '{ "annual_pct": <number>, "rationale": "<one or two short sentences citing what you found>" }'

    const userText =
      `Today is ${today}. Suggest an annual price-escalation rate (%) for the UK ` +
      `construction category "${cat}" (covers: ${hint}). ` +
      `Search for the most recent UK construction cost inflation figures relevant to this category.`

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: userText }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      }),
    })

    if (!claudeResp.ok) {
      const errText = await claudeResp.text()
      throw new Error(`Claude API error ${claudeResp.status}: ${errText}`)
    }

    const data = await claudeResp.json()

    // The response may interleave web_search tool blocks and text blocks.
    // Collect all text blocks and use the last JSON-looking one.
    const textBlocks: string[] = (data?.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text || "")

    const joined = textBlocks.join("\n").trim()

    let parsed: any = null
    let parseError: string | null = null
    // Find the last {...} block in the text and parse it.
    const match = joined.match(/\{[\s\S]*\}/)
    try {
      const candidate = match ? match[0] : joined.replace(/^```json\n?/, "").replace(/\n?```$/, "")
      parsed = JSON.parse(candidate)
    } catch (e) {
      parseError = (e as Error).message
    }

    let pct = parsed?.annual_pct
    pct = typeof pct === "number" ? pct : (pct != null ? parseFloat(pct) : null)
    // Clamp to a sane planning range so a model slip can't propose nonsense.
    if (pct != null && Number.isFinite(pct)) {
      pct = Math.max(0, Math.min(pct, 25))
      pct = Math.round(pct * 10) / 10
    } else {
      pct = null
    }

    return jsonResponse({
      ok: pct != null,
      annual_pct: pct,
      rationale: parsed?.rationale || (parseError ? "Could not parse a clear figure — set manually." : ""),
      error: pct == null ? "No usable figure returned." : undefined,
      model: data?.model,
      usage: data?.usage,
    })
  } catch (err) {
    return jsonResponse({ ok: false, annual_pct: null, rationale: "", error: (err as Error).message }, 200)
  }
})
