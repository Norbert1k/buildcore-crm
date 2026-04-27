import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'
// @ts-ignore — ExcelJS types are loose
import ExcelJS from 'https://esm.sh/exceljs@4.4.0?target=deno'

// ────────────────────────────────────────────────────────────────────────────
// activate-project-pa-file
//
// Reads the project's CSA file, inserts a PA01 column block (Progress %,
// Cumulative, This App) between Total and Comments, adds a payment summary,
// uploads as the Payment Application file. CSA file is NOT modified.
// Idempotent: returns { skipped: true } if the PA file already exists.
//
// Inputs:  { project_id: string }
// Auth:    staff role required
// Reads:   project's CSA file from project_doc_files
// Writes:  project-docs/projects/<id>/02-payment-application/{name} - Payment Application.xlsx
// ────────────────────────────────────────────────────────────────────────────

const STAFF_ROLES = ['admin', 'project_manager', 'operations_manager']
const TARGET_BUCKET = 'project-docs'
const CSA_FOLDER_KEY = '00-project-information'
const CSA_SUBFOLDER_KEY = 'csa'
const PA_FOLDER_KEY = '02-payment-application'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Body {
  project_id: string
}

function safeFilename(s: string): string {
  return s.replace(/[\/\\<>:"|?*]+/g, '').replace(/\s+/g, ' ').trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1. Verify caller is staff
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) throw new Error('Invalid session')

    const { data: profile } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || !STAFF_ROLES.includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'Not authorised' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Parse + look up project
    const body: Body = await req.json()
    if (!body.project_id) throw new Error('project_id required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('id, project_name, project_ref')
      .eq('id', body.project_id)
      .maybeSingle()

    if (projErr || !project) throw new Error('Project not found')

    const projectName = project.project_name || 'Untitled Project'
    const cleanName = safeFilename(projectName)
    const paFileName = `${cleanName} - Payment Application.xlsx`
    const paStoragePath = `projects/${project.id}/${PA_FOLDER_KEY}/${paFileName}`

    // 3. Idempotency: skip if PA file already exists
    const { data: existingPa } = await admin
      .from('project_doc_files')
      .select('id')
      .eq('project_id', project.id)
      .eq('storage_path', paStoragePath)
      .maybeSingle()

    if (existingPa) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: 'pa_already_exists',
        file_id: existingPa.id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Find the project's CSA file
    const { data: csaRecord } = await admin
      .from('project_doc_files')
      .select('storage_path, file_name')
      .eq('project_id', project.id)
      .eq('folder_key', CSA_FOLDER_KEY)
      .eq('subfolder_key', CSA_SUBFOLDER_KEY)
      .ilike('file_name', '%CSA%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!csaRecord) {
      return new Response(JSON.stringify({
        error: 'No CSA file found for this project',
        hint: 'Generate a CSA in 00. Project Information / 03. CSA first, then re-trigger.',
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Download the CSA file
    const { data: csaBlob, error: dlErr } = await admin.storage
      .from(TARGET_BUCKET)
      .download(csaRecord.storage_path)
    if (dlErr || !csaBlob) {
      throw new Error(`Could not load CSA file: ${dlErr?.message || 'not found'}`)
    }
    const csaBytes = new Uint8Array(await csaBlob.arrayBuffer())

    // 6. Load with ExcelJS, transform: insert PA columns, add formulas, add summary
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(csaBytes)
    const sheet = wb.worksheets[0]

    // Insert 3 columns BEFORE column G (which was Comments). After this:
    //   A-F  unchanged (Ref, Desc, Qty, Unit, Rate, Total)
    //   G    Progress %     (was F+1, was Comments — shifted to J)
    //   H    Cumulative (£)
    //   I    This App (£)
    //   J    Comments       (was G)
    sheet.spliceColumns(7, 0, [], [], [])

    // Set widths for the new columns
    sheet.getColumn(7).width = 11   // Progress %
    sheet.getColumn(8).width = 14   // Cumulative
    sheet.getColumn(9).width = 14   // This App

    // Header row is row 8. The CSA had headers in A8..G8; G8 ('Comments') is
    // now at J8 thanks to the splice. We need to add headers in G8, H8, I8.
    const headerRow = 8
    const g8 = sheet.getCell(`G${headerRow}`)
    const h8 = sheet.getCell(`H${headerRow}`)
    const i8 = sheet.getCell(`I${headerRow}`)

    // Copy styling from the existing F8 (Total header) so the new headers
    // visually match the band.
    const f8 = sheet.getCell(`F${headerRow}`)
    const headerStyle = JSON.parse(JSON.stringify(f8.style || {}))

    g8.value = 'Progress %'
    g8.style = headerStyle
    h8.value = 'Cumulative (£)'
    h8.style = headerStyle
    i8.value = 'This App (£)'
    i8.style = headerStyle

    // Walk the body rows. For each row that has a numeric Total in F (i.e.
    // is a line item with content), add formulas in G, H, I.
    // Skip rows that are merged across F:G:H:I (those are section headers /
    // subtotal labels that ExcelJS keeps as merged after the splice).
    const lastRow = sheet.lastRow?.number || 8

    for (let r = headerRow + 1; r <= lastRow; r++) {
      const aCell = sheet.getCell(`A${r}`)
      const fCell = sheet.getCell(`F${r}`)

      // Detect: is this row part of a merged span starting at column A?
      // (Section header rows merge A:J in the post-splice file.)
      const isFullMerged = aCell.isMerged && (aCell.master === aCell || sheet.getCell(`J${r}`).isMerged)

      // Detect: is row a subtotal? Subtotals merge A:E with text label, then
      // have a SUM formula in F. After splice, the F formula remains valid
      // (SUM(F9:F11) doesn't change), but we want G/H/I subtotals too.
      const fFormula = (fCell.formula || (fCell.value && (fCell.value as any).formula)) || ''
      const isSumSubtotal = typeof fFormula === 'string' && fFormula.startsWith('SUM(')

      if (isSumSubtotal) {
        // Mirror the SUM range across the new PA columns
        const range = fFormula.replace('SUM(', '').replace(')', '')  // e.g. "F9:F11"
        const newG = range.replace(/F/g, 'G')
        const newH = range.replace(/F/g, 'H')
        const newI = range.replace(/F/g, 'I')

        sheet.getCell(`G${r}`).value = { formula: `SUM(${newG})` } as any
        sheet.getCell(`H${r}`).value = { formula: `SUM(${newH})` } as any
        sheet.getCell(`I${r}`).value = { formula: `SUM(${newI})` } as any

        // Apply subtotal styling
        const fStyle = JSON.parse(JSON.stringify(fCell.style || {}))
        sheet.getCell(`G${r}`).style = fStyle
        sheet.getCell(`H${r}`).style = fStyle
        sheet.getCell(`I${r}`).style = fStyle
        sheet.getCell(`G${r}`).numFmt = '0%;-0%;"—"'
        sheet.getCell(`H${r}`).numFmt = '£#,##0.00;(£#,##0.00);"—"'
        sheet.getCell(`I${r}`).numFmt = '£#,##0.00;(£#,##0.00);"—"'
        continue
      }

      // Detect line item: F has a formula like IF(AND(ISNUMBER(C..),ISNUMBER(E..)),C*E,"") or static number
      const isLineItem = (typeof fFormula === 'string' && fFormula.includes('C' + r))
        || (typeof fCell.value === 'number')
        || (fCell.value && typeof fCell.value === 'object' && 'formula' in (fCell.value as any))

      if (isLineItem && !isFullMerged) {
        // Progress % — manual entry, blank by default
        const gCell = sheet.getCell(`G${r}`)
        gCell.numFmt = '0%;-0%;"—"'
        gCell.font = { name: 'Arial', size: 10, color: { argb: 'FF0000FF' } }  // blue (manual)
        gCell.alignment = { horizontal: 'center', vertical: 'middle' }

        // Cumulative = Total * Progress%
        const hCell = sheet.getCell(`H${r}`)
        hCell.value = { formula: `IF(AND(ISNUMBER(F${r}),ISNUMBER(G${r})),F${r}*G${r},"")` } as any
        hCell.numFmt = '£#,##0.00;(£#,##0.00);"—"'
        hCell.font = { name: 'Arial', size: 10, color: { argb: 'FF1C1B18' } }
        hCell.alignment = { horizontal: 'right', vertical: 'middle' }

        // This App = Cumulative (PA01 has no prior period to subtract)
        const iCell = sheet.getCell(`I${r}`)
        iCell.value = { formula: `IF(ISNUMBER(H${r}),H${r},"")` } as any
        iCell.numFmt = '£#,##0.00;(£#,##0.00);"—"'
        iCell.font = { name: 'Arial', size: 10, color: { argb: 'FF1C1B18' } }
        iCell.alignment = { horizontal: 'right', vertical: 'middle' }
      }
    }

    // Update the header band:
    //   Row 2 title: 'Contract Sum Analysis' → 'Contract Sum Analysis & Payment Application'
    //   Row 6 stage: 'Tender / Contract'     → 'Application No: PA01'
    //
    // After splice these merged cells are now E2:H2 and E6:H6 (the 'F-G' part
    // expanded by 3 columns automatically when ExcelJS adjusted merges).
    // But ExcelJS may have preserved the original cell so we update by content.
    for (let r = 1; r <= 7; r++) {
      for (let c = 1; c <= 12; c++) {
        const cell = sheet.getCell(r, c)
        if (cell.value === 'Contract Sum Analysis') {
          cell.value = 'Contract Sum Analysis & Payment Application'
        } else if (cell.value === 'Tender / Contract') {
          cell.value = 'Application No: PA01'
        }
      }
    }

    // Add summary rows below the existing CONTRACT SUM grand total.
    // Find that row by scanning for 'CONTRACT SUM' text in column A.
    let contractSumRow = -1
    for (let r = 1; r <= lastRow; r++) {
      const v = sheet.getCell(`A${r}`).value
      if (typeof v === 'string' && v.includes('CONTRACT SUM')) {
        contractSumRow = r
        break
      }
    }

    if (contractSumRow > 0) {
      // Add: Less Retention 3% / TOTAL DUE THIS APPLICATION
      // Insert two rows after the contract sum row
      const retentionRow = contractSumRow + 1
      const totalDueRow = contractSumRow + 2

      sheet.insertRow(retentionRow, [])
      sheet.insertRow(totalDueRow, [])

      // Less Retention 3%
      sheet.mergeCells(`A${retentionRow}:F${retentionRow}`)
      const retLabelCell = sheet.getCell(`A${retentionRow}`)
      retLabelCell.value = 'Less Retention 3% (on This Application)'
      retLabelCell.font = { name: 'Arial', size: 10, color: { argb: 'FF1C1B18' } }
      retLabelCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }

      const retCell = sheet.getCell(`I${retentionRow}`)
      retCell.value = { formula: `-I${contractSumRow}*0.03` } as any
      retCell.numFmt = '£#,##0.00;(£#,##0.00);"—"'
      retCell.font = { name: 'Arial', size: 10 }
      retCell.alignment = { horizontal: 'right', vertical: 'middle' }
      sheet.getRow(retentionRow).height = 22

      // TOTAL DUE
      sheet.mergeCells(`A${totalDueRow}:F${totalDueRow}`)
      const totalDueLabel = sheet.getCell(`A${totalDueRow}`)
      totalDueLabel.value = 'TOTAL DUE THIS APPLICATION'
      totalDueLabel.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFA32D2D' } }
      totalDueLabel.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
      totalDueLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3DE' } }

      const totalDueCell = sheet.getCell(`I${totalDueRow}`)
      totalDueCell.value = { formula: `I${contractSumRow}+I${retentionRow}` } as any
      totalDueCell.numFmt = '£#,##0.00;(£#,##0.00);"—"'
      totalDueCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFA32D2D' } }
      totalDueCell.alignment = { horizontal: 'right', vertical: 'middle' }
      totalDueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3DE' } }
      sheet.getRow(totalDueRow).height = 26

      // Fill background across the row for visual cohesion
      for (let c = 6; c <= 10; c++) {
        sheet.getCell(totalDueRow, c).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3DE' },
        } as any
      }
    }

    // 7. Save out
    const buffer: ArrayBuffer = await wb.xlsx.writeBuffer()
    const outBytes = new Uint8Array(buffer)

    // 8. Upload PA file
    const { error: upErr } = await admin.storage
      .from(TARGET_BUCKET)
      .upload(paStoragePath, outBytes, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      })

    if (upErr) {
      const isAlreadyExists = upErr.message?.toLowerCase().includes('already exists')
      if (!isAlreadyExists) {
        throw new Error(`Storage upload failed: ${upErr.message}`)
      }
    }

    // 9. Register in project_doc_files
    const { data: inserted, error: insErr } = await admin
      .from('project_doc_files')
      .insert({
        project_id: project.id,
        folder_key: PA_FOLDER_KEY,
        subfolder_key: '',
        file_name: paFileName,
        storage_path: paStoragePath,
        file_size: outBytes.byteLength,
      })
      .select('id')
      .single()

    if (insErr) {
      await admin.storage.from(TARGET_BUCKET).remove([paStoragePath])
      throw new Error(`DB insert failed: ${insErr.message}`)
    }

    return new Response(JSON.stringify({
      success: true,
      skipped: false,
      file_id: inserted.id,
      file_name: paFileName,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
