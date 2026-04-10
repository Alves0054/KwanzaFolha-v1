export default function AuditSection({
  auditLogs = [],
  auditFilters,
  setAuditFilters,
  applyAuditFilters,
  exportAuditLogs,
  exportAuditExcel
}) {
  return (
    <section className="processing-layout">
      <div className="panel">
        <div className="section-heading">
          <h2>Filtros</h2>
          <p>Refine por utilizador, ação, período ou texto livre e exporte o resultado atual.</p>
        </div>

        <div className="grid-form audit-filters">
          <label>Utilizador
            <input value={auditFilters.userName} onChange={(event) => setAuditFilters((current) => ({ ...current, userName: event.target.value }))} />
          </label>
          <label>Ação
            <input value={auditFilters.action} onChange={(event) => setAuditFilters((current) => ({ ...current, action: event.target.value }))} />
          </label>
          <label>Período
            <input type="month" value={auditFilters.monthRef} onChange={(event) => setAuditFilters((current) => ({ ...current, monthRef: event.target.value }))} />
          </label>
          <label>Pesquisa
            <input value={auditFilters.search} onChange={(event) => setAuditFilters((current) => ({ ...current, search: event.target.value }))} />
          </label>
          <div className="inline-actions full-span">
            <button type="button" className="secondary-btn" onClick={applyAuditFilters}>Aplicar filtros</button>
            <button type="button" onClick={exportAuditLogs}>Exportar auditoria em CSV</button>
            <button type="button" className="secondary-btn" onClick={exportAuditExcel}>Exportar auditoria em Excel</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Auditoria</h2>
          <p>Histórico recente das operações mais críticas executadas no sistema.</p>
        </div>

        <div className="table-list compact">
          {auditLogs.map((item) => (
            <div className="table-row audit-row" key={item.id}>
              <div className="audit-row__content">
                <strong>{item.action}</strong>
                <small>
                  {item.user_name} - {item.entity_type}
                  {item.entity_label ? ` - ${item.entity_label}` : ""}
                  {item.month_ref ? ` - ${item.month_ref}` : ""}
                </small>
                {item.details_json?.changes && Object.keys(item.details_json.changes).length > 0 && (
                  <small className="audit-row__changes">
                    Alterações: {Object.entries(item.details_json.changes)
                      .map(([field, change]) => `${field}: ${change.before ?? "-"} -> ${change.after ?? "-"}`)
                      .join(" | ")}
                  </small>
                )}
              </div>
              <div className="payroll-values audit-row__meta">
                <span className="status-chip">{item.entity_type}</span>
                <small>{new Date(item.created_at).toLocaleString("pt-PT")}</small>
              </div>
            </div>
          ))}

          {auditLogs.length === 0 && <p className="empty-note">Sem registos de auditoria disponíveis.</p>}
        </div>
      </div>
    </section>
  );
}
