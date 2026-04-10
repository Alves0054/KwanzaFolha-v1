export default function DataList({ items = [], renderItem, emptyMessage = "", compact = false, className = "" }) {
  return (
    <div className={`table-list ${compact ? "compact " : ""}${className}`.trim()}>
      {items.length > 0
        ? items.map((item, index) => renderItem(item, index))
        : emptyMessage
          ? <p className="empty-note">{emptyMessage}</p>
          : null}
    </div>
  );
}
