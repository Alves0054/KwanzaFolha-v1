export default function ActionGrid({ className = "", children }) {
  return <div className={`action-grid ${className}`.trim()}>{children}</div>;
}
