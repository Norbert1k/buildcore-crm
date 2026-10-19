import { createClient } from '@supabase/supabase-js'

// Public values — the URL and anon key are sent to every browser that opens the CRM,
// so they are safe in code. Data is protected by Supabase RLS, not by hiding these.
// Vercel's VITE_ variables still win where they are set (Production).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tjelbvoeciklpfvapxvn.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZWxidm9lY2lrbHBmdmFweHZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg2OTcsImV4cCI6MjA5MDkwNDY5N30.icQDAlq76Rv36OMyqCVXa3mrpD5rLj8pHSeKtVvOvzY'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
