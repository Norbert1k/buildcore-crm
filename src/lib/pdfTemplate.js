// src/lib/pdfTemplate.js
//
// Shared CCG branding helpers for pdf-lib based exports
// (H&S Handover, O&M Section 8, Case Study).

// Helper: convert raw {r,g,b} to a real pdf-lib Color via window.PDFLib.rgb()
// pdf-lib must be loaded by the caller before these helpers are used.
function c(rawColor) {
  if (!rawColor) return undefined
  if (!window.PDFLib?.rgb) throw new Error('pdf-lib not loaded — call after loading the script')
  return window.PDFLib.rgb(rawColor.r, rawColor.g, rawColor.b)
}

// Public helper for caller code to wrap brand colors before passing to drawText/drawRectangle.
// Usage: import { bc, BRAND } from '../lib/pdfTemplate'; page.drawText('hi', { color: bc(BRAND.green) })
export const bc = c

export const BRAND = {
  green: { r: 0.267, g: 0.541, b: 0.251 },     // #448a40
  greenDark: { r: 0.149, g: 0.302, b: 0.149 },
  text: { r: 0.106, g: 0.106, b: 0.106 },       // #1a1a1a
  muted: { r: 0.55, g: 0.55, b: 0.55 },
  hint:  { r: 0.7, g: 0.7, b: 0.7 },
  divider: { r: 0.812, g: 0.812, b: 0.812 },
  white: { r: 1, g: 1, b: 1 },
}

