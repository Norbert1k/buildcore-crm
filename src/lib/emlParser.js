// src/lib/emlParser.js
//
// Parse RFC 822 / MIME .eml files for in-browser display.
//
// Handles common production cases:
//   • Outlook desktop exports (multipart/mixed → multipart/alternative
//     → text/plain + text/html, each base64-encoded)
//   • Gmail "Show original" downloads (quoted-printable + multipart)
//   • Apple Mail exports
//   • Plain single-part .eml files
//
// What it DOESN'T do (intentionally — kept simple):
//   • Extract attachments (we just show the body)
//   • Decode TNEF / winmail.dat
//   • Handle S/MIME signing / encryption
//   • Render inline image attachments
//
// For anything weird the parser can't handle, the EML viewer always
// offers a Download button so the user can open the file in their
// mail client.

// ─── Top-level entrypoint ─────────────────────────────────────────────

export function parseEml(text) {
  // Split headers / body at the first blank line. CRLF or LF tolerated.
  const headerEnd = text.search(/\r?\n\r?\n/)
  if (headerEnd < 0) {
    // No body found — treat the entire input as headers and show empty body.
    return { headers: {}, subject: '(no subject)', body: '', isHtml: false }
  }
  const headerText = text.slice(0, headerEnd)
  const rawBody = text.slice(headerEnd).replace(/^\r?\n\r?\n/, '')
  const headers = parseHeaders(headerText)
  const contentType = headers['content-type'] || 'text/plain'
  const cte = (headers['content-transfer-encoding'] || '7bit').toLowerCase()
  // Walk MIME structure to find the best displayable body.
  const part = findBestPart({ headers, body: rawBody, contentType, cte })
  return {
    from:    decodeHeader(headers.from || ''),
    to:      decodeHeader(headers.to || ''),
    cc:      decodeHeader(headers.cc || ''),
    subject: decodeHeader(headers.subject || '') || '(no subject)',
    date:    headers.date || '',
    body:    part.text,
    isHtml:  part.isHtml,
  }
}

// ─── Header parsing ───────────────────────────────────────────────────

function parseHeaders(headerText) {
  const headers = {}
  const lines = headerText.split(/\r?\n/)
  let current = null
  for (const line of lines) {
    // Header continuation: leading whitespace means fold into previous header.
    if (/^[\t ]/.test(line) && current) {
      headers[current] += ' ' + line.trim()
      continue
    }
    const m = line.match(/^([^:]+):\s*(.*)$/)
    if (m) {
      current = m[1].toLowerCase().trim()
      headers[current] = m[2]
    }
  }
  return headers
}

// RFC 2047 encoded-word decoding for header values.
// Example: "=?UTF-8?B?Zm9v?=" → "foo"
//          "=?UTF-8?Q?Hello=20World?=" → "Hello World"
function decodeHeader(value) {
  if (!value) return ''
  // Multiple encoded-words separated by whitespace should be merged
  // without preserving the separator (RFC 2047 §5).
  let result = value
  result = result.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+)(?==\?)/g, '=?$1?$2?$3?=')
  // Decode each encoded-word.
  result = result.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, payload) => {
    try {
      let bytes
      if (enc.toUpperCase() === 'B') {
        bytes = base64ToBytes(payload)
      } else {
        // Q encoding: like quoted-printable but with _ for space
        const qp = payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        )
        bytes = new Uint8Array(qp.length)
        for (let i = 0; i < qp.length; i++) bytes[i] = qp.charCodeAt(i) & 0xff
      }
      return bytesToText(bytes, charset)
    } catch {
      return ''
    }
  })
  return result
}

// ─── MIME part walking ────────────────────────────────────────────────

