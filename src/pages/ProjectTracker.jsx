import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, formatCurrency } from '../lib/utils'
import { Spinner, Pill } from '../components/ui'
import { useAuth } from '../lib/auth'

const STATUS_COLORS = {
  active: '#448a40',
  tender: '#9b87e0',
  on_hold: '#BA7517',
  completed: '#888780',
  cancelled: '#E24B4A',
}

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
  if (UK_CITY_COORDS[lower]) return UK_CITY_COORDS[lower]
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
  const [liveOpen, setLiveOpen] = useState(() => localStorage.getItem('track_live_open') === 'true')
  const [tenderOpen, setTenderOpen] = useState(() => localStorage.getItem('track_tender_open') === 'true')
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef([])
  const navigate = useNavigate()
  const { can } = useAuth()

  function toggleLive() { setLiveOpen(v => { localStorage.setItem('track_live_open', !v); return !v }) }
  function toggleTender() { setTenderOpen(v => { localStorage.setItem('track_tender_open', !v); return !v }) }

  useEffect(() => {
    if (!can('view_tracker')) navigate('/')
  }, [])

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_name, project_ref, client_name, status, value, site_address, city, postcode, start_date, end_date, profiles!projects_project_manager_id_fkey(full_name), project_subcontractors(id)')
      .order('created_at', { ascending: false })
    if (error) console.error('[ProjectTracker] load error:', error)

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
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    script.onload = () => {
      if (!mapRef.current || mapInstanceRef.current) return
      const L = window.L
      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true, attributionControl: false }).setView([53.0, -1.5], 6)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map)
      mapInstanceRef.current = map
      setMapReady(true)

      // Show user's live location as blue dot
      if (navigator.geolocation) {
        const userMarkerRef = { current: null }
        navigator.geolocation.watchPosition(
          (pos) => {
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            const userIcon = L.divIcon({
              className: 'custom-marker',
              html: `
                <div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
                  <div style="position:absolute;width:36px;height:36px;border-radius:50%;background:#FFD700;opacity:0.15;animation:mapPulse 2.5s ease-in-out infinite;"></div>
                  <div style="position:absolute;width:20px;height:20px;border-radius:50%;background:rgba(255,215,0,0.2);"></div>
                  <div style="width:10px;height:10px;border-radius:50%;background:#FFD700;border:2.5px solid #fff;box-shadow:0 1px 6px rgba(255,215,0,0.6);position:relative;z-index:2;"></div>
                </div>
              `,
              iconSize: [36, 36],
              iconAnchor: [18, 18],
            })
            if (userMarkerRef.current) {
              userMarkerRef.current.setLatLng([lat, lng])
            } else {
              userMarkerRef.current = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map)
              userMarkerRef.current.bindPopup(`
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:4px;text-align:center;">
                  <div style="font-size:13px;font-weight:600;color:#DAA520;">Your Location</div>
                </div>
              `)
            }
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
        )
      }
    }
    document.head.appendChild(script)
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null } }
  }, [loading])

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return
    const L = window.L
    const map = mapInstanceRef.current

    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
    const withCoords = filtered.filter(p => p.coords)

    withCoords.forEach(p => {
      const color = STATUS_COLORS[p.status] || '#888'
      const pulse = p.status === 'active'
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
      const value = can('view_project_value') && p.value ? formatCurrency(p.value) : ''

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
            <a href="/projects/${p.id}" style="font-size:12px;color:#448a40;font-weight:600;text-decoration:none;cursor:pointer;" onclick="event.preventDefault();window.__navigateToProject__('${p.id}')">View Project &rarr;</a>
          </div>
        </div>
      `, { maxWidth: 300 })

      markersRef.current.push(marker)
    })

    if (withCoords.length > 0) {
      const bounds = L.latLngBounds(withCoords.map(p => p.coords))
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
    }
  }, [mapReady, filter, projects])

  useEffect(() => {
    window.__navigateToProject__ = (id) => navigate(`/projects/${id}`)
    return () => { delete window.__navigateToProject__ }
  }, [navigate])

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)
  const counts = Object.keys(STATUS_COLORS).reduce((acc, s) => {
    acc[s] = projects.filter(p => p.status === s).length; return acc
  }, {})
  const valueByStatus = Object.keys(STATUS_COLORS).reduce((acc, s) => {
    acc[s] = projects.filter(p => p.status === s).reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)
    return acc
  }, {})
  const liveProjects = filtered.filter(p => p.status !== 'tender')
  const tenderProjects = filtered.filter(p => p.status === 'tender')

  if (loading) return <Spinner />

  return (
    <div>
      <style>{`
        @keyframes mapPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        .custom-marker { background: none !important; border: none !important; }
        .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.25) !important; }
        .leaflet-popup-tip { box-shadow: none !important; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Project Tracker</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{projects.length} projects</p>
        </div>
      </div>

      {/* Value cards: Active · Tender · Completed · Cancelled */}
      {can('view_project_value') && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div className="stat-card" style={{ borderTop: '3px solid #448a40' }}>
            <div className="stat-label">Active Value</div>
            <div className="stat-value green" style={{ fontSize: 18 }}>{valueByStatus.active > 0 ? formatCurrency(valueByStatus.active) : '—'}</div>
            <div className="stat-sub">{counts.active || 0} project{counts.active === 1 ? '' : 's'}</div>
          </div>
          <div className="stat-card" style={{ borderTop: '3px solid #9b87e0' }}>
            <div className="stat-label">Tender Value</div>
            <div className="stat-value" style={{ fontSize: 18, color: '#9b87e0' }}>{valueByStatus.tender > 0 ? formatCurrency(valueByStatus.tender) : '—'}</div>
            <div className="stat-sub">{counts.tender || 0} project{counts.tender === 1 ? '' : 's'}</div>
          </div>
          <div className="stat-card" style={{ borderTop: '3px solid #888780' }}>
            <div className="stat-label">Completed Value</div>
            <div className="stat-value" style={{ fontSize: 18, color: 'var(--text2)' }}>{valueByStatus.completed > 0 ? formatCurrency(valueByStatus.completed) : '—'}</div>
            <div className="stat-sub">{counts.completed || 0} project{counts.completed === 1 ? '' : 's'}</div>
          </div>
          <div className="stat-card" style={{ borderTop: '3px solid #E24B4A' }}>
            <div className="stat-label">Cancelled Value</div>
            <div className="stat-value" style={{ fontSize: 18, color: 'var(--red)' }}>{valueByStatus.cancelled > 0 ? formatCurrency(valueByStatus.cancelled) : '—'}</div>
            <div className="stat-sub">{counts.cancelled || 0} project{counts.cancelled === 1 ? '' : 's'}</div>
          </div>
        </div>
      )}

      <div className="filter-tabs" style={{ marginBottom: 14 }}>
        <div className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All<span className="tab-badge">{projects.length}</span>
        </div>
        {Object.entries(PROJECT_STATUSES).map(([k, v]) => (
          <div key={k} className={`filter-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(filter === k ? 'all' : k)}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[k], display: 'inline-block', flexShrink: 0 }} />
            {v.label}<span className="tab-badge">{counts[k] || 0}</span>
          </div>
        ))}
      </div>

      <div style={{ borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20 }}>
        <div ref={mapRef} style={{ height: 480, width: '100%', background: '#1a1a2e' }} />
      </div>

      {/* ─── Live Projects ────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-header" onClick={toggleLive}
          style={{ marginBottom: liveOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: liveOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#448a40', display: 'inline-block' }} />
            Live Projects
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginLeft: 4 }}>{liveProjects.length}</span>
            {!liveOpen && liveProjects.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto', fontWeight: 400 }}>Click to expand</span>
            )}
          </div>
        </div>
        {liveOpen && (
          liveProjects.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No live projects in current filter.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Client</th>
                    <th>Location</th>
                    {can('view_project_value') && <th>Value</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {liveProjects.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{p.project_name}</div>
                        {p.project_ref && <div style={{ fontSize: 11, color: 'var(--text3)' }}>#{p.project_ref}</div>}
                      </td>
                      <td>{p.client_name || '\u2014'}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{[p.site_address, p.city, p.postcode].filter(Boolean).join(', ') || '\u2014'}</td>
                      {can('view_project_value') && <td style={{ fontWeight: 500 }}>{p.value ? formatCurrency(p.value) : '\u2014'}</td>}
                      <td><Pill cls={PROJECT_STATUSES[p.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[p.status]?.label}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* ─── Tender Projects ──────────────────────────────────── */}
      <div>
        <div className="section-header" onClick={toggleTender}
          style={{ marginBottom: tenderOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: tenderOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9b87e0', display: 'inline-block' }} />
            Tender Projects
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginLeft: 4 }}>{tenderProjects.length}</span>
            {!tenderOpen && tenderProjects.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto', fontWeight: 400 }}>Click to expand</span>
            )}
          </div>
        </div>
        {tenderOpen && (
          tenderProjects.length === 0 ? (
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No projects at tender stage.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Client</th>
                    <th>Location</th>
                    {can('view_project_value') && <th>Value</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tenderProjects.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{p.project_name}</div>
                        {p.project_ref && <div style={{ fontSize: 11, color: 'var(--text3)' }}>#{p.project_ref}</div>}
                      </td>
                      <td>{p.client_name || '\u2014'}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{[p.site_address, p.city, p.postcode].filter(Boolean).join(', ') || '\u2014'}</td>
                      {can('view_project_value') && <td style={{ fontWeight: 500 }}>{p.value ? formatCurrency(p.value) : '\u2014'}</td>}
                      <td><Pill cls={PROJECT_STATUSES[p.status]?.cls || 'pill-gray'}>{PROJECT_STATUSES[p.status]?.label}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
