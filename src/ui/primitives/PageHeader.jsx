import AppIcon from "../../components/AppIcon";

export default function PageHeader({
  icon,
  eyebrow = "Módulo de trabalho",
  title,
  description,
  meta = null,
  actions = null,
  compact = false
}) {
  return (
    <section className={`page-intro page-header ${actions ? "page-intro--with-actions" : "page-intro--compact"}${compact ? " page-header--compact" : ""}`}>
      <div className="page-intro__copy">
        <span className="topbar-eyebrow">
          {icon ? <AppIcon name={icon} size={14} /> : null}
          {eyebrow}
        </span>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
        {meta ? <div className="topbar-meta page-intro__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-intro__actions">{actions}</div> : null}
    </section>
  );
}
