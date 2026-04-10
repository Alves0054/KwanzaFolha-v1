export default function StatCard({ label, value, helper = null, className = "" }) {
  return (
    <div className={`stat-card-primitive ${className}`.trim()}>
      <label>{label}</label>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}
