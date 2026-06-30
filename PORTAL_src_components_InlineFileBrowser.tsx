'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { TenantContext } from '@/lib/tenant'
import { resolveBuildings, findBuildingByOrdinal } from '@/lib/buildings'
import PdfThumbnail from './PdfThumbnail'
import FileLightbox, { canPreviewFile } from './FileLightbox'
import PhotosTab from './tabs/PhotosTab'
import ProgrammeTab from './tabs/ProgrammeTab'

// ─────────────────────────────────────────────────────────────────────────────
// InlineFileBrowser.tsx
//
// Replaces the per-tile-navigates-to-a-page UX with inline expansion. All 8
// tiles toggle open/closed in place:
//
//   • 6 doc tiles (PA, Variations, CSA, CFF, Building Control, Reports) →
//     render a thumbnail grid of files in the matching project_doc_files
//     folder. PDFs get true page-1 thumbnails; other types get a generic
//     icon. Each file has View (modal lightbox) and Download actions.
//
//   • Photos tile → embeds <PhotosTab> inside the expansion panel (full
//     folder gallery + lightbox).
//
//   • Programme tile → embeds <ProgrammeTab> inside the expansion panel
//     (Gantt chart + task list).
//
// Data fetching: only the expanded tile's content loads. Collapsing and
// re-expanding a tile triggers a re-fetch (acceptable for a freshness-vs-
// caching tradeoff that keeps the user on the latest CRM state).
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_BUCKET = 'project-docs'

interface DocFile {
  id: string
  file_name: string
  file_size: number | null
  storage_path: string
  created_at: string
}

interface DocumentCounts {
  project_order: number
  payment_apps: number
  variations: number
  csa: number
  cff: number
  building_control: number
  programme: number
  photos: number
  reports: number
  meetings: number
  latest_pa_date: string | null
  latest_report_date: string | null
}

type TileType = 'docs' | 'photos' | 'programme'

interface TileSpec {
  key: string
  label: string
  letter: string
  // Tabler icon name (without the 'ti ti-' prefix) shown in the folder-row
  // icon chip. The CRM-style accordion uses icons, not letter badges.
  icon: string
  bg: string
  fg: string
  type: TileType
  // Only for docs tiles
  folderKey?: string
  subfolderKey?: string | null
  emptyMessage?: string
  // Scope mode for multi-building projects (Issues 1+2a+3 fix). Determines
  // whether the expanded panel filters its rendered tree to the currently-
  // scoped building. Tiles default to 'project_wide' when not specified —
  // only the per-building tiles (PA, CSA, CFF, Progress Reports) opt in to
  // 'per_building'. Drawings would also be 'per_building' if it had its own
  // tile, but it doesn't currently surface as a tile.
  scopeMode?: 'per_building' | 'project_wide'
}

interface ProjectShape {
  id: string
  project_name: string
}

