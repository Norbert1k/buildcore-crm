// ─────────────────────────────────────────────────────────────────────────────
// job-facts — the CRM fills in each job's parties, contract terms and
// procurement from the emails and documents the Inbox reads
//
// What it fills straight away (marked "filled by the CRM", undo-able):
//   • design team firms already in the directory → People › Design team
//   • the Employer's Agent, when the job has none and the firm is in the directory,
//     and new EA contacts (name / email / phone)
//   • subcontractors applying for payment on the job → People › Subcontractors
//   • procurement status moving forward: quote in → Quoting, application or
//     delivery → On site, plus who it's from when blank
//   • contract terms that are blank: form of contract, payment terms, defects
//     period, insurance, retention release, start / completion dates
// What waits for a person (Commercial › Contract, and Needs attention):
//   • anything with money: contract sum, retention %, LADs
//   • awards / orders to a subcontractor
//   • the client (it decides what the client portal shows)
//   • firms not in the directory yet, and anything that differs from what a
//     person already entered — never overwritten
//
// Actions (POST JSON):
//   { action: 'apply', project_id, facts, source }      Inbox (x-intake-key)
//   { action: 'decide', fill_id, accept, value? }       staff — accept / reject a suggestion
//   { action: 'undo', fill_id }                         staff — undo something the CRM filled
//   { action: 'tailor', project_id }                    staff — fit Procurement to this job's packages
//   { action: 'backfill', project_id?, limit? }         staff or schedule — read the job's
//                                                       letters of intent / contracts already filed
// Deploy: verify JWT off (it checks the key or the signed-in user itself).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1"
import * as XLSX from "https://esm.sh/xlsx@0.18.5"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const MODEL = "claude-sonnet-4-5"
const STAFF = ["admin", "project_manager", "operations_manager", "project_director", "document_controller"]
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-intake-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } })
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)
const num = (v: unknown) => { const n = typeof v === "string" ? parseFloat(v.replace(/[£,\s]/g, "")) : v; return typeof n === "number" && Number.isFinite(n) ? n : null }
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)
const money = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }

