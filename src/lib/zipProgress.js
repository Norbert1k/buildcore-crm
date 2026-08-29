// Minimal shared progress overlay for zip downloads. Imperative on purpose —
// callable from any component's zip loop with three lines and no state
// plumbing. One singleton overlay; safe to call repeatedly.
//
//   zipProgressShow('Preparing zip')
//   zipProgressUpdate({ current, total, fileName })          // download loop
//   zipProgressUpdate({ percent, label: 'Compressing zip' }) // generateAsync meta
//   zipProgressHide()

let el = null
let hideTimer = null

function arm() {
  // Auto-hide 120s after the last activity — belt-and-braces so an unhandled
  // error in a zip flow can never leave the overlay stuck on screen.
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => zipProgressHide(), 120000)
}

function ensure() {
  if (el) return el
  el = document.createElement('div')
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;'
  el.innerHTML = `
    <div style="background:var(--surface,#fff);border:0.5px solid var(--border,#ddd);border-radius:10px;padding:24px 28px;min-width:320px;max-width:440px;font-family:inherit">
      <div data-zp="label" style="font-size:13px;font-weight:600;color:var(--text,#111);margin-bottom:12px">Preparing zip</div>
      <div data-zp="count" style="font-size:11px;color:var(--text3,#888);margin-bottom:4px"></div>
      <div style="height:6px;background:var(--surface2,#eee);border-radius:3px;overflow:hidden">
        <div data-zp="bar" style="width:0%;height:100%;background:#448a40;transition:width .2s"></div>
      </div>
      <div data-zp="file" style="font-size:10px;color:var(--text3,#888);margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
    </div>`
  return el
}

export function zipProgressShow(label = 'Preparing zip') {
  const node = ensure()
  node.querySelector('[data-zp="label"]').textContent = label
  node.querySelector('[data-zp="count"]').textContent = ''
  node.querySelector('[data-zp="bar"]').style.width = '0%'
  node.querySelector('[data-zp="file"]').textContent = ''
  if (!node.parentNode) document.body.appendChild(node)
  arm()
}

export function zipProgressUpdate({ current, total, fileName, percent, label } = {}) {
  const node = ensure()
  if (!node.parentNode) document.body.appendChild(node)
  if (label) node.querySelector('[data-zp="label"]').textContent = label
  if (percent != null) {
    node.querySelector('[data-zp="count"]').textContent = `Compressing… ${Math.round(percent)}%`
    node.querySelector('[data-zp="bar"]').style.width = Math.round(percent) + '%'
  } else if (total > 0) {
    node.querySelector('[data-zp="count"]').textContent = `Downloading file ${current} of ${total}`
    node.querySelector('[data-zp="bar"]').style.width = Math.round((current / total) * 100) + '%'
  }
  node.querySelector('[data-zp="file"]').textContent = fileName || ''
  arm()
}

export function zipProgressHide() {
  if (el && el.parentNode) el.parentNode.removeChild(el)
}
