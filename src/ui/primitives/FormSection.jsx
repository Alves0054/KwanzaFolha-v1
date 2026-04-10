export default function FormSection({ title, description, className = "" }) {
  return (
    <div className={`section-heading compact form-section ${className}`.trim()}>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
