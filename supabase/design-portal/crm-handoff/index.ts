// crm-handoff — called SERVER-TO-SERVER by the BuildCore CRM's `design-link`
// function, never by a browser. Protected by the HANDOFF_SECRET shared secret.
//
//   action "resolve"  { code }                → { linked, project? }
//   action "handoff"  { code, email, embed }  → { status, url? }
//
// handoff only works for people who ALREADY have a Design account with access
// to the project (CCG admin, or a project member). It never creates accounts,
// never adds members, and never writes project data — it only issues a
// short-lived, single-use sign-in token. Embedded links open in view-only mode.
//
// Deploy via Supabase dashboard (Design project) → Edge Functions →
// name "crm-handoff", Enforce JWT verification OFF. Secrets: HANDOFF_SECRET,
// optional DESIGN_APP_URL (default https://design.cltd.co.uk).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("HANDOFF_SECRET");
const APP_URL = (Deno.env.get("DESIGN_APP_URL") || "https://design.cltd.co.uk").replace(/\/$/, "");
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Same matching as crm-drawings: "#2026-006", "2026 - 006" and "2026-006" are one code
const norm = (s: string | null | undefined) => String(s ?? "").replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();

// Every Design project using this code — more than one means we must not guess
async function findProjects(code: string) {
  const want = norm(code);
  if (!want) return [];
  const { data } = await admin.from("projects").select("id, name, code").not("code", "is", null);
  return ((data ?? []) as { id: string; name: string; code: string }[]).filter((p) => norm(p.code) === want);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SECRET) return json({ error: "HANDOFF_SECRET not set" }, 500);
  if (req.headers.get("x-handoff-secret") !== SECRET) return json({ error: "Unauthorized" }, 401);

  try {
    const { action, code, email, embed } = await req.json();
    const found = await findProjects(code);
    if (found.length > 1) return json({ status: "ambiguous", linked: false, projects: found.map((p) => ({ name: p.name, code: p.code })) });
    const project = found[0] ?? null;

    if (action === "resolve") {
      return json(project ? { linked: true, project: { name: project.name, code: project.code } } : { linked: false });
    }

    if (action === "handoff") {
      if (!project) return json({ status: "not_linked" });
      const cleanEmail = String(email ?? "").trim().toLowerCase();
      if (!cleanEmail) return json({ status: "no_account" });

      // Exact match — "_" and "%" are wildcards in ilike, so escape them
      const { data: prof } = await admin.from("profiles").select("id, email, is_ccg_admin").ilike("email", cleanEmail.replace(/[\\%_]/g, (c) => "\\" + c)).maybeSingle();
      if (!prof || String(prof.email ?? "").toLowerCase() !== cleanEmail) return json({ status: "no_account" });

      let allowed = !!prof.is_ccg_admin;
      if (!allowed) {
        const { data: mem } = await admin.from("project_members").select("id").eq("project_id", project.id).eq("user_id", prof.id).maybeSingle();
        allowed = !!mem;
      }
      if (!allowed) return json({ status: "no_access" });

      const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: prof.email ?? cleanEmail });
      const tokenHash = (link as any)?.properties?.hashed_token;
      if (error || !tokenHash) return json({ status: "error", message: error?.message ?? "Could not create sign-in link" }, 500);

      const next = `/projects/${project.id}/documents`;
      const qs = new URLSearchParams({ token_hash: tokenHash, next });
      if (embed) qs.set("embed", "1");
      return json({ status: "ok", url: `${APP_URL}/handoff?${qs.toString()}` });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[crm-handoff]", err);
    return json({ error: (err as Error).message }, 500);
  }
});