// ─── Matching companies ──────────────────────────────────────────────────────
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet|sky|virginmedia|mail|protonmail|cltd)\./i
const domainOf = (e: unknown) => { const m = String(e || "").toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/); return m && !FREE_MAIL.test(m[1]) ? m[1] : null }
const normCo = (s: unknown) => String(s || "").toLowerCase().replace(/&/g, " and ")
  .replace(/\b(ltd|limited|llp|plc|uk|group|the|co|company|services|consultants?|consultancy|associates)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim()
const sameCo = (a: unknown, b: unknown) => {
  const x = normCo(a), y = normCo(b)
  if (!x || !y) return false
  if (x === y) return true
  const [s, l] = x.length < y.length ? [x, y] : [y, x]
  return s.length >= 5 && (l.startsWith(s + " ") || l.endsWith(" " + s) || l.includes(" " + s + " "))
}
const isCcg = (p: any) => /city construction|\bcltd\b|\bccg\b/i.test(String(p?.company || "")) || /@cltd\.co\.uk$/i.test(String(p?.email || ""))

// Roles → directory trade (the names already used in Subcontractors) and the role on the job
const ROLES: Record<string, { trade: string; role: string; proc: string | null }> = {
  architect: { trade: "Architects", role: "Architect", proc: "Architect" },
  structural_engineer: { trade: "Structural Engineers", role: "Structural engineer", proc: "Structural engineer" },
  civil_engineer: { trade: "Civil Engineers", role: "Civil engineer", proc: "Civil engineer" },
  mep_engineer: { trade: "Consultant", role: "M&E engineer", proc: "M&E / services engineer" },
  principal_designer: { trade: "Principle Designers", role: "Principal designer", proc: "Principal designer (CDM)" },
  quantity_surveyor: { trade: "Consultant", role: "Quantity surveyor", proc: "Quantity surveyor" },
  building_control: { trade: "Building Control", role: "Building control", proc: null },
  fire_consultant: { trade: "Fire Consultants", role: "Fire consultant", proc: null },
  warranty_provider: { trade: "Warranty Providers", role: "Warranty provider", proc: null },
  other_consultant: { trade: "Consultant", role: "Consultant", proc: null },
}

// ─── Contract terms ──────────────────────────────────────────────────────────
type Term = { label: string; money?: boolean; on: "projects" | "contract"; col: string; kind: "money" | "pct" | "date" | "int" | "text" | "per" }
const TERMS: Record<string, Term> = {
  contract_sum: { label: "Contract sum", money: true, on: "projects", col: "value", kind: "money" },
  retention_pct: { label: "Retention %", money: true, on: "projects", col: "retention_pct", kind: "pct" },
  lads_amount: { label: "Liquidated damages (LADs)", money: true, on: "contract", col: "lads_amount", kind: "money" },
  start_date: { label: "Start date", on: "projects", col: "start_date", kind: "date" },
  completion_date: { label: "Completion date", on: "projects", col: "end_date", kind: "date" },
  form: { label: "Form of contract", on: "contract", col: "contract_form", kind: "text" },
  contract_date: { label: "Contract date", on: "contract", col: "contract_date", kind: "date" },
  reference: { label: "Contract reference", on: "contract", col: "contract_ref", kind: "text" },
  retention_release: { label: "Retention release", on: "contract", col: "retention_release", kind: "text" },
  payment_terms: { label: "Payment terms", on: "contract", col: "payment_terms", kind: "text" },
  defects_period_months: { label: "Defects period (months)", on: "contract", col: "defects_period_months", kind: "int" },
  insurance: { label: "Insurance required", on: "contract", col: "insurance", kind: "text" },
}
function termValue(t: Term, v: unknown) {
  if (t.kind === "money") { const n = num(v); return n != null && n > 0 ? Math.round(n * 100) / 100 : null }
  if (t.kind === "pct") { const n = num(v); return n != null && n >= 0 && n <= 20 ? n : null }
  if (t.kind === "int") { const n = num(v); return n != null && n > 0 && n < 120 ? Math.round(n) : null }
  if (t.kind === "date") return isoDate(v)
  return str(v, 400)
}
function showTerm(t: Term, v: any, per?: string | null) {
  if (v == null || v === "") return "—"
  if (t.kind === "money") return money(Number(v)) + (t.col === "lads_amount" && per ? ` per ${per}` : "")
  if (t.kind === "pct") return `${v}%`
  if (t.kind === "date") return fmtDate(String(v).slice(0, 10))
  return String(v)
}
const sameTerm = (t: Term, a: any, b: any) => {
  if (a == null || a === "" || b == null || b === "") return false
  if (t.kind === "money" || t.kind === "pct" || t.kind === "int") return Math.abs(Number(a) - Number(b)) < 0.01
  if (t.kind === "date") return String(a).slice(0, 10) === String(b).slice(0, 10)
  return normCo(a) === normCo(b)
}

// ─── Procurement tracker (same template as Commercial › Procurement) ─────────
const TEMPLATE: [string, string[]][] = [
  ["Stage 1 · Design team", ["Architect", "Structural engineer", "M&E / services engineer", "Civil engineer", "Principal designer (CDM)", "Quantity surveyor"]],
  ["Stage 2 · Reports & surveys", ["Topographical survey", "Ground investigation / soil report", "Measured building survey", "Asbestos survey", "Arboricultural survey", "Drainage / CCTV survey", "Party wall surveyor"]],
  ["Stage 3 · Enabling & demolition", ["Site setup / hoarding / welfare", "Scaffolding", "Demolition", "Site clearance", "Temporary works"]],
  ["Stage 4 · Groundworks & civils", ["Excavation & muck away", "Foundations & concrete", "Drainage below ground", "Ground floor slab", "Substructure brick/block", "External services / ducting"]],
  ["Stage 5 · Structure", ["Structural steelwork", "Structural timber / frame", "Masonry superstructure", "Precast / beam & block floors", "Roof structure", "Staircases"]],
  ["Stage 6 · Envelope & weatherproofing", ["Roof covering", "Windows & external doors", "Cladding / render", "Brickwork / facing", "Rainwater goods", "External waterproofing / tanking"]],
  ["Stage 7 · First fix", ["First fix carpentry", "First fix electrical", "First fix plumbing & heating", "Mechanical ventilation", "Underfloor heating", "Insulation"]],
  ["Stage 8 · Second fix & finishes", ["Plastering / drylining", "Second fix carpentry", "Second fix electrical", "Second fix plumbing", "Kitchens", "Tiling", "Decoration", "Flooring"]],
  ["Stage 9 · External works & landscaping", ["Hard landscaping / paving", "Soft landscaping", "Boundary walls & fencing", "Drainage above ground", "Road / driveway surfacing", "External lighting"]],
  ["Stage 10 · Completion & handover", ["Commissioning M&E", "Building control sign-off", "Snagging", "As-built drawings / O&M manuals", "Cleaning", "Handover"]],
]
const uid = () => Math.random().toString(36).slice(2, 10)
const buildTemplate = () => ({ stages: TEMPLATE.map(([name, trades]) => ({ id: uid(), name, trades: trades.map(t => ({ id: uid(), name: t, materials: false, labour: false, procured_from: "", status: "Not started", target_date: "", notes: "" })) })) })
const STAGES = ["Not started", "Quoting", "Ordered", "On site", "Complete"]   // "Not required" sits below them all
const OTHER_STAGE = "Other packages"
// Which stage a package the template doesn't list belongs in
const STAGE_HINTS: [RegExp, number][] = [
  [/architect|engineer|designer|consultant|survey(or)?|cdm|planning|acoustic|fire (strategy|engineer)|sap|energy/i, 0],
  [/survey|investigation|asbestos|topo|cctv|arbor|party wall|ecolog|utility (search|survey)/i, 1],
  [/hoarding|welfare|scaffold|demoli|clearance|temporary|security|crane|site set/i, 2],
  [/ground|excavat|piling|foundation|drainage below|slab|civils?|muck|kerb|road(s)?\b|sewer|utilit|ducting|crossing/i, 3],
  [/steel|frame|sfs|timber frame|precast|beam|block|masonry|concrete frame|stair|lift shaft/i, 4],
  [/roof|window|door|glaz|curtain|clad|render|brick|facade|façade|rainwater|waterproof|balcon/i, 5],
  [/electric|plumb|heating|mechanical|ventilation|mvhr|sprinkler|fire alarm|data|security system|insulation|first fix|gas/i, 6],
  [/plaster|drylin|partition|ceiling|joinery|carpentr|kitchen|tiling|decorat|paint|floor|sanitary|bathroom|wardrobe|ironmonger|mastic|second fix/i, 7],
  [/landscap|paving|fenc|boundary|tarmac|surfacing|external light|planting|gates/i, 8],
  [/commission|snag|clean|handover|o&m|as-built|building control/i, 9],
]
function stageFor(stages: any[], trade: string) {
  const hit = STAGE_HINTS.find(([re]) => re.test(trade))
  if (hit) {
    const want = TEMPLATE[hit[1]][0]
    const s = stages.find((x: any) => x.name === want) || stages.find((x: any) => normCo(x.name).includes(normCo(want.split("·")[1] || want)))
    if (s) return s
  }
  let s = stages.find((x: any) => x.name === OTHER_STAGE)
  if (!s) { s = { id: uid(), name: OTHER_STAGE, trades: [] }; stages.push(s) }
  return s
}
const newTrade = (name: string) => ({ id: uid(), name, materials: false, labour: false, procured_from: "", status: "Not started", target_date: "", notes: "" })
const STAGE_OF: Record<string, string> = { quoting: "Quoting", ordered: "Ordered", on_site: "On site", complete: "Complete" }
const TRADE_STOP = new Set(["first", "second", "fix", "general", "other", "&", "and", "the", "works", "work", "package", "subcontract", "subcontractor", "supply", "fit", "install", "installation", "of", "to", "for", "services", "a"])
const SYN: Record<string, string> = { groundwork: "excavation foundations drainage slab", groundworks: "excavation foundations drainage slab", electrical: "electrical", electrics: "electrical", plumbing: "plumbing", mechanical: "mechanical ventilation plumbing heating", roofing: "roof covering", roofer: "roof covering", scaffold: "scaffolding", brickwork: "brickwork masonry facing", bricklaying: "brickwork masonry facing", drylining: "plastering drylining", plastering: "plastering drylining", decorating: "decoration", painting: "decoration", flooring: "flooring", windows: "windows", glazing: "windows", landscaping: "landscaping", fencing: "fencing boundary", steel: "steelwork", steelwork: "steelwork", carpentry: "carpentry", joinery: "carpentry", kitchens: "kitchens", tiling: "tiling", demolition: "demolition", cladding: "cladding render", render: "cladding render", asbestos: "asbestos", insulation: "insulation", sfs: "frame structural", frame: "frame", surfacing: "surfacing road driveway", tarmac: "surfacing road driveway", paving: "paving hard landscaping", cleaning: "cleaning" }
const words = (s: string) => String(s || "").toLowerCase().split(/[^a-z0-9&]+/).filter(w => w.length > 1 && !TRADE_STOP.has(w))
const expand = (s: string) => { const w = words(s); return new Set(w.flatMap(x => [x, ...(SYN[x] ? SYN[x].split(" ") : [])])) }
// The tracker rows a package covers: a row named like it (both fixes of "Electrical"),
// or a whole stage when the package is the stage ("Groundworks" → Stage 4 · Groundworks & civils)
function findTrades(stages: any[], trade: string): any[] {
  const want = expand(trade)
  if (!want.size) return []
  const scored: { t: any; score: number }[] = []
  for (const s of stages) for (const t of s.trades || []) {
    const have = new Set(words(t.name))
    if (!have.size) continue
    const hit = [...have].filter(w => want.has(w)).length
    if (hit) scored.push({ t, score: hit / have.size })
  }
  // 1. Rows named exactly for it ("Demolition", both "… electrical" rows)
  const exact = scored.filter(x => x.score === 1).map(x => x.t)
  if (exact.length) return exact.slice(0, 4)
  // 2. The package is a whole stage ("Groundworks" → Stage 4 · Groundworks & civils)
  const own = new Set(words(trade))
  for (const s of stages) {
    const sw = words(String(s.name).replace(/^stage\s*\d+\s*·?/i, ""))
    if (sw.some(w => own.has(w))) return (s.trades || []).filter((t: any) => t.status !== "Not required").slice(0, 8)
  }
  // 3. The closest rows
  const best = Math.max(0, ...scored.map(x => x.score))
  return best >= 0.5 ? scored.filter(x => Math.abs(x.score - best) < 1e-9).map(x => x.t).slice(0, 4) : []
}

// ─── Recording what was filled / suggested ───────────────────────────────────
type Src = { item_id?: string | null; label?: string | null; date?: string | null; doc_type?: string | null }
async function record(projectId: string, f: { kind: string; field: string; label: string; value: any; display: string; previous?: any; status: "applied" | "pending"; why?: string | null }, src: Src) {
  const row = { project_id: projectId, ...f, previous: f.previous ?? null, why: f.why ?? null,
    source_item_id: isUuid(src.item_id) ? src.item_id : null, source_label: src.label || null, source_date: src.date || new Date().toISOString() }
  const { data, error } = await sb.from("job_fills").insert(row).select("id").maybeSingle()
  if (error) { if (!/duplicate|unique/i.test(error.message)) console.warn("[job-facts] record", error.message); return null }
  // A newer suggestion for the same thing replaces an older one still waiting
  if (f.status === "pending" && data?.id) {
    await sb.from("job_fills").update({ status: "superseded" }).eq("project_id", projectId).eq("field", f.field).eq("status", "pending").neq("id", data.id)
  }
  return data?.id || null
}
async function alertPending(projectId: string) {
  const { count } = await sb.from("job_fills").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "pending")
  const key = `job_fills:${projectId}`
  const { data: e } = await sb.from("crm_alerts").select("id, status").eq("key", key).maybeSingle()
  if (!count) {
    if (e && e.status === "open") await sb.from("crm_alerts").update({ status: "done", resolved_at: new Date().toISOString() }).eq("id", e.id)
    return 0
  }
  const { data: p } = await sb.from("projects").select("project_name").eq("id", projectId).maybeSingle()
  const row = { key, project_id: projectId, kind: "job_fills", severity: "soon",
    title: `${count} job detail${count === 1 ? "" : "s"} to check — ${p?.project_name || "job"}`,
    detail: "The CRM read these from emails and documents (contract sum, retention, LADs, client, new firms, awards). Accept or reject each one.",
    action_label: "Check them", action_url: `/projects/${projectId}?tab=contract`, last_seen: new Date().toISOString() }
  if (!e) await sb.from("crm_alerts").insert({ ...row, status: "open" })
  else if (e.status !== "dismissed") await sb.from("crm_alerts").update({ ...row, status: "open", resolved_at: null }).eq("id", e.id)
  return count
}

