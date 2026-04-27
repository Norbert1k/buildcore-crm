import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

// ────────────────────────────────────────────────────────────────────────────
// send-portal-invite
//
// Sends a branded "you've been invited to the BuildCore portal" email via
// Resend, containing a single-use sign-in link generated through Supabase's
// admin API. The CRM "Invite user" button calls this AFTER it's already
// created the client_invitations + client_users rows.
//
// Required env vars:
//   RESEND_API_KEY
//   SUPABASE_URL                 (set automatically by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY    (set automatically by Supabase)
//   SUPABASE_ANON_KEY            (set automatically by Supabase)
//
// Auth: caller must be an authenticated CRM staff user. We verify this by
// checking their profile.role server-side using their JWT.
// ────────────────────────────────────────────────────────────────────────────

const PORTAL_URL = 'https://client.cltd.co.uk'
const PORTAL_REDIRECT = `${PORTAL_URL}/auth/callback`

// Roles allowed to send invites — mirrors auth.jsx's manage_users + admin shortcut.
const STAFF_ROLES = ['admin', 'project_manager', 'operations_manager']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InviteBody {
  email: string
  full_name?: string | null
  client_id: string
  inviter_name?: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured')
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      throw new Error('Supabase env vars missing')
    }

    // ── 1. Verify the caller is a staff user with invite permission ────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) throw new Error('Invalid session')

    const { data: profile } = await userClient
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || !STAFF_ROLES.includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'Not authorised to send invites' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 2. Parse + validate request ────────────────────────────────────────
    const body: InviteBody = await req.json()
    const email = body.email?.trim().toLowerCase()
    if (!email || !email.includes('@')) throw new Error('Valid email required')
    if (!body.client_id) throw new Error('client_id required')

    // ── 3. Service-role client for admin operations ────────────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Look up client info for the email template
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, name, brand_color, logo_url')
      .eq('id', body.client_id)
      .maybeSingle()
    if (clientErr || !client) throw new Error('Client not found')

    // ── 4. Generate a sign-in link via admin API ───────────────────────────
    // If the auth user already exists, use 'magiclink'. Otherwise 'invite'
    // creates the user and returns a one-time link.
    const { data: existing } = await admin.auth.admin.listUsers()
    const existingUser = existing?.users?.find(u => u.email?.toLowerCase() === email)

    let actionLink: string
    if (existingUser) {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: PORTAL_REDIRECT },
      })
      if (linkErr || !linkData?.properties?.action_link) {
        throw new Error(linkErr?.message || 'Could not generate sign-in link')
      }
      actionLink = linkData.properties.action_link
    } else {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: PORTAL_REDIRECT },
      })
      if (linkErr || !linkData?.properties?.action_link) {
        throw new Error(linkErr?.message || 'Could not generate invite link')
      }
      actionLink = linkData.properties.action_link
    }

    // ── 5. Build branded HTML email ────────────────────────────────────────
    const brandColor = client.brand_color || '#448a40'
    const inviterName = body.inviter_name || profile.full_name || 'Your project team'
    const recipientName = body.full_name || email.split('@')[0]
    const clientName = client.name

    // Initials tile for clients without a logo
    const initials = clientName.split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w: string) => w[0]?.toUpperCase()).join('')

    const logoBlock = client.logo_url
      ? `<img src="${client.logo_url}" alt="" style="height:48px;width:48px;border-radius:10px;object-fit:cover;display:block;" />`
      : `<div style="height:48px;width:48px;border-radius:10px;background:${brandColor};color:white;display:inline-block;text-align:center;line-height:48px;font-weight:600;font-size:18px;font-family:'Helvetica Neue',Arial,sans-serif;">${initials}</div>`

    const subject = `You've been invited to the ${clientName} client portal`

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e0d8;">

  <!-- Header -->
  <tr><td style="background:#1a2e1a;padding:20px 32px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">
        <img src="https://crm.cltd.co.uk/logo.png" alt="City Construction" style="height:44px;width:auto;display:block;" />
      </td>
      <td style="padding-left:14px;border-left:1px solid rgba(255,255,255,0.2);">
        <div style="color:white;font-weight:600;font-size:16px;padding-left:14px;">City Construction Group</div>
        <div style="color:rgba(255,255,255,0.65);font-size:12px;padding-left:14px;">Client portal invitation</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Brand banner with client logo -->
  <tr><td style="padding:24px 32px 8px;text-align:center;">
    ${logoBlock}
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:8px 32px 28px;">
    <h1 style="font-size:20px;font-weight:600;color:#1c1b18;margin:0 0 8px;text-align:center;">
      You've been invited to the ${clientName} portal
    </h1>
    <p style="font-size:14px;color:#5c5a54;margin:0 0 24px;line-height:1.7;text-align:center;">
      Hi ${recipientName},<br/>
      ${inviterName} at City Construction Group has invited you to access live updates,
      photos, programmes and documents for your project.
    </p>

    <!-- CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td align="center">
        <a href="${actionLink}" style="display:inline-block;background:${brandColor};color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;">
          Open the portal
        </a>
      </td></tr>
    </table>

    <!-- What's inside -->
    <div style="background:#f5f4f0;border-radius:8px;padding:18px 22px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:600;color:#9c9a94;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">What's inside</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#1c1b18;">
        <tr><td style="padding:4px 0;">📊 Live project status &amp; progress</td></tr>
        <tr><td style="padding:4px 0;">📅 The latest construction programme</td></tr>
        <tr><td style="padding:4px 0;">📷 Site photos as they come in</td></tr>
        <tr><td style="padding:4px 0;">📄 Drawings, reports &amp; key documents</td></tr>
      </table>
    </div>

    <p style="font-size:12px;color:#9c9a94;margin:0 0 4px;line-height:1.6;">
      The button above is a single-use sign-in link. If it doesn't work, you can
      paste this URL into your browser:
    </p>
    <p style="font-size:11px;color:#5c5a54;margin:0 0 16px;word-break:break-all;">
      <a href="${actionLink}" style="color:${brandColor};text-decoration:underline;">${actionLink}</a>
    </p>

    <p style="font-size:12px;color:#9c9a94;margin:0;line-height:1.6;">
      Future sign-ins use the same email — just visit
      <a href="${PORTAL_URL}" style="color:${brandColor};">${PORTAL_URL.replace('https://', '')}</a>
      and we'll email you a fresh link.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f5f4f0;border-top:1px solid #e2e0d8;padding:14px 32px;font-size:11px;color:#9c9a94;line-height:1.6;text-align:center;">
    Sent by City Construction Group · cltd.co.uk<br/>
    If you weren't expecting this invite, you can safely ignore this email.
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

    // ── 6. Send via Resend ─────────────────────────────────────────────────
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'City Construction <noreply@cltd.co.uk>',
        to: [email],
        subject,
        html,
      }),
    })

    const resendData = await resendRes.json()
    if (!resendRes.ok) {
      throw new Error(resendData?.message || 'Email send failed')
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
