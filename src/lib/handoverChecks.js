// Auto-ticking for the handover checklist.
// Each expected item is ticked automatically when a matching document is on
// the job — matched on Claude's reading (type, title, system, issuer) and the
// file name, and on where it's filed. People can still tick an item by hand
// (e.g. "not applicable") and sign sections off; auto ticks are never stored,
// so removing the document un-ticks the item.

const T = (...types) => ({ types })
const K = re => ({ res: [re] })          // several K() in one rule must all match
const F = (...folders) => ({ folders })
const rule = (...parts) => parts.reduce((acc, p) => ({ ...acc, ...p, res: [...(acc.res || []), ...(p.res || [])] }), {})

// label (as in the default checklist) → how to find it
export const CHECK_RULES = {
  'Construction phase plan (as final)': rule(K(/construction phase plan|\bcpp\b/)),
  'Residual risks register': rule(K(/residual risk/)),
  'F10 notification copy': rule(K(/\bf10\b/)),
  'Asbestos survey / register': rule(K(/asbestos/)),
  'Pre-construction information (archived)': rule(K(/pre-?construction information|\bpci\b/)),
  'Contractor directory': rule(K(/contractor directory|subcontractor (list|directory)/), { fromJob: 'subs' }),
  'Consultant directory': rule(K(/consultant|design team directory/), { fromJob: 'designTeam' }),
  'Key contacts & emergency numbers': rule(K(/key contacts|emergency (numbers|contacts)/), { fromJob: 'omIssued' }),
  'As-built architectural drawings': rule(T('drawing'), F('s3-1')),
  'Structural as-builts': rule(T('drawing'), K(/struct|foundation|frame/), F('s6')),
  'M&E as-builts': rule(T('drawing'), F('s3-3', 's7-1-01')),
  'Fire strategy drawings': rule(T('fire_strategy', 'drawing'), K(/fire/), F('s3-1-04-03')),
  'External envelope materials & specs': rule(T('product_data', 'guarantee', 'manual'), K(/roof|window|facade|façade|cladding|brick|render|membrane|curtain wall|glazing/)),
  'Internal materials & finishes schedule': rule(K(/finishes|internal materials/)),
  'COSHH data sheets': rule(T('sds')),
  'Fire risk assessment (handover)': rule(K(/fire risk assessment|\bfra\b/)),
  'Fire stopping records': rule(K(/fire.?stop/), F('s11-10')),
  'Working-at-height / access strategy for maintenance': rule(K(/access strategy|working at height|man ?safe|fall arrest|edge protection/)),
  'Structural calculations (as-built)': rule(T('calculation'), K(/struct/), F('s6')),
  'Structural certificates & warranties': rule(K(/structural (warranty|certificate)|nhbc|premier guarantee|labc warranty|building warranty/)),
  'Mechanical installation records': rule(T('manual', 'certificate', 'test_report'), K(/mechanical|hvac|mvhr|heat pump|boiler|ventilation/)),
  'Electrical installation certificates (EIC)': rule(K(/\beic\b|electrical installation cert/), F('s11-3')),
  'Public health / drainage records': rule(K(/drainage|cctv survey|public health|soil|waste pipe/)),
  'O&M manuals — mechanical': rule(T('manual'), K(/mechanical|hvac|mvhr|heat pump|boiler|ventilation|plumbing/)),
  'O&M manuals — electrical': rule(T('manual'), K(/electric|lighting|fire alarm|door entry|access control/)),
  'O&M manuals — lifts / specialist plant': rule(T('manual'), K(/lift|plant|sprinkler|pump|generator/)),
  'HVAC commissioning records': rule(T('test_report', 'certificate'), K(/commission/), K(/hvac|mvhr|ventilat|heating|heat pump/)),
  'Water treatment & flushing certificates': rule(K(/flush|chlorinat|water treatment|legionella/)),
  'Fire alarm commissioning': rule(T('certificate', 'test_report'), K(/fire alarm/), F('s11-4')),
  'User guides': rule(T('manual'), K(/user (guide|manual)|home user|resident/)),
  'Maintenance schedules': rule(K(/maintenance schedule|planned maintenance/), { fromJob: 'omIssued' }),
  'Cleaning regimes': rule(K(/cleaning/)),
  'Building Control completion certificate': rule(K(/completion certificate|final certificate|building control/)),
  'Gas certificates': rule(K(/gas safe|gas safety|\bcp12\b|gas cert/)),
  'Electrical certificates': rule(K(/\beic\b|\beicr\b|electrical (installation )?cert/), F('s11-3')),
  'Warranties & guarantees schedule': rule(T('guarantee', 'warranty'), { fromJob: 'omIssued' }),
}

const textOf = f => [f.file_name, f.ai?.title, f.ai?.system, f.ai?.issuer, f.ai?.reference, ...(f.ai?.key_facts || [])].filter(Boolean).join(' ').toLowerCase()
const inFolder = (f, prefixes) => prefixes.some(p => f.folder_key === p || f.folder_key?.startsWith(p + '-'))

/**
 * @returns {null | { file?: object, reason: string }} — what satisfied the item, or null
 */
export function autoMatch(label, files, job = {}) {
  const r = CHECK_RULES[label]
  if (!r) return null
  const live = files.filter(f => f.origin !== 'om_builder' && f.folder_key !== '_inbox' && f.ai?.client_facing !== false)
  const hit = live.find(f => {
    const typeOk = !r.types || r.types.includes(f.ai?.doc_type)
    const kwOk = r.res.length > 0 && r.res.every(re => re.test(textOf(f)))
    const folderOk = !!r.folders && inFolder(f, r.folders)
    // Right kind of document, and either it mentions the subject or it's filed
    // in the folder made for it. A type on its own is enough only when the
    // rule names no subject and no folder (e.g. any safety data sheet).
    const subjectOk = kwOk || folderOk || (!r.res.length && !r.folders)
    return !!(r.types || r.res.length || r.folders) && typeOk && subjectOk
  })
  if (hit) return { file: hit, reason: hit.file_name }
  if (r.fromJob === 'subs' && job.subs > 0) return { reason: `${job.subs} subcontractor${job.subs === 1 ? '' : 's'} on this job` }
  if (r.fromJob === 'designTeam' && job.designTeam > 0) return { reason: `${job.designTeam} design team contact${job.designTeam === 1 ? '' : 's'}` }
  if (r.fromJob === 'omIssued' && job.omIssued) return { reason: `In the issued O&M manual (${job.omIssued})` }
  return null
}
