import { ActionGrid, SectionCard, StatCard } from "../../ui/primitives";

const reportActions = [
  { key: "package", label: "Exportar pacote completo", kind: "primary", action: "monthly-package" },
  { key: "payslips-batch", label: "Gerar recibos em lote", kind: "primary", action: "payslips-batch" },
  { key: "monthly", label: "Relatório de salários", kind: "primary", action: "report", payload: "mensal" },
  { key: "annual", label: "Relatório anual de salários", kind: "primary", action: "report", payload: "anual" },
  { key: "irt-annual", label: "Relatório anual do IRT", kind: "secondary", action: "report", payload: "irt-anual" },
  { key: "inss-annual", label: "Relatório anual do INSS", kind: "secondary", action: "report", payload: "inss-anual" },
  { key: "faltas", label: "Relatório de faltas", kind: "secondary", action: "report", payload: "faltas" },
  { key: "presencas", label: "Relatório de presenças", kind: "secondary", action: "report", payload: "presencas" },
  { key: "descontos", label: "Relatório de descontos", kind: "secondary", action: "report", payload: "descontos" },
  { key: "funcionario", label: "Relatório por funcionário", kind: "secondary", action: "report", payload: "funcionario" },
  { key: "turnos-worker", label: "Mapa de turnos por trabalhador", kind: "secondary", action: "report", payload: "turnos-trabalhador" },
  { key: "turnos-department", label: "Mapa de turnos por departamento", kind: "secondary", action: "report", payload: "turnos-departamento" },
  { key: "mapa-docente", label: "Mapa docente", kind: "secondary", action: "report", payload: "mapa-docente" },
  { key: "payroll-excel", label: "Exportar folha em Excel", kind: "secondary", action: "monthly-payroll-excel" },
  { key: "agt-excel", label: "Exportar mapa AGT", kind: "secondary", action: "agt-excel" },
  { key: "state-excel", label: "Exportar pagamento ao Estado", kind: "secondary", action: "state-excel" },
  { key: "faltas-excel", label: "Exportar faltas em Excel", kind: "secondary", action: "attendance-excel", payload: "faltas" },
  { key: "presencas-excel", label: "Exportar presenças em Excel", kind: "secondary", action: "attendance-excel", payload: "presencas" },
  { key: "shift-worker-excel", label: "Exportar turnos por trabalhador", kind: "secondary", action: "shift-map-excel", payload: "turnos-trabalhador" },
  { key: "shift-department-excel", label: "Exportar turnos por departamento", kind: "secondary", action: "shift-map-excel", payload: "turnos-departamento" },
  { key: "shift-teacher-excel", label: "Exportar mapa docente", kind: "secondary", action: "shift-map-excel", payload: "mapa-docente" }
];

const presets = [
  { key: "month", label: "Mês atual" },
  { key: "week", label: "Última semana" },
  { key: "year", label: "Ano atual" },
  { key: "all", label: "Tudo" }
];

function executeReportAction(item, handlers) {
  switch (item.action) {
    case "monthly-package":
      handlers.generateMonthlyPackage();
      return;
    case "payslips-batch":
      handlers.generatePayslipsBatch();
      return;
    case "report":
      handlers.generateReport(item.payload);
      return;
    case "monthly-payroll-excel":
      handlers.exportMonthlyPayrollExcel();
      return;
    case "agt-excel":
      handlers.exportAgtMonthlyRemunerationExcel();
      return;
    case "state-excel":
      handlers.exportStatePaymentsExcel();
      return;
    case "attendance-excel":
      handlers.exportAttendanceExcel(item.payload);
      return;
    case "shift-map-excel":
      handlers.exportShiftMapExcel(item.payload);
      return;
    default:
  }
}

export default function ReportsSection({
  monthRef,
  reportFilters,
  updateReportPreset,
  updateReportFilterField,
  employees,
  generateReport,
  generateMonthlyPackage,
  generatePayslipsBatch,
  exportMonthlyPayrollExcel,
  exportAgtMonthlyRemunerationExcel,
  exportStatePaymentsExcel,
  exportAttendanceExcel,
  exportShiftMapExcel,
  exportBankPayroll,
  selectedBankCode,
  setSelectedBankCode,
  banks,
  stats,
  formatMoney
}) {
  const handlers = {
    generateReport,
    generateMonthlyPackage,
    generatePayslipsBatch,
    exportMonthlyPayrollExcel,
    exportAgtMonthlyRemunerationExcel,
    exportStatePaymentsExcel,
    exportAttendanceExcel,
    exportShiftMapExcel
  };

  return (
    <section className="two-column reports-layout">
      <SectionCard
        className="reports-panel reports-panel--filters"
        title="Filtros de impressão e exportação"
        description="Escolha o período livre e, se quiser, um único funcionário para aplicar o mesmo critério a todos os relatórios e documentos desta área."
      >
        <div className="audit-filters reports-filter-grid">
          <label>
            Data inicial
            <input type="date" value={reportFilters.startDate} onChange={(event) => updateReportFilterField("startDate", event.target.value)} />
          </label>
          <label>
            Data final
            <input type="date" value={reportFilters.endDate} onChange={(event) => updateReportFilterField("endDate", event.target.value)} />
          </label>
          <label>
            Funcionário
            <select value={reportFilters.employeeId} onChange={(event) => updateReportFilterField("employeeId", event.target.value)}>
              <option value="">Todos os funcionários</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Referência rápida
            <input type="month" value={monthRef} readOnly />
          </label>
        </div>
        <div className="attendance-quick-filters reports-preset-row">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={reportFilters.preset === preset.key ? "attendance-filter-chip attendance-filter-chip--active" : "attendance-filter-chip"}
              onClick={() => updateReportPreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        className="reports-panel reports-panel--actions"
        title="Relatórios e documentos"
        description="Todos os itens abaixo usam o mesmo período, cores e estrutura visual. Os recibos salariais continuam com o formato próprio."
      >
        <ActionGrid className="reports-actions">
          {reportActions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.kind === "secondary" ? "secondary-btn" : ""}
              onClick={() => executeReportAction(item, handlers)}
            >
              {item.label}
            </button>
          ))}
          <label>
            Banco para exportação bancária
            <select value={selectedBankCode} onChange={(event) => setSelectedBankCode(event.target.value)}>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </label>
          <div className="full-span empty-note">
            O CSV é universal e identifica cada pagamento como PS2 ou PSX. Os ficheiros PS2 e PSX são gerados em Excel.
          </div>
          <button type="button" className="secondary-btn" onClick={() => exportBankPayroll("csv")}>
            Exportar CSV bancário
          </button>
          <button type="button" className="secondary-btn" onClick={() => exportBankPayroll("ps2")}>
            Exportar PS2 em Excel
          </button>
          <button type="button" className="secondary-btn" onClick={() => exportBankPayroll("psx")}>
            Exportar PSX em Excel
          </button>
        </ActionGrid>
      </SectionCard>

      <SectionCard
        className="reports-panel reports-panel--summary"
        title="Resumo do período"
        description="Consolidado rápido do intervalo escolhido para apoiar a decisão operacional."
      >
        <div className="stats-grid stats-grid--reports">
          <StatCard label="Total líquido" value={formatMoney(stats.net)} />
          <StatCard label="Total de descontos" value={formatMoney(stats.deductions)} />
          <StatCard label="Funcionários processados" value={stats.runs} />
        </div>
      </SectionCard>
    </section>
  );
}
