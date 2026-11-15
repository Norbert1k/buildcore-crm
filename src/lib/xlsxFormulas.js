// ─────────────────────────────────────────────────────────────────────────────
// xlsxFormulas.js
//
// Some programs save a spreadsheet with its formulas but WITHOUT their
// results (e.g. a PA re-saved after the client's QS certified it). Excel and
// Office Online recalculate on screen, so it looks fine — but SheetJS only
// reads saved results, so every formula cell (totals, VO values, subtotals,
// cumulative) came back empty and the CRM showed the wrong figures.
//
// Read with XLSX.read(data, { ..., sheetStubs: true }), then
// fillMissingFormulaValues(wb) works those results out for the formulas a
// PA / CFF / CSA uses — arithmetic, cell references (incl. other sheets),
// SUM / ROUND / ABS / MIN / MAX / IF / AND / OR / NOT / ISNUMBER / IFERROR — and writes them into the
// workbook before it's read. Cells that already have a saved result are
// never touched. Anything it can't work out is left empty, as before.
// ─────────────────────────────────────────────────────────────────────────────

const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }
const colStr = n => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const parseAddr = a => { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(a); return m ? { c: colNum(m[1]), r: Number(m[2]) - 1 } : null }

// A formula with no saved result. Read with { sheetStubs: true } — without it
// SheetJS drops these cells entirely; with it they come back as type 'z'.
const missing = cell => !!cell && !!cell.f && (cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '')

