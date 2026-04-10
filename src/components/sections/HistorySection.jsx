import { useEffect, useMemo, useState } from "react";
import AppIcon from "../AppIcon";

const periodPresets = [
  { key: "month", label: "Mês atual" },
  { key: "week", label: "Última semana" },
  { key: "year", label: "Ano atual" },
  { key: "all", label: "Tudo" }
];

const leaveTypeOptions = [
  { value: "justified_absence", label: "Ausência justificada" },
  { value: "unjustified_absence", label: "Falta injustificada" },
  { value: "leave_with_pay", label: "Licença com vencimento" },
  { value: "leave_without_pay", label: "Licença sem vencimento" },
  { value: "medical_leave", label: "Licença médica" },
  { value: "maternity_leave", label: "Licença de maternidade" },
  { value: "paternity_leave", label: "Licença de paternidade" },
  { value: "family_leave", label: "Licença por motivo familiar" },
  { value: "other_leave", label: "Outro tipo de licença" }
];

const attendanceStatusOptions = [
  { value: "present", label: "Presente" },
  { value: "delay", label: "Atraso" },
  { value: "absent", label: "Falta" },
  { value: "half_absence", label: "Meia falta" },
  { value: "leave", label: "Licença" },
  { value: "vacation", label: "Férias" }
];

const documentCategoryOptions = [
  { value: "contract", label: "Contrato" },
  { value: "contract_addendum", label: "Adenda contratual" },
  { value: "identification", label: "Identificacao" },
  { value: "tax", label: "Fiscal" },
  { value: "social_security", label: "Seguranca Social" },
  { value: "medical", label: "Medico" },
  { value: "disciplinary", label: "Disciplinar" },
  { value: "payroll_support", label: "Suporte salarial" },
  { value: "other", label: "Outro" }
];

function formatLeaveType(value) {
  return leaveTypeOptions.find((item) => item.value === value)?.label || value;
}

function formatAttendanceStatus(value) {
  return attendanceStatusOptions.find((item) => item.value === value)?.label || value;
}

function formatVacationStatus(value) {
  switch (value) {
    case "approved":
      return "Aprovadas";
    case "rejected":
      return "Rejeitadas";
    case "taken":
      return "Gozadas";
    default:
      return "Pendentes";
  }
}

function formatFinancialType(value) {
  return value === "advance" ? "Adiantamento" : "Empréstimo";
}

function formatDocumentCategory(value) {
  return documentCategoryOptions.find((item) => item.value === value)?.label || value;
}

function formatDocumentLifecycleStatus(value) {
  switch (value) {
    case "expiring":
      return "A expirar";
    case "expired":
      return "Expirado";
    case "archived":
      return "Arquivado";
    default:
      return "Ativo";
  }
}

function getAttendanceStatusTone(value) {
  switch (value) {
    case "present":
      return "present";
    case "delay":
      return "delay";
    case "absent":
      return "absent";
    case "half_absence":
      return "half-absence";
    case "leave":
      return "leave";
    case "vacation":
      return "vacation";
    default:
      return "neutral";
  }
}

