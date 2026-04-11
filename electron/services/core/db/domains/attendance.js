function buildAttendanceRecordsFilter(filters = {}) {
  const conditions = [];
  const values = {};

  if (filters.id) {
    conditions.push("attendance_records.id = @id");
    values.id = filters.id;
  }
  if (filters.employeeId) {
    conditions.push("attendance_records.employee_id = @employeeId");
    values.employeeId = filters.employeeId;
  }
  if (filters.monthRef) {
    conditions.push("substr(attendance_records.attendance_date, 1, 7) = @monthRef");
    values.monthRef = filters.monthRef;
  }
  if (filters.startDate) {
    conditions.push("attendance_records.attendance_date >= @startDate");
    values.startDate = filters.startDate;
  }
  if (filters.endDate) {
    conditions.push("attendance_records.attendance_date <= @endDate");
    values.endDate = filters.endDate;
  }
  if (filters.status) {
    conditions.push("attendance_records.status = @status");
    values.status = filters.status;
  }
  if (filters.source) {
    conditions.push("attendance_records.source = @source");
    values.source = filters.source;
  }
  if (filters.batchId) {
    conditions.push("attendance_records.batch_id = @batchId");
    values.batchId = filters.batchId;
  }
  if (filters.approvalStatus) {
    conditions.push("attendance_records.approval_status = @approvalStatus");
    values.approvalStatus = String(filters.approvalStatus).trim().toLowerCase();
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

module.exports = {
  buildAttendanceRecordsFilter
};

