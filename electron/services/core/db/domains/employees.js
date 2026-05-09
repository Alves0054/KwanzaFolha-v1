function parseJsonArray(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapEmployeeListRows(rows = [], options = {}) {
  const resolveBankCodeFromRegistryCode = options.resolveBankCodeFromRegistryCode;
  const extractAngolaBankRegistryCode = options.extractAngolaBankRegistryCode;

  return rows.map((employee) => ({
    ...employee,
    document_type: employee.document_type || "bi",
    social_security_number: employee.social_security_number || "",
    driver_license_number: employee.driver_license_number || "",
    attendance_code: employee.attendance_code || "",
    birth_date: employee.birth_date || "",
    gender: employee.gender || "",
    marital_status: employee.marital_status || "",
    nationality: employee.nationality || "Angolana",
    personal_phone: employee.personal_phone || "",
    personal_email: employee.personal_email || "",
    address: employee.address || "",
    bank_code:
      employee.bank_code ||
      resolveBankCodeFromRegistryCode?.(extractAngolaBankRegistryCode?.(employee.iban)) ||
      "ATLANTICO",
    bank_account: employee.bank_account || "",
    company_id: employee.company_id || null,
    company_name: employee.company_name || "",
    branch_id: employee.branch_id || null,
    branch_name: employee.branch_name || "",
    department_id: employee.department_id || null,
    structured_department_name: employee.structured_department_name || "",
    job_position_id: employee.job_position_id || null,
    structured_job_title: employee.structured_job_title || "",
    cost_center_id: employee.cost_center_id || null,
    cost_center_code: employee.cost_center_code || "",
    cost_center_name: employee.cost_center_name || "",
    supervisor_id: employee.supervisor_id || null,
    supervisor_name: employee.supervisor_name || "",
    emergency_contact: employee.emergency_contact || "",
    photo_path: employee.photo_path || "",
    work_regime: employee.work_regime || "",
    standard_schedule: employee.standard_schedule || "",
    professional_category: employee.professional_category || "",
    payment_method: employee.payment_method || "bank_transfer",
    account_holder: employee.account_holder || "",
    contribution_regime: employee.contribution_regime || "",
    dependents: Number(employee.dependents || 0),
    exemptions: parseJsonArray(employee.exemptions_json),
    employment_status_detail: employee.employment_status_detail || "",
    sync_status: employee.sync_status || "synced",
    shift_id: employee.shift_id || null,
    shift_name: employee.shift_name || "",
    shift_profile: employee.shift_profile || "",
    notes: employee.notes || "",
    recurring_allowances: parseJsonArray(employee.recurring_allowances),
    recurring_bonuses: parseJsonArray(employee.recurring_bonuses),
    special_payments: parseJsonArray(employee.special_payments)
  }));
}

module.exports = {
  mapEmployeeListRows
};

