import { useMemo, useState } from "react";

const moduleLabels = {
  contracts: "Contratos",
  contractAlerts: "Alertas de contratos",
  documentTemplates: "Modelos",
  documentTemplateVersions: "Versões dos modelos",
  generatedDocuments: "Documentos gerados",
  approvalWorkflows: "Fluxos de aprovação",
  approvalRequests: "Pedidos",
  approvalEvents: "Histórico de aprovações",
  recruitmentJobs: "Vagas",
  recruitmentCandidates: "Candidatos",
  onboardingProcesses: "Onboarding",
  offboardingProcesses: "Offboarding",
  performanceReviews: "Desempenho",
  trainingCourses: "Formação",
  trainingParticipants: "Participantes",
  syncOutbox: "Sincronização",
  payrollVersions: "Versões da folha",
  fiscalMaps: "Mapas fiscais"
};

const emptyForms = {
  contracts: { employee_id: "", contract_type: "Tempo indeterminado", start_date: "", end_date: "", probation_end_date: "", contract_salary: "", status: "active", notes: "" },
  documentTemplates: { template_type: "contract", name: "", body: "Contrato entre {{company.name}} e {{employee.full_name}}.", active: true },
  approvalWorkflows: { module: "vacation", name: "", steps_json: [{ role: "gestor", action: "approve" }], active: true },
  approvalRequests: { module: "payroll", entity_type: "payroll_run", entity_id: "", reason: "", payload_json: {} },
  recruitmentJobs: { title: "", description: "", status: "open", openings: 1, opened_at: "" },
  recruitmentCandidates: { job_id: "", full_name: "", email: "", phone: "", stage: "new", notes: "" },
  onboardingProcesses: { employee_id: "", status: "pending", start_date: new Date().toISOString().slice(0, 10), due_date: "", completed_at: "", checklist_json: [{ label: "Contrato assinado", done: false }], notes: "" },
  offboardingProcesses: { employee_id: "", exit_type: "demissao", status: "pending", exit_date: new Date().toISOString().slice(0, 10), final_calculation_json: {}, checklist_json: [{ label: "Equipamentos devolvidos", done: false }], notes: "" },
  performanceReviews: { employee_id: "", review_period: new Date().toISOString().slice(0, 7), review_type: "monthly", score: 0, feedback: "", improvement_plan: "", status: "draft" },
  trainingCourses: { title: "", provider: "", training_type: "internal", start_date: "", end_date: "", cost: 0, status: "planned", notes: "" },
  trainingParticipants: { course_id: "", employee_id: "", attendance_status: "registered", evaluation_score: 0, notes: "" }
};

const editableModules = Object.keys(emptyForms);

const statusLabels = {
  open: "Aberto",
  closed: "Fechado",
  active: "Ativo",
  expired: "Expirado",
  renewed: "Renovado",
  terminated: "Terminado",
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
  completed: "Concluído",
  new: "Novo",
  screening: "Triagem",
  interview: "Entrevista",
  hired: "Contratado",
  converted: "Convertido",
  draft: "Rascunho",
  planned: "Planeado",
  registered: "Inscrito",
  submitted: "Submetido",
  accepted: "Aceite",
  failed: "Falhado",
  synced: "Sincronizado"
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getRows(modules, activeModule) {
  if (activeModule === "contractAlerts") return Array.isArray(modules?.contractAlerts?.items) ? modules.contractAlerts.items : [];
  return Array.isArray(modules?.[activeModule]) ? modules[activeModule] : [];
}

function rowTitle(row) {
  return row.row_label || row.name || row.title || row.full_name || row.employee_name || row.message || row.month_ref || `#${row.id}`;
}

function rowSubtitle(row) {
  return [
    statusLabels[String(row.status || row.stage || "").toLowerCase()] || row.status || row.stage,
    row.employee_name,
    row.job_title,
    row.review_period,
    row.map_type,
    row.version_number ? `v${row.version_number}` : "",
    row.due_date,
    row.created_at || row.updated_at
  ].filter(Boolean).join(" | ");
}

function statusLabel(value) {
  return statusLabels[String(value || "").toLowerCase()] || value || "registo";
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["open", "active", "approved", "accepted", "completed", "hired", "converted", "synced"].includes(normalized)) return "success";
  if (["pending", "new", "screening", "interview", "draft", "planned", "registered", "submitted"].includes(normalized)) return "warning";
  if (["closed", "expired", "terminated", "rejected", "cancelled", "failed"].includes(normalized)) return "danger";
  return "neutral";
}

