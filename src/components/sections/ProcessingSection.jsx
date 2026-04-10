export default function ProcessingSection({
  payrollRuns,
  monthRef,
  formatMoney,
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

  return (
    <section className="processing-layout">
      <div className="panel">
        <div className="section-heading">
          <h2>Processamento salarial</h2>
          <p>Detalhe completo da folha por colaborador, com remuneracoes, descontos e liquido final.</p>
        </div>

        <div className="processing-period-bar">
          <div>
            <span className={`status-chip ${isClosed ? "status-chip--warning" : "status-chip--success"}`}>
              {isClosed ? "Periodo fechado" : "Periodo aberto"}
            </span>
            <p className="empty-note">
              {isClosed
                ? `Fechado em ${new Date(period.closed_at).toLocaleDateString("pt-PT")}${period.closed_by_name ? ` por ${period.closed_by_name}` : ""}.`
                : `O periodo ${monthRef} ainda permite processamento e alteracoes.`}
            </p>
            {currentFiscalProfile && (
              <p className="empty-note">
                Perfil fiscal ativo: {currentFiscalProfile.name || currentFiscalProfile.id || "Sem identificacao"}
                {currentFiscalProfile.effectiveFrom ? ` desde ${currentFiscalProfile.effectiveFrom}` : ""}.
              </p>
            )}
            {showFiscalWarning && (
              <p className="empty-note">
                Foram detetados {payrollFiscalStatus.outdatedRunCount} processamento(s) com regra fiscal desatualizada para {monthRef}. Reveja a previa antes/depois e reprocese o mes para alinhar a folha com a versao legal atual.
              </p>
            )}
            {preview?.reprocessBlockReason && (
              <p className="empty-note">{preview.reprocessBlockReason}</p>
            )}
          </div>

          {user?.role === "admin" && payrollRuns.length > 0 && (
            <div className="inline-actions">
              {showFiscalWarning && (payrollFiscalStatus?.canReprocess || payrollFiscalStatus?.requiresAuthorization) && (
                <button type="button" onClick={reprocessPayrollMonth}>
                  {payrollFiscalStatus?.requiresAuthorization ? "Reprocessar com autorizacao" : "Reprocessar mes"}
                </button>
              )}
              {isClosed ? (
                <button type="button" className="secondary-btn" onClick={reopenPayrollPeriod}>
                  Reabrir periodo
                </button>
              ) : (
                <button type="button" onClick={closePayrollPeriod}>
                  Fechar periodo
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid-form filter-grid">
          <label className="full-span">
            Pesquisar colaborador
            <input
              value={processingFilters.search}
              onChange={(event) => setProcessingFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Nome, cargo ou departamento"
            />
          </label>
        </div>

        {payrollRuns.length > 0 && user?.role === "admin" && !isClosed && (
          <div className="inline-actions">
            <button type="button" className="secondary-btn danger" onClick={deletePayrollMonth}>
              Apagar pagamentos de {monthRef}
            </button>
          </div>
        )}

        <div className="table-list processing-list">
          {payrollRuns.map((run) => (
            <article className="table-row processing-card" key={run.id}>
              <div className="processing-card__header">
                <div>
                  <strong>{run.full_name}</strong>
                  <small>{run.job_title} - {run.department}</small>
                </div>
                <div className="processing-card__actions">
                  <button className="link-btn" onClick={() => generatePayslip(run.id)}>Recibo em PDF</button>
                  {user?.role === "admin" && !isClosed ? (
                    <button className="link-btn danger" onClick={() => deletePayrollRun(run.id)}>Apagar</button>
                  ) : null}
                </div>
              </div>

              <div className="processing-card__grid">
                <div>
                  <label>Salario base</label>
                  <strong>{formatMoney(run.summary_json?.baseSalary || 0)}</strong>
                </div>
                <div>
                  <label>Subsidios</label>
                  <strong>{formatMoney(run.summary_json?.allowancesTotal || 0)}</strong>
                </div>
                <div>
                  <label>Bonus</label>
                  <strong>{formatMoney(run.summary_json?.bonusesTotal || 0)}</strong>
                </div>
                <div>
                  <label>Horas extra</label>
                  <strong>{formatMoney(run.summary_json?.overtimeTotal || 0)}</strong>
                </div>
                <div>
                  <label>Total iliquido</label>
                  <strong>{formatMoney(run.gross_salary)}</strong>
                </div>
                <div>
                  <label>Total liquido</label>
                  <strong>{formatMoney(run.net_salary)}</strong>
                </div>
              </div>

              <div className="processing-card__grid processing-card__grid--deductions">
                <div>
                  <label>INSS do funcionario</label>
                  <strong>{formatMoney(run.inss_amount)}</strong>
                </div>
                <div>
                  <label>IRT</label>
                  <strong>{formatMoney(run.irt_amount)}</strong>
                </div>
                <div>
                  <label>Faltas</label>
                  <strong>{formatMoney(run.summary_json?.absenceDeduction || 0)}</strong>
                </div>
                <div>
                  <label>Licencas</label>
                  <strong>{formatMoney(run.summary_json?.leaveDeduction || 0)}</strong>
                </div>
                <div>
                  <label>Penalizacoes</label>
                  <strong>{formatMoney(run.summary_json?.penalties || 0)}</strong>
                </div>
                <div>
                  <label>Emprestimos e adiantamentos</label>
                  <strong>{formatMoney(run.summary_json?.financialDeductions || 0)}</strong>
                </div>
                <div>
                  <label>Total de descontos</label>
                  <strong>{formatMoney(run.summary_json?.totalDeductions || (run.mandatory_deductions + run.absence_deduction))}</strong>
                </div>
              </div>
            </article>
          ))}

          {payrollRuns.length === 0 ? <p className="empty-note">Ainda nao existe processamento para este mes com os filtros atuais.</p> : null}
        </div>
      </div>

      {showFiscalWarning ? (
        <div className="panel">
          <div className="section-heading">
            <h2>Migracao fiscal guiada</h2>
            <p>Compara os totais atuais com a nova regra legal antes do reprocessamento definitivo.</p>
          </div>

          {reprocessPreview?.loading ? <p className="empty-note">A preparar a previa de reprocessamento...</p> : null}

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
            <p className="empty-note">Ainda nao foi possivel gerar a previa deste mes.</p>
          ) : null}
        </div>
      ) : null}

      {user?.role === "admin" && payrollFiscalAffectedMonths?.length > 1 ? (
        <div className="panel">
          <div className="section-heading">
            <h2>Meses afetados</h2>
            <p>Periodos com deriva fiscal detetada e que devem ser revistos no plano de migracao.</p>
          </div>

          <div className="table-list compact state-payment-list">
            {payrollFiscalAffectedMonths.map((status) => (
              <div className="table-row" key={status.month_ref}>
                <div>
                  <strong>{status.month_ref}</strong>
                  <small>Periodo {status.period_status} | Assiduidade {status.attendance_period_status}</small>
                </div>
                <div className="payroll-values state-payment-values">
                  <small>Desatualizados {status.outdatedRunCount}</small>
                  <small>Mistos {status.hasMixedAppliedProfiles ? "Sim" : "Nao"}</small>
                  <strong>
                    {status.canReprocess ? "Pronto a reprocessar" : status.requiresAuthorization ? "Exige autorizacao" : "Bloqueado"}
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
            <label>INSS do funcionario</label>
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

          {statePaymentRows.length === 0 ? <p className="empty-note">Sem valores legais processados para este mes com os filtros atuais.</p> : null}
        </div>
      </div>
    </section>
  );
}
