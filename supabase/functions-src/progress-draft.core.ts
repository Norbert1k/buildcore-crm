// ─────────────────────────────────────────────────────────────────────────────
// progress-draft — the CRM drafts each job's progress report; a person approves it
//
// Written from what the CRM already holds for the reporting period:
//   • the latest PA          → progress % per section, VOs, valuation (same reader as the editor)
//   • the job diary          → RFIs (open / answered), instructions, VOs, issues, delays,
//                              drawings issued, deliveries — from the emails and documents
//                              the Inbox read (project_log)
//   • site photos            → the newest from the job's photo folder (Telegram), Claude picks
//                              and captions the ones that show progress
//   • the programme          → task progress, if the job has one
//   • the previous report    → continuity (people, dates, open risks)
// The draft is saved as a normal report with ai_draft = true. Nothing reaches the
// client until someone opens it, checks it and presses Publish to client.
//
// Actions:
//   { action: 'draft', project_id, pa_ref? }   new draft report (one per PA)       → { report_id }
//   { action: 'fill',  report_id }             write the text sections + photos into
//                                              an existing report (editor button) → { ok }
// Callers: the watchdog (x-intake-key) or a signed-in member of staff.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import * as XLSX from "https://esm.sh/xlsx@0.18.5"
;(globalThis as any).window = (globalThis as any).window || {}
;(globalThis as any).window.XLSX = XLSX

declare function extractFromPa(buf: ArrayBuffer): Promise<any>
declare function fetchLatestPaForSubfolder(sb: any, projectId: string, sub: string | null): Promise<ArrayBuffer | null>

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
const MODEL = "claude-sonnet-4-5"
const STAFF = ["admin", "project_manager", "operations_manager", "project_director", "document_controller"]
const PHOTO_BUCKET = "company-docs"          // where the job's site photos live (project_photos)
const REPORT_PHOTO_BUCKET = "progress-photos"
const MAX_PHOTOS_SENT = 10
const MAX_PHOTOS_USED = 8

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-intake-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } })
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })

const DAY = 86400000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"
const paNo = (n: string) => { const m = String(n).match(/\bPA\s*-?\s*0*(\d{1,3})\b/i); return m ? Number(m[1]) : null }
const PA = (n: number) => "PA" + String(n).padStart(2, "0")
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }

