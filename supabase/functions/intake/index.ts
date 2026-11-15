// supabase/functions/intake/index.ts
//
// Automatic filing from Google Drive.
//
// Your email automation saves attachments into one Google Drive folder. Every
// 5 minutes (pg_cron, see supabase-sql/040_intake.sql) this function:
//   1. lists files added to that folder (and its sub-folders) since last time
//   2. reads each one with Claude — what it is, which job, which subcontractor
//   3. files it in the CRM when it's sure, otherwise leaves it in Inbox › To check
//
//   drawing, survey/report, our PA, client payment notice, VO, programme, RAMS
//        → the job's Documents folder (client can't see it until you show it)
//   insurance, certificate, accreditation → the subcontractor's Compliance
//   subcontractor / supplier quote → the job's quote request in Quotes
//   invoices → left alone (Xero handles them); signatures/logos → ignored
//
// Google Drive is only READ — nothing there is moved, renamed or deleted.
// Nothing already in the CRM is changed or deleted.
//
// Actions (POST JSON):
//   { action: 'run' }                         cron (x-intake-key) or staff "Check now"
//   { action: 'file', item_id, decision }     staff files an item from To check
//   { action: 'ignore', item_id }             staff
//   { action: 'retry', item_id }              staff — read it again
//   { action: 'url', item_id }                staff — signed link to the file
//
// Deploy:  supabase functions deploy intake --no-verify-jwt
// Secrets: ANTHROPIC_API_KEY (already set), GOOGLE_SERVICE_ACCOUNT_JSON, INTAKE_CRON_KEY
//          (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by Supabase)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1"
import * as XLSX from "https://esm.sh/xlsx@0.18.5"
import JSZip from "https://esm.sh/jszip@3.10.1"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const CRON_KEY = Deno.env.get("INTAKE_CRON_KEY") || ""
const MODEL = "claude-sonnet-4-5"          // same model as the other CRM functions
const BUCKET = "project-docs"
const TASK_BUCKET = "task-files"
const FILERS = ["admin", "project_manager", "operations_manager", "project_director", "document_controller"]
const MAX_BYTES = 40_000_000               // bigger files wait in To check
const BATCH = 6                            // files read per run
const TIME_BUDGET_MS = 110_000

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-intake-key",
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } })

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })

// ─── Where each kind of document goes ────────────────────────────────────────
const PROJECT_FOLDERS: Record<string, { folder_key: string; subfolder_key: string | null; label: string }> = {
  drawing:               { folder_key: "00-project-information", subfolder_key: "drawings", label: "Documents › 01. Drawings" },
  survey_report:         { folder_key: "00-project-information", subfolder_key: "reports",  label: "Documents › 02. Surveys & Reports" },
  rams:                  { folder_key: "00-project-information", subfolder_key: "hs",       label: "Documents › 06. Health & Safety" },
  planning:              { folder_key: "00-project-information", subfolder_key: "planning", label: "Documents › 09. Planning" },
  meeting_minutes:       { folder_key: "00-project-information", subfolder_key: "meetings", label: "Documents › 11. Meetings" },
  our_payment_application: { folder_key: "02-payment-application", subfolder_key: null, label: "02. Payment Application" },
  client_payment_notice: { folder_key: "03-payment-notice",      subfolder_key: null, label: "03. Payment Notice (Client)" },
  variation:             { folder_key: "04-variations",          subfolder_key: null, label: "04. Variations" },
  programme:             { folder_key: "06-project-programme",   subfolder_key: null, label: "06. Project Programme" },
}
const COMPLIANCE_TYPES = [
  "public_liability", "employers_liability", "professional_indemnity", "rams", "method_statement", "risk_assessment",
  "cscs_card", "gas_safe", "niceic", "chas", "constructionline", "iso_9001", "iso_14001", "iso_45001",
  "f10_notification", "waste_carrier_licence", "trade_certificate", "other",
]
const INSURANCE_TYPES = ["public_liability", "employers_liability", "professional_indemnity"]
const DOC_TYPES = [
  "drawing", "survey_report", "rams", "planning", "meeting_minutes",
  "our_payment_application", "client_payment_notice", "variation", "programme",
  "subcontractor_quote", "supplier_quote", "insurance", "certificate", "accreditation",
  "invoice", "other",
]

