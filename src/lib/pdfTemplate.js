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
// COVER PAGE (Option B — premium client-facing)
// ─────────────────────────────────────────────────────────
//
// Layout:
//   - Top green band (22% page height): white logo mark + "CITY CONSTRUCTION GROUP" + small contact line
//   - Mid: "DOCUMENT TYPE" eyebrow, big title, project name, divider, address block, prepared-by/date metadata
//   - Bottom green band (5%): "CONFIDENTIAL — CITY CONSTRUCTION LTD"
//
// `opts` = { eyebrow, title, subtitle?, projectName, addressLines: string[], preparedBy?, date? }
export function drawCover(page, fonts, logo, opts) {
  const { width, height } = page.getSize()
  const { boldFont, regFont } = fonts
  const { eyebrow, title, subtitle, projectName, addressLines = [], preparedBy = 'City Construction Group', date = fmtDateLong() } = opts

  // Top green band
  const bandH = height * 0.22
  page.drawRectangle({ x: 0, y: height - bandH, width, height: bandH, color: c(BRAND.green) })

  // Logo (white square with green diamond) on the green band, top-left
  if (logo?.img) {
    const sz = 28
    const gap = 10
    page.drawRectangle({ x: 32, y: height - 56, width: sz, height: sz, color: c(BRAND.white) })
    // Inset logo slightly to give padding
    page.drawImage(logo.img, { x: 32 + 4, y: height - 56 + 4, width: sz - 8, height: sz - 8 })
    page.drawText('CITY CONSTRUCTION GROUP', {
      x: 32 + sz + gap, y: height - 44,
      size: 11, font: boldFont, color: c(BRAND.white),
    })
    page.drawText('cltd.co.uk · info@cltd.co.uk · 0203 948 1930', {
      x: 32 + sz + gap, y: height - 60,
      size: 8, font: regFont, color: c(BRAND.white),
      opacity: 0.8,
    })
  } else {
    page.drawText('CITY CONSTRUCTION GROUP', {
      x: 32, y: height - 44,
      size: 11, font: boldFont, color: c(BRAND.white),
    })
    page.drawText('cltd.co.uk · info@cltd.co.uk · 0203 948 1930', {
      x: 32, y: height - 60,
      size: 8, font: regFont, color: c(BRAND.white), opacity: 0.8,
    })
  }

  // ─ Title section (mid page) ─
  let y = height - bandH - 70

  if (eyebrow) {
    page.drawText(eyebrow.toUpperCase(), {
      x: 40, y, size: 9, font: regFont, color: c(BRAND.muted),
      // letter-spacing isn't directly supported by pdf-lib drawText; spacing baked into the text if needed
    })
    y -= 22
  }

  page.drawText(title, {
    x: 40, y, size: 28, font: boldFont, color: c(BRAND.text),
  })
  y -= 32

  if (subtitle) {
    page.drawText(subtitle, {
      x: 40, y, size: 18, font: boldFont, color: c(BRAND.text),
    })
    y -= 26
  }

  // Divider
  page.drawRectangle({ x: 40, y: y - 6, width: width - 80, height: 0.8, color: c(BRAND.divider) })
  y -= 24

  // Project name (bold)
  if (projectName) {
    page.drawText(projectName, { x: 40, y, size: 13, font: boldFont, color: c(BRAND.text) })
    y -= 16
  }

  // Address block
  for (const line of addressLines) {
    if (!line) continue
    page.drawText(line, { x: 40, y, size: 11, font: regFont, color: c(BRAND.muted) })
    y -= 14
  }

  y -= 30

  // Prepared by / Date metadata
  page.drawText('PREPARED BY', { x: 40, y, size: 8, font: regFont, color: c(BRAND.hint) })
  y -= 12
  page.drawText(preparedBy, { x: 40, y, size: 11, font: regFont, color: c(BRAND.text) })
  y -= 24

  page.drawText('DATE', { x: 40, y, size: 8, font: regFont, color: c(BRAND.hint) })
  y -= 12
  page.drawText(date, { x: 40, y, size: 11, font: regFont, color: c(BRAND.text) })

  // ─ Bottom green band ─
  const footH = 26
  page.drawRectangle({ x: 0, y: 0, width, height: footH, color: c(BRAND.green) })
  page.drawText('CONFIDENTIAL — CITY CONSTRUCTION LTD', {
    x: 32, y: 9, size: 8, font: boldFont, color: c(BRAND.white), opacity: 0.95,
  })
}

// ─────────────────────────────────────────────────────────
// CONTENT-PAGE LETTERHEAD (matches Progress Report)
// ─────────────────────────────────────────────────────────
// Top-left: company name + address + contact line
// Top-right: CCG logo
// Below: thin divider line
//
// Returns Y coordinate where content can start (below the letterhead)
export function drawLetterhead(page, fonts, logo) {
  const { width, height } = page.getSize()
  const { boldFont, regFont } = fonts

  // Logo top-right (22x22 mm equivalent — pdf-lib uses points: 22mm ≈ 62pt)
  if (logo?.img) {
    const sz = 56  // points (~20mm)
    page.drawImage(logo.img, {
      x: width - 32 - sz, y: height - 30 - sz,
      width: sz, height: sz,
    })
  }

  // Company info top-left
  page.drawText('City Construction Group', {
    x: 32, y: height - 38, size: 13, font: boldFont, color: c(BRAND.text),
  })
  page.drawText('One Canada Square, Canary Wharf, London E14 5AA', {
    x: 32, y: height - 52, size: 7.5, font: regFont, color: c(BRAND.muted),
  })
  page.drawText('T: 0203 948 1930   E: info@cltd.co.uk   W: www.cltd.co.uk', {
    x: 32, y: height - 62, size: 7.5, font: regFont, color: c(BRAND.muted),
  })

  // Divider line
  page.drawRectangle({
    x: 32, y: height - 96, width: width - 64, height: 0.4,
    color: c(BRAND.divider),
  })

  // Return Y where content can start (below divider with breathing room)
  return height - 110
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
