function buildEmployeeDocumentsFilter(filters = {}, normalizeEmployeeDocumentCategory) {
  const conditions = [];
  const values = {};

  if (filters.id) {
    conditions.push("employee_documents.id = @id");
    values.id = Number(filters.id);
  }
  if (filters.employeeId) {
    conditions.push("employee_documents.employee_id = @employeeId");
    values.employeeId = Number(filters.employeeId);
  }
  if (filters.category && filters.category !== "todos") {
    conditions.push("employee_documents.category = @category");
    values.category = normalizeEmployeeDocumentCategory(filters.category);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

function applyEmployeeDocumentClientFilters(rows = [], filters = {}) {
  const normalizedSearch = String(filters.search || "").trim().toLowerCase();
  const normalizedStatus = String(filters.status || "todos").trim().toLowerCase();

  return rows.filter((row) => {
    if (normalizedSearch) {
      const haystack = [
        row.title,
        row.document_number,
        row.category,
        row.file_name,
        row.notes,
        row.full_name,
        row.department,
        row.job_title
      ].join(" ").toLowerCase();
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    if (normalizedStatus !== "todos") {
      const matchesLifecycle = row.lifecycle_status === normalizedStatus;
      const matchesRecordStatus = String(row.status || "").toLowerCase() === normalizedStatus;
      if (!matchesLifecycle && !matchesRecordStatus) {
        return false;
      }
    }

    return true;
  });
}

module.exports = {
  applyEmployeeDocumentClientFilters,
  buildEmployeeDocumentsFilter
};

