function buildPayrollRunsFilter(filters = {}, normalizeReportFilters) {
  const normalizedFilters =
    typeof normalizeReportFilters === "function" ? normalizeReportFilters(filters) : filters || {};
  const conditions = [];
  const values = {};

  if (filters.id) {
    conditions.push("payroll_runs.id = @id");
    values.id = filters.id;
  }
  if (normalizedFilters.employeeId) {
    conditions.push("payroll_runs.employee_id = @employeeId");
    values.employeeId = normalizedFilters.employeeId;
  }
  if (normalizedFilters.monthRef) {
    conditions.push("payroll_runs.month_ref = @monthRef");
    values.monthRef = normalizedFilters.monthRef;
  } else {
    if (normalizedFilters.startMonthRef) {
      conditions.push("payroll_runs.month_ref >= @startMonthRef");
      values.startMonthRef = normalizedFilters.startMonthRef;
    }
    if (normalizedFilters.endMonthRef) {
      conditions.push("payroll_runs.month_ref <= @endMonthRef");
      values.endMonthRef = normalizedFilters.endMonthRef;
    }
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

function mapPayrollRunRows(rows = []) {
  return rows.map((row) => {
    try {
      return { ...row, summary_json: JSON.parse(row.summary_json) };
    } catch {
      return { ...row, summary_json: {} };
    }
  });
}

module.exports = {
  buildPayrollRunsFilter,
  mapPayrollRunRows
};

