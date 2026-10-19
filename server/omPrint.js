// ─────────────────────────────────────────────────────────────────────────────
// O&M print engine (Node) — used by api/om-render.js.
//
// pack (JSON from the O&M builder) → finished PDF:
//   1. print the house-style HTML with headless Chromium (fonts embedded),
//   2. work out real page numbers (two passes) so the contents, the documents
//      register and every "see page n" are right,
//   3. bind each appendix's source pages in after its title page,
//   4. stamp the running header / footer / "Page x of n",
//   5. write bookmarks (sections, appendices, documents inside appendices).
// Third-party pages are reproduced untouched.
// ─────────────────────────────────────────────────────────────────────────────
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFNumber, PDFNull, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { renderOmHtml } from '../src/lib/omRenderCore.js'

const MM = 72 / 25.4
const NO_LIGA = { liga: false, clig: false, calt: false }   // Carlito's 'ti' ligature renders as a gap
const GREEN = rgb(0x42 / 255, 0x8b / 255, 0x40 / 255)
const INK = rgb(0.04, 0.04, 0.04)
const GREY = rgb(0.4, 0.42, 0.39)
const LINE = rgb(0.85, 0.87, 0.84)
const AMBER = rgb(0.72, 0.43, 0)

// ── outline helpers ─────────────────────────────────────────────────────────
function text(o) { return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '' }
function readOutline(doc) {
  const refs = doc.getPages().map(p => p.ref)
  const idx = ref => refs.findIndex(r => r === ref || (r.objectNumber === ref?.objectNumber && r.generationNumber === ref?.generationNumber))
  const out = []
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  const walk = (item, depth) => {
    while (item) {
      let dest = item.lookup(PDFName.of('Dest'))
      if (!dest) { const a = item.lookupMaybe(PDFName.of('A'), PDFDict); dest = a && a.lookup(PDFName.of('D')) }
      if (dest instanceof PDFName || dest instanceof PDFString) dest = null // named dests not used by Chromium outlines
      const pageRef = dest instanceof PDFArray ? dest.get(0) : null
      out.push({ title: text(item.lookup(PDFName.of('Title'))), depth, page: pageRef ? idx(pageRef) : -1 })
      const first = item.lookupMaybe(PDFName.of('First'), PDFDict)
      if (first) walk(first, depth + 1)
      item = item.lookupMaybe(PDFName.of('Next'), PDFDict)
    }
  }
  if (root) walk(root.lookupMaybe(PDFName.of('First'), PDFDict), 1)
  return out
}

function writeOutline(doc, entries) {
  // entries: [{ title, page (0-based), level }]
  const ctx = doc.context
  const pages = doc.getPages()
  const rootRef = ctx.nextRef()
  const nodes = entries.map(e => ({ ...e, ref: ctx.nextRef(), kids: [] }))
  const stack = [{ level: 0, ref: rootRef, kids: [] }]
  const top = stack[0]
  nodes.forEach(n => {
    while (stack[stack.length - 1].level >= n.level) stack.pop()
    const parent = stack[stack.length - 1]
    n.parent = parent.ref; parent.kids.push(n); stack.push(n)
  })
  const count = n => n.kids.reduce((c, k) => c + 1 + count(k), 0)
  const emit = (list) => list.forEach((n, i) => {
    const d = ctx.obj({
      Title: PDFHexString.fromText(n.title),
      Parent: n.parent,
      Dest: [pages[Math.max(0, Math.min(pages.length - 1, n.page))].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull],
    })
    if (i > 0) d.set(PDFName.of('Prev'), list[i - 1].ref)
    if (i < list.length - 1) d.set(PDFName.of('Next'), list[i + 1].ref)
    if (n.kids.length) { d.set(PDFName.of('First'), n.kids[0].ref); d.set(PDFName.of('Last'), n.kids[n.kids.length - 1].ref); d.set(PDFName.of('Count'), PDFNumber.of(-count(n))) }
    ctx.assign(n.ref, d)
    emit(n.kids)
  })
  emit(top.kids)
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.kids[0]?.ref, Last: top.kids[top.kids.length - 1]?.ref, Count: PDFNumber.of(count(top)) }))
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

