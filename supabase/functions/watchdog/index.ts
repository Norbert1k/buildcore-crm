// supabase/functions/watchdog/index.ts
//
// CRM watchdog — checks every active job and keeps the "Needs attention" list.
// Runs each morning (pg_cron, supabase-sql/041_watchdog.sql) and on "Check now".
//
//   PA due (about a month after the last one) · progress report due (each new PA,
//   at the claimed %) · two versions of one PA · PA hidden from the client ·
//   CFF behind the PAs · no payment notice yet · completion close / passed ·
//   insurance expired or about to · quote requests with no prices ·
//   Inbox files and subcontractor applications waiting · loose drawings
//
// Items close themselves once the job is done; "Not relevant" keeps one away.
// One-tap fixes only ever hide/archive — nothing is deleted.
//
// Actions (POST JSON):
//   { action: 'run', digest? }        schedule (x-intake-key) or staff
//   { action: 'fix', id }             staff — do the alert's one-tap fix
//
// Deploy: supabase functions deploy watchdog --no-verify-jwt
// Secrets: RESEND_API_KEY (already set — morning email), SUPABASE_* (provided)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-intake-key",
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } })
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
const STAFF = ["admin", "project_manager", "operations_manager", "project_director", "document_controller", "accountant", "director_viewer"]

const DAY = 864e5
const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")
const days = (a: Date | string, b: Date | string = today()) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY)
const fmt = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const paNo = (n: string) => { const m = String(n).replace(/^\d{4}-\d{2}-\d{2}[_ ]\d{3,4}\s*-\s*\S+@\S+\s*-\s*/, "").match(/\bPA\s*[-_ ]?0*(\d{1,3})\b/i); return m ? parseInt(m[1], 10) : null }
const PA = (n: number) => "PA" + String(n).padStart(2, "0")

async function all<T = any>(build: () => any, size = 1000): Promise<T[]> {
  let out: T[] = []
  for (let from = 0; from < 100000; from += size) {
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + size - 1)
    if (error) throw new Error(error.message)
    out = out.concat(data || [])
    if (!data || data.length < size) break
  }
  return out
}

type Alert = {
  key: string; project_id?: string | null; kind: string; severity: "urgent" | "soon" | "info"
  title: string; detail?: string; action_label?: string; action_url?: string; fix?: string | null; due_date?: string | null
}

