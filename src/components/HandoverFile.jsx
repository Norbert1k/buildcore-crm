import { useState } from 'react'
import OmBuilder from './OmBuilder'
import HSHandover, { HandoverUiCtx } from './HSHandover'
import { useHandoverReadiness, SectionChips, SectionPanel } from './HandoverReadiness'

// Project › Handover › H&S File & O&M — one place for the whole handover:
//   • top:    status, decisions, drop zone, O&M / tenant / Golden Thread (OmBuilder)
//   • below:  the 11 sections. Each row shows how many expected documents were
//             found (ticked automatically) and its sign-off; opening a row shows
//             the checklist, sign-off and the files. Empty folders stay hidden
//             until "Show all folders".
export default function HandoverFile({ projectId, project }) {
  const r = useHandoverReadiness(projectId)
  const [showEmpty, setShowEmpty] = useState(() => { try { return localStorage.getItem('hs:showEmpty') === '1' } catch { return false } })
  const toggleEmpty = () => setShowEmpty(v => { try { localStorage.setItem('hs:showEmpty', v ? '0' : '1') } catch {} ; return !v })
  const ui = {
    showEmpty, toggleEmpty,
    sectionChips: key => <SectionChips r={r} folderKey={key} />,
    sectionPanel: key => <SectionPanel r={r} folderKey={key} />,
  }
  return (
    <div className="handover-file">
      <OmBuilder projectId={projectId} project={project} readiness={r.ready ? r.summary : null} />
      <HandoverUiCtx.Provider value={ui}>
        <HSHandover projectId={projectId} projectName={project?.project_name} />
      </HandoverUiCtx.Provider>
    </div>
  )
}
