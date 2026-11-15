import { fillMissingFormulaValues } from './xlsxFormulas'
// Reads the retention / release rates written into an existing cashflow
// forecast, so a regenerate can keep the release rate the job was set up
// with (e.g. "Less Retention 3%" / "Plus Retention Release 1.5% (at PC)").
// Read-only: the file is downloaded and scanned, never changed.

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  return window.XLSX
}

const pctIn = (s, re) => {
  const m = String(s).match(re)
  if (!m) return null
  const v = parseFloat(m[1]) / 100
  return v >= 0 && v < 1 ? v : null
}

// → { retention: 0.03 | null, release: 0.015 | null }
export async function readCffRates(arrayBuffer) {
  const XLSX = await loadSheetJs()
  const wb = XLSX.read(arrayBuffer, { type: 'array', sheetStubs: true })
  fillMissingFormulaValues(wb)   // formulas saved without results
  let retention = null, release = null
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue
      const v = ws[addr]?.v
      if (typeof v !== 'string' || !/retention/i.test(v)) continue
      if (release == null) release = pctIn(v, /retention\s+release\D*?(\d+(?:\.\d+)?)\s*%/i)
      if (retention == null) retention = pctIn(v, /less\s+retention\D*?(\d+(?:\.\d+)?)\s*%/i)
      if (retention != null && release != null) return { retention, release }
    }
  }
  return { retention, release }
}
