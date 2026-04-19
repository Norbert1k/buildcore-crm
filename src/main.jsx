import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Apply saved theme immediately before React renders — prevents white flash
const savedTheme = localStorage.getItem('theme') || 'light'
document.documentElement.setAttribute('data-theme', savedTheme)

// Prevent Backspace from navigating browser-back when NOT inside a text input.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    const tag = e.target.tagName
    const editable = e.target.isContentEditable
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || editable
    if (!isInput) {
      e.preventDefault()
    }
    if (tag === 'INPUT' && (e.target.readOnly || e.target.disabled)) {
      e.preventDefault()
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
