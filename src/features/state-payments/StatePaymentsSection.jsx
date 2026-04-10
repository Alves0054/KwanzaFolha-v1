import { DataList, SectionCard, StatCard } from "../../ui/primitives";

const periodPresets = [
  { key: "month", label: "Mês atual" },
  { key: "week", label: "Última semana" },
  { key: "year", label: "Ano atual" },
  { key: "all", label: "Tudo" }
];

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("pt-PT") : "Por registar";
}

function renderStateRow(row, formatMoney, withIdentity = false) {
  const rowIssues = row.issues || [];
  return (
    <div className="table-row" key={row.id}>
      <div>
        <strong>{row.fullName}</strong>
        <small>{row.jobTitle} - {row.department}</small>
        {withIdentity ? <small>NIF {row.nif || "-"} | BI {row.bi || "-"} | NISS {row.socialSecurityNumber || "-"}</small> : null}
        {withIdentity && rowIssues.length ? <small>{rowIssues.join(" | ")}</small> : null}
      </div>
      <div className="payroll-values state-payment-values">
        {"grossRemuneration" in row ? <small>Remuneração {formatMoney(row.grossRemuneration)}</small> : null}
        {"taxableBase" in row ? <small>Base IRT {formatMoney(row.taxableBase)}</small> : null}
        {"employeeInss" in row && !("grossRemuneration" in row) ? <small>INSS Func. {formatMoney(row.employeeInss)}</small> : null}
        {"employerInss" in row ? <small>INSS Emp. {formatMoney(row.employerInss)}</small> : null}
        <small>IRT {formatMoney(row.irtWithheld ?? row.irt)}</small>
        <strong>{row.fiscalProfileVersion || formatMoney(row.totalState)}</strong>
      </div>
    </div>
  );
}

