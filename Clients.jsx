function ProjectsTab({ projects, navigate }) {
  const running = projects.filter(ps => ps.projects?.status === 'active' || ps.projects?.status === 'tender' || ps.projects?.status === 'on_hold')
  const completed = projects.filter(ps => ps.projects?.status === 'completed' || ps.projects?.status === 'cancelled')
  const totalOrderValue = projects.reduce((s, ps) => s + (parseFloat(ps.contract_value)||0), 0)
  const totalVariation = projects.reduce((s, ps) => s + (parseFloat(ps.variation_amount)||0), 0)

  function ProjectRow({ ps }) {
    return (
      <tr style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${ps.project_id}`)}>
        <td>
          <div style={{ fontWeight: 500, color: 'var(--text)' }}>{ps.projects?.project_name}</div>
          {ps.projects?.client_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{ps.projects?.client_name}</div>}
        </td>
        <td className="td-muted">{ps.projects?.project_ref || '—'}</td>
        <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(ps.start_date)} – {formatDate(ps.end_date)}</td>
        <td style={{ fontWeight: 500 }}>{ps.contract_value ? formatCurrency(ps.contract_value) : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
        <td>
          {ps.variation_amount > 0 ? (
            <div>
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>+{formatCurrency(ps.variation_amount)}</span>
              {ps.variation_notes && ps.variation_notes.split('\n').map((line, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text2)' }}>{line}</div>
              ))}
            </div>
          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
        </td>
        <td style={{ fontWeight: 600 }}>
          {(parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0) > 0
            ? formatCurrency((parseFloat(ps.contract_value)||0) + (parseFloat(ps.variation_amount)||0))
            : '—'}
        </td>
        <td>
          <Pill cls={ps.projects?.status === 'active' ? 'pill-green' : ps.projects?.status === 'tender' ? 'pill-blue' : ps.projects?.status === 'completed' ? 'pill-gray' : 'pill-amber'}>
            {ps.projects?.status?.charAt(0).toUpperCase() + ps.projects?.status?.slice(1) || ps.status}
          </Pill>
        </td>
      </tr>
    )
  }

  if (projects.length === 0) return (
    <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 40 }}>Not assigned to any projects yet.</div>
  )

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Running</div><div className="stat-value green">{running.length}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value">{completed.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Order Value</div><div className="stat-value" style={{ fontSize: 16 }}>{totalOrderValue > 0 ? formatCurrency(totalOrderValue) : '—'}</div></div>
        {totalVariation > 0 && <div className="stat-card"><div className="stat-label">Total Variations</div><div className="stat-value amber" style={{ fontSize: 16 }}>+{formatCurrency(totalVariation)}</div></div>}
        {totalOrderValue > 0 && <div className="stat-card" style={{ borderTop: '3px solid var(--green)' }}><div className="stat-label">Grand Total</div><div className="stat-value green" style={{ fontSize: 16 }}>{formatCurrency(totalOrderValue + totalVariation)}</div></div>}
      </div>

      {running.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} /> Running Projects ({running.length})
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Ref</th><th>Dates</th><th>Order Value</th><th>Variation</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>{running.map(ps => <ProjectRow key={ps.id} ps={ps} />)}</tbody>
            </table>
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text3)' }} /> Completed Projects ({completed.length})
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Ref</th><th>Dates</th><th>Order Value</th><th>Variation</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>{completed.map(ps => <ProjectRow key={ps.id} ps={ps} />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
