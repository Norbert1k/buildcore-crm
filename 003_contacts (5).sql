import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Calculate the date 14 days from now
    const now = new Date()
    const in14Days = new Date(now)
    in14Days.setDate(in14Days.getDate() + 14)
    const targetDate = in14Days.toISOString().split('T')[0]
    const todayStr = now.toISOString().split('T')[0]

    // Insurance document types to check
    const insuranceTypes = ['public_liability', 'employers_liability', 'professional_indemnity']

    // Find documents expiring within 14 days (between today and 14 days from now)
    const { data: expiringDocs, error: docsError } = await supabase
      .from('documents')
      .select('id, document_name, document_type, expiry_date, subcontractor_id, subcontractors(company_name, email)')
      .in('document_type', insuranceTypes)
      .gte('expiry_date', todayStr)
      .lte('expiry_date', targetDate)

    if (docsError) throw docsError

    if (!expiringDocs || expiringDocs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No expiring insurance documents found', processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get users who should be notified (project_manager and accountant roles)
    const { data: notifyUsers, error: usersError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .in('role', ['admin', 'project_manager', 'accountant'])

    if (usersError) throw usersError

    const typeLabels: Record<string, string> = {
      public_liability: 'Public Liability Insurance',
      employers_liability: "Employer's Liability Insurance",
      professional_indemnity: 'Professional Indemnity Insurance',
    }

    let emailsSent = 0
    let notificationsCreated = 0

    for (const doc of expiringDocs) {
      const daysLeft = Math.ceil((new Date(doc.expiry_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      const subName = doc.subcontractors?.company_name || 'Unknown'
      const docType = typeLabels[doc.document_type] || doc.document_type
      const expiryFormatted = new Date(doc.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

      // Check if we already sent a notification for this document today
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .like('title', `%${subName}%`)
        .like('message', `%${docType}%`)
        .gte('created_at', todayStr)
        .limit(1)

      if (existing && existing.length > 0) continue // Already notified today

      // Create in-CRM notifications for all relevant users
      for (const user of (notifyUsers || [])) {
        await supabase.from('notifications').insert({
          user_id: user.id,
          title: `Insurance Expiring — ${subName}`,
          message: `${docType} expires on ${expiryFormatted} (${daysLeft} days). Please ensure the subcontractor provides a renewal.`,
          type: daysLeft <= 7 ? 'danger' : 'warning',
          link: `/subcontractors/${doc.subcontractor_id}`,
        })
        notificationsCreated++
      }

      // Send email to all relevant users
      for (const user of (notifyUsers || [])) {
        if (!user.email) continue

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
      <td style="padding-left:14px;border-left:1px solid rgba(255,255,255,0.2);margin-left:14px;">
        <div style="color:white;font-weight:600;font-size:16px;padding-left:14px;">City Construction Group</div>
        <div style="color:rgba(255,255,255,0.65);font-size:12px;padding-left:14px;">Insurance Expiry Notification</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Warning Banner -->
  <tr><td style="background:#FAEEDA;border-bottom:2px solid #BA7517;padding:16px 32px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:28px;padding-right:12px;">⚠️</td>
      <td>
        <div style="font-weight:600;font-size:15px;color:#633806;">Insurance Document Expiring</div>
        <div style="font-size:12px;color:#854F0B;margin-top:2px;">${daysLeft} day${daysLeft !== 1 ? 's' : ''} until expiry — action required</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#1c1b18;margin:0 0 16px;">Hi <strong>${user.full_name || 'Team'}</strong>,</p>
    <p style="font-size:14px;color:#5c5a54;margin:0 0 20px;line-height:1.7;">
      This is an automated reminder that the following insurance document is due to expire soon. Please ensure the subcontractor provides a valid renewal before the expiry date.
    </p>

    <!-- Details -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;border-radius:8px;border:1px solid #e2e0d8;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr>
            <td style="padding:5px 0;color:#9c9a94;width:140px;">Subcontractor</td>
            <td style="padding:5px 0;font-weight:600;color:#1c1b18;">${subName}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#9c9a94;">Document Type</td>
            <td style="padding:5px 0;font-weight:500;color:#1c1b18;">${docType}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#9c9a94;">Expiry Date</td>
            <td style="padding:5px 0;font-weight:600;color:#BA7517;">${expiryFormatted}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#9c9a94;">Days Remaining</td>
            <td style="padding:5px 0;font-weight:700;color:${daysLeft <= 7 ? '#A32D2D' : '#BA7517'};">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <div style="background:#FAEEDA;border:1px solid #FAC775;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#633806;line-height:1.6;">
      <strong>Action required:</strong> Contact the subcontractor to request an updated insurance certificate. The document must be uploaded to the CRM before the expiry date.
    </div>

    <p style="font-size:14px;color:#5c5a54;margin:0 0 4px;line-height:1.7;">
      <a href="https://crm.cltd.co.uk/subcontractors/${doc.subcontractor_id}" style="color:#448a40;font-weight:600;text-decoration:underline;">View in CRM →</a>
    </p>

    <p style="font-size:14px;color:#5c5a54;margin:16px 0 0;line-height:1.7;">Regards,<br><strong style="color:#1c1b18;">City Construction CRM</strong></p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f5f4f0;border-top:1px solid #e2e0d8;padding:14px 32px;font-size:11px;color:#9c9a94;line-height:1.6;">
    This notification was sent automatically from the City Construction CRM system.<br>
    Sent from: noreply@cltd.co.uk
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'City Construction <noreply@cltd.co.uk>',
              to: [user.email],
              subject: `⚠️ Insurance Expiring — ${subName} — ${docType} (${daysLeft} days)`,
              html,
            }),
          })
          if (res.ok) emailsSent++
        } catch (e) {
          console.error(`Failed to email ${user.email}:`, e)
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: expiringDocs.length,
      emailsSent,
      notificationsCreated,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
