// crm-drawings — DESIGN PORTAL side (deploy in the Design Supabase project,
// wjeoirarobkpetogidwv, as a NEW function next to crm-handoff).
//
// Lets the BuildCore CRM show a job's drawing register read-only. Called only
// server-to-server by the CRM's `design-link` function with a shared secret;
// the browser never sees the secret.
//
//   { action: "list", code }              → { status, project, folders[], files[] }
//   { action: "file_url", code, file_id } → { status, url, kind, name }
//   { action: "upload_prepare", code, email, folder_id, files: [{ name, size }] }
//        → { status, project, folder, items: [{ name, plan, file_id, version_no, path, upload_url, existing? }] }
//   { action: "upload_commit", code, email, folder_id, items: [{ name, size, file_id, version_no, path, plan }] }
//        → { status, done: [...], failed: [...] }
//
// list / file_url are READ-ONLY.
// Uploading from the CRM is ADD-ONLY and follows Design's own rules exactly:
//  • only people who could upload to that folder in Design (CCG admin, project
//    admin, or a consultant in their own discipline / buildings) — matched by
//    the CRM user's email, as the sign-in hand-off does;
//  • a new drawing → a new file; a newer revision of a drawing already filed
//    (same drawing number, or same file name) → a new version of it, the old
//    one kept as superseded (is_archived), exactly as Design's own upload does;
//  • the same or an older revision is never uploaded;
//  • nothing is ever deleted or overwritten (storage upload is upsert:false).
// The browser sends the file straight to Design storage on a one-time signed
// upload link; the rows are only written once the file is there.
// Every action refuses to guess when two Design projects share one code.
//
// Settings: Verify JWT = OFF (it checks the shared secret instead).
// Secret (Design project): CRM_DRAWINGS_SECRET — same value as the CRM's
// DESIGN_DRAWINGS_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const STAGE_NAMES: Record<number, string> = { 3: "Stage 3 – Spatial Coordination", 4: "Stage 4 – Technical Design", 5: "Stage 5 – Manufacturing & Construction" };
const IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const ext = (n: string) => (n.split(".").pop() || "").toLowerCase();
const kindOf = (n: string) => ext(n) === "pdf" ? "pdf" : IMG.includes(ext(n)) ? "image" : "other";

