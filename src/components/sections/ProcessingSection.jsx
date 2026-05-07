export default function ProcessingSection({
  payrollRuns,
  monthRef,
  formatMoney,
  runPayroll,
  generatePayslip,
  deletePayrollRun,
  deletePayrollMonth,
  payrollFiscalStatus,
  payrollFiscalAffectedMonths,
  reprocessPreview,
  reprocessPayrollMonth,
  statePaymentRows,
  statePaymentTotals,
  period,
  user,
  closePayrollPeriod,
  reopenPayrollPeriod,
  processingFilters,
  setProcessingFilters
}) {
  const isClosed = period?.status === "closed";
  const currentFiscalProfile = payrollFiscalStatus?.currentProfile || null;
  const showFiscalWarning = Boolean(payrollFiscalStatus?.hasFiscalDrift);
  const preview = reprocessPreview?.monthRef === monthRef ? reprocessPreview?.data : null;
  const changedEmployees = preview?.changedEmployees || [];
  const getTotalDeductions = (run) => (
    run.summary_json?.totalDeductions ?? ((run.mandatory_deductions || 0) + (run.absence_deduction || 0))
  );
  const payrollTotals = payrollRuns.reduce(
    (totals, run) => ({
      gross: totals.gross + (run.gross_salary || 0),
      net: totals.net + (run.net_salary || 0),
      deductions: totals.deductions + getTotalDeductions(run),
      inss: totals.inss + (run.inss_amount || 0),
      irt: totals.irt + (run.irt_amount || 0)
    }),
    { gross: 0, net: 0, deductions: 0, inss: 0, irt: 0 }
  );

  return (
    <section className="processing-layout">
      <div className="panel">
        <div className="section-heading">
          <h2>Processamento salarial</h2>
          <p>Detalhe completo da folha por colaborador, com remunerações, descontos e líquido final.</p>
        </div>

        <div className="processing-period-bar">
          <div>
            <span className={`status-chip ${isClosed ? "status-chip--warning" : "status-chip--success"}`}>
              {isClosed ? "Período fechado" : "Período aberto"}
            </span>
            <p className="empty-note">
              {isClosed
                ? `Fechado em ${new Date(period.closed_at).toLocaleDateString("pt-PT")}${period.closed_by_name ? ` por ${period.closed_by_name}` : ""}.`
                : `O período ${monthRef} ainda permite processamento e alterações.`}
            </p>
            {currentFiscalProfile && (
              <p className="empty-note">
                Perfil fiscal ativo: {currentFiscalProfile.name || currentFiscalProfile.id || "Sem identificacao"}
                {currentFiscalProfile.effectiveFrom ? ` desde ${currentFiscalProfile.effectiveFrom}` : ""}.
              </p>
            )}
            {showFiscalWarning && (
              <p className="empty-note">
                Foram detetados {payrollFiscalStatus.outdatedRunCount} processamento(s) com regra fiscal desatualizada para {monthRef}. Reveja a prévia antes/depois e reprocesse o mês para alinhar a folha com a versão legal atual.
              </p>
            )}
            {preview?.reprocessBlockReason && (
              <p className="empty-note">{preview.reprocessBlockReason}</p>
            )}
          </div>

          {user && (
            <div className="inline-actions">
              <button
                type="button"
                onClick={runPayroll}
                disabled={isClosed}
                title={isClosed ? "Reabra o período antes de processar novamente." : undefined}
              >
                Processar folha
              </button>
              {showFiscalWarning && (payrollFiscalStatus?.canReprocess || payrollFiscalStatus?.requiresAuthorization) && (
                <button type="button" onClick={reprocessPayrollMonth}>
                  {payrollFiscalStatus?.requiresAuthorization ? "Reprocessar com autorização" : "Reprocessar mês"}
                </button>
              )}
              {payrollRuns.length > 0 && (
                isClosed ? (
                  <button type="button" className="secondary-btn" onClick={reopenPayrollPeriod}>
                    Reabrir período
                  </button>
                ) : (
                  <button type="button" onClick={closePayrollPeriod}>
                    Fechar período
                  </button>
                )
              )}
            </div>
          )}
        </div>

        <div className="processing-summary-grid" aria-label="Resumo da folha salarial">
          <div className="processing-summary-card">
            <span>Total colaboradores</span>
            <strong>{payrollRuns.length}</strong>
          </div>
          <div className="processing-summary-card processing-summary-card--highlight">
            <span>Total bruto / iliquido</span>
            <strong>{formatMoney(payrollTotals.gross)}</strong>
          </div>
          <div className="processing-summary-card processing-summary-card--net">
            <span>Total liquido</span>
            <strong>{formatMoney(payrollTotals.net)}</strong>
          </div>
          <div className="processing-summary-card">
            <span>Total descontos</span>
            <strong>{formatMoney(payrollTotals.deductions)}</strong>
          </div>
          <div className="processing-summary-card">
            <span>Total INSS</span>
            <strong>{formatMoney(payrollTotals.inss)}</strong>
          </div>
          <div className="processing-summary-card">
            <span>Total IRT</span>
            <strong>{formatMoney(payrollTotals.irt)}</strong>
          </div>
        </div>

        <div className="processing-toolbar">
          <label className="processing-search">
            Pesquisar colaborador
            <input
              value={processingFilters.search}
              onChange={(event) => setProcessingFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Nome, cargo ou departamento"
            />
          </label>

          {payrollRuns.length > 0 && user && !isClosed && (
            <div className="processing-toolbar__actions">
              <button type="button" className="secondary-btn danger processing-btn processing-btn--danger-soft" onClick={deletePayrollMonth}>
                Apagar pagamentos de {monthRef}
              </button>
            </div>
          )}
        </div>

        <div className="processing-table-shell">
          {payrollRuns.length > 0 ? (
            <table className="processing-table">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Cargo / Departamento</th>
                  <th className="numeric-cell">Salário base</th>
                  <th className="numeric-cell">Subsídios</th>
                  <th className="numeric-cell">Bónus</th>
                  <th className="numeric-cell">Horas Extra</th>
                  <th className="numeric-cell">INSS</th>
                  <th className="numeric-cell">IRT</th>
                  <th className="numeric-cell">Faltas</th>
                  <th className="numeric-cell">Licenças</th>
                  <th className="numeric-cell">Penalizações</th>
                  <th className="numeric-cell">Empréstimos</th>
                  <th className="numeric-cell">Total Descontos</th>
                  <th className="numeric-cell">Total Iliquido</th>
                  <th className="numeric-cell">Total Liquido</th>
                  <th className="actions-cell">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {payrollRuns.map((run) => (
                  <tr key={run.id}>
                    <td data-label="Colaborador">
                      <strong className="employee-name">{run.full_name}</strong>
                    </td>
                    <td data-label="Cargo / Departamento">
                      <span className="employee-role">{run.job_title}</span>
                      <small>{run.department}</small>
                    </td>
                    <td data-label="Salário base" className="numeric-cell">{formatMoney(run.summary_json?.baseSalary || 0)}</td>
                    <td data-label="Subsídios" className="numeric-cell">{formatMoney(run.summary_json?.allowancesTotal || 0)}</td>
                    <td data-label="Bónus" className="numeric-cell">{formatMoney(run.summary_json?.bonusesTotal || 0)}</td>
                    <td data-label="Horas Extra" className="numeric-cell">{formatMoney(run.summary_json?.overtimeTotal || 0)}</td>
                    <td data-label="INSS" className="numeric-cell">{formatMoney(run.inss_amount)}</td>
                    <td data-label="IRT" className="numeric-cell">{formatMoney(run.irt_amount)}</td>
                    <td data-label="Faltas" className="numeric-cell">{formatMoney(run.summary_json?.absenceDeduction || 0)}</td>
                    <td data-label="Licenças" className="numeric-cell">{formatMoney(run.summary_json?.leaveDeduction || 0)}</td>
                    <td data-label="Penalizações" className="numeric-cell">{formatMoney(run.summary_json?.penalties || 0)}</td>
                    <td data-label="Empréstimos" className="numeric-cell">{formatMoney(run.summary_json?.financialDeductions || 0)}</td>
                    <td data-label="Total Descontos" className="numeric-cell">{formatMoney(getTotalDeductions(run))}</td>
                    <td data-label="Total Iliquido" className="numeric-cell total-cell">{formatMoney(run.gross_salary)}</td>
                    <td data-label="Total Liquido" className="numeric-cell total-cell total-cell--net">{formatMoney(run.net_salary)}</td>
                    <td data-label="Acoes" className="actions-cell">
                      <div className="processing-row-actions">
                        <button type="button" className="processing-btn processing-btn--pdf" onClick={() => generatePayslip(run.id)}>
                          Recibo em PDF
                        </button>
                        {user && !isClosed ? (
                          <button type="button" className="processing-btn processing-btn--delete" onClick={() => deletePayrollRun(run.id)}>
                            Apagar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-note processing-empty">Ainda não existe processamento para este mês com os filtros atuais.</p>
          )}
        </div>
      </div>

      {showFiscalWarning ? (
        <div className="panel">
          <div className="section-heading">
            <h2>Migracao fiscal guiada</h2>
            <p>Compara os totais atuais com a nova regra legal antes do reprocessamento definitivo.</p>
          </div>

          {reprocessPreview?.loading ? <p className="empty-note">A preparar a prévia de reprocessamento...</p> : null}

          {preview ? (
            <>
              <div className="info-grid">
                <div>
                  <label>Bruto atual</label>
                  <strong>{formatMoney(preview.totals.before.gross)}</strong>
                  <small>Depois {formatMoney(preview.totals.after.gross)}</small>
                </div>
                <div>
                  <label>Liquido atual</label>
                  <strong>{formatMoney(preview.totals.before.net)}</strong>
                  <small>Delta {formatMoney(preview.totals.delta.net)}</small>
                </div>
                <div>
                  <label>IRT atual</label>
                  <strong>{formatMoney(preview.totals.before.irt)}</strong>
                  <small>Delta {formatMoney(preview.totals.delta.irt)}</small>
                </div>
                <div>
                  <label>INSS atual</label>
                  <strong>{formatMoney(preview.totals.before.inss)}</strong>
                  <small>Delta {formatMoney(preview.totals.delta.inss)}</small>
                </div>
              </div>

              <p className="empty-note">
                {preview.changedCount} colaborador(es) com alteracoes e {preview.unchangedCount} sem diferencas no recalculo.
              </p>

              <div className="table-list compact state-payment-list">
                {changedEmployees.slice(0, 8).map((row) => (
                  <div className="table-row" key={row.employee_id}>
                    <div>
                      <strong>{row.full_name}</strong>
                      <small>{row.job_title} - {row.department}</small>
                      <small>{row.changedFields.join(", ")}</small>
                    </div>
                    <div className="payroll-values state-payment-values">
                      <small>Liquido {formatMoney(row.before.netSalary)} {"->"} {formatMoney(row.after.netSalary)}</small>
                      <small>IRT {formatMoney(row.before.irtAmount)} {"->"} {formatMoney(row.after.irtAmount)}</small>
                      <strong>INSS {formatMoney(row.before.inssAmount)} {"->"} {formatMoney(row.after.inssAmount)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {!reprocessPreview?.loading && !preview ? (
            <p className="empty-note">Ainda não foi possível gerar a prévia deste mês.</p>
          ) : null}
        </div>
      ) : null}

      {user && payrollFiscalAffectedMonths?.length > 1 ? (
        <div className="panel">
          <div className="section-heading">
            <h2>Meses afetados</h2>
            <p>Períodos com deriva fiscal detetada e que devem ser revistos no plano de migração.</p>
          </div>

          <div className="table-list compact state-payment-list">
            {payrollFiscalAffectedMonths.map((status) => (
              <div className="table-row" key={status.month_ref}>
                <div>
                  <strong>{status.month_ref}</strong>
                  <small>Período {status.period_status} | Assiduidade {status.attendance_period_status}</small>
                </div>
                <div className="payroll-values state-payment-values">
                  <small>Desatualizados {status.outdatedRunCount}</small>
                  <small>Mistos {status.hasMixedAppliedProfiles ? "Sim" : "Não"}</small>
                  <strong>
                    {status.canReprocess ? "Pronto a reprocessar" : status.requiresAuthorization ? "Exige autorização" : "Bloqueado"}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="section-heading">
          <h2>Contas a pagar ao Estado</h2>
          <p>Mapa mensal com os valores legais por colaborador e o total consolidado.</p>
        </div>

        <div className="info-grid">
          <div>
            <label>INSS do funcionário</label>
            <strong>{formatMoney(statePaymentTotals.employeeInss)}</strong>
          </div>
          <div>
            <label>INSS da empresa</label>
            <strong>{formatMoney(statePaymentTotals.employerInss)}</strong>
          </div>
          <div>
            <label>IRT</label>
            <strong>{formatMoney(statePaymentTotals.irt)}</strong>
          </div>
          <div>
            <label>Total a entregar ao Estado</label>
            <strong>{formatMoney(statePaymentTotals.total)}</strong>
          </div>
        </div>

        <div className="table-list compact state-payment-list">
          {statePaymentRows.map((row) => (
            <div className="table-row" key={row.id}>
              <div>
                <strong>{row.fullName}</strong>
                <small>{row.jobTitle} - {row.department}</small>
              </div>
              <div className="payroll-values state-payment-values">
                <small>INSS Func. {formatMoney(row.employeeInss)}</small>
                <small>INSS Emp. {formatMoney(row.employerInss)}</small>
                <small>IRT {formatMoney(row.irt)}</small>
                <strong>{formatMoney(row.totalState)}</strong>
              </div>
            </div>
          ))}

          {statePaymentRows.length === 0 ? <p className="empty-note">Sem valores legais processados para este mês com os filtros atuais.</p> : null}
        </div>
      </div>
    </section>
  );
}
