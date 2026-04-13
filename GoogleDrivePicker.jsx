// SortableGrid - placeholder, reorder disabled for now
export default function SortableGrid({ items, renderItem, columns = 'repeat(auto-fill, minmax(160px, 1fr))' }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 12, padding: 4 }}>
      {items.map(item => (
        <div key={item.id} style={{ position: 'relative' }}>
          {renderItem(item, false)}
        </div>
      ))}
    </div>
  )
}