// A drawing or photo given as an appendix becomes one A4 page (landscape when wide)
async function toPdf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const isPng = b[0] === 0x89 && b[1] === 0x50, isJpg = b[0] === 0xff && b[1] === 0xd8
  if (!isPng && !isJpg) return PDFDocument.load(b, { ignoreEncryption: true })
  const doc = await PDFDocument.create()
  const img = isPng ? await doc.embedPng(b) : await doc.embedJpg(b)
  const land = img.width > img.height
  const [W, H] = land ? [841.89, 595.28] : [595.28, 841.89]
  const m = 28, s = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height)
  const page = doc.addPage([W, H])
  page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s })
  return doc
}

// ── main ────────────────────────────────────────────────────────────────────
/**
 * @param pack        pack JSON (job, doc, sections, appendices[{letter,title,source,note,pages?,bookmarks?, file}])
 * @param assets      { css, tenantCss, logoWhite (data URI), logoDark (bytes), fontRegular (bytes), fontBold (bytes) }
 * @param loadSource  async (appendix) => PDF bytes of that appendix's source file
 * @param browser     a launched puppeteer Browser
 */
export async function printPack(pack, assets, loadSource, browser) {
  const apps = (pack.appendices || []).map(a => ({ ...a }))
  const sources = {}
  for (const a of apps) {
    const got = await loadSource(a)
    const src = await toPdf(got?.bytes || got)
    const range = a.pages?.length ? a.pages : Array.from({ length: src.getPageCount() }, (_, i) => i + 1)
    sources[a.letter] = { src, range }
    a.count = range.length
  }

  const tab = await browser.newPage()
  // The pack text is untrusted: no scripts, and nothing fetched from the network
  // (fonts and logos arrive as data: URIs)
  await tab.setJavaScriptEnabled(false)
  await tab.setRequestInterception(true)
  tab.on('request', r => (/^(data|about):/.test(r.url()) ? r.continue() : r.abort()))
  const print = async (pages) => {
    const html = renderOmHtml({ ...pack, appendices: apps, _pages: pages }, { css: assets.css, tenantCss: assets.tenantCss, logoWhite: assets.logoWhite, logoDark: '' })
    await tab.setContent(html, { waitUntil: 'load' })
    return tab.pdf({ printBackground: true, preferCSSPageSize: true, outline: true, tagged: true })
  }

  // Two passes (rarely three) until every page reference is stable
  let pages = {}, printed, doc, outline
  for (let pass = 0; pass < 3; pass++) {
    printed = await print(pages)
    doc = await PDFDocument.load(printed)
    outline = readOutline(doc)
    const h2 = outline.filter(o => o.depth === 2)   // h1 = cover title; h2 = contents, control, sections, dividers
    // order: Contents, Document control, sections…, appendix dividers…
    const body = h2.slice(2)
    const next = {}
    pack.sections.forEach((s, i) => { next[s.id] = body[i] ? body[i].page + 1 : null })
    let offset = 0
    apps.forEach((a, i) => {
      const div = body[pack.sections.length + i]
      const at = (div ? div.page : 0) + 1 + offset
      next['app-' + a.letter] = at
      a.divider = at; a.first = at + 1; a.last = at + a.count
      offset += a.count
    })
    if (JSON.stringify(next) === JSON.stringify(pages)) break
    pages = next
  }
  await tab.close()

  // Bind the appendix documents in after their title pages (back to front so indexes hold)
  const frontCount = doc.getPageCount()
  const kinds = Array.from({ length: frontCount }, (_, i) => (i === 0 ? 'cover' : 'body'))
  apps.forEach(a => { kinds[a.divider - 1 - apps.filter(b => b.divider < a.divider).reduce((n, b) => n + b.count, 0)] = 'divider' })
  for (const a of [...apps].reverse()) {
    const { src, range } = sources[a.letter]
    const copied = await doc.copyPages(src, range.map(n => n - 1))
    const dividerIndex = a.divider - 1 - apps.filter(b => b.divider < a.divider).reduce((n, b) => n + b.count, 0)
    copied.forEach((p, i) => doc.insertPage(dividerIndex + 1 + i, p))
    kinds.splice(dividerIndex + 1, 0, ...copied.map(() => 'source'))
  }

  // Running header / footer
  doc.registerFontkit(fontkit)
  const fr = await doc.embedFont(assets.fontRegular, { features: NO_LIGA })   // full embed: pdf-lib's subsetter drops glyphs with Carlito
  const fb = await doc.embedFont(assets.fontBold, { features: NO_LIGA })
  const logo = await doc.embedPng(assets.logoDark)
  const total = doc.getPageCount()
  const a5 = pack.doc.layout === 'a5'
  const k = a5 ? 0.8 : 1
  const d = pack.doc
  const left = d.footer_left || 'City Construction Group Ltd  ·  One Canada Square, Canary Wharf, London E14 5AA  ·  0203 948 1930  ·  info@cltd.co.uk'
  doc.getPages().forEach((page, i) => {
    const kind = kinds[i]
    if (kind === 'cover' || kind === 'source') return
    const { width: W, height: H } = page.getSize()
    const L = (a5 ? 12 : 17) * MM, R = W - L
    const y = mm => H - mm * MM * k
    if (kind === 'body') {
      const lh = 11.9 * MM * k, lw = lh * (logo.width / logo.height)
      page.drawImage(logo, { x: L, y: y(22.4), width: lw, height: lh })
      page.drawText('CITY CONSTRUCTION GROUP', { x: L + 14 * MM * k, y: y(15.8), size: 9 * k, font: fb, color: INK })
      page.drawText(d.running_title || '', { x: L + 14 * MM * k, y: y(20.4), size: 8.5 * k, font: fb, color: GREEN })
      const right = `${d.ref}  ·  ${d.issue}  ·  ${d.date_short}`
      page.drawText(right, { x: R - fr.widthOfTextAtSize(right, 7.8 * k), y: y(15.8), size: 7.8 * k, font: fr, color: GREY })
      if (d.status_short) page.drawText(d.status_short, { x: R - fb.widthOfTextAtSize(d.status_short, 7.8 * k), y: y(20.4), size: 7.8 * k, font: fb, color: AMBER })
      page.drawLine({ start: { x: L, y: y(24.6) }, end: { x: R, y: y(24.6) }, thickness: 0.7, color: GREEN })
    }
    const fy = (a5 ? 8 : 10.5) * MM
    page.drawLine({ start: { x: L, y: fy + 4.2 * MM }, end: { x: R, y: fy + 4.2 * MM }, thickness: 0.5, color: LINE })
    page.drawText(left, { x: L, y: fy, size: 7, font: fr, color: GREY })
    const num = `Page ${i + 1} of ${total}`
    page.drawText(num, { x: R - fb.widthOfTextAtSize(num, 7.5), y: fy, size: 7.5, font: fb, color: INK })
  })

  // Bookmarks
  const entries = [{ title: 'Cover', page: 0, level: 1 }, { title: 'Contents and document control', page: 1, level: 1 }]
  pack.sections.forEach(s => entries.push({ title: `${s.num}  ${s.title}`, page: pages[s.id] - 1, level: 1 }))
  if (apps.length) {
    entries.push({ title: 'Appendices', page: apps[0].divider - 1, level: 1 })
    apps.forEach(a => {
      entries.push({ title: `Appendix ${a.letter} — ${a.title}`, page: a.divider - 1, level: 2 })
      ;(a.bookmarks || []).forEach(([t, n]) => entries.push({ title: t, page: a.first + n - 2, level: 3 }))
    })
  }
  writeOutline(doc, entries)
  doc.setTitle(`${pack.job.name} — ${d.title}`)
  doc.setAuthor('City Construction Group Ltd')
  doc.setSubject(d.kind || 'Operation & Maintenance Manual')
  doc.setCreator('CCG BuildCore — O&M builder')
  doc.setProducer('CCG BuildCore')
  return { bytes: await doc.save(), pages: total, pageMap: pages }
}
