// ─────────────────────────────────────────────────────────────────────────────
// CCG programme PDF — house layout (matches the Thames House tender programme):
//   title + three header tables + logo block
//   STAGE · DESCRIPTION · START · DAYS · END | month band · week-commencing
//   dates · contract week numbers
//   group rows (green, ▼ … ▼ summary line), stage-coloured weekly cells,
//   red ◆ milestones, grey Christmas-shutdown columns, KEY + notes.
// DAYS are working days (Mon–Fri, excl. England & Wales bank holidays and the
// Christmas shutdown). A3 landscape, fitted to one page where it can be.
// ─────────────────────────────────────────────────────────────────────────────
import {
  parseDate, addDays, STAGES, stageColor, effectiveStage, isMilestoneTask,
  isShutdown, isWorkingDay, workingDaysBetween,
} from './ganttUtils'

const INK = [44, 44, 42]
const GREEN = [66, 139, 64]
const GRID = [217, 217, 217]
const SHADE = [217, 217, 217]
const MUTED = [110, 110, 110]

const rgb = (hex) => {
  const h = String(hex || '#448a40').replace('#', '')
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]
}
const ddmmyy = (d) => {
  const x = d instanceof Date ? d : parseDate(d)
  if (!x) return ''
  return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${String(x.getUTCFullYear()).slice(2)}`
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
// PDF base fonts are WinAnsi only — map common characters they can't draw.
const clean = (t) => String(t)
  .replace(/[→⇒➔]/g, '>').replace(/[←⇐]/g, '<').replace(/[↔]/g, '<>')
  .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[✓✔]/g, 'v').replace(/[◆♦]/g, '*')
  .replace(/[^\x00-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g, '')
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7))

/**
 * @param jsPDF  the jsPDF constructor
 * @param rows   flat task list (all groups expanded) with _depth / _hasChildren, groups rolled up
 * @param meta   { title, projectNo, projectTitle, client, possession (Date), status, revision,
 *                 revisionDate, notes: string[], email, shutdown: bool }
 * @param logo   PNG data URL (optional)
 */
export function buildProgrammePdf(jsPDF, rows, meta, logo) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 12
  // Route every string through clean() so unsupported glyphs never print as junk.
  const _text = doc.text.bind(doc), _tw = doc.getTextWidth.bind(doc)
  doc.text = (t, ...a) => _text(typeof t === 'string' ? clean(t) : t, ...a)
  doc.getTextWidth = (t) => _tw(clean(t))
  const calOpts = { shutdown: meta.shutdown !== false }

  // ── Row model ──────────────────────────────────────────────────────────────
  const items = []
  rows.forEach((t, i) => {
    const group = !!t._hasChildren
    if (group && t._depth === 0 && i > 0) items.push({ spacer: true })
    const milestone = isMilestoneTask(t, group)
    const stage = effectiveStage(t, group)
    items.push({
      t, group, milestone, depth: t._depth,
      stage: milestone ? 'MILESTONE' : stage,
      color: group ? null : (stageColor(stage) || t.color || '#448a40'),
      s: parseDate(t.start_date), e: parseDate(milestone ? t.start_date : t.end_date),
    })
  })
  const real = items.filter(r => !r.spacer && r.s && r.e)
  let min = real.reduce((m, r) => (!m || r.s < m ? r.s : m), null) || new Date()
  let max = real.reduce((m, r) => (!m || r.e > m ? r.e : m), null) || addDays(min, 28)

  // Practical completion = a milestone mentioning it, else the last finish.
  const pcRow = real.find(r => r.milestone && /practical completion/i.test(r.t.name || ''))
  const pc = pcRow ? pcRow.s : max
  const possession = meta.possession || min
  const contractWeeks = Math.max(1, Math.ceil((pc - possession) / 86400000 / 7 + 1 / 7))

  // ── Weeks ──────────────────────────────────────────────────────────────────
  const w0 = mondayOf(min)
  const weeks = []
  for (let d = new Date(w0); d <= max; d = addDays(d, 7)) weeks.push(new Date(d))
  const posWeek = mondayOf(possession)
  const weekNo = (d) => (d < posWeek ? null : Math.round((d - posWeek) / 86400000 / 7) + 1)
  const shutdownWeek = weeks.map(d => calOpts.shutdown && [0, 1, 2, 3, 4].every(k => isShutdown(addDays(d, k))))

  // ── Geometry ───────────────────────────────────────────────────────────────
  const col = { stage: 22, desc: 96, start: 15, days: 11, end: 15 }
  const x = {}; let cx = M
  for (const k of ['stage', 'desc', 'start', 'days', 'end']) { x[k] = cx; cx += col[k] }
  const tlX = cx, tlW = W - M - tlX
  const cw = tlW / Math.max(1, weeks.length)
  const gridTop = 44
  const hMonth = 5, hDates = 13, hWeekNo = 4, headH = hMonth + hDates + hWeekNo
  const used = STAGES.filter(s => s.key !== 'MILESTONE' && real.some(r => !r.group && r.stage === s.key))
  const hasMs = real.some(r => r.milestone)
  const keyCols = 7
  const keyRows = Math.ceil((used.length + (hasMs ? 1 : 0)) / keyCols)
  const notes = (meta.notes || []).filter(Boolean)
  const keyH = 8 + keyRows * 4.6 + (notes.length ? 3 + notes.length * 4 : 0)
  const bodyTop = gridTop + headH
  const availOne = H - M - keyH - bodyTop
  let rowH = Math.min(5.6, availOne / Math.max(1, items.length))
  const paginate = rowH < 3.4
  if (paginate) rowH = 4.2
  const fs = Math.max(4.6, Math.min(7, rowH * 1.45))

  // ── Drawing helpers ────────────────────────────────────────────────────────
  const fill = (c) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c) => doc.setTextColor(c[0], c[1], c[2])
  const fit = (text, maxW, size, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    let sz = size
    doc.setFontSize(sz)
    while (doc.getTextWidth(text) > maxW && sz > 4.4) { sz -= 0.25; doc.setFontSize(sz) }
    if (doc.getTextWidth(text) <= maxW) return text
    let t = text
    while (t.length > 3 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
    return t + '…'
  }
  const tri = (cxm, top, size = 1.1) => { fill(INK); doc.triangle(cxm - size, top, cxm + size, top, cxm, top + size * 1.2, 'F') }
  const diamond = (cxm, cym, r = 1.15) => {
    fill([204, 0, 0])
    doc.triangle(cxm, cym - r, cxm + r, cym, cxm, cym + r, 'F')
    doc.triangle(cxm, cym - r, cxm - r, cym, cxm, cym + r, 'F')
  }
  const weekIndex = (d) => Math.floor((mondayOf(d) - w0) / 86400000 / 7)

  const drawPageHeader = () => {
    // Title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19); ink(INK)
    doc.text(meta.title || 'PROGRAMME', M + 150, 14, { align: 'center' })
    // Info tables
    const rowh = 5.4
    const table = (tx, ty, labelW, valW, pairs) => {
      pairs.forEach(([k, v], i) => {
        const y = ty + i * rowh
        fill(INK); doc.rect(tx, y, labelW, rowh, 'F')
        stroke([190, 190, 190]); doc.setLineWidth(0.15); doc.rect(tx + labelW, y, valW, rowh)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink([255, 255, 255])
        doc.text(k, tx + labelW / 2, y + 3.7, { align: 'center' })
        ink(INK); doc.setFont('helvetica', 'normal')
        doc.text(fit(String(v ?? ''), valW - 2, 7, false), tx + labelW + valW / 2, y + 3.7, { align: 'center' })
      })
    }
    table(M, 18, 25, 135, [['PROJECT NO', meta.projectNo || '—'], ['PROJECT TITLE', meta.projectTitle || '—'], ['CLIENT', meta.client || '—']])
    table(M + 160, 18, 42, 32, [['POSSESSION', ddmmyy(possession)], ['PRACTICAL COMPLETION', ddmmyy(pc)], ['CONTRACT PERIOD', `${contractWeeks} weeks`]])
    table(M + 239, 18, 30, 32, [['STATUS', meta.status || '—'], ['REVISION NO', meta.revision || '—'], ['REVISION DATE', meta.revisionDate || ddmmyy(new Date())]])
    // Logo block
    const lx = W - M - 62
    if (logo) { try { doc.addImage(logo, 'PNG', lx, 9, 11, 12.4) } catch { /* ignore */ } }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); ink(INK)
    doc.text('CITY CONSTRUCTION GROUP', lx + 14, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); ink(MUTED)
    doc.text('One Canada Square, Canary Wharf, London E14 5AA', lx + 14, 26)
    if (meta.email) doc.text(meta.email, lx + 14, 29.5)
  }

  const drawGridHeader = () => {
    const y = gridTop
    // Left headers
    fill(INK); doc.rect(M, y, tlX - M, headH, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink([255, 255, 255])
    const lab = { stage: 'STAGE', desc: 'DESCRIPTION', start: 'START', days: 'DAYS', end: 'END' }
    for (const k of Object.keys(lab)) doc.text(lab[k], x[k] + col[k] / 2, y + headH / 2 + 1.2, { align: 'center' })
    stroke([90, 90, 90]); doc.setLineWidth(0.15)
    for (const k of ['desc', 'start', 'days', 'end']) doc.line(x[k], y, x[k], y + headH)
    // Month band
    let i = 0
    while (i < weeks.length) {
      const m = weeks[i].getUTCMonth(), yr = weeks[i].getUTCFullYear()
      let j = i
      while (j + 1 < weeks.length && weeks[j + 1].getUTCMonth() === m && weeks[j + 1].getUTCFullYear() === yr) j++
      const mx = tlX + i * cw, mw = (j - i + 1) * cw
      fill(INK); doc.rect(mx, y, mw, hMonth, 'F')
      stroke([255, 255, 255]); doc.setLineWidth(0.25); doc.line(mx, y, mx, y + hMonth)
      if (mw > 5) {
        const label = MONTHS[m] + '-' + String(yr).slice(2)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(6.5, mw * 0.9)); ink([255, 255, 255])
        doc.text(label, mx + mw / 2, y + 3.5, { align: 'center' })
      }
      i = j + 1
    }
    // Week-commencing dates + week numbers
    const dy = y + hMonth
    weeks.forEach((d, k) => {
      const wx = tlX + k * cw
      if (shutdownWeek[k]) { fill(SHADE); doc.rect(wx, dy, cw, hDates + hWeekNo, 'F') }
      stroke(GRID); doc.setLineWidth(0.1); doc.rect(wx, dy, cw, hDates); doc.rect(wx, dy + hDates, cw, hWeekNo)
      if (cw >= 2.1) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(5.2, cw * 1.9)); ink(INK)
        doc.text(ddmmyy(d), wx + cw / 2 + 0.7, dy + hDates - 0.8, { angle: 90 })
      }
      const n = weekNo(d)
      if (n != null && cw >= 1.6) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.min(4.6, cw * 1.6)); ink(MUTED)
        doc.text(String(n), wx + cw / 2, dy + hDates + 2.9, { align: 'center' })
      }
    })
  }

  const drawBodyFrame = (top, bottom) => {
    // Shutdown shading + week grid lines
    weeks.forEach((d, k) => {
      const wx = tlX + k * cw
      if (shutdownWeek[k]) { fill(SHADE); doc.rect(wx, top, cw, bottom - top, 'F') }
    })
    stroke(GRID); doc.setLineWidth(0.08)
    for (let k = 0; k <= weeks.length; k++) doc.line(tlX + k * cw, top, tlX + k * cw, bottom)
    // Left column separators
    stroke([200, 200, 200]); doc.setLineWidth(0.12)
    for (const k of ['stage', 'desc', 'start', 'days', 'end']) doc.line(x[k], top, x[k], bottom)
    doc.line(tlX, top, tlX, bottom)
  }

  const drawRow = (r, y) => {
    if (r.spacer) return
    const mid = y + rowH / 2 + fs * 0.12
    const { t } = r
    // Left columns
    if (r.group) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(fs + 0.4); ink(GREEN)
      doc.text(fit(String(t.name || '').toUpperCase(), col.desc - 3, fs + 0.4, true), x.desc + col.desc / 2, mid, { align: 'center' })
      ink(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(fs)
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(fs - 0.6); ink(MUTED)
      doc.text(fit(r.stage || '', col.stage - 2, fs - 0.6, false), x.stage + col.stage / 2, mid, { align: 'center' })
      ink(INK)
      doc.text(fit(String(t.name || ''), col.desc - 3, fs, r.milestone), x.desc + col.desc / 2, mid, { align: 'center' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(fs)
    }
    const days = r.milestone ? 0 : workingDaysBetween(r.s, r.e, calOpts)
    doc.text(ddmmyy(r.s), x.start + col.start / 2, mid, { align: 'center' })
    doc.text(String(days), x.days + col.days / 2, mid, { align: 'center' })
    doc.text(ddmmyy(r.milestone ? r.s : r.e), x.end + col.end / 2, mid, { align: 'center' })

    // Timeline
    const a = Math.max(0, weekIndex(r.s)), b = Math.min(weeks.length - 1, weekIndex(r.e))
    if (r.milestone) {
      diamond(tlX + (a + 0.5) * cw, y + rowH / 2, Math.min(1.25, rowH * 0.28))
    } else if (r.group) {
      const lx0 = tlX + a * cw, lx1 = tlX + (b + 1) * cw
      tri(lx0 + cw / 2, y + 0.5, Math.min(1, cw * 0.32))
      tri(lx1 - cw / 2, y + 0.5, Math.min(1, cw * 0.32))
      fill(INK); doc.rect(lx0, y + rowH - 0.75, lx1 - lx0, 0.55, 'F')
    } else {
      const c = rgb(r.color)
      for (let k = a; k <= b; k++) {
        // Only weeks the task actually works in (skips shutdown / holiday weeks)
        const ws = weeks[k]
        let works = false
        for (let dd = 0; dd < 7 && !works; dd++) {
          const day = addDays(ws, dd)
          if (day >= r.s && day <= r.e && isWorkingDay(day, calOpts)) works = true
        }
        if (!works) continue
        fill(c); doc.rect(tlX + k * cw + 0.08, y + 0.45, cw - 0.16, rowH - 0.9, 'F')
      }
    }
  }

  const drawKey = (yTop) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); ink(INK)
    doc.text('KEY', M, yTop + 3)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); ink(MUTED)
    doc.text(`${calOpts.shutdown ? 'Shaded columns = shutdown (no working). ' : ''}DAYS = working days (Mon–Fri, excl. bank holidays${calOpts.shutdown ? ' & shutdown' : ''}).`, x.desc, yTop + 3)
    const entries = [...used.map(s => ({ label: s.key, color: s.color }))]
    if (hasMs) entries.push({ label: 'MILESTONE', ms: true })
    const kw = tlW / keyCols
    entries.forEach((e, i) => {
      const kx = tlX + (i % keyCols) * kw, ky = yTop + Math.floor(i / keyCols) * 4.6
      if (e.ms) { stroke([180, 180, 180]); doc.setLineWidth(0.15); doc.rect(kx, ky, 3.6, 3.6); diamond(kx + 1.8, ky + 1.8, 1) }
      else { fill(rgb(e.color)); doc.rect(kx, ky, 3.6, 3.6, 'F') }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6); ink(INK)
      doc.text(e.label, kx + 4.6, ky + 2.7)
    })
    let ny = yTop + keyRows * 4.6 + 5
    doc.setFontSize(5.6); ink(MUTED)
    notes.forEach(n => { doc.text(fit(n, W - M - x.desc, 5.6, false), x.desc, ny); ny += 4 })
  }

  // ── Render pages ──────────────────────────────────────────────────────────
  let idx = 0, page = 0
  while (idx < items.length || page === 0) {
    if (page > 0) doc.addPage()
    page++
    drawPageHeader()
    drawGridHeader()
    const room = paginate ? Math.floor((H - M - 8 - bodyTop) / rowH) : items.length
    const last = paginate ? Math.min(items.length, idx + room) : items.length
    const onLastPage = last >= items.length
    // When paginating, reserve key space on the final page only.
    let take = last
    if (paginate && onLastPage) {
      const fitWithKey = Math.floor((H - M - keyH - bodyTop) / rowH)
      if (last - idx > fitWithKey) take = idx + fitWithKey
    }
    const bottom = bodyTop + (take - idx) * rowH
    drawBodyFrame(bodyTop, bottom)
    for (let k = idx; k < take; k++) drawRow(items[k], bodyTop + (k - idx) * rowH)
    stroke(INK); doc.setLineWidth(0.5); doc.line(M, bottom, W - M, bottom)
    doc.setLineWidth(0.3); doc.line(M, bodyTop, W - M, bodyTop)
    idx = take
    if (idx >= items.length) drawKey(bottom + 6)
    if (items.length === 0) break
  }
  const pages = doc.internal.getNumberOfPages()
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); ink(MUTED)
      doc.text(`Page ${p} of ${pages}`, W - M, H - 5, { align: 'right' })
    }
  }
  return { doc, possession, pc, contractWeeks }
}