interface Props {
  project: ProjectShape
  tenant: TenantContext
  brand: string
  docCounts: DocumentCounts | null
  fmtMoney: (n: number | null | undefined) => string
  fmtDate: (d: string | null) => string
  variationsTotal?: number
  variationsCount?: number
  // Per-building scope (Stage 3 of Chunk 2c-programme). Forwarded to
  // ProgrammeTab so the embedded Gantt uses the right per-building data.
  buildingOrdinal?: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// TileIcon — inline SVG icons for the folder-row chips. The portal has no
// icon-font dependency (everything is inline SVG), so these are hand-defined
// 24×24 stroke icons keyed by the TileSpec.icon semantic name.
// ─────────────────────────────────────────────────────────────────────────────
function TileIcon({ name, size = 17 }: { name: string; size?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'order':
      return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
    case 'payment':
      return <svg {...common}><path d="M5 3h14a2 2 0 0 1 2 2v16l-4-2-3 2-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
    case 'variation':
      return <svg {...common}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
    case 'csa':
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>
    case 'cff':
      return <svg {...common}><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>
    case 'survey':
      return <svg {...common}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
    case 'meeting':
      return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>
    case 'programme':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
    case 'photo':
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
    case 'report':
      return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 17v-4"/><path d="M12 17v-2"/><path d="M15 17v-6"/></svg>
    default:
      return <svg {...common}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
  }
}

export default function InlineFileBrowser({
  project,
  tenant,
  brand,
  docCounts,
  fmtDate,
  variationsTotal = 0,
  variationsCount = 0,
  fmtMoney,
  buildingOrdinal = null,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)
  // Whole "Project documents" section collapse state. Starts COLLAPSED per
  // the locked design — the client expands it when they want documents.
  const [sectionOpen, setSectionOpen] = useState(false)
  // Per-folder file view mode. Keyed by tile.key. Defaults to 'grid' (the
  // existing thumbnail-card view) for any folder not yet toggled.
  const [viewModes, setViewModes] = useState<Record<string, 'grid' | 'list'>>({})

  const tiles: TileSpec[] = [
    {
      key: 'project_order',
      label: 'Project Order',
      letter: 'PO',
      icon: 'order',
      // Blue palette to match the CRM's 01-project-order folder colour (#378ADD).
      bg: 'rgba(55, 138, 221, 0.18)',
      fg: '#85B7EB',
      type: 'docs',
      folderKey: '01-project-order',
      subfolderKey: null,
      emptyMessage: 'No project orders yet',
    },
    {
      key: 'pa',
      label: 'Payment Applications',
      letter: 'PA',
      icon: 'payment',
      bg: 'rgba(186, 117, 23, 0.18)',
      fg: '#EF9F27',
      type: 'docs',
      folderKey: '02-payment-application',
      subfolderKey: null,
      emptyMessage: 'No payment applications yet',
      scopeMode: 'per_building',
    },
    {
      key: 'payment_notice',
      label: 'Payment Notice',
      letter: 'PN',
      icon: 'payment',
      // Amber to match the CRM's 03-payment-notice folder colour (#BA7517),
      // a slightly deeper foreground than PA so the two read as distinct.
      bg: 'rgba(186, 117, 23, 0.18)',
      fg: '#D8902E',
      type: 'docs',
      folderKey: '03-payment-notice',
      subfolderKey: null,
      emptyMessage: 'No payment notices yet',
    },
    {
      key: 'variations',
      label: 'Variations',
      letter: 'V',
      icon: 'variation',
      bg: 'rgba(216, 90, 48, 0.18)',
      fg: '#F0997B',
      type: 'docs',
      folderKey: '04-variations',
      subfolderKey: null,
      emptyMessage: 'No variations issued yet',
    },
    {
      key: 'csa',
      label: 'CSA',
      letter: 'C',
      icon: 'csa',
      bg: 'rgba(55, 138, 221, 0.18)',
      fg: '#85B7EB',
      type: 'docs',
      folderKey: '00-project-information',
      subfolderKey: 'csa',
      emptyMessage: 'No CSA documents yet',
      scopeMode: 'per_building',
    },
    {
      key: 'cff',
      label: 'Cashflow Forecast',
      letter: '£',
      icon: 'cff',
      bg: 'rgba(29, 158, 117, 0.18)',
      fg: '#5DCAA5',
      type: 'docs',
      folderKey: '00-project-information',
      subfolderKey: 'cff',
      emptyMessage: 'No cashflow forecasts yet',
      scopeMode: 'per_building',
    },
    {
      key: 'building_control',
      label: 'Surveys & Reports',
      letter: 'S',
      icon: 'survey',
      bg: 'rgba(212, 83, 126, 0.18)',
      fg: '#ED93B1',
      type: 'docs',
      folderKey: '00-project-information',
      subfolderKey: 'reports',
      emptyMessage: 'No surveys or reports yet',
    },
    {
      key: 'meetings',
      label: 'Meeting Minutes',
      letter: 'M',
      icon: 'meeting',
      // Indigo palette — distinct from the other 00-project-information
      // subfolder tiles (CSA blue, CFF green, Surveys pink).
      bg: 'rgba(99, 102, 221, 0.18)',
      fg: '#9B9DE6',
      type: 'docs',
      folderKey: '00-project-information',
      subfolderKey: 'meetings',
      emptyMessage: 'No meeting minutes yet',
    },
    {
      key: 'programme',
      label: 'Programme',
      letter: 'G',
      icon: 'programme',
      bg: 'rgba(127, 119, 221, 0.18)',
      fg: '#AFA9EC',
      type: 'programme',
    },
    {
      key: 'photos',
      label: 'Photos',
      letter: 'PH',
      icon: 'photo',
      bg: 'rgba(212, 83, 126, 0.18)',
      fg: '#ED93B1',
      type: 'photos',
    },
    {
      key: 'reports',
      label: 'Progress Reports',
      letter: 'PR',
      icon: 'report',
      bg: 'rgba(99, 153, 34, 0.18)',
      fg: '#C0DD97',
      type: 'docs',
      folderKey: '05-progress-report',
      subfolderKey: null,
      emptyMessage: 'No reports published yet',
      scopeMode: 'per_building',
    },
  ]

  function summaryFor(t: TileSpec): string {
    if (!docCounts) return 'Loading…'
    switch (t.key) {
      case 'project_order': {
        const c = docCounts.project_order
        return c === 0 ? 'No documents yet' : `${c} document${c === 1 ? '' : 's'}`
      }
      case 'pa': {
        const c = docCounts.payment_apps
        if (c === 0) return 'No documents yet'
        return `${c} document${c === 1 ? '' : 's'}${docCounts.latest_pa_date ? ' · latest ' + fmtDate(docCounts.latest_pa_date) : ''}`
      }
      case 'variations': {
        // Only show a count when real VOs exist (= rows in PAs with non-zero
        // cost_impact). The previous fallback to docCounts.variations counted
        // FILES in the 04-variations folder, which inflated the badge for
        // projects that had docs uploaded there but no actual VOs issued
        // (e.g. Merton showing "3 documents" when no VOs were on any PA).
        if (variationsCount > 0) return `${variationsCount} VO${variationsCount === 1 ? '' : 's'} · ${fmtMoney(variationsTotal)}`
        return 'No variations'
      }
      case 'csa': {
        const c = docCounts.csa
        return c === 0 ? 'No documents yet' : `${c} document${c === 1 ? '' : 's'}`
      }
      case 'cff': {
        const c = docCounts.cff
        return c === 0 ? 'No documents yet' : `${c} document${c === 1 ? '' : 's'}`
      }
      case 'building_control': {
        const c = docCounts.building_control
        return c === 0 ? 'No surveys yet' : `${c} document${c === 1 ? '' : 's'}`
      }
      case 'meetings': {
        const c = docCounts.meetings
        return c === 0 ? 'No meeting minutes yet' : `${c} document${c === 1 ? '' : 's'}`
      }
      case 'programme': {
        return 'View Gantt chart'
      }
      case 'photos': {
        const c = docCounts.photos
        return c === 0 ? 'No photos yet' : `${c} photo${c === 1 ? '' : 's'}`
      }
      case 'reports': {
        const c = docCounts.reports
        if (c === 0) return 'No reports yet'
        return `${c} report${c === 1 ? '' : 's'}${docCounts.latest_report_date ? ' · latest ' + fmtDate(docCounts.latest_report_date) : ''}`
      }
    }
    return ''
  }

  return (
    <div>
      {/* ── Collapsible "Project documents" section ──────────────────────
          The whole documents block sits behind one collapsible header,
          mirroring the Cashflow Forecast card pattern. Starts collapsed. */}
      <button
        onClick={() => setSectionOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left rounded-lg px-3 py-2.5 transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          cursor: 'pointer',
        }}
        aria-expanded={sectionOpen}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          Project documents
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full"
          style={{ color: 'var(--text-faint)', background: 'var(--bg-card-inset)' }}>
          {tiles.length} sections
        </span>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2"
          style={{
            color: 'var(--text-faint)', marginLeft: 'auto', flexShrink: 0,
            transform: sectionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s ease',
          }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Folder accordion. Each tile is a full-width row; the expanded row's
          panel renders inline directly below that row (not below the whole
          list, the way the old tile grid did). */}
      {sectionOpen && (
        <div className="flex flex-col gap-1.5 mt-1.5">
          {tiles.map(t => {
            const isOpen = expandedKey === t.key
            // Programme & Photos navigate to their own embedded views — they
            // get a right-chevron (not a down-chevron) and no view toggle.
            const isNavTile = t.type === 'programme' || t.type === 'photos'
            const viewMode = viewModes[t.key] || 'grid'
            return (
              <div key={t.key}
                className="rounded-lg overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  border: `0.5px solid ${isOpen ? 'var(--border-strong, var(--border))' : 'var(--border)'}`,
                }}>
                {/* Folder row header */}
                <div
                  onClick={() => setExpandedKey(isOpen ? null : t.key)}
                  className="flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
                  style={{
                    cursor: 'pointer',
                    background: isOpen ? 'var(--bg-card-inset)' : 'transparent',
                  }}
                  role="button"
                  aria-expanded={isOpen}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: 7, background: t.bg, color: t.fg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <TileIcon name={t.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>{t.label}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{summaryFor(t)}</div>
                  </div>

                  {/* Per-folder grid/list view toggle — only on docs tiles,
                      only while the folder is expanded. */}
                  {isOpen && t.type === 'docs' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex rounded-md overflow-hidden"
                      style={{ border: '0.5px solid var(--border)', flexShrink: 0 }}
                    >
                      <button
                        onClick={() => setViewModes(prev => ({ ...prev, [t.key]: 'grid' }))}
                        aria-label="Grid view"
                        style={{
                          padding: '4px 7px', display: 'flex', alignItems: 'center', cursor: 'pointer',
                          background: viewMode === 'grid' ? 'var(--bg-card)' : 'transparent',
                          color: viewMode === 'grid' ? 'var(--text)' : 'var(--text-faint)',
                          border: 'none',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => setViewModes(prev => ({ ...prev, [t.key]: 'list' }))}
                        aria-label="List view"
                        style={{
                          padding: '4px 7px', display: 'flex', alignItems: 'center', cursor: 'pointer',
                          background: viewMode === 'list' ? 'var(--bg-card)' : 'transparent',
                          color: viewMode === 'list' ? 'var(--text)' : 'var(--text-faint)',
                          borderLeft: '0.5px solid var(--border)',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  )}

                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      color: 'var(--text-faint)', flexShrink: 0,
                      transform: isNavTile
                        ? 'rotate(0deg)'
                        : (isOpen ? 'rotate(180deg)' : 'rotate(0deg)'),
                      transition: 'transform 0.18s ease',
                    }}>
                    {isNavTile
                      ? <polyline points="9 18 15 12 9 6"/>
                      : <polyline points="6 9 12 15 18 9"/>}
                  </svg>
                </div>

                {/* Inline expansion panel — renders directly under this row */}
                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-1"
                    style={{ borderTop: '0.5px solid var(--border)' }}>
                    {t.type === 'docs' && (
                      <DocsExpansionPanel
                        projectId={project.id}
                        tile={t}
                        brand={brand}
                        fmtDate={fmtDate}
                        viewMode={viewMode}
                        onPreview={(url, name) => setLightbox({ url, name })}
                        buildingOrdinal={buildingOrdinal}
                      />
                    )}
                    {t.type === 'photos' && (
                      <div className="-mx-1">
                        <PhotosTab project={project} tenant={tenant} />
                      </div>
                    )}
                    {t.type === 'programme' && (
                      <div className="-mx-1">
                        <ProgrammeTab project={project} tenant={tenant} buildingOrdinal={buildingOrdinal} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <FileLightbox
        signedUrl={lightbox?.url || null}
        fileName={lightbox?.name || ''}
        onClose={() => setLightbox(null)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DocsExpansionPanel — fetches files AND custom child folders for a single
// doc tile, then renders the whole subtree recursively.
//
// The data model:
//   • project_doc_folders: custom child folders. Each has a folder_key (its
//     own id), parent_key (the subfolder_key this folder lives inside),
//     and label (display name).
//   • project_doc_files: each file references folder_key (top-level template
//     folder, e.g. '00-project-information') AND subfolder_key (which can be
//     a template subfolder name like 'reports', a custom folder's folder_key,
//     or null for root files).
//
// We start from the tile's (folderKey, subfolderKey) pair as the root, then
// descend by following parent_key chains. Files at each level are grouped
// under that node.
// ─────────────────────────────────────────────────────────────────────────────

interface CustomFolder {
  folder_key: string  // this folder's id (referenced by children's parent_key)
  parent_key: string | null
  label: string
}

interface FolderTreeNode {
  // Identifies this node — undefined for the root, otherwise the custom
  // folder's folder_key.
  key: string | null
  // Display label (only for child nodes).
  label: string | null
  // Files that live directly inside this folder.
  files: DocFile[]
  // Direct children, recursive.
  children: FolderTreeNode[]
}

function DocsExpansionPanel({
  projectId,
  tile,
  brand,
  fmtDate,
  viewMode,
  onPreview,
  buildingOrdinal,
}: {
  projectId: string
  tile: TileSpec
  brand: string
  fmtDate: (d: string | null) => string
  // 'grid' = thumbnail cards (unchanged portal view); 'list' = compact rows.
  viewMode: 'grid' | 'list'
  onPreview: (signedUrl: string, fileName: string) => void
  // Scope filter for multi-building projects (Issues 1+2a+3 fix). When
  // non-null AND the tile is scopeMode='per_building', the panel filters
  // the rendered tree to only show the scoped building's specific
  // subfolder. Project-wide tiles ignore this prop entirely.
  buildingOrdinal?: number | null
}) {
  const [tree, setTree] = useState<FolderTreeNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  // Subfolders start collapsed so the panel doesn't dump every file at
  // once. The user clicks each subfolder header to reveal its files.
  // Keyed by folder_key (custom folder ID).
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const supabase = createClient()

      // Fetch all files in the top-level template folder, plus all custom
      // child folders for the project, plus the visibility rows for any
      // template subfolders that might be hidden.
      //
      // Visibility surfaces (in priority order — parent overrides child):
      //   1. Template subfolder hidden → whole subtree hidden
      //      (project_template_folder_visibility row, client_visible=false)
      //   2. Custom subfolder hidden → that folder + descendants hidden
      //      (project_doc_folders.client_visible=false)
      //   3. File hidden → just that file hidden
      //      (project_doc_files.client_visible=false)
      //
      // Top-level folder visibility is already enforced server-side via
      // RLS, so we don't need to re-check it here.
      const [filesRes, foldersRes, templateVisRes] = await Promise.all([
        supabase
          .from('project_doc_files')
          .select('id, file_name, file_size, storage_path, created_at, subfolder_key, client_visible')
          .eq('project_id', projectId)
          .eq('folder_key', tile.folderKey!)
          .order('created_at', { ascending: false }),
        supabase
          .from('project_doc_folders')
          .select('folder_key, parent_key, label, client_visible')
          .eq('project_id', projectId)
          .order('created_at'),
        supabase
          .from('project_template_folder_visibility')
          .select('folder_key, subfolder_key, client_visible')
          .eq('project_id', projectId)
          .eq('folder_key', tile.folderKey!),
      ])
      if (cancelled) return

      const allFiles = ((filesRes.data || []) as (DocFile & { subfolder_key: string | null; client_visible: boolean | null })[])
      const allFolders = (foldersRes.data || []) as (CustomFolder & { client_visible: boolean | null })[]
      const templateVisRows = (templateVisRes.data || []) as Array<{ folder_key: string; subfolder_key: string; client_visible: boolean }>

      // Build a set of HIDDEN keys at any level. Used by the recursive
      // filter below — a folder/file is shown only if no key in its
      // ancestor chain is in this set.
      const hiddenFolderKeys = new Set<string>()
      // Custom subfolders with client_visible=false
      for (const f of allFolders) {
        if (f.client_visible === false) hiddenFolderKeys.add(f.folder_key)
      }
      // Template subfolders with explicit hide row (note: empty string
      // subfolder_key represents the top-level row, not what we want here)
      for (const v of templateVisRows) {
        if (v.subfolder_key && v.subfolder_key !== '' && v.client_visible === false) {
          hiddenFolderKeys.add(v.subfolder_key)
        }
      }

      // Top-level folder hidden? Honour it client-side. Previously we relied
      // on RLS to filter files for hidden top-level folders, but the policy
      // wasn't actually present (or wasn't filtering by client_visible) —
      // so hidden tiles like Payment Applications were leaking files into
      // the portal. Bail out early here with an empty tree so the tile
      // shows "No <thing> yet" and the count drops to zero.
      const topLevelHiddenRow = templateVisRows.find(
        v => (v.subfolder_key === '' || v.subfolder_key == null)
          && v.folder_key === tile.folderKey
          && v.client_visible === false
      )
      if (topLevelHiddenRow) {
        setTree({ key: tile.subfolderKey ?? null, label: null, files: [], children: [] })
        setLoading(false)
        return
      }

      // Walk parent_key chain to determine if any ancestor is hidden.
      // Returns true when the input key OR any of its ancestors is in
      // hiddenFolderKeys. Memoised within this single load() call.
      const ancestorHiddenCache = new Map<string, boolean>()
      function isAncestorHidden(key: string | null): boolean {
        if (!key) return false
        if (ancestorHiddenCache.has(key)) return ancestorHiddenCache.get(key)!
        if (hiddenFolderKeys.has(key)) {
          ancestorHiddenCache.set(key, true)
          return true
        }
        const parent = allFolders.find(f => f.folder_key === key)?.parent_key ?? null
        const result = isAncestorHidden(parent)
        ancestorHiddenCache.set(key, result)
        return result
      }

      // Filter files: drop any whose own client_visible is false OR whose
      // containing folder (or any ancestor) is hidden.
      const visibleFiles = allFiles.filter(f => {
        if (f.client_visible === false) return false
        if (isAncestorHidden(f.subfolder_key)) return false
        return true
      })

      // Filter folders the same way.
      const visibleFolders = allFolders.filter(f => !isAncestorHidden(f.folder_key))

      // Build the root node first (files where subfolder_key matches the
      // tile's starting subfolderKey, or null for top-level tiles like PA).
      const rootKey = tile.subfolderKey ?? null
      // Tile-level template subfolder hidden → render empty tree
      if (rootKey && hiddenFolderKeys.has(rootKey)) {
        setTree({ key: rootKey, label: null, files: [], children: [] })
        setLoading(false)
        return
      }

      const rootFiles = visibleFiles
        .filter(f => (rootKey === null ? f.subfolder_key === null : f.subfolder_key === rootKey))
      const root: FolderTreeNode = {
        key: rootKey,
        label: null,
        files: rootFiles,
        children: [],
      }

      // Walk children of root, then their children, etc. The starting
      // parent_key is the tile's subfolderKey. For top-level tiles where
      // subfolderKey is null (PA, Progress Reports, Variations, Project
      // Order), custom subfolders nest directly under the top-level folder
      // — their parent_key matches tile.folderKey rather than any template
      // subfolder. This is how Merton-style multi-building projects work:
      // each building's PA folder is `02-payment-application-custom-...`
      // with parent_key='02-payment-application'.
      function attachChildren(node: FolderTreeNode) {
        // For root of a top-level tile (subfolderKey was null, so node.key
        // is null), match by tile.folderKey. For deeper nodes, match by
        // node.key as normal.
        const matchKey = node.key === null ? tile.folderKey : node.key
        // Sort by label (natural alphanumeric) so numbered folders read
        // 01, 02, 03 … rather than by created_at — folders are prefixed in
        // the CRM precisely to control this order. numeric:true keeps 2
        // before 10.
        const directChildren = visibleFolders
          .filter(fld => fld.parent_key === matchKey)
          .sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { numeric: true, sensitivity: 'base' }))
        for (const child of directChildren) {
          const childFiles = visibleFiles.filter(f => f.subfolder_key === child.folder_key)
          const childNode: FolderTreeNode = {
            key: child.folder_key,
            label: child.label,
            files: childFiles,
            children: [],
          }
          attachChildren(childNode)
          node.children.push(childNode)
        }
      }
      attachChildren(root)

      // Per-building scope filter (Issues 1+2a+3 fix). Only applies when:
      //   • The tile is scopeMode='per_building'
      //   • A buildingOrdinal is set (caller is viewing a specific building)
      // For these tiles we resolve the building's specific subfolder key
      // and prune the tree to only that subfolder's subtree.
      //
      // For project-wide tiles (Surveys & Reports, etc.) we leave the tree
      // intact — they're shared across all buildings.
      let scopedRoot: FolderTreeNode = root
      if (tile.scopeMode === 'per_building' && buildingOrdinal != null) {
        try {
          const buildings = await resolveBuildings(supabase, projectId)
          if (cancelled) return
          const building = findBuildingByOrdinal(buildings, buildingOrdinal)
          if (building) {
            // Map tile key → which subfolder field on the building.
            const targetKey: string | null =
              tile.key === 'pa' ? building.subfolders.pa
              : tile.key === 'csa' ? building.subfolders.csa
              : tile.key === 'cff' ? building.subfolders.cff
              : tile.key === 'reports' ? building.subfolders.progress_reports
              : null
            if (targetKey) {
              // Find that subfolder in the rendered tree (depth-first).
              function findNode(n: FolderTreeNode, key: string): FolderTreeNode | null {
                if (n.key === key) return n
                for (const c of n.children) {
                  const found = findNode(c, key)
                  if (found) return found
                }
                return null
              }
              const found = findNode(root, targetKey)
              // Replace the rendered tree with just the building's subtree.
              // If not found (unusual — building anchor exists but its
              // subfolder went missing), render an empty tree rather than
              // showing the project-wide one as a misleading fallback.
              scopedRoot = found || { key: targetKey, label: null, files: [], children: [] }
            } else {
              // The building's anchored subfolder for this tile isn't set.
              // (E.g. a building has a PA folder but no CSA folder.) Show
              // empty rather than fall back to the full project tree.
              scopedRoot = { key: tile.subfolderKey ?? null, label: null, files: [], children: [] }
            }
          }
          // If buildings resolution returned nothing, building doesn't exist
          // for this ordinal — fall through to use the unscoped root. This
          // shouldn't happen in normal usage but is a safe default.
        } catch (err) {
          console.warn('[DocsExpansionPanel] scope resolution failed:', err)
          // Fall through with the unscoped root.
        }
      }

      setTree(scopedRoot)
      setLoading(false)

      // Generate signed URLs for ALL files in the scoped tree (root + nested).
      // Walk the tree to gather every file, then fetch URLs in parallel.
      const flat: DocFile[] = []
      function collect(n: FolderTreeNode) {
        flat.push(...n.files)
        n.children.forEach(collect)
      }
      collect(scopedRoot)

      const pairs = await Promise.all(flat.map(async f => {
        const { data: signed } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(f.storage_path, 3600)
        return [f.id, signed?.signedUrl || ''] as const
      }))
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const [id, url] of pairs) if (url) map[id] = url
      setSignedUrls(map)
    }
    load()
    return () => { cancelled = true }
  }, [projectId, tile.folderKey, tile.subfolderKey, tile.key, tile.scopeMode, buildingOrdinal])

  async function downloadFile(f: DocFile) {
    setDownloadingId(f.id)
    try {
      const url = signedUrls[f.id]
      if (!url) {
        alert('Could not generate download link')
        return
      }
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = f.file_name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) {
      alert('Download failed: ' + (e as Error).message)
    }
    setDownloadingId(null)
  }

  if (loading) {
    return (
      <div className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
        Loading…
      </div>
    )
  }

  // Total file count across the whole subtree — drives the "empty state"
  // when there's neither a file nor a child folder anywhere.
  function countAllFiles(n: FolderTreeNode | null): number {
    if (!n) return 0
    return n.files.length + n.children.reduce((sum, c) => sum + countAllFiles(c), 0)
  }
  const totalFiles = countAllFiles(tree)

  if (totalFiles === 0) {
    return (
      <div className="text-center py-10">
        <div className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
          {tile.emptyMessage}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Files shared by your project team will appear here.
        </div>
      </div>
    )
  }

  return (
    <FolderTreeRenderer
      node={tree!}
      depth={0}
      brand={brand}
      fmtDate={fmtDate}
      viewMode={viewMode}
      signedUrls={signedUrls}
      downloadingId={downloadingId}
      onPreview={onPreview}
      onDownload={downloadFile}
      expandedFolders={expandedFolders}
      onToggleFolder={(key) => setExpandedFolders(prev => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive tree renderer. Renders the node's files in a grid, then any
// child folders as labelled sections with their own grids (and so on).
// ─────────────────────────────────────────────────────────────────────────────
function FolderTreeRenderer({
  node, depth, brand, fmtDate, viewMode, signedUrls, downloadingId, onPreview, onDownload,
  expandedFolders, onToggleFolder,
}: {
  node: FolderTreeNode
  depth: number
  brand: string
  fmtDate: (d: string | null) => string
  viewMode: 'grid' | 'list'
  signedUrls: Record<string, string>
  downloadingId: string | null
  onPreview: (signedUrl: string, fileName: string) => void
  onDownload: (f: DocFile) => void
  expandedFolders: Set<string>
  onToggleFolder: (key: string) => void
}) {
  // Subfolders (depth > 0) collapse by default. Compute the total file count
  // in this subtree so the collapsed header can show "X files" without the
  // user expanding to find out.
  function countAllFilesIn(n: FolderTreeNode): number {
    return n.files.length + n.children.reduce((sum, c) => sum + countAllFilesIn(c), 0)
  }
  const isExpanded = depth === 0 || (node.key !== null && expandedFolders.has(node.key))
  const totalFilesInSubtree = depth > 0 ? countAllFilesIn(node) : 0

  return (
    <div className={depth > 0 ? 'mt-3' : ''}>
      {/* Subfolder header — clickable on depth > 0. The folder icon, label,
          file count, and chevron all sit on a clickable row. Clicking
          toggles the folder open/closed. */}
      {depth > 0 && node.label && node.key !== null && (
        <button
          onClick={() => onToggleFolder(node.key!)}
          className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 transition-colors"
          style={{
            color: 'var(--text-muted)',
            background: isExpanded ? 'var(--bg-card-inset)' : 'transparent',
            border: '0.5px solid transparent',
            cursor: 'pointer',
          }}
          aria-expanded={isExpanded}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <div className="text-xs font-medium" style={{ color: 'var(--text)' }}>
            {node.label}
          </div>
          <div className="text-[10px]">
            {totalFilesInSubtree} file{totalFilesInSubtree === 1 ? '' : 's'}
          </div>
          <span style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--text-faint)',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform .18s ease',
            display: 'inline-block',
            lineHeight: 1,
          }}>▾</span>
        </button>
      )}

      {/* Body — files (grid or list) + recurse into children. Only renders
          when this node is expanded. */}
      {isExpanded && (
        <div style={{ paddingLeft: depth > 0 ? 8 : 0, paddingTop: depth > 0 ? 8 : 0 }}>
          {/* Files — grid view (thumbnail cards, unchanged) */}
          {node.files.length > 0 && viewMode === 'grid' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {node.files.map(f => {
                const ext = (f.file_name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)
                const isPdf = /\.pdf$/i.test(f.file_name)
                const isImage = /\.(png|jpg|jpeg|webp|gif|svg|bmp)$/i.test(f.file_name)
                const previewable = canPreviewFile(f.file_name)
                const url = signedUrls[f.id]
                return (
                  <div key={f.id}
                    className="rounded-lg overflow-hidden"
                    style={{ background: 'var(--bg-card-inset)', border: '0.5px solid var(--border)' }}>
                    <div style={{ position: 'relative' }}>
                      {isPdf && (
                        <PdfThumbnail signedUrl={url || null} fileName={f.file_name} />
                      )}
                      {isImage && (
                        <ImageThumbnail signedUrl={url || null} fileName={f.file_name} />
                      )}
                      {!isPdf && !isImage && (
                        <GenericFileTile ext={ext} brand={brand} />
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text)' }} title={f.file_name}>
                        {f.file_name}
                      </div>
                      <div className="text-[10px] mt-0.5 mb-2" style={{ color: 'var(--text-muted)' }}>
                        {fmtSize(f.file_size)} · {fmtDate(f.created_at)}
                      </div>
                      <div className="flex gap-1">
                        {previewable && (
                          <button
                            onClick={() => url && onPreview(url, f.file_name)}
                            disabled={!url}
                            className="flex-1 text-[10px] font-medium py-1 px-2 rounded"
                            style={{
                              background: brand, color: 'white',
                              border: `0.5px solid ${brand}`,
                              cursor: url ? 'pointer' : 'wait',
                              opacity: url ? 1 : 0.5,
                            }}
                          >
                            View
                          </button>
                        )}
                        <button
                          onClick={() => onDownload(f)}
                          disabled={downloadingId === f.id || !url}
                          className="flex-1 text-[10px] font-medium py-1 px-2 rounded"
                          style={{
                            background: 'transparent', color: 'var(--text)',
                            border: '0.5px solid var(--border)',
                            cursor: downloadingId === f.id ? 'wait' : 'pointer',
                            opacity: downloadingId === f.id || !url ? 0.5 : 1,
                          }}
                        >
                          {downloadingId === f.id ? '…' : 'Download'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Files — list view (compact rows, no thumbnail) */}
          {node.files.length > 0 && viewMode === 'list' && (
            <div className="flex flex-col gap-1.5">
              {node.files.map(f => {
                const isPdf = /\.pdf$/i.test(f.file_name)
                const isImage = /\.(png|jpg|jpeg|webp|gif|svg|bmp)$/i.test(f.file_name)
                const previewable = canPreviewFile(f.file_name)
                const url = signedUrls[f.id]
                return (
                  <div key={f.id}
                    className="flex items-center gap-3 rounded-md px-3 py-2"
                    style={{ background: 'var(--bg-card-inset)', border: '0.5px solid var(--border)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke={isPdf ? '#A32D2D' : isImage ? '#185FA5' : 'var(--text-muted)'}
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text)' }} title={f.file_name}>
                        {f.file_name}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {fmtSize(f.file_size)} · {fmtDate(f.created_at)}
                      </div>
                    </div>
                    {previewable && (
                      <button
                        onClick={() => url && onPreview(url, f.file_name)}
                        disabled={!url}
                        className="text-[10px] font-medium py-1 px-2.5 rounded"
                        style={{
                          background: brand, color: 'white',
                          border: `0.5px solid ${brand}`,
                          cursor: url ? 'pointer' : 'wait',
                          opacity: url ? 1 : 0.5,
                          flexShrink: 0,
                        }}
                      >
                        View
                      </button>
                    )}
                    <button
                      onClick={() => onDownload(f)}
                      disabled={downloadingId === f.id || !url}
                      className="text-[10px] font-medium py-1 px-2.5 rounded"
                      style={{
                        background: 'transparent', color: 'var(--text)',
                        border: '0.5px solid var(--border)',
                        cursor: downloadingId === f.id ? 'wait' : 'pointer',
                        opacity: downloadingId === f.id || !url ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {downloadingId === f.id ? '…' : 'Download'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recurse into child folders */}
          {node.children.map(child => (
            <FolderTreeRenderer
              key={child.key}
              node={child}
              depth={depth + 1}
              brand={brand}
              fmtDate={fmtDate}
              viewMode={viewMode}
              signedUrls={signedUrls}
              downloadingId={downloadingId}
              onPreview={onPreview}
              onDownload={onDownload}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Thumbnail tile for image files. Just renders the image directly via the
// signed URL — browser handles the actual decoding and display.
function ImageThumbnail({ signedUrl, fileName }: { signedUrl: string | null; fileName: string }) {
  return (
    <div style={{
      width: '100%',
      aspectRatio: '8.5 / 11',
      background: 'var(--bg-card-inset)',
      borderRadius: 6,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signedUrl}
          alt={fileName}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>
      )}
    </div>
  )
}

// Fallback tile for non-PDF non-image files (xlsx, docx, etc.)
function GenericFileTile({ ext, brand }: { ext: string; brand: string }) {
  return (
    <div style={{
      width: '100%',
      aspectRatio: '8.5 / 11',
      background: 'var(--bg-card-inset)',
      borderRadius: 6,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 6, padding: 12,
    }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={brand} strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
        color: brand,
      }}>
        {ext}
      </div>
    </div>
  )
}

function fmtSize(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}
