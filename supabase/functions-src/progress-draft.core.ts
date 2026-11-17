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
declare function paSubfolderFor(key: string | null): string | null
declare function autoMatch(label: string, files: any[], job: any): any
declare function valuationsWithPa(history: any[], o: { totals: any; paName: string | null; paDate: string | null; retention: any }): any[]
declare function variationsFromPa(variations: any[]): any[]

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
// Reports go out on the last day of each month (PAs are prepared ahead and can still change)
const monthEndOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }

async function nextReportNumber(projectId: string, at: Date = new Date()) {
  const now = at
  const base = `PPR-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const { data } = await sb.from("progress_reports").select("report_number").eq("project_id", projectId).ilike("report_number", `${base}%`)
  if (!data?.length) return base
  let n = 1
  while (data.some((r: any) => r.report_number === `${base}-${String(n).padStart(2, "0")}`)) n++
  return `${base}-${String(n).padStart(2, "0")}`
}

// ─── Handover / O&M position (same checklist + matching rules as the Handover tab) ─
const OM_SECTIONS: [string, string][] = [
  ["cs1", "Section 1 | H&S File"], ["cs2", "Section 2 | Project Directory"], ["cs3", "Section 3 | Record Drawings"],
  ["cs4", "Section 4 | Construction Materials"], ["cs5", "Section 5 | Health and Safety"], ["cs6", "Section 6 | Structural Design"],
  ["cs7", "Section 7 | Services"], ["cs8", "Section 8 | O&M Manuals"], ["cs9", "Section 9 | Commissioning Documents"],
  ["cs10", "Section 10 | Operating Documents"], ["cs11", "Section 11 | Certificates"],
]
const OM_DEFAULT_CHECKS: Record<string, string[]> = {
  cs1: ["Construction phase plan (as final)", "Residual risks register", "F10 notification copy", "Asbestos survey / register", "Pre-construction information (archived)"],
  cs2: ["Contractor directory", "Consultant directory", "Key contacts & emergency numbers"],
  cs3: ["As-built architectural drawings", "Structural as-builts", "M&E as-builts", "Fire strategy drawings"],
  cs4: ["External envelope materials & specs", "Internal materials & finishes schedule", "COSHH data sheets"],
  cs5: ["Fire risk assessment (handover)", "Fire stopping records", "Working-at-height / access strategy for maintenance"],
  cs6: ["Structural calculations (as-built)", "Structural certificates & warranties"],
  cs7: ["Mechanical installation records", "Electrical installation certificates (EIC)", "Public health / drainage records"],
  cs8: ["O&M manuals — mechanical", "O&M manuals — electrical", "O&M manuals — lifts / specialist plant"],
  cs9: ["HVAC commissioning records", "Water treatment & flushing certificates", "Fire alarm commissioning"],
  cs10: ["User guides", "Maintenance schedules", "Cleaning regimes"],
  cs11: ["Building Control completion certificate", "Gas certificates", "Electrical certificates", "Warranties & guarantees schedule"],
}
async function allRows(build: () => any, size = 1000) {
  const out: any[] = []
  for (let from = 0; from < 20000; from += size) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error || !data?.length) break
    out.push(...data)
    if (data.length < size) break
  }
  return out
}
async function omStatus(projectId: string) {
  const [secs, checks, files, subs, issues, mats] = await Promise.all([
    sb.from("fitout_handover_sections").select("section_key, enabled, sm_checked_at, lead_signed_at, released").eq("project_id", projectId).then((r: any) => r.data || [], () => []),
    sb.from("fitout_handover_checks").select("section_key, label, done").eq("project_id", projectId).order("sort").then((r: any) => r.data || [], () => []),
    allRows(() => sb.from("hs_files").select("id, file_name, folder_key, ai, origin").eq("project_id", projectId)),
    sb.from("project_subcontractors").select("id, category").eq("project_id", projectId).then((r: any) => r.data || [], () => []),
    sb.from("om_issues").select("issue_no, kind").eq("project_id", projectId).order("created_at", { ascending: false }).then((r: any) => r.data || [], () => []),
    sb.from("job_materials").select("product, manufacturer, datasheet_status, purchased").eq("project_id", projectId).then((r: any) => r.data || [], () => []),
  ])
  const job = { subs: subs.filter((x: any) => x.category !== "design_team").length, designTeam: subs.filter((x: any) => x.category === "design_team").length,
    omIssued: issues.find((i: any) => i.kind === "om")?.issue_no || null }
  const sections = OM_SECTIONS.map(([key, label]) => {
    const sec = secs.find((x: any) => x.section_key === key)
    if (sec && sec.enabled === false) return null
    const items = checks.filter((c: any) => c.section_key === key)
    const list = items.length ? items : (OM_DEFAULT_CHECKS[key] || []).map(l => ({ label: l, done: false }))
    const rows: { label: string, ok: boolean }[] = list.map((c: any) => ({ label: c.label, ok: !!c.done || !!autoMatch(c.label, files, job) }))
    return { key, label, total: rows.length, ok: rows.filter(r => r.ok).length, missing: rows.filter(r => !r.ok).map(r => r.label),
      state: sec?.released ? "released to client" : sec?.lead_signed_at ? "signed off" : sec?.sm_checked_at ? "site manager checked" : "not signed off" }
  }).filter(Boolean) as any[]
  const dsMissing = mats.filter((m: any) => m.purchased && ["needed", "found", "not_found"].includes(m.datasheet_status))
    .map((m: any) => [m.manufacturer, m.product].filter(Boolean).join(" "))
  return { sections, items_total: sections.reduce((a, x) => a + x.total, 0), items_ok: sections.reduce((a, x) => a + x.ok, 0),
    missing: sections.flatMap(x => x.missing), datasheets_missing: dsMissing, files: files.length, om_issued: job.omIssued }
}

// ─── What the report is written from ─────────────────────────────────────────
async function gather(projectId: string, prev: any, sub: string | null = null) {
  const { data: project } = await sb.from("projects").select("*").eq("id", projectId).maybeSingle()
  if (!project) throw new Error("Job not found")
  const since = prev?.report_date || prev?.period_to || project.start_date || ymd(new Date(Date.now() - 35 * DAY))
  const sinceIso = new Date(since + "T00:00:00Z").toISOString()

  const [paBuf, log, openRfis, files, photos, prog] = await Promise.all([
    fetchLatestPaForSubfolder(sb, projectId, sub),
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
  let pa: any = null, paName: string | null = null, paDate: string | null = null
  if (paBuf) pa = await extractFromPa(paBuf).catch(() => null)
  {
    let q = sb.from("project_doc_files").select("file_name, created_at").eq("project_id", projectId).eq("folder_key", "02-payment-application")
    q = sub ? q.eq("subfolder_key", paSubfolderFor(sub)) : q.is("subfolder_key", null)
    const { data: paFiles } = await q
    const named = (paFiles || []).filter((f: any) => /\.xlsx$/i.test(f.file_name) && paNo(f.file_name) != null)
      .sort((a: any, b: any) => paNo(b.file_name)! - paNo(a.file_name)!)
    paName = named[0]?.file_name || null
    paDate = named[0]?.created_at || null
  }
  let tasks: any[] = []
  if (prog?.current_version_id) {
    const { data: v } = await sb.from("programme_versions").select("tasks").eq("id", prog.current_version_id).maybeSingle()
    tasks = Array.isArray(v?.tasks) ? v.tasks : []
  }
  // Photos from the period (newest first), spread across it
  const inPeriod = (photos as any[]).filter(p => new Date(p.taken_at || p.created_at) >= new Date(sinceIso))
  // Few or no new photos → top up with the newest ones; every caption carries the date taken
  const pool = inPeriod.length >= 4 ? inPeriod : (photos as any[]).slice(0, 20)
  const step = Math.max(1, Math.floor(pool.length / MAX_PHOTOS_SENT))
  const picked = pool.filter((_, i) => i % step === 0).slice(0, MAX_PHOTOS_SENT)
  const latestPhoto = (photos as any[])[0] ? ((photos as any[])[0].taken_at || (photos as any[])[0].created_at) : null

  // Close-out: final account / PC / completion passed / almost all claimed → report the handover & O&M position
  const claimed = pa?.totals?.total > 0 ? pa.totals.cumulative / pa.totals.total : 0
  const why = [/final\s*account/i.test(paName || "") && "the latest PA is the final account", project.pc_date && `practical completion ${fmt(project.pc_date)}`,
    project.end_date && new Date(project.end_date) < new Date() && `completion date ${fmt(project.end_date)} has passed`].filter(Boolean) as string[]
  // Not closed out yet but nearly there → still a progress report, with the handover position added
  const daysLeft = project.end_date ? (new Date(project.end_date).getTime() - Date.now()) / 864e5 : Infinity
  const near = !why.length && (claimed >= 0.95 || daysLeft <= 28)
    ? [claimed >= 0.95 && `${Math.round(claimed * 100)}% of the original works claimed`, daysLeft <= 28 && `completion due ${fmt(project.end_date)}`].filter(Boolean) as string[] : []
  const om = why.length || near.length ? await omStatus(projectId).catch(() => null) : null
  return { project, since, pa, paName, paDate, log, openRfis, files, photos: picked, photosNew: inPeriod.length, latestPhoto, tasks, closeout: why, near, om }
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
Variations on the PA: ${(pa.variations || []).map((v: any) => `${v.instruction_no} ${v.instruction_details}${v.cost_impact ? " £" + v.cost_impact : ""}`).join("; ") || "none"}
VO TOTALS (use these exact figures): ${(() => { const pr = (pa.variations || []).map((v: any) => parseFloat(v.cost_impact)).filter((n: number) => Number.isFinite(n) && n !== 0); return `${pr.length} priced VO${pr.length === 1 ? "" : "s"} of ${(pa.variations || []).length} listed, total £${pr.reduce((a: number, b: number) => a + b, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })()}` : "LATEST PA: none found",
    ctx.tasks.length ? `PROGRAMME TASKS: ${ctx.tasks.slice(0, 40).map((t: any) => `${t.name} (${fmt(t.start_date)}–${fmt(t.end_date)}, ${Math.round(t.progress || 0)}%)`).join("; ")}` : "PROGRAMME: none in the CRM",
    `JOB DIARY THIS PERIOD (from emails and documents):\n${ctx.log.map((l: any) => `- ${fmt(l.happened_at)} [${l.kind}${l.status ? ", " + l.status : ""}] ${l.ref ? l.ref + ": " : ""}${l.title}${l.detail ? " — " + l.detail : ""}${l.source_label ? ` (${l.source_label})` : ""}`).join("\n") || "- nothing recorded"}`,
    ctx.openRfis.length ? `RFIs STILL OPEN FROM BEFORE: ${ctx.openRfis.map((l: any) => `${l.ref || "RFI"} ${l.title} (raised ${fmt(l.happened_at)})`).join("; ")}` : "",
    ctx.files.length ? `DOCUMENTS FILED THIS PERIOD: ${ctx.files.slice(0, 40).map((f: any) => f.file_name).join("; ")}` : "",
    ctx.photosNew ? `SITE PHOTOS: ${ctx.photosNew} taken this period${ctx.photosNew < 4 ? " (older ones also shown — check each photo's date)" : ""}.` : ctx.latestPhoto ? `SITE PHOTOS: NONE uploaded this period — the newest are from ${fmt(ctx.latestPhoto)}. Don't present them as this period's progress; say in the report that no new photos were received.` : "SITE PHOTOS: none on the job.",
    ctx.closeout.length || ctx.near.length ? `${ctx.closeout.length ? `CLOSE-OUT: yes — ${ctx.closeout.join("; ")}.` : `NEARING COMPLETION: ${ctx.near.join("; ")}.`}${ctx.om ? `
HANDOVER / O&M POSITION: ${ctx.om.items_ok} of ${ctx.om.items_total} checklist items in place (${ctx.om.files} handover documents on the job${ctx.om.om_issued ? `, O&M manual issued: ${ctx.om.om_issued}` : ", O&M manual not issued yet"}).
${ctx.om.sections.map((x: any) => `- ${x.label}: ${x.ok}/${x.total}, ${x.state}${x.missing.length ? ` — missing: ${x.missing.join(", ")}` : ""}`).join("\n")}
Datasheets still needed for products bought for this job: ${ctx.om.datasheets_missing.length ? ctx.om.datasheets_missing.slice(0, 30).join("; ") : "none"}` : ""}` : "",
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
Progress must agree with the latest PA's claimed percentages. Mention VOs by number. Never add up or work out figures yourself — quote only the totals and amounts given. Keep each section tight: a client reads it in five minutes.
Plain text only — no markdown, no asterisks or # headings (it is printed as-is into a PDF); separate paragraphs with a blank line.

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
 "photos": [{"id": "photo id", "use": true|false, "caption": "short factual caption: what it shows, where (no date — the CRM adds the date taken)"}]}
CLOSE-OUT reports (when the facts say CLOSE-OUT): the works are complete or at final account, so write a close-out report — completion / final account position, snagging, and in pm_statement a fourth paragraph "Handover and O&M:" stating how many checklist items are in place and listing every missing document by section, plus the datasheets still needed. Add a risk for an incomplete O&M if anything is missing. Don't invent progress that the PA doesn't show.
NEARING COMPLETION (when the facts say so): a normal progress report, plus the same "Handover and O&M:" paragraph so the team can see what is still to collect.
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
      display_order: order++, caption: `${fmt(ph.taken_at || ph.created_at)}${pk.caption ? " — " + String(pk.caption).slice(0, 150) : ""}`, source_photo_id: ph.id })
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
    photos_new: ctx.photosNew, latest_photo: ctx.latestPhoto, closeout: ctx.closeout.length ? ctx.closeout : null, near_completion: ctx.near.length ? ctx.near : null,
    om: ctx.om ? { ok: ctx.om.items_ok, total: ctx.om.items_total, missing: ctx.om.missing.slice(0, 40), datasheets_missing: ctx.om.datasheets_missing.length } : null,
    written_at: new Date().toISOString(),
  }
}

async function alertDraft(projectId: string, projectName: string, reportId: string, paRef: string | null, src: any, month: string | null = null) {
  const key = `report_draft:${projectId}:${month || paRef || reportId}`
  const row = { key, project_id: projectId, kind: "report_draft", severity: "soon",
    title: `Progress report drafted — review & publish — ${projectName}`,
    detail: `Drafted from ${paRef || "the latest PA"}, ${src.diary} diary note${src.diary === 1 ? "" : "s"} and ${src.photos} photo${src.photos === 1 ? "" : "s"}.`
      + (src.photos_new === 0 ? ` No new site photos this period${src.latest_photo ? ` (newest ${fmt(src.latest_photo)})` : ""}.` : "")
      + (src.om ? ` ${src.closeout ? "Close-out" : "Nearing completion"}: ${src.om.ok} of ${src.om.total} handover / O&M items in place${src.om.datasheets_missing ? `, ${src.om.datasheets_missing} datasheets still needed` : ""} — check the Handover tab before the final account goes.` : "")
      + " Check it, then press Publish to client.",
    action_label: "Open the draft", action_url: `/projects/${projectId}?tab=documents`, status: "open", last_seen: new Date().toISOString() }
  const { data: e } = await sb.from("crm_alerts").select("id").eq("key", key).maybeSingle()
  if (e) await sb.from("crm_alerts").update(row).eq("id", e.id)
  else await sb.from("crm_alerts").insert(row)
}

// ─── New draft after a PA ────────────────────────────────────────────────────
// sub: a building's report folder (05-progress-report-custom-…) on jobs with several buildings
async function draft(projectId: string, paRefIn: string | null, force = false, month: string | null = null, sub: string | null = null) {
  let pq = sb.from("progress_reports").select("*").eq("project_id", projectId)
  pq = sub ? pq.eq("subfolder_key", sub) : pq.is("subfolder_key", null)
  const { data: prevs } = await pq.order("created_at", { ascending: false }).limit(5)
  const prev = (prevs || []).find((r: any) => !r.ai_draft) || null
  // The month this report is for, dated its last day
  const periodEnd = month && /^\d{4}-\d{2}$/.test(month) ? monthEndOf(new Date(month + "-01T00:00:00Z")) : monthEndOf(new Date())
  const monthKey = ymd(periodEnd).slice(0, 7)
  // A draft for this month already: keep it — unless it was drafted before the month
  // end and nobody has touched it since, then it's redone in place from the final PA
  let refresh: any = null
  const dup = (prevs || []).find((r: any) => r.ai_draft && String(r.period_to || "").slice(0, 7) === monthKey)
  if (dup && !force) {
    const early = String(dup.period_to || "") < ymd(periodEnd)
    const untouched = !dup.updated_at || Math.abs(new Date(dup.updated_at).getTime() - new Date(dup.created_at).getTime()) < 5 * 60_000
      || (dup.ai_sources?.written_at && new Date(dup.updated_at).getTime() - new Date(dup.ai_sources.written_at).getTime() < 5 * 60_000)
    if (!(early && untouched && monthEndOf(new Date()).getTime() === periodEnd.getTime() && new Date().getUTCDate() === periodEnd.getUTCDate())) return { report_id: dup.id, existing: true }
    refresh = dup
  }
  const ctx = await gather(projectId, prev, sub)
  const paRef = paRefIn || (ctx.paName && paNo(ctx.paName) != null ? PA(paNo(ctx.paName)!) : null)
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
    project_id: projectId, subfolder_key: sub, report_number: await nextReportNumber(projectId, periodEnd), report_date: ymd(periodEnd),
    period_from: ctx.since, period_to: ymd(periodEnd),
    job_no: p.project_ref || p.project_name, client_pm: p.project_name,
    employer: prev?.employer || p.client_name || "", contract_administrator: prev?.contract_administrator || eaNames || "",
    surveyor: prev?.surveyor || "", main_contractor: prev?.main_contractor || "City Construction Group",
    mc_pm: prev?.mc_pm || names("Project Manager") || "", site_manager: prev?.site_manager || names("Site Manager") || "",
    start_on_site: prev?.start_on_site || p.start_date || null, contract_completion: prev?.contract_completion || p.end_date || null,
    target_completion: prev?.target_completion || p.end_date || null,
    estimated_completion: (/^\d{4}-\d{2}-\d{2}$/.test(String(out.estimated_completion || "")) ? out.estimated_completion : null) || prev?.estimated_completion || p.end_date || null,
    programme_groups: pa ? pa.groups.map((g: any) => ({ name: g.name, items: [{ label: `Avg progress (${g.item_count} item${g.item_count === 1 ? "" : "s"})`, percent: g.avg_pct }] })) : (prev?.programme_groups || []),
    variations: pa ? variationsFromPa(pa.variations) : (prev?.variations || []),
    valuations: valuationsWithPa(prev?.valuations || [], { totals: pa?.totals, paName: ctx.paName, paDate: ctx.paDate, retention }),
    rfis: Array.isArray(out.rfis) ? out.rfis.slice(0, 40).map((x: any) => ({ rfi_no: String(x.rfi_no || ""), description: String(x.description || ""), status: x.status === "closed" ? "closed" : "open" })) : (prev?.rfis || []),
    risks: Array.isArray(out.risks) ? out.risks.slice(0, 20).map((x: any) => ({ description: String(x.description || ""), consequence: String(x.consequence || ""), risk_rag: ["red", "amber", "green"].includes(x.risk_rag) ? x.risk_rag : "amber", mitigation: String(x.mitigation || "") })) : (prev?.risks || []),
    ai_draft: true, ai_pa_ref: paRef,
  }
  for (const f of TEXT_FIELDS) report[f] = typeof out[f] === "string" ? out[f] : (prev?.[f] || "")
  if (!report.hs_text) report.hs_text = "No health and safety incidents were reported during this period."
  let row: any, error: any
  if (refresh) {
    // Same draft, same number — figures and text redone at month end
    delete report.report_number
    ;({ data: row, error } = await sb.from("progress_reports").update(report).eq("id", refresh.id).select("id").single())
  } else ({ data: row, error } = await sb.from("progress_reports").insert(report).select("id").single())
  if (error) throw new Error("Couldn't save the draft: " + error.message)
  const nPhotos = await addPhotos(row.id, used, out.photos)
  const src = sources(ctx, nPhotos)
  await sb.from("progress_reports").update({ ai_sources: src }).eq("id", row.id)
  let building: string | null = null
  if (sub) building = (await sb.from("project_doc_folders").select("label").eq("project_id", projectId).eq("folder_key", sub).maybeSingle()).data?.label || null
  await alertDraft(projectId, building ? `${p.project_name} — ${building}` : p.project_name, row.id, paRef, src, sub ? `${monthKey}:${sub.split("-custom-")[1] || sub}` : monthKey)
  return { report_id: row.id, sources: src }
}

// ─── Fill an existing report's text + photos (editor button) ─────────────────
async function fill(reportId: string) {
  const { data: rep } = await sb.from("progress_reports").select("*").eq("id", reportId).maybeSingle()
  if (!rep) throw new Error("Report not found")
  // Same building as the report (the editor reads the PA the same way)
  let pq = sb.from("progress_reports").select("*").eq("project_id", rep.project_id).neq("id", reportId).eq("ai_draft", false)
  pq = rep.subfolder_key ? pq.eq("subfolder_key", rep.subfolder_key) : pq.is("subfolder_key", null)
  const { data: prevs } = await pq.order("created_at", { ascending: false }).limit(1)
  const prev = prevs?.[0] || null
  const ctx = await gather(rep.project_id, prev, rep.subfolder_key || null)
  const { out, used } = await write(ctx, prev)
  const patch: any = { ai_draft: true }
  for (const f of TEXT_FIELDS) if (typeof out[f] === "string" && out[f].trim()) patch[f] = out[f]
  if (Array.isArray(out.rfis)) patch.rfis = out.rfis.slice(0, 40).map((x: any) => ({ rfi_no: String(x.rfi_no || ""), description: String(x.description || ""), status: x.status === "closed" ? "closed" : "open" }))
  if (Array.isArray(out.risks)) patch.risks = out.risks.slice(0, 20).map((x: any) => ({ description: String(x.description || ""), consequence: String(x.consequence || ""), risk_rag: ["red", "amber", "green"].includes(x.risk_rag) ? x.risk_rag : "amber", mitigation: String(x.mitigation || "") }))
  await addPhotos(reportId, used, out.photos)
  const { count: nPhotos } = await sb.from("progress_report_photos").select("id", { count: "exact", head: true }).eq("report_id", reportId)
  patch.ai_sources = sources(ctx, nPhotos || 0)
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
    if (!["draft", "om_status", "pa_totals"].includes(body.action)) return json({ error: "Schedule can only draft" }, 403)
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
      const sub = typeof body.subfolder_key === "string" && /^05-progress-report-custom-[\w-]+$/.test(body.subfolder_key) ? body.subfolder_key : null
      return json(await draft(body.project_id, body.pa_ref ? String(body.pa_ref).slice(0, 10) : null, !!body.force, typeof body.month === "string" ? body.month.slice(0, 7) : null, sub))
    }
    if (body.action === "pa_totals") {
      // For cross-checking figures read from emails: the job's latest PA(s), every building
      if (!/^[0-9a-f-]{36}$/i.test(String(body.project_id || ""))) return json({ error: "Bad project" }, 400)
      const { data: files } = await sb.from("project_doc_files").select("file_name, subfolder_key").eq("project_id", body.project_id).eq("folder_key", "02-payment-application")
      const subs = [...new Set((files || []).filter((f: any) => /\.xlsx$/i.test(f.file_name) && paNo(f.file_name) != null && f.subfolder_key !== "superseded").map((f: any) => f.subfolder_key ?? null))]
      let total = 0, cumulative = 0, retention: number | null = null, name: string[] = []
      for (const sub of subs.slice(0, 6)) {
        const buf = await fetchLatestPaForSubfolder(sb, body.project_id, sub as any).catch(() => null)
        const pa = buf ? await extractFromPa(buf).catch(() => null) : null
        if (!pa?.totals) continue
        total += pa.totals.total || 0; cumulative += pa.totals.cumulative || 0
        if (pa.totals.retention_pct != null) retention = pa.totals.retention_pct
        const latest = (files || []).filter((f: any) => (f.subfolder_key ?? null) === sub && paNo(f.file_name) != null).sort((a: any, b: any) => paNo(b.file_name)! - paNo(a.file_name)!)[0]
        if (latest) name.push(PA(paNo(latest.file_name)!))
      }
      return json({ ok: true, pa: name.length > 1 ? `the latest PAs (${name.length} buildings)` : name[0] || null, total, cumulative, retention_pct: retention })
    }
    if (body.action === "om_status") {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.project_id || ""))) return json({ error: "Bad project" }, 400)
      const om = await omStatus(body.project_id)
      return json({ ok: true, items_ok: om.items_ok, items_total: om.items_total, missing: om.missing, datasheets_missing: om.datasheets_missing, om_issued: om.om_issued })
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
