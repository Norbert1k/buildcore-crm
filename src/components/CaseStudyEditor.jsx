// src/components/CaseStudyEditor.jsx
//
// Editable single-page case study for a project. One row per project in
// `case_studies` table. Photos stored in 'company-docs' bucket under
// case-study-photos/{case_study_id}/. Edits do NOT affect underlying project.
//
// Used by ProjectDetail's Case Study tab.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { drawCover, drawLetterhead, drawFooter, loadLogo, BRAND, bc, fmtDateLong } from '../lib/pdfTemplate'

const STORAGE_BUCKET = 'company-docs'
const PHOTO_PREFIX = 'case-study-photos'

// ────────────────────────────────────────────────────────────
// Main editor — full screen overlay, single scrollable form
// ────────────────────────────────────────────────────────────
export default function CaseStudyEditor({ projectId, projectName, onClose }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [doc, setDoc] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [photoUrls, setPhotoUrls] = useState({})
  const fileInputRef = useRef(null)

  useEffect(() => { load() }, [projectId])

  // ── Load existing case study, or create a fresh in-memory one pre-filled from the project ──
  async function load() {
    setLoading(true)
    try {
      const { data: existing } = await supabase.from('case_studies')
        .select('*').eq('project_id', projectId).maybeSingle()

      if (existing) {
        setDoc(existing)
      } else {
        // Pre-fill from project + subcontractors
        const { data: project } = await supabase.from('projects')
          .select('*, profiles:project_manager_id(full_name)')
          .eq('id', projectId).maybeSingle()
        const { data: subs } = await supabase.from('project_subcontractors')
          .select('*, subcontractors(company_name, trade)')
          .eq('project_id', projectId)

        const duration = calcDuration(project?.start_date, project?.end_date)
        const team = (subs || []).map(ps => ({
          company_name: ps.subcontractors?.company_name || '',
          trade: ps.subcontractors?.trade || ps.trade_on_project || '',
        })).filter(t => t.company_name)

        setDoc({
          id: null,
          project_id: projectId,
          title: project?.project_name || projectName || '',
          client_name: project?.client_name || '',
          site_address: project?.site_address || '',
          city: project?.city || '',
          postcode: project?.postcode || '',
          duration: duration || '',
          value: project?.value ? `£${Number(project.value).toLocaleString()}` : '',
          status: project?.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1) : '',
          reference: project?.project_ref || '',
          project_manager: project?.profiles?.full_name || '',
          start_date: project?.start_date || null,
          end_date: project?.end_date || null,
          description: project?.description || '',
          photos: [],
          team,
        })
      }
    } catch (e) { console.error('[CaseStudy] load error', e); alert('Load failed: ' + e.message) }
    setLoading(false)
  }

  // ── Re-fetch signed URLs whenever photos change ──
  useEffect(() => {
    if (!doc?.photos?.length) { setPhotoUrls({}); return }
    let cancelled = false
    Promise.all(doc.photos.map(async p => {
      const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(p.storage_path, 3600)
      return [p.id, data?.signedUrl]
    })).then(pairs => {
      if (cancelled) return
      const map = {}
      for (const [id, url] of pairs) if (url) map[id] = url
      setPhotoUrls(map)
    })
    return () => { cancelled = true }
  }, [doc?.photos])

  function patch(field, value) { setDoc(d => ({ ...d, [field]: value })) }

  // ── Save ──
  async function save() {
    if (!doc) return null
    setSaving(true)
    try {
      const payload = {
        project_id: doc.project_id,
        title: doc.title,
        client_name: doc.client_name,
        site_address: doc.site_address,
        city: doc.city,
        postcode: doc.postcode,
        duration: doc.duration,
        value: doc.value,
        status: doc.status,
        reference: doc.reference,
        project_manager: doc.project_manager,
        start_date: doc.start_date || null,
        end_date: doc.end_date || null,
        description: doc.description,
        photos: doc.photos || [],
        team: doc.team || [],
        updated_by: profile?.id || null,
      }
      let savedId = doc.id
      if (savedId) {
        const { error } = await supabase.from('case_studies').update(payload).eq('id', savedId)
        if (error) throw error
      } else {
        payload.created_by = profile?.id || null
        const { data, error } = await supabase.from('case_studies').insert(payload).select().single()
        if (error) throw error
        savedId = data.id
        setDoc(d => ({ ...d, id: savedId }))
      }
      setSaving(false)
      return savedId
    } catch (e) { setSaving(false); console.error(e); alert('Save failed: ' + e.message); return null }
  }

  async function saveAndClose() {
    const id = await save()
    if (id) onClose()
  }

  // ── Photos ──
  async function uploadPhotos(fileList) {
    if (!fileList || fileList.length === 0) return
    // Need an ID to anchor uploads; save first if necessary
    let id = doc.id
    if (!id) {
      id = await save()
      if (!id) return
    }
    setUploading(true)
    const newPhotos = [...(doc.photos || [])]
    const errors = []
    for (const f of Array.from(fileList)) {
      try {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const photoId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const path = `${PHOTO_PREFIX}/${id}/${photoId}.${ext}`
        const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, f, { upsert: false, contentType: f.type })
        if (upErr) throw upErr
        newPhotos.push({ id: photoId, storage_path: path, caption: '', sort_order: newPhotos.length })
      } catch (e) { errors.push(`${f.name}: ${e.message}`) }
    }
    if (errors.length) alert('Some uploads failed:\n' + errors.join('\n'))
    // Save photos to DB immediately so the upload persists
    const { error } = await supabase.from('case_studies').update({ photos: newPhotos }).eq('id', id)
    if (error) alert('Photo save failed: ' + error.message)
    else setDoc(d => ({ ...d, photos: newPhotos }))
    setUploading(false)
  }

  async function deletePhoto(photoId) {
    const ph = doc.photos.find(p => p.id === photoId)
    if (!ph) return
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([ph.storage_path])
    } catch (e) { console.warn('storage delete failed', e) }
    const newPhotos = doc.photos.filter(p => p.id !== photoId)
    if (doc.id) {
      const { error } = await supabase.from('case_studies').update({ photos: newPhotos }).eq('id', doc.id)
      if (error) { alert('Delete failed: ' + error.message); return }
    }
    setDoc(d => ({ ...d, photos: newPhotos }))
  }

  function setPhotoCaption(photoId, caption) {
    const newPhotos = doc.photos.map(p => p.id === photoId ? { ...p, caption } : p)
    setDoc(d => ({ ...d, photos: newPhotos }))
  }

  // ── Team rows ──
  function addTeamRow() { setDoc(d => ({ ...d, team: [...(d.team || []), { company_name: '', trade: '' }] })) }
  function patchTeamRow(idx, field, value) {
    setDoc(d => {
      const team = [...(d.team || [])]
      team[idx] = { ...team[idx], [field]: value }
      return { ...d, team }
    })
  }
  function removeTeamRow(idx) {
    setDoc(d => {
      const team = [...(d.team || [])]
      team.splice(idx, 1)
      return { ...d, team }
    })
  }

  // ── Delete entire case study ──
  async function deleteCaseStudy() {
    if (!doc.id) { onClose(); return }
    setConfirmDelete(false)
    try {
      // Remove photos from storage first
      const paths = (doc.photos || []).map(p => p.storage_path).filter(Boolean)
      if (paths.length) {
        try { await supabase.storage.from(STORAGE_BUCKET).remove(paths) } catch (e) { console.warn(e) }
      }
      const { error } = await supabase.from('case_studies').delete().eq('id', doc.id)
      if (error) throw error
      onClose()
    } catch (e) { alert('Delete failed: ' + e.message) }
  }

  // ── Export PDF (uses pdfTemplate.js helpers + case study data) ──
  async function exportPDF() {
    setExporting(true)
    try {
      // Save first so the latest edits are reflected
      const id = await save()
      if (!id) { setExporting(false); return }

      if (!window.PDFLib) {
        const s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
        document.head.appendChild(s)
        await new Promise(r => { s.onload = r })
      }
      const { PDFDocument, StandardFonts, PageSizes } = window.PDFLib

      const pdf = await PDFDocument.create()
      const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
      const regFont = await pdf.embedFont(StandardFonts.Helvetica)
      const fonts = { boldFont, regFont }
      const logo = await loadLogo(pdf)

      const A4 = PageSizes.A4
      const A4_W = A4[0], A4_H = A4[1]

      const addressLines = [doc.site_address, doc.city, doc.postcode].filter(Boolean)

      // ── Cover ──
      const cover = pdf.addPage(A4)
      drawCover(cover, fonts, logo, {
        eyebrow: 'PROJECT CASE STUDY',
        title: doc.title || projectName || 'Project',
        projectName: doc.client_name ? `Client: ${doc.client_name}` : undefined,
        addressLines,
      })

      // ── Project overview page ──
      const overviewPage = pdf.addPage(A4)
      let y = drawLetterhead(overviewPage, fonts, logo)
      overviewPage.drawText('Project overview', { x: 32, y: y - 4, size: 20, font: boldFont, color: bc(BRAND.text) })
      y -= 30

      // 6-fact key grid (2 col)
      const facts = [
        ['Client', doc.client_name || '—'],
        ['Duration', doc.duration || '—'],
        ['Value', doc.value || '—'],
        ['Status', doc.status || '—'],
        ['Reference', doc.reference || '—'],
        ['Project Manager', doc.project_manager || '—'],
      ]
      const colW = (A4_W - 64) / 2
      for (let i = 0; i < facts.length; i++) {
        const [k, v] = facts[i]
        const col = i % 2
        const row = Math.floor(i / 2)
        const fx = 32 + col * colW
        const fy = y - row * 38
        overviewPage.drawRectangle({ x: fx, y: fy - 28, width: colW - 8, height: 32, color: bc({ r: 0.965, g: 0.961, b: 0.94 }) })
        overviewPage.drawText(k.toUpperCase(), { x: fx + 8, y: fy - 12, size: 8, font: regFont, color: bc(BRAND.muted) })
        overviewPage.drawText(String(v), { x: fx + 8, y: fy - 24, size: 11, font: boldFont, color: bc(BRAND.text) })
      }
      y -= Math.ceil(facts.length / 2) * 38 + 16

      // Description
      if (doc.description?.trim()) {
        overviewPage.drawText('Project description', { x: 32, y: y - 4, size: 14, font: boldFont, color: bc(BRAND.green) })
        y -= 18
        const wrap = (text, maxW, size) => {
          const words = text.split(/\s+/)
          const lines = []
          let cur = ''
          for (const w of words) {
            const test = cur ? cur + ' ' + w : w
            if (regFont.widthOfTextAtSize(test, size) > maxW) {
              if (cur) lines.push(cur); cur = w
            } else { cur = test }
          }
          if (cur) lines.push(cur)
          return lines
        }
        const paras = doc.description.split(/\n\n+/)
        for (const para of paras) {
          const lines = wrap(para.replace(/\n/g, ' '), A4_W - 64, 11)
          for (const line of lines) {
            if (y < 80) break
            overviewPage.drawText(line, { x: 32, y, size: 11, font: regFont, color: bc(BRAND.text) })
            y -= 16
          }
          y -= 8
          if (y < 80) break
        }
      }

      // ── Photos page ──
      const photoEntries = (doc.photos || []).filter(p => photoUrls[p.id])
      if (photoEntries.length > 0) {
        const photoPage = pdf.addPage(A4)
        let py = drawLetterhead(photoPage, fonts, logo)
        photoPage.drawText('Project photography', { x: 32, y: py - 4, size: 20, font: boldFont, color: bc(BRAND.text) })
        py -= 30
        const photoW = (A4_W - 64 - 12) / 2
        const photoH = photoW * 0.75
        let col = 0
        let cy = py
        for (const ph of photoEntries) {
          try {
            const r = await fetch(photoUrls[ph.id])
            const blob = await r.blob()
            const ab = await blob.arrayBuffer()
            let img = null
            try { img = await pdf.embedJpg(ab) } catch { img = await pdf.embedPng(ab) }
            const px = 32 + col * (photoW + 12)
            if (cy - photoH < 80) break
            photoPage.drawImage(img, { x: px, y: cy - photoH, width: photoW, height: photoH })
            // Caption
            if (ph.caption) {
              photoPage.drawText(ph.caption.slice(0, 80), {
                x: px, y: cy - photoH - 12, size: 9, font: regFont, color: bc(BRAND.muted),
              })
            }
            col++
            if (col >= 2) { col = 0; cy -= photoH + 28 }
          } catch (e) { console.warn('photo skip', ph.id, e) }
        }
      }

      // ── Team page ──
      if (doc.team?.length > 0) {
        const teamPage = pdf.addPage(A4)
        let ty = drawLetterhead(teamPage, fonts, logo)
        teamPage.drawText('Project team', { x: 32, y: ty - 4, size: 20, font: boldFont, color: bc(BRAND.text) })
        ty -= 30
        for (const t of doc.team) {
          if (ty < 80) break
          teamPage.drawRectangle({ x: 32, y: ty - 36, width: A4_W - 64, height: 32, color: bc({ r: 0.965, g: 0.961, b: 0.94 }) })
          teamPage.drawText(t.company_name || '—', { x: 44, y: ty - 18, size: 12, font: boldFont, color: bc(BRAND.text) })
          teamPage.drawText(t.trade || '', { x: 44, y: ty - 30, size: 10, font: regFont, color: bc(BRAND.muted) })
          ty -= 40
        }
      }

      // Footer page numbers (skip cover)
      const allPages = pdf.getPages()
      const total = allPages.length
      for (let i = 1; i < total; i++) {
        drawFooter(allPages[i], fonts, doc.title || '', i + 1, total)
      }

      const bytes = await pdf.save()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${doc.title || 'Project'} - Case Study.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { console.error('[CaseStudy.exportPDF]', e); alert('Export failed: ' + (e?.message || e)) }
    setExporting(false)
  }

  if (loading) return <Overlay onClose={onClose}><div style={{ padding: 60, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div></Overlay>
  if (!doc) return <Overlay onClose={onClose}><div style={{ padding: 60, textAlign: 'center', color: 'var(--red)' }}>Could not load case study</div></Overlay>

  return (
    <Overlay onClose={onClose}>
      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Case Study</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {doc.id && (
            <button onClick={() => setConfirmDelete(true)} style={btnRed}>Delete</button>
          )}
          <button onClick={exportPDF} disabled={exporting || saving} style={btnSecondary}>
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
          <button onClick={saveAndClose} disabled={saving} style={btnPrimary}>
            {saving ? 'Saving…' : 'Save & Close'}
          </button>
          <button onClick={onClose} style={btnGhost} title="Close without saving">✕</button>
        </div>
      </div>

      {/* Form body */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 24px 80px' }}>

        <Section title="Title block">
          <Field2 label="Title (defaults to project name)">
            <input value={doc.title || ''} onChange={e => patch('title', e.target.value)} style={input} />
          </Field2>
          <Field2 label="Client name">
            <input value={doc.client_name || ''} onChange={e => patch('client_name', e.target.value)} style={input} />
          </Field2>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <Field2 label="Site address">
              <input value={doc.site_address || ''} onChange={e => patch('site_address', e.target.value)} style={input} />
            </Field2>
            <Field2 label="City">
              <input value={doc.city || ''} onChange={e => patch('city', e.target.value)} style={input} />
            </Field2>
            <Field2 label="Postcode">
              <input value={doc.postcode || ''} onChange={e => patch('postcode', e.target.value)} style={input} />
            </Field2>
          </div>
        </Section>

        <Section title="Key facts">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field2 label="Duration">
              <input value={doc.duration || ''} onChange={e => patch('duration', e.target.value)} style={input} placeholder="e.g. 18 months" />
            </Field2>
            <Field2 label="Value">
              <input value={doc.value || ''} onChange={e => patch('value', e.target.value)} style={input} placeholder="e.g. £2,500,000" />
            </Field2>
            <Field2 label="Status">
              <input value={doc.status || ''} onChange={e => patch('status', e.target.value)} style={input} placeholder="e.g. Active, Complete" />
            </Field2>
            <Field2 label="Reference">
              <input value={doc.reference || ''} onChange={e => patch('reference', e.target.value)} style={input} />
            </Field2>
            <Field2 label="Project manager">
              <input value={doc.project_manager || ''} onChange={e => patch('project_manager', e.target.value)} style={input} />
            </Field2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Field2 label="Start date">
              <input type="date" value={doc.start_date || ''} onChange={e => patch('start_date', e.target.value || null)} style={input} />
            </Field2>
            <Field2 label="Completion date">
              <input type="date" value={doc.end_date || ''} onChange={e => patch('end_date', e.target.value || null)} style={input} />
            </Field2>
          </div>
        </Section>

        <Section title="Project description">
          <textarea value={doc.description || ''} onChange={e => patch('description', e.target.value)}
            style={{ ...input, minHeight: 160, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            placeholder="Describe the project, its scope, complexity, and value delivered…" />
        </Section>

        <Section title={`Photos (${doc.photos?.length || 0})`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {(doc.photos || []).map(p => (
              <div key={p.id} style={{ border: '0.5px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--surface)' }}>
                {photoUrls[p.id]
                  ? <img src={photoUrls[p.id]} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', aspectRatio: '4/3', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text3)' }}>Loading…</div>}
                <div style={{ padding: 8 }}>
                  <input
                    value={p.caption || ''}
                    placeholder="Caption (optional)"
                    onChange={e => setPhotoCaption(p.id, e.target.value)}
                    style={{ ...input, fontSize: 11, padding: '5px 7px' }}
                  />
                  <button onClick={() => deletePhoto(p.id)} style={{ ...btnGhost, marginTop: 6, color: 'var(--red)', fontSize: 11, padding: '4px 8px' }}>Delete</button>
                </div>
              </div>
            ))}
            {/* Upload tile */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ aspectRatio: '4/3', border: '1.5px dashed var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              {uploading ? 'Uploading…' : 'Upload photos'}
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*" style={{ display: 'none' }}
              onChange={e => { uploadPhotos(e.target.files); e.target.value = '' }} />
          </div>
          {!doc.id && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Photos auto-save when uploaded — case study saves first if needed.</div>
          )}
        </Section>

        <Section title="Project team">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(doc.team || []).map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                <input value={t.company_name || ''} onChange={e => patchTeamRow(i, 'company_name', e.target.value)} placeholder="Company name" style={input} />
                <input value={t.trade || ''} onChange={e => patchTeamRow(i, 'trade', e.target.value)} placeholder="Trade / role" style={input} />
                <button onClick={() => removeTeamRow(i)} style={{ ...btnGhost, color: 'var(--red)', padding: '6px 10px' }}>×</button>
              </div>
            ))}
            <button onClick={addTeamRow} style={{ ...btnSecondary, alignSelf: 'flex-start', marginTop: 6 }}>+ Add team member</button>
          </div>
        </Section>

      </div>

      {confirmDelete && (
        <div onClick={() => setConfirmDelete(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 24, maxWidth: 400, width: '90%' }}>
            <div style={{ fontSize: 14, marginBottom: 6, fontWeight: 600 }}>Delete case study?</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 18 }}>This permanently removes the case study and all its photos. The underlying project is not affected.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(false)} style={btnSecondary}>Cancel</button>
              <button onClick={deleteCaseStudy} style={btnRed}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </Overlay>
  )
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function calcDuration(start, end) {
  if (!start || !end) return ''
  const s = new Date(start), e = new Date(end)
  if (isNaN(s) || isNaN(e)) return ''
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
  if (months < 1) return 'Less than a month'
  if (months === 1) return '1 month'
  if (months < 12) return `${months} months`
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (rem === 0) return years === 1 ? '1 year' : `${years} years`
  return `${years} year${years > 1 ? 's' : ''} ${rem} month${rem > 1 ? 's' : ''}`
}

function Overlay({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1500, display: 'flex', alignItems: 'stretch', justifyContent: 'center', overflowY: 'auto' }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', maxWidth: 1100, width: '100%', minHeight: '100%', boxShadow: '0 0 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
      {children}
    </div>
  )
}

function Field2({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

const input = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '0.5px solid var(--border)',
  borderRadius: 5,
  background: 'var(--surface2)',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

const btnPrimary = {
  fontSize: 12, padding: '7px 14px', borderRadius: 6, background: '#448a40', color: 'white', border: 'none', cursor: 'pointer',
}
const btnSecondary = {
  fontSize: 12, padding: '7px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text2)',
}
const btnRed = {
  fontSize: 12, padding: '7px 14px', border: '0.5px solid var(--red-border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--red)',
}
const btnGhost = {
  fontSize: 12, padding: '6px 10px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text2)',
}
