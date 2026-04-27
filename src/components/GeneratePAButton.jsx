import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ────────────────────────────────────────────────────────────────────────────
// GeneratePAButton
//
// Manual fallback for projects that skipped the 'active' status (e.g. went
// tender → complete) and so never auto-generated a Payment Application file.
// Also useful if the auto-trigger silently failed.
//
// Visibility rules:
//   - Hidden if user lacks 'manage_projects' permission
//   - Hidden if project is still in 'tender' status (CSA hasn't matured yet)
//   - Hidden if a PA file already exists for this project
//
// Props:
//   project: { id, project_name, status }
//   onGenerated?: () => void   // optional callback when a PA is created
// ────────────────────────────────────────────────────────────────────────────

export default function GeneratePAButton({ project, onGenerated }) {
  const { can } = useAuth()
  const [paExists, setPaExists] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data } = await supabase
        .from('project_doc_files')
        .select('id')
        .eq('project_id', project.id)
        .eq('folder_key', '02-payment-application')
        .ilike('file_name', '%Payment Application%')
        .limit(1)
        .maybeSingle()
      if (!cancelled) setPaExists(!!data)
    }
    check()
    return () => { cancelled = true }
  }, [project.id])

  // Hide while we don't yet know, or when conditions aren't met
  if (!can('manage_projects')) return null
  if (project.status === 'tender') return null
  if (paExists !== false) return null  // null = still loading; true = already exists

  async function handleClick() {
    setError('')
    setGenerating(true)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        'activate-project-pa-file',
        { body: { project_id: project.id } }
      )
      if (fnErr) throw fnErr
      if (data?.error) throw new Error(data.error)
      setPaExists(true)
      onGenerated?.()
    } catch (e) {
      setError(e.message || 'Failed to generate Payment Application')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <button
        className="btn btn-sm"
        onClick={handleClick}
        disabled={generating}
        title="Snapshot the CSA file into a new Payment Application file"
        style={{
          borderColor: 'var(--brand)',
          color: 'var(--brand)',
          background: 'transparent',
        }}
      >
        {generating ? 'Generating…' : '+ Generate Payment Application'}
      </button>
      {error && (
        <span style={{ color: '#A32D2D', fontSize: 11 }}>{error}</span>
      )}
    </div>
  )
}