async function check(): Promise<Alert[]> {
  const out: Alert[] = []
  const now = today()
  const { data: projects } = await sb.from("projects")
    .select("id, project_name, project_ref, start_date, end_date, status, project_manager_id, project_director_id").eq("status", "active")
  const jobs = projects || []
  if (!jobs.length) return out
  const ids = jobs.map((p: any) => p.id)

  const [files, reports, folders] = await Promise.all([
    all(() => sb.from("project_doc_files").select("id, project_id, folder_key, subfolder_key, file_name, created_at, client_visible")
      .in("project_id", ids).in("folder_key", ["02-payment-application", "03-payment-notice", "00-project-information"])),
    sb.from("progress_reports").select("id, project_id, report_date, created_at, ai_draft, ai_pa_ref, ai_sources").in("project_id", ids)
      .then((r: any) => r.error ? sb.from("progress_reports").select("project_id, report_date, created_at").in("project_id", ids).then((x: any) => x.data || []) : (r.data || [])),
    sb.from("project_doc_folders").select("project_id, folder_key, parent_key").in("project_id", ids).then((r: any) => r.data || []),
  ])
  // Newest site photo per job
  const lastPhoto = new Map<string, string | null>(await Promise.all(ids.map((id: string) =>
    sb.from("project_photos").select("taken_at, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(1)
      .then((r: any) => [id, r.error ? undefined : (r.data?.[0] ? (r.data[0].taken_at || r.data[0].created_at) : null)] as [string, any], () => [id, undefined] as [string, any]))))

  for (const p of jobs as any[]) {
    const docs = `/projects/${p.id}?tab=documents`
    const mine = files.filter((f: any) => f.project_id === p.id)
    // Our PAs (any building folder; archived versions are left out)
    const pas = mine.filter((f: any) => f.folder_key === "02-payment-application" && f.subfolder_key !== "superseded" && paNo(f.file_name) != null)
      .map((f: any) => ({ ...f, n: paNo(f.file_name)! }))
    const byLoc = new Map<string, any[]>()
    for (const f of pas) { const k = f.subfolder_key || "root"; byLoc.set(k, [...(byLoc.get(k) || []), f]) }
    const latest = pas.slice().sort((a, b) => b.n - a.n || +new Date(b.created_at) - +new Date(a.created_at))[0] || null
    const lastPaDate = pas.length ? pas.map((f: any) => f.created_at).sort().slice(-1)[0] : null

    // 1. PA due — about a month after the last one (or a month after start)
    const fromDate = lastPaDate || p.start_date
    if (fromDate) {
      const due = new Date(new Date(fromDate).getTime() + 30 * DAY)
      const left = days(now, due)
      const next = (latest?.n || 0) + 1
      if (left <= 5 && (!p.end_date || days(p.end_date, now) < 60)) {
        out.push({ key: `pa_due:${p.id}:${next}`, project_id: p.id, kind: "pa_due", severity: left < 0 ? "urgent" : "soon",
          title: `${PA(next)} ${left < 0 ? "overdue" : "due"} — ${p.project_name}`,
          detail: left < 0 ? `Last PA was ${fmt(fromDate)} (${-left + 30} days ago).` : `Due around ${fmt(due)}${lastPaDate ? ` — last PA ${fmt(lastPaDate)}` : ""}.`,
          action_label: "Payment applications", action_url: docs, due_date: due.toISOString().slice(0, 10) })
      }
    }

    // Site photos gone quiet (job started, not yet finished) — the progress report needs them
    const ph = lastPhoto.get(p.id)
    const started = p.start_date && days(p.start_date, now) >= 21
    const running = !p.end_date || days(now, p.end_date) >= -14
    if (ph !== undefined && started && running && (ph ? days(ph, now) >= 21 : true)) {
      out.push({ key: `photos_stale:${p.id}`, project_id: p.id, kind: "photos_stale", severity: "info",
        title: `No site photos ${ph ? `since ${fmt(ph)}` : "yet"} — ${p.project_name}`,
        detail: `${ph ? `The newest site photo is ${days(ph, now)} days old.` : "No site photos are on this job."} Ask site to send this week's photos so the next progress report shows current work.`,
        action_label: "Site photos", action_url: docs })
    }

    if (latest) {
      const age = days(latest.created_at)
      // 2. Progress report due with each new PA (reported at the claimed %)
      // Drafts written by the CRM don't count until a person publishes them
      const mineReports = (reports as any[]).filter(r => r.project_id === p.id)
      const lastReport = mineReports.filter(r => !r.ai_draft).map(r => r.report_date || r.created_at).sort().slice(-1)[0]
      if (!lastReport || new Date(lastReport) < new Date(latest.created_at)) {
        const draft = mineReports.find(r => r.ai_draft && r.ai_pa_ref === PA(latest.n))
        if (draft) {
          out.push({ key: `report_draft:${p.id}:${PA(latest.n)}`, project_id: p.id, kind: "report_draft", severity: age > 7 ? "urgent" : "soon",
            title: `Progress report drafted — review & publish — ${p.project_name}`,
            detail: `The CRM drafted it from ${PA(latest.n)}, the job diary and site photos.`
              + (draft.ai_sources?.photos_new === 0 ? ` No new site photos this period${draft.ai_sources.latest_photo ? ` (newest ${fmt(draft.ai_sources.latest_photo)})` : ""}.` : "")
              + (draft.ai_sources?.om ? ` ${draft.ai_sources.closeout ? "Close-out" : "Nearing completion"}: ${draft.ai_sources.om.ok} of ${draft.ai_sources.om.total} handover / O&M items in place — check the Handover tab before the final account goes.` : "")
              + " Check it, then press Publish to client.",
            action_label: "Open the draft", action_url: docs })
        } else {
          // Single-building jobs: the CRM drafts it (each morning, or "Draft it now")
          const canDraft = !latest.subfolder_key
          out.push({ key: `report_due:${p.id}:${latest.n}`, project_id: p.id, kind: "report_due", severity: age > 7 ? "urgent" : "soon",
            title: `Progress report due — ${p.project_name}`,
            detail: `${PA(latest.n)} went in on ${fmt(latest.created_at)}; the progress report should follow at the claimed % from ${PA(latest.n)}.${canDraft ? " The CRM drafts it each morning — or press Draft it now." : ""}`,
            action_label: "New progress report", action_url: docs, ...(canDraft ? { fix: "draft_report" } : {}) })
        }
      }
      // 3. Latest PA hidden from the client
      if (latest.client_visible === false && age >= 1) {
        out.push({ key: `pa_hidden:${latest.id}`, project_id: p.id, kind: "pa_hidden", severity: "soon",
          title: `${PA(latest.n)} hidden from the client — ${p.project_name}`,
          detail: `"${latest.file_name}" isn't on the client portal, so their claimed figures stop at the previous PA.`,
          action_label: "Payment applications", action_url: docs, fix: "show_pa" })
      }
      // 4. CFF behind the PAs
      const cff = mine.filter((f: any) => f.folder_key === "00-project-information" && f.subfolder_key === "cff").map((f: any) => f.created_at).sort().slice(-1)[0]
      if (cff && new Date(cff) < new Date(latest.created_at)) {
        out.push({ key: `cff_stale:${p.id}:${latest.n}`, project_id: p.id, kind: "cff_stale", severity: "info",
          title: `Update the CFF — ${p.project_name}`, detail: `${PA(latest.n)} is newer than the cashflow forecast (${fmt(cff)}).`,
          action_label: "Update CFF", action_url: docs })
      }
      // 5. No payment notice since the PA
      const notice = mine.filter((f: any) => f.folder_key === "03-payment-notice" && new Date(f.created_at) >= new Date(latest.created_at))
      if (!notice.length && age >= 12) {
        out.push({ key: `notice_missing:${p.id}:${latest.n}`, project_id: p.id, kind: "notice_missing", severity: age >= 21 ? "urgent" : "soon",
          title: `No payment notice for ${PA(latest.n)} — ${p.project_name}`,
          detail: `${PA(latest.n)} went in ${age} days ago and no payment notice has been saved. Chase the client / EA.`,
          action_label: "Payment notices", action_url: docs })
      }
    }
    // 6. Two versions of the same PA in one place
    for (const [loc, list] of byLoc) {
      const byN = new Map<number, any[]>()
      for (const f of list) byN.set(f.n, [...(byN.get(f.n) || []), f])
      for (const [n, vs] of byN) if (vs.length > 1) {
        out.push({ key: `pa_dupe:${p.id}:${loc}:${n}`, project_id: p.id, kind: "pa_dupe", severity: "soon",
          title: `${vs.length} versions of ${PA(n)} — ${p.project_name}`,
          detail: `Keep the newest (${fmt(vs.map((v: any) => v.created_at).sort().slice(-1)[0])}); older ones are archived (hidden, not deleted).`,
          action_label: "Payment applications", action_url: docs, fix: "archive_older_pa" })
      }
    }
    // 7. Completion close / passed
    if (p.end_date) {
      const left = days(now, p.end_date)
      if (left < 0) out.push({ key: `pc_passed:${p.id}:${p.end_date}`, project_id: p.id, kind: "pc", severity: "urgent",
        title: `Completion date passed — ${p.project_name}`, detail: `Planned completion was ${fmt(p.end_date)}. Update the programme / end date, or record PC and mark the job completed.`,
        action_label: "Open job", action_url: `/projects/${p.id}` })
      else if (left <= 28) out.push({ key: `pc_near:${p.id}:${p.end_date}`, project_id: p.id, kind: "pc", severity: "soon",
        title: `Completion in ${left} days — ${p.project_name}`, detail: `Planned completion ${fmt(p.end_date)}. Start the handover pack and snagging.`,
        action_label: "Handover", action_url: `/projects/${p.id}?tab=handover` })
    }
    // 8. Loose drawings (not in a sub-folder) on a job that has drawing sub-folders
    const hasDrawingFolders = (folders as any[]).some(f => f.project_id === p.id && f.parent_key === "drawings")
    const loose = mine.filter((f: any) => f.folder_key === "00-project-information" && f.subfolder_key === "drawings").length
    if (hasDrawingFolders && loose >= 10) out.push({ key: `loose_drawings:${p.id}`, project_id: p.id, kind: "tidy", severity: "info",
      title: `${loose} drawings not in a sub-folder — ${p.project_name}`, detail: "Move them into the consultant/discipline folders so the set stays easy to find.",
      action_label: "Drawings", action_url: docs })
  }

  // 9. Insurance / compliance for subcontractors on active jobs
  const { data: onJobs } = await sb.from("project_subcontractors").select("subcontractor_id, project_id").in("project_id", ids).eq("status", "active")
  const subIds = [...new Set((onJobs || []).map((r: any) => r.subcontractor_id))]
  if (subIds.length) {
    const horizon = new Date(now.getTime() + 14 * DAY).toISOString().slice(0, 10)
    const { data: docs } = await sb.from("documents").select("id, document_type, document_name, expiry_date, subcontractor_id, subcontractors(company_name)")
      .in("subcontractor_id", subIds).not("expiry_date", "is", null).lte("expiry_date", horizon)
    // only the latest of each type per subcontractor counts
    const latestOf = new Map<string, any>()
    const { data: allDocs } = await sb.from("documents").select("subcontractor_id, document_type, expiry_date").in("subcontractor_id", subIds).not("expiry_date", "is", null)
    for (const d of allDocs || []) { const k = d.subcontractor_id + "|" + d.document_type; if (!latestOf.has(k) || d.expiry_date > latestOf.get(k)) latestOf.set(k, d.expiry_date) }
    for (const d of (docs || []) as any[]) {
      if (latestOf.get(d.subcontractor_id + "|" + d.document_type) !== d.expiry_date) continue
      const left = days(now, d.expiry_date)
      if (left < -90) continue
      out.push({ key: `doc:${d.id}:${d.expiry_date}`, kind: "compliance", severity: left < 0 ? "urgent" : "soon",
        title: `${d.subcontractors?.company_name || "Subcontractor"} — ${String(d.document_type).replace(/_/g, " ")} ${left < 0 ? "expired" : "expires " + fmt(d.expiry_date)}`,
        detail: left < 0 ? `Expired ${fmt(d.expiry_date)} while they're on an active job. Ask for the renewal.` : `${left} days left. Ask for the renewal.`,
        action_label: "Compliance", action_url: `/subcontractors/${d.subcontractor_id}` })
    }
  }

  // 10. Quote requests past their return date with no prices
  const { data: reqs } = await sb.from("tasks").select("id, title, project_id, return_by, status").eq("is_quote", true).neq("status", "closed").lt("return_by", now.toISOString().slice(0, 10))
  if (reqs?.length) {
    const { data: qs } = await sb.from("task_quotes").select("task_id").in("task_id", reqs.map((r: any) => r.id))
    const priced = new Set((qs || []).map((q: any) => q.task_id))
    for (const r of reqs as any[]) if (!priced.has(r.id) && ids.includes(r.project_id)) {
      const job = jobs.find((p: any) => p.id === r.project_id)
      out.push({ key: `quote_late:${r.id}`, project_id: r.project_id, kind: "quotes", severity: "soon",
        title: `No prices back for ${r.title} — ${job?.project_name || ""}`, detail: `Prices were due ${fmt(r.return_by)}. Chase the subcontractors or extend the date.`,
        action_label: "Open request", action_url: `/tasks/${r.id}` })
    }
  }

  // 11. Inbox: subcontractor applications and files waiting
  const { data: waiting } = await sb.from("intake_items").select("id, file_name, doc_type, summary, created_at, guess").eq("status", "to_check")
  const old = (waiting || []).filter((w: any) => days(w.created_at) >= 2)
  for (const w of old.filter((w: any) => w.doc_type === "subcontractor_application")) {
    out.push({ key: `subapp:${w.id}`, project_id: w.guess?.project_id || null, kind: "subcontractor_application", severity: "urgent",
      title: `Subcontractor application waiting ${days(w.created_at)} days`, detail: `${w.summary || w.file_name} — check it so the payment notice goes out in time.`,
      action_label: "Inbox", action_url: "/inbox" })
  }
  const others = old.filter((w: any) => w.doc_type !== "subcontractor_application")
  if (others.length) out.push({ key: "inbox_waiting", kind: "inbox", severity: "info",
    title: `${others.length} file${others.length === 1 ? "" : "s"} waiting in the Inbox`, detail: "Files from email that need a person to say where they go.",
    action_label: "Inbox", action_url: "/inbox" })
  return out
}

async function run(digest: boolean) {
  const found = await check()
  const keys = new Set(found.map(a => a.key))
  const { data: existing } = await sb.from("crm_alerts").select("id, key, status, notified").in("status", ["open", "dismissed"])
  const byKey = new Map((existing || []).map((a: any) => [a.key, a]))
  const nowIso = new Date().toISOString()
  const fresh: Alert[] = []
  for (const a of found) {
    const e: any = byKey.get(a.key)
    if (e?.status === "dismissed") continue
    if (e) await sb.from("crm_alerts").update({ ...a, last_seen: nowIso }).eq("id", e.id)
    else {
      // A key that was resolved before can come back (e.g. CFF behind again) — reopen it
      const { data: prev } = await sb.from("crm_alerts").select("id").eq("key", a.key).maybeSingle()
      if (prev) await sb.from("crm_alerts").update({ ...a, status: "open", last_seen: nowIso, resolved_at: null, notified: false }).eq("id", prev.id)
      else await sb.from("crm_alerts").insert({ ...a, last_seen: nowIso })
      fresh.push(a)
    }
  }
  // Anything no longer true closes itself — except alerts raised by the Inbox
  // (client PA revisions), which stay until someone ticks them off
  for (const e of (existing || []) as any[]) {
    if (e.status === "open" && !keys.has(e.key) && !e.key.startsWith("pa_client_rev:"))
      await sb.from("crm_alerts").update({ status: "done", resolved_at: nowIso }).eq("id", e.id)
  }

  // Bell notifications to the job's PM and director for new urgent / soon items
  const toNotify = fresh.filter(a => a.severity !== "info" && a.project_id && a.kind !== "compliance")
  if (toNotify.length) {
    const { data: projs } = await sb.from("projects").select("id, project_manager_id, project_director_id").in("id", [...new Set(toNotify.map(a => a.project_id!))])
    for (const a of toNotify) {
      const p: any = (projs || []).find((x: any) => x.id === a.project_id)
      for (const uid of [...new Set([p?.project_manager_id, p?.project_director_id].filter(Boolean))]) {
        await sb.from("notifications").insert({ user_id: uid, title: a.title, message: a.detail || null, type: a.severity === "urgent" ? "danger" : "warning", link: a.action_url || null })
      }
    }
    await sb.from("crm_alerts").update({ notified: true }).in("key", toNotify.map(a => a.key))
  }

  // Each morning: draft the progress reports that are due (single-building jobs, 2 a run)
  let drafted = 0
  if (digest) {
    for (const a of found.filter(x => x.kind === "report_due" && x.fix === "draft_report").slice(0, 2)) {
      const ok = await draftReport(a.key).catch(e => { console.warn("[watchdog] draft", e); return false })
      if (ok) drafted++
    }
  }

  // Morning email to admins
  let emailed = 0
  if (digest) emailed = await sendDigest()
  return { ok: true, open: found.length, new: fresh.length, emailed, drafted }
}

async function sendDigest() {
  const key = Deno.env.get("RESEND_API_KEY")
  if (!key) return 0
  const { data: open } = await sb.from("crm_alerts").select("title, detail, severity, action_url").eq("status", "open")
    .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`).neq("severity", "info")
  if (!open?.length) return 0
  const order = { urgent: 0, soon: 1, info: 2 } as Record<string, number>
  const rows = open.sort((a: any, b: any) => order[a.severity] - order[b.severity]).map((a: any) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;background:${a.severity === "urgent" ? "#FCEBEB;color:#A32D2D" : "#FAEEDA;color:#854F0B"}">${a.severity === "urgent" ? "Urgent" : "Soon"}</span>
      <a href="https://crm.cltd.co.uk${a.action_url || "/"}" style="color:#111;font-weight:600;text-decoration:none;margin-left:6px">${esc(a.title)}</a>
      <div style="color:#666;font-size:13px;margin-top:2px">${esc(a.detail || "")}</div></td></tr>`).join("")
  const html = `<div style="font-family:Calibri,Arial,sans-serif;max-width:640px"><h2 style="color:#428B40;margin:0 0 4px">Needs attention today</h2>
    <div style="color:#666;font-size:13px;margin-bottom:12px">${open.length} item${open.length === 1 ? "" : "s"} across your jobs — <a href="https://crm.cltd.co.uk/">open the CRM</a></div>
    <table style="width:100%;border-collapse:collapse">${rows}</table></div>`
  const { data: admins } = await sb.from("profiles").select("email").eq("role", "admin")
  let n = 0
  for (const a of admins || []) {
    if (!a.email) continue
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "City Construction <noreply@cltd.co.uk>", to: [a.email], subject: `CRM — ${open.length} thing${open.length === 1 ? "" : "s"} need attention`, html }),
    })
    if (r.ok) n++
  }
  return n
}
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))