// ─── Loading the job as it stands ───────────────────────────────────────────
async function loadJob(projectId: string) {
  const [p, c, subsOnJob, eaLinks] = await Promise.all([
    sb.from("projects").select("id, project_name, client_name, client_id, value, retention_pct, start_date, end_date, division").eq("id", projectId).maybeSingle(),
    sb.from("project_contract").select("*").eq("project_id", projectId).maybeSingle(),
    sb.from("project_subcontractors").select("id, subcontractor_id, category, trade_on_project, status").eq("project_id", projectId),
    sb.from("project_employer_agents").select("id, ea_id, employer_agents(id, company_name, email, payment_submission_email)").eq("project_id", projectId),
  ])
  if (!p.data) throw new Error("Job not found")
  return { project: p.data as any, contract: (c.data || null) as any, subsOnJob: (subsOnJob.data || []) as any[], eaLinks: (eaLinks.data || []) as any[] }
}
let dirCache: { subs: any[]; eas: any[]; eaContacts: any[]; clients: any[]; at: number } | null = null
async function directory() {
  if (dirCache && Date.now() - dirCache.at < 60_000) return dirCache
  const [s, e, ec, cl] = await Promise.all([
    sb.from("subcontractors").select("id, company_name, contact_name, trade, email, phone, category, status"),
    sb.from("employer_agents").select("id, company_name, email, payment_submission_email, division, status"),
    sb.from("employer_agent_contacts").select("id, ea_id, name, email, phone"),
    sb.from("clients").select("id, name, division"),
  ])
  dirCache = { subs: s.data || [], eas: e.data || [], eaContacts: ec.data || [], clients: cl.data || [], at: Date.now() }
  return dirCache
}
function matchSub(d: any, party: any) {
  const dom = domainOf(party.email)
  return d.subs.find((s: any) => dom && domainOf(s.email) === dom) || d.subs.find((s: any) => sameCo(s.company_name, party.company)) || null
}
function matchEa(d: any, party: any) {
  const dom = domainOf(party.email)
  if (dom) {
    const c = d.eaContacts.find((x: any) => domainOf(x.email) === dom)
    const e = d.eas.find((x: any) => domainOf(x.email) === dom || domainOf(x.payment_submission_email) === dom || (c && x.id === c.ea_id))
    if (e) return e
  }
  return d.eas.find((x: any) => sameCo(x.company_name, party.company)) || null
}