// ─── Small helpers ───────────────────────────────────────────────────────────
const safeName = (n: string) => String(n)
  .replace(/[—–]/g, "-").normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\x20-\x7E]/g, "").replace(/[#?%{}\\^~\[\]`>|<\/:*"]/g, "-")
  .replace(/\s{2,}/g, " ").trim() || "file"
const extOf = (n: string) => (n.match(/\.([a-z0-9]{1,6})$/i)?.[1] || "").toLowerCase()
const b64url = (bytes: Uint8Array) => {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const b64 = (bytes: Uint8Array) => {
  let s = ""; const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

// ─── Google Drive (read-only service account) ────────────────────────────────
let gToken: { token: string; exp: number } | null = null
async function googleToken() {
  if (gToken && gToken.exp > Date.now() + 60_000) return gToken.token
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON secret is not set")
  const sa = JSON.parse(raw)
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)))
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  })
  if (!r.ok) throw new Error(`Google sign-in failed (${r.status}): ${(await r.text()).slice(0, 200)}`)
  const d = await r.json()
  gToken = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 }
  return gToken.token
}
async function drive(path: string, params: Record<string, string> = {}) {
  const u = new URL(`https://www.googleapis.com/drive/v3/${path}`)
  for (const [k, v] of Object.entries({ supportsAllDrives: "true", ...params })) u.searchParams.set(k, v)
  const r = await fetch(u, { headers: { Authorization: `Bearer ${await googleToken()}` } })
  if (!r.ok) throw new Error(`Drive ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r
}

// Folder path from the watched folder down to the file ("" = top level).
// Returns null when the file isn't inside the watched folder.
const folderCache = new Map<string, { name: string; parents: string[] }>()
async function pathInside(parents: string[] | undefined, rootId: string): Promise<string | null> {
  let cur = parents?.[0]
  const names: string[] = []
  for (let depth = 0; cur && depth < 10; depth++) {
    if (cur === rootId) return names.reverse().join(" / ")
    let f = folderCache.get(cur)
    if (!f) {
      try {
        const d = await (await drive(`files/${cur}`, { fields: "name,parents" })).json()
        f = { name: d.name, parents: d.parents || [] }
      } catch { f = { name: "", parents: [] } }
      folderCache.set(cur, f)
    }
    names.push(f.name)
    cur = f.parents[0]
  }
  return null
}

async function discover(settings: any) {
  // Look back a little before the newest file already seen, so nothing slips
  // through; the unique (source, source_file_id) key stops double entries.
  const { data: newest } = await sb.from("intake_items").select("source_created_at")
    .eq("source", "gdrive").order("source_created_at", { ascending: false, nullsFirst: false }).limit(1)
  const startFrom = new Date(settings.start_from).getTime()
  const seen = newest?.[0]?.source_created_at ? new Date(newest[0].source_created_at).getTime() - 2 * 3600_000 : 0
  const since = new Date(Math.max(startFrom, seen)).toISOString()

  let added = 0, pageToken = ""
  for (let page = 0; page < 5; page++) {
    const params: Record<string, string> = {
      q: `createdTime > '${since}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken, files(id,name,mimeType,size,md5Checksum,createdTime,parents)",
      orderBy: "createdTime", pageSize: "200", includeItemsFromAllDrives: "true", corpora: "allDrives",
    }
    if (pageToken) params.pageToken = pageToken
    const d = await (await drive("files", params)).json()
    const rows = []
    for (const f of d.files || []) {
      const path = await pathInside(f.parents, settings.drive_folder_id)
      if (path == null) continue
      rows.push({
        source: "gdrive", source_file_id: f.id, file_name: f.name, mime_type: f.mimeType,
        file_size: f.size ? Number(f.size) : null, md5: f.md5Checksum || null,
        source_path: path, source_created_at: f.createdTime, status: "pending",
      })
    }
    if (rows.length) {
      const { data } = await sb.from("intake_items").upsert(rows, { onConflict: "source,source_file_id", ignoreDuplicates: true }).select("id")
      added += data?.length || 0
    }
    pageToken = d.nextPageToken || ""
    if (!pageToken) break
  }
  return added
}

