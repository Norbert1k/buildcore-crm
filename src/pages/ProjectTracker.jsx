import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STATUSES, formatCurrency } from '../lib/utils'
import { Spinner, Pill } from '../components/ui'
import { useAuth } from '../lib/auth'

// Tile providers used for the map. Keys map to values stored in
// profiles.map_style. 'auto' is the default — derived from the active
// CRM theme via deriveAutoStyle() below. The other four are explicit
// overrides the user can pick from the in-map picker.
//
// All providers are free for reasonable usage and don't require API keys.
// Voyager (CartoDB) is the default "colour" option — looks like a
// muted Google Maps. OSM standard is the classic OpenStreetMap look.
const MAP_STYLES = {
  dark: {
    label: 'Dark',
    // Esri Dark Gray Canvas — keyless (CARTO now watermarks unkeyed tiles)
    url:   'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attr:  '© OpenStreetMap contributors Tiles © Esri',
  },
  light: {
    label: 'Light',
    // Esri Light Gray Canvas — keyless
    url:   'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attr:  '© OpenStreetMap contributors Tiles © Esri',
  },
  colour: {
    label: 'Colour',
    // Esri World Street Map — keyless colour style
    url:   'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attr:  '© OpenStreetMap contributors Tiles © Esri',
  },
  osm: {
    label: 'OSM',
    url:   'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr:  '© OpenStreetMap contributors',
  },
}

// Themes considered "dark" for the auto-map-style derivation. Must stay in
// sync with the DARK_THEMES set in Sidebar.jsx and the ones defined in
// index.css. Pearl White, Light, Rose, Mint, Sand are light → light map.
const DARK_THEMES_FOR_MAP = new Set(['dark', 'forest', 'slate'])

function deriveAutoStyle(theme) {
  return DARK_THEMES_FOR_MAP.has(theme) ? 'dark' : 'light'
}

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

// London centroid — anchor for "Furthest project" distance calculation.
// Roughly central London (Charing Cross). Used as the proxy for CCG HQ
// for the geographic-spread metric on the tracker header.
const LONDON_ANCHOR = [51.5074, -0.1278]