// ── Drawing number / revision — same rules as src/lib/revision.ts ──────────
const REV_PATTERNS: RegExp[] = [
  /\brev(?:ision)?[\s._-]*([A-Z]{1,2}\d{0,3}|\d{1,3})\b/i,
  /[\s([_-]((?:P|T|C)\d{1,3})[\])]?\s*$/i,
  /[\s([_-]((?:P|T|C)\d{2})(?=[\s._-])/i,
];
const stripExt = (n: string) => String(n || "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
function parseRevision(name: string) {
  const base = stripExt(name);
  for (const re of REV_PATTERNS) {
    const m = base.match(re);
    if (m) return { rev: m[1].toUpperCase().replace(/^([PTC])0+(\d)/, "$1$2").replace(/^0+(\d)/, "$1"), base: (base.slice(0, m.index) + base.slice((m.index ?? 0) + m[0].length)).trim() };
  }
  return { rev: null as string | null, base };
}
function describe(name: string) {
  const { rev, base } = parseRevision(name);
  const tokens = (base.match(/[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+/g) || [])
    .filter((t) => /\d/.test(t) && t.replace(/[^A-Za-z0-9]/g, "").length >= 5)
    .sort((a, b) => b.length - a.length);
  const number = tokens[0] ? tokens[0].toUpperCase().replace(/[_.]/g, "-") : null;
  let title = base;
  if (tokens[0]) title = title.replace(tokens[0], "");
  title = title.replace(/^[\s\-–_·.,]+|[\s\-–_·.,()]+$/g, "").replace(/\s{2,}/g, " ").trim();
  return { number, rev, title: title || null };
}
// Versions are stored as <project>/<file>/v<n>_<name>; first uploads may differ
const nameFromPath = (p: string | null, fallback: string) => {
  const last = String(p || "").split("/").pop() || "";
  // Revisions are saved with spaces turned into underscores — put them back for display
  const n = last.startsWith("v") && /^v\d+_/.test(last) ? last.replace(/^v\d+_(?:[0-9a-f]{8}_)?/, "").replace(/_/g, " ") : last;
  return n || fallback;
};

Deno.serve(async (req) => {
  try {
    const SECRET = Deno.env.get("CRM_DRAWINGS_SECRET");
    if (!SECRET) return json({ status: "error", message: "CRM_DRAWINGS_SECRET not set" }, 500);
    if (req.method !== "POST" || req.headers.get("x-handoff-secret") !== SECRET) return json({ status: "error", message: "Not allowed" }, 401);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const body = await req.json();
    const { action, code, file_id } = body;
    const clean = String(code || "").trim();
    if (!clean) return json({ status: "not_linked" });

    // Same job the CRM's link points at: Design project code = CRM ref / design code
    // Codes may be typed with or without "#", spaces or capitals ("#2026-006" = "2026-006")
    const norm = (v: string | null) => String(v || "").replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();
    const want = norm(clean);
    const { data: projects } = await sb.from("projects").select("id, name, code, riba_stage").not("code", "is", null);
    const matches = (projects || []).filter((p: any) => norm(p.code) === want);
    if (!matches.length) return json({ status: "not_linked" });
    // Two Design projects with the same code: never guess which one
    if (matches.length > 1) return json({ status: "ambiguous", code: clean, projects: matches.map((p: any) => ({ name: p.name, code: p.code })) });
    const project = matches[0];

    if (action === "upload_prepare" || action === "upload_commit") return await upload(sb, project, action, body);

    if (action === "list") {
      const [{ data: folders, error: fe }, { data: files, error: fie }, { data: buildings }] = await Promise.all([
        sb.from("folders").select("id, name, riba_stage, building_id, discipline_id, disciplines(name)").eq("project_id", project.id),
        sb.from("files").select("id, name, folder_id, created_at, file_versions(id, version_no, storage_path, is_archived, uploaded_at)").eq("project_id", project.id),
        sb.from("buildings").select("id, name").eq("project_id", project.id).order("sort").order("name"),
      ]);
      if (fe || fie) throw fe || fie;

      // Tree as Design shows it: [Building ›] Stage › Discipline › folder;
      // site-wide folders sit under Surveys & Reports.
      const out: { id: string; parent_id: string | null; name: string; order: number }[] = [];
      const seen = new Set<string>();
      const add = (id: string, parent_id: string | null, name: string, order = 0) => { if (!seen.has(id)) { seen.add(id); out.push({ id, parent_id, name, order }); } };
      const bName = new Map((buildings || []).map((b: any) => [b.id, b.name]));
      const bOrder = new Map((buildings || []).map((b: any, i: number) => [b.id, i]));
      const usedBuildings = new Set((folders || []).map((f: any) => f.building_id).filter(Boolean));
      const showBuildings = usedBuildings.size > 1;
      for (const f of (folders || []) as any[]) {
        if (!f.building_id && f.riba_stage == null) {
          add("surveys", null, "Surveys & Reports", 900);
          add(f.id, "surveys", f.name);
          continue;
        }
        const bKey = showBuildings && f.building_id ? `b:${f.building_id}` : null;
        if (bKey) add(bKey, null, bName.get(f.building_id) || "Building", 100 + (bOrder.get(f.building_id) ?? 0));
        const sKey = `${bKey || "x"}:s${f.riba_stage ?? 0}`;
        add(sKey, bKey, STAGE_NAMES[f.riba_stage] || (f.riba_stage ? `Stage ${f.riba_stage}` : "Other"), f.riba_stage ?? 9);
        const dKey = `${sKey}:d${f.discipline_id || "-"}`;
        add(dKey, sKey, f.disciplines?.name || "General");
        add(f.id, dKey, f.name);
      }

      const rows: any[] = [];
      for (const f of (files || []) as any[]) {
        const vs = [...(f.file_versions || [])].sort((a: any, b: any) => b.version_no - a.version_no);
        if (!vs.length) continue;
        const cur = vs.find((v: any) => !v.is_archived) || vs[0];
        const d = describe(f.name);
        rows.push({ id: f.id, folder_id: f.folder_id, file_name: f.name, number: d.number, title: d.title, rev: d.rev, status: "current", issued_at: cur.uploaded_at || f.created_at, kind: kindOf(f.name), _path: cur.storage_path });
        for (const v of vs) {
          if (v.id === cur.id) continue;
          const n = nameFromPath(v.storage_path, f.name);
          const dv = describe(n);
          rows.push({ id: `v:${v.id}`, folder_id: f.folder_id, file_name: n, number: dv.number || d.number, title: dv.title || d.title, rev: dv.rev || `v${v.version_no}`, status: "superseded", issued_at: v.uploaded_at, kind: kindOf(n) });
        }
      }
      // Thumbnails for the grid view: images sign themselves; PDFs use the
      // thumbnail Design already caches at <project>/thumbs/<file>/<version>.jpg
      // (made the first time anyone views the drawing in Design). One batch call.
      const want: { row: any; path: string }[] = [];
      for (const r of rows) {
        if (r.status !== "current" || !r._path) continue;
        if (r.kind === "image") want.push({ row: r, path: r._path });
        else if (r.kind === "pdf") want.push({ row: r, path: r._path.replace(/^([^/]+)\//, "$1/thumbs/").replace(/\.pdf$/i, ".jpg") });
      }
      if (want.length) {
        try {
          const { data: signed } = await sb.storage.from("project-files").createSignedUrls(want.map((w) => w.path), 3600);
          (signed || []).forEach((sgn: any, i: number) => { if (sgn?.signedUrl && !sgn.error) want[i].row.thumb = sgn.signedUrl; });
        } catch { /* no thumbnails — the grid shows file-type tiles */ }
      }
      for (const r of rows) delete r._path;
      return json({ status: "ok", project: { code: project.code, name: project.name }, folders: out, files: rows });
    }

    if (action === "file_url") {
      const id = String(file_id || "");
      let path: string | null = null, name = "";
      if (id.startsWith("v:")) {
        const { data: v } = await sb.from("file_versions").select("storage_path, project_id, files(name)").eq("id", id.slice(2)).maybeSingle();
        if (!v || (v as any).project_id !== project.id) return json({ status: "not_found" }, 404);
        path = (v as any).storage_path; name = nameFromPath(path, (v as any).files?.name || "");
      } else {
        const { data: f } = await sb.from("files").select("name, project_id, file_versions(storage_path, is_archived, version_no)").eq("id", id).maybeSingle();
        if (!f || (f as any).project_id !== project.id) return json({ status: "not_found" }, 404);
        const vs = [...((f as any).file_versions || [])].sort((a: any, b: any) => b.version_no - a.version_no);
        path = (vs.find((v: any) => !v.is_archived) || vs[0])?.storage_path ?? null; name = (f as any).name;
      }
      if (!path) return json({ status: "not_found" }, 404);
      const { data: signed, error } = await sb.storage.from("project-files").createSignedUrl(path, 600, { download: name || true }); // "Download" saves the file; the CRM preview reads it into memory either way
      if (error) throw error;
      return json({ status: "ok", url: signed.signedUrl, kind: kindOf(name), name });
    }

    return json({ status: "error", message: "Unknown action" }, 400);
  } catch (err) {
    console.error("[crm-drawings]", err);
    return json({ status: "error", message: (err as Error).message }, 500);
  }
});

// ── Upload from the CRM (add-only, Design's own rules) ─────────────────────
const sanitize = (v: string) => v.replace(/[^\w.\-]+/g, "_");     // same as Design's upload
const BINARY = ["dwg", "dxf", "ifc", "rvt", "rfa", "nwd", "nwc", "dwf", "skp", "3dm", "step", "stp", "igs", "iges", "dgn"];
const ctypeOf = (n: string) => ext(n) === "pdf" ? "application/pdf" : IMG.includes(ext(n)) ? (ext(n) === "svg" ? "image/svg+xml" : `image/${ext(n) === "jpg" ? "jpeg" : ext(n)}`) : BINARY.includes(ext(n)) ? "application/octet-stream" : "application/octet-stream";

// Revision matching — same as Design's src/lib/revision.ts
function parseDrawing(name: string) {
  const { rev, base } = parseRevision(name);
  const tokens = (base.match(/[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+/g) || [])
    .filter((t) => /\d/.test(t) && t.replace(/[^A-Za-z0-9]/g, "").length >= 5).sort((a, b) => b.length - a.length);
  if (tokens.length) return { key: tokens[0].toUpperCase().replace(/[_.]/g, "-"), rev, byNumber: true };
  return { key: base.toLowerCase().replace(/[^a-z0-9]+/g, ""), rev, byNumber: false };
}
function revParts(r: string) {
  const s = r.toUpperCase();
  let m = s.match(/^([PTC])(\d+)$/); if (m) return { kind: "coded", rank: "PTC".indexOf(m[1]), n: Number(m[2]) };
  m = s.match(/^([A-Z]{1,2})$/); if (m) return { kind: "letter", rank: 0, n: s.length * 100 + (s.charCodeAt(s.length - 1) - 64) + (s.length > 1 ? (s.charCodeAt(0) - 64) * 26 : 0) };
  m = s.match(/^(\d+)$/); if (m) return { kind: "number", rank: 0, n: Number(m[1]) };
  return null;
}
function compareRev(a: string | null, b: string | null): 1 | -1 | 0 | null {
  if (!a || !b) return null;
  if (a.toUpperCase() === b.toUpperCase()) return 0;
  const pa = revParts(a), pb = revParts(b);
  if (!pa || !pb || pa.kind !== pb.kind) return null;
  if (pa.rank !== pb.rank) return pa.rank > pb.rank ? 1 : -1;
  return pa.n === pb.n ? 0 : pa.n > pb.n ? 1 : -1;
}
type Entry = { fileId: string; name: string; folderName: string; key: string; rev: string | null; byNumber: boolean; latestVersion: number; writable?: boolean };
const likeExact = (v: string) => v.replace(/[\\%_]/g, (c) => "\\" + c);
const rand8 = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);
// v<n>_<random>_<name>: a half-finished upload can never block a retry or Design's own upload of the same revision
const pathFor = (projectId: string, fileId: string, ver: number, name: string) => `${projectId}/${fileId}/v${ver}_${rand8()}_${sanitize(name)}`;
const pathOk = (path: string, projectId: string, fileId: string, ver: number, name: string) => {
  const pre = `${projectId}/${fileId}/v${ver}_`, post = `_${sanitize(name)}`;
  return path.startsWith(pre) && path.endsWith(post) && /^[0-9a-f]{8}$/.test(path.slice(pre.length, path.length - post.length));
};
// "new" | "supersede" | "older" | "duplicate" | "ask"
function matchIncoming(index: Entry[], name: string) {
  const p = parseDrawing(name);
  const exactName = index.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const same = exactName ?? index.find((e) => e.key === p.key && (p.byNumber || e.byNumber ? p.byNumber && e.byNumber : true));
  if (!same) return { action: "new", incomingRev: p.rev };
  if (exactName && (!p.rev || !same.rev)) return { action: "ask", existing: same, incomingRev: p.rev };
  const c = compareRev(p.rev, same.rev);
  if (c === 1) return { action: "supersede", existing: same, incomingRev: p.rev };
  if (c === -1) return { action: "older", existing: same, incomingRev: p.rev };
  if (c === 0) return { action: "duplicate", existing: same, incomingRev: p.rev };
  return { action: "ask", existing: same, incomingRev: p.rev };
}

async function upload(sb: any, project: any, action: string, body: any) {
  // Who: the CRM user's own Design account, with the right to upload to this folder
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return json({ status: "no_account" });
  // Exact email match ("_" and "%" are wildcards in ilike — escape them)
  const { data: prof } = await sb.from("profiles").select("id, email, is_ccg_admin").ilike("email", likeExact(email)).maybeSingle();
  if (!prof || String(prof.email || "").toLowerCase() !== email) return json({ status: "no_account" });
  const { data: folder } = await sb.from("folders").select("id, name, project_id, building_id, riba_stage, discipline_id, disciplines(name)").eq("id", String(body.folder_id || "")).maybeSingle();
  if (!folder || folder.project_id !== project.id) return json({ status: "error", message: "That folder isn't in this Design project" });
  let mem: any = null;
  if (!prof.is_ccg_admin) {
    const { data } = await sb.from("project_members").select("*").eq("project_id", project.id).eq("user_id", prof.id).maybeSingle();
    mem = data && (data.status ?? "active") === "active" && !data.is_viewer ? data : null;   // removed / pending / view-only members can't upload
  }
  const { data: discs } = await sb.from("disciplines").select("id, name");
  const surveysId = ((discs || []) as any[]).find((d) => d.name === "Surveys & Reports")?.id ?? null;
  const isAdmin = !!prof.is_ccg_admin || mem?.role === "admin";
  // Same rule as Design's canEditFolder: admins anywhere; consultants only in
  // their own discipline (never Surveys & Reports) and only in their buildings
  const canWrite = (f: any) => !!f && (isAdmin || (!!mem && (mem.role === "consultant" || mem.role === "planning") && !!mem.discipline_id
    && f.discipline_id === mem.discipline_id && f.discipline_id !== surveysId
    && (!mem.building_ids?.length || !f.building_id || mem.building_ids.includes(f.building_id))));
  if (!canWrite(folder)) return json({ status: "no_access", message: "Your Design portal role can't add drawings to this folder." });

  // What's already filed in this building at this stage (or in Surveys & Reports) — as Design's upload checks
  const { data: rows } = await sb.from("files").select("id, name, folder_id, folders!inner(id, name, building_id, riba_stage, discipline_id), file_versions(version_no)").eq("project_id", project.id);
  const index: Entry[] = ((rows as any[]) || [])
    .filter((f) => (f.folders?.building_id ?? null) === (folder.building_id ?? null) && (folder.building_id == null || (f.folders?.riba_stage ?? null) === folder.riba_stage))
    .map((f) => { const p = parseDrawing(f.name); return { fileId: f.id, name: f.name, folderName: f.folders?.name ?? "", key: p.key, rev: p.rev, byNumber: p.byNumber, latestVersion: Math.max(0, ...((f.file_versions || []) as any[]).map((v) => v.version_no)), writable: canWrite(f.folders) }; });
  const folderInfo = { id: folder.id, name: folder.name, discipline: (folder as any).disciplines?.name || null };

  if (action === "upload_prepare") {
    // Several revisions of one drawing in one upload: the newest is filed, the rest are skipped
    const list = (Array.isArray(body.files) ? body.files : []).slice(0, 100)
      .map((f: any, i: number) => ({ f, i, p: parseDrawing(String(f?.name || "")) }))
      .map((x: any, _i: number, all: any[]) => ({ ...x, g: all.findIndex((y: any) => y.p.key === x.p.key) }))
      .sort((a: any, b: any) => a.g - b.g || (-(compareRev(a.p.rev, b.p.rev) ?? 0)) || a.i - b.i)
      .map((x: any) => x.f);
    const items: any[] = [];
    const taken = new Set<string>();
    for (const f of list) {
      const name = String(f?.name || "").trim();
      if (!name) continue;
      const m: any = matchIncoming(index, name);
      const ex = m.existing ? { file_id: m.existing.fileId, name: m.existing.name, folder: m.existing.folderName, rev: m.existing.rev } : null;
      // Two files in one drop for the same drawing: only the first goes in
      const pk = parseDrawing(name).key;
      if ((m.existing && taken.has(m.existing.fileId)) || (!m.existing && taken.has("new:" + pk))) { items.push({ name, plan: "duplicate", existing: ex, note: "A newer file of this drawing is in this upload" }); continue; }
      if (m.existing && !m.existing.writable && m.action !== "older" && m.action !== "duplicate") { items.push({ name, plan: "error", existing: ex, note: `This drawing is filed in ${m.existing.folderName} — only that discipline can revise it` }); continue; }
      if (m.action === "older" || m.action === "duplicate") { items.push({ name, plan: m.action, existing: ex, rev: m.incomingRev }); continue; }
      const asRevision = m.action === "supersede" || m.action === "ask";
      const fileId = asRevision ? m.existing.fileId : crypto.randomUUID();
      const version = asRevision ? m.existing.latestVersion + 1 : 1;
      taken.add(asRevision ? fileId : "new:" + pk);
      const path = pathFor(project.id, fileId, version, name);
      const { data: sig, error } = await sb.storage.from("project-files").createSignedUploadUrl(path);
      if (error || !sig?.signedUrl) { items.push({ name, plan: "error", note: error?.message || "Couldn't prepare the upload" }); continue; }
      // "ask": Design would ask (same name, no revision letter to compare) — the CRM offers revision / separate
      items.push({ name, plan: m.action === "ask" ? "ask" : asRevision ? "revision" : "new", rev: m.incomingRev, existing: ex, file_id: fileId, version_no: version, path, upload_url: sig.signedUrl,
        alt: m.action === "ask" ? await separate(sb, project, name) : undefined, content_type: ctypeOf(name) });
    }
    return json({ status: "ok", project: { name: project.name, code: project.code }, folder: folderInfo, items });
  }

  // upload_commit — the file must already be in storage; then write the rows
  const done: any[] = [], failed: any[] = [];
  for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 100)) {
    const name = String(it?.name || "").trim(), fileId = String(it?.file_id || ""), ver = Number(it?.version_no || 0), path = String(it?.path || "");
    try {
      if (!name || !/^[\w-]{1,64}$/.test(fileId) || !(ver >= 1)) throw new Error("Bad upload");
      if (!pathOk(path, project.id, fileId, ver, name)) throw new Error("Bad upload path");
      const { data: there } = await sb.storage.from("project-files").list(`${project.id}/${fileId}`, { search: `v${ver}_` });
      if (!(there || []).some((o: any) => `${project.id}/${fileId}/${o.name}` === path)) throw new Error("The file didn't arrive — try again");
      const { data: existing } = await sb.from("files").select("id, name, project_id, folder_id, file_versions(version_no)").eq("id", fileId).maybeSingle();
      if (existing) {
        // New revision of a drawing already filed in this building/stage
        const entry = index.find((e) => e.fileId === fileId);
        if (existing.project_id !== project.id || !entry) throw new Error("That drawing isn't in this part of the project");
        if (!entry.writable) throw new Error("Only that drawing's own discipline can revise it");
        const latest = Math.max(0, ...((existing.file_versions || []) as any[]).map((v) => v.version_no));
        if (ver !== latest + 1) throw new Error("Someone added a revision meanwhile — refresh and try again");
        const { error: vErr } = await sb.from("file_versions").insert({ file_id: fileId, project_id: project.id, version_no: ver, storage_path: path, size_bytes: Number(it.size) || null, uploaded_by: prof.id, is_archived: false });
        if (vErr) throw vErr;
        await sb.from("file_versions").update({ is_archived: true }).eq("file_id", fileId).lt("version_no", ver);   // kept as superseded, never deleted
        if (name !== existing.name) await sb.from("files").update({ name }).eq("id", fileId);
        done.push({ name, as: "revision", of: existing.name });
      } else {
        if (ver !== 1) throw new Error("Bad upload");
        const { error: fErr } = await sb.from("files").insert({ id: fileId, project_id: project.id, folder_id: folder.id, name, created_by: prof.id });
        if (fErr) throw fErr;
        const { error: vErr } = await sb.from("file_versions").insert({ file_id: fileId, project_id: project.id, version_no: 1, storage_path: path, size_bytes: Number(it.size) || null, uploaded_by: prof.id, is_archived: false });
        if (vErr) throw vErr;
        done.push({ name, as: "new" });
      }
    } catch (e) { failed.push({ name, message: (e as Error).message }); }
  }
  return json({ status: "ok", done, failed });
}
// For "ask": a separate-drawing option (new file) so the CRM can offer both
async function separate(sb: any, project: any, name: string) {
  const fileId = crypto.randomUUID();
  const path = pathFor(project.id, fileId, 1, name);
  const { data: sig } = await sb.storage.from("project-files").createSignedUploadUrl(path);
  return sig?.signedUrl ? { file_id: fileId, version_no: 1, path, upload_url: sig.signedUrl } : undefined;
}
