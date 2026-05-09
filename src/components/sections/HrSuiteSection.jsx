import { useMemo, useState } from "react";

const areaLabels = {
  recruitment: "Recrutamento",
  lifecycle: "Lifecycle",
  self_service: "Self-service",
  performance: "Desempenho",
  training: "Formação",
  workflow: "Workflows",
  compliance: "Compliance",
  wellbeing: "Bem-estar",
  assets: "Ativos",
  disciplinary: "Disciplina",
  succession: "Sucessao",
  analytics: "Analytics",
  other: "Outro"
};

const statusLabels = {
  planned: "Planeado",
  in_progress: "Em andamento",
  blocked: "Bloqueado",
  done: "Concluido",
  cancelled: "Cancelado"
};

const priorityLabels = {
  high: "Alta",
  medium: "Media",
  low: "Baixa"
};

const emptyForm = {
  id: null,
  area: "recruitment",
  title: "",
  owner: "",
  status: "planned",
  priority: "medium",
  due_date: "",
  employee_id: "",
  workflow_stage: "",
  approval_role: "",
  attachment_file_path: "",
  attachment_name: "",
  notes: ""
};

function getStatusTone(status) {
  if (status === "done") return "success";
  if (status === "blocked" || status === "cancelled") return "danger";
  if (status === "in_progress") return "warning";
  return "info";
}