// Walks the MIME tree and returns the best displayable part.
// Preference: text/plain > text/html. For text/html, returns isHtml=true
// so the viewer renders it in a sandboxed iframe.
function findBestPart(node) {
  const ct = (node.contentType || '').toLowerCase()
  // Multipart: recurse into each sub-part.
  if (ct.startsWith('multipart/')) {
    const boundary = extractBoundary(node.contentType)
    if (!boundary) return { text: '(could not read email — malformed multipart)', isHtml: false }
    const subparts = splitMultipart(node.body, boundary).map(parseSubpart)
    // multipart/alternative: prefer the LAST text/plain or text/html
    // (RFC convention: last is the richest). For us, prefer text/plain
    // because it's safer to render. If there's no text/plain, fall back
    // to text/html.
    if (ct.includes('alternative')) {
      const plain = findFirst(subparts, sp => (sp.contentType || '').toLowerCase().startsWith('text/plain'))
      if (plain) return findBestPart(plain)
      const html = findFirst(subparts, sp => (sp.contentType || '').toLowerCase().startsWith('text/html'))
      if (html) return findBestPart(html)
    }
    // multipart/mixed / multipart/related / etc — find first text part
    // (recursing into nested multiparts).
    for (const sp of subparts) {
      const result = findBestPart(sp)
      if (result.text) return result
    }
    return { text: '(no readable body found)', isHtml: false }
  }
  // Leaf part — decode based on its own content-transfer-encoding.
  const cte = (node.cte || '7bit').toLowerCase()
  const charset = extractCharset(node.contentType) || 'utf-8'
  let bytes
  if (cte === 'base64') {
    bytes = base64ToBytes(node.body.replace(/\s+/g, ''))
  } else if (cte === 'quoted-printable') {
    const decoded = decodeQP(node.body)
    bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i) & 0xff
  } else {
    // 7bit, 8bit, binary — treat as raw text using the declared charset.
    bytes = new Uint8Array(node.body.length)
    for (let i = 0; i < node.body.length; i++) bytes[i] = node.body.charCodeAt(i) & 0xff
  }
  const text = bytesToText(bytes, charset)
  return { text, isHtml: ct.startsWith('text/html') }
}

function parseSubpart(raw) {
  // A subpart has its own headers separated from its body by a blank line.
  const headerEnd = raw.search(/\r?\n\r?\n/)
  if (headerEnd < 0) return { headers: {}, contentType: 'text/plain', cte: '7bit', body: raw }
  const headers = parseHeaders(raw.slice(0, headerEnd))
  const body = raw.slice(headerEnd).replace(/^\r?\n\r?\n/, '')
  return {
    headers,
    contentType: headers['content-type'] || 'text/plain',
    cte: (headers['content-transfer-encoding'] || '7bit').toLowerCase(),
    body,
  }
}

function splitMultipart(body, boundary) {
  // Split at "--<boundary>" but exclude the prologue (before first boundary)
  // and the epilogue (after closing "--<boundary>--").
  const marker = '--' + boundary
  const parts = body.split(marker)
  // Drop the first chunk (prologue) and last chunk (epilogue).
  return parts.slice(1, -1)
    .map(p => p.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
}

function extractBoundary(contentType) {
  const m = contentType.match(/boundary\s*=\s*"?([^";]+)"?/i)
  return m ? m[1] : null
}

function extractCharset(contentType) {
  const m = (contentType || '').match(/charset\s*=\s*"?([^";]+)"?/i)
  return m ? m[1].toLowerCase() : null
}

function findFirst(arr, predicate) {
  for (const item of arr) {
    if (predicate(item)) return item
    // Recurse into nested multiparts.
    if ((item.contentType || '').toLowerCase().startsWith('multipart/')) {
      const boundary = extractBoundary(item.contentType)
      if (boundary) {
        const sub = splitMultipart(item.body, boundary).map(parseSubpart)
        const r = findFirst(sub, predicate)
        if (r) return r
      }
    }
  }
  return null
}

// ─── Encoding helpers ─────────────────────────────────────────────────

function base64ToBytes(str) {
  // Strip whitespace + padding artefacts before atob.
  const clean = str.replace(/\s+/g, '')
  // atob throws on bad input — wrap.
  try {
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

function decodeQP(str) {
  // Quoted-printable: =<HEX><HEX> → byte. Soft line break =\n → remove.
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function bytesToText(bytes, charset) {
  // Use the browser's built-in TextDecoder. Supports utf-8, iso-8859-1,
  // windows-1252, etc. Fall back to utf-8 with replacement chars.
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } catch {
      // Last-resort latin1.
      let out = ''
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
      return out
    }
  }
}
