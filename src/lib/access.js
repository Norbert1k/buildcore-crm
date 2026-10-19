import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { ROLE_PERMISSIONS } from './utils'

// Menu/page keys this person may use (see ROLE_PERMISSIONS in utils).
export function useNav() {
  const { profile } = useAuth()
  return (ROLE_PERMISSIONS[profile?.role] || ROLE_PERMISSIONS.viewer).nav
}

// Site managers only see subcontractors working on their own projects.
// Returns null for everyone else (no restriction), or a Set of allowed
// subcontractor ids once loaded (undefined while loading).
export function useAllowedSubIds() {
  const { role, projectAccess } = useAuth()
  const [ids, setIds] = useState(role === 'site_manager' ? undefined : null)
  useEffect(() => {
    if (role !== 'site_manager') { setIds(null); return }
    if (!projectAccess?.length) { setIds(new Set()); return }
    supabase.from('project_subcontractors').select('subcontractor_id').in('project_id', projectAccess)
      .then(({ data }) => setIds(new Set((data || []).map(r => String(r.subcontractor_id)))))
      .catch(() => setIds(new Set()))   // on failure show nothing rather than spin forever
  }, [role, (projectAccess || []).join(',')])
  return ids
}
