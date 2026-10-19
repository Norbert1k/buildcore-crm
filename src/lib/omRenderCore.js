// ─────────────────────────────────────────────────────────────────────────────
// CCG standard O&M layout — the one renderer for every handover document.
// Pure JavaScript (no bundler imports) so the browser preview and the print
// service (api/om-render.js) produce identical HTML. See omRender.js for the
// browser wrapper that supplies the stylesheet and logos.
//
// Block types inside a section: p, h3, ul, cite, callout, table, qr, calendar,
// checklist, log, sign, pagebreak. Text may contain a small set of inline tags
// (b, strong, em, br, span.fld/.tick/.cross/.status) — anything else is
// stripped, because section text is written by Claude from uploaded documents.
// ─────────────────────────────────────────────────────────────────────────────
const SPAN_CLASSES = new Set(['fld', 'tick', 'cross', 'status', 'ok', 'due', 'na'])
// Text in a pack is written by Claude from uploaded documents, so treat it as
// untrusted: escape everything, then put back only <b> <strong> <em> <br> and
// <span class="…"> with known class names. Nothing else can survive.
export function clean(html) {
  const e = String(html ?? '').replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+|nbsp);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return e
    .replace(/&lt;(\/?)(b|strong|em)&gt;/gi, (m, c, t) => `<${c}${t.toLowerCase()}>`)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;span class=&quot;([\w\s-]*)&quot;&gt;/gi, (m, cls) => {
      const ok = cls.split(/\s+/).filter(c => SPAN_CLASSES.has(c)).join(' ')
      return ok ? `<span class="${ok}">` : '<span>'
    })
    .replace(/&lt;\/span&gt;/gi, '</span>')
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// [[B]] -> 'p. 20', [[C:6]] -> page of 6th page of Appendix C, [[sec:s9]] -> section page
export function resolveTokens(obj, data) {
  const pages = data._pages || {}
  const apps = Object.fromEntries((data.appendices || []).map(a => [a.letter, a]))
  const sub = s => s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => {
    if (t.startsWith('sec:')) return String(pages[t.slice(4)] ?? '—')
    if (t.includes(':')) { const [l, n] = t.split(':'); const a = apps[l]; return a?.first ? String(a.first + Number(n) - 1) : '—' }
    const a = apps[t]; if (!a?.first) return 'p. —'
    return a.count === 1 ? `p. ${a.first}` : `pp. ${a.first}–${a.last}`
  })
  const walk = o => typeof o === 'string' ? sub(o) : Array.isArray(o) ? o.map(walk)
    : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)])) : o
  return walk(obj)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function table(t) {
  const cols = t.widths ? `<colgroup>${t.widths.map(w => `<col style="width:${esc(w)}">`).join('')}</colgroup>` : ''
  const head = t.cols ? `<thead><tr>${t.cols.map(c => `<th>${clean(c)}</th>`).join('')}</tr></thead>` : ''
  const body = (t.rows || []).map(r => `<tr>${r.map(c => `<td>${clean(c)}</td>`).join('')}</tr>`).join('')
  return `<table class="${esc(t.cls || '')}">${cols}${head}<tbody>${body}</tbody></table>`
}

