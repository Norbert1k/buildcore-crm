import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Avatar } from '../components/ui'

function initials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3)
}

function getDomain(website) {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : 'https://' + website
    return new URL(url).hostname.replace(/^www\./, '')
  } catch { return null }
}

function ClientAvatar({ name, website, color, size = 40 }) {
  const [src, setSrc] = React.useState(() => {
    if (!website) return null
    try {
      const domain = new URL(website.startsWith('http') ? website : 'https://' + website).hostname.replace(/^www\./, '')
      return `https://logo.clearbit.com/${domain}`
    } catch { return null }
  })
  const [failed, setFailed] = React.useState(false)
  const [timedOut, setTimedOut] = React.useState(false)

  React.useEffect(() => {
    if (!src) return
    const t = setTimeout(() => setTimedOut(true), 2500)
    return () => clearTimeout(t)
  }, [src])

  const showLogo = src && !failed && !timedOut
  return (
    <div style={{ width: size, height: size, borderRadius: 10, background: showLogo ? '#fff' : color.bg, border: showLogo ? '0.5px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: 700, color: color.color, flexShrink: 0, overflow: 'hidden' }}>
      {showLogo
        ? <img src={src} alt={name} onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }} />
        : initials(name)
      }
    </div>
  )
}


