// supabase/functions/check-insurance-expiry/index.ts
//
// Daily document-expiry alert function. Runs against ALL documents
// with an `expiry_date` (not just insurances), checks 4 thresholds
// (30/14/7/0 days), and emails:
//   - Internal team (admin/PM/Operations Manager/Accountant)
//   - The subcontractor: main email + primary contact + any contact
//     whose job_title suggests compliance/admin/director responsibility
//
// Deduplication: each (document, threshold) pair fires at most once
// via the document_alert_log table.
//
// Deploy: `supabase functions deploy check-insurance-expiry`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const THRESHOLDS = [30, 14, 7, 0]  // days remaining when alerts fire

// Friendly labels — fall back to title-case for unknown types
const TYPE_LABELS: Record<string, string> = {
  public_liability: 'Public Liability Insurance',
  employers_liability: "Employer's Liability Insurance",
  professional_indemnity: 'Professional Indemnity Insurance',
  rams: 'RAMS',
  method_statement: 'Method Statement',
  risk_assessment: 'Risk Assessment',
  cscs_card: 'CSCS Card',
  gas_safe: 'Gas Safe Certificate',
  niceic: 'NICEIC Certificate',
  chas: 'CHAS Accreditation',
  constructionline: 'Constructionline',
  iso_9001: 'ISO 9001',
  iso_14001: 'ISO 14001',
  iso_45001: 'ISO 45001',
  f10_notification: 'F10 Notification',
  trade_certificate: 'Trade Certificate',
  other: 'Document',
}

