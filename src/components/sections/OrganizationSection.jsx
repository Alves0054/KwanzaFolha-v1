import { useMemo, useState } from "react";

const entityLabels = {
  companies: "Empresas",
  branches: "Filiais",
  departments: "Departamentos",
  jobPositions: "Cargos",
  costCenters: "Centros de custo"
};

const fieldConfig = {
  companies: [
    ["name", "Nome", "text"],
    ["nif", "NIF", "text"],
    ["address", "Morada", "text"],
    ["phone", "Contacto", "text"],
    ["email", "Email", "email"],
    ["logo_path", "Logotipo", "text"],
    ["fiscal_regime", "Regime fiscal", "text"],
    ["receipt_footer", "Dados para recibos", "textarea"],
    ["report_notes", "Notas para relatórios", "textarea"]
  ],
  branches: [
    ["company_id", "Empresa", "company"],
    ["name", "Nome", "text"],
    ["code", "Código", "text"],
    ["address", "Morada", "text"],
    ["manager", "Responsável", "text"],
    ["phone", "Contacto", "text"],
    ["email", "Email", "email"]
  ],
  departments: [
    ["company_id", "Empresa", "company"],
    ["branch_id", "Filial", "branch"],
    ["cost_center_id", "Centro de custo", "costCenter"],
    ["name", "Nome", "text"],
    ["code", "Código", "text"],
    ["manager", "Responsável", "text"]
  ],
  jobPositions: [
    ["company_id", "Empresa", "company"],
    ["department_id", "Departamento", "department"],
    ["name", "Cargo", "text"],
    ["professional_category", "Categoria profissional", "text"],
    ["suggested_base_salary", "Salário base sugerido", "number"],
    ["hierarchy_level", "Nível hierárquico", "number"],
    ["description", "Descrição", "textarea"]
  ],
  costCenters: [
    ["company_id", "Empresa", "company"],
    ["department_id", "Departamento", "department"],
    ["code", "Código", "text"],
    ["name", "Nome", "text"]
  ]
};

function emptyOrganization() {
  return {
    companies: [],
    branches: [],
    departments: [],
    jobPositions: [],
    costCenters: []
  };
}

function resolveEntityRows(organization, entityType) {
  return (organization || emptyOrganization())[entityType] || [];
}

function matchesSearch(item, search) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.name,
    item.code,
    item.nif,
    item.company_name,
    item.branch_name,
    item.department_name,
    item.manager,
    item.email
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
}