export default function HistorySection({
  boot,
  selectedEmployeeId,
  selectEmployee,
  formatMoney,
  historyFilters,
  updateHistoryPreset,
  updateHistoryFilterField,
  preferredTab = "eventos",
  onActiveTabChange = null,
  employeeDocuments,
  employeeDocumentForm,
  setEmployeeDocumentForm,
  documentFilters,
  setDocumentFilters,
  chooseEmployeeDocumentFile,
  saveEmployeeDocument,
  editEmployeeDocument,
  openEmployeeDocument,
  deleteEmployeeDocument,
  resetEmployeeDocumentForm,
  events,
  eventFilters,
  setEventFilters,
  deleteEvent,
  financialObligations,
  deleteFinancialObligation,
  leaveRequests,
  leaveFilters,
  setLeaveFilters,
  setLeaveRequestStatus,
  deleteLeaveRequest,
  attendanceRecords,
  attendanceFilters,
  setAttendanceFilters,
  attendancePeriod,
  monthRef,
  deleteAttendanceRecord,
  vacationRequests,
  vacationFilters,
  setVacationFilters,
  setVacationBalanceForm,
  setVacationForm,
  user,
  setVacationRequestStatus,
  deleteVacationRequest,
  auditLogs = [],
  auditFilters,
  setAuditFilters,
  applyAuditFilters,
  exportAuditLogs,
  exportAuditExcel
}) {
  const [activeTab, setActiveTab] = useState(preferredTab || "eventos");

  const selectedEmployee =
    boot?.employees?.find((employee) => Number(employee.id) === Number(selectedEmployeeId || 0)) || null;
  const attendancePeriodClosed = attendancePeriod?.status === "closed";
  const activeAttendanceMonthRef = attendanceFilters.monthRef || monthRef;

  const leaveSummary = useMemo(
    () =>
      leaveRequests.reduce(
        (acc, item) => {
          const days = Number(item.days || 0);
          if (item.status === "pending") acc.pending += 1;
          if (item.status === "approved" && item.record_type === "justified_absence") acc.justified += days;
          if (item.status === "approved" && item.record_type === "unjustified_absence") acc.unjustified += days;
          if (item.status === "approved" && item.record_type === "leave_without_pay") acc.withoutPay += days;
          return acc;
        },
        { justified: 0, unjustified: 0, withoutPay: 0, pending: 0 }
      ),
    [leaveRequests]
  );

  const financialSummary = useMemo(
    () =>
      financialObligations.reduce(
        (acc, item) => {
          acc.total += 1;
          acc.monthly += Number(item.current_month_amount || 0);
          acc.remaining += Number(item.remaining_balance || 0);
          if (item.entry_type === "advance") {
            acc.advances += 1;
          } else {
            acc.loans += 1;
          }
          return acc;
        },
        { total: 0, loans: 0, advances: 0, monthly: 0, remaining: 0 }
      ),
    [financialObligations]
  );

  const documentSummary = useMemo(
    () =>
      employeeDocuments.reduce(
        (acc, item) => {
          acc.total += 1;
          if (item.lifecycle_status === "expiring") acc.expiring += 1;
          if (item.lifecycle_status === "expired") acc.expired += 1;
          if (item.lifecycle_status === "archived") acc.archived += 1;
          if (item.file_exists) acc.available += 1;
          return acc;
        },
        { total: 0, expiring: 0, expired: 0, archived: 0, available: 0 }
      ),
    [employeeDocuments]
  );

  const filteredEmployeeDocuments = useMemo(() => {
    const search = String(documentFilters.search || "").trim().toLowerCase();
    const status = String(documentFilters.status || "todos").trim().toLowerCase();
    const category = String(documentFilters.category || "todos").trim().toLowerCase();
    const startDate = String(historyFilters?.startDate || "").trim();
    const endDate = String(historyFilters?.endDate || "").trim();

    return employeeDocuments.filter((item) => {
      const documentDate = String(item.issue_date || item.effective_date || item.expiry_date || item.created_at || "").slice(0, 10);
      if (startDate && endDate && documentDate && (documentDate < startDate || documentDate > endDate)) {
        return false;
      }

      if (category !== "todos" && String(item.category || "").toLowerCase() !== category) {
        return false;
      }

      if (status !== "todos") {
        const lifecycle = String(item.lifecycle_status || "").toLowerCase();
        const recordStatus = String(item.status || "").toLowerCase();
        if (lifecycle !== status && recordStatus !== status) {
          return false;
        }
      }

      if (search) {
        const haystack = [
          item.title,
          item.document_number,
          item.category,
          item.file_name,
          item.notes,
          item.issuer
        ].join(" ").toLowerCase();
        return haystack.includes(search);
      }

      return true;
    });
  }, [documentFilters, employeeDocuments, historyFilters]);

  const attendanceSummary = useMemo(
    () =>
      attendanceRecords.reduce(
        (acc, item) => {
          acc.total += 1;
          if (item.status === "present") acc.present += 1;
          if (item.status === "delay") acc.delay += 1;
          if (item.status === "absent" || item.status === "half_absence") acc.absence += 1;
          if (item.status === "leave") acc.leave += 1;
          if (item.status === "vacation") acc.vacation += 1;
          return acc;
        },
        { total: 0, present: 0, delay: 0, absence: 0, leave: 0, vacation: 0 }
      ),
    [attendanceRecords]
  );

  const historyTabs = [
    { key: "eventos", label: "Eventos", icon: "activity", count: events.length },
    { key: "documentos", label: "Documentos", icon: "receipt", count: employeeDocuments.length },
    { key: "creditos", label: "Créditos", icon: "payroll", count: financialObligations.length },
    { key: "licencas", label: "Licenças", icon: "calendar", count: leaveRequests.length },
    { key: "assiduidade", label: "Assiduidade", icon: "history", count: attendanceRecords.length },
    { key: "ferias", label: "Férias", icon: "sun", count: vacationRequests.length }
  ];

  if (user?.role === "admin") {
    historyTabs.push({ key: "auditoria", label: "Auditoria", icon: "audit", count: auditLogs.length });
  }

  const activeHistoryTab = historyTabs.find((item) => item.key === activeTab)?.key || historyTabs[0]?.key || "eventos";
  const canManageDocuments = Boolean(user);

  useEffect(() => {
    if (!preferredTab) {
      return;
    }

    const tabExists = historyTabs.some((item) => item.key === preferredTab);
    if (tabExists && preferredTab !== activeHistoryTab) {
      setActiveTab(preferredTab);
    }
  }, [activeHistoryTab, historyTabs, preferredTab]);

  useEffect(() => {
    if (typeof onActiveTabChange === "function") {
      onActiveTabChange(activeHistoryTab);
    }
  }, [activeHistoryTab, onActiveTabChange]);

  function renderEmployeeScope() {
    if (!boot?.employees?.length) {
      return (
        <div className="history-scope-card">
          <span className="topbar-eyebrow">
            <AppIcon name="users" size={14} />
            Âmbito analisado
          </span>
          <h3>Sem trabalhadores registados</h3>
          <p>Assim que cadastrar os colaboradores, o histórico passa a ficar disponível para consulta segmentada.</p>
        </div>
      );
    }

    if (!selectedEmployee) {
      return (
        <div className="history-scope-card">
          <span className="topbar-eyebrow">
            <AppIcon name="users" size={14} />
            Âmbito analisado
          </span>
          <h3>Todos os trabalhadores</h3>
          <p>Escolha um colaborador acima para abrir o histórico detalhado de eventos, assiduidade, férias e licenças.</p>
        </div>
      );
    }

    return (
      <div className="history-scope-card">
        <span className="topbar-eyebrow">
          <AppIcon name="users" size={14} />
          Âmbito analisado
        </span>
        <h3>{selectedEmployee.full_name}</h3>
        <p>{selectedEmployee.department || "Sem departamento"} • {selectedEmployee.job_title || "Sem função definida"}</p>
      </div>
    );
  }

  function renderEmployeeMissingNote(message) {
    return <p className="empty-note">{message}</p>;
  }

  function renderEventHistory() {
    if (!selectedEmployee) {
      return renderEmployeeMissingNote("Selecione um trabalhador para consultar o histórico de eventos salariais.");
    }

    return (
      <>
        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={eventFilters.search}
              onChange={(event) => setEventFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Descrição, tipo ou data"
            />
          </label>
          <label>Tipo
            <select value={eventFilters.type} onChange={(event) => setEventFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="todos">Todos</option>
              <option value="vacation_bonus">Subsídio de férias</option>
              <option value="christmas_bonus">Subsídio de Natal</option>
              <option value="overtime_50">Hora extra a 50%</option>
              <option value="overtime_100">Hora extra a 100%</option>
              <option value="penalty">Penalização</option>
              <option value="extra_payment">Pagamento extraordinário</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {events.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.description || item.event_type}</strong>
                <small>{item.event_date}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatMoney(item.amount)}</strong>
                <button className="link-btn danger" onClick={() => deleteEvent(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {events.length === 0 && <p className="empty-note">Sem eventos encontrados com os filtros atuais.</p>}
        </div>
      </>
    );
  }

  function renderFinancialHistory() {
    if (!selectedEmployee) {
      return renderEmployeeMissingNote("Selecione um trabalhador para consultar o histórico de empréstimos e adiantamentos.");
    }

    return (
      <>
        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Empréstimos</span>
            <strong>{financialSummary.loans}</strong>
            <small>Registos ativos</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Adiantamentos</span>
            <strong>{financialSummary.advances}</strong>
            <small>Registos ativos</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Desconto do mês</span>
            <strong>{formatMoney(financialSummary.monthly)}</strong>
            <small>Aplicação automática</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Saldo em dívida</span>
            <strong>{formatMoney(financialSummary.remaining)}</strong>
            <small>Valor remanescente</small>
          </article>
        </div>

        <div className="table-list">
          {financialObligations.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>{formatFinancialType(item.entry_type)} | início {item.start_month_ref} | {item.installment_count} prestação(ões)</small>
                <small>Valor total {formatMoney(item.principal_amount)} | prestação do mês {formatMoney(item.current_month_amount || 0)}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatMoney(item.remaining_balance || 0)}</strong>
                <small>{item.active ? "Ativo" : "Inativo"} | {item.remaining_installments} prestação(ões) por liquidar</small>
                {user?.role === "admin" && (
                  <button className="link-btn danger" onClick={() => deleteFinancialObligation(item.id)}>Excluir</button>
                )}
              </div>
            </div>
          ))}
          {financialObligations.length === 0 && (
            <p className="empty-note">Sem empréstimos ou adiantamentos para o trabalhador selecionado.</p>
          )}
        </div>
      </>
    );
  }

  function renderDocumentHistory() {
    if (!selectedEmployee) {
      return renderEmployeeMissingNote("Selecione um trabalhador para consultar o repositorio documental.");
    }

    return (
      <>
        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Total</span>
            <strong>{documentSummary.total}</strong>
            <small>Documentos registados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>A expirar</span>
            <strong>{documentSummary.expiring}</strong>
            <small>Exigem acompanhamento</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Expirados</span>
            <strong>{documentSummary.expired}</strong>
            <small>Precisam de renovacao</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Anexos disponiveis</span>
            <strong>{documentSummary.available}</strong>
            <small>Ficheiros prontos a abrir</small>
          </article>
        </div>

        <form className="panel section-stack" onSubmit={saveEmployeeDocument}>
          <div className="section-heading">
            <h3>{employeeDocumentForm.id ? "Editar documento laboral" : "Registar documento laboral"}</h3>
            <p>Guarde contratos, adendas e anexos de RH no arquivo oficial do colaborador.</p>
          </div>

          <div className="grid-form filter-grid">
            <label>Categoria
              <select
                value={employeeDocumentForm.category}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, category: event.target.value }))}
              >
                {documentCategoryOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>Titulo
              <input
                value={employeeDocumentForm.title}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Ex.: Contrato de trabalho 2026"
              />
            </label>
            <label>Numero / referencia
              <input
                value={employeeDocumentForm.document_number}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, document_number: event.target.value }))}
                placeholder="Numero do processo ou contrato"
              />
            </label>
            <label>Emissor
              <input
                value={employeeDocumentForm.issuer}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, issuer: event.target.value }))}
                placeholder="Empresa, AGT, INSS ou outra entidade"
              />
            </label>
            <label>Emissao
              <input
                type="date"
                value={employeeDocumentForm.issue_date || ""}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, issue_date: event.target.value }))}
              />
            </label>
            <label>Vigencia
              <input
                type="date"
                value={employeeDocumentForm.effective_date || ""}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, effective_date: event.target.value }))}
              />
            </label>
            <label>Validade
              <input
                type="date"
                value={employeeDocumentForm.expiry_date || ""}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, expiry_date: event.target.value }))}
              />
            </label>
            <label>Alerta previo (dias)
              <input
                type="number"
                min="0"
                max="365"
                value={employeeDocumentForm.alert_days_before}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, alert_days_before: Number(event.target.value || 0) }))}
              />
            </label>
            <label className="full-span">Notas
              <textarea
                rows={3}
                value={employeeDocumentForm.notes}
                onChange={(event) => setEmployeeDocumentForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Observacoes, contexto de arquivo ou instrucoes internas"
              />
            </label>
          </div>

          <div className="inline-actions">
            <button type="button" className="secondary-btn" onClick={chooseEmployeeDocumentFile} disabled={!canManageDocuments}>
              {employeeDocumentForm.file_path ? "Trocar ficheiro" : "Selecionar ficheiro"}
            </button>
            <span className="status-chip document-file-chip">
              {employeeDocumentForm.file_path || employeeDocumentForm.file_name || "Nenhum ficheiro selecionado"}
            </span>
            <button type="submit" disabled={!canManageDocuments}>
              {employeeDocumentForm.id ? "Atualizar documento" : "Guardar documento"}
            </button>
            <button type="button" className="secondary-btn" onClick={resetEmployeeDocumentForm}>
              Limpar
            </button>
          </div>
        </form>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={documentFilters.search}
              onChange={(event) => setDocumentFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Titulo, categoria, numero ou ficheiro"
            />
          </label>
          <label>Categoria
            <select
              value={documentFilters.category}
              onChange={(event) => setDocumentFilters((current) => ({ ...current, category: event.target.value }))}
            >
              <option value="todos">Todas</option>
              {documentCategoryOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="full-span">Estado
            <select
              value={documentFilters.status}
              onChange={(event) => setDocumentFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="todos">Todos</option>
              <option value="active">Ativos</option>
              <option value="expiring">A expirar</option>
              <option value="expired">Expirados</option>
              <option value="archived">Arquivados</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {filteredEmployeeDocuments.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>{formatDocumentCategory(item.category)}{item.document_number ? ` | ${item.document_number}` : ""}</small>
                <small>
                  {item.issue_date ? `Emitido em ${item.issue_date}` : "Sem data de emissao"}
                  {item.expiry_date ? ` | Validade ${item.expiry_date}` : " | Sem validade definida"}
                  {typeof item.days_until_expiry === "number" ? ` | ${item.days_until_expiry} dia(s)` : ""}
                </small>
                <small>{item.file_name || "Sem anexo"}{item.file_exists ? "" : " | ficheiro em falta"}</small>
                <small>{item.notes || "Sem observacoes adicionais."}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatDocumentLifecycleStatus(item.lifecycle_status)}</strong>
                <small>{item.created_by_name ? `Registado por ${item.created_by_name}` : "Sem utilizador associado"}</small>
                <div className="inline-actions">
                  <button type="button" className="link-btn" disabled={!item.file_exists} onClick={() => openEmployeeDocument(item.id)}>Abrir</button>
                  <button type="button" className="link-btn" onClick={() => editEmployeeDocument(item)}>Editar</button>
                  <button type="button" className="link-btn danger" disabled={!canManageDocuments} onClick={() => deleteEmployeeDocument(item.id)}>Excluir</button>
                </div>
              </div>
            </div>
          ))}
          {filteredEmployeeDocuments.length === 0 && <p className="empty-note">Sem documentos laborais com os filtros atuais.</p>}
        </div>
      </>
    );
  }

  function renderLeaveHistory() {
    if (!selectedEmployee) {
      return renderEmployeeMissingNote("Selecione um trabalhador para consultar o histórico de licenças e ausências.");
    }

    return (
      <>
        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Dias justificados</span>
            <strong>{leaveSummary.justified}</strong>
            <small>Registos aprovados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Faltas injustificadas</span>
            <strong>{leaveSummary.unjustified}</strong>
            <small>Com impacto salarial</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Licenças sem vencimento</span>
            <strong>{leaveSummary.withoutPay}</strong>
            <small>Dias aprovados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Pendentes</span>
            <strong>{leaveSummary.pending}</strong>
            <small>Aguardam decisão</small>
          </article>
        </div>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={leaveFilters.search}
              onChange={(event) => setLeaveFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Motivo, documento ou data"
            />
          </label>
          <label>Tipo
            <select value={leaveFilters.type} onChange={(event) => setLeaveFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="todos">Todos</option>
              {leaveTypeOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="full-span">Estado
            <select value={leaveFilters.status} onChange={(event) => setLeaveFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="todos">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Rejeitadas</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {leaveRequests.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{formatLeaveType(item.record_type)}</strong>
                <small>{item.start_date} até {item.end_date} | {item.days} dia(s)</small>
                <small>{item.reason}</small>
              </div>
              <div className="payroll-values">
                <strong>{item.status === "approved" ? "Aprovada" : item.status === "rejected" ? "Rejeitada" : "Pendente"}</strong>
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn" onClick={() => setLeaveRequestStatus(item.id, "approved")}>Aprovar</button>}
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn danger" onClick={() => setLeaveRequestStatus(item.id, "rejected")}>Rejeitar</button>}
                <button className="link-btn danger" onClick={() => deleteLeaveRequest(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {leaveRequests.length === 0 && <p className="empty-note">Sem registos de licenças ou ausências com os filtros atuais.</p>}
        </div>
      </>
    );
  }

  function renderAttendanceHistory() {
    if (!selectedEmployee) {
      return renderEmployeeMissingNote("Selecione um trabalhador para consultar o histórico de assiduidade.");
    }

    return (
      <>
        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Presenças</span>
            <strong>{attendanceSummary.present}</strong>
            <small>No mês filtrado</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Atrasos</span>
            <strong>{attendanceSummary.delay}</strong>
            <small>Registos com atraso</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Faltas</span>
            <strong>{attendanceSummary.absence}</strong>
            <small>Totais do período</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Licenças</span>
            <strong>{attendanceSummary.leave + attendanceSummary.vacation}</strong>
            <small>Licenças e férias</small>
          </article>
        </div>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={attendanceFilters.search}
              onChange={(event) => setAttendanceFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Data, estado ou observação"
            />
          </label>
          <label>Mês
            <input
              type="month"
              value={attendanceFilters.monthRef}
              onChange={(event) => setAttendanceFilters((current) => ({ ...current, monthRef: event.target.value }))}
            />
          </label>
          <label className="full-span">Estado
            <select value={attendanceFilters.status} onChange={(event) => setAttendanceFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="todos">Todos</option>
              {attendanceStatusOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="attendance-quick-filters">
          <button
            type="button"
            className={`attendance-filter-chip ${attendanceFilters.status === "todos" ? "attendance-filter-chip--active" : ""}`}
            onClick={() => setAttendanceFilters((current) => ({ ...current, status: "todos" }))}
          >
            Todos
          </button>
          {attendanceStatusOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`attendance-filter-chip attendance-filter-chip--${getAttendanceStatusTone(item.value)} ${attendanceFilters.status === item.value ? "attendance-filter-chip--active" : ""}`}
              onClick={() => setAttendanceFilters((current) => ({ ...current, status: item.value }))}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={`attendance-filter-chip ${activeAttendanceMonthRef === monthRef ? "attendance-filter-chip--active" : ""}`}
            onClick={() => setAttendanceFilters((current) => ({ ...current, monthRef, status: "todos" }))}
          >
            Usar mês da folha
          </button>
        </div>

        <div className="table-list">
          {attendanceRecords.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.attendance_date}</strong>
                <small>
                  {formatAttendanceStatus(item.status)} | {Number(item.hours_worked || 0)} hora(s) | {Number(item.delay_minutes || 0)} minuto(s) de atraso
                </small>
                <small>
                  {item.shift_name ? `Turno: ${item.shift_name}` : "Sem turno"} | Entrada {item.check_in_time || "--:--"} | Saída {item.check_out_time || "--:--"}
                </small>
                <small>
                  Origem: {item.source === "manual" ? "Manual" : item.source === "card_import" ? "Cartão" : "Biométrico"}
                  {item.device_label ? ` | ${item.device_label}` : ""}
                </small>
                <small>
                  Aprovação: {item.approval_status === "approved"
                    ? `Aprovado${item.approved_by_name ? ` por ${item.approved_by_name}` : ""}`
                    : "Pendente"}
                </small>
                <small>{item.notes || "Sem observações."}</small>
              </div>
              <div className="payroll-values">
                <span className={`attendance-state attendance-state--${getAttendanceStatusTone(item.status)}`}>
                  {formatAttendanceStatus(item.status)}
                </span>
                <button className="link-btn danger" disabled={attendancePeriodClosed} onClick={() => deleteAttendanceRecord(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {attendanceRecords.length === 0 && <p className="empty-note">Sem registos de assiduidade com os filtros atuais.</p>}
        </div>
      </>
    );
  }

  function renderVacationHistory() {
    if (!selectedEmployee) {
      return renderEmployeeMissingNote("Selecione um trabalhador para consultar o histórico de férias.");
    }

    return (
      <>
        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={vacationFilters.search}
              onChange={(event) => setVacationFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Notas, datas ou estado"
            />
          </label>
          <label>Ano
            <input
              value={vacationFilters.yearRef}
              onChange={(event) => {
                setVacationFilters((current) => ({ ...current, yearRef: event.target.value }));
                setVacationBalanceForm((current) => ({ ...current, year_ref: event.target.value }));
                setVacationForm((current) => ({ ...current, year_ref: event.target.value }));
              }}
              placeholder="2026"
            />
          </label>
          <label className="full-span">Estado
            <select value={vacationFilters.status} onChange={(event) => setVacationFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="todos">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="taken">Gozadas</option>
              <option value="rejected">Rejeitadas</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {vacationRequests.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.start_date} até {item.end_date}</strong>
                <small>{item.days} dia(s) | {formatVacationStatus(item.status)}</small>
                <small>{item.notes || "Sem observações adicionais."}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatVacationStatus(item.status)}</strong>
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn" onClick={() => setVacationRequestStatus(item.id, "approved")}>Aprovar</button>}
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn danger" onClick={() => setVacationRequestStatus(item.id, "rejected")}>Rejeitar</button>}
                {user?.role === "admin" && item.status === "approved" && <button className="link-btn" onClick={() => setVacationRequestStatus(item.id, "taken")}>Marcar como gozadas</button>}
                <button className="link-btn danger" onClick={() => deleteVacationRequest(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {vacationRequests.length === 0 && <p className="empty-note">Sem pedidos de férias com os filtros atuais.</p>}
        </div>
      </>
    );
  }

  function renderAuditHistory() {
    return (
      <>
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
      </>
    );
  }

  function renderActivePanel() {
    switch (activeHistoryTab) {
      case "eventos":
        return renderEventHistory();
      case "creditos":
        return renderFinancialHistory();
      case "documentos":
        return renderDocumentHistory();
      case "licencas":
        return renderLeaveHistory();
      case "assiduidade":
        return renderAttendanceHistory();
      case "ferias":
        return renderVacationHistory();
      case "auditoria":
        return renderAuditHistory();
      default:
        return renderEventHistory();
    }
  }

  return (
    <section className="history-layout">
      <div className="panel history-toolbar">
        <div className="grid-form filter-grid history-toolbar__filters">
          <label>Trabalhador
            <select
              value={selectedEmployeeId || ""}
              onChange={(event) => selectEmployee(Number(event.target.value) || 0)}
              disabled={!boot?.employees?.length}
            >
              <option value="">Todos</option>
              {(boot?.employees || []).map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>
          <label>Módulo visível
            <select value={activeHistoryTab} onChange={(event) => setActiveTab(event.target.value)}>
              {historyTabs.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>Data inicial
            <input
              type="date"
              value={historyFilters?.startDate || ""}
              onChange={(event) => updateHistoryFilterField("startDate", event.target.value)}
            />
          </label>
          <label>Data final
            <input
              type="date"
              value={historyFilters?.endDate || ""}
              onChange={(event) => updateHistoryFilterField("endDate", event.target.value)}
            />
          </label>
        </div>

        <div className="attendance-quick-filters reports-preset-row">
          {periodPresets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={historyFilters?.preset === preset.key ? "attendance-filter-chip attendance-filter-chip--active" : "attendance-filter-chip"}
              onClick={() => updateHistoryPreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {renderEmployeeScope()}
      </div>

      <div className="panel">
        <div className="history-tabs" role="tablist" aria-label="Históricos do aplicativo">
          {historyTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={activeHistoryTab === item.key}
              className={`history-tab ${activeHistoryTab === item.key ? "history-tab--active" : ""}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="history-tab__icon">
                <AppIcon name={item.icon} size={16} />
              </span>
              <span className="history-tab__copy">
                <strong>{item.label}</strong>
                <small>{item.count} registo(s)</small>
              </span>
            </button>
          ))}
        </div>

        <div className="history-panel">
          {renderActivePanel()}
        </div>
      </div>
    </section>
  );
}
