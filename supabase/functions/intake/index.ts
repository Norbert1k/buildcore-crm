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
// Secrets: ANTHROPIC_API_KEY (already set), GOOGLE_SERVICE_ACCOUNT_JSON
// The 5-minute schedule proves itself with intake_settings.cron_token (made by the database).
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
  client_order:          { folder_key: "01-project-order",       subfolder_key: null, label: "01. Project Order" },
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
  "client_order", "subcontractor_application", "supplier_order",
  "product_datasheet", "om_manual", "warranty", "test_certificate", "as_built_drawing",
  "rfi", "correspondence",
  "invoice", "other",
]
// Job diary (project_log) — what happened on each job, for the progress report
const LOG_KINDS = new Set(["rfi", "rfi_answer", "instruction", "variation", "issue", "delay", "progress", "hs", "drawing", "delivery", "payment", "quote", "application", "handover", "correspondence", "other"])
// Quant saves each job email's text as "… - EMAIL - subject.txt"
const isEmailText = (item: any) => /\.(txt|eml)$/i.test(item.file_name || "") && (/ - email - /i.test(item.file_name || "") || /\.eml$/i.test(item.file_name || ""))
// Handover (H&S File / O&M) documents — filed into the job's Handover, read
// there like a dropped file, so "Create handover documents" picks them up
const HANDOVER_TYPES = new Set(["product_datasheet", "om_manual", "warranty", "test_certificate", "as_built_drawing"])
// The Handover's folders (from HSHandover.jsx HS_STRUCTURE) — key → label
const HANDOVER_FOLDERS: Record<string, string> = {"s1": "Section 1", "s2": "Section 2", "s3": "Section 3", "s3-1": "Section 3 › 3.1 As Built Drawings", "s3-1-01": "Section 3 › 3.1 As Built Drawings › 01. Superseded", "s3-1-02": "Section 3 › 3.1 As Built Drawings › 02. Unclassified", "s3-1-03": "Section 3 › 3.1 As Built Drawings › 03. Floor Plans", "s3-1-04": "Section 3 › 3.1 As Built Drawings › 04. Drawings", "s3-1-04-01": "Section 3 › 3.1 As Built Drawings › 04. Drawings › 01. Superseded", "s3-1-04-02": "Section 3 › 3.1 As Built Drawings › 04. Drawings › 02. Unclassified", "s3-1-04-03": "Section 3 › 3.1 As Built Drawings › 04. Drawings › 03. Fire Strategy", "s3-1-04-15": "Section 3 › 3.1 As Built Drawings › 04. Drawings › 04. Floor Plans", "s3-1-04-16": "Section 3 › 3.1 As Built Drawings › 04. Drawings › 05. Elevations", "s3-1-05": "Section 3 › 3.1 As Built Drawings › 05. General Drawings", "s3-1-05-02": "Section 3 › 3.1 As Built Drawings › 05. General Drawings › 01. Superseded", "s3-1-05-03": "Section 3 › 3.1 As Built Drawings › 05. General Drawings › 02. Unclassified", "s3-1-05-07": "Section 3 › 3.1 As Built Drawings › 05. General Drawings › 03. Windows", "s3-2": "Section 3 › 3.2 Soft & Hard Landscaping", "s3-3": "Section 3 › 3.3 Services Drawings", "s4": "Section 4", "s4-1": "Section 4 › 4.1 Schedule of Equipment", "s4-1-01": "Section 4 › 4.1 Schedule of Equipment › 01. Walls & Partitions", "s4-1-01-00": "Section 4 › 4.1 Schedule of Equipment › 01. Walls & Partitions › 01. Unclassified", "s4-1-02": "Section 4 › 4.1 Schedule of Equipment › 02. Doors", "s4-1-02-02": "Section 4 › 4.1 Schedule of Equipment › 02. Doors › 01. Ironmongery", "s4-1-02-03": "Section 4 › 4.1 Schedule of Equipment › 02. Doors › 02. Doors", "s4-1-04": "Section 4 › 4.1 Schedule of Equipment › 03. Roofing", "s4-1-05": "Section 4 › 4.1 Schedule of Equipment › 04. Radiators", "s4-1-05-02": "Section 4 › 4.1 Schedule of Equipment › 04. Radiators › 01. Bathrooms", "s4-1-06": "Section 4 › 4.1 Schedule of Equipment › 05. Plumbing", "s4-1-06-03": "Section 4 › 4.1 Schedule of Equipment › 05. Plumbing › 01. Gas Safe Certificates", "s4-1-07": "Section 4 › 4.1 Schedule of Equipment › 06. Electrical", "s4-1-09": "Section 4 › 4.1 Schedule of Equipment › 07. Insulation", "s4-1-11": "Section 4 › 4.1 Schedule of Equipment › 08. Bathrooms", "s4-1-14": "Section 4 › 4.1 Schedule of Equipment › 09. MVHR", "s4-1-16": "Section 4 › 4.1 Schedule of Equipment › 10. Flooring", "s4-1-18": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts", "s4-1-18-01": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts › 01. Maintenance Agreement", "s4-1-18-02": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts › 02. Lift", "s4-1-18-02-01": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts › 02. Lift › 01. Owner Manual", "s4-1-18-02-02": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts › 02. Lift › 02. Declarations & Test Certs", "s4-1-18-02-03": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts › 02. Lift › 03. Drawings", "s4-1-18-02-04": "Section 4 › 4.1 Schedule of Equipment › 11. Lifts › 02. Lift › 04. Service Contact Details", "s4-1-19": "Section 4 › 4.1 Schedule of Equipment › 12. Lighting", "s4-1-20": "Section 4 › 4.1 Schedule of Equipment › 13. Landscaping", "s4-1-23": "Section 4 › 4.1 Schedule of Equipment › 14. Windows", "s4-1-24": "Section 4 › 4.1 Schedule of Equipment › 15. Brickwork", "s4-1-25": "Section 4 › 4.1 Schedule of Equipment › 16. Kitchens", "s4-1-30": "Section 4 › 4.1 Schedule of Equipment › 17. Fire System", "s4-1-32": "Section 4 › 4.1 Schedule of Equipment › 18. Residents Information", "s4-1-34": "Section 4 › 4.1 Schedule of Equipment › 19. HVAC", "s5": "Section 5", "s5-1": "Section 5 › 5.1 Site Investigations, Environmental Reports & Soil Remediation", "s5-2": "Section 5 › 5.2 Site Waste Management Plan (Record Information)", "s6": "Section 6", "s6-1": "Section 6 › 6.1 Structural Designs - Principle", "s6-2": "Section 6 › 6.2 Structural Engineer", "s7": "Section 7", "s7-1": "Section 7 › 7.1 Services Overview", "s7-1-01": "Section 7 › 7.1 Services Overview › 01. As Built Drawings", "s7-1-01-01": "Section 7 › 7.1 Services Overview › 01. As Built Drawings › 01. Floor Plans", "s7-1-01-02": "Section 7 › 7.1 Services Overview › 01. As Built Drawings › 02. Roof", "s7-1-03": "Section 7 › 7.1 Services Overview › 02. Utilities", "s7-1-03-01": "Section 7 › 7.1 Services Overview › 02. Utilities › 01. Electrical", "s7-1-03-02": "Section 7 › 7.1 Services Overview › 02. Utilities › 02. Fibre", "s8": "Section 8", "s8-1": "Section 8 › 8.1 Residents Information Pack", "s8-2": "Section 8 › 8.2 Façade & Roof Maintenance Information", "s8-3": "Section 8 › 8.3 Cleaning and Maintenance", "s8-4": "Section 8 › 8.4 Catalogue - All", "s8-4-01": "Section 8 › 8.4 Catalogue - All › 01. Walls & Partitions", "s8-4-01-00": "Section 8 › 8.4 Catalogue - All › 01. Walls & Partitions › 01. Unclassified", "s8-4-02": "Section 8 › 8.4 Catalogue - All › 02. Doors", "s8-4-02-02": "Section 8 › 8.4 Catalogue - All › 02. Doors › 01. Ironmongery", "s8-4-02-03": "Section 8 › 8.4 Catalogue - All › 02. Doors › 02. Doors", "s8-4-04": "Section 8 › 8.4 Catalogue - All › 03. Roof", "s8-4-05": "Section 8 › 8.4 Catalogue - All › 04. Radiators", "s8-4-06": "Section 8 › 8.4 Catalogue - All › 05. Plumbing", "s8-4-06-03": "Section 8 › 8.4 Catalogue - All › 05. Plumbing › 01. Gas Safe Certificates", "s8-4-07": "Section 8 › 8.4 Catalogue - All › 06. Electrical", "s8-4-09": "Section 8 › 8.4 Catalogue - All › 07. Insulation", "s8-4-11": "Section 8 › 8.4 Catalogue - All › 08. Bathrooms", "s8-4-15": "Section 8 › 8.4 Catalogue - All › 09. MVHR", "s8-4-17": "Section 8 › 8.4 Catalogue - All › 10. Flooring", "s8-4-17-01": "Section 8 › 8.4 Catalogue - All › 10. Flooring › 01. Tiles", "s8-4-19": "Section 8 › 8.4 Catalogue - All › 11. Lifts", "s8-4-19-01": "Section 8 › 8.4 Catalogue - All › 11. Lifts › 01. Maintenance Agreement", "s8-4-19-02": "Section 8 › 8.4 Catalogue - All › 11. Lifts › 02. Lift", "s8-4-19-02-01": "Section 8 › 8.4 Catalogue - All › 11. Lifts › 02. Lift › 01. Owner Manual", "s8-4-19-02-02": "Section 8 › 8.4 Catalogue - All › 11. Lifts › 02. Lift › 02. Declarations & Test Certs", "s8-4-19-02-03": "Section 8 › 8.4 Catalogue - All › 11. Lifts › 02. Lift › 03. Drawings", "s8-4-19-02-04": "Section 8 › 8.4 Catalogue - All › 11. Lifts › 02. Lift › 04. Service Contact Details", "s8-4-20": "Section 8 › 8.4 Catalogue - All › 12. Lighting", "s8-4-21": "Section 8 › 8.4 Catalogue - All › 13. Landscaping", "s8-4-24": "Section 8 › 8.4 Catalogue - All › 14. Windows", "s8-4-25": "Section 8 › 8.4 Catalogue - All › 15. Brickwork", "s8-4-26": "Section 8 › 8.4 Catalogue - All › 16. Kitchens", "s8-4-31": "Section 8 › 8.4 Catalogue - All › 17. Fire System", "s8-4-31-01": "Section 8 › 8.4 Catalogue - All › 17. Fire System › 01. Data Sheets", "s8-4-33": "Section 8 › 8.4 Catalogue - All › 18. Residents Information", "s8-4-35": "Section 8 › 8.4 Catalogue - All › 19. HVAC", "s9": "Section 9", "s9-1": "Section 9 › 9.1 Commissioning Records (Part 1)", "s9-2": "Section 9 › 9.2 Commissioning Records (Part 2)", "s10": "Section 10", "s10-1": "Section 10 › 10.1 Operating Records", "s11": "Section 11", "s11-1": "Section 11 › 11.1 Building Control & Building Insurance", "s11-2": "Section 11 › 11.2 Emergency Lighting Safety Certificate", "s11-3": "Section 11 › 11.3 Electrical Safety Certificate", "s11-4": "Section 11 › 11.4 Fire Alarm Certificate", "s11-5": "Section 11 › 11.5 AOV & Smoke Shaft", "s11-6": "Section 11 › 11.6 Dry Riser Commissioning", "s11-7": "Section 11 › 11.7 Lift Commissioning", "s11-7-01": "Section 11 › 11.7 Lift Commissioning › 01. Declarations & Test Certs", "s11-7-02": "Section 11 › 11.7 Lift Commissioning › 02. Lift", "s11-7-02-01": "Section 11 › 11.7 Lift Commissioning › 02. Lift › 01. Owner Manual", "s11-7-02-02": "Section 11 › 11.7 Lift Commissioning › 02. Lift › 02. Drawings", "s11-7-02-03": "Section 11 › 11.7 Lift Commissioning › 02. Lift › 03. Service Contact Details", "s11-8": "Section 11 › 11.8 Energy Performance Certificates & SAP", "s11-9": "Section 11 › 11.9 Air & Sound Test Certificates", "s11-10": "Section 11 › 11.10 Fire Stopping Certificate", "s11-11": "Section 11 › 11.11 Water Efficiency Certs (Block)", "s11-12": "Section 11 › 11.12 Planning Approval & Condition Sign Off"}