const COMPLIANCE_KEYWORDS = ['compliance', 'admin', 'director', 'office', 'health', 'safety', 'hr', 'qa', 'qhse']

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const labelFor = (t: string) => TYPE_LABELS[t] || titleCase(t)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    // Look at any doc expiring within the next 31 days OR already expired up to 1 day ago
    const horizon = new Date(now); horizon.setDate(horizon.getDate() + 31)
    const horizonStr = horizon.toISOString().split('T')[0]
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Pull every document with an expiry_date in window
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select(`
        id, document_name, document_type, expiry_date, subcontractor_id,
        subcontractors(id, company_name, email)
      `)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', yesterdayStr)
      .lte('expiry_date', horizonStr)

    if (docsErr) throw docsErr
    if (!docs || docs.length === 0) {
      return jsonResp({ success: true, message: 'No documents in alert window', processed: 0 })
    }

    // Internal users to notify
    const { data: internalUsers } = await supabase
      .from('profiles').select('id, full_name, email, role')
      .in('role', ['admin', 'project_manager', 'operations_manager', 'accountant'])

    // For each doc, determine which threshold (if any) it falls into
    let totalEmailsSent = 0
    let totalAlertsLogged = 0
    let totalNotifsCreated = 0
    const skipped: string[] = []

    for (const doc of docs) {
      const expiry = new Date(doc.expiry_date as unknown as string)
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86400000)

      // Find the closest threshold this doc has crossed (i.e. daysLeft <= threshold)
      // We fire ONLY for the smallest threshold >= daysLeft that hasn't fired yet
      // e.g. daysLeft=8 → fires 14-day alert (if not already)
      //      daysLeft=5 → fires 7-day alert
      //      daysLeft=0 → fires 0-day alert
      const matchingThreshold = THRESHOLDS.find(t => daysLeft <= t)
      if (matchingThreshold === undefined) { skipped.push(`${doc.id}: outside thresholds (${daysLeft}d)`); continue }

      // Has this (doc, threshold) already fired? If yes, skip
      const { data: existing } = await supabase
        .from('document_alert_log')
        .select('id')
        .eq('document_id', doc.id)
        .eq('threshold_days', matchingThreshold)
        .maybeSingle()
      if (existing) { skipped.push(`${doc.id}: ${matchingThreshold}d already fired`); continue }

      const subId = doc.subcontractor_id as string
      const subName = (doc.subcontractors as any)?.company_name || 'Unknown'
      const subMainEmail = (doc.subcontractors as any)?.email
      const docType = labelFor(doc.document_type as string)
      const expiryFormatted = expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      const isExpired = daysLeft < 0
      const stage = isExpired ? 'EXPIRED' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`

      // ─── 1. In-CRM notifications for internal team ───
      for (const u of (internalUsers || [])) {
        await supabase.from('notifications').insert({
          user_id: u.id,
          title: `${labelFor(doc.document_type as string)} ${isExpired ? 'EXPIRED' : 'expiring'} — ${subName}`,
          message: `${docType} ${isExpired ? `expired on ${expiryFormatted}` : `expires on ${expiryFormatted} (${stage})`}.`,
          type: matchingThreshold <= 7 ? 'danger' : 'warning',
          link: `/subcontractors/${subId}`,
        })
        totalNotifsCreated++
      }

      // ─── 2. Internal team emails ───
      const internalSubject = `${matchingThreshold === 0 ? '🔴' : (matchingThreshold <= 7 ? '⚠️' : '📄')} ${docType} ${isExpired ? 'EXPIRED' : `(${stage})`} — ${subName}`
      for (const u of (internalUsers || [])) {
        if (!u.email) continue
        const html = renderInternalEmail({
          recipientName: u.full_name || 'Team',
          subName, docType, expiryFormatted, daysLeft, threshold: matchingThreshold, subId, isExpired,
        })
        if (await sendEmail(RESEND_API_KEY, u.email, internalSubject, html)) totalEmailsSent++
      }

      // ─── 3. Subcontractor emails ───
      // Gather all relevant sub emails (main + primary contact + compliance contacts)
      const recipients = new Set<string>()
      if (subMainEmail) recipients.add(subMainEmail.trim().toLowerCase())

      const { data: contacts } = await supabase.from('subcontractor_contacts')
        .select('full_name, email, job_title, is_primary')
        .eq('subcontractor_id', subId)

      for (const c of (contacts || [])) {
        if (!c.email) continue
        const jt = (c.job_title || '').toLowerCase()
        const isCompliance = COMPLIANCE_KEYWORDS.some(k => jt.includes(k))
        if (c.is_primary || isCompliance) recipients.add(c.email.trim().toLowerCase())
      }

      const subSubject = `${matchingThreshold === 0 ? '🔴 URGENT' : (matchingThreshold <= 7 ? '⚠️ Action Required' : 'Reminder')}: ${docType} ${isExpired ? 'has expired' : `expires in ${stage}`}`
      for (const email of recipients) {
        const html = renderSubcontractorEmail({
          subName, docType, expiryFormatted, daysLeft, threshold: matchingThreshold, isExpired,
        })
        if (await sendEmail(RESEND_API_KEY, email, subSubject, html)) totalEmailsSent++
      }

      // ─── 4. Log this alert to prevent re-firing ───
      await supabase.from('document_alert_log').insert({
        document_id: doc.id,
        threshold_days: matchingThreshold,
        emails_sent: (internalUsers?.length || 0) + recipients.size,
      })
      totalAlertsLogged++
    }

    return jsonResp({
      success: true,
      processed: docs.length,
      alertsLogged: totalAlertsLogged,
      emailsSent: totalEmailsSent,
      notifsCreated: totalNotifsCreated,
      skipped: skipped.length,
    })

  } catch (error) {
    console.error('[check-insurance-expiry]', error)
    return jsonResp({ error: (error as Error).message }, 400)
  }
})

// ───────── helpers ─────────

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendEmail(apiKey: string, to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'City Construction <noreply@cltd.co.uk>',
        to: [to],
        subject,
        html,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`Email to ${to} failed: ${res.status} ${err}`)
      return false
    }
    return true
  } catch (e) {
    console.error(`Email to ${to} threw:`, e)
    return false
  }
}

interface InternalEmailParams {
  recipientName: string
  subName: string
  docType: string
  expiryFormatted: string
  daysLeft: number
  threshold: number
  subId: string
  isExpired: boolean
}

function renderInternalEmail(p: InternalEmailParams): string {
  const banner = p.isExpired ? '#A32D2D' : (p.threshold === 0 ? '#A32D2D' : (p.threshold <= 7 ? '#BA7517' : '#BA7517'))
  const bannerBg = p.isExpired ? '#FAEEEE' : (p.threshold === 0 ? '#FAEEEE' : '#FAEEDA')
  const status = p.isExpired ? 'has EXPIRED' : (p.threshold === 0 ? 'expires TODAY' : `expires in ${p.daysLeft} day${p.daysLeft !== 1 ? 's' : ''}`)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e0d8;">
<tr><td style="background:#1a2e1a;padding:20px 32px;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td><img src="https://crm.cltd.co.uk/logo.png" alt="City Construction" style="height:44px;width:auto;display:block;" /></td>
    <td style="padding-left:14px;border-left:1px solid rgba(255,255,255,0.2);">
      <div style="color:white;font-weight:600;font-size:16px;padding-left:14px;">City Construction Group</div>
      <div style="color:rgba(255,255,255,0.65);font-size:12px;padding-left:14px;">Document Expiry Notification</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="background:${bannerBg};border-bottom:2px solid ${banner};padding:16px 32px;">
  <div style="font-weight:600;font-size:15px;color:${banner};">${p.isExpired ? '🔴 Document Expired' : (p.threshold === 0 ? '🔴 Expires Today' : (p.threshold <= 7 ? '⚠️ Urgent' : '📄 Heads-up'))}</div>
  <div style="font-size:12px;color:#5c5a54;margin-top:2px;">${p.docType} for ${p.subName} ${status}</div>
</td></tr>
<tr><td style="padding:28px 32px;">
  <p style="font-size:14px;color:#1c1b18;margin:0 0 16px;">Hi <strong>${p.recipientName}</strong>,</p>
  <p style="font-size:14px;color:#5c5a54;margin:0 0 20px;line-height:1.7;">
    The following document ${p.isExpired ? 'has expired' : 'is approaching expiry'}. The subcontractor has been notified directly via email.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;border-radius:8px;border:1px solid #e2e0d8;margin-bottom:20px;">
    <tr><td style="padding:16px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:5px 0;color:#9c9a94;width:140px;">Subcontractor</td><td style="padding:5px 0;font-weight:600;color:#1c1b18;">${p.subName}</td></tr>
        <tr><td style="padding:5px 0;color:#9c9a94;">Document</td><td style="padding:5px 0;font-weight:500;color:#1c1b18;">${p.docType}</td></tr>
        <tr><td style="padding:5px 0;color:#9c9a94;">Expiry Date</td><td style="padding:5px 0;font-weight:600;color:${banner};">${p.expiryFormatted}</td></tr>
        <tr><td style="padding:5px 0;color:#9c9a94;">Status</td><td style="padding:5px 0;font-weight:700;color:${banner};">${status}</td></tr>
      </table>
    </td></tr>
  </table>
  <p style="font-size:14px;color:#5c5a54;margin:0 0 4px;line-height:1.7;">
    <a href="https://crm.cltd.co.uk/subcontractors/${p.subId}" style="color:#448a40;font-weight:600;">View in CRM →</a>
  </p>
  <p style="font-size:14px;color:#5c5a54;margin:16px 0 0;line-height:1.7;">Regards,<br><strong style="color:#1c1b18;">City Construction CRM</strong></p>
</td></tr>
<tr><td style="background:#f5f4f0;border-top:1px solid #e2e0d8;padding:14px 32px;font-size:11px;color:#9c9a94;line-height:1.6;">
  Automated notification · ${p.threshold === 0 ? 'Final reminder' : `${p.threshold}-day reminder`}<br>
  Sent from: noreply@cltd.co.uk
</td></tr>
</table></td></tr></table></body></html>`
}

