// functions/xero-sync/index.ts
//
// Read-only link to Xero for the CRM robot. Pulls ACCPAY bills into
// xero_bills + xero_bill_lines, and hands the robot the supplier invoice
// attached to a bill so it can see what was bought for which job.
// Nothing is ever written to Xero.
//
// Modes (POST body):
//   { mode: 'full' }        — bills modified since the last successful sync
//                             (3 months back on the very first run)
//   { mode: 'test' }        — first page only, stores 1 raw payload, no data writes
//   { mode: 'status' }      — is Xero connected, when did it last sync
//   { mode: 'attachment', invoice_id } — the bill's supplier invoice (PDF/image
//                             bytes; x-file-name header), 404 when it has none
//
// Callers: a CRM admin (JWT), or the intake robot (service role key).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const PROJECT_REGEX = /Project expense for [^\n-]+ - (.+?)(?:\n|$)/m

const FIRST_SYNC_MONTHS_BACK = 3
const BILL_BATCH = 25
const LINE_BATCH = 100

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-file-name',
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...CORS_HEADERS,
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: JSON_HEADERS })

interface XeroConnection {
  id: string
  tenant_id: string
  tenant_name: string
  access_token: string
  refresh_token: string
  expires_at: string
  scopes: string
}

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getXeroConnection(supabase: SupabaseClient): Promise<XeroConnection | null> {
  const { data } = await supabase
    .from('xero_connections')
    .select('id, tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

async function refreshAccessToken(
  supabase: SupabaseClient,
  conn: XeroConnection,
): Promise<XeroConnection> {
  const clientId = Deno.env.get('XERO_CLIENT_ID')
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Missing XERO_CLIENT_ID or XERO_CLIENT_SECRET')
  const basic = btoa(`${clientId}:${clientSecret}`)
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
  })
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    await supabase.from('xero_connections')
      .update({ last_refresh_error: `${res.status}: ${text.slice(0, 400)}`, updated_at: new Date().toISOString() })
      .eq('id', conn.id)
    // An expired/revoked refresh token can only be fixed by connecting again
    if (/invalid_grant/i.test(text)) throw new Error('Xero needs connecting again (Inbox › Settings › Xero)')
    throw new Error(`Xero token refresh failed: ${res.status} ${text.slice(0, 300)}`)
  }
  const tokens = JSON.parse(text)
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()

  const { data: updated } = await supabase
    .from('xero_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes: tokens.scope,
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id)
    .eq('refresh_token', conn.refresh_token)
    .select('id, tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes')
    .maybeSingle()

  if (updated) return updated
  const fresh = await getXeroConnection(supabase)
  if (!fresh) throw new Error('Connection vanished after CAS-lost refresh')
  return fresh
}