// Job-level folders the CRM makes on first use (top level of the job's Documents)
const TOP_FOLDERS: Record<string, string> = {
  subcontractor_application: "Subcontractor Applications",
  supplier_order: "Orders & Deliveries",
  rfi: "RFIs",
}

// ─── Small helpers ───────────────────────────────────────────────────────────
const safeName = (n: string) => String(n)
  .replace(/[—–]/g, "-").normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\x20-\x7E]/g, "").replace(/[#?%{}\\^~\[\]`>|<\/:*"]/g, "-")
  .replace(/\s{2,}/g, " ").trim() || "file"
// Quant saves attachments as "2026-11-15_1117 - sender@x.co.uk - Original name.pdf":
// the CRM keeps the original name (and uses it to spot files already filed)
const cleanName = (n: string) => String(n).replace(/^\d{4}-\d{2}-\d{2}[_ ]\d{3,4}\s*-\s*[^\s@]+@[^\s]+\s*-\s*/, "").trim() || String(n)
const paNumberOf = (n: string) => { const m = cleanName(n).match(/\bPA\s*[-_ ]?0*(\d{1,3})\b/i); return m ? parseInt(m[1], 10) : null }
const senderOf = (n: string) => String(n).match(/^\d{4}-\d{2}-\d{2}[_ ]\d{3,4}\s*-\s*([^\s@]+@[^\s]+)\s*-/)?.[1] || ""
// Watchdog alerts (table from 041_watchdog.sql) — best-effort if not there yet
async function raiseAlert(a: Record<string, unknown>) {
  try { await sb.from("crm_alerts").upsert({ ...a, status: "open", last_seen: new Date().toISOString() }, { onConflict: "key", ignoreDuplicates: true }) } catch { /* optional */ }
}
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
  if (/^(txt|eml|md|csv)$/.test(ext) && bytes.length < 400_000) {
    const text = new TextDecoder().decode(bytes).replace(/\r\n/g, "\n")
    return [{ type: "text", text: `${ext === "eml" || / - email - /i.test(name) ? "Email" : "Text file"} contents:\n${text.slice(0, 24000)}` }]
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

How to match the job (in this order of strength):
1. The Drive job folder, when one is given below the file ("filed against job …") — the team already sorted it there.
2. A project reference (e.g. 2026-005) or job number on the document.
3. The site address / postcode on the title block, letterhead, schedule or covering text.
4. The project/development name, client, or the consultant + development combination.
Two different jobs can share a client or consultant — never match on client or consultant alone. If the file's address or ref points to a different job than its Drive folder, say which job the FILE is for and give a low project_confidence. Correspondence that isn't for any one job (company insurance, general price lists, newsletters) gets project_id null.

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
- client_order: the client's order, contract, appointment, letter of intent or instruction to proceed for the job
- subcontractor_application: a subcontractor's payment application / valuation / interim application TO CCG (what they claim from us)
- supplier_order: a supplier's order confirmation, delivery note or collection note for materials/plant (NOT a purchase order CCG issued — those are already in the CRM, so they're "other")
- product_datasheet: a manufacturer's product datasheet, technical data sheet, Declaration of Performance, BBA/ETA certificate or installation guide for a material or product
- om_manual: an operation & maintenance manual or user manual for installed equipment/systems
- warranty: a warranty or guarantee for installed products or completed works on the job
- test_certificate: a test / commissioning / completion certificate FOR THE JOB (electrical EIC/EICR, gas commissioning, fire alarm, emergency lighting, sprinkler, water hygiene, air tightness, sound test, EPC, SAP, building control completion) — not a person's or company's competence card
- as_built_drawing: as-built / record drawings issued at completion
- rfi: a Request for Information form, RFI register or a formal RFI response for a job (the document itself)
- correspondence: an email (saved as a text file) or letter about a job that isn't one of the document types above — questions, instructions given by email, progress updates, delays, site issues, complaints, chasers
- invoice: invoices, statements, credit notes, receipts (these are handled in Xero, never filed here) — still list the products on it
- other: anything else (newsletters, marketing, signatures, unrelated) — including CCG's own internal working files (quote comparisons, cost analyses, summaries, draft BoQs, rate libraries, notes made by CCG or its AI assistant)

File names may start with "date_time - sender email - " (added when the email was saved): that sender is who sent it; @cltd.co.uk senders are CCG staff forwarding or sending our own documents.
A file named "… - EMAIL - subject.txt" is the text of an email (From, To, Date, Subject, body, attachment names). Its doc_type is "correspondence" unless the email itself is an RFI ("rfi"); never "variation" or another document type — the attachments arrive as their own files. Read the whole thread, newest message first.

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
 "drawing": {"number": string or null, "revision": string or null, "title": string or null, "discipline": "architectural"|"structural"|"civils"|"mep"|"landscape"|"fire"|"specialist"|null, "originator": "consultant/company that produced it, or null", "status": "e.g. Construction / Tender / Planning / Preliminary, or null", "plot_or_block": "e.g. Plot 3 / Block A, or null"},
 "pa_number": number or null,
 "pa_revision_by": for a payment application that the client / employer's agent has marked up or revised: "client"; CCG's own (re)issued version: "ccg"; otherwise null,
 "products": [{"manufacturer": string or null, "product": "product name as written", "code": "product code or null", "qty": "e.g. 24 sheets, or null", "installed": true when it's a material/product built into the works that the O&M needs a datasheet for (insulation, boards, membranes, roofing, sanitaryware, fittings, equipment…); false for tools, drill bits, blades, consumables, fixings packs, stationery, PPE, cleaning, fuel, hire, welfare, delivery charges}] — the materials/products on an invoice, delivery note, order confirmation, or the product a datasheet / manual / warranty is about; [] if none,
 "application": {"number": string or null, "period_to": "YYYY-MM-DD" or null, "gross_to_date": number or null, "amount_due": number or null},
 "log": [{"kind": "rfi"|"rfi_answer"|"instruction"|"variation"|"issue"|"delay"|"progress"|"hs"|"drawing"|"delivery"|"payment"|"other", "ref": "RFI / VO / instruction / drawing number as written, or null", "title": "one line: what happened", "detail": "one or two sentences with the specifics — who, what, where, dates, amounts", "status": "open"|"answered"|"closed"|null, "date": "YYYY-MM-DD" or null}] — events on the job worth recording in the job diary for the monthly progress report: an RFI raised (open) or answered (rfi_answer, with the RFI's number), an instruction or change given, a variation raised/agreed, a site issue, a delay and its cause, progress reported, a health & safety matter, a drawing revision issued, a delivery, a payment notice. Facts only, as stated in the file. [] when there is nothing (an invoice, a datasheet, a quote),
 "reason": "why, in a few words (what in the file told you)"}`
}

async function readWithClaude(system: string, item: any, bytes: Uint8Array, hint = "") {
  const content = [
    ...(await contentFor(item.file_name, item.mime_type || "", bytes)),
    { type: "text", text: `File name: ${item.file_name}\nDrive folder: ${item.source_path || "(top level)"}${hint ? "\n" + hint : ""}\nSize: ${item.file_size || bytes.length} bytes\nSaved: ${item.source_created_at || ""}\n\nWhat is this file? JSON only.` },
  ]
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000,
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

// ─── Keeping the job's folders professional ─────────────────────────────────
// Drawings, reports, H&S, planning and minutes go into the job's existing
// sub-folders when one fits, or a new one named the CCG way:
// "NN. Originator – Discipline" (drawings), "NN. Topic" (others), next number.
const PLACE_IN = new Set(["drawings", "reports", "hs", "planning", "meetings", "01-project-order"])
const PLACEMENT_RULES = `CCG folder rules (keep every job's Documents professional and consistent):
- Reuse an existing folder whenever one fits by meaning (same consultant/originator + discipline, same plot/block, same element or package). Names don't need to match exactly.
- Never put new files in folders marked Old, Archive or Superseded.
- Keep all revisions of a drawing together in one folder — never make a folder per revision or per date.
- Only make a new folder when nothing fits. Name it without a number (it's added for you):
  · Drawings: "<Originator> – <Discipline>", e.g. "KSA – Structural", "CIAO – Architectural", "Integration – MEP". If the job is organised by plot/block and the drawing is for one plot, use or make that plot's folder ("Plot 3").
  · Surveys & reports: the kind, e.g. "Ground Investigation", "Topographical Survey", "Fire Strategy", "Acoustic", "Structural Calculations".
  · Health & safety: "RAMS – <Subcontractor>", "Fire Safety", "Inspections".
  · Planning: "Decision Notices", "Conditions Discharge", "Building Control".
  · Meetings: "Progress Meetings", "Design Team Meetings".
  · Project order: "Contract", "Letters of Intent", "Client Instructions".
- At most one level of new folder per file. Short, title case, no dates, no file names.`

async function choosePlace(projectId: string, baseKey: string, item: any, g: any) {
  const { data: rows } = await sb.from("project_doc_folders").select("folder_key, parent_key, label").eq("project_id", projectId)
  const all = rows || []
  // Folders under the base, with their paths
  const tree: { key: string; path: string; label: string }[] = []
  const walk = (parent: string, prefix: string, depth: number) => {
    if (depth > 4) return
    for (const f of all.filter((r: any) => r.parent_key === parent).sort((a: any, b: any) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }))) {
      const path = prefix ? `${prefix} / ${f.label}` : f.label
      tree.push({ key: f.folder_key, path, label: f.label })
      walk(f.folder_key, path, depth + 1)
    }
  }
  walk(baseKey, "", 0)
  // A few file names from each folder show how the team organised it
  const samples: Record<string, string[]> = {}
  if (tree.length) {
    const { data: files } = await sb.from("project_doc_files").select("subfolder_key, file_name")
      .eq("project_id", projectId).in("subfolder_key", tree.map(t => t.key).slice(0, 150)).limit(1000)
    for (const f of files || []) (samples[f.subfolder_key] ||= []).length < 3 && samples[f.subfolder_key].push(f.file_name)
  }
  const listing = tree.length
    ? tree.map(t => `${t.key} | ${t.path}${samples[t.key]?.length ? "  — e.g. " + samples[t.key].join("; ") : ""}`).join("\n")
    : "(no sub-folders yet)"
  const d = g.drawing || {}
  const about = [`File: ${item.file_name}`, g.summary && `What it is: ${g.summary}`, `Type: ${g.doc_type}`,
    d.number && `Drawing ${d.number}${d.revision ? " rev " + d.revision : ""}${d.title ? " – " + d.title : ""}`,
    d.discipline && `Discipline: ${d.discipline}`, d.originator && `Produced by: ${d.originator}`,
    d.plot_or_block && `Plot/block: ${d.plot_or_block}`, d.status && `Status: ${d.status}`,
    g.vendor?.name && `From: ${g.vendor.name}`, item.source_path && `Drive folder: ${item.source_path}`].filter(Boolean).join("\n")
  const prompt = `${PLACEMENT_RULES}

The job's existing folders inside this section (key | path — e.g. sample files):
${listing}

The new file:
${about}

Reply JSON only: {"use": existing folder key or null, "new_name": name for a new folder or null, "new_parent": existing folder key to make it inside, or null for the top of this section, "confidence": 0-1, "reason": "few words"}`
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
  })
  if (!r.ok) throw new Error(`Claude ${r.status} (folders)`)
  const out = JSON.parse(((await r.json()).content || []).map((c: any) => c.text || "").join("").match(/\{[\s\S]*\}/)?.[0] || "{}")
  const isOld = (lbl: string) => /(^|[\s.\-–])(old|archive|archived|superseded)\b/i.test(lbl)
  const chosen = tree.find(t => t.key === out.use)
  if (chosen && !isOld(chosen.path)) {
    return { subfolder_key: chosen.key, path: chosen.path, confidence: num(out.confidence) ?? 0.8, reason: out.reason || "" }
  }
  const name = String(out.new_name || "").replace(/^\s*\d+\s*[.)-]\s*/, "").replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60)
  if (name) {
    const parent = tree.find(t => t.key === out.new_parent && !isOld(t.path))
    return { subfolder_key: null, new_folder: { parent_key: parent ? parent.key : baseKey, name },
      path: (parent ? parent.path + " / " : "") + name + " (new folder)", confidence: num(out.confidence) ?? 0.8, reason: out.reason || "" }
  }
  return { subfolder_key: baseKey, path: "", confidence: 0.5, reason: "No sub-folder chosen" }
}

// Make (or reuse) a numbered sub-folder: "NN. Name"
async function ensureFolder(projectId: string, parentKey: string | null, name: string) {
  let q = sb.from("project_doc_folders").select("folder_key, label").eq("project_id", projectId)
  q = parentKey ? q.eq("parent_key", parentKey) : q.is("parent_key", null)
  const { data: sibs } = await q
  const bare = (l: string) => String(l).replace(/^\s*\d+\s*[.)-]\s*/, "").trim().toLowerCase()
  const same = (sibs || []).find((f: any) => bare(f.label) === name.toLowerCase())
  if (same) return { key: same.folder_key, label: same.label }
  // Top-level job folders sit after the standard 01–06
  const next = Math.max(parentKey ? 0 : 6, ...(sibs || []).map((f: any) => parseInt(String(f.label).match(/^\s*(\d+)/)?.[1] || "0", 10))) + 1
  const label = `${String(next).padStart(2, "0")}. ${name}`
  const key = parentKey ? `${parentKey}-sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { error } = await sb.from("project_doc_folders").insert({ project_id: projectId, parent_key: parentKey, folder_key: key, label, client_visible: false })
  if (error) throw new Error("Couldn't create folder: " + error.message)
  return { key, label }
}

// ─── Materials bought per job (for datasheet checks) ─────────────────────────
const STOP = new Set(["the", "and", "with", "for", "mm", "m", "x", "ltd", "limited", "uk", "pack", "each", "per", "of", "in", "to", "a"])
const toks = (s: unknown) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length >= 2 && !STOP.has(w)))
const normKey = (mf: unknown, pr: unknown) => [...toks(mf), ...toks(pr)].sort().join(" ").slice(0, 200)

async function recordPurchases(projectId: string, g: any, item: any, source: "invoice" | "delivery" | "order" | "xero", label = "") {
  const supplier = g.vendor?.name || item.supplier || null
  const when = item.source_created_at ? new Date(item.source_created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""
  const evidence = label || `${supplier || "Supplier"} ${source === "invoice" ? "invoice" : source === "delivery" ? "delivery note" : "order"}${when ? " " + when : ""}`
  let n = 0
  for (const p of (g.products || []).slice(0, 60)) {
    if (!p?.product) continue
    const key = normKey(p.manufacturer, p.product)
    if (!key) continue
    await sb.from("job_materials").upsert({
      project_id: projectId, norm_key: key, manufacturer: p.manufacturer || null, product: String(p.product).slice(0, 200),
      code: p.code || null, qty: p.qty || null, supplier, source, purchased: source !== "order",
      // Tools, consumables, stationery… are noted but need no datasheet
      ...(p.installed === false ? { datasheet_status: "not_needed" } : {}),
      evidence_item_id: source === "xero" ? null : item.id, evidence_label: evidence,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id,norm_key", ignoreDuplicates: true })
    // Ordered earlier, now invoiced/delivered → it was bought
    if (source !== "order") await sb.from("job_materials").update({ purchased: true, source, evidence_label: evidence, updated_at: new Date().toISOString() })
      .eq("project_id", projectId).eq("norm_key", key).eq("purchased", false)
    n++
  }
  return n
}

// Datasheets that waited as "probably sent for info" — the purchase may have
// shown up since (a later invoice, delivery note or Xero bill). Filed then.
async function recheckForInfo(projectId: string) {
  const { data: st } = await sb.from("intake_settings").select("trial, auto_threshold").eq("id", 1).maybeSingle()
  const trial = st?.trial !== false
  const threshold = Number(st?.auto_threshold) || 0.85
  const { data: waiting } = await sb.from("intake_items").select("*").eq("status", "to_check")
    .eq("doc_type", "product_datasheet").like("reason", "No purchase of%").limit(200)
  let n = 0
  for (const it of (waiting || []) as any[]) {
    const plan = it.guess?._plan
    if (!plan || plan.target !== "handover" || plan.project_id !== projectId) continue
    const m = await matchPurchase(projectId, (it.guess?.products || [])[0] || {})
    if (!m) continue
    const decision = { ...plan, material_id: m.id, path_label: `${plan.path_label} — bought: ${m.evidence_label || m.supplier || "on file"}` }
    const now = new Date().toISOString()
    const sure = (num(it.guess?.project_confidence) ?? 0) >= threshold
    if (trial || !sure || !it.staged_path) {
      await sb.from("intake_items").update({ reason: `Bought after all (${m.evidence_label || m.supplier || "on file"}) — ${sure ? "ready to file" : "please confirm the job"}`,
        guess: { ...it.guess, _plan: decision }, updated_at: now }).eq("id", it.id)
    } else {
      const res = await fileToHandover(it, decision)
      await sb.from("intake_items").update({ status: res.status, filed_to: res.filed_to, filed_at: now, filed_by: null,
        reason: `Filed once the purchase showed up (${m.evidence_label || m.supplier})`, guess: { ...it.guess, _plan: decision }, updated_at: now }).eq("id", it.id)
    }
    n++
  }
  return n
}

// A datasheet matches a bought item when the product words (or the code) line up
async function matchPurchase(projectId: string, prod: any) {
  const { data: mats } = await sb.from("job_materials").select("id, manufacturer, product, code, supplier, evidence_label, purchased")
    .eq("project_id", projectId).eq("purchased", true)
  if (!mats?.length || !prod?.product) return null
  const want = toks(prod.product), wantMf = toks(prod.manufacturer)
  let best: any = null, bestScore = 0
  for (const m of mats as any[]) {
    if (prod.code && m.code && String(prod.code).replace(/\s/g, "").toLowerCase() === String(m.code).replace(/\s/g, "").toLowerCase()) return m
    const have = toks(m.product), haveMf = toks(m.manufacturer)
    const common = [...want].filter(w => have.has(w)).length
    const mfOk = !wantMf.size || !haveMf.size || [...wantMf].some(w => haveMf.has(w) || have.has(w))
    const score = mfOk ? common / Math.max(1, Math.min(want.size, have.size)) : 0
    if (score > bestScore) { best = m; bestScore = score }
  }
  return bestScore >= 0.6 ? best : null
}

// File into the job's Handover and have it read there (same as a dropped file)
async function fileToHandover(item: any, d: any) {
  const { data: p } = await sb.from("projects").select("id, project_name").eq("id", d.project_id).maybeSingle()
  if (!p) throw new Error("Job not found")
  const { data: dup } = await sb.from("hs_files").select("id").eq("project_id", p.id).eq("file_name", item.file_name).limit(1)
  if (dup?.length) return { status: "duplicate", filed_to: { target: "handover", project_id: p.id, label: `Already in ${p.project_name}'s Handover` } }
  const path = `projects/${p.id}/hs/_inbox/${Date.now()}-${safeName(item.file_name)}`
  const { data: blob, error: dErr } = await sb.storage.from(BUCKET).download(item.staged_path)
  if (dErr || !blob) throw new Error("Couldn't read the staged file")
  const { error: upErr } = await sb.storage.from("hs-handover").upload(path, blob, { contentType: item.mime_type || undefined })
  if (upErr) throw new Error("Handover upload failed: " + upErr.message)
  const { data: row, error } = await sb.from("hs_files").insert({ project_id: p.id, folder_key: "_inbox", file_name: item.file_name, file_size: item.file_size, storage_path: path }).select("id").single()
  if (error) throw new Error(error.message)
  // The Handover's own reader picks the section and stores what the O&M needs
  let folder = "_inbox"
  try {
    const { data: st } = await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/handover-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "x-intake-key": st?.cron_token || "" },
      body: JSON.stringify({ action: "read", table: "hs_files", file_id: row.id, folders: { _inbox: "To file", ...HANDOVER_FOLDERS }, hint: item.source_path || "" }),
    })
    const out = await r.json().catch(() => ({}))
    const sug = out?.ai?.suggested_folder
    if (out?.ai?.client_facing !== false && sug && HANDOVER_FOLDERS[sug]) {
      folder = sug
      await sb.from("hs_files").update({ folder_key: folder }).eq("id", row.id)
    }
  } catch (e) { console.warn("[intake] handover read failed", e) }
  if (d.material_id && isUuid(d.material_id)) await sb.from("job_materials").update({ datasheet_status: "filed", datasheet_item_id: item.id, updated_at: new Date().toISOString() }).eq("id", d.material_id)
  return { status: "filed", filed_to: { target: "handover", project_id: p.id, hs_file_id: row.id,
    label: `${p.project_name} › Handover › ${folder === "_inbox" ? "To file (pick the section in Handover)" : HANDOVER_FOLDERS[folder]}` } }
}

// ─── Datasheets for what each job bought ─────────────────────────────────────
// Looks up the manufacturer's own datasheet for bought items that still have
// none. Every find waits in Inbox › To check for one tap — never filed blind.
async function findDatasheets(limit = 4) {
  const { data: mats } = await sb.from("job_materials").select("*").eq("purchased", true).eq("datasheet_status", "needed").lt("attempts", 2)
    .order("created_at", { ascending: true }).limit(limit)
  let found = 0
  for (const m of (mats || []) as any[]) {
    await sb.from("job_materials").update({ attempts: (m.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq("id", m.id)
    try {
      const what = [m.manufacturer, m.product, m.code ? `(code ${m.code})` : ""].filter(Boolean).join(" ")
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 800,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
          messages: [{ role: "user", content: `Find the manufacturer's official product datasheet (or Declaration of Performance) as a PDF for this construction product, as sold in the UK:\n${what}\nBought from: ${m.supplier || "unknown"}.\nOnly the manufacturer's own site or a major UK merchant's hosted copy. It must be for exactly this product (same range, thickness/size where given). Reply with JSON only: {"url": direct https link to the PDF or null, "title": "document title", "confidence": 0-1, "reason": "few words"}` }],
        }),
      })
      if (!r.ok) throw new Error(`Claude ${r.status}`)
      const text = ((await r.json()).content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
      const ans = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}")
      if (!ans.url || !/^https:\/\//i.test(ans.url) || (num(ans.confidence) ?? 0) < 0.6) {
        await sb.from("job_materials").update({ datasheet_status: (m.attempts || 0) + 1 >= 2 ? "not_found" : "needed", last_error: ans.reason || "No datasheet found" }).eq("id", m.id)
        continue
      }
      const res = await fetch(ans.url, { redirect: "follow" })
      const bytes = new Uint8Array(await res.arrayBuffer())
      const isPdf = bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF"
      if (!res.ok || !isPdf || bytes.length > 20_000_000) throw new Error("Link wasn't a downloadable PDF")
      const fname = safeName(`${[m.manufacturer, m.product].filter(Boolean).join(" ")} - datasheet`).slice(0, 120) + ".pdf"
      const { data: it, error } = await sb.from("intake_items").insert({
        source: "web", source_file_id: "web:" + ans.url.slice(0, 400) + ":" + m.project_id, file_name: fname, mime_type: "application/pdf",
        file_size: bytes.length, source_path: "Found online: " + new URL(ans.url).hostname, source_created_at: new Date().toISOString(),
        status: "to_check", doc_type: "product_datasheet", summary: ans.title || fname,
        reason: `Datasheet found online for ${m.product} (bought: ${m.evidence_label || m.supplier || "on file"}) — check it's the right one`,
      }).select("id").single()
      if (error) throw new Error(error.message)
      const staged = `intake/${it.id}/${fname}`
      await sb.storage.from(BUCKET).upload(staged, bytes, { contentType: "application/pdf", upsert: true })
      const { data: pj } = await sb.from("projects").select("project_name").eq("id", m.project_id).maybeSingle()
      await sb.from("intake_items").update({ staged_path: staged, guess: { doc_type: "product_datasheet", project_id: m.project_id, source_url: ans.url,
        _plan: { target: "handover", project_id: m.project_id, material_id: m.id, path_label: `${pj?.project_name || "Job"} › Handover (H&S File / O&M)` } } }).eq("id", it.id)
      await sb.from("job_materials").update({ datasheet_status: "found", datasheet_item_id: it.id, last_error: null }).eq("id", m.id)
      found++
    } catch (e) {
      await sb.from("job_materials").update({ last_error: String((e as Error).message || e).slice(0, 300), datasheet_status: (m.attempts || 0) + 1 >= 2 ? "not_found" : "needed" }).eq("id", m.id)
    }
  }
  return { ok: true, checked: (mats || []).length, found }
}

// ─── Xero (read-only): what each job bought ──────────────────────────────────
// Xero bill lines are only cost codes ("Materials: Roofing"), so the robot
// reads the supplier invoice attached to each bill: products + which job
// (delivery address, site, order ref). Nothing is written to Xero; invoices
// still never go into the CRM — only the products are noted per job.
const XERO_FROM = "2026-01-01"             // older bills aren't read
const XERO_PER_RUN = 8                     // invoices read per run (hourly)
const NOT_GOODS = /\b(fuel|fuels|petrol|diesel|esso|shell|bp|hotel|hotels|travelodge|premier inn|parking|crossing|toll|tfl|congestion|ulez|trainline|uber|hmrc|bank|accountants?|software|subscription|vodafone|o2|insurance|restaurant|cafe)\b/i

async function xeroCall(body: any) {
  return await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify(body),
  })
}

