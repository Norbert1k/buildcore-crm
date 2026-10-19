// ─────────────────────────────────────────────────────────────────────────────
// POST /api/om-render — prints and issues an O&M pack (Vercel function).
//
// Body: { project_id, issue: 'Issue 02', packs: { om, tenant? } }
// Only admin / project manager / operations manager / project director.
// For each pack: prints the CCG standard layout (server/omPrint.js), binds the
// appendix documents in from storage, saves the PDF to the job's Handover
// folder (hs_files, origin 'om_builder') and records it in om_issues.
// Nothing existing is changed or deleted.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { printPack } from '../server/omPrint.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEADS = ['admin', 'project_manager', 'operations_manager', 'project_director']
const BUCKET = { hs_files: 'hs-handover', project_doc_files: 'project-docs' }

const read = p => fs.readFileSync(path.join(ROOT, p))
// The print server has no Calibri/Carlito installed, so the fonts travel inside the HTML
const fontFace = (file, weight) => `@font-face{font-family:'Carlito';font-weight:${weight};src:url(data:font/ttf;base64,${read(file).toString('base64')}) format('truetype')}`
const assets = () => ({
  css: fontFace('server/fonts/Carlito-Regular.ttf', 400) + fontFace('server/fonts/Carlito-Bold.ttf', 700) + read('src/lib/omStyle.css').toString(),
  tenantCss: read('src/lib/omTenant.css').toString(),
  logoWhite: 'data:image/png;base64,' + read('src/assets/om/logo_white.png').toString('base64'),
  logoDark: read('src/assets/om/logo_dark.png'),
  fontRegular: read('server/fonts/Carlito-Regular.ttf'),
  fontBold: read('server/fonts/Carlito-Bold.ttf'),
})

// Where the issued PDF is filed in the Handover tree
function folderFor(kind, pack) {
  if (kind === 'tenant') return 's8-1'                 // 8.1 Residents Information Pack
  if (/roof/i.test(pack?.doc?.title || '')) return 's8-2' // 8.2 Façade & Roof Maintenance Information
  return 's8-3'                                          // 8.3 Cleaning and Maintenance
}
const safe = s => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
// Storage keys reject em/en dashes and other non-ASCII characters ("Invalid key")
const storageSafe = s => safe(s).replace(/[\u2014\u2013]/g, '-').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7E]/g, '').replace(/[#?%{}^~\[\]`]/g, '-').replace(/\s{2,}/g, ' ').trim() || 'manual.pdf'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Who is asking — must be signed in and allowed to issue
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const { data: { user } = {} } = await sb.auth.getUser(token)
  if (!user) return res.status(401).json({ error: 'Not signed in' })
  const { data: profile } = await sb.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!LEADS.includes(profile?.role)) return res.status(403).json({ error: 'Not allowed to issue' })

  const { project_id, packs } = req.body || {}
  if (!project_id || !packs?.om) return res.status(400).json({ error: 'project_id and packs.om are required' })

  // Next issue number, worked out here so two people can't issue the same number
  const { count } = await sb.from('om_issues').select('id', { count: 'exact', head: true }).eq('project_id', project_id).eq('kind', 'om')
  const issue = `Issue ${String((count || 0) + 1).padStart(2, '0')}`
  const today = new Date()
  const stamp = p => ({ ...p, doc: { ...p.doc, issue, status: null, status_short: null,
    date_short: today.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '.'),
    date_long: today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) } })

  // Appendix source files — each appendix names its file: { table, id }
  const loadSource = async a => {
    const table = a.file?.table
    if (!BUCKET[table]) throw new Error(`Appendix ${a.letter}: unknown source`)
    const { data: row } = await sb.from(table).select('storage_path, project_id').eq('id', a.file?.id).single()
    if (!row || row.project_id !== project_id) throw new Error(`Appendix ${a.letter}: source file not found on this job`)
    const { data, error } = await sb.storage.from(BUCKET[table]).download(row.storage_path)
    if (error) throw error
    return { bytes: new Uint8Array(await data.arrayBuffer()), name: row.storage_path }
  }

  // 1. Print every pack first — if anything fails, nothing is saved
  const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: chromium.headless ?? true })
  const printed = []
  try {
    const A = assets()
    for (const [kind, pack] of Object.entries(packs)) {
      if (!pack) continue
      const p = stamp(pack)
      const { bytes, pages } = await printPack(p, A, loadSource, browser)
      const label = kind === 'tenant' ? 'Tenant O&M' : 'O&M Manual'
      printed.push({ kind, bytes, pages, fileName: safe(`${p.job.name} — ${label} — ${issue}.pdf`), folder: folderFor(kind, p) })
    }
  } catch (e) {
    console.error('[om-render] print', e)
    return res.status(500).json({ error: 'Printing failed: ' + e.message })
  } finally {
    await browser.close()
  }

  // 2. Save each PDF into Handover › Section 8 and record the issue
  const out = []
  try {
    for (const f of printed) {
      const storagePath = `projects/${project_id}/hs/om/${Date.now()}-${storageSafe(f.fileName)}`
      const { error: upErr } = await sb.storage.from('hs-handover').upload(storagePath, f.bytes, { contentType: 'application/pdf' })
      if (upErr) throw new Error('Upload failed: ' + upErr.message)
      const { data: file, error: fErr } = await sb.from('hs_files').insert({
        project_id, folder_key: f.folder, file_name: f.fileName, file_size: f.bytes.length, storage_path: storagePath, origin: 'om_builder',
      }).select('id').single()
      if (fErr) throw new Error('Saving the file record failed: ' + fErr.message)
      const { error: issErr } = await sb.from('om_issues').insert({
        project_id, kind: f.kind, issue_no: issue, status: 'issued', file_name: f.fileName, pages: f.pages, hs_file_id: file?.id,
        approved_by: profile.full_name, created_by: user.id,
      })
      if (issErr) throw new Error('Recording the issue failed: ' + issErr.message)
      out.push({ kind: f.kind, file_id: file?.id, file_name: f.fileName, pages: f.pages, folder_key: f.folder })
    }
  } catch (e) {
    console.error('[om-render] save', e)
    return res.status(500).json({ error: e.message, saved: out })
  }
  const main = out.find(o => o.kind === 'om') || out[0]
  return res.status(200).json({ ...main, issue_no: issue, files: out })
}
