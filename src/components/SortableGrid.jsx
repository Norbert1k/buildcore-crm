import { useState, useRef } from 'react'

export default function SortableGrid({ items, onReorder, renderItem, columns = 'repeat(auto-fill, minmax(160px, 1fr))' }) {
  const [order, setOrder] = useState(() => items.map(i => i.id))
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [insertBefore, setInsertBefore] = useState(true)
  const ghostRef = useRef(null)
  const saving = useRef(false)

  // Keep order in sync when items change
  const itemIds = items.map(i => i.id).sort().join(',')
  const prevIds = useRef(itemIds)
  if (prevIds.current !== itemIds) {
    prevIds.current = itemIds
    setOrder(items.map(i => i.id))
  }

  const sortedItems = order.map(id => items.find(i => i.id === id)).filter(Boolean)

  function onDragStart(e, id) {
    e.dataTransfer.effectAllowed = 'move'
    // Create invisible ghost — keep it alive until dragend
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;'
    document.body.appendChild(ghost)
    ghostRef.current = ghost
    e.dataTransfer.setDragImage(ghost, 0, 0)
    // Small delay so browser captures the ghost image first
    requestAnimationFrame(() => setDragId(id))
  }

  function onDragOver(e, id) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (id === dragId) return
    const rect = e.currentTarget.getBoundingClientRect()
    setOverId(id)
    setInsertBefore(e.clientX < rect.left + rect.width / 2)
  }

  function onDrop(e, id) {
    e.preventDefault()
    e.stopPropagation()
    if (!dragId || dragId === id) return
    const newOrder = [...order]
    const fromIdx = newOrder.indexOf(dragId)
    newOrder.splice(fromIdx, 1)
    const insertAt = insertBefore ? newOrder.indexOf(id) : newOrder.indexOf(id) + 1
    newOrder.splice(Math.max(0, insertAt), 0, dragId)
    setOrder(newOrder)
    setDragId(null)
    setOverId(null)
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null }
    if (!saving.current) {
      saving.current = true
      Promise.resolve(onReorder(newOrder)).finally(() => { saving.current = false })
    }
  }

  function onDragEnd() {
    setDragId(null)
    setOverId(null)
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 12, padding: 4 }}>
      {sortedItems.map(item => {
        const isDragging = dragId === item.id
        const isOver = overId === item.id
        return (
          <div
            key={item.id}
            draggable
            onDragStart={e => onDragStart(e, item.id)}
            onDragOver={e => onDragOver(e, item.id)}
            onDrop={e => onDrop(e, item.id)}
            onDragEnd={onDragEnd}
            style={{
              position: 'relative',
              opacity: isDragging ? 0.25 : 1,
              transform: isOver ? `translateX(${insertBefore ? 12 : -12}px)` : 'none',
              transition: isDragging ? 'opacity 0.1s' : 'transform 0.12s ease, opacity 0.1s',
              cursor: isDragging ? 'grabbing' : 'grab',
              zIndex: isDragging ? 0 : 1,
            }}
          >
            {isOver && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                [insertBefore ? 'left' : 'right']: -3,
                width: 3, background: '#378ADD', borderRadius: 2,
                zIndex: 30, pointerEvents: 'none',
              }} />
            )}
            {renderItem(item, isDragging)}
          </div>
        )
      })}
    </div>
  )
}