// Ask progress-draft to write the report for report_due:<job>:<PA no>
async function draftReport(key: string) {
  const [, projectId, n] = key.split(":")
  const { data: st } = await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/progress-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "x-intake-key": st?.cron_token || "" },
    body: JSON.stringify({ action: "draft", project_id: projectId, pa_ref: PA(Number(n)) }),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok || out.error) throw new Error(out.error || `progress-draft ${r.status}`)
  return true
}

// One-tap fixes — only ever hide or archive (or have the CRM draft a report)
async function fix(id: string, actorId: string) {
  const { data: a } = await sb.from("crm_alerts").select("*").eq("id", id).maybeSingle()
  if (!a || !a.fix || !a.project_id) throw new Error("Nothing to fix here")
  if (a.fix === "draft_report") {
    await draftReport(a.key)
    await sb.from("crm_alerts").update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: actorId }).eq("id", id)
    return
  }
  const files = await all(() => sb.from("project_doc_files").select("id, file_name, subfolder_key, created_at, client_visible")
    .eq("project_id", a.project_id).eq("folder_key", "02-payment-application"))
  const pas = files.filter((f: any) => f.subfolder_key !== "superseded" && paNo(f.file_name) != null)
  if (a.fix === "show_pa") {
    const fileId = a.key.split(":")[1]
    await sb.from("project_doc_files").update({ client_visible: true }).eq("id", fileId).eq("project_id", a.project_id)
  } else if (a.fix === "archive_older_pa") {
    const [, , loc, n] = a.key.split(":")
    const vs = pas.filter((f: any) => (f.subfolder_key || "root") === loc && paNo(f.file_name) === Number(n))
      .sort((x: any, y: any) => +new Date(y.created_at) - +new Date(x.created_at))
    const older = vs.slice(1).map((f: any) => f.id)
    if (older.length) await sb.from("project_doc_files").update({ subfolder_key: "superseded", client_visible: false }).in("id", older)
  } else throw new Error("Unknown fix")
  await sb.from("crm_alerts").update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: actorId }).eq("id", id)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const given = req.headers.get("x-intake-key") || ""
  let actorId: string | null = null
  if (given) {
    const { data: st } = await sb.from("intake_settings").select("cron_token").eq("id", 1).maybeSingle()
    if (!st?.cron_token || given !== st.cron_token) return json({ error: "Bad key" }, 401)
    if (body.action !== "run") return json({ error: "Schedule can only run" }, 403)
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    const { data: u } = token ? await sb.auth.getUser(token) : { data: { user: null } }
    if (!u?.user) return json({ error: "Not signed in" }, 401)
    const { data: prof } = await sb.from("profiles").select("id, role").eq("id", u.user.id).maybeSingle()
    if (!prof || !STAFF.includes(prof.role)) return json({ error: "Not allowed" }, 403)
    actorId = prof.id
  }
  try {
    if (body.action === "fix") { await fix(String(body.id || ""), actorId!); return json({ ok: true }) }
    return json(await run(!!body.digest && !actorId))
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
