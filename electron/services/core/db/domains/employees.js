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