// ─── Cross-checks: a second opinion on money before a person decides ─────────
// The figure is checked against the job's own PAs (read by the progress-report
// robot) and against every other document that mentioned it.
let keyCache: string | null = null
async function paTotals(projectId: string) {
  try {
    if (!keyCache) keyCache = (await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()).data?.cron_token || null
    if (!keyCache) return null
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/progress-draft`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-intake-key": keyCache }, body: JSON.stringify({ action: "pa_totals", project_id: projectId }) })
    const d = await r.json()
    return d?.ok && d.pa ? d : null
  } catch { return null }
}
async function crossCheck(projectId: string, key: string, v: number, srcLabel: string | null | undefined, pa: any) {
  const notes: string[] = []
  if (key === "contract_sum" && pa?.total > 0) {
    const diff = v - pa.total
    notes.push(Math.abs(diff) < 1 ? `matches ${pa.pa} (${money(pa.total)})` : `${pa.pa} shows ${money(pa.total)} (${diff > 0 ? "+" : "−"}${money(Math.abs(diff))})`)
  }
  if (key === "retention_pct" && pa?.retention_pct != null) notes.push(Number(pa.retention_pct) === v ? `matches ${pa.pa}` : `${pa.pa} uses ${pa.retention_pct}%`)
  const { data: same } = await sb.from("job_fills").select("source_label, value").eq("project_id", projectId).eq("field", key).neq("status", "superseded")
  const others = new Set((same || []).filter((f: any) => Number(f.value?.v) === v && f.source_label && f.source_label !== srcLabel).map((f: any) => f.source_label))
  if (others.size) notes.push(`also in ${others.size} other document${others.size === 1 ? "" : "s"}`)
  const differ = new Set((same || []).filter((f: any) => f.value?.v != null && Number(f.value.v) !== v).map((f: any) => money(Number(f.value.v))))
  if (differ.size && key !== "retention_pct") notes.push(`other documents say ${[...differ].slice(0, 3).join(" / ")}`)
  return notes.length ? "Check: " + notes.join("; ") : null
}

// ─── Apply what a file says ─────────────────────────────────────────────────
async function apply(projectId: string, facts: any, src: Src, trial = false) {
  const job = await loadJob(projectId)
  const d = await directory()
  const out = { applied: 0, pending: 0 }
  const note = async (f: any): Promise<string | null> => {
    const status = trial && f.status === "applied" ? "pending" : f.status
    const why = status === "pending" && f.status === "applied" ? "Trial mode — the CRM only suggests for now" : f.why
    // Already filled / suggested from an earlier email → nothing new
    const { data: seen } = await sb.from("job_fills").select("id").eq("project_id", projectId).eq("field", f.field).eq("value", JSON.stringify(f.value)).limit(1)
    if (seen?.length) return null
    if (status === "applied" && f.run) await f.run()
    const { run: _r, ...rest } = f
    const id = await record(projectId, { ...rest, status, why }, src)
    if (id) out[status === "applied" ? "applied" : "pending"]++
    return id
  }

  // 1. Parties
  const parties = (Array.isArray(facts?.parties) ? facts.parties : []).filter((x: any) => x && str(x.company) && !isCcg(x)).slice(0, 12)
  for (const party of parties) {
    const company = str(party.company, 160)!
    const contact = { contact_name: str(party.contact_name, 120), job_title: str(party.job_title, 120), email: str(party.email, 160)?.toLowerCase() || null, phone: str(party.phone, 40) }
    if (party.role === "client") {
      if (sameCo(job.project.client_name, company)) continue
      const cl = d.clients.find((c: any) => sameCo(c.name, company) && (!job.project.division || !c.division || c.division === job.project.division))
      await note({ kind: "party", field: "client", label: "Client", value: { name: company, client_id: cl?.id || null },
        display: company + (cl ? " (in Clients)" : " (not in Clients yet)"), previous: { name: job.project.client_name, client_id: job.project.client_id },
        status: "pending", why: job.project.client_name ? `The job says ${job.project.client_name}` : "The client decides what the client portal shows — needs a person" })
      continue
    }
    if (party.role === "employer_agent") {
      const ea = matchEa(d, party)
      const linked = ea && job.eaLinks.find((l: any) => l.ea_id === ea.id)
      if (ea && !linked && !job.eaLinks.length) {
        await note({ kind: "party", field: "employer_agent", label: "Employer's Agent", value: { ea_id: ea.id, name: ea.company_name }, display: ea.company_name,
          status: "applied", run: async () => { const { data } = await sb.from("project_employer_agents").insert({ project_id: projectId, ea_id: ea.id }).select("id").maybeSingle(); if (data) job.eaLinks.push({ id: data.id, ea_id: ea.id }) } })
      } else if (ea && !linked) {
        await note({ kind: "party", field: "employer_agent", label: "Employer's Agent", value: { ea_id: ea.id, name: ea.company_name }, display: ea.company_name,
          status: "pending", why: `The job already has ${job.eaLinks.map((l: any) => l.employer_agents?.company_name).filter(Boolean).join(", ") || "an EA"}` })
      } else if (!ea) {
        await note({ kind: "party", field: "employer_agent", label: "Employer's Agent", value: { new: true, name: company, ...contact }, display: `${company} (new firm)`,
          status: "pending", why: "Not in Employers Agents yet — accept to add the firm and link it to this job" })
      }
      // New EA contact (a person, not money): add straight away
      if (ea && contact.email && contact.contact_name && !d.eaContacts.find((c: any) => c.ea_id === ea.id && String(c.email || "").toLowerCase() === contact.email)) {
        await note({ kind: "party", field: `ea_contact:${contact.email}`, label: `EA contact — ${ea.company_name}`, value: { ea_id: ea.id, ...contact }, display: [contact.contact_name, contact.job_title, contact.email, contact.phone].filter(Boolean).join(" · "),
          status: "applied", run: async () => { await sb.from("employer_agent_contacts").insert({ ea_id: ea.id, name: contact.contact_name, job_title: contact.job_title, email: contact.email, phone: contact.phone, sort: 50 }); d.eaContacts.push({ ea_id: ea.id, email: contact.email }) } })
      }
      continue
    }
    const r = ROLES[party.role]
    if (r) {
      const s = matchSub(d, party)
      const onJob = s && job.subsOnJob.find((x: any) => x.subcontractor_id === s.id)
      if (s && !onJob) {
        await note({ kind: "party", field: `design:${party.role}:${s.id}`, label: `Design team — ${r.role}`, value: { subcontractor_id: s.id, name: s.company_name, role: r.role }, display: s.company_name,
          status: "applied", run: async () => {
            const { data } = await sb.from("project_subcontractors").insert({ project_id: projectId, subcontractor_id: s.id, category: "design_team", trade_on_project: r.role, status: "active" }).select("id").maybeSingle()
            if (data) job.subsOnJob.push({ id: data.id, subcontractor_id: s.id, category: "design_team" })
          } })
      } else if (!s) {
        await note({ kind: "party", field: `design:${party.role}:${normCo(company)}`, label: `Design team — ${r.role}`, value: { new: true, name: company, role: r.role, trade: r.trade, ...contact }, display: `${company} (new firm)`,
          status: "pending", why: "Not in the directory yet — accept to add the firm and put it on this job" })
      }
      if (s) await fillContact(s, contact, note)
      continue
    }
    if (party.role === "subcontractor") {
      const s = matchSub(d, party)
      if (!s) continue
      const onJob = job.subsOnJob.find((x: any) => x.subcontractor_id === s.id)
      // Applying for payment on the job = working on it
      if (!onJob && src.doc_type === "subcontractor_application") {
        await note({ kind: "party", field: `sub:${s.id}`, label: "Subcontractor on this job", value: { subcontractor_id: s.id, name: s.company_name, trade: str(party.trade, 80) || s.trade }, display: `${s.company_name}${party.trade ? " — " + party.trade : ""}`,
          status: "applied", run: async () => {
            const { data } = await sb.from("project_subcontractors").insert({ project_id: projectId, subcontractor_id: s.id, category: "contractual_work", trade_on_project: str(party.trade, 80) || s.trade, status: "active" }).select("id").maybeSingle()
            if (data) job.subsOnJob.push({ id: data.id, subcontractor_id: s.id, category: "contractual_work" })
          } })
      }
      await fillContact(s, contact, note)
    }
  }

  // 2. Contract terms (the main contract between the client and CCG only)
  const c = facts?.contract
  let pa: any = undefined
  if (c && c.applies === true) {
    for (const [k, t] of Object.entries(TERMS)) {
      const v = termValue(t, c[k])
      if (v == null) continue
      const cur = t.on === "projects" ? (job.project as any)[t.col] : job.contract?.[t.col]
      if (sameTerm(t, cur, v)) continue
      const per = k === "lads_amount" ? (c.lads_per === "day" ? "day" : "week") : null
      const value = per ? { v, per } : { v }
      const display = showTerm(t, v, per)
      const empty = cur == null || cur === "" || (t.kind === "money" && Number(cur) === 0)
      if (t.money || !empty) {
        if ((k === "contract_sum" || k === "retention_pct") && pa === undefined) pa = await paTotals(projectId)
        const check = t.kind === "money" || t.kind === "pct" ? await crossCheck(projectId, k, Number(v), src.label, pa) : null
        await note({ kind: "contract", field: k, label: t.label, value, display, previous: cur ?? null, status: "pending",
          why: [t.money ? "Money — needs a person" : `The job has ${showTerm(t, cur, job.contract?.lads_per)}`, check].filter(Boolean).join(". ") })
      } else {
        await note({ kind: "contract", field: k, label: t.label, value, display, previous: null, status: "applied", run: () => setTerm(projectId, k, value, null) })
      }
    }
  }

  // 3. Procurement
  const procs = (Array.isArray(facts?.procurement) ? facts.procurement : []).filter((x: any) => x && str(x.trade) && STAGE_OF[x.stage]).slice(0, 8)
  if (procs.length) {
    const { data: row } = await sb.from("project_procurement").select("data, updated_at").eq("project_id", projectId).maybeSingle()
    const doc = row?.data?.stages?.length ? row.data : row?.data?.buildings ? null : buildTemplate()
    if (doc) {
      let changed = false
      const done: string[] = []
      for (const pr of procs) {
        // A package this job has that the tracker doesn't list yet → its own row
        let rows = findTrades(doc.stages, pr.trade)
        if (!rows.length && !trial) {
          const name = String(pr.trade).trim().replace(/\s+/g, " ").slice(0, 80).replace(/^./, (c: string) => c.toUpperCase())
          const stage = stageFor(doc.stages, name)
          const row = newTrade(name)
          const id = await note({ kind: "procurement", field: `trade_new:${normCo(name)}`, label: `Procurement — new package`, value: { trade_id: row.id, name, stage: stage.name }, display: `${name} (added to ${stage.name})`,
            status: "applied", run: async () => { stage.trades.push({ ...row, crm: { at: new Date().toISOString(), from: src.label || null, did: "added" } }); changed = true } })
          if (id) { done.push(id); rows = [row] ; rows[0] = stage.trades[stage.trades.length - 1] }
        }
      for (const [ti, t] of rows.entries()) {
        const company = str(pr.company, 120) || ""
        const target = STAGE_OF[pr.stage]
        const ahead = STAGES.indexOf(target) > STAGES.indexOf(t.status || "Not started")
        const patch: any = {}
        // The package's status goes on its first row; who it's from goes on every row it covers
        if (ahead && ti === 0) patch.status = target
        if (company && !t.procured_from && pr.stage !== "quoting") patch.procured_from = company
        if (pr.materials === true && !t.materials) patch.materials = true
        if (pr.labour === true && !t.labour) patch.labour = true
        if (!Object.keys(patch).length) continue
        const field = `trade:${t.id}:${patch.status || "detail"}`
        const display = [patch.status, patch.procured_from && `from ${patch.procured_from}`, patch.materials && "materials", patch.labour && "labour"].filter(Boolean).join(" · ")
        const previous = { status: t.status, procured_from: t.procured_from, materials: t.materials, labour: t.labour }
        if (pr.stage === "ordered") {
          // An award / order — a person confirms it
          await note({ kind: "procurement", field, label: `Procurement — ${t.name}`, value: { trade_id: t.id, patch, company, sub_name: company }, display, previous, status: "pending",
            why: `Order / award to ${company || "a company"} — needs a person` })
          continue
        }
        const id = await note({ kind: "procurement", field, label: `Procurement — ${t.name}`, value: { trade_id: t.id, patch }, display, previous, status: "applied",
          run: async () => { Object.assign(t, patch, { crm: { at: new Date().toISOString(), from: src.label || null, did: display } }); changed = true } })
        if (id) done.push(id)
      }
      }
      if (changed && !trial) {
        try { await saveProcurement(projectId, doc, row?.updated_at || null) }
        catch {
          // Someone was editing Procurement at that moment — leave these for a person
          if (done.length) await sb.from("job_fills").update({ status: "pending", why: "Procurement was being edited — accept to apply" }).in("id", done)
          out.applied -= done.length; out.pending += done.length
        }
      }
    }
  }
  await alertPending(projectId)
  return out
}

async function fillContact(s: any, contact: any, note: (f: any) => Promise<string | null>) {
  const patch: any = {}
  if (contact.email && !s.email) patch.email = contact.email
  if (contact.phone && !s.phone) patch.phone = contact.phone
  if (!Object.keys(patch).length) return
  await note({ kind: "party", field: `contact:${s.id}`, label: `Contact details — ${s.company_name}`, value: { subcontractor_id: s.id, patch }, display: Object.values(patch).join(" · "),
    previous: { email: s.email, phone: s.phone }, status: "applied", run: async () => { await sb.from("subcontractors").update(patch).eq("id", s.id); Object.assign(s, patch) } })
}

async function setTerm(projectId: string, key: string, value: any, actor: string | null) {
  const t = TERMS[key]
  if (t.on === "projects") {
    const { error } = await sb.from("projects").update({ [t.col]: value.v }).eq("id", projectId)
    if (error) throw new Error(error.message)
  } else {
    const patch: any = { project_id: projectId, [t.col]: value.v, updated_at: new Date().toISOString(), updated_by: actor }
    if (key === "lads_amount") patch.lads_per = value.per || "week"
    const { error } = await sb.from("project_contract").upsert(patch, { onConflict: "project_id" })
    if (error) throw new Error(error.message)
  }
}

async function saveProcurement(projectId: string, doc: any, prevAt: string | null) {
  const now = new Date().toISOString()
  if (prevAt) {
    const { data } = await sb.from("project_procurement").update({ data: doc, updated_at: now }).eq("project_id", projectId).eq("updated_at", prevAt).select("project_id")
    if (data?.length) return
    // Someone saved in between — reapply on top of theirs next time rather than overwrite
    throw new Error("Procurement changed while updating — will pick it up next time")
  }
  await sb.from("project_procurement").upsert({ project_id: projectId, data: doc, updated_at: now }, { onConflict: "project_id" })
}

// ─── A person accepts / rejects / undoes ────────────────────────────────────
async function decide(fillId: string, accept: boolean, actor: string, override: any) {
  const { data: f } = await sb.from("job_fills").select("*").eq("id", fillId).maybeSingle()
  if (!f) throw new Error("Not found")
  if (f.status !== "pending") throw new Error("Already dealt with")
  const now = new Date().toISOString()
  if (!accept) {
    await sb.from("job_fills").update({ status: "rejected", decided_by: actor, decided_at: now }).eq("id", f.id)
    await alertPending(f.project_id)
    return { ok: true }
  }
  const v = f.value || {}
  const job = await loadJob(f.project_id)
  if (f.kind === "contract") {
    const t = TERMS[f.field]
    const val = override != null ? { ...v, v: termValue(t, override) } : v
    if (val.v == null) throw new Error("That value doesn't look right")
    await setTerm(f.project_id, f.field, val, actor)
    await sb.from("job_fills").update({ value: val, display: showTerm(t, val.v, val.per) }).eq("id", f.id)
  } else if (f.field === "client") {
    const patch: any = { client_name: v.name }
    if (v.client_id) patch.client_id = v.client_id
    const { error } = await sb.from("projects").update(patch).eq("id", f.project_id)
    if (error) throw new Error(error.message)
  } else if (f.field === "employer_agent") {
    let eaId = v.ea_id
    if (v.new) {
      const { data: ea, error } = await sb.from("employer_agents").insert({ company_name: v.name, contact_name: v.contact_name || null, email: v.email || null, phone: v.phone || null, status: "active", division: job.project.division || undefined, created_by: actor }).select("id").maybeSingle()
      if (error || !ea) throw new Error(error?.message || "Couldn't add the EA")
      eaId = ea.id
      if (v.email || v.contact_name) await sb.from("employer_agent_contacts").insert({ ea_id: eaId, name: v.contact_name || v.email, job_title: v.job_title || null, email: v.email || null, phone: v.phone || null, is_primary: true })
    }
    if (!job.eaLinks.find((l: any) => l.ea_id === eaId)) await sb.from("project_employer_agents").insert({ project_id: f.project_id, ea_id: eaId })
  } else if (f.field.startsWith("design:")) {
    let subId = v.subcontractor_id
    if (v.new) {
      const { data: s, error } = await sb.from("subcontractors").insert({ company_name: v.name, contact_name: v.contact_name || v.name, trade: v.trade || "Consultant", email: v.email || null, phone: v.phone || null, category: "design_team", status: "active", created_by: actor }).select("id").maybeSingle()
      if (error || !s) throw new Error(error?.message || "Couldn't add the firm")
      subId = s.id
    }
    if (!job.subsOnJob.find((x: any) => x.subcontractor_id === subId)) await sb.from("project_subcontractors").insert({ project_id: f.project_id, subcontractor_id: subId, category: "design_team", trade_on_project: v.role, status: "active", assigned_by: actor })
  } else if (f.field.startsWith("ea_contact:")) {
    await sb.from("employer_agent_contacts").insert({ ea_id: v.ea_id, name: v.contact_name || v.email, job_title: v.job_title || null, email: v.email || null, phone: v.phone || null, sort: 50 })
  } else if (f.field.startsWith("contact:")) {
    await sb.from("subcontractors").update(v.patch || {}).eq("id", v.subcontractor_id)
  } else if (f.field.startsWith("sub:")) {
    if (!job.subsOnJob.find((x: any) => x.subcontractor_id === v.subcontractor_id)) await sb.from("project_subcontractors").insert({ project_id: f.project_id, subcontractor_id: v.subcontractor_id, category: "contractual_work", trade_on_project: v.trade || null, status: "active", assigned_by: actor })
  } else if (f.field.startsWith("trade_new:")) {
    const { data: row } = await sb.from("project_procurement").select("data, updated_at").eq("project_id", f.project_id).maybeSingle()
    const doc = row?.data?.stages?.length ? row.data : row?.data?.buildings ? null : buildTemplate()
    if (!doc) throw new Error("Add it in Procurement (this job has separate buildings)")
    if (!findTrades(doc.stages, v.name).length) {
      const stage = doc.stages.find((x: any) => x.name === v.stage) || stageFor(doc.stages, v.name)
      stage.trades.push({ ...newTrade(v.name), id: v.trade_id, crm: { at: now, from: f.source_label, did: "added" } })
      await saveProcurement(f.project_id, doc, row?.updated_at || null)
    }
  } else if (f.kind === "procurement") {
    const { data: row } = await sb.from("project_procurement").select("data, updated_at").eq("project_id", f.project_id).maybeSingle()
    const doc = row?.data?.stages?.length ? row.data : row?.data?.buildings ? null : buildTemplate()
    const t = doc?.stages.flatMap((s: any) => s.trades || []).find((x: any) => x.id === v.trade_id)
    if (!t) throw new Error("That trade is no longer in Procurement")
    const patch = { ...v.patch }
    if (patch.status && STAGES.indexOf(patch.status) <= STAGES.indexOf(t.status || "Not started")) delete patch.status
    if (patch.procured_from && t.procured_from) delete patch.procured_from
    Object.assign(t, patch, { crm: { at: now, from: f.source_label, did: f.display } })
    await saveProcurement(f.project_id, doc, row?.updated_at || null)
    // The ordered company joins the job's subcontractors when it's in the directory
    if (v.company) {
      const d = await directory()
      const s = matchSub(d, { company: v.company })
      if (s && !job.subsOnJob.find((x: any) => x.subcontractor_id === s.id)) {
        await sb.from("project_subcontractors").insert({ project_id: f.project_id, subcontractor_id: s.id, category: "contractual_work", trade_on_project: t.name, status: "active", assigned_by: actor })
      }
    }
  } else {
    throw new Error("This one can't be accepted from here")
  }
  await sb.from("job_fills").update({ status: "applied", decided_by: actor, decided_at: now }).eq("id", f.id)
  await alertPending(f.project_id)
  return { ok: true }
}

async function undo(fillId: string, actor: string) {
  const { data: f } = await sb.from("job_fills").select("*").eq("id", fillId).maybeSingle()
  if (!f || f.status !== "applied") throw new Error("Nothing to undo")
  const v = f.value || {}
  if (f.kind === "contract") {
    const t = TERMS[f.field]
    const cur = t.on === "projects"
      ? ((await sb.from("projects").select(t.col).eq("id", f.project_id).maybeSingle()).data as any)?.[t.col]
      : ((await sb.from("project_contract").select(t.col).eq("project_id", f.project_id).maybeSingle()).data as any)?.[t.col]
    if (!sameTerm(t, cur, v.v)) throw new Error("It has been changed since — edit it directly")
    await setTerm(f.project_id, f.field, { v: f.previous ?? null, per: v.per }, actor)
  } else if (f.field.startsWith("design:") || f.field.startsWith("sub:")) {
    // Taken off the job (kept on record, like removing by hand)
    await sb.from("project_subcontractors").update({ status: "removed" }).eq("project_id", f.project_id).eq("subcontractor_id", v.subcontractor_id)
  } else if (f.field === "employer_agent") {
    await sb.from("project_employer_agents").delete().eq("project_id", f.project_id).eq("ea_id", v.ea_id)
  } else if (f.field.startsWith("trade_new:")) {
    // Take the added row out again — only while nobody has used it
    const { data: row } = await sb.from("project_procurement").select("data, updated_at").eq("project_id", f.project_id).maybeSingle()
    const stage = row?.data?.stages?.find((s: any) => (s.trades || []).some((t: any) => t.id === v.trade_id))
    const t = stage?.trades.find((x: any) => x.id === v.trade_id)
    if (t && (t.status !== "Not started" || t.procured_from || t.materials || t.labour || t.notes)) throw new Error("That row has been used since — remove it in Procurement if you want")
    if (stage) { stage.trades = stage.trades.filter((x: any) => x.id !== v.trade_id); await saveProcurement(f.project_id, row!.data, row!.updated_at) }
  } else if (f.kind === "procurement") {
    const { data: row } = await sb.from("project_procurement").select("data, updated_at").eq("project_id", f.project_id).maybeSingle()
    const t = row?.data?.stages?.flatMap((s: any) => s.trades || []).find((x: any) => x.id === v.trade_id)
    if (!t) throw new Error("That trade is no longer in Procurement")
    for (const k of Object.keys(v.patch || {})) if (t[k] === v.patch[k]) t[k] = f.previous?.[k] ?? (k === "status" ? "Not started" : k === "procured_from" ? "" : false)
    delete t.crm
    await saveProcurement(f.project_id, row!.data, row!.updated_at)
  } else {
    throw new Error("Change this one directly")
  }
  await sb.from("job_fills").update({ status: "undone", decided_by: actor, decided_at: new Date().toISOString() }).eq("id", f.id)
  return { ok: true }
}

// ─── Reading what's already filed (letters of intent, contracts) ────────────
const READER = `You read a construction contract document for City Construction Group (CCG), the main contractor.
From the document, list the organisations acting on the job and the agreed terms of the MAIN contract between the client/employer and CCG.
Never list CCG / City Construction Group as a party. Facts only, as written — null for anything not stated. Reply with JSON only:
{"parties": [{"role": "client"|"employer_agent"|"quantity_surveyor"|"architect"|"structural_engineer"|"civil_engineer"|"mep_engineer"|"principal_designer"|"building_control"|"fire_consultant"|"other_consultant", "company": "...", "contact_name": null, "job_title": null, "email": null, "phone": null}],
 "contract": {"applies": true when the document sets or confirms terms of the main contract with CCG (letter of intent, contract, appointment, contract particulars), else false,
  "form": "e.g. JCT Design and Build Contract 2016", "contract_date": "YYYY-MM-DD", "reference": null, "contract_sum": number excluding VAT, "retention_pct": number,
  "retention_release": "e.g. half at practical completion, half at end of defects", "lads_amount": number, "lads_per": "week"|"day",
  "start_date": "YYYY-MM-DD", "completion_date": "YYYY-MM-DD", "payment_terms": "short, e.g. monthly interim valuations, final date for payment 28 days after due date",
  "defects_period_months": number, "insurance": "short summary of the insurance CCG must hold"}}`

async function trimForTerms(bytes: Uint8Array) {
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const n = src.getPageCount()
    if (n <= 40 && bytes.length < 20_000_000) return bytes
    const keep = [...new Set([...Array(Math.min(n, 35)).keys(), n - 3, n - 2, n - 1].filter(i => i >= 0 && i < n))]
    const out = await PDFDocument.create()
    ;(await out.copyPages(src, keep)).forEach((p: any) => out.addPage(p))
    const b = await out.save()
    return b.length < 25_000_000 ? b : null
  } catch { return bytes.length < 20_000_000 ? bytes : null }
}

async function backfill(projectId: string | null, limit: number) {
  let q = sb.from("project_doc_files").select("id, project_id, file_name, storage_path, created_at").eq("folder_key", "01-project-order").order("created_at", { ascending: true }).limit(400)
  if (projectId) q = q.eq("project_id", projectId)
  const { data: files } = await q
  const { data: active } = await sb.from("projects").select("id").in("status", ["active", "tender", "on_hold"])
  const live = new Set((active || []).map((p: any) => p.id))
  const { data: cs } = await sb.from("project_contract").select("project_id, read_files")
  const read = new Map((cs || []).map((c: any) => [c.project_id, new Set(c.read_files || [])]))
  const todo = (files || []).filter((f: any) => /\.pdf$/i.test(f.file_name) && (projectId || live.has(f.project_id)) && !read.get(f.project_id)?.has(f.id)).slice(0, limit)
  const results: any[] = []
  const started = Date.now()
  for (const f of todo) {
    if (Date.now() - started > 100_000) break
    let res: any = { file: f.file_name }
    try {
      const { data: blob, error } = await sb.storage.from("project-docs").download(f.storage_path)
      if (error || !blob) throw new Error(error?.message || "download failed")
      const pdf = await trimForTerms(new Uint8Array(await blob.arrayBuffer()))
      if (!pdf) throw new Error("too large to read")
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1800, system: READER, messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(pdf) } },
          { type: "text", text: `File: ${f.file_name}\nJSON only.` }] }] }),
      })
      if (!r.ok) throw new Error(`Claude ${r.status}`)
      const out = await r.json()
      const m = (out.content || []).map((c: any) => c.text || "").join("").match(/\{[\s\S]*\}/)
      const facts = m ? JSON.parse(m[0]) : {}
      res = { ...res, ...(await apply(f.project_id, facts, { label: f.file_name, date: f.created_at, doc_type: "client_order" })) }
    } catch (e) { res.error = String((e as Error).message || e) }
    // Read once, whatever happened (a person can still add terms by hand)
    const set = read.get(f.project_id) || new Set()
    set.add(f.id); read.set(f.project_id, set)
    await sb.from("project_contract").upsert({ project_id: f.project_id, read_files: [...set], updated_at: new Date().toISOString() }, { onConflict: "project_id" })
    results.push(res)
  }
  return { ok: true, read: results.length, left: Math.max(0, (files || []).filter((f: any) => /\.pdf$/i.test(f.file_name) && (projectId || live.has(f.project_id)) && !read.get(f.project_id)?.has(f.id)).length), results }
}

// ─── Tailor the tracker to the job (Procurement › "Tailor to this job") ─────
// Reads the job's description, its CSA (or latest PA), the subcontractors and
// quote requests on it, then adds the packages this job has and marks template
// rows it clearly doesn't need as "Not required" (rows with any progress are
// never touched; "Not required" can be changed back like any status).
async function tailor(projectId: string, actor: string | null) {
  const [{ data: p }, { data: row }, { data: files }, { data: subs }, { data: reqs }] = await Promise.all([
    sb.from("projects").select("project_name, description, site_address, city, value, division").eq("id", projectId).maybeSingle(),
    sb.from("project_procurement").select("data, updated_at").eq("project_id", projectId).maybeSingle(),
    sb.from("project_doc_files").select("file_name, storage_path, folder_key, subfolder_key, created_at").eq("project_id", projectId).in("folder_key", ["00-project-information", "00-project-information-custom-csa", "02-payment-application"]).order("created_at", { ascending: false }).limit(200),
    sb.from("project_subcontractors").select("trade_on_project, category, subcontractors(company_name, trade)").eq("project_id", projectId),
    sb.from("tasks").select("title").eq("project_id", projectId).eq("is_quote", true).limit(60),
  ])
  if (!p) throw new Error("Job not found")
  if (row?.data?.buildings) throw new Error("This job has separate buildings — tailor each building by hand")
  const doc = row?.data?.stages?.length ? row.data : buildTemplate()
  const xl = (files || []).filter((f: any) => /\.xlsx$/i.test(f.file_name) && f.subfolder_key !== "superseded")
  const csa = xl.find((f: any) => /\bcsa\b|contract sum/i.test(f.file_name) || f.subfolder_key === "csa" || /csa/.test(f.folder_key)) || xl.find((f: any) => f.folder_key === "02-payment-application")
  let sheet = ""
  if (csa) {
    const { data: blob } = await sb.storage.from("project-docs").download(csa.storage_path)
    if (blob) {
      const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" })
      sheet = wb.SheetNames.slice(0, 2).map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n").split("\n").filter(l => /[a-z]{3}/i.test(l)).join("\n").slice(0, 18000)
    }
  }
  const tracker = doc.stages.map((s: any) => `${s.name}: ${(s.trades || []).map((t: any) => `${t.name} [${t.status}${t.procured_from ? ", " + t.procured_from : ""}]`).join("; ")}`).join("\n")
  const facts = [`JOB: ${p.project_name} — ${[p.site_address, p.city].filter(Boolean).join(", ")}${p.value ? `, contract £${Math.round(p.value).toLocaleString("en-GB")}` : ""}`,
    p.description ? `DESCRIPTION: ${p.description}` : "",
    (subs || []).length ? `FIRMS ON THE JOB: ${(subs || []).map((x: any) => `${x.subcontractors?.company_name} (${x.trade_on_project || x.subcontractors?.trade || x.category})`).join("; ")}` : "",
    (reqs || []).length ? `QUOTE REQUESTS: ${(reqs || []).map((r: any) => r.title).join("; ")}` : "",
    sheet ? `${csa!.file_name} (the job's priced breakdown):\n${sheet}` : "No CSA or PA on file.",
    `PROCUREMENT TRACKER NOW (stage: trade [status, from]):\n${tracker}`].filter(Boolean).join("\n\n")
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000,
      system: `You set up the procurement tracker for one UK construction job of City Construction Group (main contractor). The tracker starts from a generic template; every job needs different packages. From the job's description, its priced breakdown, the firms and quote requests on it:
- add: trade packages this job clearly has that the tracker doesn't list (use the job's own wording, short, e.g. "Utility crossings", "Kitchen supply", "SFS framing"), each placed in the best existing stage (exact stage name) — or "${OTHER_STAGE}".
- not_required: template rows (exact names as listed) this job clearly does NOT need — e.g. demolition on a job finishing existing houses, design team roles the client holds. Only rows shown as [Not started] with no company. When unsure, leave it.
Reply with JSON only: {"add": [{"stage": "...", "trade": "..."}], "not_required": ["..."], "summary": "one line"}`,
      messages: [{ role: "user", content: facts }] }),
  })
  if (!r.ok) throw new Error(`Claude ${r.status}`)
  const out = await r.json()
  const m = (out.content || []).map((c: any) => c.text || "").join("").match(/\{[\s\S]*\}/)
  const plan = m ? JSON.parse(m[0]) : { add: [], not_required: [] }
  const src: Src = { label: `Tailored to the job${csa ? " from " + csa.file_name : ""}`, date: new Date().toISOString() }
  let added = 0, dropped = 0
  for (const a of (Array.isArray(plan.add) ? plan.add : []).slice(0, 25)) {
    const name = str(a?.trade, 80)
    if (!name || findTrades(doc.stages, name).some((t: any) => normCo(t.name) === normCo(name))) continue
    const stage = doc.stages.find((x: any) => x.name === a.stage) || stageFor(doc.stages, name)
    const t = { ...newTrade(name), crm: { at: src.date, from: src.label, did: "added" } }
    stage.trades.push(t); added++
    await record(projectId, { kind: "procurement", field: `trade_new:${normCo(name)}`, label: "Procurement — new package", value: { trade_id: t.id, name, stage: stage.name }, display: `${name} (added to ${stage.name})`, status: "applied" }, src)
  }
  const names = new Set((Array.isArray(plan.not_required) ? plan.not_required : []).map((x: any) => String(x)))
  for (const s of doc.stages) for (const t of s.trades || []) {
    if (!names.has(t.name) || t.status !== "Not started" || t.procured_from || t.materials || t.labour) continue
    t.status = "Not required"; t.crm = { at: src.date, from: src.label, did: "Not required" }; dropped++
    await record(projectId, { kind: "procurement", field: `trade:${t.id}:Not required`, label: `Procurement — ${t.name}`, value: { trade_id: t.id, patch: { status: "Not required" } }, display: "Not required", previous: { status: "Not started" }, status: "applied" }, src)
  }
  await saveProcurement(projectId, doc, row?.updated_at || null)
  return { ok: true, added, not_required: dropped, summary: str(plan.summary, 200) }
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  let actor: string | null = null
  const given = req.headers.get("x-intake-key") || ""
  if (given) {
    const { data: st } = await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()
    if (!st?.cron_token || given !== st.cron_token) return json({ error: "Bad key" }, 401)
    if (!["apply", "backfill"].includes(body.action)) return json({ error: "Not allowed" }, 403)
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: u } = token ? await sb.auth.getUser(token) : { data: { user: null } }
    if (!u?.user) return json({ error: "Not signed in" }, 401)
    const { data: prof } = await sb.from("profiles").select("id, role").eq("id", u.user.id).maybeSingle()
    if (!prof || !STAFF.includes(prof.role)) return json({ error: "Not allowed" }, 403)
    if (body.action === "apply") return json({ error: "Not allowed" }, 403)
    actor = prof.id
  }
  try {
    if (body.action === "apply") {
      if (!isUuid(body.project_id)) return json({ error: "Bad project" }, 400)
      return json({ ok: true, ...(await apply(body.project_id, body.facts || {}, body.source || {}, !!body.trial)) })
    }
    if (body.action === "decide") {
      if (!isUuid(body.fill_id)) return json({ error: "Bad id" }, 400)
      return json(await decide(body.fill_id, body.accept === true, actor!, body.value ?? null))
    }
    if (body.action === "undo") {
      if (!isUuid(body.fill_id)) return json({ error: "Bad id" }, 400)
      return json(await undo(body.fill_id, actor!))
    }
    if (body.action === "tailor") {
      if (!isUuid(body.project_id)) return json({ error: "Bad project" }, 400)
      return json(await tailor(body.project_id, actor))
    }
    if (body.action === "backfill") {
      if (body.project_id && !isUuid(body.project_id)) return json({ error: "Bad project" }, 400)
      return json(await backfill(body.project_id || null, Math.min(Math.max(Number(body.limit) || 3, 1), 6)))
    }
    return json({ error: "Unknown action" }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
