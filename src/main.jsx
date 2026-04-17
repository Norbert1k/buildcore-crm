import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './lib/auth.jsx'

// Apply saved theme immediately before React renders — prevents white flash
const savedTheme = localStorage.getItem('theme') || 'light'
document.documentElement.setAttribute('data-theme', savedTheme)

// Prevent Backspace from navigating browser-back when NOT inside a text input.
// This fixes the bug where pressing Backspace in a modal closes it via browser history.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    const tag = e.target.tagName
    const editable = e.target.isContentEditable
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || editable
    // If Backspace is pressed and the target is not an editable element, prevent navigation
    if (!isInput) {
      e.preventDefault()
    }
    // Also prevent it for read-only inputs
    if (tag === 'INPUT' && (e.target.readOnly || e.target.disabled)) {
      e.preventDefault()
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <App />
  </AuthProvider>
)