export default function StatePaymentsSection({
  monthRef,
  employees,
  agtMonthlyRemunerationMap,
  agtMonthlyRemunerationRows,
  agtSubmission,
  agtSubmissionForm,
  setAgtSubmissionForm,
  saveAgtSubmission,
  exportAgtMonthlyRemunerationExcel,
  exportStatePaymentsExcel,
  statePaymentRows,
  statePaymentTotals,
  formatMoney,
  stateFilters,
  updateStatePreset,
  updateStateFilterField,
  selectedStateMonthRef
}) {
  const agtValidation = agtMonthlyRemunerationMap?.validation || { ready: false, blockingIssues: [], warnings: [] };
  const agtTotals = agtMonthlyRemunerationMap?.totals || {
    grossRemuneration: 0,
    employeeInss: 0,
    taxableBase: 0,
    irtWithheld: 0
  };
  const isExactMonth = Boolean(selectedStateMonthRef);

  return (
    <section className="processing-layout">
      <SectionCard
        title="Filtros do mapa legal"
        description="Use o mesmo período livre e, se quiser, um único funcionário para analisar AGT e Pagamento ao Estado com a mesma régua."
      >
        <div className="audit-filters reports-filter-grid">
          <label>
            Data inicial
            <input type="date" value={stateFilters.startDate || ""} onChange={(event) => updateStateFilterField("startDate", event.target.value)} />
          </label>
          <label>
            Data final
            <input type="date" value={stateFilters.endDate || ""} onChange={(event) => updateStateFilterField("endDate", event.target.value)} />
          </label>
          <label>
            Funcionário
            <select value={stateFilters.employeeId || ""} onChange={(event) => updateStateFilterField("employeeId", event.target.value)}>
              <option value="">Todos os funcionários</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pesquisar
            <input value={stateFilters.search || ""} onChange={(event) => updateStateFilterField("search", event.target.value)} placeholder="Nome, cargo, departamento, NIF, BI ou NISS" />
          </label>
        </div>
        <div className="attendance-quick-filters reports-preset-row">
          {periodPresets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={stateFilters.preset === preset.key ? "attendance-filter-chip attendance-filter-chip--active" : "attendance-filter-chip"}
              onClick={() => updateStatePreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Mapa Mensal AGT"
        description={`Pré-validação do mapa mensal de remunerações para o recorte ${stateFilters.startDate || monthRef} até ${stateFilters.endDate || monthRef}.`}
        actions={(
          <>
            <span className={`status-chip ${agtValidation.ready ? "status-chip--success" : "status-chip--warning"}`}>
              {agtValidation.ready ? "Pronto para revisão final" : "Revisão obrigatória"}
            </span>
            <button type="button" className="secondary-btn" onClick={exportAgtMonthlyRemunerationExcel}>
              Exportar mapa AGT em Excel
            </button>
          </>
        )}
      >
        <div className="stats-grid">
          <StatCard label="Remuneração considerada" value={formatMoney(agtTotals.grossRemuneration)} />
          <StatCard label="Matéria colectável" value={formatMoney(agtTotals.taxableBase)} />
          <StatCard label="IRT retido" value={formatMoney(agtTotals.irtWithheld)} />
          <StatCard
            label="Modo recomendado"
            value={agtMonthlyRemunerationMap?.submissionMode === "upload" ? "Upload em lote" : "Preenchimento manual"}
          />
        </div>
        <div className="stats-grid">
          <StatCard label="Sem NIF" value={String(agtValidation.missingEmployeeNif || 0)} />
          <StatCard label="Sem BI" value={String(agtValidation.missingEmployeeBi || 0)} />
          <StatCard label="Sem NISS" value={String(agtValidation.missingEmployeeNiss || 0)} />
          <StatCard label="Inconsistências" value={String(agtValidation.inconsistentRows || 0)} />
        </div>
        {!isExactMonth && (
          <p className="empty-note">
            O estado de submissão e o comprovativo AGT continuam disponíveis apenas quando o filtro fecha exatamente num único mês.
          </p>
        )}
        <DataList compact items={agtValidation.blockingIssues} renderItem={(issue) => <p className="empty-note" key={issue}>{issue}</p>} />
        <DataList compact items={agtValidation.warnings} renderItem={(warning) => <p className="empty-note" key={warning}>{warning}</p>} />
      </SectionCard>

      <SectionCard
        title="Entrega e comprovativo"
        description="Registe o estado da submissão no Portal AGT, o modo usado e o comprovativo interno do período."
      >
        <div className="stats-grid">
          <StatCard label="Estado atual" value={agtSubmission?.status || "draft"} />
          <StatCard label="Modo registado" value={agtSubmission?.submission_mode || agtMonthlyRemunerationMap?.submissionMode || "manual"} />
          <StatCard label="Última exportação" value={formatDateTime(agtSubmission?.exported_at)} />
          <StatCard label="Submetido em" value={formatDateTime(agtSubmission?.submitted_at)} />
        </div>
        <div className="grid-form filter-grid">
          <label>
            Estado da entrega
            <select
              value={agtSubmissionForm.status}
              disabled={!isExactMonth}
              onChange={(event) => setAgtSubmissionForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="draft">Rascunho</option>
              <option value="ready">Pronto para submeter</option>
              <option value="submitted">Submetido</option>
              <option value="accepted">Aceite</option>
              <option value="rejected">Rejeitado</option>
            </select>
          </label>
          <label>
            Modo de submissão
            <select
              value={agtSubmissionForm.submission_mode}
              disabled={!isExactMonth}
              onChange={(event) => setAgtSubmissionForm((current) => ({ ...current, submission_mode: event.target.value }))}
            >
              <option value="manual">Preenchimento manual</option>
              <option value="upload">Upload em lote</option>
            </select>
          </label>
          <label>
            Referência do comprovativo
            <input
              value={agtSubmissionForm.proof_reference}
              disabled={!isExactMonth}
              onChange={(event) => setAgtSubmissionForm((current) => ({ ...current, proof_reference: event.target.value }))}
              placeholder="Portal AGT, protocolo ou referência interna"
            />
          </label>
          <label>
            Caminho do comprovativo
            <input
              value={agtSubmissionForm.proof_path}
              disabled={!isExactMonth}
              onChange={(event) => setAgtSubmissionForm((current) => ({ ...current, proof_path: event.target.value }))}
              placeholder="Pasta, PDF ou observação de arquivo"
            />
          </label>
          <label className="full-span">
            Notas operacionais
            <textarea
              rows={3}
              value={agtSubmissionForm.notes}
              disabled={!isExactMonth}
              onChange={(event) => setAgtSubmissionForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Responsável, observações da entrega, validações manuais"
            />
          </label>
        </div>
        <div className="inline-actions">
          <button type="button" onClick={saveAgtSubmission} disabled={!isExactMonth}>
            Guardar estado da entrega
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Linhas do mapa AGT"
        description="Revise identificação do trabalhador, bases fiscais e versão legal aplicada antes da submissão."
      >
        <DataList
          compact
          className="state-payment-list"
          items={agtMonthlyRemunerationRows}
          emptyMessage="Sem linhas AGT para este período com os filtros atuais."
          renderItem={(row) => renderStateRow(row, formatMoney, true)}
        />
      </SectionCard>

      <SectionCard
        title="Pagamento ao Estado"
        description={`Mapa legal com os encargos por colaborador no recorte selecionado. ${isExactMonth ? `Mês base ${selectedStateMonthRef}.` : "Período multi-mês."}`}
        actions={(
          <button type="button" className="secondary-btn" onClick={exportStatePaymentsExcel}>
            Exportar pagamento ao Estado em Excel
          </button>
        )}
      >
        <div className="stats-grid">
          <StatCard label="INSS do funcionário" value={formatMoney(statePaymentTotals.employeeInss)} />
          <StatCard label="INSS da empresa" value={formatMoney(statePaymentTotals.employerInss)} />
          <StatCard label="IRT" value={formatMoney(statePaymentTotals.irt)} />
          <StatCard label="Total a pagar ao Estado" value={formatMoney(statePaymentTotals.total)} />
        </div>
      </SectionCard>

      <SectionCard
        title="Lista por funcionário"
        description="Distribuição dos encargos legais processados no período filtrado."
      >
        <DataList
          compact
          className="state-payment-list"
          items={statePaymentRows}
          emptyMessage="Sem valores legais processados para este período com os filtros atuais."
          renderItem={(row) => renderStateRow(row, formatMoney)}
        />
      </SectionCard>
    </section>
  );
}
