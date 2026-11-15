// functions/xero-oauth-callback/index.ts
//
// Callback endpoint of the Xero OAuth dance. Xero redirects here after the
// user approves the consent screen, with ?code=...&state=... in the query.
//
// Self-contained — shared helpers inlined.
//
// Steps:
//   1. Verify the signed state token (CSRF + replay protection)
//   2. Exchange the auth code for access + refresh tokens
//   3. Fetch the list of authorised tenants
//   4. Upsert into xero_connections
//   5. Redirect back to the CRM with ?xero=ok|error&msg=… — the CRM shows the
//      result (and closes the sign-in window). Supabase serves HTML from
//      functions as plain text, so no page is rendered here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const REDIRECT_URI = 'https://tjelbvoeciklpfvapxvn.supabase.co/functions/v1/xero-oauth-callback'
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'
const CRM = 'https://crm.cltd.co.uk'

// ─── Inlined: verifyState (from _shared/xero-client.ts) ──────────────────
async function verifyState(token: string): Promise<any | null> {
  try {
    const secret = Deno.env.get('XERO_OAUTH_STATE_SECRET')
    if (!secret) return null
    const [b64payload, b64sig] = token.split('.')
    if (!b64payload || !b64sig) return null
    const b64decode = (s: string) =>
      Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const payloadBytes = b64decode(b64payload)
    const sigBytes = b64decode(b64sig)
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify'],
    )
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes)
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes))
    if (typeof payload.expires === 'number' && Date.now() > payload.expires) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Back to the CRM page that started it (only ever the CRM itself)
function renderResult(success: boolean, message: string, returnTo: string = '/inbox'): Response {
  let target: URL
  try {
    target = new URL(returnTo, CRM)
    if (target.origin !== CRM) target = new URL('/inbox', CRM)
  } catch { target = new URL('/inbox', CRM) }
  target.searchParams.set('xero', success ? 'ok' : 'error')
  target.searchParams.set('msg', message.slice(0, 300))
  return new Response(null, { status: 302, headers: { Location: target.toString() } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')
  const errorDescParam = url.searchParams.get('error_description')

  if (errorParam) {
    return renderResult(false, `Xero returned an error: ${errorParam} — ${errorDescParam || ''}`)
  }
  if (!code || !state) {
    return renderResult(false, 'Missing code or state. The OAuth flow was not completed.')
  }

  const statePayload = await verifyState(state)
  if (!statePayload) {
    return renderResult(false, 'Invalid or expired state. Please start the connection again.')
  }
  const returnTo = statePayload.return_to || '/inbox'

  try {
    // ── Step 1: Exchange code for tokens ────────────────────────────────
    const clientId = Deno.env.get('XERO_CLIENT_ID')
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      return renderResult(false, 'Server misconfigured: Xero credentials missing.', returnTo)
    }
    const basic = btoa(`${clientId}:${clientSecret}`)
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    })

    const tokenRes = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    })
    const tokenText = await tokenRes.text()
    if (!tokenRes.ok) {
      console.error('[xero-oauth-callback] token exchange failed:', tokenRes.status, tokenText)
      return renderResult(false, `Token exchange failed: ${tokenRes.status}. ${tokenText.slice(0, 200)}`, returnTo)
    }
    const tokens = JSON.parse(tokenText) as {
      access_token: string
      refresh_token: string
      expires_in: number
      scope: string
    }

    // ── Step 2: Fetch tenants ─────────────────────────────────────────────
    const connRes = await fetch(XERO_CONNECTIONS_URL, {
      headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Accept': 'application/json' },
    })
    const connText = await connRes.text()
    if (!connRes.ok) {
      console.error('[xero-oauth-callback] /connections failed:', connRes.status, connText)
      return renderResult(false, `Failed to fetch Xero tenants: ${connRes.status}.`, returnTo)
    }
    const tenants = JSON.parse(connText) as Array<{
      id: string
      tenantId: string
      tenantName: string
      tenantType: string
    }>
    if (!tenants.length) {
      return renderResult(false, 'No Xero organisations were authorised. Did you select an org?', returnTo)
    }
    const tenant = tenants[0]

    // ── Step 3: Upsert into xero_connections ─────────────────────────────
    const supabase = getServiceClient()
    const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()

    const { error: upsertErr } = await supabase
      .from('xero_connections')
      .upsert({
        tenant_id: tenant.tenantId,
        tenant_name: tenant.tenantName,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes: tokens.scope,
        connected_by: statePayload.user_id,
        connected_at: new Date().toISOString(),
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' })

    if (upsertErr) {
      console.error('[xero-oauth-callback] upsert failed:', upsertErr)
      return renderResult(false, `Failed to save connection: ${upsertErr.message}`, returnTo)
    }

    return renderResult(true, `Connected to ${tenant.tenantName} (read-only).`, returnTo)
  } catch (err) {
    console.error('[xero-oauth-callback] unexpected error:', err)
    return renderResult(false, `Unexpected error: ${String(err).slice(0, 300)}`, returnTo)
  }
})
