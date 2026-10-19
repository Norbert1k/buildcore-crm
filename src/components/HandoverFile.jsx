import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { resolveBuildings } from '../lib/buildings'
import OmBuilder from './OmBuilder'
import HSHandover, { HandoverUiCtx, setHandoverBuildings } from './HSHandover'
import { useHandoverReadiness, SectionChips, SectionPanel } from './HandoverReadiness'

// Project › Handover › H&S File & O&M — one place for the whole handover:
//   • top:    status, decisions, drop zone, O&M / tenant / Golden Thread (OmBuilder)
//   • below:  the 11 sections. Each row shows how many expected documents were
//             found (ticked automatically) and its sign-off; opening a row shows
//             the checklist, sign-off and the files. Empty folders stay hidden
//             until "Show all folders".
//
// Multi-building jobs (e.g. Merton — Residential, Sports Hall, Educational
// Block, taken from the job's numbered folders): a building bar on top. "All
// buildings" shows each building's progress; picking one gives that building
// its own O&M (settings, readiness, draft, issues). Needs 038_handover_buildings.sql;
// without it the job works as one handover, as before.
export default function HandoverFile({ projectId, project }) {
  const r = useHandoverReadiness(projectId)
  const [showEmpty, setShowEmpty] = useState(() => { try { return localStorage.getItem('hs:showEmpty') === '1' } catch { return false } })
  const toggleEmpty = () => setShowEmpty(v => { try { localStorage.setItem('hs:showEmpty', v ? '0' : '1') } catch {} ; return !v })
  const [buildings, setBuildings] = useState(null)     // null = loading, [] = single building
  const [has038, setHas038] = useState(false)           // per-building columns exist
  const scopeKey = `hs:building:${projectId}`
  const [scope, setScope] = useState(() => { try { return localStorage.getItem(scopeKey) || 'all' } catch { return 'all' } })

  useEffect(() => {
    let live = true
    ;(async () => {
      let list = [], cols = false
      try {
        // The per-building columns exist only once 038 has been run
        const { error } = await supabase.from('om_packs').select('building').limit(1)
        if (!error) {
          cols = true
          const bs = await resolveBuildings(supabase, projectId)
          list = (bs || []).map(b => ({ key: 'b' + b.ordinal, name: b.name || `Building ${b.ordinal}` }))
        }
      } catch { list = [] }
      if (!live) return
      setHas038(cols)
      setBuildings(list.length > 1 ? list : [])
    })()
    return () => { live = false }
  }, [projectId])

  const multi = (buildings || []).length > 1
  const current = multi ? buildings.find(b => b.key === scope) || null : null
  const pick = k => { setScope(k); try { localStorage.setItem(scopeKey, k) } catch { /* ignore */ } }
  useEffect(() => { setHandoverBuildings(multi ? buildings : [], current?.key || null); return () => setHandoverBuildings([], null) }, [multi, current?.key])

  const ui = {
    showEmpty, toggleEmpty,
    sectionChips: key => <SectionChips r={r} folderKey={key} />,
    sectionPanel: key => <SectionPanel r={r} folderKey={key} />,
  }
  if (buildings === null) return <div className="handover-file" />
  return (
    <div className="handover-file">
      {multi && (
        <div className="hb-bar" role="tablist" aria-label="Building">
          <span className="hb-l">Building</span>
          <button type="button" role="tab" aria-selected={!current} className={!current ? 'on' : ''} onClick={() => pick('all')}>All buildings</button>
          {buildings.map(b => <button key={b.key} type="button" role="tab" aria-selected={current?.key === b.key} className={current?.key === b.key ? 'on' : ''} onClick={() => pick(b.key)}>{b.name}</button>)}
        </div>
      )}
      <OmBuilder key={current?.key || 'all'} projectId={projectId} project={project} readiness={r.ready ? r.summary : null}
        multi={multi} has038={has038} buildings={multi ? buildings : []} building={current} onPickBuilding={pick} />
      <HandoverUiCtx.Provider value={ui}>
        <HSHandover projectId={projectId} projectName={project?.project_name} />
      </HandoverUiCtx.Provider>
    </div>
  )
}