async function xeroRaw(
  supabase: SupabaseClient,
  conn: XeroConnection,
  pathOrUrl: string,
  init?: RequestInit,
  accept = 'application/json',
): Promise<{ response: Response; conn: XeroConnection }> {
  let activeConn = conn
  if (new Date(activeConn.expires_at).getTime() < Date.now() + 60_000) {
    activeConn = await refreshAccessToken(supabase, activeConn)
  }
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${XERO_API_BASE}${pathOrUrl}`
  const doFetch = (token: string) => fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Authorization': `Bearer ${token}`,
      'Xero-Tenant-Id': activeConn.tenant_id,
      'Accept': accept,
    },
  })
  let res = await doFetch(activeConn.access_token)
  if (res.status === 401) {
    activeConn = await refreshAccessToken(supabase, activeConn)
    res = await doFetch(activeConn.access_token)
  }
  return { response: res, conn: activeConn }
}

async function xeroFetch(
  supabase: SupabaseClient,
  conn: XeroConnection,
  pathOrUrl: string,
  init?: RequestInit,
): Promise<{ response: Response; bodyText: string; conn: XeroConnection }> {
  const { response, conn: c } = await xeroRaw(supabase, conn, pathOrUrl, init)
  return { response, bodyText: await response.text(), conn: c }
}

function parseProjectName(description: string | null | undefined): string | null {
  if (!description) return null
  const m = PROJECT_REGEX.exec(description)
  if (!m) return null
  return m[1].trim()
}

async function loadMappingTable(supabase: SupabaseClient): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  const { data } = await supabase
    .from('xero_project_mapping')
    .select('xero_project_name, project_id')
  for (const row of (data || [])) {
    if (row.project_id) {
      m.set(row.xero_project_name.toLowerCase().trim(), row.project_id)
    }
  }
  return m
}

async function authorise(req: Request): Promise<{ userId: string | null; ok: boolean }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { userId: null, ok: false }
  const jwt = authHeader.replace('Bearer ', '')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (serviceKey && jwt === serviceKey) return { userId: null, ok: true }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, ok: false }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return { userId: user.id, ok: profile?.role === 'admin' }
}

async function fetchBills(
  supabase: SupabaseClient,
  conn: XeroConnection,
  since: Date,
  options: { onePageOnly?: boolean } = {},
): Promise<{ bills: any[]; finalConn: XeroConnection }> {
  const all: any[] = []
  let page = 1
  let activeConn = conn

  while (true) {
    const params = new URLSearchParams({
      where: 'Type=="ACCPAY"',
      page: String(page),
      order: 'UpdatedDateUTC ASC',
    })
    const ifModSince = since.toUTCString()
    const { response, bodyText, conn: newConn } = await xeroFetch(
      supabase, activeConn,
      `/Invoices?${params.toString()}`,
      { headers: { 'If-Modified-Since': ifModSince } },
    )
    activeConn = newConn
    if (response.status === 304) break
    if (!response.ok) {
      throw new Error(`Xero /Invoices failed: ${response.status} ${bodyText.slice(0, 300)}`)
    }
    const payload = JSON.parse(bodyText)
    const invoices = payload.Invoices || []
    all.push(...invoices)
    if (invoices.length < 100 || options.onePageOnly) break
    page++
    await new Promise(r => setTimeout(r, 200))
  }
  return { bills: all, finalConn: activeConn }
}

// Parse Xero date (handles both ISO and Microsoft "/Date(ms+offset)/" formats).
// Returns ISO timestamp string for timestamptz columns.
function parseXeroDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(raw)
  if (m) return new Date(parseInt(m[1], 10)).toISOString()
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

// Same as parseXeroDate but returns YYYY-MM-DD only (for date columns).
function parseXeroDateOnly(raw: string | null | undefined): string | null {
  const iso = parseXeroDate(raw)
  if (!iso) return null
  return iso.slice(0, 10)
}

function buildBillRow(bill: any) {
  return {
    xero_invoice_id:     bill.InvoiceID,
    invoice_number:      bill.InvoiceNumber || null,
    reference:           bill.Reference || null,
    contact_name:        bill.Contact?.Name || null,
    contact_id:          bill.Contact?.ContactID || null,
    status:              bill.Status,
    date:                parseXeroDateOnly(bill.DateString || bill.Date),
    due_date:            parseXeroDateOnly(bill.DueDateString || bill.DueDate),
    fully_paid_on_date:  parseXeroDateOnly(bill.FullyPaidOnDate),
    sub_total:           bill.SubTotal ?? null,
    total_tax:           bill.TotalTax ?? null,
    total:               bill.Total ?? null,
    amount_due:          bill.AmountDue ?? null,
    amount_paid:         bill.AmountPaid ?? null,
    currency_code:       bill.CurrencyCode || null,
    updated_date_utc:    parseXeroDate(bill.UpdatedDateUTC),
    raw_payload:         bill,
    synced_at:           new Date().toISOString(),
  }
}

function buildLineRows(bill: any, mappings: Map<string, string>): {
  rows: any[], matched: number, unmatched: number
} {
  const rows: any[] = []
  let matched = 0
  let unmatched = 0
  for (const line of (bill.LineItems || [])) {
    const description = line.Description || ''
    const parsedName = parseProjectName(description)
    let projectId: string | null = null
    if (parsedName) {
      const key = parsedName.toLowerCase().trim()
      projectId = mappings.get(key) ?? null
      if (projectId) matched++
      else unmatched++
    }
    rows.push({
      xero_invoice_id:     bill.InvoiceID,
      line_item_id:        line.LineItemID || null,
      description:         description,
      parsed_project_name: parsedName,
      project_id:          projectId,
      account_code:        line.AccountCode || null,
      account_name:        null,
      quantity:            line.Quantity ?? null,
      unit_amount:         line.UnitAmount ?? null,
      line_amount:         line.LineAmount ?? null,
      tax_amount:          line.TaxAmount ?? null,
      tracking_codes:      line.Tracking || null,
    })
  }
  return { rows, matched, unmatched }
}

async function batchUpsert(
  supabase: SupabaseClient,
  table: string,
  rows: any[],
  conflictCol: string,
  batchSize: number,
): Promise<number> {
  let upserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictCol })
    if (error) {
      throw new Error(`Upsert to ${table} failed at offset ${i}: ${error.message} (code: ${error.code})`)
    }
    upserted += chunk.length
  }
  return upserted
}

// The supplier invoice attached to a bill (first PDF, else first image)
async function attachment(supabase: SupabaseClient, invoiceId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json({ error: 'Bad invoice id' }, 400)
  const conn = await getXeroConnection(supabase)
  if (!conn) return json({ error: 'Xero is not connected' }, 409)
  const { response: lr, bodyText, conn: c2 } = await xeroFetch(supabase, conn, `/Invoices/${invoiceId}/Attachments`)
  if (!lr.ok) return json({ error: `Xero attachments ${lr.status}: ${bodyText.slice(0, 200)}` }, lr.status === 404 ? 404 : 502)
  const list = (JSON.parse(bodyText).Attachments || []) as any[]
  const pick = list.find(a => /pdf/i.test(a.MimeType || '') || /\.pdf$/i.test(a.FileName || ''))
    || list.find(a => /^image\//i.test(a.MimeType || ''))
  if (!pick) return json({ error: 'No invoice attached', files: list.map(a => a.FileName) }, 404)
  if (Number(pick.ContentLength || 0) > 25_000_000) return json({ error: 'Attachment too large' }, 413)
  const { response: fr } = await xeroRaw(supabase, c2, `/Invoices/${invoiceId}/Attachments/${pick.AttachmentID}`, undefined, pick.MimeType || 'application/octet-stream')
  if (!fr.ok) return json({ error: `Xero download ${fr.status}` }, 502)
  return new Response(await fr.arrayBuffer(), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': pick.MimeType || 'application/octet-stream', 'x-file-name': encodeURIComponent(pick.FileName || 'invoice.pdf') },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const { userId, ok } = await authorise(req)
  if (!ok) return json({ error: 'Unauthorized' }, 401)

  let mode: 'test' | 'full' | 'status' | 'attachment' = 'full'
  let body: any = {}
  try {
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}))
      if (['test', 'status', 'attachment'].includes(body.mode)) mode = body.mode
    }
  } catch { /* default full */ }

  const supabase = getServiceClient()

  if (mode === 'status') {
    const { data: c } = await supabase.from('xero_connections')
      .select('tenant_name, connected_at, last_refresh_at, last_refresh_error, scopes, updated_at')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const { data: last } = await supabase.from('xero_sync_log')
      .select('status, started_at, bills_fetched, error_message').eq('mode', 'full')
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    // A refresh token unused for 60 days is dead — Xero needs connecting again
    const lastUse = c?.last_refresh_at ? new Date(c.last_refresh_at).getTime() : 0
    const expired = !c || /invalid_grant/i.test(c.last_refresh_error || '') || Date.now() - lastUse > 59 * 864e5
    return json({
      connected: !!c && !expired,
      tenant: c?.tenant_name || null,
      // What the robot needs: bills + their attached invoices. (Xero keeps any
      // permissions granted earlier; this code only ever reads.)
      attachments: !!c && /accounting\.attachments/.test(c.scopes || ''),
      connected_at: c?.connected_at || null,
      last_sync: last || null,
    })
  }

  if (mode === 'attachment') {
    try { return await attachment(supabase, String(body.invoice_id || '')) }
    catch (err) { return json({ error: String((err as Error).message || err).slice(0, 300) }, 502) }
  }

  // Defensive cleanup: any stale "running" rows from previous timed-out runs.
  await supabase
    .from('xero_sync_log')
    .update({ status: 'error', error_message: 'Timed out or interrupted (auto-cleaned)', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

  const { data: logRow, error: logErr } = await supabase
    .from('xero_sync_log')
    .insert({ mode, status: 'running', triggered_by: userId })
    .select('id')
    .single()
  if (logErr || !logRow) return json({ error: 'Failed to create sync log row', detail: logErr }, 500)
  const logId = logRow.id

  const finish = async (patch: Record<string, any>) => {
    await supabase.from('xero_sync_log').update({
      finished_at: new Date().toISOString(),
      ...patch,
    }).eq('id', logId)
  }

  try {
    const conn = await getXeroConnection(supabase)
    if (!conn) {
      await finish({ status: 'error', error_message: 'No Xero connection. Connect first.' })
      return json({ error: 'No Xero connection' }, 400)
    }

    let since: Date
    if (mode === 'test') {
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    } else {
      const { data: lastSuccess } = await supabase
        .from('xero_sync_log')
        .select('started_at')
        .eq('mode', 'full')
        .eq('status', 'success')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastSuccess?.started_at) {
        since = new Date(lastSuccess.started_at)
        since.setMinutes(since.getMinutes() - 5)
      } else {
        since = new Date()
        since.setMonth(since.getMonth() - FIRST_SYNC_MONTHS_BACK)
      }
    }

    const { bills } = await fetchBills(supabase, conn, since, {
      onePageOnly: mode === 'test',
    })

    if (mode === 'test') {
      const sample = bills.length > 0 ? bills[0] : null
      await finish({
        status: 'success',
        bills_fetched: bills.length,
        payload_sample: sample,
      })
      return json({
        ok: true,
        mode: 'test',
        bills_fetched: bills.length,
        first_bill_id: sample?.InvoiceID,
        first_bill_number: sample?.InvoiceNumber,
        log_id: logId,
        message: bills.length === 0
          ? 'No bills modified in last 30 days. Try posting/editing a bill in Xero, then test again.'
          : 'Test sync complete. Check xero_sync_log for the payload_sample.',
      })
    }

    const mappings = await loadMappingTable(supabase)
    const billRows: any[] = []
    const lineRows: any[] = []
    let totalMatched = 0
    let totalUnmatched = 0
    for (const bill of bills) {
      billRows.push(buildBillRow(bill))
      const { rows, matched, unmatched } = buildLineRows(bill, mappings)
      lineRows.push(...rows)
      totalMatched += matched
      totalUnmatched += unmatched
    }

    const billsUpserted = await batchUpsert(supabase, 'xero_bills', billRows, 'xero_invoice_id', BILL_BATCH)
    const linesUpserted = await batchUpsert(supabase, 'xero_bill_lines', lineRows, 'xero_invoice_id,line_item_id', LINE_BATCH)

    await finish({
      status: 'success',
      bills_fetched: bills.length,
      bills_upserted: billsUpserted,
      lines_upserted: linesUpserted,
      lines_matched: totalMatched,
      lines_unmatched: totalUnmatched,
    })

    return json({
      ok: true,
      mode: 'full',
      bills_fetched: bills.length,
      bills_upserted: billsUpserted,
      lines_upserted: linesUpserted,
      lines_matched: totalMatched,
      lines_unmatched: totalUnmatched,
      log_id: logId,
    })

  } catch (err) {
    console.error('[xero-sync] error:', err)
    await finish({
      status: 'error',
      error_message: String(err).slice(0, 500),
    })
    return json({ error: String((err as Error).message || err).slice(0, 500), log_id: logId }, 500)
  }
})
