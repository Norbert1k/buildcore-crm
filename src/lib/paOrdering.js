// ─────────────────────────────────────────────────────────────────────────────
// paOrdering.js
//
// Single source of truth for PA file ordering across the CRM. Mirror of the
// portal's paOrdering.ts — keep these two files in sync if you change the
// parsing rules.
//
// Replaces the previous "sort by created_at" approach which was fragile: any
// PA reupload would write a fresh created_at and bump that PA out of order,
// breaking downstream financial calculations and CFF generator output.
//
// New behaviour:
//   • Parse PA number from filename (`^PA\d+` at start, case-insensitive)
//   • Sort by parsed PA number — PA01 < PA02 < PA10 (numeric, not lexical)
//   • Filenames that don't parse fall back to created_at ordering AFTER the
//     parsed ones (parsed PAs are more authoritative than incidental drafts)
// ─────────────────────────────────────────────────────────────────────────────

// Parse the PA number from a filename. Matches /^PA(\d+)/i — must be at the
// very start of the filename, case-insensitive, no separator between PA and
// the digits. Returns the integer or null if the filename doesn't match.
//
// Examples:
//   "PA01.xlsx"            → 1
//   "PA1 Bishops.xlsx"     → 1
//   "pa001 draft.xlsx"     → 1
//   "PA10 Sports Hall.xlsx"→ 10
//   "Bishops PA01.xlsx"    → null  (PA not at start)
//   "PA-01.xlsx"           → null  (separator between PA and digits)
//   "Application 1.xlsx"   → null
//   "Draft.xlsx"           → null
export function paNumberFromFilename(filename) {
  if (!filename) return null
  const m = filename.match(/^PA(\d+)/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n)) return null
  return n
}

// Sort PA-file rows by parsed PA number, with unparseable filenames at the
// end (or beginning, depending on `direction`) ordered by created_at.
//
// Direction semantics:
//   • 'asc'  → PA01, PA02, ..., PA10, [unparsed by created_at ASC]
//   • 'desc' → PA10, ..., PA02, PA01, [unparsed by created_at DESC]
//
// Why unparsed always go AFTER parsed (regardless of direction):
//   The semantic question we're answering is "what's the most authoritative
//   PA?". A file named "PA02" is more authoritative than a file named
//   "Draft.xlsx" — even if the draft was uploaded later. So in DESC order
//   (newest-first), parsed PAs come first; in ASC order (oldest-first),
//   parsed PAs also come first because they form the canonical sequence.
//
// The function does NOT mutate the input array — returns a new sorted array.
export function sortPaRowsByPaNumber(rows, direction = 'desc') {
  const dir = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const aNum = paNumberFromFilename(a.file_name)
    const bNum = paNumberFromFilename(b.file_name)
    if (aNum != null && bNum != null) return (aNum - bNum) * dir
    if (aNum != null) return -1
    if (bNum != null) return 1
    const aDate = a.created_at ?? ''
    const bDate = b.created_at ?? ''
    if (aDate === bDate) return 0
    return aDate < bDate ? -dir : dir
  })
}
