// functions/xero-oauth-start/index.ts
//
// Entry point of the Xero OAuth dance. Self-contained — the shared
// helpers are inlined below rather than imported from _shared/ because
// the Supabase dashboard's edge function bundler doesn't reliably
// resolve sibling-folder imports.
//
// Generates a signed state token and builds the Xero authorisation URL.
//   • POST with Authorization: Bearer <jwt>  → { url }   (the CRM opens it)
//   • GET  ?jwt=…                             → 302 to Xero (older popup flow)
//
// READ-ONLY: the CRM robot only reads bills and the supplier invoices
// attached to them. It can't create or change anything in Xero.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const REDIRECT_URI = 'https://tjelbvoeciklpfvapxvn.supabase.co/functions/v1/xero-oauth-callback'

const SCOPES = [
  'offline_access',
  'accounting.invoices.read',
  'accounting.attachments.read',
  'accounting.contacts.read',
].join(' ')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// ─── Inlined: signState (from _shared/xero-client.ts) ────────────────────
async function signState(payload: object): Promise<string> {
  const secret = Deno.env.get('XERO_OAUTH_STATE_SECRET')
  if (!secret) throw new Error('Missing XERO_OAUTH_STATE_SECRET')
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(payload))
  const keyBytes = encoder.encode(secret)
  const key = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const b64 = (buf: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64(data)}.${b64(sig)}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const asJson = req.method === 'POST'
  const fail = (msg: string, status: number) => asJson
    ? new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    : new Response(msg, { status })
  try {
    const url = new URL(req.url)
    let body: any = {}
    if (asJson) body = await req.json().catch(() => ({}))

    // Caller must be a CRM admin
    const authHeader = req.headers.get('Authorization')
    const queryJwt = url.searchParams.get('jwt')
    const jwt = authHeader
      ? authHeader.replace('Bearer ', '')
      : (queryJwt || null)
    if (!jwt) return fail('Unauthorized — JWT missing', 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    )

    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) return fail('Unauthorized — invalid JWT', 401)

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profErr || profile?.role !== 'admin') return fail('Only an admin can connect Xero', 403)

    // Signed state, valid 10 minutes
    const returnTo = String(body.return_to || url.searchParams.get('return_to') || 'https://crm.cltd.co.uk/inbox')
    const state = await signState({
      nonce: crypto.randomUUID(),
      user_id: user.id,
      return_to: returnTo,
      expires: Date.now() + 10 * 60 * 1000,
    })

    const clientId = Deno.env.get('XERO_CLIENT_ID')
    if (!clientId) return fail('Server misconfigured: XERO_CLIENT_ID missing', 500)

    const authUrl = new URL('https://login.xero.com/identity/connect/authorize')
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)

    if (asJson) return new Response(JSON.stringify({ url: authUrl.toString() }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
    return Response.redirect(authUrl.toString(), 302)
  } catch (err) {
    console.error('[xero-oauth-start] error:', err)
    return fail(`Server error: ${String(err).slice(0, 200)}`, 500)
  }
})