function block(b) {
  if (b.p != null) return `<p class="${esc(b.cls || '')}">${clean(b.p)}</p>`
  if (b.h3 != null) return `<h3>${clean(b.h3)}</h3>`
  if (b.ul) return `<ul>${b.ul.map(i => `<li>${clean(i)}</li>`).join('')}</ul>`
  if (b.cite != null) return `<div class="cite">${clean(b.cite)}</div>`
  if (b.callout != null) return `<div class="callout ${esc(b.kind || '')}">${b.title ? `<span class="t">${esc(b.title)}.</span> ` : ''}${clean(b.callout)}</div>`
  if (b.table) return table(b.table)
  if (b.qr) return `<div class="qr-grid">${b.qr.map(c => `<div class="qr-card ${esc(c.cls || '')}"><div class="k">${esc(c.k)}</div><div class="v">${clean(c.v)}</div></div>`).join('')}</div>`
  if (b.calendar) return `<table class="cal"><colgroup><col style="width:34%">${MONTHS.map(() => '<col style="width:5.5%">').join('')}</colgroup>
    <thead><tr><th>Task</th>${MONTHS.map(m => `<th>${m}</th>`).join('')}</tr></thead>
    <tbody>${b.calendar.map(r => `<tr><td>${clean(r.task)}</td>${MONTHS.map((_, i) => `<td>${r.months.includes(i + 1) ? `<span class="dot${r.optional ? ' o' : ''}"></span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  if (b.checklist) return `<table class="check"><colgroup><col style="width:52%"><col style="width:8%"><col style="width:14%"><col style="width:26%"></colgroup>
    <thead><tr><th>Check</th><th class="c">OK</th><th class="c">Action needed</th><th>Comments</th></tr></thead>
    <tbody>${b.checklist.map(r => `<tr><td>${clean(r)}</td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>`
  if (b.log) return `<table class="form"><colgroup>${b.log.widths.map(w => `<col style="width:${esc(w)}">`).join('')}</colgroup>
    <thead><tr>${b.log.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${Array.from({ length: b.log.rows }, () => `<tr>${b.log.cols.map(() => '<td></td>').join('')}</tr>`).join('')}</tbody></table>`
  if (b.sign) return `<div class="sign">${b.sign.map(s => `<div><div class="h">${esc(s.h)}</div>${(s.lines || []).map(l => `<div class="small">${clean(l)}</div>`).join('')}${(s.fields || []).map(f => `<div class="line"></div><div class="small">${esc(f)}</div>`).join('')}</div>`).join('')}</div>`
  if (b.pagebreak) return '<div style="break-after: page"></div>'
  return ''
}

// On screen there is no print pagination, so each section that starts a new
// page in the PDF becomes its own "sheet" with the running header drawn in.
const SCREEN_CSS = `
html { background: #e7e9e4; }
body { padding: 18px 0 40px; }
.sheet { width: 210mm; min-height: 120mm; margin: 0 auto 16px; background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.12); padding: 0 17mm 14mm; position: relative; }
.sheet.a5 { width: 148mm; padding: 0 12mm 10mm; }
.sheet .run { display: flex; align-items: center; gap: 4mm; border-bottom: 0.25mm solid #428B40; padding: 6mm 0 2.5mm; margin-bottom: 6mm; }
.sheet .run img { height: 9mm; }
.sheet .run .a { font-weight: 700; font-size: 8.5pt; color: #0A0A0A; }
.sheet .run .b { font-weight: 700; font-size: 8pt; color: #428B40; }
.sheet .run .r { margin-left: auto; text-align: right; font-size: 7.5pt; color: #666; }
.sheet .run .r b { color: #b86e00; }
.cover.sheet { padding: 0; height: 297mm; }
.cover.sheet.a5 { height: 210mm; }
.sec, .sec.flow { break-before: auto; }
.sheet .sec.flow { margin-top: 9mm; }
.appx { width: 210mm; margin: 0 auto 16px; background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.12); padding: 10mm 17mm; }
.appx h2 { color: #428B40; font-size: 14pt; margin: 0 0 4mm; }
.appx-row { display: flex; gap: 4mm; padding: 2mm 0; border-bottom: 0.25mm solid #d9ddd5; font-size: 10pt; }
.appx-row .l { width: 22mm; font-weight: 700; color: #2C6A2B; }
.appx-row .t { flex: 1; }
.appx-row .s { color: #5f645c; font-size: 9pt; }
@media (prefers-color-scheme: dark) { html { background: #2a2d2a; } }
`

function divider(a) {
  return `<section class="divider"><div class="band"></div><div class="inner">
    <div class="kick">Appendix</div><div class="letter">${esc(a.letter)}</div>
    <h2 id="app-${esc(a.letter)}">${esc(a.title)}</h2>
    <div class="meta"><span>Source</span><b>${esc(a.source || '')}</b>
      <span>In this manual</span><b>${a.first ? `Pages ${a.first}–${a.last} (${a.count} page${a.count === 1 ? '' : 's'})` : ''}</b>
      <span>Note</span><b>${esc(a.note || '')}</b></div></div></section>`
}

// screen: on-screen preview (sheets, no dividers)
// print:  what the render service prints — contents rows are links, and each
//         appendix gets its title page; the service inserts the documents after it.
// css / tenantCss / logos are passed in so this file runs in the browser and on the print server alike.
export function renderOmHtml(input, { screen = false, css: OM_CSS = '', tenantCss: OM_TENANT_CSS = '', logoWhite = '', logoDark = '' } = {}) {
  const data = resolveTokens(input, input)
  const { job, doc } = data
  const sections = data.sections || []
  const apps = data.appendices || []
  const pages = data._pages || {}
  const a5 = doc.layout === 'a5'
  const css = OM_CSS + (data.css_extra === 'tenant.css' || a5 ? OM_TENANT_CSS : '') + (screen ? SCREEN_CSS : '')
  const lw = logoWhite, ld = logoDark
  const link = (id, inner) => screen ? inner : `<a href="#${esc(id)}" class="toc-link" style="color:inherit;text-decoration:none;display:block">${inner}</a>`
  const run = screen ? `<div class="run"><img src="${ld}"><div><div class="a">CITY CONSTRUCTION GROUP</div><div class="b">${esc(doc.running_title)}</div></div><div class="r">${esc(doc.ref)} · ${esc(doc.issue)} · ${esc(doc.date_short)}${doc.status_short ? `<br><b>${esc(doc.status_short)}</b>` : ''}</div></div>` : ''
  const sheet = (inner, extra = '') => screen ? `<div class="sheet${a5 ? ' a5' : ''} ${extra}">${run}${inner}</div>` : inner

  const cover = `<section class="cover${screen ? ` sheet${a5 ? ' a5' : ''}` : ''}">
  <div class="cover-band">
    <div class="cover-brand"><img src="${lw}"><div class="rule"></div><div><div class="co">CITY CONSTRUCTION GROUP</div><div class="doc">${esc(doc.kind)}</div></div></div>
    <div class="cover-title"><div class="cover-kicker">${esc(doc.kicker)}</div><h1>${esc(job.name)}</h1><div class="sub">${esc(doc.title)}</div><div class="addr">${esc(job.address)}</div></div>
  </div>
  <div class="cover-strip"></div>
  <div class="cover-body">
    ${doc.badges?.length ? `<div class="badges">${doc.badges.map(b => `<span class="badge ${esc(b.cls)}">${esc(b.t)}</span>`).join('')}</div>` : ''}
    <table class="kv"><tbody>${(doc.cover_facts || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${clean(v)}</td></tr>`).join('')}</tbody></table>
    <table class="kv" style="margin-top:4mm"><tbody>
      <tr><td>Document ref.</td><td>${esc(doc.ref)}</td></tr>
      <tr><td>Issue</td><td>${esc(doc.issue)} · ${esc(doc.date_long)}${doc.status ? ` · <b>${esc(doc.status)}</b>` : ''}</td></tr>
    </tbody></table>
  </div>
  <div class="cover-foot"><span>${esc(doc.keep_note)}</span><span>${esc(doc.cover_right || 'City Construction Group Ltd · Co. No. 12311732 · www.cltd.co.uk')}</span></div>
</section>`

  const toc = `<section>
  <h2 class="sec-h" style="margin-top:0">Contents</h2>
  <div class="toc">
    ${sections.map(s => link(s.id, `<div class="toc-row${s.gt ? ' gt' : ''}"><span class="n">${esc(s.num)}</span><span class="t">${esc(s.title)}</span><span class="pg">${pages[s.id] ?? ''}</span></div>`)).join('')}
    ${apps.length ? `<div class="toc-head">Appendices</div>${apps.map(a => link('app-' + a.letter, `<div class="toc-row app"><span class="n">Appendix ${esc(a.letter)}</span><span class="t">${esc(a.title)}</span><span class="pg">${pages['app-' + a.letter] ?? ''}</span></div>`)).join('')}` : ''}
  </div>
  <p class="small" style="margin-top:3mm">Select any entry to go to it. The PDF bookmarks panel gives the same navigation.</p>
  <h2 class="sec-h" style="margin-top:4mm">${esc(doc.control_title || 'Document control')}</h2>
  <table class="kv"><tbody>
    ${(doc.control || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${clean(v)}</td></tr>`).join('')}
    <tr><td>Revision history</td><td>${(doc.revisions || []).map(r => `<div><b>${esc(r[0])}</b> · ${esc(r[1])} · ${clean(r[2])}</div>`).join('')}</td></tr>
  </tbody></table>
</section>`

  // Group sections into sheets for screen; print relies on CSS page breaks.
  const groups = []
  sections.forEach(s => { if (!s.flow || !groups.length) groups.push([s]); else groups[groups.length - 1].push(s) })
  const body = groups.map(g => sheet(g.map(s => `<section class="sec${s.flow ? ' flow' : ''}">
  <h2 class="sec-h${s.gt ? ' gt-h' : ''}" id="${esc(s.id)}"><span class="n">${esc(s.num)}</span><span>${esc(s.title)}</span></h2>
  ${(s.blocks || []).map(block).join('\n')}
</section>`).join(''))).join('\n')

  const appx = screen && apps.length ? `<div class="appx"><h2>Appendices — bound in from the job's documents</h2>${apps.map(a => `<div class="appx-row"><span class="l">Appendix ${esc(a.letter)}</span><span class="t">${esc(a.title)}<div class="s">${esc(a.source)}${a.count ? ` · ${a.count} page${a.count === 1 ? '' : 's'}` : ''}${a.first ? ` · pp. ${a.first}–${a.last}` : ''}</div></span></div>`).join('')}</div>` : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
${cover}
${sheet(toc)}
${body}
${screen ? appx : apps.map(divider).join('\n')}
</body></html>`
}