function tokenize(src) {
  const out = []
  let i = 0
  const ref = /^(?:((?:'(?:[^']|'')+')|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    const rest = src.slice(i)
    let m
    if ((m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue }
    if ((m = ref.exec(rest)) && rest[m[0].length] !== '(') {
      // A1, $A$1, A1:B9, Sheet!A1, 'My Sheet'!A1:B2
      let sheet = m[1] || null
      if (sheet && sheet.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'")
      out.push({ t: 'ref', sheet, a: m[2], b: m[3] || null }); i += m[0].length; continue
    }
    if ((m = /^[A-Za-z_][\w.]*(?=\()/.exec(rest))) { out.push({ t: 'fn', v: m[0].toUpperCase() }); i += m[0].length; continue }
    if ((m = /^(TRUE|FALSE)\b/i.exec(rest))) { out.push({ t: 'num', v: m[0].toUpperCase() === 'TRUE' ? 1 : 0 }); i += m[0].length; continue }
    if (ch === '"') { const j = src.indexOf('"', i + 1); out.push({ t: 'str', v: src.slice(i + 1, j < 0 ? src.length : j) }); i = j < 0 ? src.length : j + 1; continue }
    if ((m = /^(<=|>=|<>|[-+*/^%(),:<>=&])/.exec(rest))) { out.push({ t: 'op', v: m[0] }); i += m[0].length; continue }
    throw new Error('Unsupported formula: ' + src)
  }
  return out
}

export function fillMissingFormulaValues(wb) {
  if (!wb?.Sheets) return 0
  const busy = new Set()
  let filled = 0

  function cellValue(sheetName, addr, depth) {
    const ws = wb.Sheets[sheetName]
    const cell = ws?.[addr.replace(/\$/g, '')]
    if (!cell || (cell.t === 'z' && !cell.f)) return null
    if (missing(cell)) {
      const v = evaluate(sheetName, addr.replace(/\$/g, ''), depth + 1)
      return v
    }
    return cell.v ?? null
  }

  function evaluate(sheetName, addr, depth = 0) {
    const ws = wb.Sheets[sheetName]
    const cell = ws?.[addr]
    if (!cell) return null
    if (!missing(cell)) return cell.t === 'z' ? null : (cell.v ?? null)
    const key = sheetName + '!' + addr
    if (busy.has(key) || depth > 200) return null   // circular or too deep
    busy.add(key)
    let v = null
    try { v = run(sheetName, String(cell.f), depth) } catch { v = null }
    busy.delete(key)
    if (Array.isArray(v)) v = v[0] ?? null
    if (typeof v === 'number' && Number.isFinite(v)) { cell.v = v; cell.t = 'n'; filled++ }
    else if (typeof v === 'string') { cell.v = v; cell.t = 's'; filled++ }
    else v = null
    return v
  }

  function rangeValues(sheetName, a, b, depth) {
    const s = parseAddr(a), e = parseAddr(b)
    if (!s || !e) return []
    const out = []
    for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r); r++)
      for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++)
        out.push(cellValue(sheetName, colStr(c) + (r + 1), depth))
    return out
  }

  function run(sheetName, formula, depth) {
    const tk = tokenize(formula.replace(/^=/, ''))
    let p = 0
    const peek = () => tk[p]
    const isOp = v => peek()?.t === 'op' && peek().v === v
    const num = x => {
      if (Array.isArray(x)) x = x[0]
      if (typeof x === 'number') return x
      if (typeof x === 'boolean') return x ? 1 : 0
      if (x == null || x === '') return 0
      const n = Number(String(x).replace(/[£,\s]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const flat = args => args.flat(Infinity).filter(x => typeof x === 'number')

    function primary() {
      const t = tk[p++]
      if (!t) throw new Error('end')
      if (t.t === 'num' || t.t === 'str') return t.v
      if (t.t === 'ref') {
        const sh = t.sheet || sheetName
        return t.b ? rangeValues(sh, t.a, t.b, depth) : cellValue(sh, t.a, depth)
      }
      if (t.t === 'fn') {
        p++ // (
        const args = []
        if (!isOp(')')) { args.push(compare()); while (isOp(',')) { p++; args.push(compare()) } }
        if (!isOp(')')) throw new Error('paren'); p++
        switch (t.v) {
          case 'SUM': return flat(args).reduce((s, x) => s + x, 0)
          case 'ROUND': { const f = 10 ** num(args[1]); return Math.round(num(args[0]) * f) / f }
          case 'ROUNDUP': { const f = 10 ** num(args[1]); const x = num(args[0]); return Math.sign(x) * Math.ceil(Math.abs(x) * f) / f }
          case 'ROUNDDOWN': { const f = 10 ** num(args[1]); const x = num(args[0]); return Math.sign(x) * Math.floor(Math.abs(x) * f) / f }
          case 'ABS': return Math.abs(num(args[0]))
          case 'MIN': { const v = flat(args); return v.length ? Math.min(...v) : 0 }
          case 'MAX': { const v = flat(args); return v.length ? Math.max(...v) : 0 }
          case 'IF': return num(args[0]) ? (args[1] ?? 1) : (args[2] ?? 0)
          case 'AND': return args.flat(Infinity).every(x => num(x)) ? 1 : 0
          case 'OR': return args.flat(Infinity).some(x => num(x)) ? 1 : 0
          case 'NOT': return num(args[0]) ? 0 : 1
          case 'ISNUMBER': { const x = Array.isArray(args[0]) ? args[0][0] : args[0]; return typeof x === 'number' ? 1 : 0 }
          case 'ISTEXT': { const x = Array.isArray(args[0]) ? args[0][0] : args[0]; return typeof x === 'string' && x !== '' ? 1 : 0 }
          case 'ISBLANK': { const x = Array.isArray(args[0]) ? args[0][0] : args[0]; return x == null || x === '' ? 1 : 0 }
          case 'IFERROR': return args[0] == null ? args[1] : args[0]
          default: throw new Error('fn ' + t.v)
        }
      }
      if (t.t === 'op' && t.v === '(') { const v = compare(); if (!isOp(')')) throw new Error('paren'); p++; return v }
      if (t.t === 'op' && t.v === '-') return -num(unary())
      if (t.t === 'op' && t.v === '+') return num(unary())
      throw new Error('token ' + t.v)
    }
    function unary() { let v = primary(); while (isOp('%')) { p++; v = num(v) / 100 } return v }
    function power() { let v = unary(); while (isOp('^')) { p++; v = num(v) ** num(unary()) } return v }
    function term() {
      let v = power()
      while (isOp('*') || isOp('/')) {
        const op = tk[p++].v, r = num(power())
        if (op === '/' && r === 0) throw new Error('#DIV/0')
        v = op === '*' ? num(v) * r : num(v) / r
      }
      return v
    }
    function sum() { let v = term(); while (isOp('+') || isOp('-')) { const op = tk[p++].v; v = op === '+' ? num(v) + num(term()) : num(v) - num(term()) } return v }
    function concat() { let v = sum(); while (isOp('&')) { p++; v = String(v ?? '') + String(sum() ?? '') } return v }
    function compare() {
      let v = concat()
      while (['=', '<>', '<', '>', '<=', '>='].some(isOp)) {
        const op = tk[p++].v, r = concat()
        const a = typeof v === 'string' || typeof r === 'string' ? String(v ?? '') : num(v)
        const b = typeof v === 'string' || typeof r === 'string' ? String(r ?? '') : num(r)
        v = (op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b) ? 1 : 0
      }
      return v
    }
    const v = compare()
    if (p !== tk.length) throw new Error('trailing')
    return v
  }

  for (const name of wb.SheetNames || Object.keys(wb.Sheets)) {
    const ws = wb.Sheets[name]
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue
      if (missing(ws[addr])) evaluate(name, addr)
    }
  }
  // Anything still a stub (blank cells, formulas it couldn't work out) is
  // removed — exactly how the sheet read before stubs were switched on.
  for (const name of wb.SheetNames || Object.keys(wb.Sheets)) {
    const ws = wb.Sheets[name]
    for (const addr of Object.keys(ws)) if (addr[0] !== '!' && ws[addr]?.t === 'z') delete ws[addr]
  }
  return filled
}