function billIsGoods(bill: any, lines: any[]) {
  if (NOT_GOODS.test(bill.contact_name || "")) return false
  const tags = lines.flatMap((l: any) => (Array.isArray(l.tracking_codes) ? l.tracking_codes : []).map((t: any) => `${t.Name}:${t.Option}`))
  if (tags.some(t => /^materials:/i.test(t)) || lines.some((l: any) => /material/i.test(l.description || ""))) return true
  // Only labour / hire / overheads on it → nothing for the O&M
  const otherOnly = lines.length > 0 && lines.every((l: any) => {
    const t = (Array.isArray(l.tracking_codes) ? l.tracking_codes : []).map((x: any) => x.Name).join(" ")
    return /service/i.test(t) || /^(labour|hire|overheads|expenses)\b/i.test(String(l.description || "").trim())
  })
  return !otherOnly
}

async function xeroRun(limit = XERO_PER_RUN) {
  const started = Date.now()
  const st = await (await xeroCall({ mode: "status" })).json().catch(() => ({}))
  if (!st.connected) return { ok: false, note: "Xero isn't connected (Inbox › Settings)" }

  // 1. New bills from Xero, at most every 6 hours
  let sync = ""
  const last = st.last_sync
  if (!last || Date.now() - new Date(last.started_at).getTime() > 6 * 3600e3) {
    const r = await xeroCall({ mode: "full" })
    const o = await r.json().catch(() => ({}))
    sync = r.ok ? `${o.bills_fetched ?? 0} bills synced` : `Xero sync failed: ${o.error || r.status}`
    if (!r.ok) return { ok: false, note: sync }
  }

  // 2. Bills whose supplier invoice hasn't been read yet (newest first)
  const { data: reads } = await sb.from("xero_bill_reads").select("xero_invoice_id, status, attempts").limit(20000)
  const seen = new Set((reads || []).filter((r: any) => r.status !== "error" || r.attempts >= 3).map((r: any) => r.xero_invoice_id))
  const tries = new Map((reads || []).map((r: any) => [r.xero_invoice_id, r.attempts || 0]))
  const { data: bills } = await sb.from("xero_bills")
    .select("xero_invoice_id, invoice_number, reference, contact_name, date, total, has_att:raw_payload->HasAttachments")
    .gte("date", XERO_FROM).order("date", { ascending: false }).limit(3000)
  const todo = ((bills || []) as any[]).filter(b => !seen.has(b.xero_invoice_id)).slice(0, 80)
  if (!todo.length) return { ok: true, read: 0, left: 0, note: sync || "All Xero bills read" }

  const { data: lineRows } = await sb.from("xero_bill_lines").select("xero_invoice_id, description, tracking_codes")
    .in("xero_invoice_id", todo.map(b => b.xero_invoice_id))
  const linesOf = (id: string) => ((lineRows || []) as any[]).filter(l => l.xero_invoice_id === id)
  const save = (b: any, patch: any) => sb.from("xero_bill_reads").upsert({ xero_invoice_id: b.xero_invoice_id, read_at: new Date().toISOString(), ...patch }, { onConflict: "xero_invoice_id" })

  const ctx = await loadContext()
  const system = systemPrompt(ctx)
  let read = 0, noted = 0, skipped = 0, refiled = 0
  for (const b of todo) {
    if (read >= limit || Date.now() - started > 95_000) break
    const lines = linesOf(b.xero_invoice_id)
    if (!billIsGoods(b, lines)) { await save(b, { status: "skipped", note: "Not materials (labour, hire, fuel, travel…)" }); skipped++; continue }
    if (b.has_att === false) { await save(b, { status: "no_attachment" }); skipped++; continue }
    try {
      const r = await xeroCall({ mode: "attachment", invoice_id: b.xero_invoice_id })
      if (r.status === 404) { await save(b, { status: "no_attachment" }); skipped++; continue }
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Xero ${r.status}`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      const name = decodeURIComponent(r.headers.get("x-file-name") || "invoice.pdf")
      const item = { id: null, file_name: name, mime_type: r.headers.get("content-type") || "", file_size: bytes.length,
        source_path: "Xero bill", source_created_at: b.date, supplier: b.contact_name }
      const notes = [...new Set(lines.map((l: any) => String(l.description || "").trim()).filter(d => d.length > 1))].slice(0, 8).join("; ")
      const hint = `This is the supplier's invoice attached to a bill in CCG's Xero: ${b.contact_name || "supplier"} ${b.invoice_number || ""}, dated ${b.date}, £${b.total ?? "?"}${b.reference ? `, reference "${b.reference}"` : ""}.` +
        (notes ? `\nBookkeeping notes on the bill: ${notes}` : "") +
        `\nThe job is usually shown by the delivery / site address, a site or job name, or an order reference. List every product on it.`
      const g = await readWithClaude(system, item, bytes, hint)
      read++
      const project = ctx.projects.find((p: any) => p.id === g.project_id) || null
      const pc = project ? (num(g.project_confidence) ?? 0) : 0
      const products = Array.isArray(g.products) ? g.products : []
      let n = 0
      if (project && pc >= 0.7 && products.length) {
        const when = b.date ? new Date(b.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""
        n = await recordPurchases(project.id, g, item, "xero", `Xero bill — ${b.contact_name || "supplier"}${b.invoice_number ? " " + b.invoice_number : ""}${when ? " " + when : ""}`)
        noted += n
        if (n) refiled += await recheckForInfo(project.id).catch(() => 0)
      }
      await save(b, { status: !products.length ? "no_products" : (project && pc >= 0.7) ? "read" : "no_job",
        project_id: project?.id || null, confidence: pc, summary: g.summary || null, products, attempts: (tries.get(b.xero_invoice_id) || 0) + 1, note: g.reason || null })
    } catch (e) {
      await save(b, { status: "error", attempts: (tries.get(b.xero_invoice_id) || 0) + 1, note: String((e as Error).message || e).slice(0, 300) })
    }
  }
  const left = Math.max(0, ((bills || []) as any[]).filter(b => !seen.has(b.xero_invoice_id)).length - read - skipped)
  return { ok: true, read, skipped, noted, refiled, left, note: [sync, `${read} Xero invoice${read === 1 ? "" : "s"} read · ${noted} item${noted === 1 ? "" : "s"} noted${refiled ? ` · ${refiled} datasheet${refiled === 1 ? "" : "s"} matched` : ""} · ${left} to go`].filter(Boolean).join(" · ") }
}

// ─── Job diary ───────────────────────────────────────────────────────────────
async function writeLog(projectId: string, g: any, item: any) {
  const entries = (Array.isArray(g.log) ? g.log : []).filter((e: any) => e && LOG_KINDS.has(e.kind) && e.title).slice(0, 12)
  const sender = senderOf(item.file_name)
  const when = (d: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? new Date(d + "T12:00:00Z") : new Date(item.source_created_at || Date.now())).toISOString()
  const label = isEmailText(item) ? `Email${sender ? " from " + sender : ""}` : cleanName(item.file_name)
  for (const e of entries) {
    const ref = e.ref ? String(e.ref).slice(0, 60) : null
    // An answer closes the RFI it answers
    if (e.kind === "rfi_answer" && ref) {
      await sb.from("project_log").update({ status: "answered" }).eq("project_id", projectId).eq("kind", "rfi").eq("ref", ref).eq("status", "open")
    }
    const { error } = await sb.from("project_log").insert({
      project_id: projectId, kind: e.kind, ref, title: String(e.title).slice(0, 200), detail: e.detail ? String(e.detail).slice(0, 800) : null,
      status: ["open", "answered", "closed"].includes(e.status) ? e.status : (e.kind === "rfi" ? "open" : null),
      happened_at: when(e.date), source_item_id: isUuid(item.id) ? item.id : null, source_label: label,
    })
    if (error && !/duplicate|unique/i.test(error.message)) console.warn("[intake] diary insert", error.message)
  }
  return entries.length
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

  if (type === "invoice" || type === "supplier_order") {
    // What was bought for which job — feeds the datasheet checks (invoices themselves stay in Xero)
    if (project && pc >= 0.7) {
      const src = type === "invoice" ? "invoice" : (/deliver/i.test(item.file_name + " " + (g.summary || "")) ? "delivery" : "order")
      if (await recordPurchases(project.id, g, item, src) && src !== "order") await recheckForInfo(project.id).catch(() => 0)
    }
  }
  // Emails (text saved by Quant) are never filed as documents — they feed the job diary
  if (isEmailText(item) || type === "correspondence") {
    const n = Array.isArray(g.log) ? g.log.length : 0
    if (!project || pc < 0.7) return { status: "ignored", reason: `Email — couldn't tell which job${n ? ` (${n} diary note${n === 1 ? "" : "s"} not recorded)` : ""}` }
    return { status: "ignored", reason: n ? `Email — ${n} note${n === 1 ? "" : "s"} added to ${project.project_name}'s job diary` : `Email about ${project.project_name} — nothing for the diary` }
  }
  if (type === "invoice") return { status: "ignored", reason: project && pc >= 0.7 && (g.products || []).length ? `Invoice — handled in Xero (${(g.products || []).length} item${(g.products || []).length === 1 ? "" : "s"} noted for ${project.project_name}'s datasheets)` : "Invoice — handled in Xero" }
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
    // PAs get re-issued: CCG keeps ONE version of each PA. A client's marked-up
    // revision is never filed (the team updates our own version instead); our
    // updated version replaces the old one, which is archived (hidden, kept).
    if (type === "our_payment_application") {
      const n = num(g.pa_number) ?? paNumberOf(item.file_name)
      if (n != null) {
        const { data: existing } = await sb.from("project_doc_files").select("id, file_name, file_size")
          .eq("project_id", project.id).eq("folder_key", dest.folder_key).is("subfolder_key", null)
        const same = (existing || []).filter((f: any) => paNumberOf(f.file_name) === n)
        if (same.some((f: any) => f.file_name === cleanName(item.file_name) && (!item.file_size || !f.file_size || Number(f.file_size) === Number(item.file_size))))
          return { status: "ignored", reason: `This ${"PA" + String(n).padStart(2, "0")} is already in the CRM` }
        const label = "PA" + String(n).padStart(2, "0")
        const sender = senderOf(item.file_name)
        const fromClient = g.pa_revision_by === "client" || (!!sender && !/@cltd\.co\.uk$/i.test(sender))
        if (fromClient) {
          await raiseAlert({ key: `pa_client_rev:${project.id}:${n}:${item.id}`, project_id: project.id, kind: "pa_client_revision", severity: "soon",
            title: `Client revised ${label} — ${project.project_name}`,
            detail: `${sender || "The client"} sent back a revised ${label} ("${cleanName(item.file_name)}"). It isn't filed: update our ${label}, then upload it — the old one is archived automatically.`,
            action_label: "Open payment applications", action_url: `/projects/${project.id}?tab=documents` })
          return { status: "ignored", reason: `Client's revision of ${label} — not filed; flagged so the team updates our ${label}` }
        }
        if (same.length) {
          decision.replace_file_ids = same.map((f: any) => f.id)
          decision.path_label = `${project.project_name} › 02. Payment Application (replaces ${same.map((f: any) => f.file_name).join(", ")})`
          return { status: "to_check", decision, reason: `Updated ${label} — will replace the one already in the CRM (old one archived, not deleted)` }
        }
      }
    }
    const base = dest.subfolder_key || dest.folder_key
    if (PLACE_IN.has(base)) {
      const place = await choosePlace(project.id, base, item, g)
      if (place.new_folder) { decision.subfolder_key = dest.subfolder_key; decision.new_folder = place.new_folder }
      else decision.subfolder_key = (place.subfolder_key && place.subfolder_key !== base) ? place.subfolder_key : dest.subfolder_key
      decision.path_label = `${project.project_name} › ${dest.label.replace(/^Documents › /, "")}${place.path ? " › " + place.path : ""}`
      if (place.confidence < threshold) return { status: "to_check", decision, reason: `Not sure which sub-folder — suggested ${place.path || "the main folder"}` }
    }
    // RAMS from a known subcontractor also goes on their Compliance record
    if (type === "rams" && sub && sure(vc)) decision.also_compliance = { subcontractor_id: sub.id, document_type: "rams" }
    return { status: "filed", decision, reason: g.reason || "" }
  }

  if (HANDOVER_TYPES.has(type)) {
    if (!project) return { status: "to_check", reason: "Couldn't tell which job's handover this is for" }
    const decision: any = { target: "handover", project_id: project.id, path_label: `${project.project_name} › Handover (H&S File / O&M)` }
    if (type === "product_datasheet") {
      // Only products we actually bought for this job go into its O&M
      const prod = (g.products || [])[0] || {}
      const m = await matchPurchase(project.id, prod)
      if (!m) return { status: "to_check", decision, reason: `No purchase of ${[prod.manufacturer, prod.product].filter(Boolean).join(" ") || "this product"} found on ${project.project_name} — probably sent for info. File it only if we used it.` }
      decision.material_id = m.id
      decision.path_label += ` — bought: ${m.evidence_label || m.supplier || "on file"}`
    }
    if (!sure(pc)) return { status: "to_check", decision, reason: `Probably ${project.project_name} — please confirm` }
    return { status: "filed", decision, reason: g.reason || "" }
  }

  if (TOP_FOLDERS[type]) {
    if (!project) return { status: "to_check", reason: "Couldn't tell which job" }
    const who = (sub || sup)?.company_name || g.vendor?.name || ""
    const sub_name = type === "rfi" ? null : (who || null)
    const decision: any = { target: "project_doc", project_id: project.id, top_folder: TOP_FOLDERS[type], sub_name,
      path_label: `${project.project_name} › ${TOP_FOLDERS[type]}${sub_name ? " › " + sub_name : ""}` }
    if (type === "subcontractor_application") {
      const a = g.application || {}
      const amt = num(a.amount_due) ?? num(a.gross_to_date)
      return { status: "to_check", decision, reason: `Subcontractor application${who ? " from " + who : ""}${a.number ? " #" + a.number : ""}${amt != null ? " — £" + Math.round(amt).toLocaleString("en-GB") : ""}: check and approve` }
    }
    if (!sure(pc)) return { status: "to_check", decision, reason: `Probably ${project.project_name} — please confirm` }
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

async function fileItem(item0: any, d: any, actorId: string | null) {
  const item = { ...item0, file_name: cleanName(item0.file_name) }
  const g = item.guess || {}
  const stamp = `${Date.now()}-${safeName(item.file_name)}`
  const out: any = { target: d.target }

  if (d.target === "project_doc") {
    const { data: p } = await sb.from("projects").select("id, project_name").eq("id", d.project_id).maybeSingle()
    if (!p) throw new Error("Job not found")
    let folder = String(d.folder_key || "")
    let sub = d.subfolder_key || null
    let madeFolder: string | null = null
    if (d.top_folder) {
      const top = await ensureFolder(p.id, null, String(d.top_folder).slice(0, 60))
      folder = top.key; sub = null; madeFolder = top.label
      if (d.sub_name) {
        const f = await ensureFolder(p.id, top.key, String(d.sub_name).replace(/[\/\\:*?"<>|]/g, "-").trim().slice(0, 60))
        sub = f.key; madeFolder = `${top.label} › ${f.label}`
      }
    }
    if (d.new_folder?.name) {
      const name = String(d.new_folder.name).replace(/^\s*\d+\s*[.)-]\s*/, "").replace(/[\/\\:*?"<>|]/g, "-").trim().slice(0, 60)
      if (name) {
        const f = await ensureFolder(p.id, String(d.new_folder.parent_key || sub || folder), name)
        sub = f.key; madeFolder = f.label
      }
    }
    // Same file already in that folder → don't add it twice
    // Same name anywhere in this section of the job (e.g. PA07 already uploaded by hand)
    const replacing = Array.isArray(d.replace_file_ids) && d.replace_file_ids.length > 0
    const { data: dup } = replacing ? { data: [] } : await sb.from("project_doc_files").select("id").eq("project_id", p.id).eq("folder_key", folder).eq("file_name", item.file_name).limit(1)
    if (dup?.length) return { status: "duplicate", filed_to: { ...out, project_id: p.id, label: `Already in ${p.project_name}` } }
    const path = sub ? `projects/${p.id}/${folder}/${sub}/${stamp}` : `projects/${p.id}/${folder}/${stamp}`
    await copyStaged(item, path)
    const { data: row, error } = await sb.from("project_doc_files").insert({
      project_id: p.id, folder_key: folder, subfolder_key: sub, file_name: item.file_name,
      file_size: item.file_size, storage_path: path, client_visible: false,
    }).select("id").single()
    if (error) throw new Error(error.message)
    if (replacing) {
      // Old version → hidden archive (kept, recoverable; out of the CRM list, portal and figures)
      const ids = d.replace_file_ids.filter((x: unknown) => isUuid(x))
      if (ids.length) await sb.from("project_doc_files").update({ subfolder_key: "superseded", client_visible: false })
        .in("id", ids).eq("project_id", p.id).eq("folder_key", folder)
    }
    let lbl = Object.values(PROJECT_FOLDERS).find(f => f.folder_key === folder && f.subfolder_key === sub)?.label
    if (!lbl) {
      const { data: cf } = sub ? await sb.from("project_doc_folders").select("label").eq("project_id", p.id).eq("folder_key", sub).limit(1) : { data: null }
      lbl = `Documents › ${cf?.[0]?.label || sub || folder}`
    }
    Object.assign(out, { project_id: p.id, folder_key: folder, subfolder_key: sub, file_id: row.id, label: d.path_label ? d.path_label.replace(/ \(new folder\)/, "") : `${p.project_name} › ${lbl}`, ...(madeFolder ? { new_folder: madeFolder } : {}) })
    if (d.also_compliance?.subcontractor_id) {
      try {
        const c = await fileCompliance(item, { ...d.also_compliance }, actorId, g)
        out.also = c
      } catch (e) { out.also_error = String((e as Error).message || e) }
    }
    return { status: "filed", filed_to: out }
  }

  if (d.target === "compliance") return { status: "filed", filed_to: await fileCompliance(item, d, actorId, g) }
  if (d.target === "handover") return await fileToHandover(item, d)

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

// Drive folder rules: the longest matching folder path wins, so
// "13. Company & Admin" can be skipped while
// "13. Company & Admin / 19 Email Attachments Inbox" is read ("auto").
function folderRule(map: Record<string, string>, path: string | null) {
  const p = String(path || "")
  let best = { key: "", value: "" }
  for (const [k, v] of Object.entries(map || {})) {
    if ((p === k || p.startsWith(k + " / ")) && k.length > best.key.length) best = { key: k, value: v }
  }
  return best
}

// ─── Learning from the team ─────────────────────────────────────────────────
// Every time someone files or ignores an item by hand, the CRM keeps a short
// note of what Claude thought and what the team decided. The latest notes go
// into every reading, so the same mistake isn't made twice.
async function recordLesson(item: any, decision: any, action: "file" | "ignore", res?: any) {
  try {
    const g = item.guess || {}
    const sender = String(item.file_name).match(/-\s*([^\s@]+@[^\s]+)\s*-/)?.[1] || ""
    const thought = g._plan?.path_label || [g.doc_type, g.project_id ? "job " + g.project_id : null].filter(Boolean).join(", ") || "unsure"
    const did = action === "ignore" ? "ignored it (not for the CRM)" : `filed it to ${res?.filed_to?.label || decision?.target}`
    if (action === "file" && g._plan?.path_label && res?.filed_to?.label && res.filed_to.label === g._plan.path_label.replace(/ \(new folder\)/, "")) return // agreed — nothing to learn
    const lesson = `"${cleanName(item.file_name)}"${sender ? " from " + sender : ""}${item.source_path ? " (Drive: " + item.source_path + ")" : ""} — Claude suggested ${thought}; the team ${did}.`
    await sb.from("intake_lessons").insert({ item_id: item.id, lesson: lesson.slice(0, 600) })
  } catch { /* learning is best-effort */ }
}
async function loadLessons() {
  const { data } = await sb.from("intake_lessons").select("lesson").order("created_at", { ascending: false }).limit(60)
  return (data || []).map((r: any) => "- " + r.lesson).join("\n")
}

// ─── One file, start to finish ───────────────────────────────────────────────
const JUNK = /^(image\d{3}\.(png|jpe?g|gif)|winmail\.dat|.*\.(ics|vcf|p7s|htm|html))$/i

async function processItem(item: any, ctx: any, system: string, threshold: number, trial: boolean, folderMap: Record<string, string> = {}) {
  const upd = async (patch: any) => { await sb.from("intake_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", item.id) }
  try {
    const rule = folderRule(folderMap, item.source_path)
    if (rule.value === "skip") return upd({ status: "ignored", reason: `Drive folder "${rule.key}" is set to skip` })
    if (JUNK.test(cleanName(item.file_name)) || (/^image\//.test(item.mime_type || "") && (item.file_size || 0) < 40_000)) {
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

    // Drive job folder → CRM job (Inbox › Settings): strong evidence for the job
    const top = rule.key
    const mapped = rule.value
    const mappedProject = isUuid(mapped) ? ctx.projects.find((p: any) => p.id === mapped) : null
    const hint = mappedProject
      ? `This Drive folder ("${top}") is filed against CRM job ${mappedProject.id} | ${mappedProject.project_ref || ""} | ${mappedProject.project_name} | ${[mappedProject.site_address, mappedProject.postcode].filter(Boolean).join(", ")}.`
      : ""
    const g = await readWithClaude(system, item, bytes, hint)
    if (mappedProject) {
      const pc = num(g.project_confidence) ?? 0
      if (!g.project_id || g.project_id === mappedProject.id) { g.project_id = mappedProject.id; g.project_confidence = Math.max(pc, 0.95) }
      else if (pc >= threshold) {
        const other = ctx.projects.find((p: any) => p.id === g.project_id)
        g._conflict = `Drive folder says ${mappedProject.project_name}, but the file looks like ${other?.project_name || "another job"}`
        g.project_confidence = 0.5
      } else { g.project_id = mappedProject.id; g.project_confidence = 0.9 }
    }
    const plan: Plan = g._conflict ? { status: "to_check", reason: g._conflict } : await planFor(g, item, ctx, threshold)
    // Job diary — whatever the file says happened, when we know the job
    if (!g._conflict && g.project_id && (num(g.project_confidence) ?? 0) >= 0.7) await writeLog(g.project_id, g, item).catch(e => console.warn("[intake] diary", e))
    const base = {
      staged_path: staged, file_size: item.file_size, doc_type: g.doc_type || null, summary: g.summary || null,
      confidence: Math.min(num(g.type_confidence) ?? 0, g.project_id ? (num(g.project_confidence) ?? 0) : 1),
      guess: g, attempts: (item.attempts || 0) + 1, last_error: null,
    }
    if (plan.status !== "filed") return upd({ ...base, status: plan.status, reason: plan.reason, guess: plan.decision ? { ...g, _plan: plan.decision } : g })
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
  const lessons = await loadLessons().catch(() => "")
  const system = systemPrompt(ctx) + (lessons ? `\n\nThe team's past corrections (newest first) — follow the same patterns for similar files:\n${lessons}` : "")
  const threshold = Number(settings.auto_threshold) || 0.85
  const { data: queue } = await sb.from("intake_items").select("*")
    .or("status.eq.pending,and(status.eq.error,attempts.lt.3)")
    .order("source_created_at", { ascending: true }).limit(BATCH)
  let done = 0
  for (const item of queue || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    await processItem(item, ctx, system, threshold, settings.trial !== false, settings.folder_map || {})
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
  const given = req.headers.get("x-intake-key") || ""
  let cron = false
  if (given) {
    const { data: st } = await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()
    cron = (!!st?.cron_token && given === st.cron_token) || (!!CRON_KEY && given === CRON_KEY)
  }
  if (!cron) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: u } = token ? await sb.auth.getUser(token) : { data: { user: null } }
    if (!u?.user) return json({ error: "Not signed in" }, 401)
    const { data: prof } = await sb.from("profiles").select("id, role").eq("id", u.user.id).maybeSingle()
    if (!prof || !FILERS.includes(prof.role)) return json({ error: "Your role can't file documents" }, 403)
    actorId = prof.id
  } else if (action !== "run" && action !== "datasheets" && action !== "xero") {
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

    if (action === "datasheets") return json(await findDatasheets(cron ? 4 : 3))
    if (action === "xero") return json(await xeroRun(cron ? XERO_PER_RUN : 3))
    if (action === "xero_status") {
      const st = await (await xeroCall({ mode: "status" })).json().catch(() => ({}))
      const { data: rs } = await sb.from("xero_bill_reads").select("status").limit(20000)
      const reads: Record<string, number> = {}
      for (const r of (rs || []) as any[]) reads[r.status] = (reads[r.status] || 0) + 1
      return json({ connected: !!st.connected, tenant: st.tenant || null, attachments: !!st.attachments, last_sync: st.last_sync || null, reads })
    }
    if (action === "folders") {
      // The Drive folder's sub-folders, each with a suggested CRM job
      const { data: st } = await sb.from("intake_settings").select("drive_folder_id").eq("id", 1).maybeSingle()
      if (!st?.drive_folder_id) return json({ error: "Set the Drive folder first" }, 400)
      const d = await (await drive("files", {
        q: `'${st.drive_folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id,name)", pageSize: "200", includeItemsFromAllDrives: "true", corpora: "allDrives", orderBy: "name",
      })).json()
      const { data: projects } = await sb.from("projects").select("id, project_name, project_ref, site_address, city, postcode").neq("status", "cancelled")
      const words = (t: string) => new Set(String(t || "").toLowerCase().replace(/^\s*\d+\s*[.)-]\s*/, "").split(/[^a-z0-9]+/)
        .filter(w => w.length >= 3 && !["the", "and", "road", "street", "lane", "house", "new", "build", "unit", "office", "fit", "out"].includes(w)))
      const folders = (d.files || []).map((f: any) => {
        const fw = words(f.name)
        let best: any = null, bestScore = 0
        for (const p of projects || []) {
          const pw = words([p.project_name, p.site_address, p.city, p.project_ref].join(" "))
          const score = [...fw].filter(w => pw.has(w)).length
          if (score > bestScore) { best = p; bestScore = score }
        }
        return { id: f.id, name: f.name, suggestion: bestScore > 0 ? best.id : null }
      })
      return json({ folders })
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
      await recordLesson(item, null, "ignore")
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
      if (!["project_doc", "compliance", "quote", "handover"].includes(d.target)) return json({ error: "Pick where it goes" }, 400)
      for (const k of ["project_id", "subcontractor_id", "supplier_id", "task_id"]) if (d[k] && !isUuid(d[k])) return json({ error: `Bad ${k}` }, 400)
      const res = await fileItem(item, d, actorId)
      await recordLesson(item, d, "file", res)
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