async function nextReportNumber(projectId: string) {
  const now = new Date()
  const base = `PPR-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const { data } = await sb.from("progress_reports").select("report_number").eq("project_id", projectId).ilike("report_number", `${base}%`)
  if (!data?.length) return base
  let n = 1
  while (data.some((r: any) => r.report_number === `${base}-${String(n).padStart(2, "0")}`)) n++
  return `${base}-${String(n).padStart(2, "0")}`
}

// ─── What the report is written from ─────────────────────────────────────────
async function gather(projectId: string, prev: any) {
  const { data: project } = await sb.from("projects").select("*").eq("id", projectId).maybeSingle()
  if (!project) throw new Error("Job not found")
  const since = prev?.report_date || prev?.period_to || project.start_date || ymd(new Date(Date.now() - 35 * DAY))
  const sinceIso = new Date(since + "T00:00:00Z").toISOString()

  const [paBuf, log, openRfis, files, photos, prog] = await Promise.all([
    fetchLatestPaForSubfolder(sb, projectId, null),
    sb.from("project_log").select("kind, ref, title, detail, status, happened_at, source_label").eq("project_id", projectId)
      .gte("happened_at", sinceIso).order("happened_at", { ascending: true }).limit(120).then((r: any) => r.data || []),
    sb.from("project_log").select("kind, ref, title, detail, status, happened_at").eq("project_id", projectId)
      .eq("kind", "rfi").eq("status", "open").lt("happened_at", sinceIso).limit(40).then((r: any) => r.data || []),
    sb.from("project_doc_files").select("folder_key, file_name, created_at").eq("project_id", projectId)
      .gte("created_at", sinceIso).neq("subfolder_key", "superseded").order("created_at", { ascending: false }).limit(60).then((r: any) => r.data || []),
    sb.from("project_photos").select("id, storage_path, caption, taken_at, folder_name, created_at").eq("project_id", projectId)
      .order("taken_at", { ascending: false, nullsFirst: false }).limit(60).then((r: any) => r.data || []),
    sb.from("programmes").select("id, current_version_id").eq("project_id", projectId).is("building_ordinal", null).limit(1).maybeSingle()
      .then((r: any) => r.data || null, () => null),
  ])
  let pa: any = null, paName: string | null = null
  if (paBuf) pa = await extractFromPa(paBuf).catch(() => null)
  {
    const { data: paFiles } = await sb.from("project_doc_files").select("file_name, created_at").eq("project_id", projectId)
      .eq("folder_key", "02-payment-application").is("subfolder_key", null)
    const named = (paFiles || []).filter((f: any) => /\.xlsx$/i.test(f.file_name) && paNo(f.file_name) != null)
      .sort((a: any, b: any) => paNo(b.file_name)! - paNo(a.file_name)!)
    paName = named[0]?.file_name || null
  }
  let tasks: any[] = []
  if (prog?.current_version_id) {
    const { data: v } = await sb.from("programme_versions").select("tasks").eq("id", prog.current_version_id).maybeSingle()
    tasks = Array.isArray(v?.tasks) ? v.tasks : []
  }
  // Photos from the period (newest first), spread across it
  const inPeriod = (photos as any[]).filter(p => new Date(p.taken_at || p.created_at) >= new Date(sinceIso))
  const pool = inPeriod.length >= 4 ? inPeriod : (photos as any[]).slice(0, 20)
  const step = Math.max(1, Math.floor(pool.length / MAX_PHOTOS_SENT))
  const picked = pool.filter((_, i) => i % step === 0).slice(0, MAX_PHOTOS_SENT)
  return { project, since, pa, paName, log, openRfis, files, photos: picked, tasks }
}

async function photoBytes(p: any): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).download(p.storage_path)
  if (error || !data) return null
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (bytes.length > 4_500_000) return null
  const ext = String(p.storage_path).split(".").pop()!.toLowerCase()
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
  return { bytes, mime }
}

// ─── Claude writes the sections ──────────────────────────────────────────────
async function write(ctx: any, prev: any) {
  const p = ctx.project
  const pa = ctx.pa
  // % of the original contract works claimed (the PA's sections, before VOs)
  const claimedPct = pa?.totals?.total > 0 ? Math.round((pa.totals.cumulative / pa.totals.total) * 100) : null
  const facts = [
    `JOB: ${p.project_name} (${p.project_ref || "no ref"}) — ${[p.site_address, p.city, p.postcode].filter(Boolean).join(", ")}`,
    `Client: ${p.client_name || "—"} · Contract ${p.value ? "£" + Number(p.value).toLocaleString("en-GB") : "—"} · Start ${fmt(p.start_date)} · Completion ${fmt(p.end_date)} · Today ${fmt(ymd(new Date()))}`,
    `REPORTING PERIOD: ${fmt(ctx.since)} → ${fmt(ymd(new Date()))}`,
    pa ? `LATEST PA (${ctx.paName || "latest"}): claimed to date £${Math.round(pa.totals.cumulative).toLocaleString("en-GB")} of £${Math.round(pa.totals.total).toLocaleString("en-GB")} original${claimedPct != null ? ` (${claimedPct}% of the original contract works)` : ""}.
Progress by section (average % complete): ${(pa.groups || []).map((g: any) => `${g.name} ${g.avg_pct}%`).join("; ")}
Variations on the PA: ${(pa.variations || []).map((v: any) => `${v.instruction_no} ${v.instruction_details}${v.cost_impact ? " £" + v.cost_impact : ""}`).join("; ") || "none"}` : "LATEST PA: none found",
    ctx.tasks.length ? `PROGRAMME TASKS: ${ctx.tasks.slice(0, 40).map((t: any) => `${t.name} (${fmt(t.start_date)}–${fmt(t.end_date)}, ${Math.round(t.progress || 0)}%)`).join("; ")}` : "PROGRAMME: none in the CRM",
    `JOB DIARY THIS PERIOD (from emails and documents):\n${ctx.log.map((l: any) => `- ${fmt(l.happened_at)} [${l.kind}${l.status ? ", " + l.status : ""}] ${l.ref ? l.ref + ": " : ""}${l.title}${l.detail ? " — " + l.detail : ""}${l.source_label ? ` (${l.source_label})` : ""}`).join("\n") || "- nothing recorded"}`,
    ctx.openRfis.length ? `RFIs STILL OPEN FROM BEFORE: ${ctx.openRfis.map((l: any) => `${l.ref || "RFI"} ${l.title} (raised ${fmt(l.happened_at)})`).join("; ")}` : "",
    ctx.files.length ? `DOCUMENTS FILED THIS PERIOD: ${ctx.files.slice(0, 40).map((f: any) => f.file_name).join("; ")}` : "",
    prev ? `PREVIOUS REPORT (${prev.report_number}, ${fmt(prev.report_date)}): phase "${prev.current_phase || ""}"; progress "${prev.overall_progress || ""}"; delays "${prev.delays_text || ""}" ${prev.delays_reason || ""}; open RFIs ${JSON.stringify((prev.rfis || []).filter((r: any) => r.status !== "closed"))}; risks ${JSON.stringify(prev.risks || [])}; statement "${String(prev.pm_statement || "").slice(0, 1500)}"` : "PREVIOUS REPORT: none (first report)",
  ].filter(Boolean).join("\n\n")

  const imgs: any[] = []
  const used: any[] = []
  for (const ph of ctx.photos) {
    const b = await photoBytes(ph).catch(() => null)
    if (!b) continue
    used.push({ ...ph, ...b })
    imgs.push({ type: "text", text: `Photo id ${ph.id} — taken ${fmt(ph.taken_at || ph.created_at)}${ph.caption ? `, note: ${ph.caption}` : ""}${ph.folder_name ? `, folder: ${ph.folder_name}` : ""}` })
    imgs.push({ type: "image", source: { type: "base64", media_type: b.mime, data: b64(b.bytes) } })
  }

  const system = `You draft the monthly progress report that City Construction Group (CCG), a UK main contractor, issues to its client for one job. A CCG manager will check and approve it before the client sees it.
Write in plain, professional UK English from CCG's side ("we", "CCG"). Use ONLY the facts given (PA, diary, programme, documents, photos, previous report). Never invent dates, numbers, names, RFIs or problems. Where something a report would normally say isn't in the facts, leave it out — or for something important write "[check: …]" so the manager fills it in.
Progress must agree with the latest PA's claimed percentages. Mention VOs by number. Keep each section tight: a client reads it in five minutes.

Reply with JSON only:
{"current_phase": "a few words, e.g. 'Internal finishes and external works'",
 "overall_progress": "1–2 sentences: overall % complete in line with the PA and what that reflects",
 "delays_text": "e.g. 'None' or '2 weeks'",
 "delays_reason": "the cause if there is a delay in the facts, else ''",
 "pm_statement": "the project manager's statement, 3 short paragraphs headed 'Works this period:', 'Planned next period:' and 'Key matters:' (RFIs, instructions, VOs, issues needing the client)",
 "hs_text": "health & safety this period — only incidents/matters in the facts; otherwise 'No health and safety incidents were reported during this period.'",
 "rfis": [{"rfi_no": "", "description": "", "status": "open"|"closed"}],
 "risks": [{"description": "", "consequence": "", "risk_rag": "red"|"amber"|"green", "mitigation": ""}],
 "aob": "anything else the client should know, or ''",
 "estimated_completion": "YYYY-MM-DD only if the facts give a revised completion date, else null",
 "photos": [{"id": "photo id", "use": true|false, "caption": "short factual caption: what it shows, where"}]}
RFIs: every open RFI plus those answered this period (status closed). Risks: carry forward the previous report's risks that still apply, update them from the diary, add new ones only from the facts. Photos: use up to ${MAX_PHOTOS_USED} that best show progress, no near-duplicates, nothing personal.`

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: [{ type: "text", text: facts }, ...imgs, { type: "text", text: "Draft the report. JSON only." }] }] }),
  })
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const text = ((await r.json()).content || []).map((c: any) => c.text || "").join("")
  const out = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}")
  return { out, used, claimedPct }
}