export default function HrSuiteSection({
  employees = [],
  items = [],
  saveItem,
  deleteItem,
  openAttachment,
  chooseAttachment,
  exportExcel,
}) {
  const [form, setForm] = useState(emptyForm);
  const [activeArea, setActiveArea] = useState("todos");
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesArea = activeArea === "todos" || item.area === activeArea;
      const matchesSearch =
        !normalizedSearch ||
        [item.title, item.owner, item.notes, item.employee_name, item.workflow_stage, item.approval_role]
          .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
      return matchesArea && matchesSearch;
    });
  }, [activeArea, items, search]);

  const metrics = useMemo(() => {
    const total = items.length;
    const completed = items.filter((item) => item.status === "done").length;
    const blocked = items.filter((item) => item.status === "blocked").length;
    const highPriority = items.filter((item) => item.priority === "high" && item.status !== "done").length;
    const activeAreas = new Set(items.map((item) => item.area).filter(Boolean)).size;
    return {
      total,
      completed,
      blocked,
      highPriority,
      employees: employees.length,
      activeAreas
    };
  }, [employees.length, items]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitForm(event) {
    event.preventDefault();
    const result = await saveItem?.({
      ...form,
      title: form.title.trim(),
      owner: form.owner.trim() || "RH",
      notes: form.notes.trim()
    });
    if (result?.ok) {
      setForm(emptyForm);
    }
  }

  function editItem(item) {
    setForm({
      ...emptyForm,
      ...item,
      employee_id: item.employee_id ? String(item.employee_id) : "",
      attachment_file_path: "",
      attachment_name: item.attachment_name || ""
    });
  }

  async function attachFile() {
    const filePath = await chooseAttachment?.();
    if (filePath) {
      updateForm("attachment_file_path", filePath);
    }
  }

  async function advanceStatus(item) {
    const flow = ["planned", "in_progress", "done"];
    const index = flow.indexOf(item.status);
    const status = item.status === "blocked" ? "in_progress" : flow[Math.min(index + 1, flow.length - 1)] || "in_progress";
    await saveItem?.({ ...item, status, attachment_file_path: "" });
  }

  async function toggleBlocked(item) {
    await saveItem?.({ ...item, status: item.status === "blocked" ? "in_progress" : "blocked", attachment_file_path: "" });
  }

  const areas = ["todos", ...Object.keys(areaLabels)];

  return (
    <section className="hr-suite section-stack">
      <div className="stat-grid hr-suite__metrics">
        <div className="stat-card">
          <span>Colaboradores</span>
          <strong>{metrics.employees}</strong>
          <small>Base atual do RH</small>
        </div>
        <div className="stat-card">
          <span>Registos RH</span>
          <strong>{metrics.total}</strong>
          <small>{metrics.highPriority} prioridade alta</small>
        </div>
        <div className="stat-card">
          <span>Concluidos</span>
          <strong>{metrics.completed}</strong>
          <small>{metrics.blocked} bloqueados</small>
        </div>
        <div className="stat-card">
          <span>Areas ativas</span>
          <strong>{metrics.activeAreas}</strong>
          <small>Workflows em uso</small>
        </div>
      </div>

      <section className="two-column">
        <div className="panel section-stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Roadmap operacional</span>
              <h3>Workflows RH guardados em SQLite</h3>
            </div>
            <button type="button" className="secondary-btn" onClick={() => exportExcel?.({ area: activeArea === "todos" ? "" : activeArea, search })}>
              Exportar Excel
            </button>
          </div>

          <label className="topbar-control">
            <span>Pesquisar</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Titulo, responsavel, colaborador" />
          </label>

          <div className="hr-suite__tabs" role="group" aria-label="Filtrar area de RH">
            {areas.map((area) => (
              <button
                key={area}
                type="button"
                className={activeArea === area ? "secondary-btn active-theme" : "secondary-btn"}
                onClick={() => setActiveArea(area)}
              >
                {area === "todos" ? "Todas" : areaLabels[area]}
              </button>
            ))}
          </div>

          <div className="hr-suite__pipeline">
            {filteredItems.map((item) => (
              <article key={item.id} className="hr-suite__initiative">
                <div>
                  <span className="status-chip status-chip--info">{areaLabels[item.area] || item.area}</span>
                  <h4>{item.title}</h4>
                  <p>{item.notes || "Sem notas adicionais."}</p>
                  <small>
                    Responsável: {item.owner || "RH"} {item.due_date ? `- Prazo: ${item.due_date}` : ""}
                    {item.employee_name ? ` - Colaborador: ${item.employee_name}` : ""}
                  </small>
                  {item.attachment_name && (
                    <button type="button" className="link-btn document-file-chip" disabled={!item.attachment_exists} onClick={() => openAttachment?.(item.id)}>
                      Anexo: {item.attachment_name}
                    </button>
                  )}
                </div>
                <div className="hr-suite__initiative-actions">
                  <span className={`status-chip status-chip--${getStatusTone(item.status)}`}>
                    {statusLabels[item.status] || item.status}
                  </span>
                  <span className="status-chip status-chip--neutral">
                    {priorityLabels[item.priority] || item.priority}
                  </span>
                  <button type="button" className="link-btn" onClick={() => editItem(item)}>
                    Editar
                  </button>
                  <button type="button" className="link-btn" onClick={() => advanceStatus(item)}>
                    Avancar
                  </button>
                  <button type="button" className="link-btn" onClick={() => toggleBlocked(item)}>
                    {item.status === "blocked" ? "Desbloquear" : "Bloquear"}
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => deleteItem?.(item.id)}>
                    Remover
                  </button>
                </div>
              </article>
            ))}
            {!filteredItems.length && (
              <div className="empty-state">
                <strong>Sem registos RH 360 para este filtro.</strong>
                <small>Crie o primeiro workflow no formulario ao lado.</small>
              </div>
            )}
          </div>
        </div>

        <form className="panel grid-form settings-form" onSubmit={submitForm}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Workflow com auditoria</span>
              <h3>{form.id ? "Editar registo RH" : "Adicionar capacidade de RH"}</h3>
            </div>
          </div>

          <label>
            Area
            <select value={form.area} onChange={(event) => updateForm("area", event.target.value)}>
              {Object.entries(areaLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Titulo
            <input value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="Ex.: Portal do colaborador" />
          </label>

          <label>
            Responsável
            <input value={form.owner} onChange={(event) => updateForm("owner", event.target.value)} placeholder="RH, Gestor, Juridico" />
          </label>

          <label>
            Colaborador
            <select value={form.employee_id || ""} onChange={(event) => updateForm("employee_id", event.target.value)}>
              <option value="">Sem associar</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>

          <label>
            Estado
            <select value={form.status} onChange={(event) => updateForm("status", event.target.value)}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Prioridade
            <select value={form.priority} onChange={(event) => updateForm("priority", event.target.value)}>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Prazo
            <input type="date" value={form.due_date || ""} onChange={(event) => updateForm("due_date", event.target.value)} />
          </label>

          <label>
            Etapa
            <input value={form.workflow_stage || ""} onChange={(event) => updateForm("workflow_stage", event.target.value)} placeholder="Ex.: Validacao juridica" />
          </label>

          <label>
            Perfil aprovador
            <input value={form.approval_role || ""} onChange={(event) => updateForm("approval_role", event.target.value)} placeholder="Ex.: Administracao" />
          </label>

          <label className="full-span">
            Notas
            <textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} rows={4} />
          </label>

          <div className="form-actions full-span">
            <button type="button" className="secondary-btn" onClick={attachFile}>
              {form.attachment_file_path || form.attachment_name ? "Trocar anexo" : "Selecionar anexo"}
            </button>
            <span className="document-file-chip">
              {form.attachment_file_path || form.attachment_name || "Nenhum anexo selecionado"}
            </span>
          </div>

          <div className="form-actions full-span">
            <button type="button" className="secondary-btn" onClick={() => setForm(emptyForm)}>
              Limpar
            </button>
            <button type="submit">{form.id ? "Atualizar workflow" : "Guardar workflow"}</button>
          </div>
        </form>
      </section>
    </section>
  );
}