export default function EnterpriseSuiteSection({
  modules = {},
  employees = [],
  monthRef,
  exportExecutiveSummary,
  saveRecord,
  deleteRecord,
  refreshModules,
  generateContractDocument,
  transitionContract,
  createPayrollVersion,
  exportPayrollVersionComparison,
  buildFinalFiscalMap,
  updateFiscalMapStatus,
  transitionApprovalRequest,
  convertCandidateToEmployee,
  markSyncEvent,
  retryFailedSyncEvents,
  exportSyncPackage,
  chooseEmployeeImportFile,
  importEmployeesFile,
  exportEmployeesExcel
}) {
  const [activeModule, setActiveModule] = useState("contracts");
  const [forms, setForms] = useState(emptyForms);
  const [search, setSearch] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [contractId, setContractId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [importPath, setImportPath] = useState("");
  const [conversionForm, setConversionForm] = useState({
    bi: "",
    nif: "",
    social_security_number: "",
    base_salary: "",
    hire_date: today(),
    iban: "",
    bank_code: "",
    bank_account: "",
    contract_type: "Indeterminado",
    contract_end_date: "",
    probation_end_date: ""
  });

  const rows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return getRows(modules, activeModule).filter((row) => !normalized || rowTitle(row).toLowerCase().includes(normalized) || rowSubtitle(row).toLowerCase().includes(normalized));
  }, [activeModule, modules, search]);

  const form = forms[activeModule] || {};
  const editable = editableModules.includes(activeModule);

  function updateForm(field, value) {
    setForms((current) => ({ ...current, [activeModule]: { ...current[activeModule], [field]: value } }));
  }

  function updateConversion(field, value) {
    setConversionForm((current) => ({ ...current, [field]: value }));
  }

  function editRow(row) {
    if (!editable) return;
    setForms((current) => ({
      ...current,
      [activeModule]: {
        ...current[activeModule],
        ...row,
        employee_id: row.employee_id ? String(row.employee_id) : "",
        job_id: row.job_id ? String(row.job_id) : "",
        candidate_id: row.candidate_id ? String(row.candidate_id) : "",
        course_id: row.course_id ? String(row.course_id) : "",
        entity_id: row.entity_id ? String(row.entity_id) : ""
      }
    }));
  }

  async function submitForm(event) {
    event.preventDefault();
    const result = await saveRecord?.(activeModule, form);
    if (result?.ok) {
      setForms((current) => ({ ...current, [activeModule]: emptyForms[activeModule] }));
    }
  }

  async function chooseImportFile() {
    const selected = await chooseEmployeeImportFile?.();
    if (selected) setImportPath(selected);
  }

  function renewContract(row) {
    const endDate = window.prompt("Nova data de fim do contrato (AAAA-MM-DD)", row.end_date || "");
    if (endDate !== null) transitionContract?.(row.id, "renew", { end_date: endDate });
  }

  function openCandidateRegistration(jobId = "") {
    setActiveModule("recruitmentCandidates");
    setForms((current) => ({
      ...current,
      recruitmentCandidates: {
        ...emptyForms.recruitmentCandidates,
        job_id: jobId ? String(jobId) : "",
        stage: "new"
      }
    }));
  }

  function toggleRecruitmentJob(row) {
    const isOpen = String(row.status || "").toLowerCase() === "open";
    saveRecord?.("recruitmentJobs", {
      ...row,
      status: isOpen ? "closed" : "open",
      closed_at: isOpen ? today() : "",
      opened_at: row.opened_at || today()
    });
  }

  function renderField(field, label, type = "text") {
    if (type === "employee") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Selecionar</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
          </select>
        </label>
      );
    }

    if (type === "job") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Selecionar</option>
            {(modules.recruitmentJobs || []).map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
      );
    }

    if (type === "course") {
      return (
        <label key={field}>
          {label}
          <select value={form[field] || ""} onChange={(event) => updateForm(field, event.target.value)}>
            <option value="">Selecionar</option>
            {(modules.trainingCourses || []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </label>
      );
    }

    if (type === "jobStatus") {
      const value = String(form[field] || "open").toLowerCase() === "closed" ? "closed" : "open";
      return (
        <div key={field} className="full-span enterprise-status-toggle" role="group" aria-label="Estado da vaga">
          <span>Estado da vaga</span>
          <div className="theme-switch">
            <button type="button" className={value === "open" ? "secondary-btn active-theme" : "secondary-btn"} onClick={() => updateForm(field, "open")}>Aberto</button>
            <button type="button" className={value === "closed" ? "secondary-btn active-theme" : "secondary-btn"} onClick={() => updateForm(field, "closed")}>Fechado</button>
          </div>
        </div>
      );
    }

    if (type === "textarea") {
      return (
        <label key={field} className="full-span">
          {label}
          <textarea rows={4} value={typeof form[field] === "string" ? form[field] : ""} onChange={(event) => updateForm(field, event.target.value)} />
        </label>
      );
    }

    return (
      <label key={field}>
        {label}
        <input type={type} value={form[field] ?? ""} onChange={(event) => updateForm(field, event.target.value)} />
      </label>
    );
  }

  function renderFormFields() {
    if (activeModule === "contracts") return [renderField("employee_id", "Funcionário", "employee"), renderField("contract_type", "Tipo"), renderField("start_date", "Início", "date"), renderField("end_date", "Fim", "date"), renderField("probation_end_date", "Fim da experiência", "date"), renderField("contract_salary", "Salário contratual", "number"), renderField("status", "Estado"), renderField("notes", "Observações", "textarea")];
    if (activeModule === "documentTemplates") return [renderField("template_type", "Tipo"), renderField("name", "Nome"), renderField("body", "Corpo do modelo", "textarea")];
    if (activeModule === "approvalWorkflows") return [renderField("module", "Módulo"), renderField("name", "Nome")];
    if (activeModule === "approvalRequests") return [renderField("module", "Módulo"), renderField("entity_type", "Entidade"), renderField("entity_id", "ID da entidade", "number"), renderField("reason", "Motivo", "textarea")];
    if (activeModule === "recruitmentJobs") return [renderField("title", "Título"), renderField("status", "Estado", "jobStatus"), renderField("openings", "Número de vagas", "number"), renderField("opened_at", "Abertura", "date"), renderField("description", "Descrição", "textarea")];
    if (activeModule === "recruitmentCandidates") return [renderField("job_id", "Vaga", "job"), renderField("full_name", "Nome do candidato"), renderField("email", "Email", "email"), renderField("phone", "Telefone"), renderField("stage", "Estado"), renderField("notes", "Notas", "textarea")];
    if (activeModule === "onboardingProcesses") return [renderField("employee_id", "Funcionário", "employee"), renderField("status", "Estado"), renderField("start_date", "Início", "date"), renderField("due_date", "Limite", "date"), renderField("completed_at", "Conclusão", "date"), renderField("notes", "Notas", "textarea")];
    if (activeModule === "offboardingProcesses") return [renderField("employee_id", "Funcionário", "employee"), renderField("exit_type", "Tipo de saída"), renderField("status", "Estado"), renderField("exit_date", "Data de saída", "date"), renderField("notes", "Notas", "textarea")];
    if (activeModule === "performanceReviews") return [renderField("employee_id", "Funcionário", "employee"), renderField("review_period", "Período", "month"), renderField("review_type", "Tipo"), renderField("score", "Pontuação", "number"), renderField("status", "Estado"), renderField("feedback", "Feedback", "textarea"), renderField("improvement_plan", "Plano de melhoria", "textarea")];
    if (activeModule === "trainingCourses") return [renderField("title", "Título"), renderField("provider", "Fornecedor"), renderField("training_type", "Tipo"), renderField("start_date", "Início", "date"), renderField("end_date", "Fim", "date"), renderField("cost", "Custo", "number"), renderField("status", "Estado"), renderField("notes", "Notas", "textarea")];
    if (activeModule === "trainingParticipants") return [renderField("course_id", "Formação", "course"), renderField("employee_id", "Funcionário", "employee"), renderField("attendance_status", "Presença"), renderField("evaluation_score", "Avaliação", "number"), renderField("notes", "Notas", "textarea")];
    return null;
  }

  return (
    <section className="enterprise-suite section-stack">
      <div className="stat-grid">
        <div className="stat-card"><span>Contratos</span><strong>{modules.executiveSummary?.contracts?.active ?? modules.contracts?.length ?? 0}</strong><small>{modules.executiveSummary?.contracts?.alerts ?? 0} alerta(s)</small></div>
        <div className="stat-card"><span>Recrutamento</span><strong>{modules.executiveSummary?.recruitment?.candidates ?? modules.recruitmentCandidates?.length ?? 0}</strong><small>{modules.executiveSummary?.recruitment?.openJobs ?? modules.recruitmentJobs?.length ?? 0} vaga(s)</small></div>
        <div className="stat-card"><span>On/Offboarding</span><strong>{(modules.executiveSummary?.lifecycle?.onboardingPending || 0) + (modules.executiveSummary?.lifecycle?.offboardingPending || 0)}</strong><small>Processos pendentes</small></div>
        <div className="stat-card"><span>Sync pendente</span><strong>{modules.executiveSummary?.sync?.pending ?? modules.syncOutbox?.filter((item) => item.status === "pending").length ?? 0}</strong><small>{modules.executiveSummary?.sync?.failed ?? 0} falhado(s)</small></div>
      </div>

      <div className="panel section-stack enterprise-list-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Módulos empresariais</span>
            <h3>{moduleLabels[activeModule]}</h3>
          </div>
          <div className="inline-actions">
            <button type="button" className="secondary-btn" onClick={() => refreshModules?.()}>Atualizar</button>
            <button type="button" className="secondary-btn" onClick={() => exportExecutiveSummary?.()}>Exportar resumo</button>
          </div>
        </div>

        <div className="hr-suite__tabs enterprise-tabs" role="group" aria-label="Módulos empresariais">
          {Object.entries(moduleLabels).map(([key, label]) => (
            <button key={key} type="button" className={activeModule === key ? "secondary-btn active-theme" : "secondary-btn"} onClick={() => setActiveModule(key)}>
              {label}
            </button>
          ))}
        </div>

        <label className="topbar-control enterprise-search">
          <span>Pesquisar</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, estado, período" />
        </label>

        <div className="table-list compact enterprise-table-list">
          {rows.map((row) => (
            <div className="table-row enterprise-row" key={row.id || row.global_id || `${activeModule}-${row.alert_type || row.month_ref}-${row.employee_id || row.version_number}-${row.due_date || ""}`}>
              <div><strong>{rowTitle(row)}</strong><small>{rowSubtitle(row)}</small></div>
              <div><span className={`status-chip status-chip--${statusTone(row.status || row.stage || row.map_type)}`}>{statusLabel(row.status || row.stage || row.map_type)}</span></div>
              <div className="inline-actions">
                {editable && <button type="button" className="link-btn" onClick={() => editRow(row)}>Editar</button>}
                {editable && <button type="button" className="link-btn danger" onClick={() => deleteRecord?.(activeModule, row.id)}>Remover</button>}
                {activeModule === "contracts" && <button type="button" className="link-btn" onClick={() => renewContract(row)}>Renovar</button>}
                {activeModule === "contracts" && !["terminated", "expired"].includes(String(row.status || "").toLowerCase()) && <button type="button" className="link-btn danger" onClick={() => transitionContract?.(row.id, "terminate")}>Terminar</button>}
                {activeModule === "recruitmentJobs" && <button type="button" className="link-btn" onClick={() => toggleRecruitmentJob(row)}>{String(row.status || "").toLowerCase() === "open" ? "Fechar" : "Abrir"}</button>}
                {activeModule === "recruitmentJobs" && <button type="button" className="link-btn" onClick={() => openCandidateRegistration(row.id)}>Inscrever candidato</button>}
                {activeModule === "recruitmentCandidates" && !row.converted_employee_id && <button type="button" className="link-btn" onClick={() => setCandidateId(String(row.id))}>Converter</button>}
                {activeModule === "approvalRequests" && !["approved", "rejected", "cancelled"].includes(String(row.status || "").toLowerCase()) && <button type="button" className="link-btn" onClick={() => transitionApprovalRequest?.(row.id, "approve")}>Aprovar</button>}
                {activeModule === "approvalRequests" && !["approved", "rejected", "cancelled"].includes(String(row.status || "").toLowerCase()) && <button type="button" className="link-btn danger" onClick={() => transitionApprovalRequest?.(row.id, "reject")}>Rejeitar</button>}
                {activeModule === "approvalRequests" && ["approved", "rejected", "cancelled"].includes(String(row.status || "").toLowerCase()) && <button type="button" className="link-btn" onClick={() => transitionApprovalRequest?.(row.id, "reopen")}>Reabrir</button>}
                {activeModule === "fiscalMaps" && !["submitted", "accepted"].includes(String(row.status || "").toLowerCase()) && <button type="button" className="link-btn" onClick={() => updateFiscalMapStatus?.(row.id, "submitted")}>Submetido</button>}
                {activeModule === "fiscalMaps" && row.status === "submitted" && <button type="button" className="link-btn" onClick={() => updateFiscalMapStatus?.(row.id, "accepted")}>Aceite</button>}
                {activeModule === "fiscalMaps" && row.status === "submitted" && <button type="button" className="link-btn danger" onClick={() => updateFiscalMapStatus?.(row.id, "rejected")}>Rejeitado</button>}
                {activeModule === "syncOutbox" && row.status !== "synced" && <button type="button" className="link-btn" onClick={() => markSyncEvent?.(row.id, "synced")}>Marcar como sincronizado</button>}
              </div>
            </div>
          ))}
          {!rows.length && <div className="empty-state"><strong>Sem registos.</strong><small>{activeModule === "recruitmentCandidates" ? "Inscreva candidatos no módulo Candidatos ou a partir do botão de uma vaga aberta." : "Crie ou importe dados para este módulo."}</small></div>}
        </div>
      </div>

      <section className="two-column enterprise-workspace">
        {editable && (
          <form className="panel grid-form settings-form enterprise-form" onSubmit={submitForm}>
            <div className="section-heading full-span"><span className="eyebrow">Registo</span><h3>{moduleLabels[activeModule]}</h3></div>
            {activeModule === "recruitmentCandidates" && (
              <div className="full-span empty-note">A inscrição de candidatos é feita aqui. Escolha a vaga, preencha os dados do candidato e guarde.</div>
            )}
            {renderFormFields()}
            <div className="form-actions full-span">
              <button type="button" className="secondary-btn" onClick={() => setForms((current) => ({ ...current, [activeModule]: emptyForms[activeModule] }))}>Limpar</button>
              <button type="submit">Guardar</button>
            </div>
          </form>
        )}

        <div className="panel section-stack enterprise-operations">
          <div className="section-heading"><span className="eyebrow">Operações</span><h3>Importação, documentos, mapas e versões</h3></div>
          <div className="grid-form">
            <label className="full-span">Importar funcionários<input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="Caminho CSV/XLS/XLSX" /></label>
            <div className="form-actions full-span">
              <button type="button" className="secondary-btn" onClick={chooseImportFile}>Selecionar ficheiro</button>
              <button type="button" onClick={() => importEmployeesFile?.(importPath)}>Importar</button>
              <button type="button" className="secondary-btn" onClick={() => exportEmployeesExcel?.()}>Exportar funcionários</button>
            </div>
            <label>Contrato<select value={contractId} onChange={(event) => setContractId(event.target.value)}><option value="">Selecionar</option>{(modules.contracts || []).map((item) => <option key={item.id} value={item.id}>{rowTitle(item)}</option>)}</select></label>
            <label>Modelo<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Selecionar</option>{(modules.documentTemplates || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className="form-actions full-span">
              <button type="button" onClick={() => generateContractDocument?.(contractId, templateId)}>Gerar contrato</button>
              <button type="button" className="secondary-btn" onClick={() => createPayrollVersion?.(monthRef)}>Criar versão da folha</button>
              <button type="button" className="secondary-btn" onClick={() => exportPayrollVersionComparison?.(monthRef)}>Comparar versões</button>
              <button type="button" className="secondary-btn" onClick={() => buildFinalFiscalMap?.(monthRef, "agt")}>Mapa fiscal final</button>
              <button type="button" className="secondary-btn" onClick={() => exportSyncPackage?.("pending")}>Exportar sincronização</button>
              <button type="button" className="secondary-btn" onClick={() => retryFailedSyncEvents?.()}>Repetir sincronização</button>
            </div>
            <label className="full-span">Candidato<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Selecionar</option>{(modules.recruitmentCandidates || []).filter((item) => !item.converted_employee_id).map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
            <label>BI<input value={conversionForm.bi} onChange={(event) => updateConversion("bi", event.target.value)} /></label>
            <label>NIF<input value={conversionForm.nif} onChange={(event) => updateConversion("nif", event.target.value)} /></label>
            <label>INSS<input value={conversionForm.social_security_number} onChange={(event) => updateConversion("social_security_number", event.target.value)} /></label>
            <label>Salário base<input type="number" value={conversionForm.base_salary} onChange={(event) => updateConversion("base_salary", event.target.value)} /></label>
            <label>Admissão<input type="date" value={conversionForm.hire_date} onChange={(event) => updateConversion("hire_date", event.target.value)} /></label>
            <label>IBAN<input value={conversionForm.iban} onChange={(event) => updateConversion("iban", event.target.value)} /></label>
            <label>Banco<input value={conversionForm.bank_code} onChange={(event) => updateConversion("bank_code", event.target.value)} /></label>
            <label>Conta<input value={conversionForm.bank_account} onChange={(event) => updateConversion("bank_account", event.target.value)} /></label>
            <label>Tipo contrato<input value={conversionForm.contract_type} onChange={(event) => updateConversion("contract_type", event.target.value)} /></label>
            <label>Fim contrato<input type="date" value={conversionForm.contract_end_date} onChange={(event) => updateConversion("contract_end_date", event.target.value)} /></label>
            <div className="form-actions full-span">
              <button type="button" className="secondary-btn" onClick={() => convertCandidateToEmployee?.(candidateId, conversionForm)}>Converter candidato</button>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
