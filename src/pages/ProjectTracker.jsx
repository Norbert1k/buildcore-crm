import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, formatCurrency } from '../lib/utils'
import { Spinner } from '../components/ui'

import { useAuth } from '../lib/auth'

const STATUS_COLORS = {
  active: '#448a40',
  tender: '#378ADD',
  on_hold: '#BA7517',
  completed: '#888780',
  cancelled: '#E24B4A',
}

const STATUS_PULSE = {
  active: true,
  tender: false,
  on_hold: false,
  completed: false,
  cancelled: false,
}

// UK city coordinates fallback (when geocoding fails)
const UK_CITY_COORDS = {
  'london': [51.5074, -0.1278], 'bath': [51.3811, -2.3590], 'bristol': [51.4545, -2.5879],
  'birmingham': [52.4862, -1.8904], 'manchester': [53.4808, -2.2426], 'leeds': [53.8008, -1.5491],
  'liverpool': [53.4084, -2.9916], 'sheffield': [53.3811, -1.4701], 'nottingham': [52.9548, -1.1581],
  'leicester': [52.6369, -1.1398], 'coventry': [52.4068, -1.5197], 'cardiff': [51.4816, -3.1791],
  'edinburgh': [55.9533, -3.1883], 'glasgow': [55.8642, -4.2518], 'newcastle': [54.9783, -1.6178],
  'southampton': [50.9097, -1.4044], 'portsmouth': [50.8198, -1.0880], 'oxford': [51.7520, -1.2577],
  'cambridge': [52.2053, 0.1218], 'york': [53.9591, -1.0815], 'brighton': [50.8225, -0.1372],
  'exeter': [50.7184, -3.5339], 'plymouth': [50.3755, -4.1427], 'norwich': [52.6309, 1.2974],
  'reading': [51.4543, -0.9781], 'swindon': [51.5558, -1.7797], 'luton': [51.8787, -0.4200],
  'derby': [52.9225, -1.4746], 'wolverhampton': [52.5870, -2.1288], 'stoke': [53.0027, -2.1794],
  'swansea': [51.6214, -3.9436], 'middlesbrough': [54.5742, -1.2350], 'bolton': [53.5785, -2.4299],
  'blackpool': [53.8175, -3.0357], 'ipswich': [52.0567, 1.1482], 'croydon': [51.3762, -0.0982],
  'merton': [51.4098, -0.1949], 'tooting': [51.4284, -0.1688], 'mitcham': [51.4015, -0.1538],
  'waltham': [51.5886, -0.0118], 'bishops waltham': [51.0384, -1.2112],
  'hopton': [52.4505, 1.7171],
}

