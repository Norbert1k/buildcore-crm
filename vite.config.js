import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ────────────────────────────────────────────────────────────────────────────
// Vite config — code-splitting tuned for the CRM
//
// `manualChunks` groups the most-frequently-used libraries into a stable
// "vendor" bundle that doesn't change between deploys, so browsers cache it
// long-term. Without this, every deploy invalidates the entire bundle and
// users re-download React + Supabase + date-fns even if only a small part
// of the app actually changed.
//
// Each route is already lazy-loaded via React.lazy() in App.jsx, so per-page
// JS only downloads on first visit to that page.
// ────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  build: {
    rollupOptions: {
      external: [],
      output: {
        manualChunks: {
          // Core runtime — changes rarely, ideal for long-term cache
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Supabase client — changes occasionally
          'supabase-vendor': ['@supabase/supabase-js'],
          // date-fns is largish; isolate it so it can be tree-shaken better
          'date-vendor': ['date-fns'],
        },
      },
    },
    // Raise the warning threshold a bit — some lazy-loaded pages are
    // genuinely large (e.g. CffGeneratorModal with its xlsx parsing) and
    // that's fine because they only load when the user opens the modal.
    chunkSizeWarningLimit: 800,
  },
  optimizeDeps: {
    exclude: []
  }
})
