// supabase/functions/parse-compliance-doc/index.ts
//
// Receives: { pdf_base64: string, document_types: string[] }
// Returns: { ok, expiry_date, issue_date, reference_number, cover_amounts, confidence, notes }
//
// pdf_base64 is the file contents encoded as base64 (no data: prefix).
// We accept the file directly rather than a storage_path so the browser
// doesn't need to upload first — keeps the modal flow clean (user can
// cancel without leaving an orphan file in storage).
//
// document_types is the list of compliance types the user has selected,
// e.g. ['public_liability', 'employers_liability']. Used to tell Claude
// what kind of document to expect and whether cover amount applies.
//
// Run with `supabase functions deploy parse-compliance-doc`.
// Requires secret ANTHROPIC_API_KEY (already set for parse-programme-pdf).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
}

// Map of document_type -> human-readable label, mirrors DOCUMENT_TYPES in
// src/lib/utils.js. We pass this into the prompt so Claude knows what
// document(s) to expect.
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  public_liability:        "Public Liability Insurance",
  employers_liability:     "Employer's Liability Insurance",
  professional_indemnity:  "Professional Indemnity Insurance",
  rams:                    "RAMS (Risk Assessment & Method Statement)",
  method_statement:        "Method Statement",
  risk_assessment:         "Risk Assessment",
  cscs_card:               "CSCS Card",
  gas_safe:                "Gas Safe Certificate",
  niceic:                  "NICEIC Certificate",
  chas:                    "CHAS Accreditation",
  constructionline:        "Constructionline",
  iso_9001:                "ISO 9001 Quality",
  iso_14001:               "ISO 14001 Environmental",
  iso_45001:               "ISO 45001 Health & Safety",
  f10_notification:        "F10 CDM Notification",
  trade_certificate:       "Trade Certificate",
  other:                   "Other Document",
}

// Insurance types are the only ones that have a cover amount.
const INSURANCE_TYPES = new Set(["public_liability", "employers_liability", "professional_indemnity"])

const SYSTEM_PROMPT = `You are a document analyst for a UK construction company. You will receive a PDF that is one of: an insurance certificate, an accreditation certificate (CHAS, NICEIC, Gas Safe, ISO etc.), a CSCS card, an F10 notification, or a similar compliance document.

Your job: extract the key fields used to track the document in a CRM.

Return JSON in this exact shape:
{
  "expiry_date": "YYYY-MM-DD" | null,
  "issue_date": "YYYY-MM-DD" | null,
  "reference_number": "string" | null,
  "cover_amounts": { "public_liability": number, "employers_liability": number, "professional_indemnity": number } | null,
  "confidence": "high" | "medium" | "low",
  "notes": "string" | null
}

Field guidance:
- expiry_date: the date the document/cover ENDS. Often labelled "Expiry Date", "Valid To", "Renewal Date", "End Date", "To". UK date format is DD/MM/YYYY — be careful: 01/02/2026 is 1 February 2026, NOT 2 January.
- issue_date: when the document/cover STARTED. Labels: "Issue Date", "Valid From", "Effective Date", "From". Optional — set to null if not visible.
- reference_number: the most prominent unique identifier on the document. Common labels: "Policy Number", "Certificate Number", "Reference", "Membership Number", "Registration Number", "F10 Reference". For a CSCS card use the card number. For Gas Safe use the registration number. If multiple references appear, pick the one most likely to be the "main" identifier.
- cover_amounts: ONLY for insurance documents (public_liability, employers_liability, professional_indemnity). Extract the LIMIT OF INDEMNITY in GBP as a plain integer (e.g. 5000000 for £5,000,000). If multiple cover types appear on one certificate, populate each one separately. If the document is not insurance, set cover_amounts to null.
- confidence: "high" if all expected fields are clearly visible and unambiguous; "medium" if some fields required interpretation; "low" if the document is unclear, hand-scanned, or many fields were guessed.
- notes: brief observation about anything unusual — e.g. "Reference number not labelled, used certificate number from header" or "Two policies on one certificate, picked the higher cover".

CRITICAL RULES:
1. Output ONLY valid JSON. No markdown, no fences, no commentary.
2. UK date format. Default to DD/MM/YYYY interpretation when ambiguous.
3. If a field is not present or you cannot read it confidently, return null. DO NOT guess.
4. cover_amounts values must be plain integers in GBP (no commas, no £ symbol, no "million").
5. reference_number should be returned as-is from the document (preserve hyphens, slashes, casing).`

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
    const pdfBase64: string | undefined = body?.pdf_base64
    const documentTypes: string[] = Array.isArray(body?.document_types) ? body.document_types : []

    if (!pdfBase64) throw new Error("pdf_base64 is required")
    if (documentTypes.length === 0) throw new Error("document_types array is required (at least one)")

    // Build the user-facing prompt that lists expected document types.
    // This helps Claude know what to look for, especially when multiple
    // types are bundled on one certificate (e.g. a single insurance doc
    // covering both public + employer liability).
    const typeLabels = documentTypes
      .map(t => DOCUMENT_TYPE_LABELS[t] || t)
      .join(", ")
    const hasInsurance = documentTypes.some(t => INSURANCE_TYPES.has(t))
    const userText = `This document is expected to be: ${typeLabels}.\n` +
      (hasInsurance
        ? `It includes insurance, so populate cover_amounts for the relevant policy types: ${documentTypes.filter(t => INSURANCE_TYPES.has(t)).join(", ")}.`
        : `This is not an insurance document — set cover_amounts to null.`) +
      `\n\nExtract the fields and return strict JSON only.`

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,  // small response — much cheaper than the programme parser
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: userText },
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

    // Parse the JSON response. Strip any defensive ``` fences just in case.
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
      expiry_date: parsed?.expiry_date || null,
      issue_date: parsed?.issue_date || null,
      reference_number: parsed?.reference_number || null,
      cover_amounts: parsed?.cover_amounts || null,
      confidence: parsed?.confidence || "unknown",
      notes: parsed?.notes || null,
      raw_response: rawText,
      parse_error: parseError,
      model: data?.model,
      usage: data?.usage,
    }), { headers: { ...CORS, "Content-Type": "application/json" } })

  } catch (err) {
    console.error("[parse-compliance-doc]", err)
    return new Response(JSON.stringify({
      ok: false,
      error: (err as Error).message,
    }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } })
  }
})