export default function OrganizationSection({
  organization,
  organizationForms,
  setOrganizationForms,
  saveOrganizationEntity,
  deleteOrganizationEntity,
  exportOrganizationExcel,
  formatMoney
}) {
  const [activeEntity, setActiveEntity] = useState("companies");
  const [search, setSearch] = useState("");
  const data = organization || emptyOrganization();
  const form = organizationForms[activeEntity];
  const rows = useMemo(
    () => resolveEntityRows(data, activeEntity).filter((item) => matchesSearch(item, search)),
    [activeEntity, data, search]
  );
  const totals = useMemo(() => ({
    companies: data.companies?.length || 0,
    branches: data.branches?.length || 0,
    departments: data.departments?.length || 0,
    jobPositions: data.jobPositions?.length || 0,
    costCenters: data.costCenters?.length || 0,
    employees: (data.companies || []).reduce((sum, item) => sum + Number(item.employee_count || 0), 0)
  }), [data]);

  function updateForm(field, value) {
    setOrganizationForms((current) => ({
      ...current,
      [activeEntity]: {
        ...current[activeEntity],
        [field]: value
      }
    }));
  }

  function resetForm(entityType = activeEntity) {
    setOrganizationForms((current) => ({
      ...current,
      [entityType]: {
        ...current.__initial[entityType],
        company_id: current.__initial[entityType].company_id || String(data.companies?.[0]?.id || "")
      }
    }));
  }

  function editItem(item) {
    setOrganizationForms((current) => ({
      ...current,
      [activeEntity]: {
        ...current[activeEntity],
        ...item,
        id: item.id,
        active: Boolean(item.active),
        company_id: item.company_id ? String(item.company_id) : "",
        branch_id: item.branch_id ? String(item.branch_id) : "",
        department_id: item.department_id ? String(item.department_id) : "",
        cost_center_id: item.cost_center_id ? String(item.cost_center_id) : "",
        suggested_base_salary: String(item.suggested_base_salary ?? "")
      }
    }));
  }

  async function submitForm(event) {
    event.preventDefault();
    const result = await saveOrganizationEntity?.(activeEntity, form);
    if (result?.ok) {
      resetForm(activeEntity);
    }
  }

  function renderField([field, label, type]) {
    if (type === "company") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Selecionar</option>
            {(data.companies || []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      );
    }
    if (type === "branch") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Sem filial</option>
            {(data.branches || [])
              .filter((item) => !form.company_id || Number(item.company_id) === Number(form.company_id))
              .map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>
        </label>
      );
    }
    if (type === "department") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Sem departamento</option>
            {(data.departments || [])
              .filter((item) => !form.company_id || Number(item.company_id) === Number(form.company_id))
              .map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>
        </label>
      );
    }
    if (type === "costCenter") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Sem centro</option>
            {(data.costCenters || [])
              .filter((item) => !form.company_id || Number(item.company_id) === Number(form.company_id))
              .map((item) => (
                <option key={item.id} value={item.id}>{item.code} - {item.name}</option>
              ))}
          </select>
        </label>
      );
    }
    if (type === "textarea") {
      return (
        <label key={field} className="full-span">
          {label}
          <textarea rows={3} value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)} />
        </label>
      );
    }
    return (
      <label key={field}>
        {label}
        <input type={type} value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)} />
      </label>
    );
  }

  return (
    <section className="organization section-stack">
      <div className="stat-grid">
        <div className="stat-card"><span>Empresas</span><strong>{totals.companies}</strong><small>{totals.branches} filiais</small></div>
        <div className="stat-card"><span>Departamentos</span><strong>{totals.departments}</strong><small>Organização interna</small></div>
        <div className="stat-card"><span>Cargos</span><strong>{totals.jobPositions}</strong><small>{totals.costCenters} centros de custo</small></div>
        <div className="stat-card"><span>Funcionários ligados</span><strong>{totals.employees}</strong><small>Base empresarial</small></div>
      </div>

      <section className="two-column organization-workspace">
        <div className="panel section-stack organization-list-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Estrutura empresarial</span>
              <h3>{entityLabels[activeEntity]}</h3>
            </div>
            <button type="button" className="secondary-btn" onClick={() => exportOrganizationExcel?.()}>
              Exportar Excel
            </button>
          </div>

          <label className="topbar-control">
            <span>Pesquisar</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, código, NIF, responsável" />
          </label>

          <div className="hr-suite__tabs" role="group" aria-label="Módulos de organização">
            {Object.entries(entityLabels).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={activeEntity === key ? "secondary-btn active-theme" : "secondary-btn"}
                onClick={() => setActiveEntity(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="table-list compact organization-list">
            {rows.map((item) => (
              <div className="table-row organization-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {[item.code || item.nif || item.professional_category, item.company_name, item.department_name, item.branch_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <div>
                  <span className={`status-chip ${item.active ? "status-chip--success" : "status-chip--neutral"}`}>
                    {item.active ? "Ativo" : "Inativo"}
                  </span>
                  <small>{item.employee_count || 0} funcionário(s)</small>
                </div>
                <div>
                  {item.suggested_base_salary ? <strong>{formatMoney?.(item.suggested_base_salary)}</strong> : <small>{item.manager || item.email || "-"}</small>}
                </div>
                <div className="inline-actions">
                  <button type="button" className="link-btn" onClick={() => editItem(item)}>Editar</button>
                  <button type="button" className="link-btn danger" onClick={() => deleteOrganizationEntity?.(activeEntity, item.id)}>Remover</button>
                </div>
              </div>
            ))}
            {!rows.length && (
              <div className="empty-state">
                <strong>Sem registos para este filtro.</strong>
                <small>Use o formulário para criar a primeira estrutura.</small>
              </div>
            )}
          </div>
        </div>

        <form className="panel grid-form settings-form organization-form" onSubmit={submitForm}>
          <div className="section-heading full-span">
            <div>
              <span className="eyebrow">CRUD com auditoria</span>
              <h3>{form.id ? `Editar ${entityLabels[activeEntity]}` : `Adicionar ${entityLabels[activeEntity]}`}</h3>
            </div>
          </div>

          {fieldConfig[activeEntity].map(renderField)}

          <label className="status-chip">
            <input type="checkbox" checked={Boolean(form.active)} onChange={(event) => updateForm("active", event.target.checked)} />
            Ativo
          </label>

          <div className="form-actions full-span">
            <button type="button" className="secondary-btn" onClick={() => resetForm(activeEntity)}>Limpar</button>
            <button type="submit">{form.id ? "Atualizar" : "Guardar"}</button>
          </div>
        </form>
      </section>
    </section>
  );
}
