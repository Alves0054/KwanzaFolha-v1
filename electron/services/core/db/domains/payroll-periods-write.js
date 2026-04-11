function closePayrollPeriod(service, monthRef, userId, buildClosePayload) {
  const runsCount = service.db.prepare("SELECT COUNT(*) AS total FROM payroll_runs WHERE month_ref = ?").get(monthRef).total;
  if (!runsCount) {
    return { ok: false, message: "Não existem pagamentos processados para fechar este período." };
  }

  const current = service.getPayrollPeriod(monthRef);
  if (current.status === "closed") {
    return { ok: false, message: "Este período já está fechado." };
  }

  service.db.prepare(`
    INSERT INTO payroll_periods (month_ref, status, closed_at, closed_by_user_id, reopened_at, reopened_by_user_id, updated_at)
    VALUES (@month_ref, 'closed', @closed_at, @closed_by_user_id, NULL, NULL, @updated_at)
    ON CONFLICT(month_ref) DO UPDATE SET
      status = 'closed',
      closed_at = excluded.closed_at,
      closed_by_user_id = excluded.closed_by_user_id,
      reopened_at = NULL,
      reopened_by_user_id = NULL,
      updated_at = excluded.updated_at
  `).run(buildClosePayload(monthRef, userId));

  return { ok: true, period: service.getPayrollPeriod(monthRef) };
}

function reopenPayrollPeriod(service, monthRef, userId, buildReopenPayload) {
  const current = service.getPayrollPeriod(monthRef);
  if (current.status !== "closed") {
    return { ok: false, message: "Este período já está aberto." };
  }

  service.db.prepare(`
    INSERT INTO payroll_periods (month_ref, status, closed_at, closed_by_user_id, reopened_at, reopened_by_user_id, updated_at)
    VALUES (@month_ref, 'open', NULL, NULL, @reopened_at, @reopened_by_user_id, @updated_at)
    ON CONFLICT(month_ref) DO UPDATE SET
      status = 'open',
      reopened_at = excluded.reopened_at,
      reopened_by_user_id = excluded.reopened_by_user_id,
      updated_at = excluded.updated_at
  `).run(buildReopenPayload(monthRef, userId));

  return { ok: true, period: service.getPayrollPeriod(monthRef) };
}

module.exports = {
  closePayrollPeriod,
  reopenPayrollPeriod
};

