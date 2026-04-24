import { differenceInDays, format, parseISO } from 'date-fns'

export const TRADES = [
  'Architects','Asbestos Surveys','Borehole Investigations','Brickwork','Building Control','Carpentry','Civil Engineers',
  'Consultant','Core Drilling & Sawing','Demolition','Drainage','Ecologist','Electrical',
  'Fire Consultants','Fire Engineer','Fire Protection','Flood Risk Consultants','Flooring','Glazing','Ground Investigation','Groundworks',
  'HVAC','Insulation','Landscaping','Lift Installation','Lighting Consultants','Mastic Man','MEP Consultants',
  'Noise Consultants','Nurse Call System','Painting & Decorating','Piling','Planning Consultants','Plastering','Plumbing','Precast Concrete B&B','Principle Designers',
  'Roofing','Roofing & Cladding','Roofing Trusses','Scaffolding',
  'Setting Out Engineer','SFS Engineers','Sprinkler System','Steel Erection',
  'Structural Engineers','Wardrobes','Warranty Providers','Other'
]

// Trades that default to Design Team when assigning to a project
export const DESIGN_TEAM_TRADES = [
  'Architects', 'Building Control', 'Civil Engineers', 'Consultant',
  'Fire Consultants', 'MEP Consultants', 'Principle Designers', 'Setting Out Engineer',
  'SFS Engineers', 'Structural Engineers', 'Warranty Providers',
]

// Trades that default to "Both" (can sit in Subcontractor OR Design Team tab)
export const BOTH_TRADES = [
  'Asbestos Surveys', 'Borehole Investigations', 'Ecologist', 'Fire Engineer', 'Flood Risk Consultants', 'Ground Investigation',
  'Lighting Consultants', 'Noise Consultants', 'Nurse Call System', 'Planning Consultants',
]

export const SUBCONTRACTOR_CATEGORIES = {
  design_team: { label: 'Design Team', color: 'var(--blue, #0c447c)', bg: 'var(--blue-bg, #e6f1fb)' },
  contractual_work: { label: 'Contractual Work', color: 'var(--amber, #ba7517)', bg: 'var(--amber-bg, #faeeda)' },
}

export const DOCUMENT_TYPES = {
  public_liability: 'Public Liability Insurance',
  employers_liability: "Employer's Liability Insurance",
  professional_indemnity: 'Professional Indemnity Insurance',
  rams: 'RAMS (Risk Assessment & Method Statement)',
  method_statement: 'Method Statement',
  risk_assessment: 'Risk Assessment',
  cscs_card: 'CSCS Card',
  gas_safe: 'Gas Safe Certificate',
  niceic: 'NICEIC Certificate',
  chas: 'CHAS Accreditation',
  constructionline: 'Constructionline',
  iso_9001: 'ISO 9001 Quality',
  iso_14001: 'ISO 14001 Environmental',
  iso_45001: 'ISO 45001 Health & Safety',
  f10_notification: 'F10 CDM Notification',
  trade_certificate: 'Trade Certificate',
  other: 'Other Document',
}

export const PROJECT_STATUSES = {
  tender: { label: 'Tender', cls: 'pill-purple' },
  active: { label: 'Active', cls: 'pill-green' },
  on_hold: { label: 'On Hold', cls: 'pill-amber' },
  completed: { label: 'Completed', cls: 'pill-blue' },
  cancelled: { label: 'Cancelled', cls: 'pill-gray' },
}

export const SUB_STATUSES = {
  active: { label: 'Active', cls: 'pill-green' },
  approved: { label: 'Approved', cls: 'pill-blue' },
  on_hold: { label: 'On Hold', cls: 'pill-amber' },
  inactive: { label: 'Inactive', cls: 'pill-gray' },
}

export const ROLES = {
  admin:                { label: 'Admin',               cls: 'pill-red',    desc: 'Full access including user management' },
  project_manager:      { label: 'Project Manager',     cls: 'pill-blue',   desc: 'Manage projects, subcontractors & documents' },
  operations_manager:   { label: 'Operations Manager',  cls: 'pill-blue',   desc: 'Manage projects, subcontractors & documents' },
  director_viewer:      { label: 'Director Viewer',     cls: 'pill-blue',   desc: 'View everything including financials — read-only, no editing' },
  accountant:           { label: 'Accountant',          cls: 'pill-purple', desc: 'Manage suppliers, add/edit subcontractor VAT & CIS, view financials' },
  site_manager:         { label: 'Site Manager',        cls: 'pill-amber',  desc: 'Access assigned projects & compliance docs only' },
  document_controller:  { label: 'Document Controller', cls: 'pill-green',  desc: 'Add & edit compliance documents' },
  viewer:               { label: 'Viewer',              cls: 'pill-gray',   desc: 'Read-only access to all areas' },
}

