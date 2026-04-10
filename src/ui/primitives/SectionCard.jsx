export default function SectionCard({ title, description, actions = null, className = "", children, as = "section" }) {
  const TagName = as;
  return (
    <TagName className={`panel section-card ${className}`.trim()}>
      {title || description || actions ? (
        <div className="section-heading section-card__header">
          <div className="section-card__copy">
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="section-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="section-card__body">{children}</div>
    </TagName>
  );
}
