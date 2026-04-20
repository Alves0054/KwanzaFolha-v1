const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3-multiple-ciphers");
const { execFileSync } = require("child_process");
const {
  buildFiscalProfile,
  buildDefaultFiscalProfile,
  getCurrentMonthRef,
  isPayrollRunUsingCurrentFiscalProfile,
  normalizeFiscalSettings,
  normalizeIrtBrackets,
  normalizeMonthRef,
  resolveFiscalProfileForMonth,
  summarizeFiscalProfile
} = require("./fiscal-config");
const {
  CURRENT_ANGOLA_FISCAL_PROFILE_ID,
  CURRENT_ANGOLA_FISCAL_PROFILE_NAME,
  CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS,
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  CURRENT_INSS_EMPLOYER_RATE_PERCENT,
  cloneFiscalBrackets
} = require("./core/fiscal");
const { buildAttendanceRecordsFilter } = require("./core/db/domains/attendance");
const {
  applyEmployeeDocumentClientFilters,
  buildEmployeeDocumentsFilter
} = require("./core/db/domains/employee-documents");
const { buildAuditLogsFilter, mapAuditRows } = require("./core/db/domains/audit");
const { mapEmployeeListRows } = require("./core/db/domains/employees");
const { buildPayrollRunsFilter, mapPayrollRunRows } = require("./core/db/domains/payroll-runs");
const {
  ATTENDANCE_PERIODS_SELECT,
  PAYROLL_PERIODS_SELECT,
  buildDefaultAttendancePeriod
} = require("./core/db/domains/periods");
const {
  buildClosePayrollPeriodPayload,
  buildDefaultPayrollPeriod,
  buildReopenPayrollPeriodPayload
} = require("./core/db/domains/payroll-periods");
const {
  saveAttendanceRecord: saveAttendanceRecordDomain,
  deleteAttendanceRecord: deleteAttendanceRecordDomain,
  approveAttendanceAdjustments: approveAttendanceAdjustmentsDomain,
  closeAttendancePeriod: closeAttendancePeriodDomain,
  reopenAttendancePeriod: reopenAttendancePeriodDomain
} = require("./core/db/domains/attendance-write");
const {
  saveEmployeeDocument: saveEmployeeDocumentDomain,
  deleteEmployeeDocument: deleteEmployeeDocumentDomain
} = require("./core/db/domains/employee-documents-write");
const { recordAudit: recordAuditDomain } = require("./core/db/domains/audit-write");
const {
  closePayrollPeriod: closePayrollPeriodDomain,
  reopenPayrollPeriod: reopenPayrollPeriodDomain
} = require("./core/db/domains/payroll-periods-write");

const DEFAULT_IRT_BRACKETS = cloneFiscalBrackets(CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS);

const DEFAULT_SETTINGS = {
  currency: "Kz",
  inssEmployeeRate: CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  inssEmployerRate: CURRENT_INSS_EMPLOYER_RATE_PERCENT,
  irtBrackets: DEFAULT_IRT_BRACKETS,
  activeFiscalProfileId: CURRENT_ANGOLA_FISCAL_PROFILE_ID,
  fiscalProfiles: [
    buildDefaultFiscalProfile({
      id: CURRENT_ANGOLA_FISCAL_PROFILE_ID,
      name: CURRENT_ANGOLA_FISCAL_PROFILE_NAME,
      inssEmployeeRate: CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
      inssEmployerRate: CURRENT_INSS_EMPLOYER_RATE_PERCENT,
      irtBrackets: DEFAULT_IRT_BRACKETS
    })
  ],
  allowanceTypes: ["Alimentacao", "Transporte", "Comunicacao"],
  bonusTypes: ["Desempenho", "Pontualidade", "Resultado"],
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  smtpFromName: "Kwanza Folha",
  smtpFromEmail: "",
  attendanceDelayPenaltyThresholdMinutes: 240,
  attendanceDelayPenaltyEquivalentDays: 0.5,
  attendanceAutoSyncEnabled: false,
  attendanceWatchedFolder: "",
  attendanceWatchedSourceType: "biometric",
  attendanceBiometricProfile: "generic",
  attendanceCardProfile: "card_generic",
  attendanceIncrementalImport: true,
  vacationMonth: 12,
  christmasMonth: 12,
  companyLogo: "",
  licenseTrialStartedAt: ""
};

const DEFAULT_VACATION_ENTITLEMENT = 22;
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];
const SHIFT_PROFILES = ["general", "docente_morning", "docente_afternoon", "docente_evening", "docente_flexible"];
const ATTENDANCE_SOURCES = ["manual", "biometric_import", "card_import"];
const ATTENDANCE_APPROVAL_STATUSES = ["pending", "approved"];
const ATTENDANCE_DEVICE_PROFILES = ["generic", "zkteco", "hikvision", "anviz", "suprema", "card_generic"];
const ATTENDANCE_IMPORT_MODES = ["manual", "watched_folder"];
const ATTENDANCE_SYNC_STATUSES = ["processed", "duplicate", "error"];
const BCRYPT_ROUNDS = 10;
const SESSION_STATE_VERSION = 1;
const SESSION_SECRET_BYTES = 32;
const DATA_PROTECTION_VERSION = 1;
const DATA_PROTECTION_SECRET_BYTES = 32;
const DATA_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const DATA_ENCRYPTION_IV_BYTES = 12;
const DATA_ENCRYPTION_MARKER = "kwanza-folha-encrypted-file";
const DATABASE_ENCRYPTION_PURPOSE = "database";
const BACKUP_ENCRYPTION_PURPOSE = "backup";
const SQLCIPHER_COMPATIBILITY_MODE = "sqlcipher";
const SQLCIPHER_LEGACY_VERSION = 4;
const PASSWORD_RESET_TOKEN_SEGMENT_LENGTH = 4;
const PASSWORD_RESET_TOKEN_SEGMENT_COUNT = 3;
const PASSWORD_RESET_EXPIRY_MINUTES = 15;
const AGT_SUBMISSION_STATUSES = ["draft", "ready", "submitted", "accepted", "rejected"];
const CURRENT_SCHEMA_VERSION = 5;
const EMPLOYEE_DOCUMENT_CATEGORIES = [
  "contract",
  "contract_addendum",
  "identification",
  "tax",
  "social_security",
  "medical",
  "disciplinary",
  "payroll_support",
  "other"
];
const EMPLOYEE_DOCUMENT_STATUSES = ["active", "archived"];
const SCHEMA_INDEX_STATEMENTS = [
  "CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
  "CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)",
  "CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department)",
  "CREATE INDEX IF NOT EXISTS idx_employees_shift_id ON employees(shift_id)",
  "CREATE INDEX IF NOT EXISTS idx_employees_attendance_code ON employees(attendance_code)",
  "CREATE INDEX IF NOT EXISTS idx_employees_hire_date ON employees(hire_date)",
  "CREATE INDEX IF NOT EXISTS idx_payroll_events_employee_date ON payroll_events(employee_id, event_date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_payroll_events_month_ref ON payroll_events(substr(event_date, 1, 7), event_type)",
  "CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_dates ON leave_requests(employee_id, start_date, end_date)",
  "CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status)",
  "CREATE INDEX IF NOT EXISTS idx_vacation_requests_employee_year ON vacation_requests(employee_id, year_ref)",
  "CREATE INDEX IF NOT EXISTS idx_vacation_requests_status ON vacation_requests(status)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_import_batches_month_ref ON attendance_import_batches(month_ref, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_import_batches_file_hash ON attendance_import_batches(file_hash)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_import_logs_batch_id ON attendance_import_logs(batch_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_import_logs_employee_date ON attendance_import_logs(employee_id, attendance_date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_import_logs_month_ref ON attendance_import_logs(substr(attendance_date, 1, 7), outcome)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_records_month_ref ON attendance_records(substr(attendance_date, 1, 7), approval_status)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON attendance_records(status, attendance_date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_records_batch_id ON attendance_records(batch_id)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_records_shift_id ON attendance_records(shift_id)",
  "CREATE INDEX IF NOT EXISTS idx_financial_obligations_employee_month ON financial_obligations(employee_id, start_month_ref)",
  "CREATE INDEX IF NOT EXISTS idx_financial_obligations_active ON financial_obligations(active, start_month_ref)",
  "CREATE INDEX IF NOT EXISTS idx_payroll_runs_month_generated_at ON payroll_runs(month_ref, generated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_payroll_runs_employee_id ON payroll_runs(employee_id, generated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_agt_monthly_submissions_status ON agt_monthly_submissions(status, month_ref DESC)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_month_ref ON audit_logs(month_ref, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id, created_at DESC)"
];
const EMPLOYEE_DOCUMENT_INDEX_STATEMENTS = [
  "CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_employee_documents_category ON employee_documents(category, status)",
  "CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry_date ON employee_documents(expiry_date, status)"
];

const BANK_EXPORT_CODES = {
  ATLANTICO: "ATL",
  BAI: "BAI",
  BFA: "BFA",
  BIC: "BIC",
  BPC: "BPC",
  SBA: "SBA",
  BCI: "BCI",
  BNI: "BNI",
  BCA: "BCA",
  BDA: "BDA",
  BIR: "BIR",
  BKEVE: "BKEVE",
  BVALOR: "BVALOR",
  BSOL: "BSOL",
  BCS: "BCS",
  BYETU: "BYETU",
  ACCESS: "ACCESS",
  BCGA: "BCGA",
  BCH: "BCH",
  BOC: "BOC"
};

const BANK_REGISTRY_CODES = {
  ATLANTICO: ["0055", "0054"],
  BAI: ["0040"],
  BFA: ["0006"],
  BIC: ["0051", "0005"],
  SBA: ["0060"],
  BSOL: ["0044"]
};

function nowIso() {
  return new Date().toISOString();
}

function safeUnlink(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    try {
      fs.unlinkSync(targetPath);
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOENT"].includes(String(error?.code || ""))) {
        throw error;
      }
    }
  }
}

function safeReadJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function areDigestsEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function parseEncryptedEnvelope(rawContent) {
  try {
    const envelope = JSON.parse(String(rawContent || ""));
    if (
      envelope &&
      envelope.marker === DATA_ENCRYPTION_MARKER &&
      Number(envelope.version) === DATA_PROTECTION_VERSION &&
      typeof envelope.purpose === "string" &&
      typeof envelope.iv === "string" &&
      typeof envelope.tag === "string" &&
      typeof envelope.ciphertext === "string"
    ) {
      return envelope;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function roundCurrency(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function areFiscalRuleFieldsEqual(left = {}, right = {}) {
  return (
    Number(left.inssEmployeeRate || 0) === Number(right.inssEmployeeRate || 0) &&
    Number(left.inssEmployerRate || 0) === Number(right.inssEmployerRate || 0) &&
    JSON.stringify(normalizeIrtBrackets(left.irtBrackets || [])) ===
      JSON.stringify(normalizeIrtBrackets(right.irtBrackets || []))
  );
}

function createFiscalProfileId(baseId, effectiveFrom, profiles = []) {
  const normalizedBase = String(baseId || "perfil-fiscal")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-\d{6}(?:-\d+)?$/, "") || "perfil-fiscal";
  const monthToken = String(effectiveFrom || getCurrentMonthRef()).replace("-", "");
  const existingIds = new Set((profiles || []).map((profile) => String(profile?.id || "").trim()));
  let candidate = `${normalizedBase}-${monthToken}`;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${normalizedBase}-${monthToken}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function sanitizeStoredSettingsPayload(settings = {}) {
  const sanitized = { ...settings };
  delete sanitized.resolvedFiscalProfile;
  delete sanitized.fiscalProfileEditingId;
  delete sanitized.fiscalProfileEffectiveFrom;
  delete sanitized.fiscalProfileName;
  delete sanitized.fiscalProfileLegalReference;
  delete sanitized.fiscalProfileNotes;
  return sanitized;
}

function legacyHashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

function hashPassword(password) {
  return bcrypt.hashSync(String(password || ""), BCRYPT_ROUNDS);
}

function verifyPassword(password, passwordHash) {
  const normalizedHash = String(passwordHash || "").trim();
  if (!normalizedHash) {
    return false;
  }

  if (isBcryptHash(normalizedHash)) {
    return bcrypt.compareSync(String(password || ""), normalizedHash);
  }

  return normalizedHash === legacyHashPassword(password);
}

function needsPasswordRehash(passwordHash) {
  return Boolean(passwordHash) && !isBcryptHash(passwordHash);
}

function isValidEmail(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized);
}

function generatePasswordResetToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const totalLength = PASSWORD_RESET_TOKEN_SEGMENT_LENGTH * PASSWORD_RESET_TOKEN_SEGMENT_COUNT;
  const bytes = crypto.randomBytes(totalLength);
  let token = "";

  for (let index = 0; index < totalLength; index += 1) {
    token += alphabet[bytes[index] % alphabet.length];
  }

  const parts = [];
  for (let index = 0; index < totalLength; index += PASSWORD_RESET_TOKEN_SEGMENT_LENGTH) {
    parts.push(token.slice(index, index + PASSWORD_RESET_TOKEN_SEGMENT_LENGTH));
  }

  return parts.join("-");
}

function normalizePasswordResetToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function hashPasswordResetToken(value) {
  const normalized = normalizePasswordResetToken(value);
  if (!normalized) {
    return "";
  }

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function addMinutesToIso(isoValue, minutes) {
  const baseDate = isoValue ? new Date(isoValue) : new Date();
  return new Date(baseDate.getTime() + Number(minutes || 0) * 60000).toISOString();
}

function maskEmailAddress(value) {
  const normalized = String(value || "").trim();
  const [localPart, domain = ""] = normalized.split("@");
  if (!localPart || !domain) {
    return normalized;
  }

  const visibleLocal =
    localPart.length <= 2
      ? `${localPart[0] || ""}*`
      : `${localPart.slice(0, 2)}${"*".repeat(Math.max(localPart.length - 2, 1))}`;

  return `${visibleLocal}@${domain}`;
}

function isDefaultSeedUser(user) {
  return Boolean(
    user &&
      String(user.username || "").trim().toLowerCase() === "admin" &&
      String(user.full_name || "").trim() === "Administrador" &&
      String(user.role || "").trim() === "admin" &&
      Number(user.active || 0) === 1 &&
      Number(user.must_change_password || 0) === 1 &&
      verifyPassword("admin123", user.password_hash)
  );
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeIban(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function normalizeBankAccount(value) {
  return String(value || "").replace(/\s+/g, "");
}

function extractAngolaBankRegistryCode(iban) {
  const normalized = normalizeIban(iban);
  return /^AO\d{23}$/.test(normalized) ? normalized.slice(4, 8) : "";
}

function resolveBankCodeFromRegistryCode(registryCode) {
  const normalized = String(registryCode || "").trim();
  if (!normalized) {
    return "";
  }

  return (
    Object.entries(BANK_REGISTRY_CODES).find(([, registryCodes]) =>
      (registryCodes || []).map((item) => String(item || "")).includes(normalized)
    )?.[0] || ""
  );
}

function validatePrimaryDocument(documentType, value) {
  const normalizedType = String(documentType || "bi").trim().toLowerCase();
  const normalizedValue = String(value || "").trim().toUpperCase();

  if (!normalizedValue) {
    return { ok: false, message: "Indique o número do documento principal do funcionário." };
  }

  if (normalizedType === "bi") {
    if (!/^\d{9}[A-Z]{2}\d{3}$/.test(normalizedValue)) {
      return {
        ok: false,
        message: "O BI do funcionário deve seguir o formato angolano, por exemplo 123456789LA042."
      };
    }
    return { ok: true };
  }

  if (!/^[A-Z0-9-]{5,30}$/.test(normalizedValue)) {
    return {
      ok: false,
      message: "O número do documento principal deve conter entre 5 e 30 caracteres válidos."
    };
  }

  return { ok: true };
}

function resolveDomesticAccountNumber(row) {
  const manualAccount = normalizeBankAccount(row?.bank_account);
  if (manualAccount) return manualAccount;

  const iban = normalizeIban(row?.iban);
  if (/^AO\d{2}[A-Z0-9]+$/.test(iban)) {
    return iban.slice(4);
  }
  return "";
}

function resolveBankExportCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return BANK_EXPORT_CODES[normalized] || normalized;
}

function hashFileContent(content) {
  return crypto.createHash("sha256").update(String(content || ""), "utf8").digest("hex");
}

function sanitizeFileNameSegment(value, fallback = "documento") {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || fallback;
}

function normalizeAttendanceDeviceProfile(value, sourceType = "biometric") {
  const fallback = sourceType === "card" ? "card_generic" : "generic";
  const normalized = String(value || fallback).trim().toLowerCase();
  return ATTENDANCE_DEVICE_PROFILES.includes(normalized) ? normalized : fallback;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }
  const [year, month, day] = String(value).split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function inclusiveDateDiff(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86400000) + 1;
}

function enumerateMonthRefs(startDate, endDate) {
  const refs = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  current.setUTCDate(1);
  end.setUTCDate(1);
  while (current <= end) {
    refs.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`);
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return refs;
}

function isValidMonthRef(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return false;
  }
  const [year, month] = normalized.split("-").map(Number);
  return year >= 1900 && month >= 1 && month <= 12;
}

function monthRefFromDate(dateValue) {
  return isValidIsoDate(dateValue) ? String(dateValue).slice(0, 7) : "";
}

function buildReportPeriodLabel(filters = {}) {
  if (filters.startDate && filters.endDate) {
    return filters.startDate === filters.endDate
      ? filters.startDate
      : `${filters.startDate} a ${filters.endDate}`;
  }
  if (filters.monthRef) {
    return filters.monthRef;
  }
  return "geral";
}

function buildReportPeriodFileLabel(filters = {}) {
  const base = buildReportPeriodLabel(filters);
  return String(base || "geral").replace(/[^\dA-Za-z-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "geral";
}

function normalizeReportFilters(input = {}, fallbackMonthRef = "") {
  const source =
    typeof input === "string"
      ? { monthRef: input }
      : input && typeof input === "object"
        ? { ...input }
        : {};
  const monthRefCandidate = String(source.monthRef || fallbackMonthRef || "").trim();
  const monthRef = isValidMonthRef(monthRefCandidate) ? monthRefCandidate : "";
  let startDate = isValidIsoDate(source.startDate) ? String(source.startDate) : "";
  let endDate = isValidIsoDate(source.endDate) ? String(source.endDate) : "";

  if ((!startDate || !endDate) && monthRef) {
    const monthRange = getMonthDateRange(monthRef);
    startDate = startDate || monthRange?.startDate || "";
    endDate = endDate || monthRange?.endDate || "";
  }

  if (startDate && !endDate) {
    endDate = startDate;
  }
  if (endDate && !startDate) {
    startDate = endDate;
  }
  if (startDate && endDate && startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  const startMonthRef = monthRefFromDate(startDate) || monthRef;
  const endMonthRef = monthRefFromDate(endDate) || monthRef;
  const employeeId = source.employeeId === undefined || source.employeeId === null ? "" : String(source.employeeId).trim();

  return {
    monthRef,
    startDate,
    endDate,
    startMonthRef,
    endMonthRef,
    employeeId,
    hasDateRange: Boolean(startDate && endDate),
    periodLabel: buildReportPeriodLabel({ monthRef, startDate, endDate }),
    periodFileLabel: buildReportPeriodFileLabel({ monthRef, startDate, endDate })
  };
}

function overlapsDateRange(startDate, endDate, filters = {}) {
  const normalizedFilters = normalizeReportFilters(filters);
  if (!startDate || !endDate) {
    return false;
  }
  if (!normalizedFilters.startDate || !normalizedFilters.endDate) {
    return true;
  }
  return startDate <= normalizedFilters.endDate && endDate >= normalizedFilters.startDate;
}

function normalizeEmployeeDocumentCategory(value) {
  const normalized = String(value || "other").trim().toLowerCase();
  return EMPLOYEE_DOCUMENT_CATEGORIES.includes(normalized) ? normalized : "other";
}

function normalizeEmployeeDocumentStatus(value) {
  const normalized = String(value || "active").trim().toLowerCase();
  return EMPLOYEE_DOCUMENT_STATUSES.includes(normalized) ? normalized : "active";
}

function calculateDaysUntilDate(targetDate, referenceDate = new Date()) {
  if (!isValidIsoDate(targetDate)) {
    return null;
  }

  const [targetYear, targetMonth, targetDay] = String(targetDate).split("-").map(Number);
  const targetUtc = Date.UTC(targetYear, targetMonth - 1, targetDay);
  const referenceUtc = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );

  return Math.floor((targetUtc - referenceUtc) / 86400000);
}

function calculateEmployeeDocumentLifecycleStatus(expiryDate, status = "active", alertDaysBefore = 30) {
  const normalizedStatus = normalizeEmployeeDocumentStatus(status);
  if (normalizedStatus === "archived") {
    return { lifecycle_status: "archived", days_until_expiry: null };
  }

  const daysUntilExpiry = calculateDaysUntilDate(expiryDate);
  if (daysUntilExpiry === null) {
    return { lifecycle_status: "active", days_until_expiry: null };
  }

  if (daysUntilExpiry < 0) {
    return { lifecycle_status: "expired", days_until_expiry: daysUntilExpiry };
  }

  const normalizedAlertDays = Math.max(0, Number(alertDaysBefore || 0));
  if (daysUntilExpiry <= normalizedAlertDays) {
    return { lifecycle_status: "expiring", days_until_expiry: daysUntilExpiry };
  }

  return { lifecycle_status: "active", days_until_expiry: daysUntilExpiry };
}

function normalizeAgtSubmissionStatus(value) {
  const normalized = String(value || "draft").trim().toLowerCase();
  return AGT_SUBMISSION_STATUSES.includes(normalized) ? normalized : "draft";
}

function buildDefaultAgtMonthlySubmission(monthRef = "") {
  return {
    month_ref: String(monthRef || "").trim(),
    status: "draft",
    submission_mode: "manual",
    proof_reference: "",
    proof_path: "",
    notes: "",
    exported_at: null,
    submitted_at: null,
    submitted_by_user_id: null,
    submitted_by_name: "",
    updated_at: null,
    validation: {}
  };
}

function monthRefDiff(startMonthRef, targetMonthRef) {
  const [startYear, startMonth] = String(startMonthRef || "").split("-").map(Number);
  const [targetYear, targetMonth] = String(targetMonthRef || "").split("-").map(Number);
  return (targetYear - startYear) * 12 + (targetMonth - startMonth);
}

function enumerateInstallmentMonths(startMonthRef, installmentCount) {
  if (!isValidMonthRef(startMonthRef)) {
    return [];
  }
  const [year, month] = String(startMonthRef).split("-").map(Number);
  const refs = [];
  for (let index = 0; index < Number(installmentCount || 0); index += 1) {
    const current = new Date(Date.UTC(year, month - 1 + index, 1));
    refs.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return refs;
}

function buildInstallmentSchedule(principalAmount, installmentCount, preferredInstallmentAmount = 0) {
  const total = roundCurrency(principalAmount);
  const count = Math.max(1, Number(installmentCount || 1));
  const rawInstallment = Number(preferredInstallmentAmount || 0) > 0
    ? roundCurrency(preferredInstallmentAmount)
    : roundCurrency(total / count);
  const schedule = [];
  let remaining = total;

  for (let index = 0; index < count; index += 1) {
    const amount = index === count - 1 ? roundCurrency(remaining) : roundCurrency(Math.min(rawInstallment, remaining));
    schedule.push(amount);
    remaining = roundCurrency(remaining - amount);
  }

  return schedule;
}

function validateIbanChecksum(iban) {
  const compact = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) {
    return false;
  }

  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let numeric = "";
  for (const character of rearranged) {
    if (/[A-Z]/.test(character)) {
      numeric += String(character.charCodeAt(0) - 55);
    } else {
      numeric += character;
    }
  }

  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function pickFields(source, fields) {
  return fields.reduce((acc, field) => {
    acc[field] = source?.[field] ?? null;
    return acc;
  }, {});
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildExcelTableDocument(title, headers, rows) {
  const headerCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const bodyRows = rows.map((row) => (
    `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
  )).join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; margin: 24px; }
      h1 { color: #003366; font-size: 20pt; margin-bottom: 18px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d0d7e2; padding: 8px 10px; font-size: 11pt; }
      th { background: #eaf2ff; color: #003366; text-align: left; }
      tr:nth-child(even) td { background: #f7f9fc; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body>
</html>`;
}

function formatAttendanceStatusLabel(status) {
  const labels = {
    present: "Presente",
    delay: "Atraso",
    absent: "Falta",
    half_absence: "Meia falta",
    leave: "Licença",
    vacation: "Férias"
  };
  return labels[String(status || "").trim().toLowerCase()] || String(status || "");
}

function isAttendancePresenceStatus(status) {
  return ["present", "delay"].includes(String(status || "").trim().toLowerCase());
}

function enumerateDatesWithinMonth(startDate, endDate, monthRef) {
  const range = getMonthDateRange(monthRef);
  if (!range || !startDate || !endDate) {
    return [];
  }

  const effectiveStart = startDate > range.startDate ? startDate : range.startDate;
  const effectiveEnd = endDate < range.endDate ? endDate : range.endDate;
  if (effectiveStart > effectiveEnd) {
    return [];
  }

  const dates = [];
  const cursor = new Date(`${effectiveStart}T00:00:00Z`);
  const limit = new Date(`${effectiveEnd}T00:00:00Z`);
  while (cursor <= limit) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function getMonthDateRange(monthRef) {
  if (!isValidMonthRef(monthRef)) {
    return null;
  }

  const [year, month] = String(monthRef).split("-").map(Number);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { year, month, startDate, endDate };
}

function toWorkingDayNumber(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function overlapsMonthRange(startDate, endDate, monthRef) {
  const range = getMonthDateRange(monthRef);
  if (!range || !startDate || !endDate) {
    return false;
  }
  return startDate <= range.endDate && endDate >= range.startDate;
}

function overlapDaysWithinMonth(startDate, endDate, monthRef) {
  const range = getMonthDateRange(monthRef);
  if (!range || !startDate || !endDate) {
    return 0;
  }

  const effectiveStart = startDate > range.startDate ? startDate : range.startDate;
  const effectiveEnd = endDate < range.endDate ? endDate : range.endDate;
  if (effectiveStart > effectiveEnd) {
    return 0;
  }
  return inclusiveDateDiff(effectiveStart, effectiveEnd);
}

function countWorkingDaysInMonth(monthRef, workingDays = DEFAULT_WORKING_DAYS) {
  const range = getMonthDateRange(monthRef);
  if (!range) {
    return 0;
  }

  const normalizedDays = normalizeWorkingDays(workingDays);
  let total = 0;
  for (let day = 1; day <= Number(range.endDate.slice(-2)); day += 1) {
    const dateValue = `${range.year}-${String(range.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (normalizedDays.includes(toWorkingDayNumber(dateValue))) {
      total += 1;
    }
  }
  return total;
}

function describeWorkingDays(workingDays = DEFAULT_WORKING_DAYS) {
  const names = {
    1: "Seg",
    2: "Ter",
    3: "Qua",
    4: "Qui",
    5: "Sex",
    6: "Sáb",
    7: "Dom"
  };

  return normalizeWorkingDays(workingDays)
    .map((day) => names[day] || String(day))
    .join(", ");
}

function calculateShiftHours(startTime, endTime, breakMinutes = 0) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start) {
    return 0;
  }
  return roundCurrency(Math.max(end - start - Number(breakMinutes || 0), 0) / 60);
}

function calculateClassBlocksHours(blocks = []) {
  return roundCurrency(
    (Array.isArray(blocks) ? blocks : []).reduce((sum, block) => {
      const start = timeToMinutes(block?.start_time);
      const end = timeToMinutes(block?.end_time);
      if (start === null || end === null || end <= start) {
        return sum;
      }
      return sum + (end - start) / 60;
    }, 0)
  );
}

function normalizeTimeValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return "";
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) {
    return null;
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculateWorkedHoursFromPunches(checkInTime, checkOutTime, breakMinutes = 0) {
  const start = timeToMinutes(checkInTime);
  const end = timeToMinutes(checkOutTime);
  if (start === null || end === null || end < start) {
    return 0;
  }

  return roundCurrency(Math.max(end - start - Number(breakMinutes || 0), 0) / 60);
}

function inferPunchCount(checkInTime, checkOutTime, explicitCount = 0) {
  const parsedCount = Number(explicitCount || 0);
  if (Number.isInteger(parsedCount) && parsedCount > 0) {
    return parsedCount;
  }

  const hasCheckIn = Boolean(normalizeTimeValue(checkInTime));
  const hasCheckOut = Boolean(normalizeTimeValue(checkOutTime));
  if (hasCheckIn && hasCheckOut) {
    return normalizeTimeValue(checkInTime) === normalizeTimeValue(checkOutTime) ? 1 : 2;
  }
  if (hasCheckIn || hasCheckOut) {
    return 1;
  }
  return 0;
}

function normalizeWorkingDays(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[,\s;|]+/)
      .map((item) => item.trim())
      .filter(Boolean);

  const normalized = Array.from(
    new Set(values.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1 && item <= 7))
  );
  return normalized.length ? normalized.sort((left, right) => left - right) : [...DEFAULT_WORKING_DAYS];
}

function buildDocenteBlocks(profile, startTime, endTime) {
  const normalizedProfile = String(profile || "").trim().toLowerCase();
  const start = normalizeTimeValue(startTime);
  const end = normalizeTimeValue(endTime);
  if (!start || !end) {
    return [];
  }

  const presets = {
    docente_morning: [
      { label: "Bloco letivo da manhã", start_time: start, end_time: end }
    ],
    docente_afternoon: [
      { label: "Bloco letivo da tarde", start_time: start, end_time: end }
    ],
    docente_evening: [
      { label: "Bloco letivo da noite", start_time: start, end_time: end }
    ],
    docente_flexible: [
      { label: "Bloco letivo flexível", start_time: start, end_time: end }
    ]
  };

  return presets[normalizedProfile] || [];
}

function normalizeImportedDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (isValidIsoDate(raw)) {
    return raw;
  }

  let match = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (match) {
    const normalized = `${match[3]}-${match[2]}-${match[1]}`;
    return isValidIsoDate(normalized) ? normalized : "";
  }

  match = raw.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (match) {
    const normalized = `${match[1]}-${match[2]}-${match[3]}`;
    return isValidIsoDate(normalized) ? normalized : "";
  }

  return "";
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function detectAttendanceDelimiter(line) {
  const delimiters = [";", ",", "\t", "|"];
  return delimiters
    .map((delimiter) => ({ delimiter, hits: String(line || "").split(delimiter).length - 1 }))
    .sort((left, right) => right.hits - left.hits)[0]?.delimiter || ";";
}

function normalizeImportHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapImportedAttendanceStatus(value) {
  const normalized = normalizeImportHeader(value);
  const aliases = {
    presente: "present",
    present: "present",
    entrada: "present",
    saida: "present",
    atraso: "delay",
    delay: "delay",
    falta: "absent",
    absent: "absent",
    meia_falta: "half_absence",
    half_absence: "half_absence",
    licenca: "leave",
    leave: "leave",
    ferias: "vacation",
    vacation: "vacation"
  };
  return aliases[normalized] || "";
}

function parseAttendanceImportContent(content) {
  const lines = String(content || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const delimiter = detectAttendanceDelimiter(lines[0]);
  const parsedLines = lines.map((line) => splitDelimitedLine(line, delimiter));
  const headerAliases = {
    employee_code: "employee_code",
    codigo: "employee_code",
    codigo_funcionario: "employee_code",
    codigo_biometrico: "employee_code",
    codigo_cartao: "employee_code",
    cartao: "employee_code",
    badge: "employee_code",
    matricula: "employee_code",
    mecanografico: "employee_code",
    funcionario_id: "employee_code",
    employee_id: "employee_code",
    data: "date",
    date: "date",
    datetime: "datetime",
    data_hora: "datetime",
    hora: "time",
    time: "time",
    estado: "status",
    status: "status",
    tipo: "status",
    tipo_registo: "status",
    dispositivo: "device",
    equipamento: "device",
    terminal: "device",
    device: "device"
  };

  const firstHeaders = parsedLines[0].map((item) => headerAliases[normalizeImportHeader(item)] || "");
  const hasHeader = firstHeaders.filter(Boolean).length >= 2 && firstHeaders.includes("employee_code") && (firstHeaders.includes("date") || firstHeaders.includes("datetime"));
  const rows = [];
  const dataLines = hasHeader ? parsedLines.slice(1) : parsedLines;

  dataLines.forEach((columns) => {
    const getValue = (key) => {
      const headerIndex = hasHeader ? firstHeaders.indexOf(key) : -1;
      if (headerIndex >= 0) {
        return columns[headerIndex] || "";
      }

      if (!hasHeader) {
        if (key === "employee_code") return columns[0] || "";
        if (key === "date" && columns.length >= 2) return columns[1] || "";
        if (key === "time" && columns.length >= 3) return columns[2] || "";
        if (key === "status" && columns.length >= 4) return columns[3] || "";
        if (key === "device" && columns.length >= 5) return columns[4] || "";
      }

      return "";
    };

    const employeeCode = String(getValue("employee_code")).trim();
    let date = String(getValue("date")).trim();
    let time = String(getValue("time")).trim();
    const datetime = String(getValue("datetime")).trim();
    const status = String(getValue("status")).trim();
    const device = String(getValue("device")).trim();

    if (!date && datetime) {
      const parts = datetime.replace("T", " ").split(/\s+/);
      date = parts[0] || "";
      time = parts[1] || "";
    }

    const normalizedDate = normalizeImportedDate(date);
    const normalizedTime = normalizeTimeValue(time);

    if (!employeeCode || !normalizedDate) {
      return;
    }

    rows.push({
      employee_code: employeeCode,
      attendance_date: normalizedDate,
      time: normalizedTime,
      status: mapImportedAttendanceStatus(status),
      device_label: device
    });
  });

  return rows;
}

class DatabaseService {
  constructor(basePath, documentsPath = null, options = {}) {
    const { secureStorage = null, installationIdentity = null, programDataPath = null } = options || {};
    this.basePath = basePath;
    this.documentsRoot = documentsPath || basePath;
    this.secureStorage = secureStorage;
    this.installationIdentity = installationIdentity;
    this.programDataPath = programDataPath || null;
    this.workspaceDir = path.join(this.documentsRoot, "Kwanza Folha");
    this.protectedDataRoot = this.programDataPath ? path.join(this.programDataPath, "LocalState") : basePath;
    this.legacyDbPath = path.join(basePath, "kwanza-folha.sqlite");
    this.legacyRuntimeDbPath = path.join(basePath, "kwanza-folha.runtime.sqlite");
    this.legacyEncryptedDbPath = path.join(basePath, "kwanza-folha.sqlite.enc");
    this.dbPath = path.join(this.protectedDataRoot, "kwanza-folha.sqlite");
    this.encryptedDbPath = path.join(this.protectedDataRoot, "kwanza-folha.sqlite.enc");
    this.backupDir = path.join(this.workspaceDir, "Backups");
    this.exportsDir = path.join(this.workspaceDir, "PDF");
    this.bankExportsDir = path.join(this.workspaceDir, "Exportacoes Bancarias");
    this.auditExportsDir = path.join(this.workspaceDir, "Auditoria");
    this.excelExportsDir = path.join(this.workspaceDir, "Excel");
    this.employeeDocumentsDir = path.join(this.workspaceDir, "Documentos Laborais");
    this.sessionPath = path.join(basePath, "session-state.json");
    this.sessionSecretPath = path.join(basePath, "session-state.key");
    this.backupStatePath = path.join(this.basePath, "backup-state.json");
    this.dataProtectionKeyPath = path.join(basePath, "data-protection.key");
    this.sessionSecret = null;
    this.dataProtectionSecret = null;
    fs.mkdirSync(this.protectedDataRoot, { recursive: true });
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.mkdirSync(this.exportsDir, { recursive: true });
    fs.mkdirSync(this.bankExportsDir, { recursive: true });
    fs.mkdirSync(this.auditExportsDir, { recursive: true });
    fs.mkdirSync(this.excelExportsDir, { recursive: true });
    fs.mkdirSync(this.employeeDocumentsDir, { recursive: true });
    this.ensureProtectedDataDirectory();
    this.ensureRuntimeDatabaseAvailable();
    this.openConnection();
    this.setupSchema();
    this.seedDefaults();
    this.migrateLegacyProtectedSecrets();
    this.syncEncryptedDatabaseSnapshot();
  }

  openConnection() {
    this.ensureRuntimeDatabaseAvailable();
    let connection = null;

    try {
      connection = new Database(this.dbPath);
      this.applySqlCipherPragmas(connection);
      this.verifySqlCipherConnection(connection);
    } catch (error) {
      if (connection?.open) {
        connection.close();
      }
      const normalizedMessage = String(error?.message || "").toLowerCase();
      const recoverableRuntimeError =
        normalizedMessage.includes("file is not a database") ||
        normalizedMessage.includes("database disk image is malformed");

      let migratedLegacyPlaintext = false;
      if (fs.existsSync(this.dbPath)) {
        try {
          migratedLegacyPlaintext = this.migratePlaintextDatabaseInPlace(this.dbPath);
        } catch {
          migratedLegacyPlaintext = false;
        }
      }

      if (migratedLegacyPlaintext) {
        try {
          connection = new Database(this.dbPath);
          this.applySqlCipherPragmas(connection);
          this.verifySqlCipherConnection(connection);
        } catch (migrationError) {
          if (connection?.open) {
            connection.close();
          }
          const migrationMessage = String(migrationError?.message || "").toLowerCase();
          if (
            migrationMessage.includes("file is not a database") ||
            migrationMessage.includes("database disk image is malformed")
          ) {
            connection = this.openFreshRuntimeConnection();
          } else {
            throw migrationError;
          }
        }
      } else if (recoverableRuntimeError) {
        const recovery = this.recoverRuntimeDatabaseFromCorruption(error);
        if (recovery.ok) {
          try {
            connection = new Database(this.dbPath);
            this.applySqlCipherPragmas(connection);
            this.verifySqlCipherConnection(connection);
          } catch (recoveryOpenError) {
            if (connection?.open) {
              connection.close();
            }
            connection = this.openFreshRuntimeConnection();
          }
          this.lastRuntimeRecovery = recovery;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    this.db = connection;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
  }

  runWindowsHardeningCommand(args = []) {
    if (process.platform !== "win32") {
      return false;
    }

    try {
      execFileSync(args[0], args.slice(1), {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"]
      });
      return true;
    } catch {
      return false;
    }
  }

  ensureProtectedDataDirectory() {
    fs.mkdirSync(this.protectedDataRoot, { recursive: true });
    if (this.programDataPath && process.platform === "win32") {
      this.runWindowsHardeningCommand(["attrib.exe", "+H", "+S", this.protectedDataRoot]);
      this.runWindowsHardeningCommand(["cipher.exe", "/E", "/A", this.protectedDataRoot]);
    }
  }

  applyRuntimeFileProtection(targetPath) {
    if (!this.programDataPath || process.platform !== "win32") {
      return;
    }
    this.runWindowsHardeningCommand(["attrib.exe", "+H", "+S", targetPath]);
    this.runWindowsHardeningCommand(["cipher.exe", "/E", "/A", targetPath]);
  }

  closeConnection() {
    if (this.db && this.db.open) {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.close();
    }
  }

  runInTransaction(work) {
    if (!this.db?.transaction) {
      return work();
    }
    return this.db.transaction(work)();
  }

  migrateLegacyProtectedSecrets() {
    this.getSessionSecret();
    this.getDataProtectionSecret();
  }

  loadProtectedSecret(secretName) {
    if (!this.secureStorage?.loadSecret) {
      return null;
    }
    const loaded = this.secureStorage.loadSecret(secretName);
    return loaded ? String(loaded || "").trim() : null;
  }

  storeProtectedSecret(secretName, value) {
    if (!this.secureStorage?.storeSecret) {
      return false;
    }
    this.secureStorage.storeSecret(secretName, String(value || "").trim());
    return true;
  }

  migrateLegacySecretFile(secretName, legacyPath, fallbackBytes) {
    const protectedSecret = this.loadProtectedSecret(secretName);
    if (protectedSecret) {
      safeUnlink(legacyPath);
      return protectedSecret;
    }

    if (fs.existsSync(legacyPath)) {
      const legacySecret = String(fs.readFileSync(legacyPath, "utf8") || "").trim();
      if (legacySecret) {
        this.storeProtectedSecret(secretName, legacySecret);
        safeUnlink(legacyPath);
        return legacySecret;
      }
      safeUnlink(legacyPath);
    }

    const generatedSecret = crypto.randomBytes(fallbackBytes).toString("hex");
    this.storeProtectedSecret(secretName, generatedSecret);
    return generatedSecret;
  }

  getDataProtectionSecret() {
    const externalSecret = String(process.env.KWANZA_DATA_PROTECTION_KEY || "").trim();
    if (externalSecret) {
      this.dataProtectionSecret = externalSecret;
      return this.dataProtectionSecret;
    }

    if (this.dataProtectionSecret) {
      return this.dataProtectionSecret;
    }

    const protectedSecret =
      this.secureStorage?.loadSecret && typeof this.secureStorage.loadSecret === "function"
        ? String(this.secureStorage.loadSecret("data-protection-key") || "").trim()
        : "";
    if (protectedSecret) {
      this.dataProtectionSecret = protectedSecret;
      safeUnlink(this.dataProtectionKeyPath);
      return this.dataProtectionSecret;
    }

    if (fs.existsSync(this.dataProtectionKeyPath)) {
      const legacySecret = String(fs.readFileSync(this.dataProtectionKeyPath, "utf8") || "").trim();
      if (legacySecret) {
        if (this.secureStorage?.storeSecret && typeof this.secureStorage.storeSecret === "function") {
          this.secureStorage.storeSecret("data-protection-key", legacySecret);
          safeUnlink(this.dataProtectionKeyPath);
        }
        this.dataProtectionSecret = legacySecret;
        return this.dataProtectionSecret;
      }
    }

    const generatedSecret = crypto.randomBytes(DATA_PROTECTION_SECRET_BYTES).toString("hex");
    if (this.secureStorage?.storeSecret && typeof this.secureStorage.storeSecret === "function") {
      this.secureStorage.storeSecret("data-protection-key", generatedSecret);
      safeUnlink(this.dataProtectionKeyPath);
    } else {
      fs.writeFileSync(this.dataProtectionKeyPath, generatedSecret, "utf8");
    }
    this.dataProtectionSecret = generatedSecret;
    return this.dataProtectionSecret;
  }

  deriveDataProtectionKey(purpose) {
    return crypto
      .createHmac("sha256", Buffer.from(this.getDataProtectionSecret(), "utf8"))
      .update(String(purpose || "default"), "utf8")
      .digest();
  }

  getSqlCipherKeyBuffer() {
    return this.deriveDataProtectionKey(DATABASE_ENCRYPTION_PURPOSE);
  }

  applySqlCipherPragmas(db) {
    db.pragma(`cipher='${SQLCIPHER_COMPATIBILITY_MODE}'`);
    db.pragma(`legacy=${SQLCIPHER_LEGACY_VERSION}`);
    const keyHex = this.getSqlCipherKeyBuffer().toString("hex");
    try {
      db.pragma(`key="x'${keyHex}'"`);
    } catch (pragmaError) {
      if (typeof db.key === "function") {
        db.key(this.getSqlCipherKeyBuffer());
      } else {
        throw pragmaError;
      }
    }
  }

  verifySqlCipherConnection(db) {
    db.prepare("SELECT count(*) AS total FROM sqlite_master").get();
    return true;
  }

  migratePlaintextDatabaseInPlace(filePath) {
    const targetPath = String(filePath || "").trim();
    if (!targetPath || !fs.existsSync(targetPath)) {
      return false;
    }

    const plainDb = new Database(targetPath);
    try {
      plainDb.pragma("journal_mode = DELETE");
      plainDb.pragma(`cipher='${SQLCIPHER_COMPATIBILITY_MODE}'`);
      plainDb.pragma(`legacy=${SQLCIPHER_LEGACY_VERSION}`);
      const keyHex = this.getSqlCipherKeyBuffer().toString("hex");
      try {
        plainDb.pragma(`rekey="x'${keyHex}'"`);
      } catch (pragmaError) {
        if (typeof plainDb.rekey === "function") {
          plainDb.rekey(this.getSqlCipherKeyBuffer());
        } else {
          throw pragmaError;
        }
      }
      return true;
    } finally {
      plainDb.close();
    }
  }

  quarantineCorruptedDatabase(filePath, reason = "corrupted-runtime") {
    const targetPath = String(filePath || "").trim();
    if (!targetPath || !fs.existsSync(targetPath)) {
      return "";
    }

    const diagnosticsDir = path.join(this.workspaceDir, "Diagnostico", "CorruptedDB");
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    const timestamp = nowIso().replace(/[:.]/g, "-");
    const quarantinePath = path.join(diagnosticsDir, `kwanza-folha-${reason}-${timestamp}.sqlite`);

    try {
      fs.copyFileSync(targetPath, quarantinePath);
      if (fs.existsSync(`${targetPath}-wal`)) {
        fs.copyFileSync(`${targetPath}-wal`, `${quarantinePath}-wal`);
      }
      if (fs.existsSync(`${targetPath}-shm`)) {
        fs.copyFileSync(`${targetPath}-shm`, `${quarantinePath}-shm`);
      }
      return quarantinePath;
    } catch {
      return "";
    }
  }

  restoreRuntimeDatabaseFromEncryptedSnapshot() {
    const candidates = [this.encryptedDbPath, this.legacyEncryptedDbPath]
      .filter((candidate) => candidate && candidate !== this.dbPath && fs.existsSync(candidate));

    for (const candidate of candidates) {
      try {
        const rawBuffer = fs.readFileSync(candidate);
        const envelope = parseEncryptedEnvelope(rawBuffer.toString("utf8"));
        if (envelope) {
          const restored = this.restoreEncryptedFileToTarget(candidate, this.dbPath, DATABASE_ENCRYPTION_PURPOSE);
          if (restored === false) {
            continue;
          }
        } else {
          fs.copyFileSync(candidate, this.dbPath);
        }

        const probe = new Database(this.dbPath);
        this.applySqlCipherPragmas(probe);
        this.verifySqlCipherConnection(probe);
        probe.close();
        return { ok: true, sourcePath: candidate };
      } catch {
        safeUnlink(this.dbPath);
        safeUnlink(`${this.dbPath}-wal`);
        safeUnlink(`${this.dbPath}-shm`);
      }
    }

    return { ok: false, sourcePath: "" };
  }

  recoverRuntimeDatabaseFromCorruption(error) {
    const quarantinedPath = this.quarantineCorruptedDatabase(this.dbPath, "not-a-database");
    safeUnlink(this.dbPath);
    safeUnlink(`${this.dbPath}-wal`);
    safeUnlink(`${this.dbPath}-shm`);

    const restored = this.restoreRuntimeDatabaseFromEncryptedSnapshot();
    if (restored.ok) {
      console.warn("Runtime database recovered from encrypted snapshot.", {
        sourcePath: restored.sourcePath,
        quarantinedPath
      });
      return { ok: true, restored: true, sourcePath: restored.sourcePath, quarantinedPath };
    }

    console.warn("Runtime database snapshot unavailable. Recreating runtime database.", {
      quarantinedPath,
      error: String(error?.message || "")
    });
    return { ok: true, restored: false, sourcePath: "", quarantinedPath };
  }

  createFreshRuntimeDatabase() {
    safeUnlink(this.dbPath);
    safeUnlink(`${this.dbPath}-wal`);
    safeUnlink(`${this.dbPath}-shm`);

    const fresh = new Database(this.dbPath);
    try {
      this.applySqlCipherPragmas(fresh);
      this.verifySqlCipherConnection(fresh);
      fresh.pragma("user_version = 0");
    } finally {
      if (fresh?.open) {
        fresh.close();
      }
    }
  }

  openFreshRuntimeConnection() {
    this.createFreshRuntimeDatabase();
    const connection = new Database(this.dbPath);
    try {
      this.applySqlCipherPragmas(connection);
      this.verifySqlCipherConnection(connection);
      return connection;
    } catch (error) {
      if (connection?.open) {
        connection.close();
      }
      throw error;
    }
  }

  encryptBuffer(buffer, purpose) {
    const iv = crypto.randomBytes(DATA_ENCRYPTION_IV_BYTES);
    const cipher = crypto.createCipheriv(DATA_ENCRYPTION_ALGORITHM, this.deriveDataProtectionKey(purpose), iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify({
      marker: DATA_ENCRYPTION_MARKER,
      version: DATA_PROTECTION_VERSION,
      purpose,
      algorithm: DATA_ENCRYPTION_ALGORITHM,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      size: buffer.length,
      createdAt: nowIso()
    });
  }

  decryptEncryptedEnvelope(envelope, expectedPurpose) {
    if (!envelope) {
      throw new Error("Envelope cifrado invalido.");
    }
    if (String(envelope.purpose || "") !== String(expectedPurpose || "")) {
      throw new Error("O ficheiro cifrado nao corresponde ao tipo esperado.");
    }

    const decipher = crypto.createDecipheriv(
      DATA_ENCRYPTION_ALGORITHM,
      this.deriveDataProtectionKey(expectedPurpose),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]);
  }

  writeEncryptedFileFromSource(sourcePath, targetPath, purpose) {
    const buffer = fs.readFileSync(sourcePath);
    fs.writeFileSync(targetPath, this.encryptBuffer(buffer, purpose), "utf8");
  }

  restoreEncryptedFileToTarget(sourcePath, targetPath, purpose) {
    const envelope = parseEncryptedEnvelope(fs.readFileSync(sourcePath, "utf8"));
    if (!envelope) {
      throw new Error("O ficheiro selecionado nao esta cifrado num formato reconhecido.");
    }
    try {
      fs.writeFileSync(targetPath, this.decryptEncryptedEnvelope(envelope, purpose));
    } catch (error) {
      if (/authenticate data|unsupported state/i.test(String(error?.message || ""))) {
        console.warn("Encrypted DB incompatible. Creating new runtime database.");
        safeUnlink(targetPath);
        safeUnlink(`${targetPath}-wal`);
        safeUnlink(`${targetPath}-shm`);
        return false;
      }
      throw error;
    }
    return true;
  }

  isEncryptedDataFile(filePath, expectedPurpose = null) {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const envelope = parseEncryptedEnvelope(fs.readFileSync(filePath, "utf8"));
    if (envelope) {
      if (expectedPurpose && String(envelope.purpose || "") !== String(expectedPurpose)) {
        return false;
      }
      return true;
    }

    try {
      const db = new Database(filePath, { readonly: true, fileMustExist: true });
      this.applySqlCipherPragmas(db);
      this.verifySqlCipherConnection(db);
      db.close();
      return true;
    } catch {
      return false;
    }
  }

  ensureRuntimeDatabaseAvailable() {
    this.ensureProtectedDataDirectory();

    if (fs.existsSync(this.dbPath)) {
      if (this.legacyDbPath !== this.dbPath) {
        safeUnlink(this.legacyDbPath);
      }
      if (this.legacyRuntimeDbPath !== this.dbPath) {
        safeUnlink(this.legacyRuntimeDbPath);
      }
      if (typeof this.applyRuntimeFileProtection === "function") {
        this.applyRuntimeFileProtection(this.dbPath);
      }
      return;
    }

    if (fs.existsSync(this.legacyEncryptedDbPath)) {
      const restored = this.restoreEncryptedFileToTarget(this.legacyEncryptedDbPath, this.dbPath, DATABASE_ENCRYPTION_PURPOSE);
      if (restored === false) {
        return;
      }
      if (this.legacyDbPath !== this.dbPath) {
        safeUnlink(this.legacyDbPath);
      }
      if (this.legacyRuntimeDbPath !== this.dbPath) {
        safeUnlink(this.legacyRuntimeDbPath);
      }
      if (this.legacyEncryptedDbPath !== this.dbPath) {
        safeUnlink(this.legacyEncryptedDbPath);
      }
      if (typeof this.applyRuntimeFileProtection === "function") {
        this.applyRuntimeFileProtection(this.dbPath);
      }
      return;
    }

    if (fs.existsSync(this.encryptedDbPath) && this.encryptedDbPath !== this.dbPath) {
      const copied = fs.readFileSync(this.encryptedDbPath);
      const envelope = parseEncryptedEnvelope(copied.toString("utf8"));
      if (envelope) {
        const restored = this.restoreEncryptedFileToTarget(this.encryptedDbPath, this.dbPath, DATABASE_ENCRYPTION_PURPOSE);
        if (restored === false) {
          return;
        }
      } else {
        fs.copyFileSync(this.encryptedDbPath, this.dbPath);
      }
      if (typeof this.applyRuntimeFileProtection === "function") {
        this.applyRuntimeFileProtection(this.dbPath);
      }
      return;
    }

    if (fs.existsSync(this.legacyRuntimeDbPath)) {
      fs.renameSync(this.legacyRuntimeDbPath, this.dbPath);
      if (typeof this.applyRuntimeFileProtection === "function") {
        this.applyRuntimeFileProtection(this.dbPath);
      }
      return;
    }

    if (fs.existsSync(this.legacyDbPath)) {
      fs.renameSync(this.legacyDbPath, this.dbPath);
      if (typeof this.applyRuntimeFileProtection === "function") {
        this.applyRuntimeFileProtection(this.dbPath);
      }
    }
  }

  cleanupRuntimeDatabaseArtifacts() {
    safeUnlink(`${this.dbPath}-wal`);
    safeUnlink(`${this.dbPath}-shm`);
    if (this.legacyDbPath !== this.dbPath) {
      safeUnlink(this.legacyDbPath);
    }
    if (this.legacyRuntimeDbPath !== this.dbPath) {
      safeUnlink(this.legacyRuntimeDbPath);
    }
  }

  syncEncryptedDatabaseSnapshot() {
    if (!fs.existsSync(this.dbPath)) {
      return { ok: false, message: "A base de dados operacional nao esta disponivel para cifragem." };
    }

    if (this.db?.open) {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    }

    const usesSqlCipherEngine =
      typeof this.isEncryptedDataFile === "function" &&
      this.isEncryptedDataFile(this.dbPath, DATABASE_ENCRYPTION_PURPOSE);

    if (!usesSqlCipherEngine) {
      this.writeEncryptedFileFromSource(this.dbPath, this.encryptedDbPath, DATABASE_ENCRYPTION_PURPOSE);
      return { ok: true, path: this.encryptedDbPath, encrypted: true, engine: "envelope" };
    }

    if (this.legacyDbPath !== this.dbPath) {
      safeUnlink(this.legacyDbPath);
    }
    if (this.legacyRuntimeDbPath !== this.dbPath) {
      safeUnlink(this.legacyRuntimeDbPath);
    }
    if (this.legacyEncryptedDbPath !== this.dbPath) {
      safeUnlink(this.legacyEncryptedDbPath);
    }
    if (typeof this.applyRuntimeFileProtection === "function") {
      this.applyRuntimeFileProtection(this.dbPath);
    }
    return { ok: true, path: this.dbPath, encrypted: true, engine: "sqlcipher" };
  }

  prepareForShutdown() {
    if (!fs.existsSync(this.dbPath)) {
      return { ok: true };
    }

    const snapshot = this.syncEncryptedDatabaseSnapshot();
    this.closeConnection();
    this.cleanupRuntimeDatabaseArtifacts();
    if (snapshot?.engine !== "sqlcipher") {
      safeUnlink(this.dbPath);
    }
    return { ok: true, path: snapshot?.path || this.dbPath, encrypted: true, engine: snapshot?.engine || "sqlcipher" };
  }

  ensureSchemaMetadata() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  getTableColumns(tableName) {
    const normalized = String(tableName || "").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(normalized)) {
      throw new Error("Nome de tabela invalido para introspecao.");
    }
    return this.db.prepare(`PRAGMA table_info(${normalized})`).all();
  }

  hasColumn(tableName, columnName) {
    return this.getTableColumns(tableName).some((column) => column.name === columnName);
  }

  ensureColumn(tableName, columnName, definition, onAdd = null) {
    if (this.hasColumn(tableName, columnName)) {
      return false;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    if (typeof onAdd === "function") {
      onAdd();
    }
    return true;
  }

  applySchemaMigration(version, name, work) {
    const existingMigration = this.db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
    if (existingMigration) {
      return false;
    }

    this.runInTransaction(() => {
      work();
      this.db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        version,
        name,
        nowIso()
      );
      this.db.pragma(`user_version = ${version}`);
    });

    return true;
  }

  ensureDomainIndexes() {
    for (const statement of SCHEMA_INDEX_STATEMENTS) {
      this.db.exec(statement);
    }
  }

  setupSchema() {
    this.ensureSchemaMetadata();

    this.applySchemaMigration(1, "base-schema", () => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS company_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT,
        nif TEXT,
        email TEXT,
        address TEXT,
        phone TEXT,
        logo_path TEXT,
        origin_bank_code TEXT,
        origin_account TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        requested_identifier TEXT NOT NULL DEFAULT '',
        delivery_email TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS work_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT,
        name TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        profile TEXT NOT NULL DEFAULT 'general',
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        tolerance_minutes REAL NOT NULL DEFAULT 0,
        break_minutes REAL NOT NULL DEFAULT 0,
        working_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
        class_blocks_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(code)
      );

      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT 'bi',
        bi TEXT NOT NULL,
        driver_license_number TEXT,
        nif TEXT NOT NULL,
        social_security_number TEXT,
        attendance_code TEXT,
        birth_date TEXT,
        gender TEXT,
        marital_status TEXT,
        nationality TEXT,
        personal_phone TEXT,
        personal_email TEXT,
        address TEXT,
        job_title TEXT NOT NULL,
        department TEXT NOT NULL,
        base_salary REAL NOT NULL,
        contract_type TEXT NOT NULL,
        hire_date TEXT NOT NULL,
        shift_id INTEGER,
        iban TEXT,
        bank_code TEXT,
        bank_account TEXT,
        status TEXT NOT NULL,
        notes TEXT,
        recurring_allowances TEXT NOT NULL DEFAULT '[]',
        recurring_bonuses TEXT NOT NULL DEFAULT '[]',
        special_payments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (shift_id) REFERENCES work_shifts(id)
      );

      CREATE TABLE IF NOT EXISTS payroll_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_date TEXT NOT NULL,
        amount REAL DEFAULT 0,
        quantity REAL DEFAULT 0,
        description TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS leave_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        record_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        days REAL NOT NULL,
        reason TEXT NOT NULL,
        document_ref TEXT,
        proof_type TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        affects_payroll INTEGER NOT NULL DEFAULT 0,
        approved_by_user_id INTEGER,
        approved_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS vacation_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        year_ref TEXT NOT NULL,
        entitled_days REAL NOT NULL DEFAULT 22,
        carried_days REAL NOT NULL DEFAULT 0,
        manual_adjustment REAL NOT NULL DEFAULT 0,
        notes TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (employee_id, year_ref),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS vacation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        year_ref TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        days REAL NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_by_user_id INTEGER,
        approved_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS attendance_import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT,
        device_label TEXT,
        device_profile TEXT NOT NULL DEFAULT 'generic',
        import_mode TEXT NOT NULL DEFAULT 'manual',
        month_ref TEXT,
        total_rows INTEGER NOT NULL DEFAULT 0,
        imported_rows INTEGER NOT NULL DEFAULT 0,
        skipped_rows INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'processed',
        technical_message TEXT,
        imported_by_user_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (imported_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS attendance_import_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        employee_id INTEGER,
        employee_code TEXT,
        attendance_date TEXT,
        outcome TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES attendance_import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        attendance_date TEXT NOT NULL,
        status TEXT NOT NULL,
        shift_id INTEGER,
        check_in_time TEXT,
        check_out_time TEXT,
        punch_count INTEGER NOT NULL DEFAULT 0,
        approval_status TEXT NOT NULL DEFAULT 'approved',
        approved_by_user_id INTEGER,
        approved_at TEXT,
        hours_worked REAL NOT NULL DEFAULT 0,
        delay_minutes REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        device_label TEXT,
        batch_id INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (employee_id, attendance_date),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (shift_id) REFERENCES work_shifts(id),
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
        FOREIGN KEY (batch_id) REFERENCES attendance_import_batches(id)
      );

      CREATE TABLE IF NOT EXISTS financial_obligations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        label TEXT NOT NULL,
        principal_amount REAL NOT NULL,
        installment_count INTEGER NOT NULL,
        installment_amount REAL NOT NULL,
        start_month_ref TEXT NOT NULL,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS salary_scales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_title TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        min_salary REAL NOT NULL,
        reference_salary REAL NOT NULL,
        max_salary REAL NOT NULL,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (job_title, department)
      );

      CREATE TABLE IF NOT EXISTS payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_ref TEXT NOT NULL,
        employee_id INTEGER NOT NULL,
        gross_salary REAL NOT NULL,
        allowances_total REAL NOT NULL,
        bonuses_total REAL NOT NULL,
        mandatory_deductions REAL NOT NULL,
        absence_deduction REAL NOT NULL,
        net_salary REAL NOT NULL,
        irt_amount REAL NOT NULL,
        inss_amount REAL NOT NULL,
        summary_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        UNIQUE (month_ref, employee_id),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS payroll_periods (
        month_ref TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'open',
        closed_at TEXT,
        closed_by_user_id INTEGER,
        reopened_at TEXT,
        reopened_by_user_id INTEGER,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (closed_by_user_id) REFERENCES users(id),
        FOREIGN KEY (reopened_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS attendance_periods (
        month_ref TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'open',
        closed_at TEXT,
        closed_by_user_id INTEGER,
        reopened_at TEXT,
        reopened_by_user_id INTEGER,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (closed_by_user_id) REFERENCES users(id),
        FOREIGN KEY (reopened_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS agt_monthly_submissions (
        month_ref TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'draft',
        submission_mode TEXT NOT NULL DEFAULT 'manual',
        proof_reference TEXT NOT NULL DEFAULT '',
        proof_path TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        exported_at TEXT,
        submitted_at TEXT,
        submitted_by_user_id INTEGER,
        validation_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (submitted_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        entity_label TEXT,
        month_ref TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    });

    this.applySchemaMigration(2, "core-schema-upgrades", () => {
      this.ensureColumn("users", "must_change_password", "must_change_password INTEGER NOT NULL DEFAULT 0");
      this.ensureColumn("users", "email", "email TEXT");
      this.ensureColumn("company_profile", "origin_bank_code", "origin_bank_code TEXT");
      this.ensureColumn("company_profile", "origin_account", "origin_account TEXT");
      this.ensureColumn("employees", "document_type", "document_type TEXT NOT NULL DEFAULT 'bi'");
      this.ensureColumn("employees", "driver_license_number", "driver_license_number TEXT");
      this.ensureColumn("employees", "attendance_code", "attendance_code TEXT");
      this.ensureColumn("employees", "bank_code", "bank_code TEXT");
      this.ensureColumn("employees", "bank_account", "bank_account TEXT");
      this.ensureColumn("employees", "social_security_number", "social_security_number TEXT");
      this.ensureColumn("employees", "birth_date", "birth_date TEXT");
      this.ensureColumn("employees", "gender", "gender TEXT");
      this.ensureColumn("employees", "marital_status", "marital_status TEXT");
      this.ensureColumn("employees", "nationality", "nationality TEXT");
      this.ensureColumn("employees", "personal_phone", "personal_phone TEXT");
      this.ensureColumn("employees", "personal_email", "personal_email TEXT");
      this.ensureColumn("employees", "address", "address TEXT");
      this.ensureColumn("employees", "notes", "notes TEXT");
      this.ensureColumn("employees", "shift_id", "shift_id INTEGER");
    });

    this.applySchemaMigration(3, "attendance-schema-upgrades", () => {
      this.ensureColumn("attendance_import_batches", "file_hash", "file_hash TEXT");
      this.ensureColumn("attendance_import_batches", "device_profile", "device_profile TEXT NOT NULL DEFAULT 'generic'");
      this.ensureColumn("attendance_import_batches", "import_mode", "import_mode TEXT NOT NULL DEFAULT 'manual'");
      this.ensureColumn("attendance_import_batches", "sync_status", "sync_status TEXT NOT NULL DEFAULT 'processed'");
      this.ensureColumn("attendance_import_batches", "technical_message", "technical_message TEXT");
      this.ensureColumn("attendance_records", "shift_id", "shift_id INTEGER");
      this.ensureColumn("attendance_records", "check_in_time", "check_in_time TEXT");
      this.ensureColumn("attendance_records", "check_out_time", "check_out_time TEXT");
      this.ensureColumn("attendance_records", "source", "source TEXT NOT NULL DEFAULT 'manual'");
      this.ensureColumn("attendance_records", "device_label", "device_label TEXT");
      this.ensureColumn("attendance_records", "batch_id", "batch_id INTEGER");
      this.ensureColumn("attendance_records", "punch_count", "punch_count INTEGER NOT NULL DEFAULT 0", () => {
        this.db.exec(`
          UPDATE attendance_records
          SET punch_count = CASE
            WHEN TRIM(COALESCE(check_in_time, '')) <> '' AND TRIM(COALESCE(check_out_time, '')) <> '' AND TRIM(check_in_time) <> TRIM(check_out_time) THEN 2
            WHEN TRIM(COALESCE(check_in_time, '')) <> '' OR TRIM(COALESCE(check_out_time, '')) <> '' THEN 1
            ELSE 0
          END
        `);
      });
      this.ensureColumn("attendance_records", "approval_status", "approval_status TEXT NOT NULL DEFAULT 'approved'", () => {
        this.db.exec(`
          UPDATE attendance_records
          SET approval_status = CASE
            WHEN LOWER(COALESCE(source, 'manual')) = 'manual' THEN 'pending'
            ELSE 'approved'
          END
        `);
      });
      this.ensureColumn("attendance_records", "approved_by_user_id", "approved_by_user_id INTEGER");
      this.ensureColumn("attendance_records", "approved_at", "approved_at TEXT", () => {
        this.db.exec(`
          UPDATE attendance_records
          SET approved_at = CASE
            WHEN approval_status = 'approved' THEN COALESCE(updated_at, created_at)
            ELSE NULL
          END
        `);
      });
    });

    this.applySchemaMigration(4, "domain-indexes", () => {
      this.ensureDomainIndexes();
    });

    this.applySchemaMigration(5, "employee-document-repository", () => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS employee_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'other',
          title TEXT NOT NULL,
          document_number TEXT NOT NULL DEFAULT '',
          issuer TEXT NOT NULL DEFAULT '',
          issue_date TEXT,
          effective_date TEXT,
          expiry_date TEXT,
          alert_days_before INTEGER NOT NULL DEFAULT 30,
          file_name TEXT NOT NULL DEFAULT '',
          stored_file_path TEXT NOT NULL DEFAULT '',
          file_size INTEGER NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          created_by_user_id INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        );
      `);
      for (const statement of EMPLOYEE_DOCUMENT_INDEX_STATEMENTS) {
        this.db.exec(statement);
      }
    });

    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }

  seedDefaults() {
    if (!this.db.prepare("SELECT id FROM system_settings WHERE id = 1").get()) {
      this.db.prepare("INSERT INTO system_settings (id, json, updated_at) VALUES (1, ?, ?)").run(
        JSON.stringify(DEFAULT_SETTINGS),
        nowIso()
      );
    }

    if (!this.db.prepare("SELECT id FROM company_profile WHERE id = 1").get()) {
      this.db.prepare(
        "INSERT INTO company_profile (id, name, nif, email, address, phone, logo_path, origin_bank_code, origin_account, updated_at) VALUES (1, '', '', '', '', '', '', '', '', ?)"
      ).run(nowIso());
    }

    if (!this.db.prepare("SELECT id FROM work_shifts LIMIT 1").get()) {
      const defaults = [
        {
          code: "GERAL-STD",
          name: "Turno Geral",
          department: "",
          profile: "general",
          start_time: "08:00",
          end_time: "17:00",
          tolerance_minutes: 15,
          break_minutes: 60,
          working_days_json: JSON.stringify(DEFAULT_WORKING_DAYS),
          class_blocks_json: "[]",
          notes: "Turno padrão administrativo.",
          active: 1
        },
        {
          code: "DOC-MANHA",
          name: "Docente - Manhã",
          department: "Corpo Docente",
          profile: "docente_morning",
          start_time: "07:30",
          end_time: "12:30",
          tolerance_minutes: 10,
          break_minutes: 15,
          working_days_json: JSON.stringify(DEFAULT_WORKING_DAYS),
          class_blocks_json: JSON.stringify(buildDocenteBlocks("docente_morning", "07:30", "12:30")),
          notes: "Modelo letivo da manhã para docentes.",
          active: 1
        },
        {
          code: "DOC-TARDE",
          name: "Docente - Tarde",
          department: "Corpo Docente",
          profile: "docente_afternoon",
          start_time: "13:00",
          end_time: "18:00",
          tolerance_minutes: 10,
          break_minutes: 15,
          working_days_json: JSON.stringify(DEFAULT_WORKING_DAYS),
          class_blocks_json: JSON.stringify(buildDocenteBlocks("docente_afternoon", "13:00", "18:00")),
          notes: "Modelo letivo da tarde para docentes.",
          active: 1
        },
        {
          code: "DOC-NOITE",
          name: "Docente - Noite",
          department: "Corpo Docente",
          profile: "docente_evening",
          start_time: "18:30",
          end_time: "22:30",
          tolerance_minutes: 10,
          break_minutes: 10,
          working_days_json: JSON.stringify(DEFAULT_WORKING_DAYS),
          class_blocks_json: JSON.stringify(buildDocenteBlocks("docente_evening", "18:30", "22:30")),
          notes: "Modelo letivo noturno para docentes.",
          active: 1
        }
      ];

      const statement = this.db.prepare(`
        INSERT INTO work_shifts (
          code, name, department, profile, start_time, end_time, tolerance_minutes, break_minutes,
          working_days_json, class_blocks_json, notes, active, created_at, updated_at
        ) VALUES (
          @code, @name, @department, @profile, @start_time, @end_time, @tolerance_minutes, @break_minutes,
          @working_days_json, @class_blocks_json, @notes, @active, @created_at, @updated_at
        )
      `);

      defaults.forEach((item) => statement.run({ ...item, created_at: nowIso(), updated_at: nowIso() }));
    }
  }

  performAutomaticBackup() {
    const today = new Date().toISOString().slice(0, 10);
    let lastBackup = "";
    if (fs.existsSync(this.backupStatePath)) {
      lastBackup = safeReadJsonFile(this.backupStatePath, {})?.lastBackup ?? "";
    }
    if (lastBackup !== today) {
      this.createBackup();
      fs.writeFileSync(this.backupStatePath, JSON.stringify({ lastBackup: today }, null, 2));
    }
  }

  getBootstrapData(currentUser = null) {
    const settings = this.getSystemSettings();
    const payrollRuns = this.listPayrollRuns();
    const payrollPeriods = this.listPayrollPeriods();
    const exposedSettings =
      currentUser?.role === "admin"
        ? settings
        : {
            ...settings,
            smtpPassword: ""
          };

    return {
      company: this.getCompanyProfile(),
      settings: exposedSettings,
      employees: this.listEmployees(),
      workShifts: this.listWorkShifts(),
      attendanceRecords: this.listAttendanceRecords(),
      attendanceImports: this.listAttendanceImportBatches(),
      attendanceImportLogs: this.listAttendanceImportLogs({ limit: 120 }),
      attendancePeriods: this.listAttendancePeriods(),
      leaveRequests: this.listLeaveRequests(),
      vacationBalances: this.listVacationBalances(),
      vacationRequests: this.listVacationRequests(),
      financialObligations: this.listFinancialObligations(),
      salaryScales: this.listSalaryScales(),
      payrollRuns,
      payrollPeriods,
      payrollFiscalStatuses: this.listPayrollFiscalStatuses({ payrollRuns, payrollPeriods, settings }),
      documentAlerts: this.listEmployeeDocumentAlerts(),
      agtMonthlySubmissions: this.listAgtMonthlySubmissions(),
      users: this.listUsers(),
      auditLogs: currentUser?.role === "admin" ? this.listAuditLogs() : [],
      backups: currentUser?.role === "admin" ? this.listBackups() : [],
      needsSetup: this.isInitialSetupPending()
    };
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    return fs.readdirSync(this.backupDir)
      .filter((fileName) => {
        const normalized = fileName.toLowerCase();
        return normalized.endsWith(".sqlite") || normalized.endsWith(".sqlite.enc");
      })
      .map((fileName) => {
        const fullPath = path.join(this.backupDir, fileName);
        const stats = fs.statSync(fullPath);
        const encrypted = this.isEncryptedDataFile(fullPath, BACKUP_ENCRYPTION_PURPOSE);
        return {
          fileName,
          path: fullPath,
          size: stats.size,
          modified_at: stats.mtime.toISOString(),
          encrypted
        };
      })
      .sort((left, right) => right.modified_at.localeCompare(left.modified_at));
  }

  getCompanyProfile() {
    const row = this.db.prepare("SELECT * FROM company_profile WHERE id = 1").get() || {};
    return {
      ...row,
      origin_bank_code: row?.origin_bank_code || "",
      origin_account: row?.origin_account || ""
    };
  }

  saveCompanyProfile(payload) {
    const originBankCode = String(payload.origin_bank_code || "").trim().toUpperCase();
    const originAccount = normalizeBankAccount(payload.origin_account ?? "");

    if ((originBankCode && !originAccount) || (!originBankCode && originAccount)) {
      return {
        ok: false,
        message: "Selecione o banco de origem e indique o número da conta de origem da empresa para gerar ficheiros PS2/PSX."
      };
    }

    this.db.prepare(`
      UPDATE company_profile
      SET name = @name, nif = @nif, email = @email, address = @address, phone = @phone,
          logo_path = @logo_path, origin_bank_code = @origin_bank_code, origin_account = @origin_account, updated_at = @updated_at
      WHERE id = 1
    `).run({
      name: payload.name ?? "",
      nif: payload.nif ?? "",
      email: payload.email ?? "",
      address: payload.address ?? "",
      phone: payload.phone ?? "",
      logo_path: payload.logo_path ?? "",
      origin_bank_code: originBankCode,
      origin_account: originAccount,
      updated_at: nowIso()
    });

    const settings = this.getSystemSettings();
    settings.companyLogo = payload.logo_path ?? "";
    this.saveSystemSettings(settings);
    return { ok: true, company: this.getCompanyProfile() };
  }

  getSystemSettings(referenceMonthRef = getCurrentMonthRef()) {
    const row = this.db.prepare("SELECT json FROM system_settings WHERE id = 1").get();
    const merged = row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.json) } : { ...DEFAULT_SETTINGS };
    const fiscalSettings = normalizeFiscalSettings(merged, referenceMonthRef);
    const activeProfileForMonth = fiscalSettings.activeProfileForMonth || buildDefaultFiscalProfile();

    return {
      ...merged,
      fiscalProfiles: fiscalSettings.fiscalProfiles,
      activeFiscalProfileId: fiscalSettings.activeFiscalProfileId,
      resolvedFiscalProfile: summarizeFiscalProfile(activeProfileForMonth),
      inssEmployeeRate: Number(activeProfileForMonth.inssEmployeeRate ?? merged.inssEmployeeRate ?? DEFAULT_SETTINGS.inssEmployeeRate),
      inssEmployerRate: Number(activeProfileForMonth.inssEmployerRate ?? merged.inssEmployerRate ?? DEFAULT_SETTINGS.inssEmployerRate),
      irtBrackets: activeProfileForMonth.irtBrackets || merged.irtBrackets || DEFAULT_SETTINGS.irtBrackets
    };
  }

  buildVersionedFiscalSettings(currentSettings, payload = {}) {
    const referenceMonthRef = normalizeMonthRef(payload.fiscalProfileEffectiveFrom, getCurrentMonthRef());
    const merged = { ...DEFAULT_SETTINGS, ...currentSettings, ...payload };
    const currentFiscal = normalizeFiscalSettings(currentSettings, referenceMonthRef);
    const existingProfiles = Array.isArray(payload.fiscalProfiles) && payload.fiscalProfiles.length
      ? payload.fiscalProfiles
      : currentFiscal.fiscalProfiles;
    const incomingFiscal = {
      ...merged,
      fiscalProfiles: existingProfiles,
      activeFiscalProfileId: payload.activeFiscalProfileId || currentFiscal.activeFiscalProfileId
    };
    const nextFiscal = normalizeFiscalSettings(incomingFiscal, referenceMonthRef);
    const editingProfileId = String(payload.fiscalProfileEditingId || "").trim();
    const editableProfile =
      nextFiscal.fiscalProfiles.find((profile) => String(profile.id || "").trim() === editingProfileId) ||
      currentFiscal.activeProfileForMonth ||
      buildDefaultFiscalProfile();
    const requestedCurrentProfile = buildFiscalProfile({
      ...editableProfile,
      name: String(payload.fiscalProfileName || editableProfile.name || "Perfil fiscal").trim() || "Perfil fiscal",
      effectiveFrom: referenceMonthRef,
      legalReference: String(payload.fiscalProfileLegalReference || editableProfile.legalReference || "").trim(),
      notes: String(payload.fiscalProfileNotes || editableProfile.notes || "").trim(),
      inssEmployeeRate: merged.inssEmployeeRate,
      inssEmployerRate: merged.inssEmployerRate,
      irtBrackets: merged.irtBrackets
    });
    let candidateProfiles = nextFiscal.fiscalProfiles.map((profile) => ({ ...profile }));
    let candidateActiveFiscalProfileId = nextFiscal.activeFiscalProfileId;
    const editableIndex = candidateProfiles.findIndex(
      (profile) => String(profile.id || "").trim() === String(editableProfile.id || "").trim()
    );
    const hasRuleChanges = !areFiscalRuleFieldsEqual(editableProfile, requestedCurrentProfile);
    const hasProfileMetadataChanges =
      String(editableProfile.name || "").trim() !== String(requestedCurrentProfile.name || "").trim() ||
      String(editableProfile.legalReference || "").trim() !== String(requestedCurrentProfile.legalReference || "").trim() ||
      String(editableProfile.notes || "").trim() !== String(requestedCurrentProfile.notes || "").trim() ||
      String(editableProfile.effectiveFrom || "").trim() !== String(requestedCurrentProfile.effectiveFrom || "").trim();

    if (hasRuleChanges || hasProfileMetadataChanges) {
      const canUpdateExistingProfile =
        editableIndex >= 0 &&
        String(candidateProfiles[editableIndex].effectiveFrom || "").trim() === referenceMonthRef;
      const targetProfile = buildFiscalProfile({
        ...(editableIndex >= 0 ? candidateProfiles[editableIndex] : editableProfile),
        id:
          canUpdateExistingProfile
            ? candidateProfiles[editableIndex].id
            : createFiscalProfileId(editableProfile.id || "perfil-fiscal", referenceMonthRef, candidateProfiles),
        name: requestedCurrentProfile.name,
        effectiveFrom: canUpdateExistingProfile ? candidateProfiles[editableIndex].effectiveFrom : referenceMonthRef,
        legalReference: requestedCurrentProfile.legalReference,
        notes: requestedCurrentProfile.notes,
        inssEmployeeRate: requestedCurrentProfile.inssEmployeeRate,
        inssEmployerRate: requestedCurrentProfile.inssEmployerRate,
        irtBrackets: requestedCurrentProfile.irtBrackets
      });

      if (canUpdateExistingProfile) {
        candidateProfiles[editableIndex] = targetProfile;
      } else {
        candidateProfiles.push(targetProfile);
      }

      candidateActiveFiscalProfileId = targetProfile.id;
    }

    const normalizedCandidate = normalizeFiscalSettings(
      {
        ...merged,
        fiscalProfiles: candidateProfiles,
        activeFiscalProfileId: candidateActiveFiscalProfileId
      },
      referenceMonthRef
    );
    const activeProfileForMonth = normalizedCandidate.activeProfileForMonth || buildDefaultFiscalProfile();

    return {
      ...merged,
      fiscalProfiles: normalizedCandidate.fiscalProfiles,
      activeFiscalProfileId: normalizedCandidate.activeFiscalProfileId,
      inssEmployeeRate: Number(activeProfileForMonth.inssEmployeeRate ?? merged.inssEmployeeRate ?? DEFAULT_SETTINGS.inssEmployeeRate),
      inssEmployerRate: Number(activeProfileForMonth.inssEmployerRate ?? merged.inssEmployerRate ?? DEFAULT_SETTINGS.inssEmployerRate),
      irtBrackets: activeProfileForMonth.irtBrackets || merged.irtBrackets || DEFAULT_SETTINGS.irtBrackets
    };
  }

  getClosedFiscalImpactMonths(currentSettings, nextSettings) {
    return this.listPayrollPeriods()
      .filter((period) => period.status === "closed")
      .map((period) => String(period.month_ref || "").trim())
      .filter((monthRef) => {
        const currentProfile = summarizeFiscalProfile(resolveFiscalProfileForMonth(currentSettings, monthRef));
        const nextProfile = summarizeFiscalProfile(resolveFiscalProfileForMonth(nextSettings, monthRef));
        return currentProfile.id !== nextProfile.id || currentProfile.version !== nextProfile.version;
      });
  }

  saveSystemSettings(payload) {
    const current = this.getSystemSettings();
    const proposedSettings = { ...current, ...payload };
    const payrollSensitiveFields = ["vacationMonth", "christmasMonth"];
    const changesSensitiveRules = payrollSensitiveFields.some(
      (field) => JSON.stringify(current[field]) !== JSON.stringify(proposedSettings[field])
    );
    if (changesSensitiveRules && this.hasClosedPeriods()) {
      return { ok: false, message: "Existem períodos fechados. Reabra-os antes de alterar regras salariais que afetam cálculos." };
    }

    const merged = this.buildVersionedFiscalSettings(current, payload);
    const impactedClosedMonths = this.getClosedFiscalImpactMonths(current, merged);
    if (impactedClosedMonths.length) {
      return {
        ok: false,
        message: `Existem períodos fechados afetados pela nova versão fiscal (${impactedClosedMonths.join(", ")}). Reabra-os antes de alterar a regra legal aplicada.`
      };
    }
    const hasSmtpData = [
      merged.smtpHost,
      merged.smtpUser,
      merged.smtpPassword,
      merged.smtpFromEmail
    ].some((value) => String(value || "").trim());

    if (hasSmtpData) {
      if (!String(merged.smtpHost || "").trim()) {
        return { ok: false, message: "Indique o servidor SMTP antes de guardar as definições de e-mail." };
      }
      if (!Number(merged.smtpPort || 0)) {
        return { ok: false, message: "Indique uma porta SMTP válida." };
      }
      if (!String(merged.smtpUser || "").trim() || !String(merged.smtpPassword || "").trim()) {
        return { ok: false, message: "Indique o utilizador e a palavra-passe SMTP." };
      }
      if (!isValidEmail(merged.smtpFromEmail)) {
        return { ok: false, message: "Indique um e-mail remetente válido." };
      }
    }

    this.db.prepare("UPDATE system_settings SET json = ?, updated_at = ? WHERE id = 1").run(
      JSON.stringify(sanitizeStoredSettingsPayload(merged)),
      nowIso()
    );
    return { ok: true, settings: this.getSystemSettings() };
  }

  listUsers() {
    return this.db
      .prepare("SELECT id, full_name, email, username, role, active, must_change_password, created_at FROM users ORDER BY full_name")
      .all();
  }

  getAuthState() {
    const company = this.getCompanyProfile() || {};
    const users = this.listUsers();
    const defaultSeedUser = this.getDefaultSeedUser();
    const setupRequired = this.isInitialSetupPending();

    return {
      ok: true,
      setupRequired,
      canRegister: setupRequired,
      hasUsers: users.length > 0,
      company: {
        name: company.name || "",
        nif: company.nif || "",
        email: company.email || "",
        phone: company.phone || "",
        address: company.address || ""
      },
      suggestedAdminName: defaultSeedUser ? defaultSeedUser.full_name : "",
      suggestedUsername: defaultSeedUser ? "" : ""
    };
  }

  getLicenseTrialStartedAt() {
    return String(this.getSystemSettings().licenseTrialStartedAt || "").trim();
  }

  ensureLicenseTrialStarted(startedAt = nowIso()) {
    const normalizedStartedAt = String(startedAt || "").trim() || nowIso();
    const current = this.getSystemSettings();
    if (String(current.licenseTrialStartedAt || "").trim()) {
      return String(current.licenseTrialStartedAt || "").trim();
    }

    this.db.prepare("UPDATE system_settings SET json = ?, updated_at = ? WHERE id = 1").run(
      JSON.stringify(
        sanitizeStoredSettingsPayload({
          ...DEFAULT_SETTINGS,
          ...current,
          licenseTrialStartedAt: normalizedStartedAt
        })
      ),
      nowIso()
    );

    return normalizedStartedAt;
  }

  getLicenseTrialContext() {
    const setupRequired = this.isInitialSetupPending();
    const company = this.getCompanyProfile() || {};
    const primaryUser =
      this.db.prepare(`
        SELECT id, full_name, email, username, created_at
        FROM users
        WHERE active = 1
        ORDER BY datetime(created_at) ASC, id ASC
        LIMIT 1
      `).get() ||
      this.db.prepare(`
        SELECT id, full_name, email, username, created_at
        FROM users
        ORDER BY datetime(created_at) ASC, id ASC
        LIMIT 1
      `).get() ||
      null;

    let trialStartedAt = this.getLicenseTrialStartedAt();
    if (!trialStartedAt && !setupRequired && primaryUser?.created_at) {
      trialStartedAt = String(primaryUser.created_at || "").trim();
    }

    return {
      setupRequired,
      trialStartedAt,
      companyName: String(company.name || "").trim(),
      companyEmail: String(company.email || "").trim(),
      companyPhone: String(company.phone || "").trim(),
      companyNif: String(company.nif || "").trim(),
      adminName: String(primaryUser?.full_name || "").trim(),
      adminEmail: String(primaryUser?.email || "").trim(),
      username: String(primaryUser?.username || "").trim()
    };
  }

  getUserPayload(user) {
    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email || "",
      username: user.username,
      role: user.role,
      must_change_password: Boolean(user.must_change_password)
    };
  }

  getUserById(userId) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  getDefaultSeedUser() {
    const users = this.db.prepare("SELECT * FROM users ORDER BY id").all();
    if (users.length !== 1) {
      return null;
    }
    return isDefaultSeedUser(users[0]) ? users[0] : null;
  }

  isInitialSetupPending() {
    const company = this.getCompanyProfile() || {};
    const companyConfigured = Boolean(String(company.name || "").trim());
    const totalUsers = this.db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
    return !companyConfigured || totalUsers === 0 || Boolean(this.getDefaultSeedUser());
  }

  getUserSnapshot(userId) {
    const user = this.db.prepare("SELECT id, full_name, email, username, role, active, must_change_password FROM users WHERE id = ?").get(userId);
    return user || null;
  }

  getAuthenticatedUser() {
    const payload = this.readSessionPayload();
    if (!payload) {
      return null;
    }

    const user = this.getUserById(payload.userId);
    if (!user || !user.active) {
      this.clearSession();
      return null;
    }

    return user;
  }

  listAuditLogs(filters = {}) {
    const query = buildAuditLogsFilter(filters);
    const rows = this.db.prepare(`
      SELECT *
      FROM audit_logs
      ${query.whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all({ ...query.params, limit: query.limit });
    return mapAuditRows(rows);
  }

  exportAuditCsv(filters = {}) {
    const rows = this.listAuditLogs({ ...filters, limit: Number(filters.limit || 5000) });
    if (!rows.length) {
      return { ok: false, message: "Não existem registos de auditoria para exportar com os filtros atuais." };
    }

    const headers = ["Data", "Utilizador", "Ação", "Entidade", "Referência", "Período", "Alterações"];
    const summarizeChanges = (details) => {
      const changes = details?.changes || {};
      const entries = Object.entries(changes);
      if (!entries.length) {
        return "";
      }
      return entries.map(([field, change]) => `${field}: ${change.before ?? "-"} -> ${change.after ?? "-"}`).join(" | ");
    };

    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
    const content = [
      headers,
      ...rows.map((row) => ([
        row.created_at,
        row.user_name,
        row.action,
        row.entity_type,
        row.entity_label || "",
        row.month_ref || "",
        summarizeChanges(row.details_json)
      ]))
    ].map((line) => line.map(escapeCsv).join(";")).join("\r\n");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(this.auditExportsDir, `auditoria-${stamp}.csv`);
    fs.writeFileSync(target, `\uFEFF${content}`, "utf8");
    return { ok: true, path: target, count: rows.length };
  }

  exportAuditExcel(filters = {}) {
    const rows = this.listAuditLogs({ ...filters, limit: Number(filters.limit || 5000) });
    if (!rows.length) {
      return { ok: false, message: "Não existem registos de auditoria para exportar com os filtros atuais." };
    }

    const content = buildExcelTableDocument(
      "Auditoria do Sistema",
      ["Data", "Utilizador", "Ação", "Entidade", "Referência", "Período", "Alterações"],
      rows.map((row) => [
        row.created_at,
        row.user_name,
        row.action,
        row.entity_type,
        row.entity_label || "",
        row.month_ref || "",
        Object.entries(row.details_json?.changes || {})
          .map(([field, change]) => `${field}: ${change.before ?? "-"} -> ${change.after ?? "-"}`)
          .join(" | ")
      ])
    );

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(this.auditExportsDir, `auditoria-${stamp}.xls`);
    fs.writeFileSync(target, content, "utf8");
    return { ok: true, path: target, count: rows.length, format: "xls" };
  }

  recordAudit(payload) {
    return recordAuditDomain(this, payload, nowIso);
  }

  getCompanySnapshot() {
    return pickFields(this.getCompanyProfile(), ["name", "nif", "email", "address", "phone", "logo_path", "origin_bank_code", "origin_account"]);
  }

  getSettingsSnapshot() {
    return pickFields(this.getSystemSettings(), [
      "currency",
      "inssEmployeeRate",
      "inssEmployerRate",
      "smtpHost",
      "smtpPort",
      "smtpSecure",
      "smtpUser",
      "smtpFromName",
      "smtpFromEmail",
      "attendanceDelayPenaltyThresholdMinutes",
      "attendanceDelayPenaltyEquivalentDays",
      "attendanceAutoSyncEnabled",
      "attendanceWatchedFolder",
      "attendanceWatchedSourceType",
      "attendanceBiometricProfile",
      "attendanceCardProfile",
      "attendanceIncrementalImport",
      "vacationMonth",
      "christmasMonth",
      "allowanceTypes",
      "bonusTypes"
    ]);
  }

  hasClosedPeriods() {
    return this.db.prepare("SELECT COUNT(*) AS total FROM payroll_periods WHERE status = 'closed'").get().total > 0;
  }

  getClosedPayrollRunsForEmployee(employeeId) {
    return this.db.prepare(`
      SELECT payroll_runs.month_ref
      FROM payroll_runs
      INNER JOIN payroll_periods ON payroll_periods.month_ref = payroll_runs.month_ref
      WHERE payroll_runs.employee_id = ? AND payroll_periods.status = 'closed'
      ORDER BY payroll_runs.month_ref DESC
    `).all(employeeId);
  }

  login({ username, password }) {
    if (this.isInitialSetupPending()) {
      return { ok: false, message: "Conclua primeiro o registo inicial da empresa e do administrador." };
    }

    const normalizedCredential = String(username || "").trim().toLowerCase();
    const user = this.db.prepare("SELECT * FROM users WHERE username = ? OR LOWER(COALESCE(email, '')) = ?").get(
      normalizedCredential,
      normalizedCredential
    );
    if (!user || !user.active) {
      return { ok: false, message: "Utilizador não encontrado ou inativo." };
    }
    if (!verifyPassword(password, user.password_hash)) {
      return { ok: false, message: "Palavra-passe inválida." };
    }

    if (needsPasswordRehash(user.password_hash)) {
      const upgradedHash = hashPassword(password);
      this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(upgradedHash, user.id);
      user.password_hash = upgradedHash;
    }

    return {
      ok: true,
      user: this.getUserPayload(user),
      mustChangePassword: Boolean(user.must_change_password)
    };
  }

  getSessionSecret() {
    if (this.sessionSecret) {
      return this.sessionSecret;
    }

    const protectedSecret =
      this.secureStorage?.loadSecret && typeof this.secureStorage.loadSecret === "function"
        ? String(this.secureStorage.loadSecret("session-state-key") || "").trim()
        : "";
    if (protectedSecret) {
      this.sessionSecret = protectedSecret;
      safeUnlink(this.sessionSecretPath);
      return this.sessionSecret;
    }

    if (fs.existsSync(this.sessionSecretPath)) {
      const legacySecret = String(fs.readFileSync(this.sessionSecretPath, "utf8") || "").trim();
      if (legacySecret) {
        if (this.secureStorage?.storeSecret && typeof this.secureStorage.storeSecret === "function") {
          this.secureStorage.storeSecret("session-state-key", legacySecret);
          safeUnlink(this.sessionSecretPath);
        }
        this.sessionSecret = legacySecret;
        return this.sessionSecret;
      }
    }

    const generatedSecret = crypto.randomBytes(SESSION_SECRET_BYTES).toString("hex");
    if (this.secureStorage?.storeSecret && typeof this.secureStorage.storeSecret === "function") {
      this.secureStorage.storeSecret("session-state-key", generatedSecret);
      safeUnlink(this.sessionSecretPath);
    } else {
      fs.writeFileSync(this.sessionSecretPath, generatedSecret, "utf8");
    }
    this.sessionSecret = generatedSecret;
    return this.sessionSecret;
  }

  signSessionPayload(serializedPayload) {
    return crypto.createHmac("sha256", this.getSessionSecret()).update(serializedPayload).digest("hex");
  }

  readSessionPayload() {
    if (!fs.existsSync(this.sessionPath)) {
      return null;
    }

    try {
      const envelope = JSON.parse(fs.readFileSync(this.sessionPath, "utf8"));
      if (
        !envelope ||
        Number(envelope.version) !== SESSION_STATE_VERSION ||
        typeof envelope.payload !== "string" ||
        typeof envelope.signature !== "string"
      ) {
        throw new Error("Sessao invalida.");
      }

      const expectedSignature = this.signSessionPayload(envelope.payload);
      if (!areDigestsEqual(expectedSignature, envelope.signature)) {
        throw new Error("Assinatura de sessao invalida.");
      }

      const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
      const userId = Number(payload?.userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error("Utilizador de sessao invalido.");
      }

      return {
        userId,
        savedAt: String(payload.savedAt || "").trim()
      };
    } catch (error) {
      this.clearSession();
      return null;
    }
  }

  persistSession(userId) {
    const serializedPayload = Buffer.from(
      JSON.stringify({
        userId: Number(userId),
        savedAt: nowIso()
      }),
      "utf8"
    ).toString("base64");

    fs.writeFileSync(
      this.sessionPath,
      JSON.stringify(
        {
          version: SESSION_STATE_VERSION,
          payload: serializedPayload,
          signature: this.signSessionPayload(serializedPayload)
        },
        null,
        2
      )
    );
    return { ok: true };
  }

  clearSession() {
    safeUnlink(this.sessionPath);
    return { ok: true };
  }

  restoreSession() {
    if (!fs.existsSync(this.sessionPath)) {
      return { ok: false };
    }

    if (this.isInitialSetupPending()) {
      this.clearSession();
      return { ok: false };
    }

    const payload = this.readSessionPayload();
    if (!payload) {
      return { ok: false };
    }

    const user = this.getUserById(payload.userId);
    if (!user || !user.active) {
      this.clearSession();
      return { ok: false };
    }

    return {
      ok: true,
      user: this.getUserPayload(user),
      mustChangePassword: Boolean(user.must_change_password)
    };
  }

  registerInitialAccount(payload) {
    if (!this.isInitialSetupPending()) {
      return { ok: false, message: "O registo inicial já foi concluído." };
    }

    const companyName = String(payload?.company_name || "").trim();
    const companyNif = onlyDigits(payload?.company_nif);
    const companyEmail = String(payload?.company_email || "").trim();
    const companyPhone = String(payload?.company_phone || "").trim();
    const companyAddress = String(payload?.company_address || "").trim();
    const fullName = String(payload?.full_name || "").trim();
    const adminEmail = String(payload?.admin_email || "").trim();
    const username = String(payload?.username || "").trim().toLowerCase();
    const password = String(payload?.password || "").trim();

    if (!companyName || !companyNif || !fullName || !username || !password) {
      return { ok: false, message: "Empresa, NIF, nome do administrador, utilizador e palavra-passe são obrigatórios." };
    }

    if (password.length < 4) {
      return { ok: false, message: "A palavra-passe deve ter pelo menos 4 caracteres." };
    }

    if (companyEmail && !isValidEmail(companyEmail)) {
      return { ok: false, message: "Indique um e-mail válido para a empresa." };
    }

    if (adminEmail && !isValidEmail(adminEmail)) {
      return { ok: false, message: "Indique um e-mail válido para o administrador." };
    }

    const users = this.db.prepare("SELECT * FROM users ORDER BY id").all();
    const defaultSeedUser = this.getDefaultSeedUser();
    const userCount = users.length;

    if (userCount > 0 && !defaultSeedUser && String(this.getCompanyProfile()?.name || "").trim()) {
      return { ok: false, message: "O registo inicial já foi concluído. Utilize o início de sessão." };
    }

    try {
      const registrationCompletedAt = nowIso();
      this.db.prepare(`
        UPDATE company_profile
        SET name = @name, nif = @nif, email = @email, address = @address, phone = @phone, updated_at = @updated_at
        WHERE id = 1
      `).run({
        name: companyName,
        nif: companyNif,
        email: companyEmail,
        address: companyAddress,
        phone: companyPhone,
        updated_at: nowIso()
      });

      let adminUserId = null;
      if (defaultSeedUser) {
        this.db.prepare(`
          UPDATE users
          SET full_name = @full_name,
              email = @email,
              username = @username,
              password_hash = @password_hash,
              role = 'admin',
              active = 1,
              must_change_password = 0
          WHERE id = @id
        `).run({
          id: defaultSeedUser.id,
          full_name: fullName,
          email: adminEmail,
          username,
          password_hash: hashPassword(password)
        });
        adminUserId = defaultSeedUser.id;
      } else if (userCount === 0) {
        const insert = this.db.prepare(`
          INSERT INTO users (full_name, email, username, password_hash, role, active, must_change_password, created_at)
          VALUES (@full_name, @email, @username, @password_hash, 'admin', 1, 0, @created_at)
        `).run({
          full_name: fullName,
          email: adminEmail,
          username,
          password_hash: hashPassword(password),
          created_at: registrationCompletedAt
        });
        adminUserId = insert.lastInsertRowid;
      } else {
        return { ok: false, message: "Já existem utilizadores no sistema. Utilize o início de sessão." };
      }

      this.ensureLicenseTrialStarted(registrationCompletedAt);
      this.clearSession();
      return {
        ok: true,
        user: this.getUserPayload(this.getUserById(adminUserId)),
        company: this.getCompanyProfile()
      };
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return { ok: false, message: "Este nome de utilizador já está em uso." };
      }
      throw error;
    }
  }

  saveUser(payload) {
    const fullName = String(payload.full_name || "").trim();
    const email = String(payload.email || "").trim();
    const username = String(payload.username || "").trim().toLowerCase();
    const role = payload.role === "operador" ? "operador" : "admin";
    const active = payload.active === false ? 0 : 1;

    if (!fullName || !username) {
      return { ok: false, message: "Nome e utilizador são obrigatórios." };
    }

    if (email && !isValidEmail(email)) {
      return { ok: false, message: "Indique um e-mail válido para o utilizador." };
    }

    try {
      if (payload.id) {
        const current = this.db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
        if (!current) {
          return { ok: false, message: "Utilizador não encontrado." };
        }

        const removingAdminAccess = current.role === "admin" && (active === 0 || role !== "admin");
        if (removingAdminAccess && this.countActiveAdmins(current.id) === 0) {
          return { ok: false, message: "Tem de existir pelo menos um administrador ativo." };
        }

        this.db.prepare(`
          UPDATE users
          SET full_name = @full_name, email = @email, username = @username, role = @role, active = @active
          WHERE id = @id
        `).run({
          id: payload.id,
          full_name: fullName,
          email,
          username,
          role,
          active
        });
      } else {
        const password = String(payload.password || "").trim();
        if (!password) {
          return { ok: false, message: "Defina uma palavra-passe inicial para o utilizador." };
        }

        this.db.prepare(`
          INSERT INTO users (full_name, email, username, password_hash, role, active, must_change_password, created_at)
          VALUES (@full_name, @email, @username, @password_hash, @role, @active, @must_change_password, @created_at)
        `).run({
          full_name: fullName,
          email,
          username,
          password_hash: hashPassword(password),
          role,
          active,
          must_change_password: 1,
          created_at: nowIso()
        });
      }
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return { ok: false, message: "Este nome de utilizador já está em uso." };
      }
      throw error;
    }

    return { ok: true, users: this.listUsers() };
  }

  preparePasswordReset(identifier) {
    if (this.isInitialSetupPending()) {
      return { ok: false, message: "Conclua primeiro o registo inicial antes de redefinir palavras-passe." };
    }

    const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
    if (!normalizedIdentifier) {
      return { ok: false, message: "Indique o utilizador ou o e-mail associado." };
    }

    const user = this.db.prepare(`
      SELECT *
      FROM users
      WHERE active = 1
        AND (username = ? OR LOWER(COALESCE(email, '')) = ?)
    `).get(normalizedIdentifier, normalizedIdentifier);

    if (!user) {
      return { ok: false, message: "Não foi encontrado nenhum utilizador ativo com esse utilizador ou e-mail." };
    }

    const email = String(user.email || "").trim();
    if (!email) {
      return { ok: false, message: "Este utilizador não tem um e-mail registado. Contacte o administrador." };
    }

    if (!isValidEmail(email)) {
      return { ok: false, message: "O e-mail registado para este utilizador é inválido. Corrija-o nas configurações." };
    }

    return {
      ok: true,
      reset: {
        userId: user.id,
        fullName: user.full_name,
        username: user.username,
        email,
        maskedEmail: maskEmailAddress(email),
        resetToken: generatePasswordResetToken(),
        expiresAt: addMinutesToIso(nowIso(), PASSWORD_RESET_EXPIRY_MINUTES),
        requestedIdentifier: normalizedIdentifier
      }
    };
  }

  createPasswordResetRequest(resetPayload) {
    if (!resetPayload?.userId || !resetPayload?.resetToken || !resetPayload?.expiresAt) {
      return { ok: false, message: "Dados insuficientes para preparar a recuperação de acesso." };
    }

    const tokenHash = hashPasswordResetToken(resetPayload.resetToken);
    if (!tokenHash) {
      return { ok: false, message: "O código de redefinição gerado é inválido." };
    }

    const activeUser = this.getUserById(resetPayload.userId);
    if (!activeUser || !activeUser.active) {
      return { ok: false, message: "O utilizador já não se encontra disponível para redefinição." };
    }

    this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE password_reset_tokens
        SET revoked_at = ?
        WHERE user_id = ?
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `).run(nowIso(), resetPayload.userId);

      this.db.prepare(`
        INSERT INTO password_reset_tokens (
          user_id, token_hash, requested_identifier, delivery_email, expires_at, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?
        )
      `).run(
        resetPayload.userId,
        tokenHash,
        String(resetPayload.requestedIdentifier || "").trim(),
        String(resetPayload.email || "").trim(),
        String(resetPayload.expiresAt || "").trim(),
        nowIso()
      );
    });

    return { ok: true, users: this.listUsers() };
  }

  revokePasswordResetRequest(resetPayload) {
    if (!resetPayload?.userId || !resetPayload?.resetToken) {
      return { ok: false, message: "Não foi possível revogar o pedido de redefinição." };
    }

    const tokenHash = hashPasswordResetToken(resetPayload.resetToken);
    if (!tokenHash) {
      return { ok: false, message: "Não foi possível revogar o código de redefinição." };
    }

    this.db.prepare(`
      UPDATE password_reset_tokens
      SET revoked_at = ?
      WHERE user_id = ?
        AND token_hash = ?
        AND consumed_at IS NULL
        AND revoked_at IS NULL
    `).run(nowIso(), resetPayload.userId, tokenHash);

    return { ok: true };
  }

  invalidatePasswordResetTokens(userId) {
    if (!userId) {
      return { ok: false, message: "Utilizador inválido para invalidar códigos de redefinição." };
    }

    this.db.prepare(`
      UPDATE password_reset_tokens
      SET revoked_at = ?
      WHERE user_id = ?
        AND consumed_at IS NULL
        AND revoked_at IS NULL
    `).run(nowIso(), userId);

    return { ok: true };
  }

  completePasswordReset({ identifier, resetToken, newPassword }) {
    if (this.isInitialSetupPending()) {
      return { ok: false, message: "Conclua primeiro o registo inicial antes de redefinir palavras-passe." };
    }

    const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
    if (!normalizedIdentifier) {
      return { ok: false, message: "Indique o utilizador ou o e-mail associado." };
    }

    const tokenHash = hashPasswordResetToken(resetToken);
    if (!tokenHash) {
      return { ok: false, message: "Introduza o código de redefinição enviado por e-mail." };
    }

    const nextPassword = String(newPassword || "").trim();
    if (nextPassword.length < 4) {
      return { ok: false, message: "A nova palavra-passe deve ter pelo menos 4 caracteres." };
    }

    const user = this.db.prepare(`
      SELECT *
      FROM users
      WHERE active = 1
        AND (username = ? OR LOWER(COALESCE(email, '')) = ?)
    `).get(normalizedIdentifier, normalizedIdentifier);

    if (!user) {
      return { ok: false, message: "Não foi encontrado nenhum utilizador ativo com esse utilizador ou e-mail." };
    }

    const now = nowIso();
    const tokenRow = this.db.prepare(`
      SELECT *
      FROM password_reset_tokens
      WHERE user_id = ?
        AND token_hash = ?
        AND consumed_at IS NULL
        AND revoked_at IS NULL
        AND expires_at >= ?
      ORDER BY id DESC
      LIMIT 1
    `).get(user.id, tokenHash, now);

    if (!tokenRow) {
      return { ok: false, message: "O código de redefinição é inválido ou já expirou." };
    }

    this.runInTransaction(() => {
      this.db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
        hashPassword(nextPassword),
        user.id
      );

      this.db.prepare("UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?").run(now, tokenRow.id);

      this.db.prepare(`
        UPDATE password_reset_tokens
        SET revoked_at = ?
        WHERE user_id = ?
          AND id != ?
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `).run(now, user.id, tokenRow.id);
    });

    return { ok: true, users: this.listUsers() };
  }

  deleteUser(userId) {
    const current = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!current) {
      return { ok: false, message: "Utilizador não encontrado." };
    }

    if (current.role === "admin" && this.countActiveAdmins(current.id) === 0) {
      return { ok: false, message: "Não pode remover o último administrador ativo." };
    }

    this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return { ok: true, users: this.listUsers() };
  }

  changePassword({ userId, currentPassword, newPassword, resetByAdmin }) {
    const user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) {
      return { ok: false, message: "Utilizador não encontrado." };
    }

    const nextPassword = String(newPassword || "").trim();
    if (nextPassword.length < 4) {
      return { ok: false, message: "A nova palavra-passe deve ter pelo menos 4 caracteres." };
    }

    if (!resetByAdmin) {
      if (!verifyPassword(currentPassword || "", user.password_hash)) {
        return { ok: false, message: "Palavra-passe atual inválida." };
      }
    }

    this.db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(
      hashPassword(nextPassword),
      resetByAdmin ? 1 : 0,
      userId
    );
    this.invalidatePasswordResetTokens(userId);

    return { ok: true, users: this.listUsers() };
  }

  countActiveAdmins(excludeUserId = null) {
    if (excludeUserId) {
      return this.db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(excludeUserId).total;
    }
    return this.db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").get().total;
  }

  getEmployeeSnapshot(employeeId) {
    const employee = this.listEmployees().find((item) => Number(item.id) === Number(employeeId));
    if (!employee) {
      return null;
    }

    return pickFields(employee, [
      "id",
      "full_name",
        "document_type",
        "bi",
        "driver_license_number",
        "nif",
        "social_security_number",
        "attendance_code",
        "birth_date",
        "gender",
        "marital_status",
        "nationality",
        "personal_phone",
      "personal_email",
      "address",
      "job_title",
        "department",
        "base_salary",
        "contract_type",
        "hire_date",
        "shift_id",
        "shift_name",
        "shift_profile",
        "iban",
        "bank_code",
        "bank_account",
        "status",
        "notes"
    ]);
  }

  getEventSnapshot(eventId) {
    const event = this.db.prepare(`
      SELECT payroll_events.*, employees.full_name
      FROM payroll_events
      INNER JOIN employees ON employees.id = payroll_events.employee_id
      WHERE payroll_events.id = ?
    `).get(eventId);

    if (!event) {
      return null;
    }

    return pickFields(event, [
      "id",
      "employee_id",
      "full_name",
      "event_type",
      "event_date",
      "amount",
      "quantity",
      "description"
    ]);
  }

  getLeaveRequestSnapshot(leaveRequestId) {
    const request = this.listLeaveRequests({ id: leaveRequestId })[0];
    if (!request) {
      return null;
    }

    return pickFields(request, [
      "id",
      "employee_id",
      "full_name",
      "record_type",
      "start_date",
      "end_date",
      "days",
      "reason",
      "document_ref",
      "proof_type",
      "notes",
      "status",
      "affects_payroll",
      "approved_by_name",
      "approved_at",
      "rejection_reason"
    ]);
  }

  getVacationBalanceSnapshot(balanceId) {
    const balance = this.listVacationBalances({ id: balanceId })[0];
    if (!balance) {
      return null;
    }

    return pickFields(balance, [
      "id",
      "employee_id",
      "full_name",
      "year_ref",
      "entitled_days",
      "carried_days",
      "manual_adjustment",
      "notes",
      "approved_days",
      "taken_days",
      "pending_days",
      "remaining_days"
    ]);
  }

  getVacationRequestSnapshot(vacationRequestId) {
    const request = this.listVacationRequests({ id: vacationRequestId })[0];
    if (!request) {
      return null;
    }

    return pickFields(request, [
      "id",
      "employee_id",
      "full_name",
      "year_ref",
      "start_date",
      "end_date",
      "days",
      "notes",
      "status",
      "approved_by_name",
      "approved_at",
      "rejection_reason"
    ]);
  }

  getAttendanceSnapshot(attendanceId) {
    const record = this.listAttendanceRecords({ id: attendanceId })[0];
    if (!record) {
      return null;
    }

    return pickFields(record, [
      "id",
      "employee_id",
      "full_name",
      "attendance_date",
      "status",
      "shift_id",
      "shift_name",
      "check_in_time",
      "check_out_time",
      "punch_count",
      "approval_status",
      "approved_by_name",
      "approved_at",
      "hours_worked",
      "delay_minutes",
      "source",
      "device_label",
      "batch_id",
      "notes"
    ]);
  }

  getAttendanceImportBatchSnapshot(batchId) {
    const batch = this.listAttendanceImportBatches({ id: batchId })[0];
    if (!batch) {
      return null;
    }

    return pickFields(batch, [
      "id",
      "source_type",
      "file_name",
      "file_path",
      "file_hash",
      "device_label",
      "device_profile",
      "import_mode",
      "month_ref",
      "total_rows",
      "imported_rows",
      "skipped_rows",
      "sync_status",
      "technical_message",
      "imported_by_user_id",
      "imported_by_name",
      "created_at"
    ]);
  }

  getWorkShiftSnapshot(shiftId) {
    const shift = this.listWorkShifts({ id: shiftId })[0];
    if (!shift) {
      return null;
    }

    return pickFields(shift, [
      "id",
      "code",
      "name",
      "department",
      "profile",
      "start_time",
      "end_time",
      "tolerance_minutes",
      "break_minutes",
      "working_days",
      "class_blocks",
      "notes",
      "active",
      "employee_count"
    ]);
  }

  getSalaryScaleSnapshot(scaleId) {
    const scale = this.listSalaryScales({ id: scaleId })[0];
    if (!scale) {
      return null;
    }

    return pickFields(scale, [
      "id",
      "job_title",
      "department",
      "min_salary",
      "reference_salary",
      "max_salary",
      "notes",
      "active",
      "employee_count"
    ]);
  }

  getFinancialObligationSnapshot(obligationId) {
    const obligation = this.listFinancialObligations({ id: obligationId })[0];
    if (!obligation) {
      return null;
    }

    return pickFields(obligation, [
      "id",
      "employee_id",
      "full_name",
      "entry_type",
      "label",
      "principal_amount",
      "installment_count",
      "installment_amount",
      "start_month_ref",
      "notes",
      "active",
      "paid_installments",
      "remaining_installments",
      "remaining_balance",
      "current_month_amount",
      "is_due_this_month"
    ]);
  }

  getEmployeeRecord(employeeId) {
    return this.db.prepare(`
      SELECT id, full_name, department, job_title
      FROM employees
      WHERE id = ?
    `).get(employeeId);
  }

  resolveEmployeeDocumentDirectory(employee) {
    const employeeId = Number(employee?.id || 0);
    const employeeName = sanitizeFileNameSegment(employee?.full_name || `funcionario-${employeeId}`, "funcionario");
    const targetDir = path.join(this.employeeDocumentsDir, `${String(employeeId).padStart(4, "0")}-${employeeName}`);
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }

  isManagedEmployeeDocumentPath(filePath) {
    const normalizedRoot = path.resolve(this.employeeDocumentsDir);
    const normalizedPath = path.resolve(String(filePath || ""));
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
  }

  storeEmployeeDocumentAttachment(employee, sourcePath, title = "") {
    const resolvedSource = path.resolve(String(sourcePath || ""));
    if (!resolvedSource || !fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
      throw new Error("O ficheiro selecionado para o documento nao existe ou nao esta acessivel.");
    }

    const extension = path.extname(resolvedSource).toLowerCase();
    const baseName = sanitizeFileNameSegment(title || path.basename(resolvedSource, extension), "documento");
    const targetDir = this.resolveEmployeeDocumentDirectory(employee);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetPath = path.join(targetDir, `${timestamp}-${baseName}${extension}`);

    fs.copyFileSync(resolvedSource, targetPath);
    const stats = fs.statSync(targetPath);

    return {
      file_name: path.basename(resolvedSource),
      stored_file_path: targetPath,
      file_size: Number(stats.size || 0)
    };
  }

  validateEmployeeDocumentPayload(payload = {}) {
    const employeeId = Number(payload.employee_id || 0);
    const employee = employeeId ? this.getEmployeeRecord(employeeId) : null;
    const title = String(payload.title || "").trim();
    const category = normalizeEmployeeDocumentCategory(payload.category);
    const documentNumber = String(payload.document_number || "").trim();
    const issuer = String(payload.issuer || "").trim();
    const issueDate = String(payload.issue_date || "").trim();
    const effectiveDate = String(payload.effective_date || "").trim();
    const expiryDate = String(payload.expiry_date || "").trim();
    const notes = String(payload.notes || "").trim();
    const status = normalizeEmployeeDocumentStatus(payload.status);
    const alertDaysBefore = Math.max(0, Math.min(365, Number(payload.alert_days_before || 30)));
    const filePath = String(payload.file_path || "").trim();

    if (!employee) {
      return { ok: false, message: "Selecione um trabalhador valido para registar o documento." };
    }
    if (title.length < 3) {
      return { ok: false, message: "Indique um titulo claro para o documento laboral." };
    }
    if (issueDate && !isValidIsoDate(issueDate)) {
      return { ok: false, message: "A data de emissao do documento e invalida." };
    }
    if (effectiveDate && !isValidIsoDate(effectiveDate)) {
      return { ok: false, message: "A data de inicio de vigencia do documento e invalida." };
    }
    if (expiryDate && !isValidIsoDate(expiryDate)) {
      return { ok: false, message: "A data de validade do documento e invalida." };
    }
    if (issueDate && expiryDate && issueDate > expiryDate) {
      return { ok: false, message: "A validade do documento deve ser posterior a data de emissao." };
    }
    if (filePath) {
      const resolvedFilePath = path.resolve(filePath);
      if (!fs.existsSync(resolvedFilePath) || !fs.statSync(resolvedFilePath).isFile()) {
        return { ok: false, message: "O ficheiro selecionado para o documento nao existe." };
      }
    }

    return {
      ok: true,
      employee,
      sanitized: {
        employee_id: employeeId,
        category,
        title,
        document_number: documentNumber,
        issuer,
        issue_date: issueDate || null,
        effective_date: effectiveDate || null,
        expiry_date: expiryDate || null,
        alert_days_before: alertDaysBefore,
        notes,
        status,
        file_path: filePath
      }
    };
  }

  mapEmployeeDocumentRow(row) {
    if (!row) {
      return null;
    }

    const lifecycle = calculateEmployeeDocumentLifecycleStatus(
      row.expiry_date,
      row.status,
      Number(row.alert_days_before || 30)
    );

    return {
      ...row,
      alert_days_before: Number(row.alert_days_before || 0),
      file_size: Number(row.file_size || 0),
      file_exists: Boolean(row.stored_file_path) && fs.existsSync(row.stored_file_path),
      lifecycle_status: lifecycle.lifecycle_status,
      days_until_expiry: lifecycle.days_until_expiry
    };
  }

  listEmployeeDocuments(filters = {}) {
    const query = buildEmployeeDocumentsFilter(filters, normalizeEmployeeDocumentCategory);
    const rows = this.db.prepare(`
      SELECT
        employee_documents.*,
        employees.full_name,
        employees.department,
        employees.job_title,
        creator.full_name AS created_by_name
      FROM employee_documents
      INNER JOIN employees ON employees.id = employee_documents.employee_id
      LEFT JOIN users AS creator ON creator.id = employee_documents.created_by_user_id
      ${query.whereClause}
      ORDER BY
        CASE WHEN employee_documents.expiry_date IS NULL OR employee_documents.expiry_date = '' THEN 1 ELSE 0 END,
        employee_documents.expiry_date ASC,
        employee_documents.created_at DESC,
        employee_documents.id DESC
    `).all(query.values).map((row) => this.mapEmployeeDocumentRow(row));
    return applyEmployeeDocumentClientFilters(rows, filters);
  }

  getEmployeeDocumentSnapshot(documentId) {
    const document = this.listEmployeeDocuments({ id: documentId })[0];
    if (!document) {
      return null;
    }

    return pickFields(document, [
      "id",
      "employee_id",
      "full_name",
      "category",
      "title",
      "document_number",
      "issuer",
      "issue_date",
      "effective_date",
      "expiry_date",
      "alert_days_before",
      "file_name",
      "stored_file_path",
      "file_size",
      "status",
      "lifecycle_status",
      "days_until_expiry",
      "notes",
      "created_by_name",
      "created_at",
      "updated_at"
    ]);
  }

  listEmployeeDocumentAlerts(filters = {}) {
    const daysAhead = Math.max(0, Number(filters.daysAhead || 30));
    const limit = Math.max(0, Number(filters.limit || 12));

    const alerts = this.listEmployeeDocuments({ status: "todos" }).filter((row) => {
      if (row.lifecycle_status === "expired") {
        return true;
      }
      return row.lifecycle_status === "expiring" && Number(row.days_until_expiry ?? daysAhead + 1) <= daysAhead;
    });

    return limit ? alerts.slice(0, limit) : alerts;
  }

  saveEmployeeDocument(payload, userId = null) {
    return saveEmployeeDocumentDomain(this, payload, userId, nowIso, safeUnlink);
  }

  deleteEmployeeDocument(documentId) {
    return deleteEmployeeDocumentDomain(this, documentId, safeUnlink);
  }

  listWorkShifts(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("work_shifts.id = @id");
      values.id = filters.id;
    }
    if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
      conditions.push("work_shifts.active = @active");
      values.active = filters.active ? 1 : 0;
    }
    if (filters.profile) {
      conditions.push("work_shifts.profile = @profile");
      values.profile = String(filters.profile).trim();
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db.prepare(`
      SELECT
        work_shifts.*,
        (
          SELECT COUNT(*)
          FROM employees
          WHERE employees.shift_id = work_shifts.id
        ) AS employee_count
      FROM work_shifts
      ${whereClause}
      ORDER BY LOWER(work_shifts.name) ASC, work_shifts.id DESC
    `).all(values).map((row) => ({
      ...row,
      active: Boolean(row.active),
      tolerance_minutes: Number(row.tolerance_minutes || 0),
      break_minutes: Number(row.break_minutes || 0),
      working_days: normalizeWorkingDays(JSON.parse(row.working_days_json || "[]")),
      class_blocks: JSON.parse(row.class_blocks_json || "[]")
    }));
  }

  listAttendanceImportBatches(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("attendance_import_batches.id = @id");
      values.id = filters.id;
    }
    if (filters.monthRef) {
      conditions.push("attendance_import_batches.month_ref = @monthRef");
      values.monthRef = filters.monthRef;
    }
    if (filters.sourceType) {
      conditions.push("attendance_import_batches.source_type = @sourceType");
      values.sourceType = filters.sourceType;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = Number(filters.limit || 20) > 0 ? `LIMIT ${Number(filters.limit || 20)}` : "";

    return this.db.prepare(`
      SELECT
        attendance_import_batches.*,
        users.full_name AS imported_by_name
      FROM attendance_import_batches
      LEFT JOIN users ON users.id = attendance_import_batches.imported_by_user_id
      ${whereClause}
      ORDER BY attendance_import_batches.created_at DESC, attendance_import_batches.id DESC
      ${limitClause}
    `).all(values);
  }

  listAttendanceImportLogs(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.batchId) {
      conditions.push("attendance_import_logs.batch_id = @batchId");
      values.batchId = filters.batchId;
    }
    if (filters.employeeId) {
      conditions.push("attendance_import_logs.employee_id = @employeeId");
      values.employeeId = filters.employeeId;
    }
    if (filters.monthRef) {
      conditions.push("substr(attendance_import_logs.attendance_date, 1, 7) = @monthRef");
      values.monthRef = filters.monthRef;
    }
    if (filters.outcome) {
      conditions.push("attendance_import_logs.outcome = @outcome");
      values.outcome = String(filters.outcome).trim().toLowerCase();
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = Number(filters.limit || 80) > 0 ? `LIMIT ${Number(filters.limit || 80)}` : "";

    return this.db.prepare(`
      SELECT
        attendance_import_logs.*,
        employees.full_name,
        attendance_import_batches.file_name,
        attendance_import_batches.source_type,
        attendance_import_batches.device_label,
        attendance_import_batches.device_profile,
        attendance_import_batches.import_mode
      FROM attendance_import_logs
      LEFT JOIN employees ON employees.id = attendance_import_logs.employee_id
      LEFT JOIN attendance_import_batches ON attendance_import_batches.id = attendance_import_logs.batch_id
      ${whereClause}
      ORDER BY attendance_import_logs.created_at DESC, attendance_import_logs.id DESC
      ${limitClause}
    `).all(values);
  }

  validateWorkShiftPayload(payload) {
    const code = String(payload.code || "").trim().toUpperCase();
    const name = String(payload.name || "").trim();
    const department = String(payload.department || "").trim();
    const profile = String(payload.profile || "general").trim().toLowerCase();
    const startTime = normalizeTimeValue(payload.start_time);
    const endTime = normalizeTimeValue(payload.end_time);
    const toleranceMinutes = Number(payload.tolerance_minutes || 0);
    const breakMinutes = Number(payload.break_minutes || 0);
    const workingDays = normalizeWorkingDays(payload.working_days);
    const notes = String(payload.notes || "").trim();

    if (code && !/^[A-Z0-9_-]{3,24}$/.test(code)) {
      return { ok: false, message: "O código do turno deve ter entre 3 e 24 caracteres alfanuméricos." };
    }
    if (name.length < 3) {
      return { ok: false, message: "Indique a designação do turno." };
    }
    if (!SHIFT_PROFILES.includes(profile)) {
      return { ok: false, message: "O perfil do turno é inválido." };
    }
    if (!startTime || !endTime) {
      return { ok: false, message: "Indique um horário válido para o turno." };
    }
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      return { ok: false, message: "A hora final do turno deve ser posterior à hora inicial." };
    }
    if (toleranceMinutes < 0 || toleranceMinutes > 240) {
      return { ok: false, message: "A tolerância do turno deve estar entre 0 e 240 minutos." };
    }
    if (breakMinutes < 0 || breakMinutes > 480) {
      return { ok: false, message: "O intervalo do turno deve estar entre 0 e 480 minutos." };
    }

    if (code) {
      const duplicate = this.db.prepare(`
        SELECT id
        FROM work_shifts
        WHERE UPPER(TRIM(code)) = UPPER(TRIM(?))
          AND (? IS NULL OR id <> ?)
      `).get(code, payload.id ?? null, payload.id ?? null);
      if (duplicate) {
        return { ok: false, message: "Já existe um turno registado com este código." };
      }
    }

    return {
      ok: true,
      sanitized: {
        code: code || null,
        name,
        department,
        profile,
        start_time: startTime,
        end_time: endTime,
        tolerance_minutes: toleranceMinutes,
        break_minutes: breakMinutes,
        working_days_json: JSON.stringify(workingDays),
        class_blocks_json: JSON.stringify(buildDocenteBlocks(profile, startTime, endTime)),
        notes,
        active: payload.active === undefined ? true : Boolean(payload.active)
      }
    };
  }

  validateSalaryScalePayload(payload) {
    const jobTitle = String(payload.job_title || "").trim();
    const department = String(payload.department || "").trim();
    const notes = String(payload.notes || "").trim();
    const minSalary = roundCurrency(payload.min_salary);
    const referenceSalary = roundCurrency(payload.reference_salary);
    const maxSalary = roundCurrency(payload.max_salary);

    if (jobTitle.length < 2) {
      return { ok: false, message: "Indique a função ou o cargo associado à escala salarial." };
    }
    if (!(minSalary > 0)) {
      return { ok: false, message: "O salário mínimo da escala deve ser superior a zero." };
    }
    if (!(referenceSalary > 0)) {
      return { ok: false, message: "O salário de referência deve ser superior a zero." };
    }
    if (!(maxSalary > 0)) {
      return { ok: false, message: "O salário máximo da escala deve ser superior a zero." };
    }
    if (minSalary > referenceSalary) {
      return { ok: false, message: "O salário de referência não pode ser inferior ao salário mínimo." };
    }
    if (referenceSalary > maxSalary) {
      return { ok: false, message: "O salário de referência não pode ser superior ao salário máximo." };
    }

    const duplicate = this.db.prepare(`
      SELECT id
      FROM salary_scales
      WHERE LOWER(TRIM(job_title)) = LOWER(TRIM(?))
        AND LOWER(TRIM(COALESCE(department, ''))) = LOWER(TRIM(?))
        AND (? IS NULL OR id <> ?)
    `).get(jobTitle, department, payload.id ?? null, payload.id ?? null);

    if (duplicate) {
      return {
        ok: false,
        message: "Já existe uma escala salarial ativa ou registada para esta função e este departamento."
      };
    }

    return {
      ok: true,
      sanitized: {
        job_title: jobTitle,
        department,
        min_salary: minSalary,
        reference_salary: referenceSalary,
        max_salary: maxSalary,
        notes,
        active: payload.active === undefined ? true : Boolean(payload.active)
      }
    };
  }

  listSalaryScales(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("salary_scales.id = @id");
      values.id = filters.id;
    }
    if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
      conditions.push("salary_scales.active = @active");
      values.active = filters.active ? 1 : 0;
    }
    if (filters.jobTitle) {
      conditions.push("LOWER(salary_scales.job_title) = LOWER(@jobTitle)");
      values.jobTitle = String(filters.jobTitle).trim();
    }
    if (filters.department !== undefined && filters.department !== null) {
      conditions.push("LOWER(COALESCE(salary_scales.department, '')) = LOWER(@department)");
      values.department = String(filters.department || "").trim();
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    return this.db.prepare(`
      SELECT
        salary_scales.*,
        (
          SELECT COUNT(*)
          FROM employees
          WHERE LOWER(TRIM(employees.job_title)) = LOWER(TRIM(salary_scales.job_title))
            AND (
              TRIM(COALESCE(salary_scales.department, '')) = ''
              OR LOWER(TRIM(employees.department)) = LOWER(TRIM(salary_scales.department))
            )
        ) AS employee_count
      FROM salary_scales
      ${whereClause}
      ORDER BY LOWER(salary_scales.job_title) ASC, LOWER(COALESCE(salary_scales.department, '')) ASC, salary_scales.id DESC
    `).all(values).map((row) => ({
      ...row,
      active: Boolean(row.active)
    }));
  }

  findSalaryScaleForEmployee(jobTitle, department = "") {
    const normalizedJobTitle = String(jobTitle || "").trim();
    const normalizedDepartment = String(department || "").trim();
    if (!normalizedJobTitle || !this.db) {
      return null;
    }

    return this.db.prepare(`
      SELECT salary_scales.*
      FROM salary_scales
      WHERE salary_scales.active = 1
        AND LOWER(TRIM(salary_scales.job_title)) = LOWER(TRIM(?))
        AND (
          LOWER(TRIM(COALESCE(salary_scales.department, ''))) = LOWER(TRIM(?))
          OR TRIM(COALESCE(salary_scales.department, '')) = ''
        )
      ORDER BY
        CASE
          WHEN LOWER(TRIM(COALESCE(salary_scales.department, ''))) = LOWER(TRIM(?)) THEN 0
          ELSE 1
        END,
        salary_scales.id DESC
    `).get(normalizedJobTitle, normalizedDepartment, normalizedDepartment) || null;
  }

  buildFinancialObligationState(obligation, referenceMonthRef = null) {
    const effectiveMonthRef =
      isValidMonthRef(referenceMonthRef) ? referenceMonthRef : new Date().toISOString().slice(0, 7);
    const schedule = buildInstallmentSchedule(
      obligation.principal_amount,
      obligation.installment_count,
      obligation.installment_amount
    );
    const monthOffset = monthRefDiff(obligation.start_month_ref, effectiveMonthRef);
    const paidInstallments = monthOffset < 0 ? 0 : Math.min(schedule.length, monthOffset);
    const paidAmount = roundCurrency(schedule.slice(0, paidInstallments).reduce((sum, amount) => sum + Number(amount || 0), 0));
    const isDueThisMonth = Boolean(obligation.active) && monthOffset >= 0 && monthOffset < schedule.length;
    const currentMonthAmount = isDueThisMonth ? Number(schedule[monthOffset] || 0) : 0;
    const processedInstallments = Math.min(schedule.length, paidInstallments + (isDueThisMonth ? 1 : 0));
    const processedAmount = roundCurrency(
      schedule.slice(0, processedInstallments).reduce((sum, amount) => sum + Number(amount || 0), 0)
    );

    return {
      paid_installments: paidInstallments,
      remaining_installments: Math.max(schedule.length - processedInstallments, 0),
      remaining_balance: Math.max(roundCurrency(Number(obligation.principal_amount || 0) - processedAmount), 0),
      current_month_amount: roundCurrency(currentMonthAmount),
      is_due_this_month: isDueThisMonth,
      schedule_amounts: schedule,
      paid_amount: paidAmount
    };
  }

  validateFinancialObligationPayload(payload) {
    const employeeId = Number(payload.employee_id || 0);
    const employee = this.db.prepare("SELECT id, full_name, hire_date FROM employees WHERE id = ?").get(employeeId);
    const entryType = String(payload.entry_type || "").trim().toLowerCase();
    const label = String(payload.label || "").trim();
    const principalAmount = roundCurrency(payload.principal_amount);
    const installmentCount = Number(payload.installment_count || 0);
    const startMonthRef = String(payload.start_month_ref || "").trim();
    const notes = String(payload.notes || "").trim();

    if (!employee) {
      return { ok: false, message: "Selecione um funcionário válido para o empréstimo ou adiantamento." };
    }
    if (!["loan", "advance"].includes(entryType)) {
      return { ok: false, message: "Selecione um tipo válido: empréstimo ou adiantamento." };
    }
    if (label.length < 3) {
      return { ok: false, message: "Indique uma descrição clara para o registo financeiro." };
    }
    if (!(principalAmount > 0)) {
      return { ok: false, message: "O valor total do empréstimo ou adiantamento deve ser maior do que zero." };
    }
    if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120) {
      return { ok: false, message: "O número de prestações deve estar entre 1 e 120." };
    }
    if (!isValidMonthRef(startMonthRef)) {
      return { ok: false, message: "O mês de início deve seguir o formato AAAA-MM." };
    }
    if (employee.hire_date && String(employee.hire_date).slice(0, 7) > startMonthRef) {
      return { ok: false, message: "O mês de início não pode ser anterior ao mês de admissão do funcionário." };
    }

    const providedInstallmentAmount = Number(payload.installment_amount || 0);
    const installmentAmount =
      providedInstallmentAmount > 0
        ? roundCurrency(providedInstallmentAmount)
        : roundCurrency(principalAmount / installmentCount);

    if (!(installmentAmount > 0)) {
      return { ok: false, message: "O valor da prestação deve ser maior do que zero." };
    }
    if (installmentAmount > principalAmount) {
      return { ok: false, message: "O valor da prestação não pode ser superior ao valor total." };
    }
    if (installmentCount > 1 && roundCurrency(installmentAmount * (installmentCount - 1)) >= principalAmount) {
      return {
        ok: false,
        message: "O valor da prestação é demasiado alto para o número de prestações indicado."
      };
    }

    return {
      ok: true,
      sanitized: {
        employee_id: employeeId,
        entry_type: entryType,
        label,
        principal_amount: principalAmount,
        installment_count: installmentCount,
        installment_amount: installmentAmount,
        start_month_ref: startMonthRef,
        notes,
        active: payload.active === undefined ? true : Boolean(payload.active)
      }
    };
  }

  validateEmployeePayload(payload) {
    const fullName = String(payload.full_name || "").trim();
    const documentType = String(payload.document_type || "bi").trim().toLowerCase();
    const bi = String(payload.bi || "").trim().toUpperCase();
    const driverLicenseNumber = String(payload.driver_license_number || "").trim().toUpperCase();
    const nif = onlyDigits(payload.nif);
    const socialSecurityNumber = onlyDigits(payload.social_security_number);
    const attendanceCode = String(payload.attendance_code || "").trim().toUpperCase();
    const birthDate = String(payload.birth_date || "").trim();
    const gender = String(payload.gender || "").trim();
    const maritalStatus = String(payload.marital_status || "").trim();
    const nationality = String(payload.nationality || "").trim();
    const personalPhone = String(payload.personal_phone || "").trim();
    const personalEmail = String(payload.personal_email || "").trim();
    const address = String(payload.address || "").trim();
    const jobTitle = String(payload.job_title || "").trim();
    const department = String(payload.department || "").trim();
    const contractType = String(payload.contract_type || "").trim();
    const hireDate = String(payload.hire_date || "").trim();
    const shiftId = Number(payload.shift_id || 0) || null;
    const iban = normalizeIban(payload.iban);
    const inferredBankCode = resolveBankCodeFromRegistryCode(extractAngolaBankRegistryCode(iban));
    const bankCode = String(payload.bank_code || inferredBankCode || "").trim().toUpperCase();
    const bankAccount = normalizeBankAccount(payload.bank_account) || (iban ? iban.slice(4) : "");
    const notes = String(payload.notes || "").trim();
    const baseSalary = Number(payload.base_salary || 0);
    if (fullName.length < 3) {
      return { ok: false, message: "Indique o nome completo do funcionário." };
    }
    if (!["bi", "passport", "foreign_card"].includes(documentType)) {
      return { ok: false, message: "Selecione um tipo de documento válido para o funcionário." };
    }
    const primaryDocumentValidation = validatePrimaryDocument(documentType, bi);
    if (!primaryDocumentValidation.ok) {
      return primaryDocumentValidation;
    }
    if (driverLicenseNumber && !/^[A-Z0-9-]{5,30}$/.test(driverLicenseNumber)) {
      return { ok: false, message: "O número da carta de condução deve conter entre 5 e 30 caracteres válidos." };
    }
    if (!/^\d{8,14}$/.test(nif)) {
      return { ok: false, message: "O NIF do funcionário deve conter entre 8 e 14 dígitos." };
    }
    if (socialSecurityNumber && !/^\d{6,20}$/.test(socialSecurityNumber)) {
      return { ok: false, message: "O número da Segurança Social deve conter entre 6 e 20 dígitos." };
    }
    if (attendanceCode && !/^[A-Z0-9_-]{2,30}$/.test(attendanceCode)) {
      return { ok: false, message: "O código biométrico ou de cartão deve ter entre 2 e 30 caracteres válidos." };
    }
    if (birthDate && !isValidIsoDate(birthDate)) {
      return { ok: false, message: "A data de nascimento do funcionário é inválida." };
    }
    if (birthDate && new Date(`${birthDate}T00:00:00`) > new Date()) {
      return { ok: false, message: "A data de nascimento não pode estar no futuro." };
    }
    if (!jobTitle) {
      return { ok: false, message: "Indique o cargo do funcionário." };
    }
    if (!department) {
      return { ok: false, message: "Indique o departamento do funcionário." };
    }
    if (!contractType) {
      return { ok: false, message: "Indique o tipo de contrato do funcionário." };
    }
    if (!isValidIsoDate(hireDate)) {
      return { ok: false, message: "A data de admissão do funcionário é inválida." };
    }
    const parsedHireDate = new Date(`${hireDate}T00:00:00`);
    if (parsedHireDate > new Date()) {
      return { ok: false, message: "A data de admissão não pode estar no futuro." };
    }
    if (birthDate && new Date(`${birthDate}T00:00:00`) >= parsedHireDate) {
      return { ok: false, message: "A data de nascimento deve ser anterior à data de admissão." };
    }
    if (baseSalary <= 0) {
      return { ok: false, message: "O salário base deve ser superior a zero." };
    }
    if (attendanceCode) {
      const duplicateEmployee = this?.db
        ? this.db.prepare(`
            SELECT id
            FROM employees
            WHERE UPPER(TRIM(COALESCE(attendance_code, ''))) = UPPER(TRIM(?))
              AND (? IS NULL OR id <> ?)
          `).get(attendanceCode, payload.id ?? null, payload.id ?? null)
        : null;
      if (duplicateEmployee) {
        return { ok: false, message: "O código biométrico/cartão já está associado a outro funcionário." };
      }
    }
    let assignedShift = null;
    if (shiftId) {
      assignedShift = this?.db
        ? this.db.prepare("SELECT id, name, active FROM work_shifts WHERE id = ?").get(shiftId)
        : null;
      if (!assignedShift) {
        return { ok: false, message: "O turno selecionado para o funcionário não existe." };
      }
      if (!assignedShift.active) {
        return { ok: false, message: "O turno selecionado está inativo. Ative-o ou escolha outro turno." };
      }
    }
    const salaryScale = this?.db ? this.findSalaryScaleForEmployee(jobTitle, department) : null;
    if (salaryScale && (baseSalary < Number(salaryScale.min_salary || 0) || baseSalary > Number(salaryScale.max_salary || 0))) {
      const scopeLabel = salaryScale.department
        ? `${salaryScale.job_title} / ${salaryScale.department}`
        : salaryScale.job_title;
      return {
        ok: false,
        message: `O salário base deste funcionário está fora da escala salarial definida para ${scopeLabel}. Intervalo permitido: ${formatCurrency(salaryScale.min_salary)} a ${formatCurrency(salaryScale.max_salary)}.`
      };
    }
    if (!/^AO\d{23}$/.test(iban)) {
      return { ok: false, message: "O IBAN do funcionário deve ser angolano e seguir o formato AO + 23 dígitos." };
    }
    if (!validateIbanChecksum(iban)) {
      return { ok: false, message: "O IBAN do funcionário não passou na validação de controlo." };
    }

    if (!bankCode) {
      return { ok: false, message: "Indique o banco do funcionário." };
    }
    if (!/^\d{6,30}$/.test(bankAccount)) {
      return { ok: false, message: "O número da conta bancária do funcionário deve conter entre 6 e 30 dígitos." };
    }
    if (personalPhone && !/^\+?\d{9,15}$/.test(personalPhone.replace(/\s+/g, ""))) {
      return { ok: false, message: "O telefone do funcionário deve conter entre 9 e 15 dígitos." };
    }
    if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      return { ok: false, message: "O e-mail do funcionário é inválido." };
    }

    return {
      ok: true,
      sanitized: {
        full_name: fullName,
        document_type: documentType,
        bi,
        driver_license_number: driverLicenseNumber,
        nif,
        social_security_number: socialSecurityNumber,
        attendance_code: attendanceCode,
        birth_date: birthDate,
        gender,
        marital_status: maritalStatus,
        nationality,
        personal_phone: personalPhone,
        personal_email: personalEmail,
        address,
        job_title: jobTitle,
        department,
        contract_type: contractType,
        hire_date: hireDate,
        shift_id: shiftId,
        iban,
        bank_code: bankCode,
        bank_account: bankAccount,
        notes,
        detected_bank_code: inferredBankCode
      }
    };
  }

  validateEventPayload(payload) {
    const employeeId = Number(payload.employee_id || 0);
    const eventDate = String(payload.event_date || "").trim();
    const quantity = Number(payload.quantity || 0);
    const amount = Number(payload.amount || 0);
    const eventType = String(payload.event_type || "").trim();
    const employee = this.db.prepare("SELECT id, full_name FROM employees WHERE id = ?").get(employeeId);
    const autoTypes = ["absence", "leave", "vacation_bonus", "christmas_bonus", "overtime_50", "overtime_100"];

    if (!employee) {
      return { ok: false, message: "Selecione um funcionário válido para o evento." };
    }
    if (!eventType) {
      return { ok: false, message: "Selecione o tipo do evento." };
    }
    if (!isValidIsoDate(eventDate)) {
      return { ok: false, message: "A data do evento é inválida." };
    }
    const validDate = new Date(`${eventDate}T00:00:00`);
    const hireDate = employee ? this.db.prepare("SELECT hire_date FROM employees WHERE id = ?").get(employeeId)?.hire_date : "";
    if (hireDate && isValidIsoDate(hireDate) && validDate < new Date(`${hireDate}T00:00:00`)) {
      return { ok: false, message: "A data do evento não pode ser anterior Ã  data de admissão do funcionário." };
    }
    if (quantity <= 0) {
      return { ok: false, message: "A quantidade do evento deve ser superior a zero." };
    }
    if (!autoTypes.includes(eventType) && amount <= 0) {
      return { ok: false, message: "O valor do evento deve ser superior a zero." };
    }

    return { ok: true, employee };
  }

  validateLeaveRequestPayload(payload) {
    const employeeId = Number(payload.employee_id || 0);
    const employee = this.db.prepare("SELECT id, full_name, hire_date FROM employees WHERE id = ?").get(employeeId);
    const recordType = String(payload.record_type || "").trim();
    const startDate = String(payload.start_date || "").trim();
    const endDate = String(payload.end_date || "").trim();
    const reason = String(payload.reason || "").trim();
    const documentRef = String(payload.document_ref || "").trim();
    const proofType = String(payload.proof_type || "").trim();
    const notes = String(payload.notes || "").trim();
    const rejectionReason = String(payload.rejection_reason || "").trim();
    const status = String(payload.status || "pending").trim().toLowerCase();
    const affectsPayroll = payload.affects_payroll === undefined ? null : Boolean(payload.affects_payroll);

    if (!employee) {
      return { ok: false, message: "Selecione um funcionário válido para a licença ou ausência." };
    }
    if (!recordType) {
      return { ok: false, message: "Selecione o tipo de licença ou ausência." };
    }
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
      return { ok: false, message: "As datas da licença ou ausência são inválidas." };
    }
    if (startDate > endDate) {
      return { ok: false, message: "A data final não pode ser anterior à data inicial." };
    }
    if (employee.hire_date && startDate < employee.hire_date) {
      return { ok: false, message: "A licença ou ausência não pode começar antes da admissão do funcionário." };
    }
    if (reason.length < 3) {
      return { ok: false, message: "Indique o motivo ou fundamento da licença ou ausência." };
    }
    if (!["pending", "approved", "rejected"].includes(status)) {
      return { ok: false, message: "O estado da licença é inválido." };
    }

    const calculatedDays = inclusiveDateDiff(startDate, endDate);
    const days = Number(payload.days || calculatedDays);
    if (days <= 0) {
      return { ok: false, message: "O número de dias deve ser superior a zero." };
    }

    const payrollImpactTypes = ["unjustified_absence", "leave_without_pay"];
    return {
      ok: true,
      sanitized: {
        employee_id: employeeId,
        record_type: recordType,
        start_date: startDate,
        end_date: endDate,
        days,
        reason,
        document_ref: documentRef,
        proof_type: proofType,
        notes,
        status,
        affects_payroll: affectsPayroll === null ? payrollImpactTypes.includes(recordType) : affectsPayroll,
        rejection_reason: rejectionReason
      },
      employee
    };
  }

  getVacationBalance(employeeId, yearRef) {
    if (!employeeId || !yearRef) {
      return null;
    }

    const existing = this.db.prepare(`
      SELECT *
      FROM vacation_balances
      WHERE employee_id = ? AND year_ref = ?
    `).get(employeeId, yearRef);

    if (existing) {
      return existing;
    }

    return {
      id: null,
      employee_id: Number(employeeId),
      year_ref: String(yearRef),
      entitled_days: DEFAULT_VACATION_ENTITLEMENT,
      carried_days: 0,
      manual_adjustment: 0,
      notes: "",
      updated_at: ""
    };
  }

  calculateVacationYearSummary(employeeId, yearRef, excludeRequestId = null) {
    const balance = this.getVacationBalance(employeeId, yearRef);
    const rows = this.db.prepare(`
      SELECT id, days, status
      FROM vacation_requests
      WHERE employee_id = @employee_id
        AND year_ref = @year_ref
        ${excludeRequestId ? "AND id != @excludeId" : ""}
    `).all(excludeRequestId
      ? { employee_id: employeeId, year_ref: yearRef, excludeId: excludeRequestId }
      : { employee_id: employeeId, year_ref: yearRef });

    const approvedDays = rows
      .filter((item) => item.status === "approved")
      .reduce((sum, item) => sum + Number(item.days || 0), 0);
    const takenDays = rows
      .filter((item) => item.status === "taken")
      .reduce((sum, item) => sum + Number(item.days || 0), 0);
    const pendingDays = rows
      .filter((item) => item.status === "pending")
      .reduce((sum, item) => sum + Number(item.days || 0), 0);

    const totalEntitlement =
      Number(balance?.entitled_days || DEFAULT_VACATION_ENTITLEMENT) +
      Number(balance?.carried_days || 0) +
      Number(balance?.manual_adjustment || 0);
    const committedDays = approvedDays + takenDays;

    return {
      balance,
      totalEntitlement,
      approvedDays,
      takenDays,
      pendingDays,
      committedDays,
      remainingDays: totalEntitlement - committedDays
    };
  }

  validateVacationBalancePayload(payload) {
    const employeeId = Number(payload.employee_id || 0);
    const employee = this.db.prepare("SELECT id, full_name FROM employees WHERE id = ?").get(employeeId);
    const yearRef = String(payload.year_ref || "").trim();
    const entitledDays = Number(payload.entitled_days ?? DEFAULT_VACATION_ENTITLEMENT);
    const carriedDays = Number(payload.carried_days || 0);
    const manualAdjustment = Number(payload.manual_adjustment || 0);
    const notes = String(payload.notes || "").trim();

    if (!employee) {
      return { ok: false, message: "Selecione um funcionário válido para o plano de férias." };
    }
    if (!/^\d{4}$/.test(yearRef)) {
      return { ok: false, message: "Indique o ano de referência do plano de férias com quatro dígitos." };
    }
    if (entitledDays < 0) {
      return { ok: false, message: "O saldo base de férias não pode ser negativo." };
    }
    if (carriedDays < 0) {
      return { ok: false, message: "Os dias transitados não podem ser negativos." };
    }

    return {
      ok: true,
      employee,
      sanitized: {
        employee_id: employeeId,
        year_ref: yearRef,
        entitled_days: entitledDays,
        carried_days: carriedDays,
        manual_adjustment: manualAdjustment,
        notes
      }
    };
  }

  validateVacationRequestPayload(payload) {
    const employeeId = Number(payload.employee_id || 0);
    const employee = this.db.prepare("SELECT id, full_name, hire_date FROM employees WHERE id = ?").get(employeeId);
    const yearRef = String(payload.year_ref || "").trim();
    const startDate = String(payload.start_date || "").trim();
    const endDate = String(payload.end_date || "").trim();
    const notes = String(payload.notes || "").trim();
    const status = String(payload.status || "pending").trim().toLowerCase();
    const rejectionReason = String(payload.rejection_reason || "").trim();

    if (!employee) {
      return { ok: false, message: "Selecione um funcionário válido para as férias." };
    }
    if (!/^\d{4}$/.test(yearRef)) {
      return { ok: false, message: "Indique o ano de referência das férias com quatro dígitos." };
    }
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
      return { ok: false, message: "As datas das férias são inválidas." };
    }
    if (startDate > endDate) {
      return { ok: false, message: "A data final das férias não pode ser anterior à data inicial." };
    }
    if (String(startDate).slice(0, 4) !== yearRef || String(endDate).slice(0, 4) !== yearRef) {
      return { ok: false, message: "As férias devem estar contidas no ano de referência selecionado." };
    }
    if (employee.hire_date && startDate < employee.hire_date) {
      return { ok: false, message: "As férias não podem começar antes da admissão do funcionário." };
    }
    if (!["pending", "approved", "rejected", "taken"].includes(status)) {
      return { ok: false, message: "O estado do pedido de férias é inválido." };
    }

    const calculatedDays = inclusiveDateDiff(startDate, endDate);
    const days = Number(payload.days || calculatedDays);
    if (days <= 0) {
      return { ok: false, message: "O número de dias de férias deve ser superior a zero." };
    }

    const excludeId = payload.id ? Number(payload.id) : null;
    const overlappingVacation = this.db.prepare(`
      SELECT id
      FROM vacation_requests
      WHERE employee_id = @employee_id
        AND id != COALESCE(@excludeId, -1)
        AND status IN ('pending', 'approved', 'taken')
        AND start_date <= @end_date
        AND end_date >= @start_date
      LIMIT 1
    `).get({ employee_id: employeeId, excludeId, start_date: startDate, end_date: endDate });
    if (overlappingVacation) {
      return { ok: false, message: "Já existe um período de férias marcado ou em análise que sobrepõe estas datas." };
    }

    const overlappingLeave = this.db.prepare(`
      SELECT id
      FROM leave_requests
      WHERE employee_id = @employee_id
        AND status IN ('pending', 'approved')
        AND start_date <= @end_date
        AND end_date >= @start_date
      LIMIT 1
    `).get({ employee_id: employeeId, start_date: startDate, end_date: endDate });
    if (overlappingLeave) {
      return { ok: false, message: "Existe uma licença ou ausência no mesmo período. Ajuste as datas antes de registar as férias." };
    }

    const summary = this.calculateVacationYearSummary(employeeId, yearRef, excludeId);
    if (summary.remainingDays < days) {
      return {
        ok: false,
        message: `O saldo disponível para ${yearRef} é insuficiente. Restam ${Number(summary.remainingDays.toFixed(2))} dia(s).`
      };
    }

    return {
      ok: true,
      employee,
      sanitized: {
        employee_id: employeeId,
        year_ref: yearRef,
        start_date: startDate,
        end_date: endDate,
        days,
        notes,
        status,
        rejection_reason: rejectionReason
      }
    };
  }

  validateAttendancePayload(payload) {
    const employeeId = Number(payload.employee_id || 0);
    const employee = this.db.prepare("SELECT id, full_name, hire_date, shift_id FROM employees WHERE id = ?").get(employeeId);
    const attendanceDate = String(payload.attendance_date || "").trim();
    const status = String(payload.status || "").trim().toLowerCase();
    const hoursWorked = Number(payload.hours_worked || 0);
    const delayMinutes = Number(payload.delay_minutes || 0);
    const shiftId = Number(payload.shift_id || employee?.shift_id || 0) || null;
    const checkInTime = normalizeTimeValue(payload.check_in_time);
    const checkOutTime = normalizeTimeValue(payload.check_out_time);
    const source = String(payload.source || "manual").trim().toLowerCase();
    const deviceLabel = String(payload.device_label || "").trim();
    const notes = String(payload.notes || "").trim();
    const punchCount = inferPunchCount(checkInTime, checkOutTime, payload.punch_count);
    const approvalStatus =
      String(payload.approval_status || (source === "manual" ? "pending" : "approved"))
        .trim()
        .toLowerCase();
    const validStatuses = ["present", "delay", "absent", "half_absence", "leave", "vacation"];

    if (!employee) {
      return { ok: false, message: "Selecione um funcionário válido para a assiduidade." };
    }
    if (!isValidIsoDate(attendanceDate)) {
      return { ok: false, message: "A data da assiduidade é inválida." };
    }
    if (employee.hire_date && attendanceDate < employee.hire_date) {
      return { ok: false, message: "A assiduidade não pode ser registada antes da admissão do funcionário." };
    }
    if (!validStatuses.includes(status)) {
      return { ok: false, message: "O estado da assiduidade é inválido." };
    }
    if (!ATTENDANCE_SOURCES.includes(source)) {
      return { ok: false, message: "A origem do registo de assiduidade é inválida." };
    }
    if (!ATTENDANCE_APPROVAL_STATUSES.includes(approvalStatus)) {
      return { ok: false, message: "O estado de aprovação do ajuste de assiduidade é inválido." };
    }
    if (shiftId) {
      const shift = this.db.prepare("SELECT id, start_time, tolerance_minutes, break_minutes FROM work_shifts WHERE id = ?").get(shiftId);
      if (!shift) {
        return { ok: false, message: "O turno associado ao registo de assiduidade não existe." };
      }
    }
    if (!checkInTime && payload.check_in_time) {
      return { ok: false, message: "A hora de entrada é inválida." };
    }
    if (!checkOutTime && payload.check_out_time) {
      return { ok: false, message: "A hora de saída é inválida." };
    }
    if (checkInTime && checkOutTime && timeToMinutes(checkOutTime) < timeToMinutes(checkInTime)) {
      return { ok: false, message: "A hora de saída não pode ser anterior à hora de entrada." };
    }
    let effectiveHoursWorked = hoursWorked;
    if (!(effectiveHoursWorked > 0) && checkInTime && checkOutTime) {
      const shift = shiftId ? this.db.prepare("SELECT break_minutes FROM work_shifts WHERE id = ?").get(shiftId) : null;
      effectiveHoursWorked = calculateWorkedHoursFromPunches(checkInTime, checkOutTime, shift?.break_minutes || 0);
    }
    if (effectiveHoursWorked < 0 || effectiveHoursWorked > 24) {
      return { ok: false, message: "As horas trabalhadas devem estar entre 0 e 24." };
    }
    let effectiveDelayMinutes = delayMinutes;
    if (!(effectiveDelayMinutes > 0) && shiftId && checkInTime) {
      const shift = this.db.prepare("SELECT start_time, tolerance_minutes FROM work_shifts WHERE id = ?").get(shiftId);
      const lateBy = timeToMinutes(checkInTime) - (timeToMinutes(shift?.start_time) + Number(shift?.tolerance_minutes || 0));
      effectiveDelayMinutes = lateBy > 0 ? lateBy : 0;
    }
    if (effectiveDelayMinutes < 0 || effectiveDelayMinutes > 1440) {
      return { ok: false, message: "Os minutos de atraso devem estar entre 0 e 1440." };
    }
    if (!Number.isInteger(punchCount) || punchCount < 0 || punchCount > 20) {
      return { ok: false, message: "A contagem de marcações do dia é inválida." };
    }

    return {
      ok: true,
      employee,
      sanitized: {
        employee_id: employeeId,
        attendance_date: attendanceDate,
        status,
        shift_id: shiftId,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        punch_count: punchCount,
        approval_status: approvalStatus,
        hours_worked: effectiveHoursWorked,
        delay_minutes: effectiveDelayMinutes,
        source,
        device_label: deviceLabel,
        notes
      }
    };
  }

  validateEmployeesForPayroll(monthRef) {
    const employees = this.listEmployees().filter((employee) => employee.status === "ativo");
    const invalid = employees
      .map((employee) => {
        const validation = this.validateEmployeePayload(employee);
        if (!validation.ok) {
          return `${employee.full_name}: ${validation.message}`;
        }
        if (String(employee.hire_date || "").slice(0, 7) > monthRef) {
          return `${employee.full_name}: a admissão ocorre depois do período ${monthRef}.`;
        }
        return null;
      })
      .filter(Boolean);

    if (invalid.length) {
      return {
        ok: false,
        message: `Existem dados inválidos que impedem o processamento de ${monthRef}: ${invalid.join(" | ")}`
      };
    }

    return { ok: true };
  }

  listEmployees() {
    const rows = this.db.prepare(`
      SELECT
        employees.*,
        work_shifts.name AS shift_name,
        work_shifts.profile AS shift_profile
      FROM employees
      LEFT JOIN work_shifts ON work_shifts.id = employees.shift_id
      ORDER BY employees.full_name
    `).all();

    return mapEmployeeListRows(rows, {
      resolveBankCodeFromRegistryCode,
      extractAngolaBankRegistryCode
    });
  }

  listPayrollPeriods() {
    return this.db.prepare(`
      ${PAYROLL_PERIODS_SELECT}
      ORDER BY payroll_periods.month_ref DESC
    `).all();
  }

  buildPayrollFiscalStatus(monthRef, payrollRuns = [], payrollPeriods = [], settings = this.getSystemSettings(monthRef)) {
    const normalizedMonthRef = String(monthRef || "").trim();
    const currentProfile = resolveFiscalProfileForMonth(settings, normalizedMonthRef);
    const payrollPeriod =
      payrollPeriods.find((period) => String(period.month_ref || "").trim() === normalizedMonthRef) ||
      this.getPayrollPeriod(normalizedMonthRef);
    const attendancePeriod = this.getAttendancePeriod(normalizedMonthRef);
    const runsForMonth = payrollRuns.filter((run) => String(run.month_ref || "").trim() === normalizedMonthRef);
    const appliedProfiles = new Map();
    let outdatedRunCount = 0;

    runsForMonth.forEach((run) => {
      const runSummary = run.summary_json || {};
      const profileSummary = summarizeFiscalProfile(runSummary.fiscalProfile || {});
      const profileKey = `${profileSummary.id || "sem-perfil"}:${runSummary.fiscalProfileVersion || profileSummary.version || "sem-versao"}`;
      if (!appliedProfiles.has(profileKey)) {
        appliedProfiles.set(profileKey, {
          ...profileSummary,
          count: 0
        });
      }
      appliedProfiles.get(profileKey).count += 1;

      if (!isPayrollRunUsingCurrentFiscalProfile(runSummary, currentProfile)) {
        outdatedRunCount += 1;
      }
    });

    const hasMixedAppliedProfiles = appliedProfiles.size > 1;
    const hasFiscalDrift = outdatedRunCount > 0 || hasMixedAppliedProfiles;
    const canReprocess =
      payrollPeriod.status !== "closed" &&
      attendancePeriod.status === "closed" &&
      runsForMonth.length > 0;
    const requiresAuthorization =
      payrollPeriod.status === "closed" &&
      attendancePeriod.status === "closed" &&
      runsForMonth.length > 0 &&
      hasFiscalDrift;
    const reprocessBlockReason =
      runsForMonth.length === 0
        ? "Nao existem salarios processados para este periodo."
        : attendancePeriod.status !== "closed"
          ? `Feche primeiro a assiduidade de ${normalizedMonthRef}.`
          : payrollPeriod.status === "closed"
            ? `O periodo ${normalizedMonthRef} esta fechado e exige autorizacao explicita para reprocessar sem reabrir o mes.`
            : "";

    return {
      month_ref: normalizedMonthRef,
      period_status: payrollPeriod.status || "open",
      attendance_period_status: attendancePeriod.status || "open",
      currentProfile: summarizeFiscalProfile(currentProfile),
      runCount: runsForMonth.length,
      currentRunCount: runsForMonth.length - outdatedRunCount,
      outdatedRunCount,
      hasFiscalDrift,
      hasMixedAppliedProfiles,
      appliedProfiles: Array.from(appliedProfiles.values()),
      needsReprocess: canReprocess && hasFiscalDrift,
      canReprocess,
      requiresAuthorization,
      reprocessBlockReason
    };
  }

  listPayrollFiscalStatuses(context = {}) {
    const payrollRuns = context.payrollRuns || this.listPayrollRuns();
    const payrollPeriods = context.payrollPeriods || this.listPayrollPeriods();
    const settings = context.settings || this.getSystemSettings();
    const monthRefs = Array.from(
      new Set(
        []
          .concat((payrollRuns || []).map((run) => String(run.month_ref || "").trim()))
          .concat((payrollPeriods || []).map((period) => String(period.month_ref || "").trim()))
          .filter(Boolean)
      )
    ).sort((left, right) => right.localeCompare(left, "pt"));

    return monthRefs.map((monthRef) =>
      this.buildPayrollFiscalStatus(monthRef, payrollRuns, payrollPeriods, settings)
    );
  }

  listAttendancePeriods() {
    return this.db.prepare(`
      ${ATTENDANCE_PERIODS_SELECT}
      ORDER BY attendance_periods.month_ref DESC
    `).all();
  }

  getAttendancePeriod(monthRef) {
    const row = this.db.prepare(`
      ${ATTENDANCE_PERIODS_SELECT}
      WHERE attendance_periods.month_ref = ?
    `).get(monthRef);

    return row || buildDefaultAttendancePeriod(monthRef);
  }

  ensureAttendancePeriodOpen(monthRef) {
    const period = this.getAttendancePeriod(monthRef);
    if (period.status === "closed") {
      return {
        ok: false,
        message: `A assiduidade de ${monthRef} está fechada e não pode ser alterada.`
      };
    }
    return { ok: true };
  }

  ensureAttendancePeriodClosed(monthRef) {
    const period = this.getAttendancePeriod(monthRef);
    if (period.status !== "closed") {
      return {
        ok: false,
        message: `Feche a assiduidade de ${monthRef} antes de processar a folha salarial.`
      };
    }
    return { ok: true, period };
  }

  getPayrollPeriod(monthRef) {
    const row = this.db.prepare(`
      ${PAYROLL_PERIODS_SELECT}
      WHERE payroll_periods.month_ref = ?
    `).get(monthRef);

    return row || buildDefaultPayrollPeriod(monthRef);
  }

  ensurePeriodOpen(monthRef) {
    const period = this.getPayrollPeriod(monthRef);
    if (period.status === "closed") {
      return {
        ok: false,
        message: `O período ${monthRef} está fechado e não pode ser alterado.`
      };
    }
    return { ok: true };
  }

  buildAttendanceClosureSummary(monthRef) {
    const attendanceRows = this.listAttendanceRecords({ monthRef });
    const leaveRequests = this.listLeaveRequests({ status: "approved", monthRef });
    const vacationRequests = this.listVacationRequests({ monthRef }).filter((item) =>
      ["approved", "taken"].includes(String(item.status || "").toLowerCase())
    );

    const leaveByKey = new Map();
    const vacationByKey = new Map();
    const attendanceByKey = new Map();

    attendanceRows.forEach((row) => {
      const key = `${row.employee_id}:${row.attendance_date}`;
      const current = attendanceByKey.get(key) || [];
      current.push(row);
      attendanceByKey.set(key, current);
    });

    leaveRequests.forEach((item) => {
      enumerateDatesWithinMonth(item.start_date, item.end_date, monthRef).forEach((dateValue) => {
        const key = `${item.employee_id}:${dateValue}`;
        const current = leaveByKey.get(key) || [];
        current.push(item);
        leaveByKey.set(key, current);
      });
    });

    vacationRequests.forEach((item) => {
      enumerateDatesWithinMonth(item.start_date, item.end_date, monthRef).forEach((dateValue) => {
        const key = `${item.employee_id}:${dateValue}`;
        const current = vacationByKey.get(key) || [];
        current.push(item);
        vacationByKey.set(key, current);
      });
    });

    const summary = {
      pendingAdjustments: attendanceRows.filter((row) => row.approval_status === "pending").length,
      entryWithoutExit: 0,
      exitWithoutEntry: 0,
      duplicateMarks: 0,
      sameDayConflicts: 0,
      totalRecords: attendanceRows.length
    };

    attendanceRows.forEach((row) => {
      const checkInTime = String(row.check_in_time || "").trim();
      const checkOutTime = String(row.check_out_time || "").trim();
      const punchCount = Number(row.punch_count || 0);
      const importedSinglePunch =
        punchCount === 1 &&
        Boolean(checkInTime) &&
        Boolean(checkOutTime) &&
        checkInTime === checkOutTime;

      if (isAttendancePresenceStatus(row.status) && ((checkInTime && !checkOutTime) || importedSinglePunch)) {
        summary.entryWithoutExit += 1;
      }
      if (isAttendancePresenceStatus(row.status) && !checkInTime && checkOutTime) {
        summary.exitWithoutEntry += 1;
      }
      if (punchCount > 2) {
        summary.duplicateMarks += 1;
      }
    });

    const conflictKeys = new Set([...leaveByKey.keys(), ...vacationByKey.keys(), ...attendanceByKey.keys()]);
    conflictKeys.forEach((key) => {
      const leaves = leaveByKey.get(key) || [];
      const vacations = vacationByKey.get(key) || [];
      const attendances = attendanceByKey.get(key) || [];

      const leaveAttendanceConflict = leaves.length && attendances.some((item) => item.status !== "leave");
      const vacationAttendanceConflict = vacations.length && attendances.some((item) => item.status !== "vacation");
      const leaveVacationConflict = leaves.length && vacations.length;

      if (leaveAttendanceConflict || vacationAttendanceConflict || leaveVacationConflict) {
        summary.sameDayConflicts += 1;
      }
    });

    summary.blockingIssues =
      summary.pendingAdjustments +
      summary.entryWithoutExit +
      summary.exitWithoutEntry +
      summary.duplicateMarks +
      summary.sameDayConflicts;

    return summary;
  }

  closeAttendancePeriod(monthRef, userId) {
    return closeAttendancePeriodDomain(this, monthRef, userId, isValidMonthRef, nowIso);
  }

  reopenAttendancePeriod(monthRef, userId) {
    return reopenAttendancePeriodDomain(this, monthRef, userId, isValidMonthRef, nowIso);
  }

  closePayrollPeriod(monthRef, userId) {
    return closePayrollPeriodDomain(this, monthRef, userId, (ref, uid) => buildClosePayrollPeriodPayload(ref, uid, nowIso));
  }

  reopenPayrollPeriod(monthRef, userId) {
    return reopenPayrollPeriodDomain(this, monthRef, userId, (ref, uid) => buildReopenPayrollPeriodPayload(ref, uid, nowIso));
  }

  saveEmployee(payload) {
    const validation = this.validateEmployeePayload(payload);
    if (!validation.ok) {
      return validation;
    }

    if (payload.id) {
      const closedRuns = this.getClosedPayrollRunsForEmployee(payload.id);
      if (closedRuns.length) {
        const before = this.getEmployeeSnapshot(payload.id);
        const protectedFields = ["full_name", "document_type", "bi", "nif", "social_security_number", "job_title", "department", "base_salary", "contract_type", "hire_date", "iban", "bank_code", "bank_account", "status"];
        const changedProtectedField = protectedFields.some((field) => String(before?.[field] ?? "") !== String(payload?.[field] ?? ""));
        if (changedProtectedField) {
          return {
            ok: false,
            message: `Este funcionário já participa em períodos fechados (${closedRuns.map((item) => item.month_ref).join(", ")}). Reabra esses períodos antes de alterar os seus dados principais.`
          };
        }
      }
    }

    const sanitized = validation.sanitized;
      const employee = {
        full_name: sanitized.full_name,
        document_type: sanitized.document_type,
        bi: sanitized.bi,
        driver_license_number: sanitized.driver_license_number,
        nif: sanitized.nif,
        social_security_number: sanitized.social_security_number,
        attendance_code: sanitized.attendance_code,
        birth_date: sanitized.birth_date,
        gender: sanitized.gender,
        marital_status: sanitized.marital_status,
        nationality: sanitized.nationality,
        personal_phone: sanitized.personal_phone,
      personal_email: sanitized.personal_email,
      address: sanitized.address,
      job_title: sanitized.job_title,
        department: sanitized.department,
        base_salary: Number(payload.base_salary || 0),
        contract_type: sanitized.contract_type,
        hire_date: sanitized.hire_date,
        shift_id: sanitized.shift_id,
        iban: sanitized.iban,
        bank_code: sanitized.bank_code,
        bank_account: sanitized.bank_account,
        status: payload.status || "ativo",
        notes: sanitized.notes,
      recurring_allowances: JSON.stringify(payload.recurring_allowances || []),
      recurring_bonuses: JSON.stringify(payload.recurring_bonuses || []),
      special_payments: JSON.stringify(payload.special_payments || []),
      updated_at: nowIso()
    };

      if (payload.id) {
        this.db.prepare(`
          UPDATE employees
          SET full_name = @full_name, document_type = @document_type, bi = @bi, driver_license_number = @driver_license_number, nif = @nif, social_security_number = @social_security_number, attendance_code = @attendance_code,
              birth_date = @birth_date, gender = @gender, marital_status = @marital_status, nationality = @nationality,
              personal_phone = @personal_phone, personal_email = @personal_email, address = @address, job_title = @job_title,
              department = @department, base_salary = @base_salary, contract_type = @contract_type,
              hire_date = @hire_date, shift_id = @shift_id, iban = @iban, bank_code = @bank_code, bank_account = @bank_account, status = @status, notes = @notes,
              recurring_allowances = @recurring_allowances, recurring_bonuses = @recurring_bonuses,
              special_payments = @special_payments, updated_at = @updated_at
          WHERE id = @id
        `).run({ ...employee, id: payload.id });
      } else {
        this.db.prepare(`
          INSERT INTO employees (
            full_name, document_type, bi, driver_license_number, nif, social_security_number, attendance_code, birth_date, gender, marital_status, nationality,
            personal_phone, personal_email, address, job_title, department, base_salary, contract_type,
            hire_date, shift_id, iban, bank_code, bank_account, status, notes, recurring_allowances, recurring_bonuses,
            special_payments, created_at, updated_at
          ) VALUES (
            @full_name, @document_type, @bi, @driver_license_number, @nif, @social_security_number, @attendance_code, @birth_date, @gender, @marital_status, @nationality,
            @personal_phone, @personal_email, @address, @job_title, @department, @base_salary, @contract_type,
            @hire_date, @shift_id, @iban, @bank_code, @bank_account, @status, @notes, @recurring_allowances, @recurring_bonuses,
            @special_payments, @created_at, @updated_at
          )
        `).run({ ...employee, created_at: nowIso() });
      }
    return { ok: true, employees: this.listEmployees() };
  }

  deleteEmployee(employeeId) {
    const closedRuns = this.getClosedPayrollRunsForEmployee(employeeId);
    if (closedRuns.length) {
      return {
        ok: false,
        message: `Não pode remover este funcionário porque ele tem processamento em períodos fechados (${closedRuns.map((item) => item.month_ref).join(", ")}).`
      };
    }
    this.db.prepare("DELETE FROM employees WHERE id = ?").run(employeeId);
    return { ok: true, employees: this.listEmployees() };
  }

  listSalaryScales(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("salary_scales.id = @id");
      values.id = filters.id;
    }
    if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
      conditions.push("salary_scales.active = @active");
      values.active = filters.active ? 1 : 0;
    }
    if (filters.jobTitle) {
      conditions.push("LOWER(salary_scales.job_title) = LOWER(@jobTitle)");
      values.jobTitle = String(filters.jobTitle).trim();
    }
    if (filters.department !== undefined && filters.department !== null) {
      conditions.push("LOWER(COALESCE(salary_scales.department, '')) = LOWER(@department)");
      values.department = String(filters.department || "").trim();
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    return this.db.prepare(`
      SELECT
        salary_scales.*,
        (
          SELECT COUNT(*)
          FROM employees
          WHERE LOWER(TRIM(employees.job_title)) = LOWER(TRIM(salary_scales.job_title))
            AND (
              TRIM(COALESCE(salary_scales.department, '')) = ''
              OR LOWER(TRIM(employees.department)) = LOWER(TRIM(salary_scales.department))
            )
        ) AS employee_count
      FROM salary_scales
      ${whereClause}
      ORDER BY LOWER(salary_scales.job_title) ASC, LOWER(COALESCE(salary_scales.department, '')) ASC, salary_scales.id DESC
    `).all(values).map((row) => ({
      ...row,
      active: Boolean(row.active)
    }));
  }

  saveSalaryScale(payload) {
    const validation = this.validateSalaryScalePayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const scale = {
      ...validation.sanitized,
      active: validation.sanitized.active ? 1 : 0,
      updated_at: nowIso()
    };

    if (payload.id) {
      const current = this.getSalaryScaleSnapshot(payload.id);
      if (!current) {
        return { ok: false, message: "A escala salarial indicada não foi encontrada." };
      }

      this.db.prepare(`
        UPDATE salary_scales
        SET
          job_title = @job_title,
          department = @department,
          min_salary = @min_salary,
          reference_salary = @reference_salary,
          max_salary = @max_salary,
          notes = @notes,
          active = @active,
          updated_at = @updated_at
        WHERE id = @id
      `).run({ ...scale, id: payload.id });
    } else {
      this.db.prepare(`
        INSERT INTO salary_scales (
          job_title,
          department,
          min_salary,
          reference_salary,
          max_salary,
          notes,
          active,
          created_at,
          updated_at
        ) VALUES (
          @job_title,
          @department,
          @min_salary,
          @reference_salary,
          @max_salary,
          @notes,
          @active,
          @created_at,
          @updated_at
        )
      `).run({ ...scale, created_at: nowIso() });
    }

    return { ok: true, items: this.listSalaryScales() };
  }

  deleteSalaryScale(scaleId) {
    const current = this.getSalaryScaleSnapshot(scaleId);
    if (!current) {
      return { ok: false, message: "A escala salarial não foi encontrada." };
    }

    this.db.prepare("DELETE FROM salary_scales WHERE id = ?").run(scaleId);
    return { ok: true, items: this.listSalaryScales() };
  }

  listEvents(employeeId) {
    const rows = employeeId
      ? this.db.prepare("SELECT * FROM payroll_events WHERE employee_id = ? ORDER BY event_date DESC").all(employeeId)
      : this.db.prepare("SELECT * FROM payroll_events ORDER BY event_date DESC").all();
    return rows.map((event) => ({ ...event, meta_json: JSON.parse(event.meta_json ?? "{}") }));
  }

  listLeaveRequests(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("leave_requests.id = @id");
      values.id = filters.id;
    }
    if (filters.employeeId) {
      conditions.push("leave_requests.employee_id = @employeeId");
      values.employeeId = filters.employeeId;
    }
    if (filters.status) {
      conditions.push("leave_requests.status = @status");
      values.status = filters.status;
    }
    if (filters.monthRef) {
      conditions.push("(substr(leave_requests.start_date, 1, 7) <= @monthRef AND substr(leave_requests.end_date, 1, 7) >= @monthRef)");
      values.monthRef = filters.monthRef;
    }
    if (filters.startDate) {
      conditions.push("leave_requests.end_date >= @startDate");
      values.startDate = filters.startDate;
    }
    if (filters.endDate) {
      conditions.push("leave_requests.start_date <= @endDate");
      values.endDate = filters.endDate;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT
        leave_requests.*,
        employees.full_name,
        employees.department,
        employees.job_title,
        approver.full_name AS approved_by_name
      FROM leave_requests
      INNER JOIN employees ON employees.id = leave_requests.employee_id
      LEFT JOIN users AS approver ON approver.id = leave_requests.approved_by_user_id
      ${whereClause}
      ORDER BY leave_requests.start_date DESC, leave_requests.id DESC
    `).all(values);

    return rows.map((item) => ({
      ...item,
      affects_payroll: Boolean(item.affects_payroll)
    }));
  }

  listVacationBalances(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("vacation_balances.id = @id");
      values.id = filters.id;
    }
    if (filters.employeeId) {
      conditions.push("vacation_balances.employee_id = @employeeId");
      values.employeeId = filters.employeeId;
    }
    if (filters.yearRef) {
      conditions.push("vacation_balances.year_ref = @yearRef");
      values.yearRef = filters.yearRef;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT
        vacation_balances.*,
        employees.full_name,
        employees.department,
        employees.job_title
      FROM vacation_balances
      INNER JOIN employees ON employees.id = vacation_balances.employee_id
      ${whereClause}
      ORDER BY vacation_balances.year_ref DESC, employees.full_name
    `).all(values);

    return rows.map((item) => {
      const summary = this.calculateVacationYearSummary(item.employee_id, item.year_ref);
      return {
        ...item,
        approved_days: Number(summary.approvedDays.toFixed(2)),
        taken_days: Number(summary.takenDays.toFixed(2)),
        pending_days: Number(summary.pendingDays.toFixed(2)),
        remaining_days: Number(summary.remainingDays.toFixed(2)),
        total_entitlement: Number(summary.totalEntitlement.toFixed(2))
      };
    });
  }

  listVacationRequests(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("vacation_requests.id = @id");
      values.id = filters.id;
    }
    if (filters.employeeId) {
      conditions.push("vacation_requests.employee_id = @employeeId");
      values.employeeId = filters.employeeId;
    }
    if (filters.status) {
      conditions.push("vacation_requests.status = @status");
      values.status = filters.status;
    }
    if (filters.yearRef) {
      conditions.push("vacation_requests.year_ref = @yearRef");
      values.yearRef = filters.yearRef;
    }
    if (filters.monthRef) {
      conditions.push("(substr(vacation_requests.start_date, 1, 7) <= @monthRef AND substr(vacation_requests.end_date, 1, 7) >= @monthRef)");
      values.monthRef = filters.monthRef;
    }
    if (filters.startDate) {
      conditions.push("vacation_requests.end_date >= @startDate");
      values.startDate = filters.startDate;
    }
    if (filters.endDate) {
      conditions.push("vacation_requests.start_date <= @endDate");
      values.endDate = filters.endDate;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db.prepare(`
      SELECT
        vacation_requests.*,
        employees.full_name,
        employees.department,
        employees.job_title,
        approver.full_name AS approved_by_name
      FROM vacation_requests
      INNER JOIN employees ON employees.id = vacation_requests.employee_id
      LEFT JOIN users AS approver ON approver.id = vacation_requests.approved_by_user_id
      ${whereClause}
      ORDER BY vacation_requests.start_date DESC, vacation_requests.id DESC
    `).all(values);
  }

  saveVacationBalance(payload) {
    const validation = this.validateVacationBalancePayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const balance = {
      ...validation.sanitized,
      updated_at: nowIso()
    };

    const existing = this.db.prepare(`
      SELECT id
      FROM vacation_balances
      WHERE employee_id = ? AND year_ref = ?
    `).get(balance.employee_id, balance.year_ref);

    if (existing) {
      this.db.prepare(`
        UPDATE vacation_balances
        SET entitled_days = @entitled_days,
            carried_days = @carried_days,
            manual_adjustment = @manual_adjustment,
            notes = @notes,
            updated_at = @updated_at
        WHERE id = @id
      `).run({ ...balance, id: existing.id });
    } else {
      this.db.prepare(`
        INSERT INTO vacation_balances (
          employee_id, year_ref, entitled_days, carried_days, manual_adjustment, notes, updated_at
        ) VALUES (
          @employee_id, @year_ref, @entitled_days, @carried_days, @manual_adjustment, @notes, @updated_at
        )
      `).run(balance);
    }

    return {
      ok: true,
      items: this.listVacationBalances({ employeeId: balance.employee_id }),
      summary: this.calculateVacationYearSummary(balance.employee_id, balance.year_ref)
    };
  }

  saveVacationRequest(payload) {
    const validation = this.validateVacationRequestPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const periodsToCheck = enumerateMonthRefs(validation.sanitized.start_date, validation.sanitized.end_date);
    for (const monthRef of periodsToCheck) {
      let periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
      periodState = this.ensureAttendancePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    if (payload.id) {
      const current = this.getVacationRequestSnapshot(payload.id);
      if (current?.status === "approved" || current?.status === "rejected" || current?.status === "taken") {
        return {
          ok: false,
          message: "Este pedido de férias já foi decidido. Reabra o período ou crie um novo registo, se necessário."
        };
      }
    }

    const record = {
      ...validation.sanitized,
      updated_at: nowIso()
    };

    if (payload.id) {
      this.db.prepare(`
        UPDATE vacation_requests
        SET employee_id = @employee_id,
            year_ref = @year_ref,
            start_date = @start_date,
            end_date = @end_date,
            days = @days,
            notes = @notes,
            status = 'pending',
            approved_by_user_id = NULL,
            approved_at = NULL,
            rejection_reason = '',
            updated_at = @updated_at
        WHERE id = @id
      `).run({ ...record, id: payload.id });
    } else {
      this.db.prepare(`
        INSERT INTO vacation_requests (
          employee_id, year_ref, start_date, end_date, days, notes, status,
          approved_by_user_id, approved_at, rejection_reason, created_at, updated_at
        ) VALUES (
          @employee_id, @year_ref, @start_date, @end_date, @days, @notes, 'pending',
          NULL, NULL, '', @created_at, @updated_at
        )
      `).run({ ...record, created_at: nowIso() });
    }

    return {
      ok: true,
      items: this.listVacationRequests({ employeeId: validation.sanitized.employee_id }),
      summary: this.calculateVacationYearSummary(validation.sanitized.employee_id, validation.sanitized.year_ref)
    };
  }

  setVacationRequestStatus(vacationRequestId, status, userId, rejectionReason = "") {
    const current = this.db.prepare("SELECT * FROM vacation_requests WHERE id = ?").get(vacationRequestId);
    if (!current) {
      return { ok: false, message: "Pedido de férias não encontrado." };
    }

    const monthRefs = enumerateMonthRefs(current.start_date, current.end_date);
    for (const monthRef of monthRefs) {
      let periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
      periodState = this.ensureAttendancePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (!["approved", "rejected", "pending", "taken"].includes(normalizedStatus)) {
      return { ok: false, message: "O estado pretendido para as férias é inválido." };
    }

    this.db.prepare(`
      UPDATE vacation_requests
      SET status = @status,
          approved_by_user_id = @approved_by_user_id,
          approved_at = @approved_at,
          rejection_reason = @rejection_reason,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: vacationRequestId,
      status: normalizedStatus,
      approved_by_user_id: normalizedStatus === "pending" ? null : userId,
      approved_at: normalizedStatus === "pending" ? null : nowIso(),
      rejection_reason: normalizedStatus === "rejected" ? String(rejectionReason || "").trim() : "",
      updated_at: nowIso()
    });

    return {
      ok: true,
      items: this.listVacationRequests({ employeeId: current.employee_id }),
      summary: this.calculateVacationYearSummary(current.employee_id, current.year_ref)
    };
  }

  deleteVacationRequest(vacationRequestId) {
    const current = this.db.prepare("SELECT * FROM vacation_requests WHERE id = ?").get(vacationRequestId);
    if (!current) {
      return { ok: false, message: "Pedido de férias não encontrado." };
    }

    const monthRefs = enumerateMonthRefs(current.start_date, current.end_date);
    for (const monthRef of monthRefs) {
      let periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
      periodState = this.ensureAttendancePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    this.db.prepare("DELETE FROM vacation_requests WHERE id = ?").run(vacationRequestId);
    return {
      ok: true,
      items: this.listVacationRequests({ employeeId: current.employee_id }),
      summary: this.calculateVacationYearSummary(current.employee_id, current.year_ref)
    };
  }

  listAttendanceRecords(filters = {}) {
    const query = buildAttendanceRecordsFilter(filters);
    return this.db.prepare(`
      SELECT
        attendance_records.*,
        employees.full_name,
        employees.department,
        employees.job_title,
        work_shifts.name AS shift_name,
        work_shifts.profile AS shift_profile,
        attendance_import_batches.file_name AS import_file_name,
        approver.full_name AS approved_by_name
      FROM attendance_records
      INNER JOIN employees ON employees.id = attendance_records.employee_id
      LEFT JOIN work_shifts ON work_shifts.id = attendance_records.shift_id
      LEFT JOIN attendance_import_batches ON attendance_import_batches.id = attendance_records.batch_id
      LEFT JOIN users AS approver ON approver.id = attendance_records.approved_by_user_id
      ${query.whereClause}
      ORDER BY attendance_records.attendance_date DESC, attendance_records.id DESC
    `).all(query.values);
  }

  listFinancialObligations(filters = {}) {
    const conditions = [];
    const values = {};

    if (filters.id) {
      conditions.push("financial_obligations.id = @id");
      values.id = filters.id;
    }
    if (filters.employeeId) {
      conditions.push("financial_obligations.employee_id = @employeeId");
      values.employeeId = filters.employeeId;
    }
    if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
      conditions.push("financial_obligations.active = @active");
      values.active = filters.active ? 1 : 0;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const referenceMonthRef = filters.monthRef;

    return this.db.prepare(`
      SELECT
        financial_obligations.*,
        employees.full_name,
        employees.department,
        employees.job_title
      FROM financial_obligations
      INNER JOIN employees ON employees.id = financial_obligations.employee_id
      ${whereClause}
      ORDER BY financial_obligations.start_month_ref DESC, employees.full_name ASC, financial_obligations.id DESC
    `).all(values).map((row) => ({
      ...row,
      active: Boolean(row.active),
      ...this.buildFinancialObligationState(row, referenceMonthRef)
    }));
  }

  saveFinancialObligation(payload) {
    const validation = this.validateFinancialObligationPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const obligation = {
      ...validation.sanitized,
      active: validation.sanitized.active ? 1 : 0,
      updated_at: nowIso()
    };
    const nextMonths = enumerateInstallmentMonths(obligation.start_month_ref, obligation.installment_count);

    if (payload.id) {
      const current = this.getFinancialObligationSnapshot(payload.id);
      if (!current) {
        return { ok: false, message: "O registo financeiro indicado não foi encontrado." };
      }

      const protectedMonths = new Set([
        ...enumerateInstallmentMonths(current.start_month_ref, current.installment_count),
        ...nextMonths
      ]);
      for (const monthRef of protectedMonths) {
        const periodState = this.ensurePeriodOpen(monthRef);
        if (!periodState.ok) {
          return {
            ok: false,
            message: "Este registo financeiro já afeta um período fechado. Reabra o período antes de o alterar."
          };
        }
      }

      this.db.prepare(`
        UPDATE financial_obligations
        SET
          employee_id = @employee_id,
          entry_type = @entry_type,
          label = @label,
          principal_amount = @principal_amount,
          installment_count = @installment_count,
          installment_amount = @installment_amount,
          start_month_ref = @start_month_ref,
          notes = @notes,
          active = @active,
          updated_at = @updated_at
        WHERE id = @id
      `).run({ ...obligation, id: payload.id });
    } else {
      for (const monthRef of nextMonths) {
        const periodState = this.ensurePeriodOpen(monthRef);
        if (!periodState.ok) {
          return periodState;
        }
      }

      this.db.prepare(`
        INSERT INTO financial_obligations (
          employee_id, entry_type, label, principal_amount, installment_count,
          installment_amount, start_month_ref, notes, active, created_at, updated_at
        ) VALUES (
          @employee_id, @entry_type, @label, @principal_amount, @installment_count,
          @installment_amount, @start_month_ref, @notes, @active, @created_at, @updated_at
        )
      `).run({ ...obligation, created_at: nowIso() });
    }

    return {
      ok: true,
      items: this.listFinancialObligations({ employeeId: validation.sanitized.employee_id })
    };
  }

  deleteFinancialObligation(obligationId) {
    const current = this.getFinancialObligationSnapshot(obligationId);
    if (!current) {
      return { ok: false, message: "O registo financeiro não foi encontrado." };
    }

    for (const monthRef of enumerateInstallmentMonths(current.start_month_ref, current.installment_count)) {
      const periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return {
          ok: false,
          message: "Este registo financeiro já afeta um período fechado. Reabra o período antes de o remover."
        };
      }
    }

    this.db.prepare("DELETE FROM financial_obligations WHERE id = ?").run(obligationId);
    return { ok: true, items: this.listFinancialObligations({ employeeId: current.employee_id }) };
  }

  saveAttendanceRecord(payload) {
    return saveAttendanceRecordDomain(this, payload, nowIso);
  }

  deleteAttendanceRecord(attendanceId) {
    return deleteAttendanceRecordDomain(this, attendanceId);
  }

  approveAttendanceAdjustments(monthRef, userId, filters = {}) {
    return approveAttendanceAdjustmentsDomain(this, monthRef, userId, filters, isValidMonthRef, nowIso);
  }

  saveWorkShift(payload) {
    const validation = this.validateWorkShiftPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const record = {
      ...validation.sanitized,
      active: validation.sanitized.active ? 1 : 0,
      updated_at: nowIso()
    };

    if (payload.id) {
      this.db.prepare(`
        UPDATE work_shifts
        SET code = @code,
            name = @name,
            department = @department,
            profile = @profile,
            start_time = @start_time,
            end_time = @end_time,
            tolerance_minutes = @tolerance_minutes,
            break_minutes = @break_minutes,
            working_days_json = @working_days_json,
            class_blocks_json = @class_blocks_json,
            notes = @notes,
            active = @active,
            updated_at = @updated_at
        WHERE id = @id
      `).run({ ...record, id: payload.id });
    } else {
      this.db.prepare(`
        INSERT INTO work_shifts (
          code, name, department, profile, start_time, end_time, tolerance_minutes, break_minutes,
          working_days_json, class_blocks_json, notes, active, created_at, updated_at
        ) VALUES (
          @code, @name, @department, @profile, @start_time, @end_time, @tolerance_minutes, @break_minutes,
          @working_days_json, @class_blocks_json, @notes, @active, @created_at, @updated_at
        )
      `).run({ ...record, created_at: nowIso() });
    }

    return { ok: true, items: this.listWorkShifts() };
  }

  deleteWorkShift(shiftId) {
    const employeesUsingShift = this.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE shift_id = ?").get(shiftId)?.total || 0;
    if (employeesUsingShift > 0) {
      return { ok: false, message: "Existem funcionários associados a este turno. Reatribua-os antes de remover o turno." };
    }

    const attendanceUsingShift = this.db.prepare("SELECT COUNT(*) AS total FROM attendance_records WHERE shift_id = ?").get(shiftId)?.total || 0;
    if (attendanceUsingShift > 0) {
      return { ok: false, message: "Este turno já foi utilizado em registos de assiduidade e não pode ser removido." };
    }

    this.db.prepare("DELETE FROM work_shifts WHERE id = ?").run(shiftId);
    return { ok: true, items: this.listWorkShifts() };
  }

  resolveEmployeeForAttendanceImport(rawCode) {
    const employeeCode = String(rawCode || "").trim();
    const digits = onlyDigits(employeeCode);
    if (!employeeCode) {
      return null;
    }

    return this.db.prepare(`
      SELECT
        employees.*,
        work_shifts.name AS shift_name,
        work_shifts.profile AS shift_profile,
        work_shifts.start_time AS shift_start_time,
        work_shifts.end_time AS shift_end_time,
        work_shifts.tolerance_minutes AS shift_tolerance_minutes,
        work_shifts.break_minutes AS shift_break_minutes
      FROM employees
      LEFT JOIN work_shifts ON work_shifts.id = employees.shift_id
      WHERE UPPER(TRIM(COALESCE(employees.attendance_code, ''))) = UPPER(TRIM(@employeeCode))
         OR CAST(employees.id AS TEXT) = @employeeCode
         OR UPPER(TRIM(COALESCE(employees.bi, ''))) = UPPER(TRIM(@employeeCode))
         OR TRIM(COALESCE(employees.social_security_number, '')) = @digits
         OR TRIM(COALESCE(employees.nif, '')) = @digits
      ORDER BY
        CASE WHEN UPPER(TRIM(COALESCE(employees.attendance_code, ''))) = UPPER(TRIM(@employeeCode)) THEN 0 ELSE 1 END,
        employees.id ASC
      LIMIT 1
    `).get({ employeeCode, digits });
  }

  findProtectedAttendanceStatus(employeeId, attendanceDate) {
    const vacation = this.db.prepare(`
      SELECT id
      FROM vacation_requests
      WHERE employee_id = ?
        AND status IN ('approved', 'taken')
        AND start_date <= ?
        AND end_date >= ?
      LIMIT 1
    `).get(employeeId, attendanceDate, attendanceDate);
    if (vacation) {
      return "vacation";
    }

    const leave = this.db.prepare(`
      SELECT id
      FROM leave_requests
      WHERE employee_id = ?
        AND status = 'approved'
        AND start_date <= ?
        AND end_date >= ?
      LIMIT 1
    `).get(employeeId, attendanceDate, attendanceDate);
    if (leave) {
      return "leave";
    }

    return "";
  }

  createAttendanceImportBatch(batchRecord) {
    const insertBatch = this.db.prepare(`
      INSERT INTO attendance_import_batches (
        source_type, file_name, file_path, file_hash, device_label, device_profile, import_mode, month_ref,
        total_rows, imported_rows, skipped_rows, sync_status, technical_message, imported_by_user_id, created_at
      ) VALUES (
        @source_type, @file_name, @file_path, @file_hash, @device_label, @device_profile, @import_mode, @month_ref,
        @total_rows, @imported_rows, @skipped_rows, @sync_status, @technical_message, @imported_by_user_id, @created_at
      )
    `);

    const result = insertBatch.run(batchRecord);
    return result.lastInsertRowid;
  }

  recordAttendanceImportLog(payload = {}) {
    this.db.prepare(`
      INSERT INTO attendance_import_logs (
        batch_id, employee_id, employee_code, attendance_date, outcome, message, payload_json, created_at
      ) VALUES (
        @batch_id, @employee_id, @employee_code, @attendance_date, @outcome, @message, @payload_json, @created_at
      )
    `).run({
      batch_id: payload.batch_id,
      employee_id: payload.employee_id ?? null,
      employee_code: String(payload.employee_code || "").trim(),
      attendance_date: String(payload.attendance_date || "").trim(),
      outcome: String(payload.outcome || "info").trim().toLowerCase(),
      message: String(payload.message || "").trim() || "Sem mensagem técnica.",
      payload_json: JSON.stringify(payload.payload_json || {}),
      created_at: payload.created_at || nowIso()
    });
  }

  syncAttendanceWatchedFolder(payload = {}) {
    const settings = this.getSystemSettings();
    const folderPath = String(payload.folder_path || settings.attendanceWatchedFolder || "").trim();
    const sourceType = String(payload.source_type || settings.attendanceWatchedSourceType || "biometric")
      .trim()
      .toLowerCase();
    const deviceProfile = normalizeAttendanceDeviceProfile(
      payload.device_profile ||
        (sourceType === "card" ? settings.attendanceCardProfile : settings.attendanceBiometricProfile),
      sourceType
    );
    const incrementalImport = payload.incremental_import !== undefined
      ? Boolean(payload.incremental_import)
      : settings.attendanceIncrementalImport !== false;

    if (!folderPath || !fs.existsSync(folderPath)) {
      return { ok: false, message: "A pasta monitorizada não existe ou não está acessível." };
    }
    if (!["biometric", "card"].includes(sourceType)) {
      return { ok: false, message: "A origem monitorizada deve ser biométrico ou cartão." };
    }

    const filePaths = fs.readdirSync(folderPath)
      .filter((fileName) => /\.(csv|txt|dat|log)$/i.test(fileName))
      .map((fileName) => path.join(folderPath, fileName))
      .sort((left, right) => fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs);

    if (!filePaths.length) {
      return { ok: true, folderPath, processedFiles: 0, duplicateFiles: 0, errorFiles: 0, importedRows: 0, skippedRows: 0, items: [] };
    }

    const result = {
      ok: true,
      folderPath,
      processedFiles: 0,
      duplicateFiles: 0,
      errorFiles: 0,
      importedRows: 0,
      skippedRows: 0,
      items: []
    };

    for (const filePath of filePaths) {
      const importResult = this.importAttendanceFile({
        file_path: filePath,
        source_type: sourceType,
        device_label: payload.device_label || path.basename(folderPath),
        device_profile: deviceProfile,
        import_mode: "watched_folder",
        imported_by_user_id: payload.imported_by_user_id ?? null,
        incremental_import: incrementalImport
      });

      result.items.push({
        filePath,
        ok: Boolean(importResult?.ok),
        duplicated: Boolean(importResult?.duplicated),
        message: importResult?.message || "",
        batch: importResult?.batch || null
      });

      if (!importResult?.ok) {
        result.errorFiles += 1;
        continue;
      }
      if (importResult?.duplicated) {
        result.duplicateFiles += 1;
      } else {
        result.processedFiles += 1;
      }
      result.importedRows += Number(importResult?.summary?.imported || 0);
      result.skippedRows += Number(importResult?.summary?.skipped || 0);
    }

    return result;
  }

  importAttendanceFile(payload = {}) {
    const filePath = String(payload.file_path || "").trim();
    const sourceType = String(payload.source_type || "biometric").trim().toLowerCase();
    const deviceLabel = String(payload.device_label || "").trim();
    const overwriteImported = payload.overwrite_imported !== false;
    const settings = this.getSystemSettings();

    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, message: "Selecione um ficheiro válido para a sincronização de assiduidade." };
    }
    if (!["biometric", "card"].includes(sourceType)) {
      return { ok: false, message: "A origem da sincronização deve ser biométrico ou cartão." };
    }

    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsedRows = parseAttendanceImportContent(rawContent);
    if (!parsedRows.length) {
      return { ok: false, message: "O ficheiro selecionado não contém registos de assiduidade reconhecidos." };
    }

    const fileHash = hashFileContent(rawContent);
    const deviceProfile = normalizeAttendanceDeviceProfile(
      payload.device_profile ||
        (sourceType === "card" ? settings.attendanceCardProfile : settings.attendanceBiometricProfile),
      sourceType
    );
    const importMode = ATTENDANCE_IMPORT_MODES.includes(String(payload.import_mode || "").trim().toLowerCase())
      ? String(payload.import_mode || "").trim().toLowerCase()
      : "manual";
    const incrementalImport = payload.incremental_import !== undefined
      ? Boolean(payload.incremental_import)
      : settings.attendanceIncrementalImport !== false;
    const monthRefs = Array.from(
      new Set(parsedRows.map((item) => String(item.attendance_date || "").slice(0, 7)).filter((item) => isValidMonthRef(item)))
    );
    const duplicatedBatch = incrementalImport
      ? this.db.prepare(`
          SELECT id
          FROM attendance_import_batches
          WHERE file_hash = ? AND source_type = ? AND sync_status = 'processed'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `).get(fileHash, sourceType)
      : null;
    const batchRecord = {
      source_type: sourceType,
      file_name: path.basename(filePath),
      file_path: filePath,
      file_hash: fileHash,
      device_label: deviceLabel,
      device_profile: deviceProfile,
      import_mode: importMode,
      month_ref: monthRefs.length === 1 ? monthRefs[0] : "",
      total_rows: parsedRows.length,
      imported_rows: 0,
      skipped_rows: 0,
      sync_status: duplicatedBatch ? "duplicate" : "processed",
      technical_message: duplicatedBatch ? "Ficheiro ignorado por já ter sido sincronizado anteriormente." : "",
      imported_by_user_id: payload.imported_by_user_id ?? null,
      created_at: nowIso()
    };
    const batchId = this.createAttendanceImportBatch(batchRecord);

    if (duplicatedBatch) {
      this.recordAttendanceImportLog({
        batch_id: batchId,
        outcome: "duplicate_file",
        message: "Ficheiro ignorado pela importação incremental. O mesmo conteúdo já foi processado anteriormente.",
        payload_json: {
          existingBatchId: duplicatedBatch.id,
          fileHash,
          sourceType,
          importMode
        }
      });

      return {
        ok: true,
        duplicated: true,
        message: "Ficheiro ignorado: este conteúdo já foi sincronizado anteriormente.",
        batch: this.getAttendanceImportBatchSnapshot(batchId),
        summary: {
          total_groups: 0,
          imported: 0,
          skipped: 0,
          duplicate_file: true
        },
        items: batchRecord.month_ref ? this.listAttendanceRecords({ monthRef: batchRecord.month_ref }) : []
      };
    }

    const grouped = new Map();
    parsedRows.forEach((row) => {
      const key = `${row.employee_code}::${row.attendance_date}`;
      const current = grouped.get(key) || {
        employee_code: row.employee_code,
        attendance_date: row.attendance_date,
        times: [],
        statuses: [],
        devices: []
      };
      if (row.time) current.times.push(row.time);
      if (row.status) current.statuses.push(row.status);
      if (row.device_label) current.devices.push(row.device_label);
      grouped.set(key, current);
    });

    const summary = {
      total_groups: grouped.size,
      imported: 0,
      skipped: 0,
      skipped_closed_period: 0,
      skipped_manual: 0,
      skipped_incremental: 0,
      skipped_without_employee: 0,
      protected_by_leave_or_vacation: 0
    };

    const upsert = this.db.prepare(`
      INSERT INTO attendance_records (
        employee_id, attendance_date, status, shift_id, check_in_time, check_out_time,
        punch_count, approval_status, approved_by_user_id, approved_at,
        hours_worked, delay_minutes, source, device_label, batch_id, notes, created_at, updated_at
      ) VALUES (
        @employee_id, @attendance_date, @status, @shift_id, @check_in_time, @check_out_time,
        @punch_count, @approval_status, @approved_by_user_id, @approved_at,
        @hours_worked, @delay_minutes, @source, @device_label, @batch_id, @notes, @created_at, @updated_at
      )
      ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
        status = excluded.status,
        shift_id = excluded.shift_id,
        check_in_time = excluded.check_in_time,
        check_out_time = excluded.check_out_time,
        punch_count = excluded.punch_count,
        approval_status = excluded.approval_status,
        approved_by_user_id = excluded.approved_by_user_id,
        approved_at = excluded.approved_at,
        hours_worked = excluded.hours_worked,
        delay_minutes = excluded.delay_minutes,
        source = excluded.source,
        device_label = excluded.device_label,
        batch_id = excluded.batch_id,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `);

    for (const group of grouped.values()) {
      const basePayload = {
        batch_id: batchId,
        employee_code: group.employee_code,
        attendance_date: group.attendance_date,
        payload_json: {
          sourceType,
          deviceProfile,
          importMode,
          detectedStatuses: group.statuses,
          detectedTimes: group.times
        }
      };
      const employee = this.resolveEmployeeForAttendanceImport(group.employee_code);
      if (!employee) {
        summary.skipped += 1;
        summary.skipped_without_employee += 1;
        this.recordAttendanceImportLog({
          ...basePayload,
          outcome: "skipped_without_employee",
          message: "Registo ignorado: não foi possível associar o código importado a um trabalhador."
        });
        continue;
      }

      const monthRef = String(group.attendance_date || "").slice(0, 7);
      let periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        summary.skipped += 1;
        summary.skipped_closed_period += 1;
        this.recordAttendanceImportLog({
          ...basePayload,
          employee_id: employee.id,
          outcome: "skipped_closed_period",
          message: "Registo ignorado: o período salarial ou de assiduidade está fechado."
        });
        continue;
      }
      periodState = this.ensureAttendancePeriodOpen(monthRef);
      if (!periodState.ok) {
        summary.skipped += 1;
        summary.skipped_closed_period += 1;
        this.recordAttendanceImportLog({
          ...basePayload,
          employee_id: employee.id,
          outcome: "skipped_closed_period",
          message: "Registo ignorado: o mês de assiduidade está fechado."
        });
        continue;
      }

      const existing = this.db.prepare(`
        SELECT id, source
        FROM attendance_records
        WHERE employee_id = ? AND attendance_date = ?
      `).get(employee.id, group.attendance_date);
      if (existing?.source === "manual") {
        summary.skipped += 1;
        summary.skipped_manual += 1;
        this.recordAttendanceImportLog({
          ...basePayload,
          employee_id: employee.id,
          outcome: "skipped_manual",
          message: "Registo ignorado: já existe uma marcação manual para o mesmo trabalhador e data."
        });
        continue;
      }
      if (existing?.source && existing.source !== "manual" && !overwriteImported) {
        summary.skipped += 1;
        summary.skipped_incremental += 1;
        this.recordAttendanceImportLog({
          ...basePayload,
          employee_id: employee.id,
          outcome: "skipped_existing_import",
          message: "Registo ignorado: já existe uma importação anterior e a atualização incremental está desativada."
        });
        continue;
      }

      const protectedStatus = this.findProtectedAttendanceStatus(employee.id, group.attendance_date);
      if (protectedStatus) {
        summary.protected_by_leave_or_vacation += 1;
      }

      const sortedTimes = [...group.times].filter(Boolean).sort();
      const checkInTime = sortedTimes[0] || "";
      const checkOutTime = sortedTimes.length > 1 ? sortedTimes[sortedTimes.length - 1] : sortedTimes[0] || "";
      const shiftStartMinutes = timeToMinutes(employee.shift_start_time);
      const checkInMinutes = timeToMinutes(checkInTime);
      const calculatedDelay =
        shiftStartMinutes !== null && checkInMinutes !== null
          ? Math.max(checkInMinutes - (shiftStartMinutes + Number(employee.shift_tolerance_minutes || 0)), 0)
          : 0;
      const fallbackStatus =
        checkInMinutes === null
          ? "absent"
          : calculatedDelay > 0
            ? "delay"
            : "present";
      const explicitStatus = group.statuses.find(Boolean) || "";
      const status = protectedStatus || explicitStatus || fallbackStatus;

      upsert.run({
        employee_id: employee.id,
        attendance_date: group.attendance_date,
        status,
        shift_id: employee.shift_id || null,
        check_in_time: checkInTime || null,
        check_out_time: checkOutTime || null,
        punch_count: group.times.filter(Boolean).length,
        approval_status: "approved",
        approved_by_user_id: payload.imported_by_user_id ?? null,
        approved_at: nowIso(),
        hours_worked:
          status === "present" || status === "delay"
            ? calculateWorkedHoursFromPunches(checkInTime, checkOutTime, employee.shift_break_minutes || 0)
            : 0,
        delay_minutes: status === "delay" ? calculatedDelay : 0,
        source: sourceType === "card" ? "card_import" : "biometric_import",
        device_label: deviceLabel || group.devices[0] || "",
        batch_id: batchId,
        notes: protectedStatus
          ? "Registo importado protegido por licença ou férias aprovadas."
          : "Registo importado do dispositivo de assiduidade.",
        created_at: nowIso(),
        updated_at: nowIso()
      });

      summary.imported += 1;
      this.recordAttendanceImportLog({
        ...basePayload,
        employee_id: employee.id,
        outcome: existing?.id ? "updated" : "imported",
        message: protectedStatus
          ? "Registo importado com proteção automática por licença ou férias aprovadas."
          : existing?.id
            ? "Registo importado e atualizado com sucesso."
            : "Registo importado com sucesso.",
        payload_json: {
          ...basePayload.payload_json,
          attendanceStatus: status,
          delayMinutes: status === "delay" ? calculatedDelay : 0,
          protectedStatus: protectedStatus || null
        }
      });
    }

    summary.skipped = summary.total_groups - summary.imported;
    this.db.prepare(`
      UPDATE attendance_import_batches
      SET imported_rows = @imported_rows,
          skipped_rows = @skipped_rows,
          technical_message = @technical_message
      WHERE id = @id
    `).run({
      id: batchId,
      imported_rows: summary.imported,
      skipped_rows: summary.skipped,
      technical_message:
        summary.skipped > 0
          ? `${summary.imported} registo(s) importado(s) e ${summary.skipped} ignorado(s).`
          : "Importação concluída sem ocorrências."
    });

    return {
      ok: true,
      batch: this.getAttendanceImportBatchSnapshot(batchId),
      summary,
      items: batchRecord.month_ref ? this.listAttendanceRecords({ monthRef: batchRecord.month_ref }) : []
    };
  }

  saveEvent(payload) {
    const validation = this.validateEventPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const periodState = this.ensurePeriodOpen(String(payload.event_date || "").slice(0, 7));
    if (!periodState.ok) {
      return periodState;
    }

    const event = {
      employee_id: payload.employee_id,
      event_type: payload.event_type,
      event_date: payload.event_date,
      amount: Number(payload.amount || 0),
      quantity: Number(payload.quantity || 0),
      description: payload.description || "",
      meta_json: JSON.stringify(payload.meta_json || {})
    };

    if (payload.id) {
      this.db.prepare(`
        UPDATE payroll_events
        SET employee_id = @employee_id, event_type = @event_type, event_date = @event_date,
            amount = @amount, quantity = @quantity, description = @description, meta_json = @meta_json
        WHERE id = @id
      `).run({ ...event, id: payload.id });
    } else {
      this.db.prepare(`
        INSERT INTO payroll_events (
          employee_id, event_type, event_date, amount, quantity, description, meta_json, created_at
        ) VALUES (
          @employee_id, @event_type, @event_date, @amount, @quantity, @description, @meta_json, @created_at
        )
      `).run({ ...event, created_at: nowIso() });
    }
    return { ok: true, events: this.listEvents(payload.employee_id) };
  }

  saveLeaveRequest(payload) {
    const validation = this.validateLeaveRequestPayload(payload);
    if (!validation.ok) {
      return validation;
    }

    const periodsToCheck = enumerateMonthRefs(validation.sanitized.start_date, validation.sanitized.end_date);
    for (const monthRef of periodsToCheck) {
      const periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    if (payload.id) {
      const current = this.getLeaveRequestSnapshot(payload.id);
      if (current?.status === "approved" || current?.status === "rejected") {
        return {
          ok: false,
          message: "Este registo já foi decidido. Utilize a reabertura do período ou crie um novo registo, se necessário."
        };
      }
    }

    const record = {
      ...validation.sanitized,
      updated_at: nowIso()
    };

    if (payload.id) {
      this.db.prepare(`
        UPDATE leave_requests
        SET employee_id = @employee_id,
            record_type = @record_type,
            start_date = @start_date,
            end_date = @end_date,
            days = @days,
            reason = @reason,
            document_ref = @document_ref,
            proof_type = @proof_type,
            notes = @notes,
            status = 'pending',
            affects_payroll = @affects_payroll,
            approved_by_user_id = NULL,
            approved_at = NULL,
            rejection_reason = '',
            updated_at = @updated_at
        WHERE id = @id
      `).run({ ...record, id: payload.id });
    } else {
      this.db.prepare(`
        INSERT INTO leave_requests (
          employee_id, record_type, start_date, end_date, days, reason, document_ref, proof_type,
          notes, status, affects_payroll, approved_by_user_id, approved_at, rejection_reason, created_at, updated_at
        ) VALUES (
          @employee_id, @record_type, @start_date, @end_date, @days, @reason, @document_ref, @proof_type,
          @notes, 'pending', @affects_payroll, NULL, NULL, '', @created_at, @updated_at
        )
      `).run({ ...record, created_at: nowIso() });
    }

    return { ok: true, items: this.listLeaveRequests({ employeeId: validation.sanitized.employee_id }) };
  }

  setLeaveRequestStatus(leaveRequestId, status, userId, rejectionReason = "") {
    const current = this.db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(leaveRequestId);
    if (!current) {
      return { ok: false, message: "Registo de licença ou ausência não encontrado." };
    }

    const monthRefs = enumerateMonthRefs(current.start_date, current.end_date);
    for (const monthRef of monthRefs) {
      const periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (!["approved", "rejected", "pending"].includes(normalizedStatus)) {
      return { ok: false, message: "O estado pretendido para a licença é inválido." };
    }

    this.db.prepare(`
      UPDATE leave_requests
      SET status = @status,
          approved_by_user_id = @approved_by_user_id,
          approved_at = @approved_at,
          rejection_reason = @rejection_reason,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: leaveRequestId,
      status: normalizedStatus,
      approved_by_user_id: normalizedStatus === "pending" ? null : userId,
      approved_at: normalizedStatus === "pending" ? null : nowIso(),
      rejection_reason: normalizedStatus === "rejected" ? String(rejectionReason || "").trim() : "",
      updated_at: nowIso()
    });

    return { ok: true, items: this.listLeaveRequests({ employeeId: current.employee_id }) };
  }

  deleteLeaveRequest(leaveRequestId) {
    const current = this.db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(leaveRequestId);
    if (!current) {
      return { ok: false, message: "Registo de licença ou ausência não encontrado." };
    }

    const monthRefs = enumerateMonthRefs(current.start_date, current.end_date);
    for (const monthRef of monthRefs) {
      const periodState = this.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    this.db.prepare("DELETE FROM leave_requests WHERE id = ?").run(leaveRequestId);
    return { ok: true, items: this.listLeaveRequests({ employeeId: current.employee_id }) };
  }

  deleteEvent(eventId) {
    const current = this.db.prepare("SELECT event_date FROM payroll_events WHERE id = ?").get(eventId);
    if (!current) {
      return { ok: false, message: "Evento não encontrado." };
    }

    const periodState = this.ensurePeriodOpen(String(current.event_date || "").slice(0, 7));
    if (!periodState.ok) {
      return periodState;
    }

    this.db.prepare("DELETE FROM payroll_events WHERE id = ?").run(eventId);
    return { ok: true, events: this.listEvents() };
  }

  upsertPayrollRun(payload) {
    this.db.prepare(`
      INSERT INTO payroll_runs (
        month_ref, employee_id, gross_salary, allowances_total, bonuses_total, mandatory_deductions,
        absence_deduction, net_salary, irt_amount, inss_amount, summary_json, generated_at
      ) VALUES (
        @month_ref, @employee_id, @gross_salary, @allowances_total, @bonuses_total, @mandatory_deductions,
        @absence_deduction, @net_salary, @irt_amount, @inss_amount, @summary_json, @generated_at
      )
      ON CONFLICT(month_ref, employee_id) DO UPDATE SET
        gross_salary = excluded.gross_salary,
        allowances_total = excluded.allowances_total,
        bonuses_total = excluded.bonuses_total,
        mandatory_deductions = excluded.mandatory_deductions,
        absence_deduction = excluded.absence_deduction,
        net_salary = excluded.net_salary,
        irt_amount = excluded.irt_amount,
        inss_amount = excluded.inss_amount,
        summary_json = excluded.summary_json,
        generated_at = excluded.generated_at
    `).run(payload);
  }

  savePayrollRunsSnapshot(monthRef, payrollRuns = [], options = {}) {
    const normalizedRuns = Array.isArray(payrollRuns) ? payrollRuns : [];
    const normalizedEmployeeIds = Array.from(
      new Set(
        normalizedRuns
          .map((item) => Number(item?.employee_id))
          .filter((employeeId) => Number.isFinite(employeeId) && employeeId > 0)
      )
    );

    return this.runInTransaction(() => {
      if (options.resetExisting === true) {
        this.clearPayrollRunsByMonth(monthRef);
      }

      for (const payrollRun of normalizedRuns) {
        this.upsertPayrollRun(payrollRun);
      }

      this.prunePayrollRunsByMonth(monthRef, normalizedEmployeeIds);
      return { ok: true, employeeIds: normalizedEmployeeIds, count: normalizedRuns.length };
    });
  }

  listPayrollRuns(filters = {}) {
    const query = buildPayrollRunsFilter(filters, normalizeReportFilters);
    const rows = this.db.prepare(`
      SELECT
        payroll_runs.*,
        employees.full_name,
        employees.department,
        employees.job_title,
        employees.nif,
        employees.bi,
        employees.document_type,
        employees.social_security_number
      FROM payroll_runs
      INNER JOIN employees ON employees.id = payroll_runs.employee_id
      ${query.whereClause}
      ORDER BY payroll_runs.month_ref DESC, employees.full_name ASC
    `).all(query.values);
    return mapPayrollRunRows(rows);
  }

  buildAttendanceReportData(filters, reportType = "presencas") {
    const normalizedFilters = normalizeReportFilters(filters);
    const normalizedType = String(reportType || filters?.reportType || "presencas").trim().toLowerCase();
    const rows = this.listAttendanceRecords({
      monthRef: normalizedFilters.monthRef,
      startDate: normalizedFilters.startDate,
      endDate: normalizedFilters.endDate,
      employeeId: normalizedFilters.employeeId
    });
    const filteredRows = rows.filter((row) => {
      if (normalizedType === "faltas") {
        return row.status === "absent" || row.status === "half_absence";
      }
      return row.status === "present" || row.status === "delay";
    });

    return {
      monthRef: normalizedFilters.monthRef,
      periodLabel: normalizedFilters.periodLabel,
      employeeId: normalizedFilters.employeeId,
      reportType: normalizedType,
      rows: filteredRows.map((row, index) => ({
        index: index + 1,
        full_name: row.full_name,
        job_title: row.job_title || "",
        department: row.department || "",
        attendance_date: row.attendance_date,
        status: row.status,
        status_label: formatAttendanceStatusLabel(row.status),
        hours_worked: Number(row.hours_worked || 0),
        delay_minutes: Number(row.delay_minutes || 0),
        notes: row.notes || ""
      })),
      totals: filteredRows.reduce(
        (acc, row) => {
          acc.records += 1;
          acc.hours += Number(row.hours_worked || 0);
          acc.delay += Number(row.delay_minutes || 0);
          if (row.status === "absent") acc.absent += 1;
          if (row.status === "half_absence") acc.halfAbsence += 1;
          if (row.status === "present") acc.present += 1;
          if (row.status === "delay") acc.delayEntries += 1;
          return acc;
        },
        { records: 0, hours: 0, delay: 0, absent: 0, halfAbsence: 0, present: 0, delayEntries: 0 }
      )
    };
  }

  buildShiftMapData(filters) {
    const normalizedFilters = normalizeReportFilters(filters);
    if (!normalizedFilters.monthRef && !normalizedFilters.hasDateRange) {
      return {
        ok: false,
        message: "O período dos mapas de turnos é inválido."
      };
    }

    const employees = this.listEmployees()
      .filter((employee) => String(employee.status || "").toLowerCase() === "ativo")
      .filter((employee) => !normalizedFilters.employeeId || String(employee.id) === normalizedFilters.employeeId);
    const shifts = this.listWorkShifts();
    const shiftMap = new Map(shifts.map((shift) => [Number(shift.id), shift]));
    const attendanceRows = this.listAttendanceRecords({
      monthRef: normalizedFilters.monthRef,
      startDate: normalizedFilters.startDate,
      endDate: normalizedFilters.endDate,
      employeeId: normalizedFilters.employeeId
    });
    const leaveRequests = this.listLeaveRequests({
      status: "approved",
      monthRef: normalizedFilters.monthRef,
      startDate: normalizedFilters.startDate,
      endDate: normalizedFilters.endDate,
      employeeId: normalizedFilters.employeeId
    });
    const vacationRequests = this.listVacationRequests({
      monthRef: normalizedFilters.monthRef,
      startDate: normalizedFilters.startDate,
      endDate: normalizedFilters.endDate,
      employeeId: normalizedFilters.employeeId
    }).filter((item) => ["approved", "taken"].includes(String(item.status || "").toLowerCase()));

    const employeeRows = employees.map((employee, index) => {
      const shift = employee.shift_id ? shiftMap.get(Number(employee.shift_id)) || null : null;
      const employeeAttendance = attendanceRows.filter((row) => Number(row.employee_id) === Number(employee.id));
      const attendanceSummary = employeeAttendance.reduce(
        (acc, row) => {
          acc.records += 1;
          acc.hoursWorked += Number(row.hours_worked || 0);
          acc.delayMinutes += Number(row.delay_minutes || 0);
          if (row.status === "present") acc.presentDays += 1;
          if (row.status === "delay") acc.delayDays += 1;
          if (row.status === "absent") acc.absentDays += 1;
          if (row.status === "half_absence") acc.halfAbsenceDays += 1;
          if (row.status === "leave") acc.leaveStatusDays += 1;
          if (row.status === "vacation") acc.vacationStatusDays += 1;
          if ((row.status === "present" || row.status === "delay") && (!row.check_in_time || !row.check_out_time)) {
            acc.incompleteRecords += 1;
          }
          return acc;
        },
        {
          records: 0,
          hoursWorked: 0,
          delayMinutes: 0,
          presentDays: 0,
          delayDays: 0,
          absentDays: 0,
          halfAbsenceDays: 0,
          leaveStatusDays: 0,
          vacationStatusDays: 0,
          incompleteRecords: 0
        }
      );

      const approvedLeaveDays = leaveRequests
        .filter((item) => Number(item.employee_id) === Number(employee.id))
        .reduce((sum, item) => {
          if (normalizedFilters.monthRef) {
            return sum + overlapDaysWithinMonth(item.start_date, item.end_date, normalizedFilters.monthRef);
          }
          const effectiveStart = item.start_date > normalizedFilters.startDate ? item.start_date : normalizedFilters.startDate;
          const effectiveEnd = item.end_date < normalizedFilters.endDate ? item.end_date : normalizedFilters.endDate;
          return effectiveStart > effectiveEnd ? sum : sum + inclusiveDateDiff(effectiveStart, effectiveEnd);
        }, 0);
      const approvedVacationDays = vacationRequests
        .filter((item) => Number(item.employee_id) === Number(employee.id))
        .reduce((sum, item) => {
          if (normalizedFilters.monthRef) {
            return sum + overlapDaysWithinMonth(item.start_date, item.end_date, normalizedFilters.monthRef);
          }
          const effectiveStart = item.start_date > normalizedFilters.startDate ? item.start_date : normalizedFilters.startDate;
          const effectiveEnd = item.end_date < normalizedFilters.endDate ? item.end_date : normalizedFilters.endDate;
          return effectiveStart > effectiveEnd ? sum : sum + inclusiveDateDiff(effectiveStart, effectiveEnd);
        }, 0);

      const effectiveLeaveDays = Math.max(attendanceSummary.leaveStatusDays, approvedLeaveDays);
      const effectiveVacationDays = Math.max(attendanceSummary.vacationStatusDays, approvedVacationDays);
      const plannedDays = shift && normalizedFilters.monthRef ? countWorkingDaysInMonth(normalizedFilters.monthRef, shift.working_days) : attendanceSummary.records;
      const shiftHoursPerDay = shift
        ? (
            shift.class_blocks?.length
              ? calculateClassBlocksHours(shift.class_blocks)
              : calculateShiftHours(shift.start_time, shift.end_time, shift.break_minutes)
          )
        : 0;
      const expectedHours = roundCurrency(plannedDays * shiftHoursPerDay);
      const attendanceBase = attendanceSummary.presentDays + attendanceSummary.delayDays;
      const absentEquivalent = attendanceSummary.absentDays + attendanceSummary.halfAbsenceDays * 0.5;
      const isDocente = Boolean(
        String(shift?.profile || employee.shift_profile || "").startsWith("docente") ||
        /docente/i.test(String(employee.department || "")) ||
        (shift?.class_blocks || []).length
      );

      return {
        index: index + 1,
        employee_id: employee.id,
        full_name: employee.full_name,
        department: employee.department || "-",
        job_title: employee.job_title || "-",
        attendance_code: employee.attendance_code || "",
        shift_id: shift?.id || employee.shift_id || null,
        shift_name: shift?.name || employee.shift_name || "Sem turno atribuído",
        shift_code: shift?.code || "",
        shift_profile: shift?.profile || employee.shift_profile || "",
        working_days_label: shift ? describeWorkingDays(shift.working_days) : "-",
        planned_days: plannedDays,
        schedule_label: shift ? `${shift.start_time} - ${shift.end_time}` : "-",
        expected_hours: expectedHours,
        hours_worked: roundCurrency(attendanceSummary.hoursWorked),
        present_days: attendanceSummary.presentDays,
        delay_days: attendanceSummary.delayDays,
        absent_days: attendanceSummary.absentDays,
        half_absence_days: attendanceSummary.halfAbsenceDays,
        leave_days: effectiveLeaveDays,
        vacation_days: effectiveVacationDays,
        incomplete_records: attendanceSummary.incompleteRecords,
        records_count: attendanceSummary.records,
        punctuality_rate: attendanceBase ? roundCurrency((attendanceSummary.presentDays / attendanceBase) * 100) : 0,
        absenteeism_rate: plannedDays ? roundCurrency((absentEquivalent / plannedDays) * 100) : 0,
        coverage_rate: expectedHours ? roundCurrency((attendanceSummary.hoursWorked / expectedHours) * 100) : 0,
        class_blocks: shift?.class_blocks || [],
        class_blocks_label: shift?.class_blocks?.length
          ? shift.class_blocks.map((block) => `${block.label}: ${block.start_time}-${block.end_time}`).join(" | ")
          : "-",
        class_blocks_count: Array.isArray(shift?.class_blocks) ? shift.class_blocks.length : 0,
        class_hours_per_day: shift?.class_blocks?.length ? calculateClassBlocksHours(shift.class_blocks) : shiftHoursPerDay,
        is_docente: isDocente
      };
    });

    const departmentMap = new Map();
    employeeRows.forEach((row) => {
      const key = row.department || "Sem departamento";
      if (!departmentMap.has(key)) {
        departmentMap.set(key, {
          index: departmentMap.size + 1,
          department: key,
          employees_count: 0,
          shifts_count: 0,
          shift_names: new Set(),
          attendance_codes_missing: 0,
          planned_days: 0,
          present_days: 0,
          delay_days: 0,
          absent_days: 0,
          leave_days: 0,
          vacation_days: 0,
          incomplete_records: 0,
          expected_hours: 0,
          hours_worked: 0
        });
      }
      const bucket = departmentMap.get(key);
      bucket.employees_count += 1;
      if (row.shift_id) {
        bucket.shift_names.add(row.shift_name);
      }
      if (!row.attendance_code) {
        bucket.attendance_codes_missing += 1;
      }
      bucket.planned_days += Number(row.planned_days || 0);
      bucket.present_days += Number(row.present_days || 0);
      bucket.delay_days += Number(row.delay_days || 0);
      bucket.absent_days += Number(row.absent_days || 0) + Number(row.half_absence_days || 0);
      bucket.leave_days += Number(row.leave_days || 0);
      bucket.vacation_days += Number(row.vacation_days || 0);
      bucket.incomplete_records += Number(row.incomplete_records || 0);
      bucket.expected_hours += Number(row.expected_hours || 0);
      bucket.hours_worked += Number(row.hours_worked || 0);
    });

    const departmentRows = Array.from(departmentMap.values()).map((row, index) => ({
      index: index + 1,
      department: row.department,
      employees_count: row.employees_count,
      shifts_count: row.shift_names.size,
      shifts_label: Array.from(row.shift_names).join(", ") || "Sem turno atribuído",
      attendance_codes_missing: row.attendance_codes_missing,
      planned_days: row.planned_days,
      present_days: row.present_days,
      delay_days: row.delay_days,
      absent_days: row.absent_days,
      leave_days: row.leave_days,
      vacation_days: row.vacation_days,
      incomplete_records: row.incomplete_records,
      expected_hours: roundCurrency(row.expected_hours),
      hours_worked: roundCurrency(row.hours_worked),
      attendance_rate: row.planned_days ? roundCurrency(((row.present_days + row.delay_days) / row.planned_days) * 100) : 0,
      punctuality_rate: row.present_days + row.delay_days ? roundCurrency((row.present_days / (row.present_days + row.delay_days)) * 100) : 0,
      coverage_rate: row.expected_hours ? roundCurrency((row.hours_worked / row.expected_hours) * 100) : 0
    }));

    const teacherRows = employeeRows
      .filter((row) => row.is_docente)
      .map((row, index) => ({
        index: index + 1,
        employee_id: row.employee_id,
        full_name: row.full_name,
        department: row.department,
        job_title: row.job_title,
        shift_name: row.shift_name,
        shift_profile: row.shift_profile,
        blocks_label: row.class_blocks_label,
        blocks_count: row.class_blocks_count,
        planned_days: row.planned_days,
        class_hours_per_day: row.class_hours_per_day,
        expected_hours: row.expected_hours,
        hours_worked: row.hours_worked,
        present_days: row.present_days,
        delay_days: row.delay_days,
        absent_days: row.absent_days + row.half_absence_days,
        leave_days: row.leave_days,
        vacation_days: row.vacation_days,
        attendance_rate: row.planned_days ? roundCurrency(((row.present_days + row.delay_days) / row.planned_days) * 100) : 0,
        punctuality_rate: row.punctuality_rate
      }));

    return {
      ok: true,
      monthRef: normalizedFilters.monthRef,
      periodLabel: normalizedFilters.periodLabel,
      employeeRows,
      departmentRows,
      teacherRows,
      summary: {
        employees: employeeRows.length,
        employeesWithShift: employeeRows.filter((row) => row.shift_id).length,
        missingShift: employeeRows.filter((row) => !row.shift_id).length,
        missingAttendanceCode: employeeRows.filter((row) => !row.attendance_code).length,
        incompleteRecords: employeeRows.reduce((sum, row) => sum + Number(row.incomplete_records || 0), 0),
        expectedHours: roundCurrency(employeeRows.reduce((sum, row) => sum + Number(row.expected_hours || 0), 0)),
        workedHours: roundCurrency(employeeRows.reduce((sum, row) => sum + Number(row.hours_worked || 0), 0)),
        docenteCount: teacherRows.length
      }
    };
  }

  exportShiftMapExcel(filters, reportType = "turnos-trabalhador") {
    const normalizedFilters = normalizeReportFilters(filters);
    const data = this.buildShiftMapData(normalizedFilters);
    if (!data?.ok) {
      return data;
    }

    const normalizedType = String(reportType || "turnos-trabalhador").trim().toLowerCase();
    const exactMonthLabel = normalizedFilters.monthRef || (
      normalizedFilters.startMonthRef &&
      normalizedFilters.startMonthRef === normalizedFilters.endMonthRef
        ? normalizedFilters.startMonthRef
        : ""
    );
    const definitions = {
      "turnos-trabalhador": {
        title: exactMonthLabel
          ? `Mapa mensal de turnos por trabalhador ${exactMonthLabel}`
          : `Mapa de turnos por trabalhador ${normalizedFilters.periodLabel}`,
        fileName: `mapa-turnos-trabalhador-${normalizedFilters.periodFileLabel}.xls`,
        rows: data.employeeRows,
        emptyMessage: "Não existem trabalhadores ativos para gerar o mapa mensal de turnos.",
        headers: [
          "Nº",
          "Nome do trabalhador",
          "Departamento",
          "Cargo",
          "Turno",
          "Horário",
          "Dias planeados",
          "Presenças",
          "Atrasos",
          "Faltas",
          "Licenças",
          "Férias",
          "Horas previstas",
          "Horas registadas",
          "Pontualidade",
          "Absentismo"
        ],
        values: (row) => [
          row.index,
          row.full_name,
          row.department,
          row.job_title,
          row.shift_name,
          row.schedule_label,
          row.planned_days,
          row.present_days,
          row.delay_days,
          row.absent_days + row.half_absence_days,
          row.leave_days,
          row.vacation_days,
          row.expected_hours.toFixed(2),
          row.hours_worked.toFixed(2),
          `${row.punctuality_rate.toFixed(2)}%`,
          `${row.absenteeism_rate.toFixed(2)}%`
        ]
      },
      "turnos-departamento": {
        title: exactMonthLabel
          ? `Mapa mensal de turnos por departamento ${exactMonthLabel}`
          : `Mapa de turnos por departamento ${normalizedFilters.periodLabel}`,
        fileName: `mapa-turnos-departamento-${normalizedFilters.periodFileLabel}.xls`,
        rows: data.departmentRows,
        emptyMessage: "Não existem departamentos com turnos ou assiduidade registada para este período.",
        headers: [
          "Nº",
          "Departamento",
          "Trabalhadores",
          "Turnos ativos",
          "Presenças",
          "Atrasos",
          "Faltas",
          "Licenças",
          "Férias",
          "Marcações incompletas",
          "Horas previstas",
          "Horas registadas",
          "Cobertura"
        ],
        values: (row) => [
          row.index,
          row.department,
          row.employees_count,
          row.shifts_label,
          row.present_days,
          row.delay_days,
          row.absent_days,
          row.leave_days,
          row.vacation_days,
          row.incomplete_records,
          row.expected_hours.toFixed(2),
          row.hours_worked.toFixed(2),
          `${row.coverage_rate.toFixed(2)}%`
        ]
      },
      "mapa-docente": {
        title: exactMonthLabel ? `Mapa docente ${exactMonthLabel}` : `Mapa docente ${normalizedFilters.periodLabel}`,
        fileName: `mapa-docente-${normalizedFilters.periodFileLabel}.xls`,
        rows: data.teacherRows,
        emptyMessage: "Não existem turnos docentes ou registos letivos para gerar o mapa docente neste período.",
        headers: [
          "Nº",
          "Docente",
          "Departamento",
          "Turno",
          "Blocos letivos",
          "Dias planeados",
          "Carga horária prevista",
          "Carga horária registada",
          "Presenças",
          "Atrasos",
          "Faltas",
          "Presença"
        ],
        values: (row) => [
          row.index,
          row.full_name,
          row.department,
          row.shift_name,
          row.blocks_label,
          row.planned_days,
          row.expected_hours.toFixed(2),
          row.hours_worked.toFixed(2),
          row.present_days,
          row.delay_days,
          row.absent_days,
          `${row.attendance_rate.toFixed(2)}%`
        ]
      }
    };

    const report = definitions[normalizedType] || definitions["turnos-trabalhador"];
    if (!report.rows.length) {
      return { ok: false, message: report.emptyMessage };
    }

    const content = buildExcelTableDocument(
      report.title,
      report.headers,
      report.rows.map((row) => report.values(row))
    );
    const target = path.join(this.excelExportsDir, report.fileName);
    fs.writeFileSync(target, content, "utf8");
    return { ok: true, path: target, count: report.rows.length, format: "xls", reportType: normalizedType };
  }

  exportMonthlyPayrollExcel(filters) {
    const normalizedFilters = normalizeReportFilters(filters);
    const rows = this.listPayrollRuns(normalizedFilters);
    if (!rows.length) {
      return { ok: false, message: "Não existem salários processados para este período." };
    }

    const content = buildExcelTableDocument(
      `Folha salarial ${normalizedFilters.periodLabel}`,
      [
        "Nome do funcionário",
        "Cargo",
        "Departamento",
        "Salário base",
        "Subsídios",
        "Bónus",
        "Bruto",
        "INSS",
        "IRT",
        "Descontos",
        "Líquido"
      ],
      rows.map((row) => [
        row.full_name,
        row.job_title || "",
        row.department || "",
        Number(row.summary_json?.baseSalary || 0).toFixed(2),
        Number(row.allowances_total || 0).toFixed(2),
        Number(row.bonuses_total || 0).toFixed(2),
        Number(row.gross_salary || 0).toFixed(2),
        Number(row.inss_amount || 0).toFixed(2),
        Number(row.irt_amount || 0).toFixed(2),
        Number((row.mandatory_deductions || 0) + (row.absence_deduction || 0)).toFixed(2),
        Number(row.net_salary || 0).toFixed(2)
      ])
    );

    const target = path.join(this.excelExportsDir, `folha-salarial-${normalizedFilters.periodFileLabel}.xls`);
    fs.writeFileSync(target, content, "utf8");
    return { ok: true, path: target, count: rows.length, format: "xls" };
  }

  listAgtMonthlySubmissions() {
    return this.db.prepare(`
      SELECT
        agt_monthly_submissions.*,
        submitter.full_name AS submitted_by_name
      FROM agt_monthly_submissions
      LEFT JOIN users AS submitter ON submitter.id = agt_monthly_submissions.submitted_by_user_id
      ORDER BY agt_monthly_submissions.month_ref DESC
    `).all().map((row) => ({
      ...row,
      status: normalizeAgtSubmissionStatus(row.status),
      submission_mode: String(row.submission_mode || "manual").trim() === "upload" ? "upload" : "manual",
      validation: JSON.parse(row.validation_json || "{}")
    }));
  }

  getAgtMonthlySubmission(monthRef) {
    if (!isValidMonthRef(monthRef)) {
      return buildDefaultAgtMonthlySubmission(monthRef);
    }

    const row = this.db.prepare(`
      SELECT
        agt_monthly_submissions.*,
        submitter.full_name AS submitted_by_name
      FROM agt_monthly_submissions
      LEFT JOIN users AS submitter ON submitter.id = agt_monthly_submissions.submitted_by_user_id
      WHERE agt_monthly_submissions.month_ref = ?
    `).get(monthRef);

    if (!row) {
      return buildDefaultAgtMonthlySubmission(monthRef);
    }

    return {
      ...row,
      status: normalizeAgtSubmissionStatus(row.status),
      submission_mode: String(row.submission_mode || "manual").trim() === "upload" ? "upload" : "manual",
      validation: JSON.parse(row.validation_json || "{}")
    };
  }

  upsertAgtMonthlySubmissionRecord(payload = {}) {
    const monthRef = String(payload.month_ref || "").trim();
    if (!isValidMonthRef(monthRef)) {
      return { ok: false, message: "O período AGT é inválido." };
    }

    const current = this.getAgtMonthlySubmission(monthRef);
    const nextRecord = {
      month_ref: monthRef,
      status: normalizeAgtSubmissionStatus(payload.status ?? current.status),
      submission_mode:
        String(payload.submission_mode ?? current.submission_mode ?? "manual").trim() === "upload" ? "upload" : "manual",
      proof_reference: String(payload.proof_reference ?? current.proof_reference ?? "").trim(),
      proof_path: String(payload.proof_path ?? current.proof_path ?? "").trim(),
      notes: String(payload.notes ?? current.notes ?? "").trim(),
      exported_at: payload.exported_at === undefined ? current.exported_at || null : payload.exported_at || null,
      submitted_at: payload.submitted_at === undefined ? current.submitted_at || null : payload.submitted_at || null,
      submitted_by_user_id:
        payload.submitted_by_user_id === undefined
          ? current.submitted_by_user_id || null
          : payload.submitted_by_user_id || null,
      validation_json: JSON.stringify(payload.validation ?? current.validation ?? {}),
      updated_at: nowIso()
    };

    this.db.prepare(`
      INSERT INTO agt_monthly_submissions (
        month_ref, status, submission_mode, proof_reference, proof_path, notes,
        exported_at, submitted_at, submitted_by_user_id, validation_json, updated_at
      ) VALUES (
        @month_ref, @status, @submission_mode, @proof_reference, @proof_path, @notes,
        @exported_at, @submitted_at, @submitted_by_user_id, @validation_json, @updated_at
      )
      ON CONFLICT(month_ref) DO UPDATE SET
        status = excluded.status,
        submission_mode = excluded.submission_mode,
        proof_reference = excluded.proof_reference,
        proof_path = excluded.proof_path,
        notes = excluded.notes,
        exported_at = excluded.exported_at,
        submitted_at = excluded.submitted_at,
        submitted_by_user_id = excluded.submitted_by_user_id,
        validation_json = excluded.validation_json,
        updated_at = excluded.updated_at
    `).run(nextRecord);

    return { ok: true, submission: this.getAgtMonthlySubmission(monthRef) };
  }

  saveAgtMonthlySubmission(payload = {}, userId = null) {
    const monthRef = String(payload.month_ref || "").trim();
    if (!isValidMonthRef(monthRef)) {
      return { ok: false, message: "O período AGT é inválido." };
    }

    const validationSnapshot = this.buildAgtMonthlyRemunerationMap(monthRef, { includeSubmission: false });
    if (!validationSnapshot?.ok) {
      return validationSnapshot;
    }

    const status = normalizeAgtSubmissionStatus(payload.status);
    const proofReference = String(payload.proof_reference || "").trim();
    const proofPath = String(payload.proof_path || "").trim();
    const notes = String(payload.notes || "").trim();
    const submissionMode = String(payload.submission_mode || validationSnapshot.submissionMode || "manual").trim() === "upload"
      ? "upload"
      : "manual";

    if (["ready", "submitted", "accepted"].includes(status) && !validationSnapshot.validation.ready) {
      return {
        ok: false,
        message: "O mapa AGT ainda tem bloqueios de validação. Corrija-os antes de marcar o período como pronto ou submetido."
      };
    }

    if (["submitted", "accepted", "rejected"].includes(status) && !proofReference && !proofPath) {
      return {
        ok: false,
        message: "Indique a referência ou o caminho do comprovativo da submissão AGT."
      };
    }

    const current = this.getAgtMonthlySubmission(monthRef);
    const submittedAt =
      ["submitted", "accepted", "rejected"].includes(status)
        ? current.submitted_at || nowIso()
        : null;
    const submittedByUserId =
      ["submitted", "accepted", "rejected"].includes(status)
        ? current.submitted_by_user_id || userId || null
        : null;

    return this.upsertAgtMonthlySubmissionRecord({
      month_ref: monthRef,
      status,
      submission_mode: submissionMode,
      proof_reference: proofReference,
      proof_path: proofPath,
      notes,
      exported_at: current.exported_at || null,
      submitted_at: submittedAt,
      submitted_by_user_id: submittedByUserId,
      validation: validationSnapshot.validation
    });
  }

  buildAgtMonthlyRemunerationMap(monthRef, options = {}) {
    const company = this.getCompanyProfile();
    const rows = this.listPayrollRuns().filter((row) => row.month_ref === monthRef);

    if (!rows.length) {
      return { ok: false, message: "Não existem salários processados para construir o mapa mensal de remunerações AGT." };
    }

    const items = rows.map((row, index) => {
      const summary = row.summary_json || {};
      const grossRemuneration = roundCurrency(Number(summary.payableGrossSalary ?? row.gross_salary ?? 0));
      const irtBaseBeforeInss = roundCurrency(
        Number(summary.legalBases?.irtBaseBeforeSocialSecurity ?? summary.irtBaseBeforeSocialSecurity ?? grossRemuneration)
      );
      const employeeInss = roundCurrency(Number(row.inss_amount || 0));
      const taxableBase = roundCurrency(
        Number(summary.legalBases?.materiaColectavel ?? summary.materiaColectavel ?? Math.max(irtBaseBeforeInss - employeeInss, 0))
      );
      const irtWithheld = roundCurrency(Number(row.irt_amount || 0));
      const rowIssues = [];
      const consistencyIssues = [];
      const socialSecurityNumber = String(row.social_security_number || "").trim();
      const expectedTaxableBase = roundCurrency(Math.max(irtBaseBeforeInss - employeeInss, 0));

      if (!String(row.nif || "").trim()) {
        rowIssues.push("NIF do trabalhador em falta");
      }
      if (!String(row.bi || "").trim()) {
        rowIssues.push("BI do trabalhador em falta");
      }
      if (!socialSecurityNumber) {
        rowIssues.push("NISS do trabalhador em falta");
      }
      if (!String(summary.fiscalProfileVersion || summary.fiscalProfile?.version || "").trim()) {
        rowIssues.push("Versao fiscal nao registada");
      }
      if (Math.abs(taxableBase - expectedTaxableBase) > 1) {
        consistencyIssues.push("Materia colectavel inconsistente com a base IRT e o INSS do trabalhador");
      }
      if (taxableBase > grossRemuneration) {
        consistencyIssues.push("Materia colectavel superior a remuneracao considerada");
      }
      if (taxableBase > 100000 && irtWithheld <= 0) {
        consistencyIssues.push("IRT retido inconsistente com a materia colectavel");
      }
      if (employeeInss < 0 || irtWithheld < 0) {
        consistencyIssues.push("Foram encontrados encargos legais negativos no processamento");
      }
      rowIssues.push(...consistencyIssues);

      return {
        index: index + 1,
        id: row.id,
        employee_id: row.employee_id,
        full_name: row.full_name,
        department: row.department || "",
        job_title: row.job_title || "",
        nif: row.nif || "",
        bi: row.bi || "",
        document_type: row.document_type || "bi",
        social_security_number: socialSecurityNumber,
        gross_remuneration: grossRemuneration,
        irt_base_before_inss: irtBaseBeforeInss,
        employee_inss: employeeInss,
        taxable_base: taxableBase,
        irt_withheld: irtWithheld,
        fiscal_profile_name: String(summary.fiscalProfile?.name || "").trim(),
        fiscal_profile_version: String(summary.fiscalProfileVersion || summary.fiscalProfile?.version || "").trim(),
        consistency_issues: consistencyIssues,
        issues: rowIssues
      };
    });

    const blockingIssues = [];
    const warnings = [];
    const missingEmployeeNif = items.filter((item) => !String(item.nif || "").trim()).length;
    const missingEmployeeBi = items.filter((item) => !String(item.bi || "").trim()).length;
    const missingEmployeeNiss = items.filter((item) => !String(item.social_security_number || "").trim()).length;
    const missingFiscalVersion = items.filter((item) => !String(item.fiscal_profile_version || "").trim()).length;
    const inconsistentRows = items.filter((item) => (item.consistency_issues || []).length > 0).length;
    const submissionMode = items.length > 150 ? "upload" : "manual";
    const submission =
      options.includeSubmission === false
        ? buildDefaultAgtMonthlySubmission(monthRef)
        : typeof this.getAgtMonthlySubmission === "function"
          ? this.getAgtMonthlySubmission(monthRef)
          : buildDefaultAgtMonthlySubmission(monthRef);

    if (!String(company.nif || "").trim()) {
      blockingIssues.push("NIF da empresa em falta no perfil da entidade.");
    }
    if (missingEmployeeNif) {
      blockingIssues.push(`Existem ${missingEmployeeNif} trabalhador(es) sem NIF.`);
    }
    if (missingEmployeeBi) {
      blockingIssues.push(`Existem ${missingEmployeeBi} trabalhador(es) sem BI.`);
    }
    if (missingEmployeeNiss) {
      blockingIssues.push(`Existem ${missingEmployeeNiss} trabalhador(es) sem NISS.`);
    }
    if (missingFiscalVersion) {
      blockingIssues.push(`Existem ${missingFiscalVersion} registo(s) de folha sem versao fiscal gravada.`);
    }
    if (inconsistentRows) {
      blockingIssues.push(`Existem ${inconsistentRows} linha(s) com inconsistencias entre folha, INSS e IRT.`);
    }
    if (items.length <= 3) {
      warnings.push("Confirme no Portal do Contribuinte se a submissao do mapa e obrigatoria para o volume atual de trabalhadores.");
    }
    if (submission.status === "submitted" && !submission.proof_reference && !submission.proof_path) {
      warnings.push("O periodo foi marcado como submetido, mas ainda nao tem comprovativo registado.");
    }

    return {
      ok: true,
      monthRef,
      company: {
        name: company.name || "",
        nif: company.nif || ""
      },
      submissionMode,
      submission,
      items,
      totals: {
        grossRemuneration: roundCurrency(items.reduce((sum, item) => sum + Number(item.gross_remuneration || 0), 0)),
        employeeInss: roundCurrency(items.reduce((sum, item) => sum + Number(item.employee_inss || 0), 0)),
        taxableBase: roundCurrency(items.reduce((sum, item) => sum + Number(item.taxable_base || 0), 0)),
        irtWithheld: roundCurrency(items.reduce((sum, item) => sum + Number(item.irt_withheld || 0), 0))
      },
      validation: {
        ready: blockingIssues.length === 0,
        blockingIssues,
        warnings,
        missingEmployeeNif,
        missingEmployeeBi,
        missingEmployeeNiss,
        missingFiscalVersion,
        inconsistentRows
      }
    };
  }

  exportAttendanceExcel(filters, reportType = "presencas") {
    const normalizedFilters = normalizeReportFilters(filters);
    const data = this.buildAttendanceReportData(normalizedFilters, reportType);
    if (!data.rows.length) {
      return {
        ok: false,
        message:
          data.reportType === "faltas"
            ? "Não existem registos de faltas para este período."
            : "Não existem registos de presenças para este período."
      };
    }

    const title =
      data.reportType === "faltas"
        ? `Relatório de faltas ${data.periodLabel || normalizedFilters.periodLabel}`
        : `Relatório de presenças ${data.periodLabel || normalizedFilters.periodLabel}`;
    const content = buildExcelTableDocument(
      title,
      [
        "Nº",
        "Nome do funcionário",
        "Cargo",
        "Departamento",
        "Data",
        "Estado",
        "Horas trabalhadas",
        "Minutos de atraso",
        "Observações"
      ],
      data.rows.map((row) => [
        row.index,
        row.full_name,
        row.job_title,
        row.department,
        row.attendance_date,
        row.status_label,
        row.hours_worked.toFixed(2),
        row.delay_minutes.toFixed(2),
        row.notes
      ])
    );

    const fileName =
      data.reportType === "faltas"
        ? `relatorio-faltas-${normalizedFilters.periodFileLabel}.xls`
        : `relatorio-presencas-${normalizedFilters.periodFileLabel}.xls`;
    const target = path.join(this.excelExportsDir, fileName);
    fs.writeFileSync(target, content, "utf8");
    return { ok: true, path: target, count: data.rows.length, format: "xls" };
  }

  exportAgtMonthlyRemunerationExcel(filters) {
    const normalizedFilters = normalizeReportFilters(filters);
    const exactMonthRef = normalizedFilters.monthRef || (
      normalizedFilters.startMonthRef &&
      normalizedFilters.startMonthRef === normalizedFilters.endMonthRef
        ? normalizedFilters.startMonthRef
        : ""
    );
    const monthRef = exactMonthRef || normalizedFilters.startMonthRef || normalizedFilters.endMonthRef;
    const data = this.buildAgtMonthlyRemunerationMap(monthRef);
    if (!data?.ok) {
      return data;
    }

    const filteredItems = data.items.filter((row) => !normalizedFilters.employeeId || String(row.employee_id) === normalizedFilters.employeeId);
    if (!filteredItems.length) {
      return { ok: false, message: "Não existem registos AGT para o período e funcionário selecionados." };
    }

    const content = buildExcelTableDocument(
      `Mapa Mensal de Remuneracoes AGT ${normalizedFilters.periodLabel}`,
      [
        "Nº",
        "Nome do trabalhador",
        "NIF",
        "BI",
        "Departamento",
        "Cargo",
        "Remuneracao considerada",
        "Base IRT antes INSS",
        "INSS trabalhador",
        "Materia colectavel",
        "IRT retido",
        "Perfil fiscal",
        "Versao fiscal",
        "Validacao"
      ],
      filteredItems.map((row) => ([
        row.index,
        row.full_name,
        row.nif,
        row.bi,
        row.department,
        row.job_title,
        row.gross_remuneration.toFixed(2),
        row.irt_base_before_inss.toFixed(2),
        row.employee_inss.toFixed(2),
        row.taxable_base.toFixed(2),
        row.irt_withheld.toFixed(2),
        row.fiscal_profile_name,
        row.fiscal_profile_version,
        row.issues.join(" | ")
      ]))
    );

    const target = path.join(this.excelExportsDir, `agt-mapa-mensal-remuneracoes-${normalizedFilters.periodFileLabel}.xls`);
    fs.writeFileSync(target, content, "utf8");
    const currentSubmission =
      exactMonthRef && typeof this.getAgtMonthlySubmission === "function" ? this.getAgtMonthlySubmission(exactMonthRef) : null;
    if (exactMonthRef && typeof this.upsertAgtMonthlySubmissionRecord === "function") {
      this.upsertAgtMonthlySubmissionRecord({
        month_ref: exactMonthRef,
        status:
          currentSubmission && !["draft", "ready"].includes(currentSubmission.status)
            ? currentSubmission.status
            : data.validation.ready
              ? "ready"
              : "draft",
        submission_mode: data.submissionMode,
        proof_reference: currentSubmission?.proof_reference || "",
        proof_path: currentSubmission?.proof_path || "",
        notes: currentSubmission?.notes || "",
        exported_at: nowIso(),
        submitted_at: currentSubmission?.submitted_at || null,
        submitted_by_user_id: currentSubmission?.submitted_by_user_id || null,
        validation: data.validation
      });
    }
    return {
      ok: true,
      path: target,
      count: filteredItems.length,
      format: "xls",
      validation: data.validation,
      submission: exactMonthRef && typeof this.getAgtMonthlySubmission === "function" ? this.getAgtMonthlySubmission(exactMonthRef) : null
    };
  }

  exportStatePaymentsExcel(filters) {
    const normalizedFilters = normalizeReportFilters(filters);
    const rows = this.listPayrollRuns(normalizedFilters);
    if (!rows.length) {
      return { ok: false, message: "Não existem valores legais processados para este período." };
    }

    const content = buildExcelTableDocument(
      `Pagamento ao Estado ${normalizedFilters.periodLabel}`,
      [
        "Nome do funcionário",
        "Cargo",
        "Departamento",
        "INSS do funcionário",
        "INSS empresa",
        "IRT",
        "Total legal"
      ],
      rows.map((row) => {
        const employerInss = Number(row.summary_json?.employerInssAmount || 0);
        const employeeInss = Number(row.inss_amount || 0);
        const irt = Number(row.irt_amount || 0);
        return [
          row.full_name,
          row.job_title || "",
          row.department || "",
          employeeInss.toFixed(2),
          employerInss.toFixed(2),
          irt.toFixed(2),
          (employeeInss + employerInss + irt).toFixed(2)
        ];
      })
    );

    const target = path.join(this.excelExportsDir, `pagamento-estado-${normalizedFilters.periodFileLabel}.xls`);
    fs.writeFileSync(target, content, "utf8");
    return { ok: true, path: target, count: rows.length, format: "xls" };
  }

  deletePayrollRun(payrollRunId) {
    const current = this.db.prepare("SELECT id, month_ref FROM payroll_runs WHERE id = ?").get(payrollRunId);
    if (!current) {
      return { ok: false, message: "Pagamento processado não encontrado." };
    }

    const periodState = this.ensurePeriodOpen(current.month_ref);
    if (!periodState.ok) {
      return periodState;
    }

    this.db.prepare("DELETE FROM payroll_runs WHERE id = ?").run(payrollRunId);
    return { ok: true, payrollRuns: this.listPayrollRuns() };
  }

  clearPayrollRunsByMonth(monthRef) {
    return this.db.prepare("DELETE FROM payroll_runs WHERE month_ref = ?").run(monthRef);
  }

  prunePayrollRunsByMonth(monthRef, employeeIds = []) {
    const normalizedEmployeeIds = Array.from(
      new Set(
        (Array.isArray(employeeIds) ? employeeIds : [])
          .map((employeeId) => Number(employeeId))
          .filter((employeeId) => Number.isFinite(employeeId) && employeeId > 0)
      )
    );

    if (!normalizedEmployeeIds.length) {
      return this.clearPayrollRunsByMonth(monthRef);
    }

    const placeholders = normalizedEmployeeIds.map(() => "?").join(", ");
    return this.db
      .prepare(`DELETE FROM payroll_runs WHERE month_ref = ? AND employee_id NOT IN (${placeholders})`)
      .run(monthRef, ...normalizedEmployeeIds);
  }

  deletePayrollRunsByMonth(monthRef) {
    const periodState = this.ensurePeriodOpen(monthRef);
    if (!periodState.ok) {
      return periodState;
    }

    const result = this.clearPayrollRunsByMonth(monthRef);
    if (!result.changes) {
      return { ok: false, message: "Não existem pagamentos processados para este mês." };
    }
    return { ok: true, payrollRuns: this.listPayrollRuns() };
  }

  getPayrollRun(payrollRunId) {
    const row = this.db.prepare(`
      SELECT payroll_runs.*, employees.*
      FROM payroll_runs
      INNER JOIN employees ON employees.id = payroll_runs.employee_id
      WHERE payroll_runs.id = ?
    `).get(payrollRunId);
    return row
      ? {
          ...row,
          summary_json: JSON.parse(row.summary_json),
          recurring_allowances: JSON.parse(row.recurring_allowances ?? "[]"),
          recurring_bonuses: JSON.parse(row.recurring_bonuses ?? "[]"),
          special_payments: JSON.parse(row.special_payments ?? "[]")
        }
      : null;
  }

  exportBankPayrollCsv(bank, filters) {
    const normalizedFilters = normalizeReportFilters(filters);
    const company = this.getCompanyProfile();
    const bankCode = String(bank?.code || "GENERICO").trim().toUpperCase();
    const bankName = String(bank?.name || "Banco").trim();
    const payrollRows =
      typeof this.listPayrollRuns === "function"
        ? this.listPayrollRuns(normalizedFilters)
        : this.db.prepare(`
            SELECT
              payroll_runs.month_ref,
              payroll_runs.net_salary,
              payroll_runs.generated_at,
              payroll_runs.employee_id,
              employees.full_name,
              employees.iban,
              employees.nif,
              employees.bi,
              employees.department,
              employees.job_title,
              employees.contract_type
            FROM payroll_runs
            INNER JOIN employees ON employees.id = payroll_runs.employee_id
            WHERE payroll_runs.month_ref >= ? AND payroll_runs.month_ref <= ?
            ORDER BY employees.full_name ASC
          `).all(normalizedFilters.startMonthRef || normalizedFilters.monthRef, normalizedFilters.endMonthRef || normalizedFilters.monthRef);
    const rows = payrollRows
      .filter((row) => !normalizedFilters.employeeId || String(row.employee_id) === String(normalizedFilters.employeeId))
      .map((row) => ({
      month_ref: row.month_ref,
      net_salary: row.net_salary,
      generated_at: row.generated_at,
      full_name: row.full_name,
      iban: row.iban,
      nif: row.nif,
      bi: row.bi,
      department: row.department,
      job_title: row.job_title,
      contract_type: row.contract_type
    }));

    if (!rows.length) {
      return { ok: false, message: "Não existem salários processados para este período." };
    }

    const invalidRows = rows.filter((row) => !String(row.iban || "").trim());
    if (invalidRows.length) {
      return {
        ok: false,
        message: `Existem funcionários sem IBAN: ${invalidRows.map((row) => row.full_name).join(", ")}.`
      };
    }

    const headers = [
      "Empresa",
      "NIF Empresa",
      "Período",
      "Nome do Beneficiário",
      "IBAN",
      "Valor Líquido",
      "Moeda",
      "Banco de Destino",
      "Referência",
      "Categoria",
      "Departamento",
      "NIF do Beneficiário",
      "BI do Beneficiário"
    ];

    const csvRows = rows.map((row, index) => ([
      company.name || "",
      company.nif || "",
      row.month_ref,
      row.full_name,
      row.iban,
      Number(row.net_salary || 0).toFixed(2),
      "AOA",
      bankName,
      `SALÁRIO ${row.month_ref} ${String(index + 1).padStart(3, "0")}`,
      row.contract_type || row.job_title || "",
      row.department || "",
      row.nif || "",
      row.bi || ""
    ]));

    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
    const content = [headers, ...csvRows].map((row) => row.map(escapeCsv).join(";")).join("\r\n");
    const targetDir = path.join(this.bankExportsDir, bankCode);
    fs.mkdirSync(targetDir, { recursive: true });
    const fileName = `${bankCode.toLowerCase()}-salarios-${normalizedFilters.periodFileLabel}.csv`;
    const output = path.join(targetDir, fileName);
    fs.writeFileSync(output, `\uFEFF${content}`, "utf8");

    return { ok: true, path: output, fileName, count: rows.length, bank: bankName };
  }

  exportBankPayrollFile(bank, filters, format = "ps2") {
    const normalizedFilters = normalizeReportFilters(filters);
    const company = this.getCompanyProfile();
    const selectedBankCode = String(bank?.code || "").trim().toUpperCase();
    const companyOriginBankCode = String(company.origin_bank_code || "").trim().toUpperCase();
    const bankCode = companyOriginBankCode || selectedBankCode || "GENERICO";
    const bankName = String(bank?.name || bankCode || "Banco").trim();
    const normalizedFormat = String(format || "ps2").trim().toLowerCase();
    const payrollRows =
      typeof this.listPayrollRuns === "function"
        ? this.listPayrollRuns(normalizedFilters)
        : this.db.prepare(`
            SELECT
              payroll_runs.month_ref,
              payroll_runs.net_salary,
              payroll_runs.employee_id,
              employees.full_name,
              employees.bank_code,
              employees.bank_account,
              employees.iban
            FROM payroll_runs
            INNER JOIN employees ON employees.id = payroll_runs.employee_id
            WHERE payroll_runs.month_ref >= ? AND payroll_runs.month_ref <= ?
            ORDER BY employees.full_name ASC
          `).all(normalizedFilters.startMonthRef || normalizedFilters.monthRef, normalizedFilters.endMonthRef || normalizedFilters.monthRef);
    const rows = payrollRows
      .filter((row) => !normalizedFilters.employeeId || String(row.employee_id) === String(normalizedFilters.employeeId))
      .map((row) => ({
      month_ref: row.month_ref,
      net_salary: row.net_salary,
      full_name: row.full_name,
      bank_code: row.bank_code,
      bank_account: row.bank_account,
      iban: row.iban
    }));

    if (!rows.length) {
      return { ok: false, message: "Não existem salários processados para este período." };
    }

    const originAccount = normalizeBankAccount(company.origin_account);
    if (!bankCode || !originAccount) {
      return {
        ok: false,
        message: "Indique o banco e a conta de origem da empresa nas configurações para gerar ficheiros PS2/PSX."
      };
    }

    const enrichedRows = rows.map((row) => ({
      ...row,
      destinationBankCode: String(row.bank_code || "").trim().toUpperCase(),
      destinationAccount: resolveDomesticAccountNumber(row)
    }));

    const missingBankData = enrichedRows.filter((row) => !row.destinationBankCode || !row.destinationAccount);
    if (missingBankData.length) {
      return {
        ok: false,
        message: `Existem funcionários sem banco ou conta bancária válida: ${missingBankData.map((row) => row.full_name).join(", ")}.`
      };
    }

    const exportRows =
      normalizedFormat === "ps2"
        ? enrichedRows.filter((row) => row.destinationBankCode === bankCode)
        : enrichedRows.filter((row) => row.destinationBankCode !== bankCode);

    if (!exportRows.length) {
      return {
        ok: false,
        message:
          normalizedFormat === "ps2"
            ? `Não existem pagamentos internos para ${bankName} no período ${normalizedFilters.periodLabel}.`
            : `Não existem pagamentos interbancários para exportar no período ${normalizedFilters.periodLabel}.`
      };
    }

    const content = exportRows
      .map((row) => {
        const amount = String(Math.round(Number(row.net_salary || 0)));
        const name = String(row.full_name || "").trim().toUpperCase();
        if (normalizedFormat === "ps2") {
          return ["PS2", originAccount, row.destinationAccount, amount, name, "AOA"].join(";");
        }
        return [
          "PSX",
          originAccount,
          resolveBankExportCode(row.destinationBankCode),
          row.destinationAccount,
          amount,
          name,
          "AOA"
        ].join(";");
      })
      .join("\r\n");

    const targetDir = path.join(this.bankExportsDir, bankCode);
    fs.mkdirSync(targetDir, { recursive: true });
    const fileName = `${bankCode.toLowerCase()}-salarios-${normalizedFormat}-${normalizedFilters.periodFileLabel}.txt`;
    const output = path.join(targetDir, fileName);
    fs.writeFileSync(output, content, "utf8");

    return { ok: true, path: output, fileName, count: exportRows.length, bank: bankName, format: normalizedFormat };
  }

  createBackup(label = "backup") {
    if (this.db?.open) {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    }
    const snapshot = this.syncEncryptedDatabaseSnapshot();
    const safeLabel = String(label || "backup").replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
    const usesSqlCipherEngine = snapshot?.engine === "sqlcipher";
    const fileName = `kwanza-folha-${safeLabel}-${new Date().toISOString().replace(/[:.]/g, "-")}${usesSqlCipherEngine ? ".sqlite" : ".sqlite.enc"}`;
    const target = path.join(this.backupDir, fileName);
    if (usesSqlCipherEngine) {
      fs.copyFileSync(this.dbPath, target);
      if (typeof this.applyRuntimeFileProtection === "function") {
        this.applyRuntimeFileProtection(target);
      }
    } else {
      this.writeEncryptedFileFromSource(this.dbPath, target, BACKUP_ENCRYPTION_PURPOSE);
    }
    return { ok: true, path: target, encrypted: true };
  }

  restoreBackup(backupPath) {
    const resolvedBackupPath = path.resolve(String(backupPath || ""));
    const resolvedBackupDir = path.resolve(this.backupDir);

    if (!resolvedBackupPath.startsWith(`${resolvedBackupDir}${path.sep}`)) {
      return { ok: false, message: "O ficheiro de backup selecionado não pertence a pasta oficial de backups." };
    }

    if (!fs.existsSync(resolvedBackupPath)) {
      return { ok: false, message: "O ficheiro de backup selecionado já não existe." };
    }

    const safetyBackup = this.createBackup("pre-restore");
    this.closeConnection();
    this.cleanupRuntimeDatabaseArtifacts();
    safeUnlink(this.encryptedDbPath);

    if (this.isEncryptedDataFile(resolvedBackupPath, BACKUP_ENCRYPTION_PURPOSE)) {
      const envelope = parseEncryptedEnvelope(fs.readFileSync(resolvedBackupPath, "utf8"));
      if (envelope) {
        this.restoreEncryptedFileToTarget(resolvedBackupPath, this.dbPath, BACKUP_ENCRYPTION_PURPOSE);
      } else {
        fs.copyFileSync(resolvedBackupPath, this.dbPath);
      }
    } else {
      fs.copyFileSync(resolvedBackupPath, this.dbPath);
    }

    this.openConnection();
    this.setupSchema();
    this.seedDefaults();
    this.syncEncryptedDatabaseSnapshot();

    return {
      ok: true,
      restoredFrom: resolvedBackupPath,
      safetyBackupPath: safetyBackup.path,
      backups: this.listBackups()
    };
  }
}

module.exports = {
  DatabaseService,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  parseAttendanceImportContent
};



