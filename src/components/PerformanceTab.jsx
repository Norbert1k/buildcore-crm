import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateTime } from '../lib/utils'
import { Avatar, Pill, Modal, Field, IconPlus, IconTrash, ConfirmDialog } from './ui'
import { useAuth } from '../lib/auth'

const RATING_TYPES = {
  commendation: { label: 'Commendation', icon: '👍', color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-border)', pill: 'pill-green' },
  yellow_card:  { label: 'Yellow Card',  icon: '🟡', color: 'var(--amber)', bg: 'var(--amber-bg)', border: 'var(--amber-border)', pill: 'pill-amber' },
  red_card:     { label: 'Red Card',     icon: '🔴', color: 'var(--red)',   bg: 'var(--red-bg)',   border: 'var(--red-border)',   pill: 'pill-red'   },
}

const CATEGORIES = {
  quality_of_work:  'Quality of Work',
  health_safety:    'Health & Safety',
  timekeeping:      'Timekeeping',
  communication:    'Communication',
  site_cleanliness: 'Site Cleanliness',
  documentation:    'Documentation',
  attitude:         'Attitude & Conduct',
  general:          'General',
}

export function calcRating(ratings) {
  if (!ratings || ratings.length === 0) return null
  const commendations = ratings.filter(r => r.rating_type === 'commendation').length
  const yellows = ratings.filter(r => r.rating_type === 'yellow_card').length
  const reds = ratings.filter(r => r.rating_type === 'red_card').length
  const score = Math.max(0, Math.min(100, Math.round(
    ((commendations * 10) - (yellows * 15) - (reds * 30) + 50)
  ))
  )
  let label, color, bg
  if (reds >= 3)        { label = 'Blacklisted'; color = '#fff'; bg = '#1C1B18' }
  else if (score >= 80) { label = 'Excellent';   color = 'var(--green)'; bg = 'var(--green-bg)' }
  else if (score >= 60) { label = 'Good';        color = 'var(--blue)';  bg = 'var(--blue-bg)'  }
  else if (score >= 40) { label = 'Fair';        color = 'var(--amber)'; bg = 'var(--amber-bg)' }
  else if (score >= 20) { label = 'Poor';        color = 'var(--red)';   bg = 'var(--red-bg)'   }
  else                  { label = 'Very Poor';   color = 'var(--red)';   bg = 'var(--red-bg)'   }
  return { score, label, color, bg, commendations, yellows, reds, total: ratings.length }
}

