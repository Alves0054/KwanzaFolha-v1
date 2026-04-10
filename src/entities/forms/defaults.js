import { angolaBanks, normalizeIban, extractAngolaBankRegistryCode, inferBankFromIban } from "../company/banks";
import { shiftProfileOptions, weekdayOptions } from "../workforce/calendar";

export const initialEmployee = {
  full_name: "",
  document_type: "bi",
  bi: "",
  driver_license_number: "",
  nif: "",
  social_security_number: "",
  attendance_code: "",
  birth_date: "",
  gender: "",
  marital_status: "",
  nationality: "Angolana",
  personal_phone: "",
  personal_email: "",
  address: "",
  job_title: "",
  department: "",
  base_salary: "",
  contract_type: "Indeterminado",
  hire_date: "",
  shift_id: "",
  iban: "AO06",
  bank_code: "ATLANTICO",
  bank_account: "",
  status: "ativo",
  notes: "",
  recurring_allowances: [],
  recurring_bonuses: [],
  special_payments: []
};

export const initialEvent = {
  employee_id: "",
  event_type: "absence",
  event_date: new Date().toISOString().slice(0, 10),
  amount: "",
  quantity: 1,
  description: ""
};

export const initialLeaveRequest = {
  employee_id: "",
  record_type: "justified_absence",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  days: 1,
  reason: "",
  document_ref: "",
  proof_type: "",
  notes: "",
  affects_payroll: false,
  status: "pending",
  rejection_reason: ""
};

export const initialVacationBalance = {
  id: null,
  employee_id: "",
  year_ref: String(new Date().getFullYear()),
  entitled_days: 22,
  carried_days: 0,
  manual_adjustment: 0,
  notes: ""
};

export const initialVacationRequest = {
  employee_id: "",
  year_ref: String(new Date().getFullYear()),
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  days: 1,
  notes: "",
  status: "pending",
  rejection_reason: ""
};

export const initialAttendanceRecord = {
  employee_id: "",
  attendance_date: new Date().toISOString().slice(0, 10),
  status: "present",
  shift_id: "",
  check_in_time: "",
  check_out_time: "",
  punch_count: 0,
  hours_worked: 8,
  delay_minutes: 0,
  source: "manual",
  device_label: "",
  notes: ""
};

export const initialAttendanceImport = {
  source_type: "biometric",
  file_path: "",
  device_label: "",
  overwrite_imported: true
};

export const initialFinancialObligation = {
  id: null,
  employee_id: "",
  entry_type: "loan",
  label: "",
  principal_amount: "",
  installment_count: 1,
  installment_amount: "",
  start_month_ref: new Date().toISOString().slice(0, 7),
  notes: "",
  active: true
};

export const initialEmployeeDocument = {
  id: null,
  employee_id: "",
  category: "contract",
  title: "",
  document_number: "",
  issuer: "",
  issue_date: "",
  effective_date: "",
  expiry_date: "",
  alert_days_before: 30,
  notes: "",
  status: "active",
  file_path: "",
  file_name: "",
  stored_file_path: ""
};

export const initialSalaryScale = {
  id: null,
  job_title: "",
  department: "",
  min_salary: "",
  reference_salary: "",
  max_salary: "",
  notes: "",
  active: true
};

export const initialWorkShift = {
  id: null,
  code: "",
  name: "",
  department: "",
  profile: "general",
  start_time: "08:00",
  end_time: "17:00",
  tolerance_minutes: 15,
  break_minutes: 60,
  working_days: [1, 2, 3, 4, 5],
  notes: "",
  active: true
};

export const initialCompany = {
  name: "",
  nif: "",
  email: "",
  address: "",
  phone: "",
  logo_path: "",
  origin_bank_code: "",
  origin_account: ""
};

export const initialSettings = {
  currency: "Kz",
  inssEmployeeRate: 3,
  inssEmployerRate: 8,
  irtBrackets: "[]",
  activeFiscalProfileId: "",
  fiscalProfiles: [],
  resolvedFiscalProfile: null,
  fiscalProfileEditingId: "",
  fiscalProfileEffectiveFrom: new Date().toISOString().slice(0, 7),
  fiscalProfileName: "",
  fiscalProfileLegalReference: "",
  fiscalProfileNotes: "",
  allowanceTypes: "",
  bonusTypes: "",
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  smtpFromName: "Kwanza Folha",
  smtpFromEmail: "",
  attendanceAutoSyncEnabled: false,
  attendanceWatchedFolder: "",
  attendanceWatchedSourceType: "biometric",
  attendanceBiometricProfile: "generic",
  attendanceCardProfile: "card_generic",
  attendanceIncrementalImport: true,
  vacationMonth: 12,
  christmasMonth: 12
};

export const initialUserForm = {
  id: null,
  full_name: "",
  email: "",
  username: "",
  password: "",
  role: "operador",
  active: true
};

export const initialPasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
};

export const initialRegistrationForm = {
  company_name: "",
  company_nif: "",
  company_email: "",
  company_phone: "",
  company_address: "",
  full_name: "",
  admin_email: "",
  username: "",
  password: "",
  confirmPassword: ""
};

export const initialForgotPasswordForm = {
  identifier: "",
  resetToken: "",
  newPassword: "",
  confirmPassword: ""
};

export const initialLicenseActivationForm = {
  email: "",
  serialKey: ""
};

export const initialLicensePurchaseForm = {
  plan: "kwanzafolha-mensal",
  empresa: "",
  nif: "",
  email: "",
  telefone: "",
  serial_key: ""
};

export const initialResetPasswordForm = {
  userId: "",
  newPassword: ""
};

export function formatMoney(value) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "AOA",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

export function todayMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export { angolaBanks, normalizeIban, extractAngolaBankRegistryCode, inferBankFromIban, shiftProfileOptions, weekdayOptions };