interface SubEmailParams {
  subName: string
  docType: string
  expiryFormatted: string
  daysLeft: number
  threshold: number
  isExpired: boolean
}

function renderSubcontractorEmail(p: SubEmailParams): string {
  const banner = p.isExpired ? '#A32D2D' : (p.threshold === 0 ? '#A32D2D' : (p.threshold <= 7 ? '#BA7517' : '#448a40'))
  const bannerBg = p.isExpired ? '#FAEEEE' : (p.threshold === 0 ? '#FAEEEE' : (p.threshold <= 7 ? '#FAEEDA' : '#EAF3DE'))
  const headline = p.isExpired ? 'Your document has expired' : (p.threshold === 0 ? 'Your document expires today' : `Your document expires in ${p.daysLeft} day${p.daysLeft !== 1 ? 's' : ''}`)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e0d8;">
<tr><td style="background:#1a2e1a;padding:20px 32px;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td><img src="https://crm.cltd.co.uk/logo.png" alt="City Construction" style="height:44px;width:auto;display:block;" /></td>
    <td style="padding-left:14px;border-left:1px solid rgba(255,255,255,0.2);">
      <div style="color:white;font-weight:600;font-size:16px;padding-left:14px;">City Construction Group</div>
      <div style="color:rgba(255,255,255,0.65);font-size:12px;padding-left:14px;">Document Renewal Reminder</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="background:${bannerBg};border-bottom:2px solid ${banner};padding:16px 32px;">
  <div style="font-weight:600;font-size:15px;color:${banner};">${headline}</div>
  <div style="font-size:12px;color:#5c5a54;margin-top:2px;">Action required to remain compliant on our projects.</div>
</td></tr>
<tr><td style="padding:28px 32px;">
  <p style="font-size:14px;color:#1c1b18;margin:0 0 16px;">Hi <strong>${p.subName}</strong>,</p>
  <p style="font-size:14px;color:#5c5a54;margin:0 0 20px;line-height:1.7;">
    Our records show that your <strong>${p.docType}</strong> ${p.isExpired ? `expired on ${p.expiryFormatted}` : `is due to expire on ${p.expiryFormatted}`}.
    ${p.isExpired
      ? `As this document has now expired, you may not be able to start new work on our projects until an updated copy is provided.`
      : (p.threshold === 0 ? `Please send us an updated copy <strong>today</strong> to avoid disruption to your work on our projects.` :
         (p.threshold <= 7 ? `Please send an updated copy as soon as possible to avoid any impact on your work with us.` :
                              `Please arrange a renewal in good time and send us an updated copy when available.`))}
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;border-radius:8px;border:1px solid #e2e0d8;margin-bottom:20px;">
    <tr><td style="padding:16px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:5px 0;color:#9c9a94;width:140px;">Document</td><td style="padding:5px 0;font-weight:600;color:#1c1b18;">${p.docType}</td></tr>
        <tr><td style="padding:5px 0;color:#9c9a94;">Expiry Date</td><td style="padding:5px 0;font-weight:600;color:${banner};">${p.expiryFormatted}</td></tr>
      </table>
    </td></tr>
  </table>
  <p style="font-size:14px;color:#5c5a54;margin:0 0 4px;line-height:1.7;">
    Please reply to this email or send the renewed certificate to <a href="mailto:info@cltd.co.uk" style="color:#448a40;font-weight:600;">info@cltd.co.uk</a>.
  </p>
  <p style="font-size:14px;color:#5c5a54;margin:16px 0 0;line-height:1.7;">
    Many thanks,<br><strong style="color:#1c1b18;">City Construction Group</strong>
  </p>
</td></tr>
<tr><td style="background:#f5f4f0;border-top:1px solid #e2e0d8;padding:14px 32px;font-size:11px;color:#9c9a94;line-height:1.6;">
  This is an automated reminder. If you have already sent us the renewal, please ignore this email.<br>
  Sent from: noreply@cltd.co.uk
</td></tr>
</table></td></tr></table></body></html>`
}