export function RatingBadge({ ratings, size = 'sm' }) {
  const r = calcRating(ratings)
  if (!r) return null
  const fontSize = size === 'lg' ? 13 : 11
  const padding = size === 'lg' ? '5px 12px' : '2px 8px'
  return (
    <div style={{ background: r.bg, color: r.color, fontWeight: 700, fontSize, padding, borderRadius: 20, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {r.label}
    </div>
  )
}

export default function PerformanceTab({ subcontractorId, subName, subEmail, ratings, projects, onRefresh }) {
  const { can, profile } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [filterType, setFilterType] = useState('all')

  const r = calcRating(ratings)
  const filtered = filterType === 'all' ? ratings : ratings.filter(x => x.rating_type === filterType)

  async function deleteRating(id) {
    await supabase.from('performance_ratings').delete().eq('id', id)
    setConfirmDelete(null)
    onRefresh()
  }

  return (
    <div>
      {/* Summary */}
      {r && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Overall Rating</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: r.bg, color: r.color, fontWeight: 700, fontSize: 15, padding: '6px 14px', borderRadius: 20 }}>{r.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{r.total} rating{r.total !== 1 ? 's' : ''} total</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <RatingStat icon="👍" label="Commendations" value={r.commendations} color="var(--green)" />
            <RatingStat icon="🟡" label="Yellow Cards" value={r.yellows} color="var(--amber)" />
            <RatingStat icon="🔴" label="Red Cards" value={r.reds} color="var(--red)" />
          </div>
        </div>
      )}

      <div className="section-header">
        <div style={{ display: 'flex', gap: 6 }}>
          {['all','commendation','yellow_card','red_card'].map(t => (
            <button key={t} className={`filter-tab ${filterType === t ? 'active' : ''}`} onClick={() => setFilterType(t)}>
              {t === 'all' ? `All (${ratings.length})` : `${RATING_TYPES[t].icon} ${RATING_TYPES[t].label} (${ratings.filter(x=>x.rating_type===t).length})`}
            </button>
          ))}
        </div>
        {can('manage_projects') && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
            <IconPlus size={13} /> Issue Rating
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No performance ratings issued yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(rating => {
            const rt = RATING_TYPES[rating.rating_type]
            return (
              <div key={rating.id} style={{ background: 'var(--surface)', border: `1px solid ${rt.border}`, borderRadius: 'var(--radius)', borderLeft: `4px solid ${rt.color}`, padding: '12px 14px', display: 'flex', gap: 12 }}>
                <div style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{rt.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: rt.color }}>{rt.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 7px', borderRadius: 10 }}>{CATEGORIES[rating.category] || rating.category}</span>
                    {rating.projects?.project_name && (
                      <span style={{ fontSize: 11, color: 'var(--blue)' }}>📋 {rating.projects.project_name}</span>
                    )}
                    {rating.email_sent && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Email sent</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 4, whiteSpace: 'pre-wrap' }}>{rating.description}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {formatDateTime(rating.created_at)}
                    {rating.profiles?.full_name && ` · Issued by ${rating.profiles.full_name}`}
                  </div>
                </div>
                {can('manage_projects') && (
                  <button className="btn btn-sm btn-danger" style={{ flexShrink: 0, alignSelf: 'flex-start' }} onClick={() => setConfirmDelete(rating.id)}>
                    <IconTrash size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <IssueRatingModal
          subcontractorId={subcontractorId}
          subName={subName}
          subEmail={subEmail}
          projects={projects}
          issuedBy={profile}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); onRefresh() }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteRating(confirmDelete)}
        title="Remove rating"
        message="Remove this performance rating? This cannot be undone."
        danger
      />
    </div>
  )
}

function RatingStat({ icon, label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</div>
    </div>
  )
}

function IssueRatingModal({ subcontractorId, subName, subEmail, projects, issuedBy, onClose, onSaved }) {
  const [form, setForm] = useState({ rating_type: 'yellow_card', category: 'quality_of_work', project_id: '', description: '', send_email: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  const rt = RATING_TYPES[form.rating_type]

  async function save() {
    if (!form.description.trim()) { setError('Please describe the reason for this rating'); return }
    setSaving(true)

    const payload = {
      subcontractor_id: subcontractorId,
      rating_type: form.rating_type,
      category: form.category,
      project_id: form.project_id || null,
      description: form.description,
      issued_by: issuedBy?.id,
      email_sent: false,
    }

    const { data, error: err } = await supabase.from('performance_ratings').insert(payload).select().single()
    if (err) { setError(err.message); setSaving(false); return }

    // Send email notification if requested and not a commendation... or commendation too
    if (form.send_email && subEmail) {
      try {
        await supabase.functions.invoke('smooth-task', {
          body: {
            to: subEmail,
            subName,
            ratingType: form.rating_type,
            ratingLabel: rt.label,
            category: CATEGORIES[form.category],
            description: form.description,
            issuedBy: issuedBy?.full_name || 'City Construction',
          }
        })
        await supabase.from('performance_ratings').update({ email_sent: true }).eq('id', data.id)
      } catch (e) {
        // Email failed silently — rating still saved
        console.warn('Email send failed:', e)
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`Issue Rating: ${subName}`} size="md"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving} style={{ background: rt.color, borderColor: rt.color }}>{saving ? 'Saving...' : `Issue ${rt.label}`}</button></>}>
      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-border)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Rating type selector */}
        <div>
          <label>Rating Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 6 }}>
            {Object.entries(RATING_TYPES).map(([k, v]) => (
              <button key={k} type="button" onClick={() => set('rating_type', k)} style={{
                padding: '10px 8px', borderRadius: 'var(--radius)', border: `2px solid ${form.rating_type === k ? v.color : 'var(--border)'}`,
                background: form.rating_type === k ? v.bg : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all .15s'
              }}>
                <span style={{ fontSize: 22 }}>{v.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: form.rating_type === k ? v.color : 'var(--text2)' }}>{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Category">
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>

        {projects && projects.length > 0 && (
          <Field label="Related Project (optional)">
            <select value={form.project_id} onChange={e => set('project_id', e.target.value)}>
              <option value="">— No specific project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Description *">
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            placeholder={
              form.rating_type === 'commendation' ? 'Describe what was done well...' :
              form.rating_type === 'yellow_card' ? 'Describe the issue and what improvement is expected...' :
              'Describe the serious issue and consequences...'
            }
            style={{ minHeight: 100 }} />
        </Field>

        {subEmail && (
          <div
            onClick={() => set('send_email', !form.send_email)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', fontSize: 13, background: form.send_email ? 'var(--green-bg)' : 'var(--surface2)', padding: '12px 14px', borderRadius: 'var(--radius)', border: form.send_email ? '1px solid var(--green-border)' : '1px solid var(--border)', userSelect: 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${form.send_email ? 'var(--green)' : 'var(--border2)'}`, background: form.send_email ? 'var(--green)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
              {form.send_email && <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: form.send_email ? 'var(--green)' : 'var(--text)' }}>Send email notification to subcontractor</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{subEmail}</div>
            </div>
          </div>
        )}
        {!subEmail && (
          <div style={{ fontSize: 12, color: 'var(--amber)', background: 'var(--amber-bg)', padding: '8px 12px', borderRadius: 'var(--radius)' }}>
            No email address on file — notification cannot be sent. Add an email to this subcontractor to enable notifications.
          </div>
        )}
      </div>
    </Modal>
  )
}
