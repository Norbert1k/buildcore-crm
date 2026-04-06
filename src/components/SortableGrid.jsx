import { useState, useRef, useEffect } from 'react'

export default function SortableGrid({ items, onReorder, renderItem, columns = 'repeat(auto-fill, minmax(160px, 1fr))' }) {
  const [order, setOrder] = useState(items.map(i => i.id))
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [insertBefore, setInsertBefore] = useState(true)
  const saving = useRef(false)

  // Sync order when items change externally
  useEffect(() => {
    setOrder(items.map(i => i.id))
  }, [items.map(i => i.id).join(',')])

  const sortedItems = order.map(id => items.find(i => i.id === id)).filter(Boolean)

  function onDragStart(e, id) {
    e.dataTransfer.effectAllowed = 'move'
    // Use a 1x1 transparent image as drag ghost to hide browser default
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-999px;width:1px;height:1px;'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
    setDragId(id)
  }

  function onDragOver(e, id) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id === dragId) return
    const rect = e.currentTarget.getBoundingClientRect()
    setOverId(id)
    setInsertBefore(e.clientX < rect.left + rect.width / 2)
  }

  function onDrop(e, id) {
    e.preventDefault()
    if (!dragId || dragId === id) return
    const newOrder = [...order]
    const fromIdx = newOrder.indexOf(dragId)
    const toIdx = newOrder.indexOf(id)
    newOrder.splice(fromIdx, 1)
    const insertAt = insertBefore ? newOrder.indexOf(id) : newOrder.indexOf(id) + 1
    newOrder.splice(insertAt, 0, dragId)
    setOrder(newOrder)
    setDragId(null)
    setOverId(null)
    // Save to DB
    if (!saving.current) {
      saving.current = true
      onReorder(newOrder).finally(() => { saving.current = false })
    }
  }

  function onDragEnd() {
    setDragId(null)
    setOverId(null)
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
              opacity: isDragging ? 0.3 : 1,
              transform: isOver ? `translateX(${insertBefore ? 10 : -10}px)` : 'none',
              transition: isDragging ? 'none' : 'transform 0.15s ease, opacity 0.15s ease',
              cursor: 'grab',
            }}
          >
            {/* Blue insert line */}
            {isOver && (
              <div style={{
                position: 'absolute',
                top: 0, bottom: 0,
                [insertBefore ? 'left' : 'right']: -2,
                width: 3,
                background: '#378ADD',
                borderRadius: 2,
                zIndex: 20,
                pointerEvents: 'none',
              }} />
            )}
            {renderItem(item, isDragging)}
          </div>
        )
      })}
    </div>
  )
}