// ─── What Claude gets to read ────────────────────────────────────────────────
async function trimPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const n = src.getPageCount()
    if (n <= 5 && bytes.length < 8_000_000) return bytes
    const keep = [...new Set([0, 1, 2, n - 2, n - 1].filter(i => i >= 0 && i < n))]
    const out = await PDFDocument.create()
    ;(await out.copyPages(src, keep)).forEach((p: any) => out.addPage(p))
    return await out.save()
  } catch {
    return bytes.length < 8_000_000 ? bytes : null
  }
}
async function contentFor(name: string, mime: string, bytes: Uint8Array) {
  const ext = extOf(name)
  if (ext === "pdf" || mime === "application/pdf") {
    const pdf = await trimPdf(bytes)
    if (pdf) return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(pdf) } }]
  }
  if (/^(png|jpe?g|gif|webp)$/.test(ext) && bytes.length < 4_500_000) {
    const mt = ext === "jpg" ? "image/jpeg" : `image/${ext}`
    return [{ type: "image", source: { type: "base64", media_type: mt, data: b64(bytes) } }]
  }
  if (/^(xlsx|xlsm|xls|csv)$/.test(ext)) {
    try {
      const wb = XLSX.read(bytes, { type: "array" })
      const text = wb.SheetNames.slice(0, 3).map(s => `## Sheet: ${s}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n\n")
      return [{ type: "text", text: `Spreadsheet contents (CSV):\n${text.slice(0, 20000)}` }]
    } catch { /* fall through */ }
  }
  if (ext === "docx") {
    try {
      const zip = await JSZip.loadAsync(bytes)
      const xml = await zip.file("word/document.xml")?.async("string")
      if (xml) {
        const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n")
        return [{ type: "text", text: `Word document text:\n${text.slice(0, 20000)}` }]
      }
    } catch { /* fall through */ }
  }
  return [{ type: "text", text: "(The file's contents can't be shown — judge from its name and folder.)" }]
}

async function loadContext() {
  const [proj, subs, sups, reqs] = await Promise.all([
    sb.from("projects").select("id, project_ref, project_name, site_address, city, postcode, client_name, status").neq("status", "cancelled"),
    sb.from("subcontractors").select("id, company_name, trade, email, category"),
    sb.from("suppliers").select("id, company_name"),
    sb.from("tasks").select("id, project_id, title, status").eq("is_quote", true).neq("status", "closed").limit(600),
  ])
  // Without the job list nothing can be filed safely — stop and retry next run
  if (proj.error) throw new Error("Couldn't load jobs: " + proj.error.message)
  let subRows: any[] | null = subs.data
  if (subs.error) subRows = (await sb.from("subcontractors").select("id, company_name, trade, email")).data
  return { projects: proj.data || [], subcontractors: subRows || [], suppliers: sups.data || [], requests: reqs.data || [] }
}

function systemPrompt(ctx: Awaited<ReturnType<typeof loadContext>>) {
  const P = ctx.projects.map((p: any) => `${p.id} | ${p.project_ref || ""} | ${p.project_name || ""} | ${[p.site_address, p.city, p.postcode].filter(Boolean).join(", ")} | client: ${p.client_name || ""} | ${p.status}`).join("\n")
  const S = ctx.subcontractors.map((s: any) => `${s.id} | ${s.company_name} | ${s.trade || ""}${s.category ? " (" + s.category + ")" : ""} | ${s.email || ""}`).join("\n")
  const U = ctx.suppliers.map((s: any) => `${s.id} | ${s.company_name}`).join("\n")
  const R = ctx.requests.map((t: any) => `${t.id} | project ${t.project_id} | ${t.title}`).join("\n")
  return `You file incoming documents for City Construction Group (CCG), a UK main contractor, into its CRM.
For each file decide what it is, which CCG job it belongs to and who sent it. Use only ids from the lists below — never invent one. If you aren't sure, say so with a low confidence; a person will check it.

Document types:
- drawing: architectural/structural/MEP drawings, GA plans, sections, details, drawing registers
- survey_report: surveys, site investigations, structural/fire/acoustic reports, calcs
- rams: RAMS, method statements, risk assessments (for a job)
- planning: planning decisions, conditions, discharge documents
- meeting_minutes: minutes, site meeting notes
- our_payment_application: CCG's own payment application/valuation to the client (PA01, PA02…)
- client_payment_notice: the client's or employer's agent's payment notice / certificate to CCG
- variation: variation orders, instructions, change requests, VO schedules
- programme: construction programmes / Gantt charts
- subcontractor_quote: a price/quotation/tender from a subcontractor (labour, or supply & fit)
- supplier_quote: a price for materials/plant from a supplier
- insurance: insurance certificate/schedule (public liability, employer's liability, professional indemnity)
- certificate: trade or test certificates, CSCS, Gas Safe, NICEIC, waste carrier licence
- accreditation: CHAS, Constructionline, ISO certificates
- invoice: invoices, statements, credit notes, receipts (these are handled in Xero, not filed here)
- other: anything else (newsletters, marketing, signatures, unrelated)

Compliance document_type values: ${COMPLIANCE_TYPES.join(", ")}

CCG jobs (id | ref | name | address | client | status):
${P}

Subcontractors (id | company | trade | email):
${S}

Suppliers (id | company):
${U}

Open quote requests (id | project id | what's being priced):
${R}

Reply with JSON only, no prose:
{"doc_type": one of the document types,
 "type_confidence": 0-1,
 "summary": "one short line, e.g. 'Groundworks quote from ABC Ltd – £84,200 + VAT'",
 "project_id": job id or null, "project_confidence": 0-1,
 "vendor": {"kind": "subcontractor"|"supplier"|"none", "id": id or null, "name": "company name as written or null", "confidence": 0-1},
 "quote": {"request_id": open quote request id for this job and trade, or null, "trade": "e.g. Groundworks", "amount": total price as a number or null, "vat": "net"|"gross"|"unknown", "date": "YYYY-MM-DD" or null, "reference": string or null},
 "compliance": {"document_type": compliance value or null, "issue_date": "YYYY-MM-DD" or null, "expiry_date": "YYYY-MM-DD" or null, "reference": string or null, "cover_amount": number or null},
 "drawing": {"number": string or null, "revision": string or null, "title": string or null},
 "pa_number": number or null,
 "reason": "why, in a few words (what in the file told you)"}`
}

async function readWithClaude(system: string, item: any, bytes: Uint8Array) {
  const content = [
    ...(await contentFor(item.file_name, item.mime_type || "", bytes)),
    { type: "text", text: `File name: ${item.file_name}\nDrive folder: ${item.source_path || "(top level)"}\nSize: ${item.file_size || bytes.length} bytes\nSaved: ${item.source_created_at || ""}\n\nWhat is this file? JSON only.` },
  ]
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1200,
      // The job/subcontractor lists are the same for every file in a run → cached
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    }),
  })
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json()
  const text = (d.content || []).map((c: any) => c.text || "").join("").trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error("Claude didn't return JSON")
  return JSON.parse(m[0])
}

// ─── Deciding where it goes ──────────────────────────────────────────────────
type Plan = { status: "filed" | "to_check" | "ignored"; decision?: any; reason: string }

async function planFor(g: any, item: any, ctx: any, threshold: number): Promise<Plan> {
  const type = DOC_TYPES.includes(g.doc_type) ? g.doc_type : "other"
  const tc = num(g.type_confidence) ?? 0
  const project = ctx.projects.find((p: any) => p.id === g.project_id) || null
  const pc = project ? (num(g.project_confidence) ?? 0) : 0
  const vendor = g.vendor || {}
  const vc = num(vendor.confidence) ?? 0
  const sub = vendor.kind === "subcontractor" ? ctx.subcontractors.find((s: any) => s.id === vendor.id) : null
  const sup = vendor.kind === "supplier" ? ctx.suppliers.find((s: any) => s.id === vendor.id) : null
  const sure = (c: number) => c >= threshold

  if (type === "invoice") return { status: "ignored", reason: "Invoice — handled in Xero" }
  if (type === "other") return sure(tc) ? { status: "ignored", reason: g.reason || "Not a project document" } : { status: "to_check", reason: "Not sure what this is" }
  if (!sure(tc)) return { status: "to_check", reason: `Not sure it's a ${type.replace(/_/g, " ")}` }

  if (PROJECT_FOLDERS[type]) {
    if (!project) return { status: "to_check", reason: "Couldn't tell which job" }
    if (!sure(pc)) return { status: "to_check", reason: `Probably ${project.project_name} — please confirm` }
    const dest = PROJECT_FOLDERS[type]
    // Jobs with a PA folder per building: a person picks the building
    if (type === "our_payment_application" || type === "client_payment_notice") {
      const { data: bf } = await sb.from("project_doc_folders").select("folder_key")
        .eq("project_id", project.id).eq("parent_key", dest.folder_key).limit(1)
      if (bf?.length) return { status: "to_check", reason: "This job has a folder per building — pick one" }
    }
    const decision: any = { target: "project_doc", project_id: project.id, folder_key: dest.folder_key, subfolder_key: dest.subfolder_key }
    // RAMS from a known subcontractor also goes on their Compliance record
    if (type === "rams" && sub && sure(vc)) decision.also_compliance = { subcontractor_id: sub.id, document_type: "rams" }
    return { status: "filed", decision, reason: g.reason || "" }
  }

  if (type === "insurance" || type === "certificate" || type === "accreditation") {
    const dt = COMPLIANCE_TYPES.includes(g.compliance?.document_type) ? g.compliance.document_type : null
    if (!sub) return { status: "to_check", reason: vendor.name ? `Subcontractor “${vendor.name}” isn't in the CRM` : "Couldn't tell whose certificate this is" }
    if (!sure(vc)) return { status: "to_check", reason: `Probably ${sub.company_name} — please confirm` }
    if (!dt || dt === "other") return { status: "to_check", reason: "Couldn't tell which compliance document this is" }
    return { status: "filed", decision: { target: "compliance", subcontractor_id: sub.id, document_type: dt }, reason: g.reason || "" }
  }

  if (type === "subcontractor_quote" || type === "supplier_quote") {
    if (!project) return { status: "to_check", reason: "Couldn't tell which job this quote is for" }
    if (!sure(pc)) return { status: "to_check", reason: `Probably ${project.project_name} — please confirm` }
    if (!sub && !sup) return { status: "to_check", reason: vendor.name ? `“${vendor.name}” isn't in the CRM yet` : "Couldn't tell who sent the quote" }
    if (!sure(vc)) return { status: "to_check", reason: `Probably from ${(sub || sup).company_name} — please confirm` }
    const req = ctx.requests.find((t: any) => t.id === g.quote?.request_id && t.project_id === project.id)
    if (!req) return { status: "to_check", reason: `No open quote request for ${g.quote?.trade || "this trade"} on ${project.project_name} — create one?` }
    return { status: "filed", decision: { target: "quote", project_id: project.id, task_id: req.id, subcontractor_id: sub?.id || null, supplier_id: sup?.id || null }, reason: g.reason || "" }
  }
  return { status: "to_check", reason: "Not sure where this goes" }
}

// ─── Filing ──────────────────────────────────────────────────────────────────
async function copyStaged(item: any, to: string, bucket = BUCKET) {
  if (bucket === BUCKET) {
    const { error } = await sb.storage.from(BUCKET).copy(item.staged_path, to)
    if (error) throw new Error("Storage copy failed: " + error.message)
  } else {
    const { data, error } = await sb.storage.from(BUCKET).download(item.staged_path)
    if (error || !data) throw new Error("Couldn't read the staged file")
    const { error: upErr } = await sb.storage.from(bucket).upload(to, data, { contentType: item.mime_type || undefined, upsert: false })
    if (upErr) throw new Error("Upload failed: " + upErr.message)
  }
}

async function fileItem(item: any, d: any, actorId: string | null) {
  const g = item.guess || {}
  const stamp = `${Date.now()}-${safeName(item.file_name)}`
  const out: any = { target: d.target }

  if (d.target === "project_doc") {
    const { data: p } = await sb.from("projects").select("id, project_name").eq("id", d.project_id).maybeSingle()
    if (!p) throw new Error("Job not found")
    const folder = String(d.folder_key || ""), sub = d.subfolder_key || null
    // Same file already in that folder → don't add it twice
    let dupQ = sb.from("project_doc_files").select("id").eq("project_id", p.id).eq("folder_key", folder).eq("file_name", item.file_name)
    dupQ = sub ? dupQ.eq("subfolder_key", sub) : dupQ.is("subfolder_key", null)
    if (item.file_size) dupQ = dupQ.eq("file_size", item.file_size)
    const { data: dup } = await dupQ.limit(1)
    if (dup?.length) return { status: "duplicate", filed_to: { ...out, project_id: p.id, label: `Already in ${p.project_name}` } }
    const path = sub ? `projects/${p.id}/${folder}/${sub}/${stamp}` : `projects/${p.id}/${folder}/${stamp}`
    await copyStaged(item, path)
    const { data: row, error } = await sb.from("project_doc_files").insert({
      project_id: p.id, folder_key: folder, subfolder_key: sub, file_name: item.file_name,
      file_size: item.file_size, storage_path: path, client_visible: false,
    }).select("id").single()
    if (error) throw new Error(error.message)
    let lbl = Object.values(PROJECT_FOLDERS).find(f => f.folder_key === folder && f.subfolder_key === sub)?.label
    if (!lbl) {
      const { data: cf } = sub ? await sb.from("project_doc_folders").select("label").eq("project_id", p.id).eq("folder_key", sub).limit(1) : { data: null }
      lbl = `Documents › ${cf?.[0]?.label || sub || folder}`
    }
    Object.assign(out, { project_id: p.id, folder_key: folder, subfolder_key: sub, file_id: row.id, label: `${p.project_name} › ${lbl}` })
    if (d.also_compliance?.subcontractor_id) {
      try {
        const c = await fileCompliance(item, { ...d.also_compliance }, actorId, g)
        out.also = c
      } catch (e) { out.also_error = String((e as Error).message || e) }
    }
    return { status: "filed", filed_to: out }
  }

  if (d.target === "compliance") return { status: "filed", filed_to: await fileCompliance(item, d, actorId, g) }

  if (d.target === "quote") {
    let taskId = d.task_id
    const { data: p } = await sb.from("projects").select("id, project_name").eq("id", d.project_id).maybeSingle()
    if (!p) throw new Error("Job not found")
    if (!taskId && d.new_request_title) {
      const { data: t, error } = await sb.from("tasks").insert({
        project_id: p.id, title: String(d.new_request_title).slice(0, 200), status: "active", priority: "medium",
        is_quote: true, created_by: actorId, description: "Created from an emailed quote (Inbox)",
      }).select("id").single()
      if (error) throw new Error("Couldn't create the quote request: " + error.message)
      taskId = t.id
    }
    if (!taskId) throw new Error("Pick a quote request")
    const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(item.file_name) || "pdf"}`
    await copyStaged(item, path, TASK_BUCKET)
    const { data: tf, error: tfErr } = await sb.from("task_files").insert({
      task_id: taskId, file_name: item.file_name, storage_path: path, file_size: item.file_size,
      mime_type: item.mime_type || null, uploaded_by: actorId, category: "quote",
    }).select("id").single()
    if (tfErr) throw new Error(tfErr.message)
    const [sub, sup] = await Promise.all([
      d.subcontractor_id ? sb.from("subcontractors").select("id, company_name").eq("id", d.subcontractor_id).maybeSingle() : Promise.resolve({ data: null }),
      d.supplier_id ? sb.from("suppliers").select("id, company_name").eq("id", d.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const vendorName = (sub as any).data?.company_name || (sup as any).data?.company_name || d.vendor_name || g.vendor?.name || "Unknown"
    // Amount stored NET (Quotes compares net-vs-net); UK quotes are usually ex VAT
    const entered = num(d.amount) ?? num(g.quote?.amount)
    const basis = d.vat || g.quote?.vat || "net"
    const net = entered == null ? null : Math.round((basis === "gross" ? entered / 1.2 : entered) * 100) / 100
    const qRow: any = {
      task_id: taskId, task_file_id: tf.id,
      subcontractor_id: (sub as any).data?.id || null, supplier_id: (sup as any).data?.id || null,
      vendor_name_text: vendorName, amount: net, currency: "GBP",
      received_date: isoDate(d.date) || isoDate(g.quote?.date) || new Date().toISOString().slice(0, 10),
      status: "pending", created_by: actorId,
      notes: [g.quote?.reference ? `Ref ${g.quote.reference}` : null, "Added from email (Inbox)"].filter(Boolean).join(" · "),
      vat_rate: net == null ? null : 20,
      amount_net: net, amount_vat: net == null ? null : Math.round(net * 0.2 * 100) / 100,
      amount_gross: net == null ? null : Math.round(net * 1.2 * 100) / 100,
    }
    let { data: q, error: qErr } = await sb.from("task_quotes").insert(qRow).select("id").single()
    if (qErr && /vat_rate|amount_net|amount_vat|amount_gross/.test(qErr.message)) {
      for (const k of ["vat_rate", "amount_net", "amount_vat", "amount_gross"]) delete qRow[k]
      ;({ data: q, error: qErr } = await sb.from("task_quotes").insert(qRow).select("id").single())
    }
    if (qErr) throw new Error(qErr.message)
    await sb.from("task_activity").insert({ task_id: taskId, actor_id: actorId, action: "file_uploaded", details: { file_name: item.file_name, via: "inbox" } })
    const { data: t } = await sb.from("tasks").select("title").eq("id", taskId).maybeSingle()
    Object.assign(out, { project_id: p.id, task_id: taskId, quote_id: q!.id, label: `Quotes › ${p.project_name} › ${t?.title || "request"} (${vendorName})` })
    return { status: "filed", filed_to: out }
  }
  throw new Error("Unknown destination")
}

async function fileCompliance(item: any, d: any, actorId: string | null, g: any) {
  const { data: s } = await sb.from("subcontractors").select("id, company_name").eq("id", d.subcontractor_id).maybeSingle()
  if (!s) throw new Error("Subcontractor not found")
  const dt = COMPLIANCE_TYPES.includes(d.document_type) ? d.document_type : "other"
  const c = g.compliance || {}
  const path = `subcontractors/${s.id}/compliance/${Date.now()}-${safeName(item.file_name).replace(/[^\w.\-]/g, "_")}`
  await copyStaged(item, path)
  const row: any = {
    subcontractor_id: s.id, document_type: dt,
    document_name: (d.document_name || g.summary || item.file_name).slice(0, 200),
    reference_number: d.reference ?? c.reference ?? null,
    issue_date: isoDate(d.issue_date) || isoDate(c.issue_date),
    expiry_date: isoDate(d.expiry_date) || isoDate(c.expiry_date),
    notes: "Filed from email (Inbox)", uploaded_by: actorId,
    storage_path: path, file_name: item.file_name, file_size: item.file_size,
    cover_amount: INSURANCE_TYPES.includes(dt) ? (num(d.cover_amount) ?? num(c.cover_amount)) : null,
  }
  let { data, error } = await sb.from("documents").insert(row).select("id").single()
  if (error && /cover_amount|storage_path|file_size/.test(error.message)) {
    for (const k of ["cover_amount", "file_size"]) delete row[k]
    ;({ data, error } = await sb.from("documents").insert(row).select("id").single())
  }
  if (error) throw new Error(error.message)
  return { target: "compliance", subcontractor_id: s.id, document_id: data!.id, label: `${s.company_name} › Compliance` }
}

// ─── One file, start to finish ───────────────────────────────────────────────
const JUNK = /^(image\d{3}\.(png|jpe?g|gif)|winmail\.dat|.*\.(ics|vcf|p7s|htm|html))$/i

async function processItem(item: any, ctx: any, system: string, threshold: number, trial: boolean) {
  const upd = async (patch: any) => { await sb.from("intake_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", item.id) }
  try {
    if (JUNK.test(item.file_name) || (/^image\//.test(item.mime_type || "") && (item.file_size || 0) < 40_000)) {
      return upd({ status: "ignored", reason: "Email signature / logo / calendar file" })
    }
    if (String(item.mime_type || "").startsWith("application/vnd.google-apps.")) {
      return upd({ status: "to_check", reason: "Google Docs/Sheets file — file it by hand" })
    }
    if ((item.file_size || 0) > MAX_BYTES) return upd({ status: "to_check", reason: "Too large to read automatically" })

    // Same file already filed from another email (or another person's copy)
    if (item.md5) {
      const { data: same } = await sb.from("intake_items").select("id, filed_to").eq("md5", item.md5)
        .eq("status", "filed").neq("id", item.id).limit(1)
      if (same?.length) return upd({ status: "duplicate", reason: "Same file already filed", filed_to: same[0].filed_to })
    }

    const bytes = new Uint8Array(await (await drive(`files/${item.source_file_id}`, { alt: "media" })).arrayBuffer())
    const staged = `intake/${item.id}/${safeName(item.file_name)}`
    const { error: stErr } = await sb.storage.from(BUCKET).upload(staged, bytes, { contentType: item.mime_type || undefined, upsert: true })
    if (stErr) throw new Error("Couldn't stage the file: " + stErr.message)
    item.staged_path = staged
    item.file_size = item.file_size || bytes.length

    const g = await readWithClaude(system, item, bytes)
    const plan = await planFor(g, item, ctx, threshold)
    const base = {
      staged_path: staged, file_size: item.file_size, doc_type: g.doc_type || null, summary: g.summary || null,
      confidence: Math.min(num(g.type_confidence) ?? 0, g.project_id ? (num(g.project_confidence) ?? 0) : 1),
      guess: g, attempts: (item.attempts || 0) + 1, last_error: null,
    }
    if (plan.status !== "filed") return upd({ ...base, status: plan.status, reason: plan.reason })
    // Trial: show where it would have gone, file nothing
    if (trial) return upd({ ...base, status: "to_check", reason: "Trial — ready to file", guess: { ...g, _plan: plan.decision } })
    item.guess = g
    const res = await fileItem(item, plan.decision, null)
    return upd({ ...base, status: res.status, reason: plan.reason, filed_to: res.filed_to, filed_at: new Date().toISOString(), filed_by: null })
  } catch (e) {
    const attempts = (item.attempts || 0) + 1
    return upd({ status: attempts >= 3 ? "to_check" : "error", attempts, last_error: String((e as Error).message || e).slice(0, 500),
      reason: attempts >= 3 ? "Couldn't read this automatically" : "Will retry" })
  }
}

async function run() {
  const started = Date.now()
  const { data: settings } = await sb.from("intake_settings").select("*").eq("id", 1).maybeSingle()
  if (!settings?.drive_folder_id) return { ok: false, note: "No Google Drive folder set (Inbox › Settings)" }
  let added = 0, note = ""
  try { added = await discover(settings) } catch (e) { note = "Drive: " + String((e as Error).message || e) }

  const ctx = await loadContext()
  const system = systemPrompt(ctx)
  const threshold = Number(settings.auto_threshold) || 0.85
  const { data: queue } = await sb.from("intake_items").select("*")
    .or("status.eq.pending,and(status.eq.error,attempts.lt.3)")
    .order("source_created_at", { ascending: true }).limit(BATCH)
  let done = 0
  for (const item of queue || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    await processItem(item, ctx, system, threshold, settings.trial !== false)
    done++
  }
  const { count: left } = await sb.from("intake_items").select("id", { count: "exact", head: true }).eq("status", "pending")
  const summary = `${added} new · ${done} read · ${left || 0} waiting${note ? " · " + note : ""}`
  await sb.from("intake_settings").update({ last_run_at: new Date().toISOString(), last_run_note: summary }).eq("id", 1)
  return { ok: !note, added, read: done, waiting: left || 0, note: summary }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "POST only" }, 405)
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = body.action || "run"

  // Who's calling: the 5-minute schedule, or a signed-in CRM user
  let actorId: string | null = null
  const cron = CRON_KEY && req.headers.get("x-intake-key") === CRON_KEY
  if (!cron) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: u } = token ? await sb.auth.getUser(token) : { data: { user: null } }
    if (!u?.user) return json({ error: "Not signed in" }, 401)
    const { data: prof } = await sb.from("profiles").select("id, role").eq("id", u.user.id).maybeSingle()
    if (!prof || !FILERS.includes(prof.role)) return json({ error: "Your role can't file documents" }, 403)
    actorId = prof.id
  } else if (action !== "run") {
    return json({ error: "Schedule can only run" }, 403)
  }

  try {
    if (action === "run") {
      if (cron) {
        const { data: s } = await sb.from("intake_settings").select("enabled").eq("id", 1).maybeSingle()
        if (!s?.enabled) return json({ ok: true, skipped: "Switched off in Inbox › Settings" })
      }
      return json(await run())
    }

    const { data: item } = await sb.from("intake_items").select("*").eq("id", body.item_id).maybeSingle()
    if (!item) return json({ error: "Item not found" }, 404)

    if (action === "url") {
      if (!item.staged_path) return json({ error: "Not downloaded yet" }, 409)
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(item.staged_path, 600)
      return json({ url: data?.signedUrl || null })
    }
    if (action === "ignore") {
      await sb.from("intake_items").update({ status: "ignored", reason: "Ignored by hand", filed_by: actorId, updated_at: new Date().toISOString() }).eq("id", item.id)
      return json({ ok: true })
    }
    if (action === "retry") {
      await sb.from("intake_items").update({ status: "pending", attempts: 0, last_error: null, updated_at: new Date().toISOString() }).eq("id", item.id)
      return json({ ok: true })
    }
    if (action === "file") {
      if (item.status === "filed") return json({ error: "Already filed", filed_to: item.filed_to }, 409)
      if (!item.staged_path) return json({ error: "The file hasn't been downloaded yet — press Retry first" }, 409)
      const d = body.decision || {}
      if (!["project_doc", "compliance", "quote"].includes(d.target)) return json({ error: "Pick where it goes" }, 400)
      for (const k of ["project_id", "subcontractor_id", "supplier_id", "task_id"]) if (d[k] && !isUuid(d[k])) return json({ error: `Bad ${k}` }, 400)
      const res = await fileItem(item, d, actorId)
      await sb.from("intake_items").update({
        status: res.status, filed_to: res.filed_to, filed_at: new Date().toISOString(), filed_by: actorId,
        reason: "Filed by hand", updated_at: new Date().toISOString(),
      }).eq("id", item.id)
      return json({ ok: true, ...res })
    }
    return json({ error: "Unknown action" }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