async function geocodePostcode(postcode) {
  if (!postcode) return null
  try {
    const clean = postcode.replace(/\s+/g, '')
    const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`)
    const data = await res.json()
    if (data.status === 200 && data.result) {
      return [data.result.latitude, data.result.longitude]
    }
  } catch (e) { /* silent fail */ }
  return null
}

function guessFromCity(city) {
  if (!city) return null
  const lower = city.toLowerCase().trim()
  // Try exact match first
  if (UK_CITY_COORDS[lower]) return UK_CITY_COORDS[lower]
  // Try partial match
  for (const [key, coords] of Object.entries(UK_CITY_COORDS)) {
    if (lower.includes(key) || key.includes(lower)) return coords
  }
  return null
}

export default function ProjectTracker() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [mapReady, setMapReady] = useState(false)
  const [selected, setSelected] = useState(null)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef([])
  const navigate = useNavigate()
  const { can } = useAuth()

  useEffect(() => {
    if (!can('view_tracker')) navigate('/')
  }, [])

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('id, project_name, project_ref, client_name, status, value, site_address, city, postcode, start_date, end_date, profiles!projects_project_manager_id_fkey(full_name), project_subcontractors(id)')
      .order('created_at', { ascending: false })

    // Geocode all projects
    const withCoords = await Promise.all((data || []).map(async (p) => {
      let coords = await geocodePostcode(p.postcode)
      if (!coords) coords = guessFromCity(p.city)
      if (!coords) coords = guessFromCity(p.project_name)
      return { ...p, coords }
    }))

    setProjects(withCoords)
    setLoading(false)
  }

  useEffect(() => {
    if (loading || mapReady) return

    // Load Leaflet CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
    document.head.appendChild(link)

    // Load Leaflet JS
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    script.onload = () => {
      if (!mapRef.current || mapInstanceRef.current) return
      const L = window.L
      const map = L.map(mapRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
      }).setView([53.0, -1.5], 6)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map)

      mapInstanceRef.current = map
      setMapReady(true)
    }
    document.head.appendChild(script)

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [loading])

  // Update markers when filter changes
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return
    const L = window.L
    const map = mapInstanceRef.current

    // Clear existing markers
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
    const withCoords = filtered.filter(p => p.coords)

    withCoords.forEach(p => {
      const color = STATUS_COLORS[p.status] || '#888'
      const pulse = STATUS_PULSE[p.status]
      const size = p.status === 'active' ? 14 : 10

      const icon = L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="position:relative;width:${size * 2}px;height:${size * 2}px;display:flex;align-items:center;justify-content:center;">
            ${pulse ? `<div style="position:absolute;width:${size * 2}px;height:${size * 2}px;border-radius:50%;background:${color};opacity:0.3;animation:mapPulse 2s ease-in-out infinite;"></div>` : ''}
            <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.4);position:relative;z-index:2;cursor:pointer;transition:transform .15s;"></div>
          </div>
        `,
        iconSize: [size * 2, size * 2],
        iconAnchor: [size, size],
      })

      const marker = L.marker(p.coords, { icon }).addTo(map)

      const location = [p.site_address, p.city, p.postcode].filter(Boolean).join(', ')
      const statusLabel = PROJECT_STATUSES[p.status]?.label || p.status
      const value = p.value ? formatCurrency(p.value) : ''

      marker.bindPopup(`
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-width:220px;padding:4px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;color:#1a1a1a;">${p.project_name}</div>
          ${p.project_ref ? `<div style="font-size:11px;color:#888;margin-bottom:8px;">#${p.project_ref}</div>` : ''}
          <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#555;">
            ${p.client_name ? `<div><span style="color:#999;">Client:</span> ${p.client_name}</div>` : ''}
            ${location ? `<div><span style="color:#999;">Location:</span> ${location}</div>` : ''}
            ${p.profiles?.full_name ? `<div><span style="color:#999;">PM:</span> ${p.profiles.full_name}</div>` : ''}
            ${value ? `<div><span style="color:#999;">Value:</span> <strong>${value}</strong></div>` : ''}
          </div>
          <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;">
            <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:white;background:${color};">${statusLabel}</span>
            <a href="/projects/${p.id}" style="font-size:12px;color:#448a40;font-weight:600;text-decoration:none;cursor:pointer;" onclick="event.preventDefault();window.__navigateToProject__('${p.id}')">View Project →</a>
          </div>
        </div>
      `, { maxWidth: 300 })

      marker.on('click', () => setSelected(p))
      markersRef.current.push(marker)
    })

    // Fit bounds if we have markers
    if (withCoords.length > 0) {
      const bounds = L.latLngBounds(withCoords.map(p => p.coords))
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
    }
  }, [mapReady, filter, projects])

  // Global navigate handler for popup links
  useEffect(() => {
    window.__navigateToProject__ = (id) => navigate(`/projects/${id}`)
    return () => { delete window.__navigateToProject__ }
  }, [navigate])

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
  const counts = Object.keys(STATUS_COLORS).reduce((acc, s) => {
    acc[s] = projects.filter(p => p.status === s).length; return acc
  }, {})
  const totalValue = filtered.reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)

  if (loading) return <Spinner />

  return (
    <div>
      {/* Pulse animation */}
      <style>{`
        @keyframes mapPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        .custom-marker { background: none !important; border: none !important; }
        .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.25) !important; }
        .leaflet-popup-tip { box-shadow: none !important; }
        .tracker-stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); padding: 14px 18px; text-align: center; }
        .tracker-stat-label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        .tracker-stat-value { font-size: 22px; font-weight: 700; }
        .tracker-filter { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
        .tracker-filter-btn { padding: 6px 14px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--surface); color: var(--text2); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 6px; }
        .tracker-filter-btn:hover { border-color: var(--text3); }
        .tracker-filter-btn.active { background: var(--green, #448a40); color: white; border-color: var(--green, #448a40); }
        .tracker-filter-btn .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .tracker-filter-btn .count { background: rgba(255,255,255,0.2); padding: 1px 7px; border-radius: 10px; font-size: 11px; }
        .tracker-filter-btn.active .count { background: rgba(255,255,255,0.25); }
        .tracker-list-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background .1s; }
        .tracker-list-item:hover { background: var(--surface2); }
        .tracker-list-item:last-child { border-bottom: none; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Project Tracker</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Live map of all {projects.length} projects across the UK</p>
        </div>
        <button className="btn btn-sm" onClick={() => navigate('/projects')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          List View
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="tracker-stat" style={{ borderTop: `3px solid ${color}`, cursor: 'pointer', background: filter === status ? 'var(--surface2)' : undefined }} onClick={() => setFilter(filter === status ? 'all' : status)}>
            <div className="tracker-stat-label">{PROJECT_STATUSES[status]?.label}</div>
            <div className="tracker-stat-value" style={{ color }}>{counts[status] || 0}</div>
          </div>
        ))}
        <div className="tracker-stat" style={{ borderTop: '3px solid var(--green, #448a40)' }}>
          <div className="tracker-stat-label">Total Value</div>
          <div className="tracker-stat-value" style={{ color: 'var(--green, #448a40)', fontSize: 16 }}>{formatCurrency(totalValue)}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tracker-filter">
        <button className={`tracker-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All <span className="count">{projects.length}</span>
        </button>
        {Object.entries(PROJECT_STATUSES).map(([k, v]) => (
          <button key={k} className={`tracker-filter-btn ${filter === k ? 'active' : ''}`}
            style={filter === k ? { background: STATUS_COLORS[k], borderColor: STATUS_COLORS[k] } : {}}
            onClick={() => setFilter(filter === k ? 'all' : k)}>
            <span className="dot" style={{ background: STATUS_COLORS[k] }} />
            {v.label} <span className="count">{counts[k] || 0}</span>
          </button>
        ))}
      </div>

      {/* Map */}
      <div style={{ borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 16 }}>
        <div ref={mapRef} style={{ height: 500, width: '100%', background: '#1a1a2e' }} />
      </div>

      {/* Project List (below map) */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{filtered.length} Project{filtered.length !== 1 ? 's' : ''} {filter !== 'all' ? `(${PROJECT_STATUSES[filter]?.label})` : ''}</div>
          {filter !== 'all' && <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setFilter('all')}>Show all</button>}
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No projects match this filter</div>
        ) : (
          filtered.map(p => (
            <div key={p.id} className="tracker-list-item" onClick={() => navigate(`/projects/${p.id}`)}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[p.status] || '#888', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.project_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[p.client_name, p.city].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, color: 'var(--text)' }}>{p.value ? formatCurrency(p.value) : ''}</div>
              <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: 'white', background: STATUS_COLORS[p.status] || '#888', flexShrink: 0 }}>
                {PROJECT_STATUSES[p.status]?.label}
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