// Great-circle distance between two [lat, lng] points, in miles. Standard
// haversine. Result rounded to whole miles where the consumer needs it.
function haversineMiles(a, b) {
  if (!a || !b) return null
  const toRad = (deg) => (deg * Math.PI) / 180
  const R = 3958.8                 // earth's radius in miles
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// UK postcode area → government region. Areas are the 1-2 letter prefix of
// a postcode (e.g. "SW1A 1AA" → "SW", "BA12 7AA" → "BA"). Coverage isn't
// 100% perfect — some postcodes straddle regions — but it's good enough for
// the "Regions covered" KPI on the tracker header.
const POSTCODE_REGIONS = {
  // London (all London postcodes)
  E:'London', EC:'London', N:'London', NW:'London', SE:'London', SW:'London', W:'London', WC:'London',
  // South East
  BN:'South East', CT:'South East', GU:'South East', ME:'South East', OX:'South East',
  PO:'South East', RG:'South East', RH:'South East', SL:'South East', SO:'South East',
  TN:'South East', BR:'South East', CR:'South East', DA:'South East', KT:'South East',
  SM:'South East', TW:'South East', UB:'South East', WD:'South East', EN:'South East',
  HA:'South East', IG:'South East', RM:'South East',
  // South West
  BA:'South West', BH:'South West', BS:'South West', DT:'South West', EX:'South West',
  GL:'South West', PL:'South West', SN:'South West', SP:'South West', TA:'South West',
  TQ:'South West', TR:'South West',
  // East of England
  AL:'East of England', CB:'East of England', CM:'East of England', CO:'East of England',
  HP:'East of England', IP:'East of England', LU:'East of England', MK:'East of England',
  NR:'East of England', PE:'East of England', SG:'East of England', SS:'East of England',
  // West Midlands
  B:'West Midlands', CV:'West Midlands', DY:'West Midlands', HR:'West Midlands',
  ST:'West Midlands', SY:'West Midlands', TF:'West Midlands', WR:'West Midlands',
  WS:'West Midlands', WV:'West Midlands',
  // East Midlands
  DE:'East Midlands', LE:'East Midlands', LN:'East Midlands', NG:'East Midlands',
  NN:'East Midlands',
  // North West
  BB:'North West', BL:'North West', CA:'North West', CH:'North West', CW:'North West',
  FY:'North West', L:'North West', LA:'North West', M:'North West', OL:'North West',
  PR:'North West', SK:'North West', WA:'North West', WN:'North West',
  // Yorkshire & the Humber
  BD:'Yorkshire', DN:'Yorkshire', HD:'Yorkshire', HG:'Yorkshire', HU:'Yorkshire',
  HX:'Yorkshire', LS:'Yorkshire', S:'Yorkshire', WF:'Yorkshire', YO:'Yorkshire',
  // North East
  DH:'North East', DL:'North East', NE:'North East', SR:'North East', TS:'North East',
  // Scotland
  AB:'Scotland', DD:'Scotland', DG:'Scotland', EH:'Scotland', FK:'Scotland',
  G:'Scotland', HS:'Scotland', IV:'Scotland', KA:'Scotland', KW:'Scotland',
  KY:'Scotland', ML:'Scotland', PA:'Scotland', PH:'Scotland', TD:'Scotland',
  ZE:'Scotland',
  // Wales
  CF:'Wales', LD:'Wales', LL:'Wales', NP:'Wales', SA:'Wales',
  // Northern Ireland
  BT:'Northern Ireland',
}

// Extract the postcode-area letters from a full postcode. "BA12 7AA" → "BA".
// Returns null if the input doesn't match the expected pattern.
function postcodeArea(postcode) {
  if (!postcode) return null
  const m = String(postcode).trim().toUpperCase().match(/^([A-Z]{1,2})/)
  return m ? m[1] : null
}

function regionForPostcode(postcode) {
  const area = postcodeArea(postcode)
  if (!area) return null
  return POSTCODE_REGIONS[area] || 'Other'
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
  // User's live geolocation, used by both the map's blue dot and the
  // "Nearest live site" KPI card on the header. Null = geolocation not
  // available (denied, pending, or browser unsupported). Updated by the
  // navigator.geolocation watcher started in the map effect below.
  const [userCoords, setUserCoords] = useState(null)
  const [liveOpen, setLiveOpen] = useState(() => localStorage.getItem('track_live_open') === 'true')
  const [tenderOpen, setTenderOpen] = useState(() => localStorage.getItem('track_tender_open') === 'true')
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const tileLayerRef = useRef(null)
  const markersRef = useRef([])
  const navigate = useNavigate()
  const { can, profile, setMapStyle, division } = useAuth()

  // Map style state. The persisted override comes from profiles.map_style
  // (or localStorage as a fallback for first-time use). null/empty means
  // "auto" — follow the CRM theme. The picker shows 5 buttons: Auto + the
  // 4 explicit styles.
  const [styleOverride, setStyleOverride] = useState(() => {
    return profile?.map_style || (typeof window !== 'undefined' ? localStorage.getItem('map_style') : '') || ''
  })

  // Track the currently-applied data-theme so changes to the CRM theme
  // re-derive the map style when the override is "auto". Uses a
  // MutationObserver mirroring the pattern in Sidebar.jsx.
  const [activeTheme, setActiveTheme] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') || 'light' : 'light'
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setActiveTheme(document.documentElement.getAttribute('data-theme') || 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // When the profile loads from auth (async), pick up its saved value.
  useEffect(() => {
    if (profile?.map_style != null) setStyleOverride(profile.map_style || '')
  }, [profile?.map_style])

  // The effective style key — explicit override wins; otherwise derive
  // from the current theme.
  const effectiveStyle = styleOverride && MAP_STYLES[styleOverride]
    ? styleOverride
    : deriveAutoStyle(activeTheme)

  function toggleLive() { setLiveOpen(v => { localStorage.setItem('track_live_open', !v); return !v }) }
  function toggleTender() { setTenderOpen(v => { localStorage.setItem('track_tender_open', !v); return !v }) }

  useEffect(() => {
    if (!can('view_tracker')) navigate('/')
  }, [])

  useEffect(() => { loadProjects() }, [division])

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_name, project_ref, client_name, status, value, site_address, city, postcode, start_date, end_date, director:profiles!projects_project_director_id_fkey(full_name), project_subcontractors(id)')
      .eq('division', division)
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
      // Initial tile layer uses the resolved effective style. The swap
      // effect below replaces this when the user changes style or theme.
      const style = MAP_STYLES[effectiveStyle] || MAP_STYLES.dark
      tileLayerRef.current = L.tileLayer(style.url, { maxZoom: 19, attribution: style.attr }).addTo(map)
      mapInstanceRef.current = map
      setMapReady(true)

      // Show user's live location as blue dot
      if (navigator.geolocation) {
        const userMarkerRef = { current: null }
        navigator.geolocation.watchPosition(
          (pos) => {
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            // Lift coords to component state for the "Nearest live site" KPI.
            // Watcher fires repeatedly as user moves; the state update is
            // cheap (only triggers re-renders that depend on userCoords).
            setUserCoords([lat, lng])
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
            ${p.director?.full_name ? `<div><span style="color:#999;">Assigned:</span> ${p.director.full_name}</div>` : ''}
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

  // Swap the tile layer whenever the effective style changes. This fires
  // when the user picks an override OR when the CRM theme changes while
  // override is "auto". The map instance and markers persist — only the
  // tile provider is replaced.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return
    const L = window.L
    if (!L) return
    const style = MAP_STYLES[effectiveStyle] || MAP_STYLES.dark
    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current)
    }
    tileLayerRef.current = L.tileLayer(style.url, { maxZoom: 19, attribution: style.attr })
      .addTo(mapInstanceRef.current)
  }, [effectiveStyle, mapReady])

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

  // ── Header KPIs ────────────────────────────────────────────────────────
  // Geographic stats aggregate over BOTH active and tender projects — the
  // user wants tender markers visible in distance/regions metrics. Hero
  // values split active and tender into two separate counters.
  const liveOrTender = projects.filter(p => p.status === 'active' || p.status === 'tender')

  // Tender hero — count + summed value. Mirrors how the active hero is
  // built off valueByStatus.active and counts.active.
  const tenderTotal = valueByStatus.tender || 0
  const tenderCount = counts.tender || 0

  // Regions covered (postcode-derived). UK government regions inferred
  // from the postcode area prefix. Projects without a parseable postcode
  // contribute null and are excluded.
  const regionsCovered = (() => {
    const set = new Set()
    for (const p of liveOrTender) {
      const r = regionForPostcode(p.postcode)
      if (r) set.add(r)
    }
    return Array.from(set).sort()
  })()

  // Regional spread for the proportional bar — count of projects per region,
  // sorted descending by count. Used to render the visual "regional spread"
  // bar below the heroes. Each entry: { region, count }.
  const regionalSpread = (() => {
    const counts = new Map()
    for (const p of liveOrTender) {
      const r = regionForPostcode(p.postcode)
      if (!r) continue
      counts.set(r, (counts.get(r) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
  })()

  // Furthest project from London (active + tender). Uses geocoded coords
  // (already resolved during loadProjects). Skips projects without coords.
  const furthestFromLondon = (() => {
    let best = null
    for (const p of liveOrTender) {
      if (!p.coords) continue
      const dist = haversineMiles(LONDON_ANCHOR, p.coords)
      if (dist == null) continue
      if (!best || dist > best.distance) best = { project: p, distance: dist }
    }
    return best
  })()

  // Nearest project to user's current location (active + tender). Only
  // computed if userCoords is available (geolocation granted). Otherwise
  // the inline stat is hidden.
  const nearestToUser = userCoords ? (() => {
    let best = null
    for (const p of liveOrTender) {
      if (!p.coords) continue
      const dist = haversineMiles(userCoords, p.coords)
      if (dist == null) continue
      if (!best || dist < best.distance) best = { project: p, distance: dist }
    }
    return best
  })() : null

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

      {/* Tracker header — single panel containing:
            Row 1: Two heroes (£X live · sites) + (£X tender · projects) on
                   the left, supporting stats (furthest / nearest) inline
                   on the right.
            Row 2: Regional spread bar — proportional segments showing
                   project distribution across UK regions, including tender.
            Row 3: Status filter pills (replaces the old filter-tabs strip).

          Geographic stats span ACTIVE + TENDER projects (per spec). The
          "Nearest to you" inline stat is hidden when geolocation isn't
          granted; the others always render. */}
      {can('view_project_value') && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 18px',
          marginBottom: 14,
        }}>
          {/* Row 1 — heroes + supporting stats */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap' }}>
            {/* Active hero */}
            <div>
              <span style={{ fontSize: 26, fontWeight: 600, color: 'var(--green)', lineHeight: 1 }}>
                {valueByStatus.active > 0 ? formatCurrency(valueByStatus.active) : '£0'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                live · {counts.active || 0} {counts.active === 1 ? 'site' : 'sites'}
              </span>
            </div>
            {/* Vertical divider */}
            <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
            {/* Tender hero */}
            <div>
              <span style={{ fontSize: 22, fontWeight: 600, color: '#9b87e0', lineHeight: 1 }}>
                {tenderTotal > 0 ? formatCurrency(tenderTotal) : '£0'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                tender · {tenderCount} {tenderCount === 1 ? 'project' : 'projects'}
              </span>
            </div>
            {/* Supporting stats — push to the right on wide screens */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap' }}>
              {furthestFromLondon && (
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {Math.round(furthestFromLondon.distance)}<span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 2 }}>mi</span>
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>
                    furthest · {furthestFromLondon.project.project_name}
                  </span>
                </div>
              )}
              {nearestToUser && (
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#FFD700' }}>
                    {nearestToUser.distance < 1
                      ? nearestToUser.distance.toFixed(1)
                      : Math.round(nearestToUser.distance)}<span style={{ fontSize: 10, color: 'rgba(255,215,0,0.6)', marginLeft: 2 }}>mi</span>
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>
                    nearest · {nearestToUser.project.project_name}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Row 2 — Regional spread bar. Only renders if at least one
              project has a parseable postcode. Bar is proportional to
              project count per region. Each region gets a colour from
              REGION_PALETTE; overflow regions (>6) lump into 'Other' gray. */}
          {regionalSpread.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Regional spread
                </span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {regionsCovered.length} {regionsCovered.length === 1 ? 'region' : 'regions'}
                </span>
              </div>
              <RegionalSpreadBar spread={regionalSpread} />
            </div>
          )}

          {/* Row 3 — Status filter pills inside the same panel, separated
              by a hairline. Same behaviour as the previous standalone pill
              row. */}
          <div style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 12,
            paddingTop: 12,
            borderTop: '0.5px solid var(--border)',
          }}>
            <StatusFilterPill
              label="All" count={projects.length}
              active={filter === 'all'}
              accentColor="var(--accent)"
              onClick={() => setFilter('all')}
            />
            {Object.entries(PROJECT_STATUSES).map(([k, v]) => (
              <StatusFilterPill
                key={k} label={v.label} count={counts[k] || 0}
                active={filter === k}
                accentColor={STATUS_COLORS[k]}
                onClick={() => setFilter(filter === k ? 'all' : k)}
              />
            ))}
          </div>
        </div>
      )}

      {/* When the user can't view financial values, render just the status
          pills standalone (no panel needed). */}
      {!can('view_project_value') && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <StatusFilterPill
            label="All" count={projects.length}
            active={filter === 'all'}
            accentColor="var(--accent)"
            onClick={() => setFilter('all')}
          />
          {Object.entries(PROJECT_STATUSES).map(([k, v]) => (
            <StatusFilterPill
              key={k} label={v.label} count={counts[k] || 0}
              active={filter === k}
              accentColor={STATUS_COLORS[k]}
              onClick={() => setFilter(filter === k ? 'all' : k)}
            />
          ))}
        </div>
      )}

      <div style={{ borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20, position: 'relative' }}>
        <div ref={mapRef} style={{ height: 480, width: '100%', background: '#1a1a2e' }} />
        {/* Map-style picker overlay. Positioned over the map's top-right
            corner. 'Auto' = no override (follows theme); the four explicit
            buttons each persist via setMapStyle. The active button is
            highlighted — when override is empty, 'Auto' is active and the
            current effective style still shows in muted text underneath. */}
        <MapStylePicker
          override={styleOverride}
          effective={effectiveStyle}
          onPick={(value) => {
            setStyleOverride(value)
            setMapStyle(value)
          }}
        />
      </div>

      {/* ─── Live Projects ────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-header" onClick={toggleLive}
          style={{ marginBottom: liveOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)' }}>
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
          style={{ marginBottom: tenderOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)' }}>
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

// ─── MapStylePicker ────────────────────────────────────────────────────────
//
// In-map overlay that lets the user pick a tile style. 5 buttons total:
// "Auto" (clears override → follows the CRM theme), plus one button per
// entry in MAP_STYLES (Dark / Light / Colour / OSM).
//
// `override` is the raw stored value ('' | 'dark' | 'light' | ...).
// `effective` is what's currently driving the tiles (always one of the
// MAP_STYLES keys). When override is empty, the Auto button is highlighted
// and a small subtitle shows which style is being used as the auto-derived
// default — e.g. "(Light)" — so the user knows what they're getting.
function MapStylePicker({ override, effective, onPick }) {
  const isAutoActive = !override
  return (
    <div style={{
      position: 'absolute',
      top: 10,
      right: 10,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '4px',
      display: 'flex',
      gap: 2,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      zIndex: 1000,
    }}>
      <PickerButton
        label="Auto"
        sublabel={isAutoActive ? `(${MAP_STYLES[effective]?.label || ''})` : null}
        active={isAutoActive}
        onClick={() => onPick('')}
      />
      {Object.entries(MAP_STYLES).map(([key, style]) => (
        <PickerButton
          key={key}
          label={style.label}
          active={override === key}
          onClick={() => onPick(key)}
        />
      ))}
    </div>
  )
}

function PickerButton({ label, sublabel, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'white' : 'var(--text2)',
        border: 'none',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {label}
      {sublabel && (
        <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>{sublabel}</span>
      )}
    </button>
  )
}

// ─── StatusFilterPill ────────────────────────────────────────────────────
//
// Compact pill replacing the old filter-tabs strip. One per status (plus
// "All"). The active pill gets a tinted background using the status colour
// at low opacity; inactive pills are muted gray with the colour as a 7px
// dot prefix. Counts are rendered inline so the eye doesn't have to jump
// between a label and a separate badge.
function StatusFilterPill({ label, count, active, accentColor, onClick }) {
  // Hex+alpha for the tinted active background. accentColor here is one of
  // the STATUS_COLORS hex values so we append an alpha byte directly.
  const activeBg = active ? `${accentColor}26` : 'var(--surface2)'   // 26 = ~15% alpha
  const activeColor = active ? accentColor : 'var(--text2)'
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: activeBg,
        color: activeColor,
        border: `0.5px solid ${active ? accentColor + '4D' : 'var(--border)'}`,
        borderRadius: 99,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
      {label}
      <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 400 }}>{count}</span>
    </button>
  )
}

// ─── RegionalSpreadBar ────────────────────────────────────────────────
//
// Proportional bar showing how the active+tender portfolio is distributed
// across UK regions. Each segment's width is the region's share of total
// projects. Segments are colour-coded from a fixed 6-colour palette;
// regions beyond the first 6 (sorted by count desc) are bucketed into
// "Other" gray. A small legend below names each region with its count.
//
// Empty state isn't rendered here — the parent only mounts this component
// when regionalSpread.length > 0.
const REGION_PALETTE = [
  '#5DCAA5',  // teal
  '#85B7EB',  // blue
  '#FAC775',  // amber
  '#F4C0D1',  // pink
  '#AFA9EC',  // purple
  '#F5C4B3',  // coral
]
const OTHER_COLOR = '#888780'   // gray (matches c-gray 400)

function RegionalSpreadBar({ spread }) {
  const total = spread.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return null

  // Pull the first 6 regions, lump anything else into 'Other' for both bar
  // segments and legend.
  const top = spread.slice(0, 6).map((s, idx) => ({
    region: s.region,
    count: s.count,
    color: REGION_PALETTE[idx],
  }))
  const overflow = spread.slice(6)
  const overflowCount = overflow.reduce((sum, s) => sum + s.count, 0)
  const segments = overflowCount > 0
    ? [...top, { region: 'Other', count: overflowCount, color: OTHER_COLOR }]
    : top

  return (
    <>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
        {segments.map(seg => (
          <div key={seg.region}
            title={`${seg.region} · ${seg.count} ${seg.count === 1 ? 'project' : 'projects'}`}
            style={{
              flex: seg.count,
              background: seg.color,
              minWidth: 4,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        {segments.map(seg => (
          <span key={seg.region} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: 'var(--text2)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
            {seg.region} <span style={{ color: 'var(--text3)' }}>{seg.count}</span>
          </span>
        ))}
      </div>
    </>
  )
}
