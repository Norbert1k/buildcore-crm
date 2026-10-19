// design-link — CRM side of the CRM ↔ Design portal link.
// Called from the CRM browser with the signed-in user's session
// (Enforce JWT verification ON). It confirms the caller is CCG staff, reads
// the project through the user's own permissions (so the division wall and
// RLS still apply), then asks the Design portal — server-to-server, with a
// shared secret the browser never sees.
//
//   { project_id, action: "resolve" }               → { linked, project? }        (crm-handoff)
//   { project_id, action: "handoff", embed: bool }  → { status, url? }            (crm-handoff)
//   { project_id, action: "list" }                  → { status, project, folders, files }   (crm-drawings)
//   { project_id, action: "file_url", file_id }     → { status, url, kind }       (crm-drawings)
//
// Read-only by construction: no writes to the CRM or the Design portal.
// Secrets (CRM project):
//   DESIGN_HANDOFF_URL, DESIGN_HANDOFF_SECRET      — existing
//   DESIGN_DRAWINGS_SECRET                          — new, same value as the Design project's CRM_DRAWINGS_SECRET
//   DESIGN_DRAWINGS_URL (optional)                  — defaults to the crm-handoff URL with crm-drawings in its place

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const DESIGN_URL = Deno.env.get("DESIGN_HANDOFF_URL");
    const DESIGN_SECRET = Deno.env.get("DESIGN_HANDOFF_SECRET");
    if (!DESIGN_URL || !DESIGN_SECRET) return json({ error: "Design link secrets not set" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supa.auth.getUser();
    if (!user?.email) return json({ error: "Not signed in" }, 401);

    const { data: staff, error: staffErr } = await supa.rpc("is_crm_staff");
    if (staffErr || staff !== true) return json({ error: "CRM staff only" }, 403);

    const { project_id, action, embed, file_id } = await req.json();
    const { data: project } = await supa.from("projects")
      .select("id, project_ref, design_code").eq("id", project_id).maybeSingle();
    if (!project) return json({ error: "Project not found" }, 404);

    const code = (project.design_code || project.project_ref || "").trim();

    // Drawing register (read-only) — the Design portal's crm-drawings function
    if (action === "list" || action === "file_url") {
      if (!code) return json({ status: "not_linked" });
      const secret = Deno.env.get("DESIGN_DRAWINGS_SECRET");
      if (!secret) return json({ status: "not_set_up" });   // CRM shows its previous Drawings view
      const url = Deno.env.get("DESIGN_DRAWINGS_URL") || DESIGN_URL.replace(/crm-handoff\/?$/, "crm-drawings");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-handoff-secret": secret },
        body: JSON.stringify(action === "list" ? { action, code } : { action, code, file_id: String(file_id || "") }),
      });
      let out: Record<string, unknown> = {};
      try { out = await res.json(); } catch { out = { status: "error", message: `Design portal returned ${res.status}` }; }
      return json({ ...out, code }, res.ok ? 200 : 502);
    }

    if (!code) return action === "resolve" ? json({ linked: false, code: "" }) : json({ status: "not_linked" });

    const res = await fetch(DESIGN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-handoff-secret": DESIGN_SECRET },
      body: JSON.stringify(action === "handoff"
        ? { action: "handoff", code, email: user.email, embed: !!embed }
        : { action: "resolve", code }),
    });
    const out = await res.json();
    return json({ ...out, code }, res.ok ? 200 : 502);
  } catch (err) {
    console.error("[design-link]", err);
    return json({ error: (err as Error).message }, 500);
  }
});
