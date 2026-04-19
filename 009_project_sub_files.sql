import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, subName, ratingType, ratingLabel, category, description, issuedBy, projectName } = await req.json()

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured')

    const colors = {
      commendation: { banner: '#EAF3DE', bannerBorder: '#448a40', icon: '👍', titleColor: '#27500A', subColor: '#3B6D11', noteColor: '#27500A', noteBg: '#EAF3DE', noteBorder: '#C0DD97', descBorder: '#448a40', ratingColor: '#3B6D11' },
      yellow_card:  { banner: '#FAEEDA', bannerBorder: '#BA7517', icon: '🟡', titleColor: '#633806', subColor: '#854F0B', noteColor: '#633806', noteBg: '#FAEEDA', noteBorder: '#FAC775', descBorder: '#BA7517', ratingColor: '#854F0B' },
      red_card:     { banner: '#FCEBEB', bannerBorder: '#A32D2D', icon: '🔴', titleColor: '#791F1F', subColor: '#A32D2D', noteColor: '#791F1F', noteBg: '#FCEBEB', noteBorder: '#F7C1C1', descBorder: '#A32D2D', ratingColor: '#A32D2D' },
    }

    const c = colors[ratingType] || colors.yellow_card
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const subjectMap = {
      commendation: `Commendation — ${subName}`,
      yellow_card: `Yellow Card Notice — ${subName}`,
      red_card: `Red Card Notice — ${subName} — Urgent`,
    }

    const bodyIntroMap = {
      commendation: `We are pleased to formally recognise your <strong>outstanding performance</strong>. Please see the details of this commendation below.`,
      yellow_card: `We are writing to formally notify you that a <strong>Yellow Card</strong> has been issued regarding your performance. Please review the details below and take the necessary action.`,
      red_card: `We are writing to formally notify you that a <strong>Red Card</strong> has been issued due to a serious performance issue. This matter requires your <strong>immediate attention</strong>.`,
    }

    const noteMap = {
      commendation: `This commendation has been recorded against your company profile and contributes positively to your overall performance rating with City Construction.`,
      yellow_card: `<strong>Please note:</strong> This yellow card has been recorded against your company profile. A second yellow card or red card may result in suspension from site or removal from our approved subcontractor list.`,
      red_card: `<strong>Urgent:</strong> This red card has been recorded against your company profile. This may result in immediate suspension from site and removal from our approved subcontractor list pending review.`,
    }

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
        <div style="color:rgba(255,255,255,0.65);font-size:12px;padding-left:14px;">Subcontractor Performance Notification</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Banner -->
  <tr><td style="background:${c.banner};border-bottom:2px solid ${c.bannerBorder};padding:16px 32px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:28px;padding-right:12px;">${c.icon}</td>
      <td>
        <div style="font-weight:600;font-size:15px;color:${c.titleColor};">${ratingLabel} Issued</div>
        <div style="font-size:12px;color:${c.subColor};margin-top:2px;">
          ${ratingType === 'commendation' ? 'Outstanding performance recognised' : ratingType === 'yellow_card' ? 'Performance warning — action required' : 'Serious performance issue — urgent action required'}
        </div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#1c1b18;margin:0 0 16px;">Dear <strong>${subName}</strong>,</p>
    <p style="font-size:14px;color:#5c5a54;margin:0 0 20px;line-height:1.7;">${bodyIntroMap[ratingType]}</p>

    <!-- Details -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;border-radius:8px;border:1px solid #e2e0d8;margin-bottom:20px;">
      <tr><td style="padding:16px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr>
            <td style="padding:5px 0;color:#9c9a94;width:140px;">Rating type</td>
            <td style="padding:5px 0;font-weight:600;color:${c.ratingColor};">${c.icon} ${ratingLabel}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#9c9a94;">Category</td>
            <td style="padding:5px 0;font-weight:500;color:#1c1b18;">${category}</td>
          </tr>
          ${projectName ? `<tr><td style="padding:5px 0;color:#9c9a94;">Project</td><td style="padding:5px 0;font-weight:500;color:#1c1b18;">${projectName}</td></tr>` : ''}
          <tr>
            <td style="padding:5px 0;color:#9c9a94;">Date issued</td>
            <td style="padding:5px 0;font-weight:500;color:#1c1b18;">${date}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;color:#9c9a94;">Issued by</td>
            <td style="padding:5px 0;font-weight:500;color:#1c1b18;">${issuedBy}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Description -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:600;color:#9c9a94;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Description</div>
      <div style="font-size:14px;color:#1c1b18;line-height:1.7;padding:12px 16px;border-left:3px solid ${c.descBorder};background:#f5f4f0;border-radius:0 8px 8px 0;">${description}</div>
    </div>

    <!-- Note -->
    <div style="background:${c.noteBg};border:1px solid ${c.noteBorder};border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px;color:${c.noteColor};line-height:1.6;">
      ${noteMap[ratingType]}
    </div>

    <p style="font-size:14px;color:#5c5a54;margin:0 0 4px;line-height:1.7;">If you wish to discuss this matter please contact us directly.</p>
    <p style="font-size:14px;color:#5c5a54;margin:0;line-height:1.7;">Regards,<br><strong style="color:#1c1b18;">City Construction Group</strong></p>
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

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'City Construction <noreply@cltd.co.uk>',
        to: [to],
        subject: subjectMap[ratingType] || `Performance Notification — ${subName}`,
        html,
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Email send failed')

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
