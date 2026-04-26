// supabase/functions/parse-programme-pdf/index.ts
//
// Receives: { storage_path: string } — path to a PDF in the project-docs bucket.
// Returns: { tasks: [...], raw_response: string, model: string }
//
// Tasks shape: [{ name, start_date, end_date, parent_name?, color? }]
//
// Run with `supabase functions deploy parse-programme-pdf`.
// Requires secret ANTHROPIC_API_KEY (already set).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
}

const SYSTEM_PROMPT = `You are an expert construction project programme analyst. You will receive a PDF that contains a Gantt chart / project programme (typically exported from Asta Powerproject, Microsoft Project, Primavera, or similar).

Your job: extract every visible task as structured JSON.

For each task, identify:
- name: the task name as written
- start_date: in ISO format YYYY-MM-DD
- end_date: in ISO format YYYY-MM-DD (the day the task finishes, inclusive)
- parent_name: the name of the parent task/group if this task is indented under another, otherwise null
- is_milestone: true if it's a milestone (zero-duration, usually shown as a diamond), false for normal tasks
- color: hex color of the bar if visible, e.g. "#448a40", or null if standard

CRITICAL RULES:
1. Output ONLY valid JSON, nothing else. No markdown, no \`\`\`json fences, no commentary.
2. Use the date axis at the top of the chart to determine bar start/end dates accurately.
3. If a date is ambiguous, use your best estimate based on the bar's visual position.
4. Preserve the order tasks appear in the chart.
5. Group/summary tasks (with sub-tasks indented under them) must also be included with their full span.
6. If you cannot determine dates reliably, set them to null and the user will fix manually.
7. Skip empty rows or page-break artifacts.

Output format:
{
  "tasks": [
    { "name": "...", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "parent_name": null | "Parent Name", "is_milestone": false, "color": null }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "Optional brief note about anything ambiguous"
}`

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  try {
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret not set")

    const body = await req.json()
    const storagePath: string | undefined = body?.storage_path
    if (!storagePath) throw new Error("storage_path is required")

    // Fetch PDF from Supabase storage using service role
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
    const { data: blob, error: dlErr } = await supa.storage.from("project-docs").download(storagePath)
    if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message || "no data"}`)

    // Convert blob -> base64
    const arrayBuf = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuf)
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const base64Pdf = btoa(binary)

    // Call Claude with PDF input
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
            { type: "text", text: "Extract all tasks from this project programme PDF. Output strict JSON only." },
          ],
        }],
      }),
    })

    if (!claudeResp.ok) {
      const errText = await claudeResp.text()
      throw new Error(`Claude API error ${claudeResp.status}: ${errText}`)
    }

    const data = await claudeResp.json()
    const rawText: string = data?.content?.[0]?.text || ""

    // Parse the JSON response (Claude should return strict JSON; strip any defensive fences just in case)
    let parsed: any = null
    let parseError: string | null = null
    try {
      const cleaned = rawText.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "")
      parsed = JSON.parse(cleaned)
    } catch (e) {
      parseError = (e as Error).message
    }

    return new Response(JSON.stringify({
      ok: !parseError,
      tasks: parsed?.tasks || [],
      confidence: parsed?.confidence || "unknown",
      notes: parsed?.notes || null,
      raw_response: rawText,
      parse_error: parseError,
      model: data?.model,
      usage: data?.usage,
    }), { headers: { ...CORS, "Content-Type": "application/json" } })

  } catch (err) {
    console.error("[parse-programme-pdf]", err)
    return new Response(JSON.stringify({
      ok: false,
      error: (err as Error).message,
    }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } })
  }
})
