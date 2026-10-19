// crm-drawings — DESIGN PORTAL side (deploy in the Design Supabase project,
// wjeoirarobkpetogidwv, as a NEW function next to crm-handoff).
//
// Lets the BuildCore CRM show a job's drawing register read-only. Called only
// server-to-server by the CRM's `design-link` function with a shared secret;
// the browser never sees the secret.
//
//   { action: "list", code }              → { status, project, folders[], files[] }
//   { action: "file_url", code, file_id } → { status, url, kind, name }
//
// READ-ONLY: it only selects rows and signs short-lived download links.
// Nothing in the Design portal is created, changed or deleted.
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
  const n = last.startsWith("v") && /^v\d+_/.test(last) ? last.replace(/^v\d+_/, "").replace(/_/g, " ") : last;
  return n || fallback;
};

Deno.serve(async (req) => {
  try {
    const SECRET = Deno.env.get("CRM_DRAWINGS_SECRET");
    if (!SECRET) return json({ status: "error", message: "CRM_DRAWINGS_SECRET not set" }, 500);
    if (req.method !== "POST" || req.headers.get("x-handoff-secret") !== SECRET) return json({ status: "error", message: "Not allowed" }, 401);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { action, code, file_id } = await req.json();
    const clean = String(code || "").trim();
    if (!clean) return json({ status: "not_linked" });

    // Same job the CRM's link points at: Design project code = CRM ref / design code
    // Codes may be typed with or without "#", spaces or capitals ("#2026-006" = "2026-006")
    const norm = (v: string | null) => String(v || "").replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();
    const want = norm(clean);
    const { data: projects } = await sb.from("projects").select("id, name, code").not("code", "is", null);
    const project = (projects || []).find((p: any) => norm(p.code) === want);
    if (!project) return json({ status: "not_linked" });

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
      const { data: signed, error } = await sb.storage.from("project-files").createSignedUrl(path, 600);
      if (error) throw error;
      return json({ status: "ok", url: signed.signedUrl, kind: kindOf(name), name });
    }

    return json({ status: "error", message: "Unknown action" }, 400);
  } catch (err) {
    console.error("[crm-drawings]", err);
    return json({ status: "error", message: (err as Error).message }, 500);
  }
});
