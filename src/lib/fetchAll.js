import { supabase } from './supabase'

// Supabase returns at most 1,000 rows per request. A busy job has more files
// than that (drawings, reports, photos…), so anything that counts or lists
// every file on a job must read them in pages — otherwise counts come out
// short ("3 files" when the folder holds 6) and zips miss files.
//
//   const { data } = await fetchAll(() => supabase.from('project_doc_files').select('folder_key').eq('project_id', id))
//
// `build` must return a fresh query each time (it's called once per page).
export async function fetchAll(build, pageSize = 1000) {
  let rows = []
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + pageSize - 1)
    if (error) return { data: rows.length ? rows : null, error }
    rows = rows.concat(data || [])
    if (!data || data.length < pageSize) break
  }
  return { data: rows, error: null }
}
export { supabase }
