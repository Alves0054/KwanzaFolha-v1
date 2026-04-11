function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildAuditLogsFilter(filters = {}) {
  const clauses = [];
  const params = {};

  if (filters.userName) {
    clauses.push("LOWER(user_name) LIKE LOWER(@userName)");
    params.userName = `%${String(filters.userName).trim()}%`;
  }
  if (filters.action) {
    clauses.push("action = @action");
    params.action = String(filters.action).trim();
  }
  if (filters.monthRef) {
    clauses.push("month_ref = @monthRef");
    params.monthRef = String(filters.monthRef).trim();
  }
  if (filters.startDate) {
    clauses.push("substr(created_at, 1, 10) >= @startDate");
    params.startDate = String(filters.startDate).trim();
  }
  if (filters.endDate) {
    clauses.push("substr(created_at, 1, 10) <= @endDate");
    params.endDate = String(filters.endDate).trim();
  }
  if (filters.search) {
    clauses.push("(LOWER(entity_label) LIKE LOWER(@search) OR LOWER(entity_type) LIKE LOWER(@search) OR LOWER(action) LIKE LOWER(@search))");
    params.search = `%${String(filters.search).trim()}%`;
  }

  return {
    whereClause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    limit: Math.max(1, Number(filters.limit || 150))
  };
}

function mapAuditRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    details_json: safeJsonParse(row.details_json || "{}", {})
  }));
}

module.exports = {
  buildAuditLogsFilter,
  mapAuditRows
};