const TEXT_FIELDS = ["current_phase", "overall_progress", "delays_text", "delays_reason", "pm_statement", "hs_text", "aob"] as const

async function addPhotos(reportId: string, used: any[], picks: any[]) {
  const { data: have } = await sb.from("progress_report_photos").select("display_order, source_photo_id").eq("report_id", reportId)
  let order = Math.max(0, ...(have || []).map((h: any) => h.display_order || 0)) + 1
  const already = new Set((have || []).map((h: any) => h.source_photo_id).filter(Boolean))
  let n = 0
  for (const pk of (Array.isArray(picks) ? picks : []).filter((x: any) => x && x.use !== false).slice(0, MAX_PHOTOS_USED)) {
    const ph = used.find(u => u.id === pk.id)
    if (!ph || already.has(ph.id)) continue
    const ext = ph.mime === "image/png" ? "png" : ph.mime === "image/webp" ? "webp" : "jpg"
    const path = `${reportId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await sb.storage.from(REPORT_PHOTO_BUCKET).upload(path, ph.bytes, { contentType: ph.mime, upsert: false })
    if (upErr) continue
    await sb.from("progress_report_photos").insert({ report_id: reportId, storage_path: path, file_name: `site-photo-${n + 1}.${ext}`, file_size: ph.bytes.length,
      display_order: order++, caption: pk.caption ? String(pk.caption).slice(0, 160) : null, source_photo_id: ph.id })
    n++
  }
  return n
}

function sources(ctx: any, nPhotos: number) {
  const k = (kind: string) => ctx.log.filter((l: any) => l.kind === kind).length
  return {
    period_from: ctx.since, period_to: ymd(new Date()), pa: ctx.paName,
    diary: ctx.log.length, rfis: k("rfi") + ctx.openRfis.length, instructions: k("instruction"), variations: k("variation"),
    issues: k("issue") + k("delay"), documents: ctx.files.length, photos: nPhotos, programme: ctx.tasks.length > 0,
    written_at: new Date().toISOString(),
  }
}

async function alertDraft(projectId: string, projectName: string, reportId: string, paRef: string | null, src: any) {
  const key = `report_draft:${projectId}:${paRef || reportId}`
  const row = { key, project_id: projectId, kind: "report_draft", severity: "soon",
    title: `Progress report drafted — review & publish — ${projectName}`,
    detail: `Drafted from ${paRef || "the latest PA"}, ${src.diary} diary note${src.diary === 1 ? "" : "s"} and ${src.photos} photo${src.photos === 1 ? "" : "s"}. Check it, then press Publish to client.`,
    action_label: "Open the draft", action_url: `/projects/${projectId}?tab=documents`, status: "open", last_seen: new Date().toISOString() }
  const { data: e } = await sb.from("crm_alerts").select("id").eq("key", key).maybeSingle()
  if (e) await sb.from("crm_alerts").update(row).eq("id", e.id)
  else await sb.from("crm_alerts").insert(row)
}

// ─── New draft after a PA ────────────────────────────────────────────────────
async function draft(projectId: string, paRefIn: string | null, force = false) {
  const { data: prevs } = await sb.from("progress_reports").select("*").eq("project_id", projectId).is("subfolder_key", null)
    .order("created_at", { ascending: false }).limit(5)
  const prev = (prevs || []).find((r: any) => !r.ai_draft) || null
  const ctx = await gather(projectId, prev)
  const paRef = paRefIn || (ctx.paName && paNo(ctx.paName) != null ? PA(paNo(ctx.paName)!) : null)
  if (!force && paRef) {
    const dup = (prevs || []).find((r: any) => r.ai_draft && r.ai_pa_ref === paRef)
    if (dup) return { report_id: dup.id, existing: true }
  }
  const [team, eas] = await Promise.all([
    sb.from("project_team_members").select("name, role, position_order, created_at").eq("project_id", projectId).in("role", ["Project Manager", "Site Manager"]).order("position_order").then((r: any) => r.data || []),
    sb.from("project_employer_agents").select("employer_agents(company_name)").eq("project_id", projectId).then((r: any) => r.data || []),
  ])
  const names = (role: string) => (team as any[]).filter(m => m.role === role).map(m => m.name).filter(Boolean).join(", ")
  const eaNames = (eas as any[]).map(r => r.employer_agents?.company_name).filter(Boolean).join(", ")
  const p = ctx.project
  const retention = p.retention_pct != null ? Number(p.retention_pct) : 5
  const pa = ctx.pa

  const { out, used } = await write(ctx, prev)
  const report: any = {
    project_id: projectId, subfolder_key: null, report_number: await nextReportNumber(projectId), report_date: ymd(new Date()),
    period_from: ctx.since, period_to: ymd(new Date()),
    job_no: p.project_ref || p.project_name, client_pm: p.project_name,
    employer: prev?.employer || p.client_name || "", contract_administrator: prev?.contract_administrator || eaNames || "",
    surveyor: prev?.surveyor || "", main_contractor: prev?.main_contractor || "City Construction Group",
    mc_pm: prev?.mc_pm || names("Project Manager") || "", site_manager: prev?.site_manager || names("Site Manager") || "",
    start_on_site: prev?.start_on_site || p.start_date || null, contract_completion: prev?.contract_completion || p.end_date || null,
    target_completion: prev?.target_completion || p.end_date || null,
    estimated_completion: (/^\d{4}-\d{2}-\d{2}$/.test(String(out.estimated_completion || "")) ? out.estimated_completion : null) || prev?.estimated_completion || p.end_date || null,
    programme_groups: pa ? pa.groups.map((g: any) => ({ name: g.name, items: [{ label: `Avg progress (${g.item_count} item${g.item_count === 1 ? "" : "s"})`, percent: g.avg_pct }] })) : (prev?.programme_groups || []),
    variations: pa ? pa.variations.map((v: any) => ({ instruction_no: v.instruction_no, si_ref: "", issue_date: "", instruction_details: v.instruction_details, scope_impact: "", cost_impact: v.cost_impact, time_impact: "", agreed_cost: "" })) : (prev?.variations || []),
    valuations: (() => {
      const hist = prev?.valuations || []
      if (!pa?.totals?.cumulative) return hist
      const t = pa.totals
      return [...hist, t.net_cumulative != null
        ? { no: String(hist.length + 1), date_submitted: ymd(new Date()), gross_claimed: String(Math.round(t.cumulative)), retention_pct: String(t.retention_pct ?? retention), amount_claimed: String(Math.round(t.net_cumulative)), amount_agreed: "" }
        : { no: String(hist.length + 1), date_submitted: ymd(new Date()), gross_claimed: "", retention_pct: String(retention), amount_claimed: String(Math.round(t.cumulative)), amount_agreed: "" }]
    })(),
    rfis: Array.isArray(out.rfis) ? out.rfis.slice(0, 40).map((x: any) => ({ rfi_no: String(x.rfi_no || ""), description: String(x.description || ""), status: x.status === "closed" ? "closed" : "open" })) : (prev?.rfis || []),
    risks: Array.isArray(out.risks) ? out.risks.slice(0, 20).map((x: any) => ({ description: String(x.description || ""), consequence: String(x.consequence || ""), risk_rag: ["red", "amber", "green"].includes(x.risk_rag) ? x.risk_rag : "amber", mitigation: String(x.mitigation || "") })) : (prev?.risks || []),
    ai_draft: true, ai_pa_ref: paRef,
  }
  for (const f of TEXT_FIELDS) report[f] = typeof out[f] === "string" ? out[f] : (prev?.[f] || "")
  if (!report.hs_text) report.hs_text = "No health and safety incidents were reported during this period."
  const { data: row, error } = await sb.from("progress_reports").insert(report).select("id").single()
  if (error) throw new Error("Couldn't save the draft: " + error.message)
  const nPhotos = await addPhotos(row.id, used, out.photos)
  const src = sources(ctx, nPhotos)
  await sb.from("progress_reports").update({ ai_sources: src }).eq("id", row.id)
  await alertDraft(projectId, p.project_name, row.id, paRef, src)
  return { report_id: row.id, sources: src }
}

// ─── Fill an existing report's text + photos (editor button) ─────────────────
async function fill(reportId: string) {
  const { data: rep } = await sb.from("progress_reports").select("*").eq("id", reportId).maybeSingle()
  if (!rep) throw new Error("Report not found")
  const { data: prevs } = await sb.from("progress_reports").select("*").eq("project_id", rep.project_id)
    .neq("id", reportId).eq("ai_draft", false).order("created_at", { ascending: false }).limit(1)
  const prev = prevs?.[0] || null
  const ctx = await gather(rep.project_id, prev)
  const { out, used } = await write(ctx, prev)
  const patch: any = { ai_draft: true }
  for (const f of TEXT_FIELDS) if (typeof out[f] === "string" && out[f].trim()) patch[f] = out[f]
  if (Array.isArray(out.rfis)) patch.rfis = out.rfis.slice(0, 40).map((x: any) => ({ rfi_no: String(x.rfi_no || ""), description: String(x.description || ""), status: x.status === "closed" ? "closed" : "open" }))
  if (Array.isArray(out.risks)) patch.risks = out.risks.slice(0, 20).map((x: any) => ({ description: String(x.description || ""), consequence: String(x.consequence || ""), risk_rag: ["red", "amber", "green"].includes(x.risk_rag) ? x.risk_rag : "amber", mitigation: String(x.mitigation || "") }))
  const nPhotos = await addPhotos(reportId, used, out.photos)
  patch.ai_sources = sources(ctx, nPhotos)
  patch.period_from = rep.period_from || ctx.since
  patch.period_to = rep.period_to || ymd(new Date())
  const { error } = await sb.from("progress_reports").update(patch).eq("id", reportId)
  if (error) throw new Error(error.message)
  return { ok: true, sources: patch.ai_sources }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const given = req.headers.get("x-intake-key") || ""
  if (given) {
    const { data: st } = await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()
    if (!st?.cron_token || given !== st.cron_token) return json({ error: "Bad key" }, 401)
    if (body.action !== "draft") return json({ error: "Schedule can only draft" }, 403)
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: u } = token ? await sb.auth.getUser(token) : { data: { user: null } }
    if (!u?.user) return json({ error: "Not signed in" }, 401)
    const { data: prof } = await sb.from("profiles").select("role").eq("id", u.user.id).maybeSingle()
    if (!prof || !STAFF.includes(prof.role)) return json({ error: "Not allowed" }, 403)
  }
  try {
    if (body.action === "draft") {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.project_id || ""))) return json({ error: "Bad project" }, 400)
      return json(await draft(body.project_id, body.pa_ref ? String(body.pa_ref).slice(0, 10) : null, !!body.force))
    }
    if (body.action === "fill") {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.report_id || ""))) return json({ error: "Bad report" }, 400)
      return json(await fill(body.report_id))
    }
    return json({ error: "Unknown action" }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 400) }, 500)
  }
})