export const ROLE_PERMISSIONS = {
  admin:               { nav: ['dashboard','subcontractors','documents','projects','tracker','tasks','clients','suppliers','company','gdrive','settings'], financials: true, performance: true },
  project_manager:     { nav: ['dashboard','subcontractors','documents','projects','tracker','tasks','clients','suppliers','company','gdrive','settings'], financials: true, performance: true },
  operations_manager:  { nav: ['dashboard','subcontractors','documents','projects','tracker','tasks','clients','suppliers','company','gdrive','settings'], financials: true, performance: true },
  director_viewer:     { nav: ['dashboard','subcontractors','documents','projects','tracker','tasks','clients','suppliers','company','gdrive','settings'], financials: true, performance: true },
  accountant:          { nav: ['dashboard','subcontractors','documents','projects','tracker','tasks','clients','suppliers','company','gdrive','settings'], financials: true, performance: true },
  site_manager:        { nav: ['dashboard','subcontractors','projects','tasks','suppliers','company','settings'], financials: false, performance: true },
  document_controller: { nav: ['dashboard','subcontractors','documents','projects','tasks','clients','company'], financials: false, performance: false },
  viewer:              { nav: ['dashboard','subcontractors','documents','projects','tracker','tasks','clients','company'], financials: false, performance: false },
}

export const NOTE_TYPES = {
  note:     { label: 'Note',      icon: '📝', color: 'var(--text2)' },
  call:     { label: 'Call',      icon: '📞', color: 'var(--blue)' },
  email:    { label: 'Email',     icon: '✉️',  color: 'var(--purple)' },
  visit:    { label: 'Site Visit',icon: '🏗️',  color: 'var(--green)' },
  issue:    { label: 'Issue',     icon: '⚠️',  color: 'var(--red)' },
  document: { label: 'Document',  icon: '📄', color: 'var(--amber)' },
}

export function docStatus(expiryDate) {
  if (!expiryDate) return 'no_expiry'
  const days = differenceInDays(parseISO(expiryDate), new Date())
  if (days < 0) return 'expired'
  if (days <= 30) return 'expiring_soon'
  return 'valid'
}

export function docStatusInfo(expiryDate) {
  const status = docStatus(expiryDate)
  const map = {
    expired:      { label: 'Expired',       cls: 'pill-red',   dotCls: 'dot-red'   },
    expiring_soon:{ label: 'Expiring Soon', cls: 'pill-amber', dotCls: 'dot-amber' },
    valid:        { label: 'Valid',          cls: 'pill-green', dotCls: 'dot-green' },
    no_expiry:    { label: 'No Expiry',      cls: 'pill-gray',  dotCls: 'dot-gray'  },
  }
  return map[status]
}

export function daysUntilExpiry(expiryDate) {
  if (!expiryDate) return null
  return differenceInDays(parseISO(expiryDate), new Date())
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return format(parseISO(dateStr), 'd MMM yyyy') } catch (e) { return dateStr }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  try { return format(parseISO(dateStr), 'd MMM yyyy, HH:mm') } catch (e) { return dateStr }
}

export function formatCurrency(val) {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(val)
}

export function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  { bg: '#EEEDFE', color: '#3C3489' }, { bg: '#E1F5EE', color: '#085041' },
  { bg: '#FAECE7', color: '#712B13' }, { bg: '#E6F1FB', color: '#0C447C' },
  { bg: '#FAEEDA', color: '#633806' }, { bg: '#EAF3DE', color: '#27500A' },
  { bg: '#FBEAF0', color: '#72243E' }, { bg: '#F1EFE8', color: '#444441' },
]

export function avatarColor(str) {
  if (!str) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function subDocSummary(documents) {
  let expired = 0, expiring = 0, valid = 0
  documents?.forEach(d => {
    const s = docStatus(d.expiry_date)
    if (s === 'expired') expired++
    else if (s === 'expiring_soon') expiring++
    else valid++
  })
  return { expired, expiring, valid, total: (documents?.length || 0) }
}

export function complianceScore(documents) {
  if (!documents || documents.length === 0) return null
  const { expired, expiring, valid, total } = subDocSummary(documents)
  const score = Math.round((valid / total) * 100)
  return { score, expired, expiring, valid, total }
}

export function exportToCSV(data, filename) {
  if (!data || data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = data.map(row => headers.map(h => {
    const val = row[h]
    if (val === null || val === undefined) return ''
    const str = String(val)
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"` : str
  }).join(','))
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Case-insensitive alphabetical sort for any array of objects.
// Usage: sortBy(subs, 'company_name') or sortBy(clients, 'name')
// Nulls/undefineds sink to the bottom.
export function sortBy(arr, key) {
  if (!Array.isArray(arr)) return []
  return [...arr].sort((a, b) => {
    const va = a?.[key]; const vb = b?.[key]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true })
  })
}
