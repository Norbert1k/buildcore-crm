import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

// ────────────────────────────────────────────────────────────────────────────
// delete-user
//
// Two modes, controlled by `mode` in the request body:
//
//   mode='profile' — Hard delete a CRM user. Removes the auth.users row,
//     which cascade-deletes profiles → user_project_access → other FK
//     dependents. Also deletes any client_users rows where user_id matches
//     (no FK on that table).
//
//   mode='client_user' — Revoke portal access for a portal-only user.
//     Deletes the specified client_users row only. Does NOT touch
//     auth.users since that auth user might still be needed for other
//     portal memberships.
//
// Required env vars (auto-set by Supabase):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY
//
// Auth: caller must be an authenticated CRM admin. We verify this by
// checking their profile.role server-side using their JWT.
//
// Guards:
//   - Caller cannot delete themselves
//   - Cannot delete the last admin in the system
//
// All deletes are irreversible. Caller is expected to confirm in the UI.
// ────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteBody {
  // 'profile' = hard-delete a CRM staff user (auth + DB cascade).
  // 'client_user' = revoke portal access (DELETE client_users row only).
  mode: 'profile' | 'client_user'
  // For 'profile' mode: the auth.users.id (= profiles.id) of the user to delete.
  // For 'client_user' mode: the client_users.id row to delete.
  target_id: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      throw new Error('Supabase env vars missing')
    }

    // Verify caller is authenticated and is an admin. We use the caller's
    // JWT here — NOT the service role — so RLS is enforced.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const callerSupabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerErr } = await callerSupabase.auth.getUser()
    if (callerErr || !caller) throw new Error('Invalid session')

    // Service-role client for the actual delete operations.
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: callerProfile } = await adminSupabase
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle()
    if (!callerProfile || callerProfile.role !== 'admin') {
      throw new Error('Only admins can delete users')
    }

    const body: DeleteBody = await req.json()
    if (!body?.mode || !body?.target_id) {
      throw new Error('Missing mode or target_id')
    }

    if (body.mode === 'client_user') {
      // ── Mode 1: revoke portal access (delete client_users row only) ──
      //
      // Confirm the row exists and look up the client_id for the response
      // payload (so the UI can show "Removed Eamon from Bloom Building
      // Consultancy portal").
      const { data: target } = await adminSupabase
        .from('client_users')
        .select('id, email, client_id')
        .eq('id', body.target_id)
        .maybeSingle()
      if (!target) {
        throw new Error('Client user not found')
      }

      const { error: delErr } = await adminSupabase
        .from('client_users')
        .delete()
        .eq('id', body.target_id)
      if (delErr) throw new Error(`Failed to remove access: ${delErr.message}`)

      return new Response(
        JSON.stringify({ ok: true, mode: 'client_user', email: target.email }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (body.mode === 'profile') {
      // ── Mode 2: hard-delete a CRM user ──
      //
      // Look up the target's profile to enforce guards.
      const { data: target } = await adminSupabase
        .from('profiles')
        .select('id, email, role, full_name')
        .eq('id', body.target_id)
        .maybeSingle()
      if (!target) {
        throw new Error('User not found')
      }

      // Guard 1 — caller can't delete themselves.
      if (target.id === caller.id) {
        throw new Error("You can't delete your own account")
      }

      // Guard 2 — can't delete the last admin. Otherwise the system
      // becomes un-administrable.
      if (target.role === 'admin') {
        const { count } = await adminSupabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
        if ((count ?? 0) <= 1) {
          throw new Error('Cannot delete the last admin')
        }
      }

      // Defensive guard — `target` came from a successful maybeSingle()
      // lookup so target.id should be present, but be explicit so any
      // upstream issue surfaces with a clear message rather than the
      // cryptic 'userId required' from GoTrue.
      if (!target.id) {
        throw new Error('Internal error: profile row has no id')
      }

      // Delete from auth.users via direct REST call to the GoTrue admin
      // endpoint. We tried adminSupabase.auth.admin.deleteUser(id) and
      // .deleteUser(id, false) — both rejected by GoTrue with "userId
      // required" despite passing valid UUIDs. Most likely a version
      // mismatch between supabase-js 2.39.7 and the deployed GoTrue
      // version on this project. Bypassing the SDK with raw fetch is
      // safer + matches what the SDK does internally anyway.
      //
      // On success, this cascades via FK:
      //   auth.users → profiles (ON DELETE CASCADE)
      //   profiles → user_project_access, performance, notifications, etc.
      const deleteUrl = `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(target.id)}`
      const deleteResp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey': SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
      })
      if (!deleteResp.ok) {
        // Try to extract GoTrue's error body for a clear message.
        let detail = `HTTP ${deleteResp.status}`
        try {
          const body = await deleteResp.json()
          detail = body?.msg || body?.error_description || body?.error || detail
        } catch { /* keep status */ }
        throw new Error(`Failed to delete auth user: ${detail}`)
      }

      // client_users.user_id has no FK to auth.users (it's plain uuid),
      // so we clean up manually. Rows might be 0 or many depending on
      // how many portals this user has access to.
      await adminSupabase
        .from('client_users')
        .delete()
        .eq('user_id', target.id)

      return new Response(
        JSON.stringify({
          ok: true,
          mode: 'profile',
          email: target.email,
          full_name: target.full_name,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    throw new Error(`Unknown mode: ${body.mode}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
