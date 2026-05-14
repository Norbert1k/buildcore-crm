import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { sortBy, formatDate } from '../lib/utils'
import { Spinner, Pill, Modal, Field, IconChevron, IconEdit, IconTrash, ConfirmDialog } from '../components/ui'

const PRIORITIES = {
  high:   { label: 'High',   color: '#c00' },
  medium: { label: 'Medium', color: '#b87a00' },
  low:    { label: 'Low',    color: '#448a40' },
}
const STATUS_LABELS = {
  active:      { label: 'Active',      cls: 'pill-green' },
  working_on:  { label: 'Working On',  cls: 'pill-amber' },
  closed:      { label: 'Closed',      cls: 'pill-gray' },
}

export default function TaskDetail() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { can, profile } = useAuth()

  // Smart back navigation. If we got here from another page in the app
  // (the normal case: user clicked a task row in the Task Tracker), use
  // navigate(-1) so the browser restores the previous URL exactly —
  // including any filter query params like ?assignee={chris}. If the
  // user landed on this page directly (fresh tab, deep link from an
  // email, etc.), there's no history to go back to so we fall back to
  // /tasks. React Router uses location.key === 'default' as the signal
  // for "first entry, no history yet".
  function goBack() {
    if (location.key && location.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/tasks')
    }
  }

  const [task, setTask] = useState(null)
  const [project, setProject] = useState(null)
  const [assignees, setAssignees] = useState([])
  const [notes, setNotes] = useState([])
  const [files, setFiles] = useState([])
  const [activity, setActivity] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(true)

  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedAssignees, setSelectedAssignees] = useState(new Set())
  const [savingAssign, setSavingAssign] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [emlPreview, setEmlPreview] = useState(null)
  // Note edit state. editingNoteId is the id of the note currently
  // being edited (null = not editing anything); editingNoteText is the
  // in-progress draft text. Only one note can be edited at a time.
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // ─── Quotes state (Step 3) ──────────────────────────────────────────────
  // List of task_quotes for this task, ordered with the lowest amount
  // first so the comparison card naturally shows the cheapest at the
  // top. Each row may have supplier_id, subcontractor_id, or only
  // vendor_name_text.
  const [quotes, setQuotes] = useState([])
  // Vendors list for the quote picker. Combined from suppliers and
  // subcontractors tables, each tagged with `kind` so the picker can
  // show distinct sub-groups. Loaded once on mount.
  const [vendors, setVendors] = useState([])
  // Quote modal state. null = closed; otherwise holds the form data
  // (either pre-filled for editing or empty for a new quote).
  const [quoteModal, setQuoteModal] = useState(null)
  const [savingQuote, setSavingQuote] = useState(false)
  const [extractingQuote, setExtractingQuote] = useState(false)
  // Drag-and-drop. Tracks whether files are currently being dragged over
  // the page so we can show a full-page drop overlay.
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => { load() }, [taskId])

  // Window-level drag-and-drop. Drop files anywhere on the page to
  // upload them. PDFs detected as quotes also trigger AI extraction
  // automatically, so the user can drop a quote PDF and immediately
  // see the pre-filled form.
  useEffect(() => {
    if (!canUpload) return undefined

    function handleDragEnter(e) {
      // Only react to actual file drags (not text selections, link drags, etc.)
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        setDragOver(true)
      }
    }
    function handleDragOver(e) {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    function handleDragLeave(e) {
      // Only hide when leaving the window. If relatedTarget exists
      // we're moving between child elements within the page.
      if (!e.relatedTarget || e.relatedTarget === null) {
        setDragOver(false)
      }
    }
    async function handleDrop(e) {
      e.preventDefault()
      setDragOver(false)
      const dropped = Array.from(e.dataTransfer?.files || [])
      if (dropped.length === 0) return
      // Upload all files. We re-use the existing uploadFiles flow so
      // categorisation and activity logging stay consistent. But for a
      // single PDF dropped on its own that auto-categorises to 'quote',
      // ALSO trigger the AI extraction afterward.
      await uploadFiles(dropped)
      if (dropped.length === 1) {
        const f = dropped[0]
        const cat = detectFileCategory(f.name, f.type || '')
        if (cat === 'quote' && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) {
          // The upload's load() will have refreshed `files`. We need to
          // find the just-inserted task_file by filename + size to get
          // its task_file_id for the extract call. Re-fetch the latest
          // files row directly to avoid React state staleness.
          const { data: latestFiles } = await supabase
            .from('task_files')
            .select('*')
            .eq('task_id', taskId)
            .eq('file_name', f.name)
            .order('uploaded_at', { ascending: false })
            .limit(1)
          const tf = latestFiles?.[0]
          if (tf) {
            // Open the modal first so the user sees the in-progress UI,
            // then run the extraction.
            openQuoteModal()
            await extractQuoteFromFile({ task_file_id: tf.id, blob: f })
          }
        }
      }
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, canUpload, files])

  async function load() {
    setLoading(true)
    try {
      const [taskRes, asgRes, notesRes, filesRes, actRes, usersRes, quotesRes, suppliersRes, subsRes] = await Promise.all([
        supabase.from('tasks').select('*').eq('id', taskId).single(),
        supabase.from('task_assignees').select('user_id, assigned_at, profiles(id, full_name, role)').eq('task_id', taskId),
        supabase.from('task_notes').select('*, profiles(id, full_name)').eq('task_id', taskId).order('created_at', { ascending: false }),
        supabase.from('task_files').select('*, profiles(id, full_name)').eq('task_id', taskId).order('uploaded_at', { ascending: false }),
        supabase.from('task_activity').select('*, profiles(id, full_name)').eq('task_id', taskId).order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
        // task_quotes joined with supplier + subcontractor for vendor
        // name resolution. Ordered by amount ascending so the
        // comparison card lists cheapest first by default.
        supabase.from('task_quotes')
          .select('*, supplier:suppliers(id, company_name), subcontractor:subcontractors(id, company_name), profiles(id, full_name)')
          .eq('task_id', taskId)
          .order('amount', { ascending: true, nullsLast: true }),
        // Combined vendor picker source: all suppliers + subcontractors
        // by name. Each list fetched separately so we can preserve the
        // 'kind' tag client-side.
        supabase.from('suppliers').select('id, company_name').order('company_name'),
        supabase.from('subcontractors').select('id, company_name').order('company_name'),
      ])
      if (taskRes.error) { console.error('[TaskDetail] task error:', taskRes.error); setLoading(false); return }

      setTask(taskRes.data)
      setAssignees(asgRes.data || [])
      setNotes(notesRes.data || [])
      setFiles(filesRes.data || [])
      setActivity(actRes.data || [])
      setAllUsers(sortBy(usersRes.data || [], 'full_name'))
      setQuotes(quotesRes.data || [])

      // Tag and merge the vendor lists. The picker renders a single
      // <select> but groups options into <optgroup>s by kind. Storing
      // them as one list with a `kind` field makes that trivial.
      const supplierList = (suppliersRes.data || []).map(s => ({
        kind: 'supplier', id: s.id, name: s.company_name,
      }))
      const subList = (subsRes.data || []).map(s => ({
        kind: 'subcontractor', id: s.id, name: s.company_name,
      }))
      setVendors([...supplierList, ...subList])

      if (taskRes.data?.project_id) {
        const { data: proj } = await supabase.from('projects').select('id, project_name, project_ref, status').eq('id', taskRes.data.project_id).single()
        setProject(proj)
      }
    } catch (e) {
      console.error('[TaskDetail] load error:', e)
    }
    setLoading(false)
  }

  const isAssignee = assignees.some(a => a.user_id === profile?.id)
  const isAdmin = profile?.role === 'admin'
  // All task actions require being an assignee (or admin)
  const canEditTask = isAssignee || isAdmin
  const canChangeStatus = isAssignee || isAdmin
  const canComment = isAssignee || isAdmin
  const canUpload = isAssignee || isAdmin
  const canDeleteNote = (note) => note.author_id === profile?.id || isAdmin
  const canEditNote = (note) => note.author_id === profile?.id || isAdmin
  const canDeleteFile = (file) => file.uploaded_by === profile?.id || isAdmin

  function startEditNote(note) {
    setEditingNoteId(note.id)
    setEditingNoteText(note.note || '')
  }

  function cancelEditNote() {
    setEditingNoteId(null)
    setEditingNoteText('')
  }

  async function saveEditNote() {
    if (!editingNoteId) return
    const trimmed = editingNoteText.trim()
    if (!trimmed) {
      // Empty note isn't allowed — keep editor open so the user can
      // either type something or cancel.
      return
    }
    setSavingEdit(true)
    const { error } = await supabase
      .from('task_notes')
      .update({ note: trimmed })
      .eq('id', editingNoteId)
    if (error) {
      alert('Could not save edit: ' + error.message)
      setSavingEdit(false)
      return
    }
    setEditingNoteId(null)
    setEditingNoteText('')
    setSavingEdit(false)
    await load()
  }

  async function addNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    const { error } = await supabase.from('task_notes').insert({
      task_id: taskId, author_id: profile?.id, note: noteText.trim(),
    })
    if (error) { alert('Note failed: ' + error.message); setSavingNote(false); return }
    setNoteText('')
    await load()
    setSavingNote(false)
  }

  async function deleteNote(noteId) {
    if (!window.confirm('Delete this note?')) return
    await supabase.from('task_notes').delete().eq('id', noteId)
    load()
  }

  async function uploadFiles(fileList) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    const errors = []
    for (const f of Array.from(fileList)) {
      const ext = f.name.split('.').pop()
      const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('task-files').upload(path, f, { upsert: false })
      if (upErr) { errors.push(`${f.name}: ${upErr.message}`); continue }
      // Detect category from filename + mime. Same logic as the SQL
      // backfill in step1-schema.sql so client and server stay in sync.
      const category = detectFileCategory(f.name, f.type || '')
      const { error: dbErr } = await supabase.from('task_files').insert({
        task_id: taskId, file_name: f.name, storage_path: path, file_size: f.size,
        mime_type: f.type || null, uploaded_by: profile?.id, category,
      })
      if (dbErr) { errors.push(`${f.name}: ${dbErr.message}`); continue }
      await supabase.from('task_activity').insert({
        task_id: taskId, actor_id: profile?.id, action: 'file_uploaded',
        details: { file_name: f.name },
      })
    }
    if (errors.length) alert('Some uploads failed:\n' + errors.join('\n'))
    setUploading(false)
    load()
  }

  // Change the category on an existing file. Called from the dropdown
  // attached to each file row. Re-loads on success so the file moves
  // groups in the categorised view.
  async function changeFileCategory(file, newCategory) {
    if (file.category === newCategory) return
    const { error } = await supabase
      .from('task_files')
      .update({ category: newCategory })
      .eq('id', file.id)
    if (error) {
      alert('Could not change category: ' + error.message)
      return
    }
    load()
  }

  // AI-extract quote fields from a PDF. Two call paths:
  //   1. After upload of a file in 'quote' category — open modal pre-filled
  //   2. From the modal itself when user has linked a task_file
  // file param: { source: 'task_file' | 'raw_file', task_file_id?, blob? }
  async function extractQuoteFromFile(source) {
    setExtractingQuote(true)
    try {
      let blob
      if (source.task_file_id) {
        // Fetch the bytes from storage so we can base64-encode them
        const tf = files.find(f => f.id === source.task_file_id)
        if (!tf) throw new Error('File not found')
        const { data: urlData, error } = await supabase.storage
          .from('task-files').createSignedUrl(tf.storage_path, 60)
        if (error || !urlData) throw error || new Error('Could not sign URL')
        const resp = await fetch(urlData.signedUrl)
        if (!resp.ok) throw new Error('Could not download file for analysis')
        blob = await resp.blob()
      } else if (source.blob) {
        blob = source.blob
      } else {
        throw new Error('No file provided')
      }

      // Base64-encode. Use FileReader for browser-safe encoding of binary.
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result
          // strip "data:application/pdf;base64," prefix
          const comma = dataUrl.indexOf(',')
          resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
        }
        reader.onerror = () => reject(reader.error || new Error('Read failed'))
        reader.readAsDataURL(blob)
      })

      const { data, error } = await supabase.functions.invoke('parse-quote-pdf', {
        body: { pdf_base64: base64 },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || data?.parse_error || 'Could not parse the PDF')

      // Match extracted vendor name to existing suppliers/subcontractors
      // case-insensitively. If found, switch the form to the matching
      // vendor kind. Otherwise fall back to freetext so the user can
      // confirm and optionally create-from-this.
      const extractedName = (data.vendor_name || '').trim()
      let matched = null
      if (extractedName) {
        const lc = extractedName.toLowerCase()
        matched = vendors.find(v => v.name.toLowerCase() === lc)
          || vendors.find(v => v.name.toLowerCase().includes(lc) || lc.includes(v.name.toLowerCase()))
      }

      // Pre-fill the modal. If the modal is already open (user clicked
      // "Extract from PDF" from inside), preserve any id they're editing
      // and merge — otherwise create a fresh form.
      setQuoteModal(prev => {
        const base = prev || {
          _id: null,
          supplier_id: '',
          subcontractor_id: '',
          vendor_name_text: '',
          amount: '',
          currency: 'GBP',
          received_date: '',
          status: 'pending',
          notes: '',
          task_file_id: '',
          vendor_kind: 'supplier',
        }
        return {
          ...base,
          // Link to the attached file if we have one (from drag-drop or
          // when extracted from an already-uploaded file).
          task_file_id: source.task_file_id || base.task_file_id || '',
          vendor_kind: matched ? matched.kind : 'freetext',
          supplier_id: matched?.kind === 'supplier' ? matched.id : '',
          subcontractor_id: matched?.kind === 'subcontractor' ? matched.id : '',
          vendor_name_text: extractedName || base.vendor_name_text,
          amount: data.amount != null ? String(data.amount) : base.amount,
          currency: data.currency || base.currency || 'GBP',
          received_date: data.received_date || base.received_date,
          notes: data.notes || base.notes,
          // Mark which fields were AI-filled so the modal can badge them.
          _aiFilled: {
            vendor_name: !!extractedName,
            amount: data.amount != null,
            currency: !!data.currency,
            received_date: !!data.received_date,
            notes: !!data.notes,
          },
          _aiConfidence: data.confidence || 'unknown',
        }
      })
    } catch (err) {
      alert('Could not extract quote details: ' + (err?.message || err))
    } finally {
      setExtractingQuote(false)
    }
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete ${file.file_name}?`)) return
    await supabase.storage.from('task-files').remove([file.storage_path])
    await supabase.from('task_files').delete().eq('id', file.id)
    load()
  }

  // ─── Quote handlers (Step 3) ────────────────────────────────────────────

  // Open the quote modal. If `existing` is passed it's an edit; otherwise
  // a fresh new-quote form. The form state lives inside `quoteModal`
  // so the modal can render a controlled form against it.
  function openQuoteModal(existing = null) {
    if (existing) {
      // Pre-fill from the existing row. We keep the original quote id
      // on `_id` so the save handler knows to UPDATE not INSERT.
      setQuoteModal({
        _id: existing.id,
        // vendor_kind = 'supplier' | 'subcontractor' | 'freetext'
        vendor_kind: existing.supplier_id
          ? 'supplier'
          : existing.subcontractor_id
            ? 'subcontractor'
            : 'freetext',
        supplier_id: existing.supplier_id || '',
        subcontractor_id: existing.subcontractor_id || '',
        vendor_name_text: existing.vendor_name_text || '',
        amount: existing.amount != null ? String(existing.amount) : '',
        currency: existing.currency || 'GBP',
        received_date: existing.received_date || '',
        status: existing.status || 'pending',
        notes: existing.notes || '',
        task_file_id: existing.task_file_id || '',
      })
    } else {
      setQuoteModal({
        _id: null,
        vendor_kind: 'supplier',
        supplier_id: '',
        subcontractor_id: '',
        vendor_name_text: '',
        amount: '',
        currency: 'GBP',
        received_date: new Date().toISOString().slice(0, 10),
        status: 'pending',
        notes: '',
        task_file_id: '',
      })
    }
  }

  // Save (insert or update) the quote. Handles:
  //  - resolving vendor_name_text from the picked supplier/subcontractor
  //  - auto-rejecting siblings when status transitions to 'accepted'
  //  - logging activity
  async function saveQuote() {
    if (!quoteModal) return
    const q = quoteModal
    setSavingQuote(true)
    try {
      // Resolve vendor identity. Exactly one of supplier_id /
      // subcontractor_id should be set; the freetext fallback always
      // populates vendor_name_text.
      let supplierId = null
      let subcontractorId = null
      let vendorName = q.vendor_name_text?.trim() || ''
      if (q.vendor_kind === 'supplier' && q.supplier_id) {
        supplierId = q.supplier_id
        const v = vendors.find(v => v.kind === 'supplier' && v.id === q.supplier_id)
        vendorName = v?.name || vendorName
      } else if (q.vendor_kind === 'subcontractor' && q.subcontractor_id) {
        subcontractorId = q.subcontractor_id
        const v = vendors.find(v => v.kind === 'subcontractor' && v.id === q.subcontractor_id)
        vendorName = v?.name || vendorName
      }
      if (!vendorName) {
        alert('Please pick a vendor or type a vendor name.')
        setSavingQuote(false)
        return
      }

      const amountNum = q.amount === '' ? null : Number(q.amount)
      if (q.amount !== '' && (Number.isNaN(amountNum) || amountNum < 0)) {
        alert('Amount must be a positive number, or leave blank.')
        setSavingQuote(false)
        return
      }

      const payload = {
        task_id: taskId,
        task_file_id: q.task_file_id || null,
        supplier_id: supplierId,
        subcontractor_id: subcontractorId,
        vendor_name_text: vendorName,
        amount: amountNum,
        currency: q.currency || 'GBP',
        received_date: q.received_date || null,
        status: q.status || 'pending',
        notes: q.notes?.trim() || null,
      }

      let savedId = q._id
      if (q._id) {
        const { error } = await supabase.from('task_quotes').update(payload).eq('id', q._id)
        if (error) throw error
      } else {
        payload.created_by = profile?.id
        const { data, error } = await supabase.from('task_quotes').insert(payload).select('id').single()
        if (error) throw error
        savedId = data?.id
      }

      // Auto-reject sibling quotes when this one is now accepted.
      // We update any sibling on the same task that's still pending or
      // expired (NOT already-rejected — leave history alone) to
      // rejected. The newly-saved quote is excluded by id.
      if (payload.status === 'accepted' && savedId) {
        await supabase.from('task_quotes')
          .update({ status: 'rejected' })
          .eq('task_id', taskId)
          .neq('id', savedId)
          .in('status', ['pending', 'expired'])
      }

      // Log activity so the timeline records the action.
      await supabase.from('task_activity').insert({
        task_id: taskId,
        actor_id: profile?.id,
        action: q._id ? 'quote_updated' : 'quote_added',
        details: {
          vendor: vendorName,
          amount: amountNum,
          status: payload.status,
        },
      })

      setQuoteModal(null)
      load()
    } catch (err) {
      alert('Could not save quote: ' + (err?.message || err))
    } finally {
      setSavingQuote(false)
    }
  }

  // Delete a quote. Confirms first (irreversible).
  async function deleteQuote(quote) {
    if (!window.confirm(`Delete the quote from ${quote.vendor_name_text}?`)) return
    const { error } = await supabase.from('task_quotes').delete().eq('id', quote.id)
    if (error) {
      alert('Could not delete: ' + error.message)
      return
    }
    await supabase.from('task_activity').insert({
      task_id: taskId,
      actor_id: profile?.id,
      action: 'quote_deleted',
      details: { vendor: quote.vendor_name_text },
    })
    load()
  }

  // Create a supplier from the current freetext vendor name, then link
  // the form to the new supplier_id. Called from the "Create supplier"
  // button next to the freetext input when vendor_kind === 'freetext'.
  async function createSupplierFromFreetext() {
    const name = quoteModal?.vendor_name_text?.trim()
    if (!name) return
    if (!window.confirm(`Create a new supplier "${name}"?`)) return
    const { data, error } = await supabase
      .from('suppliers')
      .insert({ company_name: name, status: 'active', created_by: profile?.id })
      .select('id, company_name')
      .single()
    if (error) {
      alert('Could not create supplier: ' + error.message)
      return
    }
    // Add to local vendors list so the picker has it immediately, then
    // switch the form to use the new supplier_id.
    setVendors(prev => [...prev, { kind: 'supplier', id: data.id, name: data.company_name }])
    setQuoteModal(prev => prev ? {
      ...prev,
      vendor_kind: 'supplier',
      supplier_id: data.id,
      vendor_name_text: data.company_name,
    } : prev)
  }

  async function downloadFile(file) {
    const { data } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function previewFile(file) {
    const isEml = file.file_name.toLowerCase().endsWith('.eml')
    if (isEml) {
      // Download the EML content and parse it
      const { data: urlData } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 60)
      if (!urlData?.signedUrl) { alert('Could not load email'); return }
      try {
        const resp = await fetch(urlData.signedUrl)
        const text = await resp.text()
        setEmlPreview({ file, parsed: parseEml(text) })
      } catch (e) {
        alert('Email parse failed: ' + e.message)
      }
      return
    }
    // PDFs and images: open the signed URL in a new tab so the browser
    // renders them natively. Falls back to download for other types.
    const lower = file.file_name.toLowerCase()
    const isViewable = lower.endsWith('.pdf')
      || /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(lower)
      || (file.mime_type || '').startsWith('image/')
      || file.mime_type === 'application/pdf'
    if (isViewable) {
      const { data } = await supabase.storage.from('task-files').createSignedUrl(file.storage_path, 300)
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener')
        return
      }
    }
    // Fallback: download
    downloadFile(file)
  }

  async function changeStatus(newStatus) {
    const updates = { status: newStatus }
    if (newStatus === 'closed') { updates.closed_at = new Date().toISOString(); updates.closed_by = profile?.id }
    else { updates.closed_at = null; updates.closed_by = null }
    await supabase.from('tasks').update(updates).eq('id', taskId)
    await supabase.from('task_activity').insert({
      task_id: taskId, actor_id: profile?.id, action: 'status_changed', details: { to: newStatus }
    })
    load()
  }

  async function claimTask() {
    await supabase.from('task_assignees').insert({ task_id: taskId, user_id: profile?.id })
    await supabase.from('task_activity').insert({ task_id: taskId, actor_id: profile?.id, action: 'claimed' })
    load()
  }

  async function unassignSelf() {
    await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', profile?.id)
    await supabase.from('task_activity').insert({ task_id: taskId, actor_id: profile?.id, action: 'unassigned' })
    load()
  }

  async function saveEdit() {
    const { error } = await supabase.from('tasks').update({
      title: editForm.title?.trim(),
      description: editForm.description?.trim() || null,
      priority: editForm.priority,
    }).eq('id', taskId)
    if (error) { alert('Save failed: ' + error.message); return }
    setShowEdit(false)
    load()
  }

  async function deleteTask() {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) { alert('Delete failed: ' + error.message); return }
    navigate('/tasks')
  }

  function openAssignModal() {
    setSelectedAssignees(new Set(assignees.map(a => a.user_id)))
    setShowAssignModal(true)
  }

  async function saveAssignees() {
    setSavingAssign(true)
    const current = new Set(assignees.map(a => a.user_id))
    const next = selectedAssignees
    // Add new
    const toAdd = [...next].filter(id => !current.has(id))
    if (toAdd.length) {
      const rows = toAdd.map(uid => ({ task_id: taskId, user_id: uid }))
      await supabase.from('task_assignees').insert(rows)
      for (const uid of toAdd) {
        const user = allUsers.find(u => u.id === uid)
        await supabase.from('task_activity').insert({
          task_id: taskId, actor_id: profile?.id, action: 'assigned',
          details: { user_id: uid, user_name: user?.full_name },
        })
      }
    }
    // Remove gone
    const toRemove = [...current].filter(id => !next.has(id))
    for (const uid of toRemove) {
      await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', uid)
      const user = allUsers.find(u => u.id === uid)
      await supabase.from('task_activity').insert({
        task_id: taskId, actor_id: profile?.id, action: 'unassigned',
        details: { user_id: uid, user_name: user?.full_name },
      })
    }
    setShowAssignModal(false)
    setSavingAssign(false)
    load()
  }

  if (loading) return <Spinner />
  if (!task) return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={goBack}><IconChevron size={13} dir="left" /> Back</button>
      <div className="card card-pad">Task not found.</div>
    </div>
  )

  const pri = PRIORITIES[task.priority] || PRIORITIES.medium
  const st = STATUS_LABELS[task.status] || STATUS_LABELS.active

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={goBack}><IconChevron size={13} dir="left" /> Back to Task Tracker</button>

      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: pri.color, flexShrink: 0, marginTop: 5 }} title={pri.label + ' priority'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{task.title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text3)' }}>
              <Pill cls={st.cls}>{st.label}</Pill>
              <span>Priority: <strong style={{ color: pri.color }}>{pri.label}</strong></span>
              <span>•</span>
              <span>Created {formatDate(task.created_at)}</span>
              <span>•</span>
              <span>Updated {formatDate(task.updated_at)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
            {canChangeStatus && task.status === 'active' && <button className="btn btn-sm" onClick={() => changeStatus('working_on')}>Start</button>}
            {canChangeStatus && task.status === 'working_on' && <button className="btn btn-sm" onClick={() => changeStatus('closed')}>Close</button>}
            {canChangeStatus && task.status === 'closed' && <button className="btn btn-sm" onClick={() => changeStatus('active')}>Reopen</button>}
            {canEditTask && (
              <button className="btn btn-sm" onClick={() => { setEditForm({ title: task.title, description: task.description || '', priority: task.priority }); setShowEdit(true) }}>
                <IconEdit size={13} /> Edit
              </button>
            )}
            {canEditTask && (
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}><IconTrash size={13} /></button>
            )}
          </div>
        </div>

        {project && (
          <div style={{ fontSize: 12, color: 'var(--text2)', paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
            <strong style={{ color: 'var(--text3)' }}>Project:</strong>{' '}
            <Link to={`/projects/${project.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              {project.project_ref ? `${project.project_ref} — ` : ''}{project.project_name}
            </Link>
          </div>
        )}

        {task.description && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface2)', borderRadius: 6, fontSize: 13, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {task.description}
          </div>
        )}
      </div>

      {/* Assignees card */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Assigned to</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isAssignee && task.status !== 'closed' && (
              <button className="btn btn-sm" onClick={claimTask}>Claim</button>
            )}
            {isAssignee && (
              <button className="btn btn-sm" onClick={unassignSelf}>Unassign me</button>
            )}
            {canEditTask && (
              <button className="btn btn-sm" onClick={openAssignModal}>Manage…</button>
            )}
          </div>
        </div>
        {assignees.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>Unassigned — anyone can claim this task.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {assignees.map(a => <Pill key={a.user_id} cls="pill-blue">{a.profiles?.full_name || 'Unknown'}</Pill>)}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Progress Notes</div>
        {canComment ? (
          <div style={{ marginBottom: 12 }}>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Add a progress update, question, or status note…"
              style={{ width: '100%', minHeight: 70, fontSize: 13, padding: 10, fontFamily: 'inherit' }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote() }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>Ctrl/Cmd + Enter to post</div>
              <button className="btn btn-sm btn-primary" onClick={addNote} disabled={savingNote || !noteText.trim()}>
                {savingNote ? 'Posting…' : 'Post Note'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 12, padding: 10, background: 'var(--surface2)', borderRadius: 6, fontSize: 11, color: 'var(--text3)', textAlign: 'center', fontStyle: 'italic' }}>
            Only assigned team members can post notes. Claim this task to contribute.
          </div>
        )}
        {notes.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>No notes yet. Be the first to post an update.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map(n => {
              const isEditing = editingNoteId === n.id
              return (
                <div key={n.id} style={{ padding: 10, background: 'var(--surface2)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{n.profiles?.full_name || 'Unknown'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(n.created_at).toLocaleString('en-GB')}</div>
                      {/* Edit and delete buttons hidden while THIS note is in
                          edit mode — they live next to the textarea instead. */}
                      {!isEditing && canEditNote(n) && (
                        <button onClick={() => startEditNote(n)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, padding: 0 }} title="Edit note">✎</button>
                      )}
                      {!isEditing && canDeleteNote(n) && (
                        <button onClick={() => deleteNote(n.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, padding: 0 }} title="Delete note">✕</button>
                      )}
                    </div>
                  </div>
                  {isEditing ? (
                    <div>
                      <textarea
                        value={editingNoteText}
                        onChange={e => setEditingNoteText(e.target.value)}
                        autoFocus
                        style={{ width: '100%', minHeight: 80, padding: 8, fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={cancelEditNote} disabled={savingEdit}>Cancel</button>
                        <button className="btn btn-sm btn-primary" onClick={saveEditNote} disabled={savingEdit || !editingNoteText.trim()}>
                          {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.note}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quote comparison (Step 3) */}
      {(() => {
        const canManageQuotes = ['admin', 'project_manager', 'operations_manager', 'site_manager', 'document_controller'].includes(profile?.role)
        const canDeleteQuotes = ['admin', 'project_manager', 'operations_manager'].includes(profile?.role)
        // Don't render the card if no quotes AND user can't add. (User
        // would never see the Add Quote button so showing an empty card
        // is just visual noise.)
        if (quotes.length === 0 && !canManageQuotes) return null
        // Compute comparison stats — only meaningful when we have at
        // least 2 priced quotes. The lowest is used as the baseline for
        // the diff column.
        const priced = quotes.filter(q => q.amount != null && q.amount > 0)
        const lowest = priced.length > 0
          ? priced.reduce((a, b) => (a.amount <= b.amount ? a : b))
          : null
        const highest = priced.length > 0
          ? priced.reduce((a, b) => (a.amount >= b.amount ? a : b))
          : null
        const avg = priced.length > 0
          ? priced.reduce((s, q) => s + Number(q.amount), 0) / priced.length
          : null
        return (
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Quote comparison{quotes.length > 0 && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>{quotes.length}</span>}
              </div>
              {canManageQuotes && (
                <button className="btn btn-sm btn-primary" onClick={() => openQuoteModal()}>+ Add quote</button>
              )}
            </div>
            {quotes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
                No quotes yet. Click "Add quote" to record one.
              </div>
            ) : (
              <>
                <div style={{ overflow: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text3)', fontWeight: 400, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '6px 8px', fontWeight: 500 }}>Vendor</th>
                        <th style={{ padding: '6px 8px', fontWeight: 500, textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '6px 8px', fontWeight: 500 }}>Status</th>
                        <th style={{ padding: '6px 8px', fontWeight: 500, textAlign: 'right' }}>vs Lowest</th>
                        <th style={{ padding: '6px 8px', fontWeight: 500, width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map(q => {
                        const isLowest = lowest && q.id === lowest.id && priced.length > 1
                        const diff = (q.amount != null && lowest && lowest.amount > 0)
                          ? Number(q.amount) - Number(lowest.amount)
                          : null
                        const diffPct = (diff != null && lowest && lowest.amount > 0)
                          ? (diff / Number(lowest.amount)) * 100
                          : null
                        const statusStyle = {
                          accepted: { bg: '#EAF3DE', fg: '#27500A' },
                          rejected: { bg: '#FCEBEB', fg: '#791F1F' },
                          pending:  { bg: 'var(--surface2)', fg: 'var(--text2)' },
                          expired:  { bg: '#F1EFE8', fg: '#5F5E5A' },
                        }[q.status] || { bg: 'var(--surface2)', fg: 'var(--text2)' }
                        return (
                          <tr key={q.id}
                            onClick={() => canManageQuotes && openQuoteModal(q)}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              cursor: canManageQuotes ? 'pointer' : 'default',
                            }}>
                            <td style={{ padding: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>{q.vendor_name_text}</span>
                                {q.supplier_id && <span style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Supplier</span>}
                                {q.subcontractor_id && <span style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Sub</span>}
                              </div>
                              {q.notes && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{q.notes.length > 80 ? q.notes.slice(0, 80) + '…' : q.notes}</div>}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {q.amount != null ? `${q.currency === 'GBP' ? '£' : (q.currency + ' ')}${Number(q.amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td style={{ padding: '8px' }}>
                              <span style={{
                                display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 99,
                                background: statusStyle.bg, color: statusStyle.fg, fontWeight: 600,
                                textTransform: 'capitalize',
                              }}>{q.status}</span>
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {isLowest ? (
                                <span style={{ color: 'var(--text3)' }}>—</span>
                              ) : diff != null ? (
                                <span style={{ color: diffPct >= 20 ? '#791F1F' : (diffPct >= 10 ? '#854F0B' : 'var(--text2)') }}>
                                  +£{diff.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (+{diffPct.toFixed(1)}%)
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text3)' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {canDeleteQuotes && (
                                <button className="btn btn-sm btn-danger"
                                  onClick={(e) => { e.stopPropagation(); deleteQuote(q) }}
                                  title="Delete quote">✕</button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {priced.length >= 2 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span>Average: £{avg.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span>Spread: £{(highest.amount - lowest.amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({(((highest.amount - lowest.amount) / lowest.amount) * 100).toFixed(1)}%)</span>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* Files */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Files & Emails</div>
          {canUpload && (
            <label className="btn btn-sm btn-primary" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? 'Uploading…' : '+ Upload'}
              <input type="file" multiple onChange={e => { uploadFiles(e.target.files); e.target.value = '' }} disabled={uploading} style={{ display: 'none' }} />
            </label>
          )}
        </div>
        {!canUpload && files.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 16, fontStyle: 'italic' }}>
            Only assigned team members can upload files.
          </div>
        )}
        {files.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>
            No files uploaded. Drag and drop, or click Upload. Supports any file type including .eml emails.
          </div>
        ) : (
          // Categorised view. Each category renders as its own
          // section: header with name + count, then the file rows.
          // We pre-group files into a Map<category, files[]> so every
          // category renders in CATEGORIES order, even those with
          // zero files (which collapse to just the dim header).
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(() => {
              const byCategory = new Map()
              for (const cat of CATEGORIES) byCategory.set(cat.value, [])
              for (const f of files) {
                const key = byCategory.has(f.category) ? f.category : 'other'
                byCategory.get(key).push(f)
              }
              return CATEGORIES.map(cat => {
                const catFiles = byCategory.get(cat.value) || []
                if (catFiles.length === 0) return null
                return (
                  <div key={cat.value}>
                    {/* Category header: small caps, count next to label */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 10, fontWeight: 600, color: 'var(--text2)',
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      marginBottom: 6,
                    }}>
                      <span style={{ fontSize: 13 }}>{cat.icon}</span>
                      <span>{cat.label}</span>
                      <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{catFiles.length}</span>
                    </div>
                    {/* File rows in this category */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {catFiles.map(f => {
                        const isEml = f.file_name.toLowerCase().endsWith('.eml')
                        return (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'var(--surface2)', borderRadius: 6 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 4, background: isEml ? '#e3f2fd' : 'var(--surface)', color: isEml ? '#1565c0' : 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                              {isEml ? '✉' : '📄'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                                {fmtBytes(f.file_size)} • {f.profiles?.full_name || 'Unknown'} • {new Date(f.uploaded_at).toLocaleDateString('en-GB')}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                              {canUpload && (
                                // Inline category re-assignment. Native
                                // <select> is the cleanest way to give
                                // the user a 5-option picker without
                                // building a custom dropdown component.
                                <select
                                  value={f.category || 'other'}
                                  onChange={(e) => changeFileCategory(f, e.target.value)}
                                  title="Change category"
                                  style={{
                                    fontSize: 11, padding: '3px 4px', borderRadius: 4,
                                    border: '1px solid var(--border)', background: 'var(--surface)',
                                    color: 'var(--text2)', cursor: 'pointer',
                                  }}
                                  onClick={e => e.stopPropagation()}>
                                  {CATEGORIES.map(c => (
                                    <option key={c.value} value={c.value}>{c.label.replace(/s$/, '')}</option>
                                  ))}
                                </select>
                              )}
                              {(() => {
                                // View button — for PDFs, images, and EMLs.
                                // PDFs/images open in a new tab via signed URL.
                                // EML opens in the existing in-app viewer.
                                const lower = f.file_name.toLowerCase()
                                const isViewable = isEml
                                  || lower.endsWith('.pdf')
                                  || /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(lower)
                                  || (f.mime_type || '').startsWith('image/')
                                  || f.mime_type === 'application/pdf'
                                if (!isViewable) return null
                                return (
                                  <button className="btn btn-sm" onClick={() => previewFile(f)} title="View">
                                    👁
                                  </button>
                                )
                              })()}
                              <button className="btn btn-sm" onClick={() => downloadFile(f)} title="Download">⬇</button>
                              {canDeleteFile(f) && (
                                <button className="btn btn-sm btn-danger" onClick={() => deleteFile(f)} title="Delete">✕</button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }).filter(Boolean)
            })()}
          </div>
        )}
      </div>

      {/* Activity log */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Activity</div>
        {activity.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>No activity yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '4px 0' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <strong style={{ color: 'var(--text)' }}>{a.profiles?.full_name || 'Someone'}</strong>{' '}
                  <span style={{ color: 'var(--text2)' }}>{formatActivityAction(a)}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(a.created_at).toLocaleString('en-GB')}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Task" size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowEdit(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEdit} disabled={!editForm.title?.trim()}>Save</button>
        </>}>
        <div className="form-grid">
          <div className="full"><Field label="Title *"><input value={editForm.title || ''} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} autoFocus /></Field></div>
          <div className="full"><Field label="Description"><textarea value={editForm.description || ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={{ minHeight: 80 }} /></Field></div>
          <Field label="Priority"><select value={editForm.priority || 'medium'} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select></Field>
        </div>
      </Modal>

      {/* Assignees modal */}
      <Modal open={showAssignModal} onClose={() => !savingAssign && setShowAssignModal(false)} title="Manage Assignees" size="sm"
        footer={<>
          <button className="btn" onClick={() => setShowAssignModal(false)} disabled={savingAssign}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAssignees} disabled={savingAssign}>{savingAssign ? 'Saving…' : 'Save'}</button>
        </>}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Click to toggle assignees. Multiple people can be assigned.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allUsers.map(u => {
            const sel = selectedAssignees.has(u.id)
            return (
              <button key={u.id} type="button"
                onClick={() => {
                  setSelectedAssignees(prev => {
                    const n = new Set(prev)
                    if (n.has(u.id)) n.delete(u.id); else n.add(u.id)
                    return n
                  })
                }}
                style={{
                  padding: '5px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (sel ? 'var(--accent)' : 'var(--border)'),
                  background: sel ? 'var(--accent)' : 'var(--surface)',
                  color: sel ? 'white' : 'var(--text)'
                }}>
                {u.full_name}
              </button>
            )
          })}
        </div>
      </Modal>

      {/* Quote modal (Step 3) */}
      <Modal open={!!quoteModal} onClose={() => !savingQuote && setQuoteModal(null)}
        title={quoteModal?._id ? 'Edit quote' : 'Add quote'} size="md"
        footer={<>
          <button className="btn" onClick={() => setQuoteModal(null)} disabled={savingQuote}>Cancel</button>
          <button className="btn btn-primary" onClick={saveQuote} disabled={savingQuote}>
            {savingQuote ? 'Saving…' : 'Save quote'}
          </button>
        </>}>
        {quoteModal && (
          <div className="form-grid">
            {/* Vendor picker. Radio for kind, then the appropriate input. */}
            <div className="full">
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '.04em' }}>Vendor</div>
              <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
                {[
                  { v: 'supplier',      label: 'Supplier' },
                  { v: 'subcontractor', label: 'Subcontractor' },
                  { v: 'freetext',      label: 'Not in system' },
                ].map(opt => (
                  <label key={opt.v} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="vendor_kind"
                      checked={quoteModal.vendor_kind === opt.v}
                      onChange={() => setQuoteModal(prev => ({
                        ...prev, vendor_kind: opt.v,
                        // Clear the unused fields when switching kind
                        // so we don't end up with stale supplier_id +
                        // a typed freetext name confusing the save.
                        supplier_id: opt.v === 'supplier' ? prev.supplier_id : '',
                        subcontractor_id: opt.v === 'subcontractor' ? prev.subcontractor_id : '',
                      }))} />
                    {opt.label}
                  </label>
                ))}
              </div>
              {quoteModal.vendor_kind === 'supplier' && (
                <select value={quoteModal.supplier_id} onChange={e => setQuoteModal(prev => ({ ...prev, supplier_id: e.target.value }))} style={{ width: '100%' }}>
                  <option value="">— Pick a supplier —</option>
                  {vendors.filter(v => v.kind === 'supplier').map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
              {quoteModal.vendor_kind === 'subcontractor' && (
                <select value={quoteModal.subcontractor_id} onChange={e => setQuoteModal(prev => ({ ...prev, subcontractor_id: e.target.value }))} style={{ width: '100%' }}>
                  <option value="">— Pick a subcontractor —</option>
                  {vendors.filter(v => v.kind === 'subcontractor').map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
              {quoteModal.vendor_kind === 'freetext' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Type vendor name"
                    value={quoteModal.vendor_name_text}
                    onChange={e => setQuoteModal(prev => ({ ...prev, vendor_name_text: e.target.value }))}
                    style={{ flex: 1 }} />
                  <button className="btn btn-sm" type="button"
                    onClick={createSupplierFromFreetext}
                    disabled={!quoteModal.vendor_name_text?.trim()}
                    title="Add this vendor to your Suppliers list">
                    + Create supplier
                  </button>
                </div>
              )}
            </div>

            {/* Amount + currency */}
            <Field label="Amount">
              <input type="number" min="0" step="0.01"
                value={quoteModal.amount}
                onChange={e => setQuoteModal(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="0.00" />
            </Field>
            <Field label="Currency">
              <select value={quoteModal.currency} onChange={e => setQuoteModal(prev => ({ ...prev, currency: e.target.value }))}>
                <option value="GBP">GBP £</option>
                <option value="EUR">EUR €</option>
                <option value="USD">USD $</option>
              </select>
            </Field>

            {/* Date + status */}
            <Field label="Received date">
              <input type="date" value={quoteModal.received_date}
                onChange={e => setQuoteModal(prev => ({ ...prev, received_date: e.target.value }))} />
            </Field>
            <Field label="Status">
              <select value={quoteModal.status} onChange={e => setQuoteModal(prev => ({ ...prev, status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
              </select>
            </Field>

            {/* Attached file (only quote-category files for this task) */}
            <div className="full">
              <Field label="Attached PDF (optional)">
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={quoteModal.task_file_id}
                    onChange={e => setQuoteModal(prev => ({ ...prev, task_file_id: e.target.value }))}
                    style={{ flex: 1 }}>
                    <option value="">— None —</option>
                    {files.filter(f => f.category === 'quote').map(f => (
                      <option key={f.id} value={f.id}>{f.file_name}</option>
                    ))}
                  </select>
                  {quoteModal.task_file_id && (
                    <button className="btn btn-sm" type="button"
                      onClick={() => extractQuoteFromFile({ task_file_id: quoteModal.task_file_id })}
                      disabled={extractingQuote || savingQuote}
                      title="Use AI to read the PDF and fill in vendor, amount, date, notes">
                      {extractingQuote ? '⚙ Scanning…' : '✨ Extract from PDF'}
                    </button>
                  )}
                </div>
              </Field>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                Only files in the Quotes category appear here. Upload a quote PDF first if you want to link it.
              </div>
            </div>

            {/* AI extraction summary banner */}
            {quoteModal._aiFilled && Object.values(quoteModal._aiFilled).some(Boolean) && (
              <div className="full" style={{
                background: '#E6F1FB', color: '#0C447C',
                padding: 10, borderRadius: 4, fontSize: 11,
                borderLeft: '3px solid #185FA5',
              }}>
                <strong>✨ AI auto-filled some fields</strong>
                {quoteModal._aiConfidence && (
                  <span style={{ marginLeft: 6, opacity: 0.85 }}>(confidence: {quoteModal._aiConfidence})</span>
                )}
                <div style={{ marginTop: 2 }}>Review the highlighted fields and adjust before saving.</div>
              </div>
            )}

            {/* Notes */}
            <div className="full">
              <Field label={
                <span>Notes {quoteModal._aiFilled?.notes && <span style={{ background: '#E6F1FB', color: '#0C447C', fontSize: 9, padding: '1px 6px', borderRadius: 99, marginLeft: 4 }}>AI</span>}</span>
              }>
                <textarea value={quoteModal.notes}
                  onChange={e => setQuoteModal(prev => ({ ...prev, notes: e.target.value, _aiFilled: prev._aiFilled ? { ...prev._aiFilled, notes: false } : undefined }))}
                  placeholder="What's included, exclusions, validity period, etc."
                  style={{ minHeight: 60 }} />
              </Field>
            </div>

            {/* Auto-reject hint */}
            {quoteModal.status === 'accepted' && quotes.filter(q => q.id !== quoteModal._id && (q.status === 'pending' || q.status === 'expired')).length > 0 && (
              <div className="full" style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--surface2)', padding: 8, borderRadius: 4, marginTop: -4 }}>
                ℹ Marking this quote Accepted will automatically reject{' '}
                {quotes.filter(q => q.id !== quoteModal._id && (q.status === 'pending' || q.status === 'expired')).length}{' '}
                other pending quote(s) on this task.
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={deleteTask} title="Delete task" message="Permanently delete this task along with all its notes, files, and activity log?" danger />

      {/* EML preview overlay */}
      {/* Drag-and-drop overlay */}
      {dragOver && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(33, 70, 22, 0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            border: '3px dashed white', borderRadius: 12,
            padding: '40px 60px', textAlign: 'center', color: 'white',
          }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📥</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Drop to upload</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              Files will be auto-categorised. Single quote PDFs are scanned by AI.
            </div>
          </div>
        </div>
      )}

      {emlPreview && <EmlViewer file={emlPreview.file} parsed={emlPreview.parsed} onClose={() => setEmlPreview(null)} />}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────

// File category metadata. Order here defines display order in the
// categorised view. Keep this list in sync with the CHECK constraint
// on task_files.category in step1-schema.sql.
const CATEGORIES = [
  { value: 'quote',   label: 'Quotes',   icon: '💷', emptyLabel: 'No quotes attached.' },
  { value: 'drawing', label: 'Drawings', icon: '📐', emptyLabel: 'No drawings attached.' },
  { value: 'photo',   label: 'Photos',   icon: '📷', emptyLabel: 'No photos attached.' },
  { value: 'email',   label: 'Emails',   icon: '✉️', emptyLabel: 'No emails attached.' },
  { value: 'other',   label: 'Other',    icon: '📁', emptyLabel: 'No other files attached.' },
]

// Detect a sensible initial category from filename + mime type. Mirror
// of the SQL backfill in step1-schema.sql — keep them in sync so the
// server and client agree on what's a 'quote' vs 'drawing'. Returns
// one of: quote / drawing / photo / email / other.
function detectFileCategory(fileName, mimeType) {
  const lower = (fileName || '').toLowerCase()
  const mime = (mimeType || '').toLowerCase()
  if (lower.endsWith('.eml') || mime === 'message/rfc822') return 'email'
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|heic|heif|webp|gif|bmp)$/i.test(lower)) return 'photo'
  if (/(quote|estimate|proposal|tender|offer|quotation)/i.test(lower)) return 'quote'
  if (/\.(dwg|dxf)$/i.test(lower) || /(drawing|^ga[ _-]|layout|plan|elevation|section)/i.test(lower)) return 'drawing'
  return 'other'
}

function fmtBytes(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

function formatActivityAction(a) {
  const d = a.details || {}
  switch (a.action) {
    case 'created': return `created this task (${d.priority || ''} priority)`
    case 'status_changed': return `changed status to ${(d.to || '').replace('_', ' ')}`
    case 'assigned': return `assigned ${d.user_name || 'someone'}`
    case 'unassigned': return `removed ${d.user_name || 'someone'}`
    case 'claimed': return 'claimed this task'
    case 'file_uploaded': return `uploaded ${d.file_name || 'a file'}`
    case 'quote_added': return `added a quote from ${d.vendor || 'a vendor'}${d.amount != null ? ` (£${Number(d.amount).toLocaleString('en-GB')})` : ''}`
    case 'quote_updated': return `updated the quote from ${d.vendor || 'a vendor'}${d.status ? ` (now ${d.status})` : ''}`
    case 'quote_deleted': return `deleted the quote from ${d.vendor || 'a vendor'}`
    default: return a.action
  }
}

// Simple RFC 822 email parser — handles plain text and quoted-printable.
// For complex multipart MIME with base64 attachments, we still show the raw headers + text part.
function parseEml(text) {
  const headerEnd = text.search(/\r?\n\r?\n/)
  if (headerEnd < 0) return { headers: {}, body: text }
  const headerText = text.slice(0, headerEnd)
  const body = text.slice(headerEnd).replace(/^\r?\n\r?\n/, '')

  // Parse headers (naive, but good enough)
  const headers = {}
  const lines = headerText.split(/\r?\n/)
  let current = null
  for (const line of lines) {
    if (/^\s/.test(line) && current) {
      headers[current] += ' ' + line.trim()
    } else {
      const m = line.match(/^([^:]+):\s*(.*)$/)
      if (m) {
        current = m[1].toLowerCase()
        headers[current] = m[2]
      }
    }
  }

  // Try to find text/plain or text/html body
  let displayBody = body
  const contentType = headers['content-type'] || ''
  if (contentType.includes('multipart/')) {
    const m = contentType.match(/boundary="?([^";]+)"?/)
    if (m) {
      const parts = body.split('--' + m[1])
      let plainPart = null, htmlPart = null
      for (const p of parts) {
        if (/content-type:\s*text\/plain/i.test(p)) plainPart = p
        else if (/content-type:\s*text\/html/i.test(p)) htmlPart = p
      }
      const chosen = plainPart || htmlPart || ''
      const subEnd = chosen.search(/\r?\n\r?\n/)
      displayBody = subEnd >= 0 ? chosen.slice(subEnd).replace(/^\r?\n\r?\n/, '') : chosen
    }
  }

  // Decode quoted-printable
  if (/quoted-printable/i.test(headers['content-transfer-encoding'] || '') || /quoted-printable/i.test(contentType)) {
    displayBody = displayBody
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }

  return {
    from: headers.from || '',
    to: headers.to || '',
    cc: headers.cc || '',
    subject: headers.subject || '(no subject)',
    date: headers.date || '',
    body: displayBody.trim(),
    isHtml: /content-type:\s*text\/html/i.test(contentType) && !/multipart/i.test(contentType),
  }
}

function EmlViewer({ file, parsed, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 8, maxWidth: 800, width: '100%', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>✉ {file.file_name}</div>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 14, fontSize: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>From:</strong> {parsed.from}</div>
          <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>To:</strong> {parsed.to}</div>
          {parsed.cc && <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>Cc:</strong> {parsed.cc}</div>}
          {parsed.date && <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>Date:</strong> {parsed.date}</div>}
          <div><strong style={{ color: 'var(--text3)', minWidth: 60, display: 'inline-block' }}>Subject:</strong> <span style={{ fontWeight: 600 }}>{parsed.subject}</span></div>
        </div>
        <div style={{ padding: 14, fontSize: 13, lineHeight: 1.6, flex: 1, overflow: 'auto' }}>
          {parsed.isHtml ? (
            <iframe srcDoc={parsed.body} sandbox="" style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 4, background: 'white' }} />
          ) : (
            <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{parsed.body}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
