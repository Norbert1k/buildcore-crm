import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'
import JSZip from 'https://esm.sh/jszip@3.10.1'

// ────────────────────────────────────────────────────────────────────────────
// generate-project-csa-file
//
// Clones the CSA master template, swaps in the project's name and ref,
// uploads to the project's `00. Project Information / 03. CSA` folder.
// Idempotent: returns { skipped: true } if the file already exists.
//
// Inputs:  { project_id: string }
// Auth:    staff role required (admin, project_manager, operations_manager)
// Master:  company-docs/templates/CCG_CSA_Master.xlsx
// Output:  project-docs/projects/<id>/00-project-information/csa/{name} - CSA.xlsx
// ────────────────────────────────────────────────────────────────────────────

const STAFF_ROLES = ['admin', 'project_manager', 'operations_manager']
const MASTER_BUCKET = 'company-docs'
const MASTER_PATH = 'templates/CCG_CSA_Master.xlsx'
const TARGET_BUCKET = 'project-docs'
const TARGET_FOLDER_KEY = '00-project-information'
const TARGET_SUBFOLDER_KEY = 'csa'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Body {
  project_id: string
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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
    const projectRef = project.project_ref || ''
    const cleanName = safeFilename(projectName)
    const fileName = `${cleanName} - CSA.xlsx`
    const storagePath = `projects/${project.id}/${TARGET_FOLDER_KEY}/${TARGET_SUBFOLDER_KEY}/${fileName}`

    // 3. Idempotency check
    const { data: existingFile } = await admin
      .from('project_doc_files')
      .select('id')
      .eq('project_id', project.id)
      .eq('storage_path', storagePath)
      .maybeSingle()

    if (existingFile) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: 'already_exists',
        file_id: existingFile.id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Download master
    const { data: masterBlob, error: dlErr } = await admin.storage
      .from(MASTER_BUCKET)
      .download(MASTER_PATH)
    if (dlErr || !masterBlob) {
      throw new Error(`Could not load master template: ${dlErr?.message || 'not found'}`)
    }
    const masterBytes = new Uint8Array(await masterBlob.arrayBuffer())

    // 5. Unzip, replace placeholders, re-zip
    const zip = await JSZip.loadAsync(masterBytes)
    const sheetEntry = zip.file('xl/worksheets/sheet1.xml')
    if (!sheetEntry) throw new Error('Master template missing sheet1.xml')

    let sheetXml: string = await sheetEntry.async('string')
    const safeName = escapeXml(projectName)
    const safeRef = escapeXml(projectRef || '____')

    sheetXml = sheetXml
      .replaceAll('<is><t>[Project Name]</t></is>', `<is><t>${safeName}</t></is>`)
      .replaceAll('<is><t>Ref: ____</t></is>', `<is><t>Ref: ${safeRef}</t></is>`)

    zip.file('xl/worksheets/sheet1.xml', sheetXml)
    const outBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

    // 6. Upload to project storage
    const { error: upErr } = await admin.storage
      .from(TARGET_BUCKET)
      .upload(storagePath, outBytes, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      })

    if (upErr) {
      const isAlreadyExists = upErr.message?.toLowerCase().includes('already exists')
      if (!isAlreadyExists) {
        throw new Error(`Storage upload failed: ${upErr.message}`)
      }
    }

    // 7. Register in project_doc_files
    const { data: inserted, error: insErr } = await admin
      .from('project_doc_files')
      .insert({
        project_id: project.id,
        folder_key: TARGET_FOLDER_KEY,
        subfolder_key: TARGET_SUBFOLDER_KEY,
        file_name: fileName,
        storage_path: storagePath,
        file_size: outBytes.byteLength,
      })
      .select('id')
      .single()

    if (insErr) {
      await admin.storage.from(TARGET_BUCKET).remove([storagePath])
      throw new Error(`DB insert failed: ${insErr.message}`)
    }

    return new Response(JSON.stringify({
      success: true,
      skipped: false,
      file_id: inserted.id,
      file_name: fileName,
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
