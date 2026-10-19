// Browser wrapper for the CCG O&M renderer: supplies the house stylesheet and logos.
import OM_CSS from './omStyle.css?raw'
import OM_TENANT_CSS from './omTenant.css?raw'
import logoWhite from '../assets/om/logo_white.png'
import logoDark from '../assets/om/logo_dark.png'
import { renderOmHtml as core } from './omRenderCore'
export { clean, resolveTokens } from './omRenderCore'

// Carlito (Calibri-compatible) is already self-hosted for the app; the preview
// iframe needs absolute URLs to reach it.
const fontCss = () => {
  const o = typeof window !== 'undefined' ? window.location.origin : ''
  return `@font-face{font-family:'Carlito';font-weight:400;src:url(${o}/fonts/carlito-latin-400-normal.woff2) format('woff2')}` +
         `@font-face{font-family:'Carlito';font-weight:700;src:url(${o}/fonts/carlito-latin-700-normal.woff2) format('woff2')}`
}
export function renderOmHtml(input, opts = {}) {
  return core(input, { ...opts, css: fontCss() + OM_CSS, tenantCss: OM_TENANT_CSS, logoWhite, logoDark })
}