// Format a date as "26 April 2026" (UK long form)
export function fmtDateLong(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Load CCG logo (JPEG) from /public/cltd-logo.jpg, returns { embedded, dims } or null on failure
export async function loadLogo(pdfDoc) {
  try {
    const resp = await fetch('/cltd-logo.jpg')
    if (!resp.ok) return null
    const bytes = await resp.arrayBuffer()
    const img = await pdfDoc.embedJpg(bytes)
    return { img, w: img.width, h: img.height }
  } catch (e) { console.warn('[pdfTemplate] logo load failed', e); return null }
}

// ─────────────────────────────────────────────────────────
// COVER PAGE — letterhead at top, content below
// ─────────────────────────────────────────────────────────
//
// Layout (matches the on-screen mockup approved by user):
//   - Top: same letterhead as content pages (logo right, address+contact left, divider)
//   - Mid: eyebrow ("PROJECT CASE STUDY"), big title, optional subtitle, divider, project name + address block
//   - Bottom: PREPARED BY + DATE pinned near bottom in two columns, thin divider, small confidential line
//
// `opts` = { eyebrow, title, subtitle?, projectName, addressLines: string[], preparedBy?, date? }
export function drawCover(page, fonts, logo, opts) {
  const { width, height } = page.getSize()
  const { boldFont, regFont } = fonts
  const { eyebrow, title, subtitle, projectName, addressLines = [], preparedBy = 'City Construction Group', date = fmtDateLong() } = opts

  // Reuse the same letterhead used on every content page — returns Y where content can start
  const startY = drawLetterhead(page, fonts, logo)

  // Generous breathing room below the letterhead before the title block
  let y = startY - 110

  if (eyebrow) {
    page.drawText(eyebrow.toUpperCase(), {
      x: 40, y, size: 10, font: regFont, color: c(BRAND.muted),
    })
    y -= 24
  }

  // Big title
  page.drawText(title, {
    x: 40, y, size: 32, font: boldFont, color: c(BRAND.text),
  })
  y -= 38

  if (subtitle) {
    page.drawText(subtitle, {
      x: 40, y, size: 22, font: boldFont, color: c(BRAND.text),
    })
    y -= 30
  }

  // Divider
  page.drawRectangle({ x: 40, y: y - 4, width: width - 80, height: 0.5, color: c(BRAND.divider) })
  y -= 26

  // Project name (bold) — for case study this is "Client: <name>", for H&S this is the project name
  if (projectName) {
    page.drawText(projectName, { x: 40, y, size: 13, font: boldFont, color: c(BRAND.text) })
    y -= 18
  }

  // Address block (each line muted)
  for (const line of addressLines) {
    if (!line) continue
    page.drawText(line, { x: 40, y, size: 11, font: regFont, color: c(BRAND.muted) })
    y -= 14
  }

  // ── PREPARED BY / DATE pinned to lower portion of the page ──
  // Two columns side-by-side, label above value
  const metaTopY = 110   // points up from page bottom
  page.drawText('PREPARED BY', { x: 40, y: metaTopY, size: 8, font: regFont, color: c(BRAND.hint) })
  page.drawText(preparedBy, { x: 40, y: metaTopY - 14, size: 11, font: regFont, color: c(BRAND.text) })

  page.drawText('DATE', { x: 220, y: metaTopY, size: 8, font: regFont, color: c(BRAND.hint) })
  page.drawText(date, { x: 220, y: metaTopY - 14, size: 11, font: regFont, color: c(BRAND.text) })

  // Bottom thin divider + small confidential line
  page.drawRectangle({ x: 32, y: 60, width: width - 64, height: 0.4, color: c(BRAND.divider) })
  page.drawText('CONFIDENTIAL — CITY CONSTRUCTION LTD', {
    x: 32, y: 44, size: 7, font: regFont, color: c(BRAND.hint),
  })
}

// ─────────────────────────────────────────────────────────
// CONTENT-PAGE LETTERHEAD (matches Progress Report)
// ─────────────────────────────────────────────────────────
// Top-left: company name + address + contact line
// Top-right: CCG logo
// Below: thin divider line
//
// 28mm logo standard (matches TaskTracker, Progress Report content pages,
// Project Directory/Procurement export). Logo height fixed; width auto-derives
// from source aspect ratio so the chevron/text are not stretched.
//
// Conversion notes (jsPDF mm-spec → pdf-lib points, 1mm = 2.835pt):
//   logo height 28mm → 79pt
//   logo right margin 12mm → 34pt; top margin 8mm → 23pt
//   name baseline at jsPDF y=16mm → pdf-lib y = height - 45
//   addr1 at jsPDF y=22mm → height - 62
//   addr2 at jsPDF y=26mm → height - 74
//   divider at jsPDF y=40mm → height - 113
//   content start at jsPDF y=46mm → height - 130
//
// Returns Y coordinate where content can start (below the letterhead)
export function drawLetterhead(page, fonts, logo) {
  const { width, height } = page.getSize()
  const { boldFont, regFont } = fonts

  // Logo top-right (~28mm = 79pt height; width preserves source aspect)
  if (logo?.img) {
    const h = 79
    const w = (logo.w / logo.h) * h
    page.drawImage(logo.img, {
      x: width - 34 - w, y: height - 23 - h,
      width: w, height: h,
    })
  }

  // Company info top-left
  page.drawText('City Construction Group', {
    x: 32, y: height - 45, size: 14, font: boldFont, color: c(BRAND.text),
  })
  page.drawText('One Canada Square, Canary Wharf, London E14 5AA', {
    x: 32, y: height - 62, size: 7.5, font: regFont, color: c(BRAND.muted),
  })
  page.drawText('T: 0203 948 1930   E: info@cltd.co.uk   W: www.cltd.co.uk', {
    x: 32, y: height - 74, size: 7.5, font: regFont, color: c(BRAND.muted),
  })

  // Divider line
  page.drawRectangle({
    x: 32, y: height - 113, width: width - 64, height: 0.4,
    color: c(BRAND.divider),
  })

  // Return Y where content can start (below divider with breathing room)
  return height - 130
}

// ─────────────────────────────────────────────────────────
// FOOTER on every content page (page X of Y + report id)
// ─────────────────────────────────────────────────────────
export function drawFooter(page, fonts, leftText, pageNum, totalPages) {
  const { width } = page.getSize()
  const { regFont } = fonts
  if (leftText) page.drawText(leftText, { x: 32, y: 18, size: 8, font: regFont, color: c(BRAND.hint) })
  page.drawText(`Page ${pageNum} of ${totalPages}`, {
    x: width - 100, y: 18, size: 8, font: regFont, color: c(BRAND.hint),
  })
}

// ─────────────────────────────────────────────────────────
// CLICKABLE INTERNAL LINK ANNOTATION
// ─────────────────────────────────────────────────────────
// pdf-lib doesn't have a high-level "go to page" API but we can build the
// annotation manually using its low-level dict primitives.
//
// page: the page where the link sits (the TOC page)
// rect: { x, y, w, h } in points — the clickable area
// targetPage: the destination page object (where the click jumps to)
//
// Uses /Dest with /Fit: opens at the top-left of the target page, fitted to viewport.
export function addInternalLink(pdfDoc, page, rect, targetPage) {
  const { PDFDict, PDFName, PDFArray, PDFNumber, PDFString, PDFRef } = window.PDFLib

  // Build the link annotation as a raw dictionary
  const linkAnnot = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
    Border: [0, 0, 0],   // no visible border
    Dest: [targetPage.ref, 'Fit'],
  })

  const annotRef = pdfDoc.context.register(linkAnnot)

  // Append to the page's /Annots array (create one if missing)
  const existingAnnots = page.node.lookup(PDFName.of('Annots'))
  if (existingAnnots) {
    existingAnnots.push(annotRef)
  } else {
    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([annotRef]))
  }
}
