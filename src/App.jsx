import { useEffect, useMemo, useState } from "react";
import AppShell from "./app-shell/AppShell";
import { pageMeta } from "./app-shell/pageMeta";
import LicenseScreen from "./components/LicenseScreen";
import LoginScreen from "./components/LoginScreen";
import AuditSection from "./components/sections/AuditSection";
import DashboardSection from "./components/sections/DashboardSection";
import EmployeesSection from "./components/sections/EmployeesSection";
import EventsSection from "./components/sections/EventsSection";
import HistorySection from "./components/sections/HistorySection";
import ProcessingSection from "./components/sections/ProcessingSection";
import SettingsSection from "./components/sections/SettingsSection";
import UserSection from "./components/sections/UserSection";
import ReportsSection from "./features/reports/ReportsSection";
import StatePaymentsSection from "./features/state-payments/StatePaymentsSection";
import { contextualizeFeedback, getFeedbackTone } from "./features/feedback/messages";
import { buildLicenseBannerState } from "./features/licensing/banner";
import { buildAgtMonthlyRemunerationMapFromBoot } from "./features/state-payments/buildAgtMonthlyRemunerationMap";
import { roundAmount } from "./shared/utils/number";
import {
  normalizeMonthDate,
  buildMonthDateRange,
  buildInitialReportFilters,
  buildFilterState,
  applyReportPreset,
  buildReportRequestFilters,
  matchesMonthRange,
  matchesDateRange
} from "./shared/utils/reportFilters";
import {
  angolaBanks,
  formatMoney,
  initialAttendanceImport,
  initialAttendanceRecord,
  initialCompany,
  initialEmployeeDocument,
  initialEmployee,
  initialEvent,
  initialFinancialObligation,
  initialForgotPasswordForm,
  initialLicenseActivationForm,
  initialLicensePurchaseForm,
  initialLeaveRequest,
  initialVacationBalance,
  initialVacationRequest,
  initialSalaryScale,
  initialWorkShift,
  initialPasswordForm,
  initialRegistrationForm,
  initialResetPasswordForm,
  initialSettings,
  initialUserForm,
  parseCommaList,
  todayMonth
} from "./utils/payroll";

function buildAgtSubmissionForm(monthRef, submission = {}) {
  return {
    month_ref: monthRef,
    status: submission?.status || "draft",
    submission_mode: submission?.submission_mode || "manual",
    proof_reference: submission?.proof_reference || "",
    proof_path: submission?.proof_path || "",
    notes: submission?.notes || ""
  };
}

function buildDocumentAlertDescription(rows = [], variant = "expiring") {
  const firstRow = rows[0];
  if (!firstRow) {
    return variant === "expired"
      ? "Existem documentos laborais expirados que precisam de renovação imediata."
      : "Existem documentos laborais a expirar que exigem acompanhamento.";
  }

  const ownerLabel = firstRow.full_name || "um trabalhador";
  if (rows.length === 1) {
    return variant === "expired"
      ? `${firstRow.title} de ${ownerLabel} já expirou e deve ser renovado com prioridade.`
      : `${firstRow.title} de ${ownerLabel} está prestes a expirar e deve ser acompanhado.`;
  }

  const remaining = rows.length - 1;
  return variant === "expired"
    ? `${firstRow.title} de ${ownerLabel} e mais ${remaining} documento(s) já expiraram e exigem renovação.`
    : `${firstRow.title} de ${ownerLabel} e mais ${remaining} documento(s) estão a expirar e exigem acompanhamento.`;
}

function isStartupDegradedLicensingMessage(message) {
  return /servi(c|ç)os principais ainda n[aã]o ficaram dispon|modulo local de ativa(c|ç)[aã]o ainda n[aã]o iniciou|activation_pending_services/i.test(
    String(message || "")
  );
}

function isActivationPendingResult(result) {
  return Boolean(
    result?.licenseStored ||
      ["activation_pending_services", "activation_blocked_by_integrity", "activation_services_unavailable"].includes(
        String(result?.status || "")
      )
  );
}

function getActivationPendingFeedback(result) {
  if (result?.message) {
    return result.message;
  }
  return "Licença recebida com sucesso. Reinicie o aplicativo para concluir a ativação.";
}

function normalizeBootstrapData(data = {}) {
  const settings = data?.settings || {};
  return {
    company: data?.company || initialCompany,
    settings: {
      ...initialSettings,
      ...settings,
      allowanceTypes: Array.isArray(settings.allowanceTypes) ? settings.allowanceTypes : initialSettings.allowanceTypes,
      bonusTypes: Array.isArray(settings.bonusTypes) ? settings.bonusTypes : initialSettings.bonusTypes,
      irtBrackets: Array.isArray(settings.irtBrackets) ? settings.irtBrackets : initialSettings.irtBrackets,
      fiscalProfiles: Array.isArray(settings.fiscalProfiles) ? settings.fiscalProfiles : []
    },
    employees: Array.isArray(data?.employees) ? data.employees : [],
    workShifts: Array.isArray(data?.workShifts) ? data.workShifts : [],
    attendanceRecords: Array.isArray(data?.attendanceRecords) ? data.attendanceRecords : [],
    attendanceImports: Array.isArray(data?.attendanceImports) ? data.attendanceImports : [],
    attendanceImportLogs: Array.isArray(data?.attendanceImportLogs) ? data.attendanceImportLogs : [],
    attendancePeriods: Array.isArray(data?.attendancePeriods) ? data.attendancePeriods : [],
    leaveRequests: Array.isArray(data?.leaveRequests) ? data.leaveRequests : [],
    vacationBalances: Array.isArray(data?.vacationBalances) ? data.vacationBalances : [],
    vacationRequests: Array.isArray(data?.vacationRequests) ? data.vacationRequests : [],
    financialObligations: Array.isArray(data?.financialObligations) ? data.financialObligations : [],
    salaryScales: Array.isArray(data?.salaryScales) ? data.salaryScales : [],
    payrollRuns: Array.isArray(data?.payrollRuns) ? data.payrollRuns : [],
    payrollPeriods: Array.isArray(data?.payrollPeriods) ? data.payrollPeriods : [],
    payrollFiscalStatuses: Array.isArray(data?.payrollFiscalStatuses) ? data.payrollFiscalStatuses : [],
    documentAlerts: Array.isArray(data?.documentAlerts) ? data.documentAlerts : [],
    agtMonthlySubmissions: Array.isArray(data?.agtMonthlySubmissions) ? data.agtMonthlySubmissions : [],
    users: Array.isArray(data?.users) ? data.users : [],
    auditLogs: Array.isArray(data?.auditLogs) ? data.auditLogs : [],
    backups: Array.isArray(data?.backups) ? data.backups : [],
    needsSetup: Boolean(data?.needsSetup),
    runtime: data?.runtime || { payrollRuleEditingLocked: false }
  };
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [licenseState, setLicenseState] = useState({
    status: "missing",
    canUseApp: false,
    message: "Ative o Kwanza Folha para continuar."
  });
  const [licensePlans, setLicensePlans] = useState([]);
  const [licenseMode, setLicenseMode] = useState("activate");
  const [licenseActivationForm, setLicenseActivationForm] = useState(initialLicenseActivationForm);
  const [licensePurchaseForm, setLicensePurchaseForm] = useState(initialLicensePurchaseForm);
  const [licenseApiState, setLicenseApiState] = useState({ ok: true, candidate: "", resolved: "", source: "default", message: "" });
  const [licenseApiUrlForm, setLicenseApiUrlForm] = useState("");
  const [licensePaymentState, setLicensePaymentState] = useState({
    reference: "",
    amount: 0,
    validUntil: "",
    planName: "",
    serialKey: "",
    paymentInstructions: null
  });
  const [licenseCenterOpen, setLicenseCenterOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [licenseClock, setLicenseClock] = useState(() => Date.now());
  const [theme, setTheme] = useState(() => window.localStorage.getItem("kwanza-theme") || "dark");
  const [selectedBankCode, setSelectedBankCode] = useState("ATLANTICO");
  const [tab, setTab] = useState("dashboard");
  const [historyActiveTab, setHistoryActiveTab] = useState("eventos");
  const [monthRef, setMonthRef] = useState(todayMonth());
  const [feedback, setFeedback] = useState("");
  const [accessState, setAccessState] = useState({ setupRequired: false, canRegister: false, company: null });
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [forgotPasswordForm, setForgotPasswordForm] = useState(initialForgotPasswordForm);
  const [registrationForm, setRegistrationForm] = useState(initialRegistrationForm);
  const [employeeForm, setEmployeeForm] = useState(initialEmployee);
  const [attendanceForm, setAttendanceForm] = useState(initialAttendanceRecord);
  const [attendanceImportForm, setAttendanceImportForm] = useState(initialAttendanceImport);
  const [eventForm, setEventForm] = useState(initialEvent);
  const [financialForm, setFinancialForm] = useState(initialFinancialObligation);
  const [employeeDocumentForm, setEmployeeDocumentForm] = useState(initialEmployeeDocument);
  const [leaveForm, setLeaveForm] = useState(initialLeaveRequest);
  const [vacationBalanceForm, setVacationBalanceForm] = useState(initialVacationBalance);
  const [vacationForm, setVacationForm] = useState(initialVacationRequest);
  const [companyForm, setCompanyForm] = useState(initialCompany);
  const [settingsForm, setSettingsForm] = useState(initialSettings);
  const [runtimeFlags, setRuntimeFlags] = useState({ payrollRuleEditingLocked: false });
  const [salaryScaleForm, setSalaryScaleForm] = useState(initialSalaryScale);
  const [workShiftForm, setWorkShiftForm] = useState(initialWorkShift);
  const [userForm, setUserForm] = useState(initialUserForm);
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm);
  const [resetPasswordForm, setResetPasswordForm] = useState(initialResetPasswordForm);
  const [events, setEvents] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceImports, setAttendanceImports] = useState([]);
  const [attendanceImportLogs, setAttendanceImportLogs] = useState([]);
  const [financialObligations, setFinancialObligations] = useState([]);
  const [employeeDocuments, setEmployeeDocuments] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [vacationBalances, setVacationBalances] = useState([]);
  const [vacationRequests, setVacationRequests] = useState([]);
  const [auditFilters, setAuditFilters] = useState({ userName: "", action: "", monthRef: "", startDate: "", endDate: "", search: "" });
  const [employeeFilters, setEmployeeFilters] = useState({ search: "", status: "todos", department: "" });
  const [attendanceFilters, setAttendanceFilters] = useState({ search: "", status: "todos", monthRef: todayMonth() });
  const [eventFilters, setEventFilters] = useState({ search: "", type: "todos" });
  const [documentFilters, setDocumentFilters] = useState({ search: "", status: "todos", category: "todos" });
  const [leaveFilters, setLeaveFilters] = useState({ search: "", type: "todos", status: "todos" });
  const [vacationFilters, setVacationFilters] = useState({ search: "", status: "todos", yearRef: String(new Date().getFullYear()) });
  const [processingFilters, setProcessingFilters] = useState({ search: "" });
  const [historyFilters, setHistoryFilters] = useState(() => buildFilterState(todayMonth()));
  const [stateFilters, setStateFilters] = useState(() => buildFilterState(todayMonth(), { search: "" }));
  const [reportFilters, setReportFilters] = useState(() => buildInitialReportFilters(todayMonth()));
  const [reprocessPreviewState, setReprocessPreviewState] = useState({ loading: false, monthRef: "", data: null });
  const [agtSubmissionForm, setAgtSubmissionForm] = useState(() => buildAgtSubmissionForm(todayMonth()));
  const [updateState, setUpdateState] = useState({
    checking: false,
    downloading: false,
    installing: false,
    currentVersion: "",
    latestVersion: "",
    releaseName: "",
    available: false,
    downloaded: false,
    path: "",
    publishedAt: "",
    message: ""
  });
  const [autoUpdateChecked, setAutoUpdateChecked] = useState(false);
  const isAdmin = user?.role === "admin";
  const reportRequestFilters = useMemo(() => buildReportRequestFilters(reportFilters, monthRef), [reportFilters, monthRef]);
  const historyRequestFilters = useMemo(() => buildReportRequestFilters(historyFilters, monthRef), [historyFilters, monthRef]);
  const stateRequestFilters = useMemo(() => buildReportRequestFilters(stateFilters, monthRef), [stateFilters, monthRef]);
  const selectedStateMonthRef = stateRequestFilters.monthRef || "";

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    window.payrollAPI
      .getAppVersion()
      .then((result) => {
        setUpdateState((current) => ({
          ...current,
          currentVersion: result?.version || current.currentVersion
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("kwanza-theme", theme);
  }, [theme]);

  useEffect(() => {
    const submission =
      selectedStateMonthRef
        ? boot?.agtMonthlySubmissions?.find((item) => item.month_ref === selectedStateMonthRef) || null
        : null;
    setAgtSubmissionForm(buildAgtSubmissionForm(selectedStateMonthRef || monthRef, submission));
  }, [boot, monthRef, selectedStateMonthRef]);

  useEffect(() => {
    if (reportFilters.preset !== "month") {
      return;
    }
    setReportFilters((current) => ({
      ...current,
      ...buildMonthDateRange(monthRef)
    }));
  }, [monthRef, reportFilters.preset]);

  useEffect(() => {
    if (historyFilters.preset !== "month") {
      return;
    }
    setHistoryFilters((current) => ({
      ...current,
      ...buildMonthDateRange(monthRef)
    }));
  }, [monthRef, historyFilters.preset]);

  useEffect(() => {
    if (stateFilters.preset !== "month") {
      return;
    }
    setStateFilters((current) => ({
      ...current,
      ...buildMonthDateRange(monthRef)
    }));
  }, [monthRef, stateFilters.preset]);

  useEffect(() => {
    if (!boot || !user || user.role !== "admin") {
      setReprocessPreviewState({ loading: false, monthRef, data: null });
      return;
    }

    const selectedStatus = boot.payrollFiscalStatuses?.find((status) => status.month_ref === monthRef) || null;
    if (!selectedStatus?.runCount) {
      setReprocessPreviewState({ loading: false, monthRef, data: null });
      return;
    }

    loadReprocessPreview(monthRef).catch(() => {
      setReprocessPreviewState({ loading: false, monthRef, data: null });
    });
  }, [boot, monthRef, user]);

  useEffect(() => {
    if (!user) return;
    if (!isAdmin && ["utilizador", "configuracoes", "auditoria"].includes(tab)) {
      setTab("dashboard");
    }
  }, [isAdmin, tab, user]);

  useEffect(() => {
    const handleNumberInputWheel = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "number") {
        return;
      }
      if (document.activeElement !== target) {
        return;
      }
      event.preventDefault();
      target.blur();
    };

    window.addEventListener("wheel", handleNumberInputWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", handleNumberInputWheel, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!user || autoUpdateChecked) return;
    checkForUpdates(true).finally(() => setAutoUpdateChecked(true));
  }, [user, autoUpdateChecked]);

  useEffect(() => {
    if (!user) return undefined;

    const timer = window.setInterval(async () => {
      const status = await window.payrollAPI.getLicenseStatus();
      setLicenseState(status || {});
      if (status && !status.canUseApp) {
        setUser(null);
        setBoot(null);
        setFeedback(status.message || "A licença do Kwanza Folha deixou de ser válida.");
      }
    }, 60000);

    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (!user || !["trial_active", "active"].includes(String(licenseState?.status || ""))) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setLicenseClock(Date.now());
    }, 60000);

    return () => window.clearInterval(timer);
  }, [user, licenseState?.status]);

  useEffect(() => {
    if (
      licenseMode !== "payment" ||
      !licensePaymentState.reference ||
      (user && !licenseCenterOpen)
    ) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      const result = await window.payrollAPI.checkLicensePayment({ reference: licensePaymentState.reference });
      if (result?.ok && result.status === "paid") {
        await handleCheckLicensePayment();
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [licenseMode, licensePaymentState.reference, user, licenseCenterOpen]);

  useEffect(() => {
    const employeeId = String(vacationForm.employee_id || leaveForm.employee_id || eventForm.employee_id || "");
    if (!user || !employeeId) return;

    window.payrollAPI
      .listVacationBalances({ employeeId, yearRef: vacationFilters.yearRef })
      .then((result) => {
        setVacationBalances(result?.items || []);
        const item = result?.items?.[0];
        if (item) {
          setVacationBalanceForm((current) => ({
            ...current,
            id: item.id ?? null,
            employee_id: String(employeeId),
            year_ref: vacationFilters.yearRef,
            entitled_days: item.entitled_days,
            carried_days: item.carried_days,
            manual_adjustment: item.manual_adjustment,
            notes: item.notes || ""
          }));
        } else {
          setVacationBalanceForm((current) => ({
            ...initialVacationBalance,
            employee_id: String(employeeId),
            year_ref: vacationFilters.yearRef
          }));
        }
      })
      .catch(() => {});

    window.payrollAPI
      .listVacationRequests({ employeeId, yearRef: vacationFilters.yearRef })
      .then((result) => setVacationRequests(result?.items || []))
      .catch(() => {});

    setVacationForm((current) => ({
      ...current,
      employee_id: String(employeeId),
      year_ref: vacationFilters.yearRef
    }));
  }, [vacationFilters.yearRef, user]);

  useEffect(() => {
    const employeeId = String(attendanceForm.employee_id || eventForm.employee_id || "");
    if (!user || !employeeId) return;

    window.payrollAPI
      .listAttendanceRecords({ employeeId, monthRef: attendanceFilters.monthRef })
      .then((result) => setAttendanceRecords(result?.items || []))
      .catch(() => {});
  }, [attendanceFilters.monthRef, user]);

  useEffect(() => {
    const employeeId = Number(
      financialForm.employee_id ||
      attendanceForm.employee_id ||
      eventForm.employee_id ||
      leaveForm.employee_id ||
      vacationForm.employee_id ||
      0
    );
    if (!user || !employeeId) return;

    window.payrollAPI
      .listFinancialObligations({ employeeId, monthRef })
      .then((result) => setFinancialObligations(result?.items || []))
      .catch(() => {});
  }, [monthRef, user]);

  useEffect(() => {
    const employeeId = String(
      employeeDocumentForm.employee_id ||
      attendanceForm.employee_id ||
      eventForm.employee_id ||
      leaveForm.employee_id ||
      vacationForm.employee_id ||
      ""
    );

    if (!user || !employeeId) {
      setEmployeeDocuments([]);
      return;
    }

    window.payrollAPI
      .listEmployeeDocuments({ employeeId })
      .then((result) => setEmployeeDocuments(result?.items || []))
      .catch(() => {});
  }, [employeeDocumentForm.employee_id, attendanceForm.employee_id, eventForm.employee_id, leaveForm.employee_id, vacationForm.employee_id, user]);

  async function refreshAuthState() {
    const state = await window.payrollAPI.getAuthState();
    const normalizedState = state || { setupRequired: false, canRegister: false, company: null };
    setAccessState(normalizedState);
    setLicensePurchaseForm((current) => ({
      ...current,
      empresa: normalizedState.company?.name || current.empresa,
      nif: normalizedState.company?.nif || current.nif,
      email: normalizedState.company?.email || current.email,
      telefone: normalizedState.company?.phone || current.telefone
    }));
    setAuthMode((current) => {
      if (normalizedState.setupRequired) return "register";
      return current === "register" ? "login" : current;
    });
    setRegistrationForm((current) => ({
      ...current,
      company_name: normalizedState.company?.name || current.company_name,
      company_nif: normalizedState.company?.nif || current.company_nif,
      company_email: normalizedState.company?.email || current.company_email,
      company_phone: normalizedState.company?.phone || current.company_phone,
      company_address: normalizedState.company?.address || current.company_address
    }));
    return normalizedState;
  }

  async function refreshLicenseState() {
    const [statusResult, plansResult, apiStateResult] = await Promise.all([
      window.payrollAPI.getLicenseStatus(),
      window.payrollAPI.getLicensePlans(),
      typeof window.payrollAPI.getLicenseApiBaseUrl === "function"
        ? window.payrollAPI.getLicenseApiBaseUrl().catch(() => null)
        : Promise.resolve(null)
    ]);

    const nextStatus = statusResult || {
      status: "missing",
      canUseApp: false,
      message: "Ative o Kwanza Folha para continuar."
    };

    setLicenseState(nextStatus);
    setLicensePlans(plansResult?.plans || []);
    if (apiStateResult) {
      setLicenseApiState(apiStateResult);
      setLicenseApiUrlForm((current) => current || String(apiStateResult.candidate || apiStateResult.resolved || "").trim());
    }

    if (!nextStatus.canUseApp) {
      const suggestedMode =
        nextStatus.status === "expired" ? "renew" : nextStatus.status === "trial_expired" ? "purchase" : "activate";
      setLicenseMode((current) => (current === "payment" ? current : suggestedMode));
      setLicenseActivationForm((current) => ({
        ...current,
        email: nextStatus.email || current.email,
        serialKey: nextStatus.serialKey || current.serialKey
      }));
      setLicensePurchaseForm((current) => ({
        ...current,
        plan: plansResult?.plans?.[0]?.code || current.plan,
        empresa: nextStatus.companyName || current.empresa,
        nif: nextStatus.companyNif || current.nif,
        email: nextStatus.email || current.email,
        telefone: nextStatus.companyPhone || current.telefone,
        serial_key: nextStatus.serialKey || current.serial_key
      }));
    }

    return nextStatus;
  }

  async function initializeApp() {
    try {
      const state = await refreshAuthState();
      const license = await refreshLicenseState();
      if (!license?.canUseApp) {
        return;
      }
      if (state?.setupRequired) {
        return;
      }
      const session = await window.payrollAPI.restoreSession();
      if (!session?.ok) return;

      setUser(session.user);
      if (session.mustChangePassword) {
        setFeedback("Altere a palavra-passe inicial antes de continuar.");
        if (session.user?.role === "admin") {
          setTab("utilizador");
        }
      }
      if (!state?.setupRequired) {
        await loadBootstrap();
      }
    } catch (error) {
      console.error("Falha ao inicializar a aplicação.", error);
      setUser(null);
      setBoot(null);
      setFeedback(
        `Nao foi possivel abrir o sistema corretamente. ${error?.message || "Reinicie a aplicacao e tente novamente."}`
      );
    } finally {
      setAuthChecked(true);
    }
  }

  async function loadBootstrap() {
    const result = await window.payrollAPI.getBootstrap();
    if (!result || result.ok === false) {
      throw new Error(result?.message || "O bootstrap do sistema nao respondeu com dados validos.");
    }

    const data = normalizeBootstrapData(result);
    const resolvedFiscalProfile = data.settings?.resolvedFiscalProfile || null;
    const editableFiscalProfile =
      (data.settings?.fiscalProfiles || []).find((profile) => profile.id === resolvedFiscalProfile?.id) || resolvedFiscalProfile || null;
    setBoot(data);
    setRuntimeFlags(data.runtime || { payrollRuleEditingLocked: false });
    setAttendanceImports(data.attendanceImports || []);
    setAttendanceImportLogs(data.attendanceImportLogs || []);
    setCompanyForm(data.company || initialCompany);
    setSelectedBankCode(data.company?.origin_bank_code || "ATLANTICO");
    setSettingsForm({
      ...data.settings,
      allowanceTypes: (data.settings.allowanceTypes || []).join(", "),
      bonusTypes: (data.settings.bonusTypes || []).join(", "),
      irtBrackets: JSON.stringify(data.settings.irtBrackets || [], null, 2),
      fiscalProfiles: data.settings.fiscalProfiles || [],
      resolvedFiscalProfile,
      fiscalProfileEditingId: editableFiscalProfile?.id || "",
      fiscalProfileEffectiveFrom: editableFiscalProfile?.effectiveFrom || monthRef,
      fiscalProfileName: editableFiscalProfile?.name || "",
      fiscalProfileLegalReference: editableFiscalProfile?.legalReference || "",
      fiscalProfileNotes: editableFiscalProfile?.notes || ""
    });
    setLicensePurchaseForm((current) => ({
      ...current,
      empresa: data.company?.name || current.empresa,
      nif: data.company?.nif || current.nif,
      email: data.company?.email || current.email,
      telefone: data.company?.phone || current.telefone
    }));

    const firstEmployee = data.employees[0] || null;
    const employeeId = String(firstEmployee?.id || "");
    setAttendanceForm((current) => ({ ...current, employee_id: employeeId, shift_id: String(firstEmployee?.shift_id || "") }));
    setAttendanceImportForm((current) => ({ ...current, file_path: "" }));
    setEventForm((current) => ({ ...current, employee_id: employeeId }));
    setFinancialForm((current) => ({ ...current, employee_id: employeeId, start_month_ref: monthRef }));
    setEmployeeDocumentForm((current) => ({ ...initialEmployeeDocument, ...current, employee_id: employeeId }));
    setLeaveForm((current) => ({ ...current, employee_id: employeeId }));
    setVacationBalanceForm((current) => ({ ...current, employee_id: employeeId || current.employee_id }));
    setVacationForm((current) => ({ ...current, employee_id: employeeId || current.employee_id }));
    setResetPasswordForm((current) => ({
      ...current,
      userId: current.userId || String(data.users?.[0]?.id || "")
    }));

    if (employeeId) {
      await loadEmployeeRhData(employeeId, vacationFilters.yearRef);
    } else {
      setAttendanceRecords([]);
      setFinancialObligations([]);
      setEmployeeDocuments([]);
      setEvents([]);
      setLeaveRequests([]);
      setVacationBalances([]);
      setVacationRequests([]);
      setEmployeeDocumentForm({ ...initialEmployeeDocument, employee_id: "" });
      setFinancialForm({ ...initialFinancialObligation, start_month_ref: monthRef });
    }
  }

  async function loadReprocessPreview(targetMonthRef = monthRef) {
    if (
      !user ||
      user.role !== "admin" ||
      typeof window.payrollAPI?.previewPayrollReprocess !== "function" ||
      !boot?.payrollRuns?.some((run) => run.month_ref === targetMonthRef)
    ) {
      setReprocessPreviewState({ loading: false, monthRef: targetMonthRef, data: null });
      return;
    }

    setReprocessPreviewState((current) => ({
      ...current,
      loading: true,
      monthRef: targetMonthRef
    }));

    const result = await window.payrollAPI.previewPayrollReprocess(targetMonthRef);
    setReprocessPreviewState({
      loading: false,
      monthRef: targetMonthRef,
      data: result?.ok ? result : null
    });
  }

  async function loadEmployeeRhData(employeeId, yearRef = vacationFilters.yearRef) {
    if (!employeeId) {
      setAttendanceRecords([]);
      setFinancialObligations([]);
      setEmployeeDocuments([]);
      setEvents([]);
      setLeaveRequests([]);
      setVacationBalances([]);
      setVacationRequests([]);
      setEmployeeDocumentForm({ ...initialEmployeeDocument, employee_id: "" });
      return;
    }

    const attendanceResult = await window.payrollAPI.listAttendanceRecords({
      employeeId,
      monthRef: attendanceFilters.monthRef
    });
    const financialResult = await window.payrollAPI.listFinancialObligations({
      employeeId,
      monthRef
    });
    const documentResult = await window.payrollAPI.listEmployeeDocuments({ employeeId });
    setEvents(await window.payrollAPI.listEvents(employeeId));
    const leaveResult = await window.payrollAPI.listLeaveRequests({ employeeId });
    const vacationBalanceResult = await window.payrollAPI.listVacationBalances({ employeeId, yearRef });
    const vacationRequestResult = await window.payrollAPI.listVacationRequests({ employeeId, yearRef });

    setAttendanceRecords(attendanceResult?.items || []);
    setFinancialObligations(financialResult?.items || []);
    setEmployeeDocuments(documentResult?.items || []);
    setLeaveRequests(leaveResult?.items || []);
    setVacationBalances(vacationBalanceResult?.items || []);
    setVacationRequests(vacationRequestResult?.items || []);

    const selectedEmployee = boot?.employees?.find((item) => Number(item.id) === Number(employeeId));

    setAttendanceForm((current) => ({
      ...current,
      employee_id: String(employeeId),
      shift_id: String(selectedEmployee?.shift_id || "")
    }));
    setFinancialForm((current) => ({
      ...current,
      employee_id: String(employeeId),
      start_month_ref: current.start_month_ref || monthRef
    }));
    setEmployeeDocumentForm((current) => ({
      ...initialEmployeeDocument,
      ...current,
      id: null,
      employee_id: String(employeeId),
      file_path: "",
      file_name: "",
      stored_file_path: ""
    }));
    setVacationBalanceForm((current) => ({
      ...current,
      id: vacationBalanceResult?.items?.[0]?.id ?? null,
      employee_id: String(employeeId),
      year_ref: yearRef,
      entitled_days: vacationBalanceResult?.items?.[0]?.entitled_days ?? current.entitled_days,
      carried_days: vacationBalanceResult?.items?.[0]?.carried_days ?? 0,
      manual_adjustment: vacationBalanceResult?.items?.[0]?.manual_adjustment ?? 0,
      notes: vacationBalanceResult?.items?.[0]?.notes ?? ""
    }));
    setVacationForm((current) => ({
      ...current,
      employee_id: String(employeeId),
      year_ref: yearRef
    }));
  }

  function getAutoEventCalculationDetails(payload) {
    const employee = boot?.employees.find((item) => Number(item.id) === Number(payload.employee_id));
    const baseSalary = Number(employee?.base_salary || 0);
    const quantity = Number(payload.quantity || 0);
    const eventMonth = String(payload.event_date || monthRef).slice(0, 7);
    const monthNumber = Number(eventMonth.split("-")[1] || 0);

    const recurringAllowancesTotal = Number(
      (employee?.recurring_allowances || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );
    const recurringBonusesTotal = Number(
      (employee?.recurring_bonuses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );
    const scheduledSpecialPaymentsTotal = Number(
      (employee?.special_payments || []).reduce((sum, item) => {
        if (item.auto && Number(item.month || 0) === monthNumber) {
          return sum + Number(item.amount || 0);
        }
        return sum;
      }, 0)
    );

    const existingMonthEvents = events.filter(
      (item) =>
        Number(item.employee_id) === Number(payload.employee_id) &&
        String(item.event_date || "").slice(0, 7) === eventMonth
    );
    const monthExtraPaymentsTotal = Number(
      existingMonthEvents
        .filter((item) => item.event_type === "extra_payment")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );
    const monthBonusEventsTotal = Number(
      existingMonthEvents
        .filter(
          (item) =>
            (item.event_type === "vacation_bonus" || item.event_type === "christmas_bonus") &&
            item.event_type !== payload.event_type
        )
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );

    const remunerationBase =
      baseSalary +
      recurringAllowancesTotal +
      recurringBonusesTotal +
      scheduledSpecialPaymentsTotal +
      monthExtraPaymentsTotal +
      monthBonusEventsTotal;
    const hourlyRate = roundAmount(remunerationBase / 176);

    if (!employee) {
      return {
        amount: 0,
        mode: "manual",
        remunerationBase: 0,
        baseSalary: 0,
        hourlyRate: 0,
        dailyRate: 0,
        quantity,
        multiplier: 1,
        monthlyAccrual: 0,
        eventDate: normalizeMonthDate(eventMonth || monthRef)
      };
    }

    if (payload.event_type === "absence" || payload.event_type === "leave") {
      const dailyRate = roundAmount(baseSalary / 30);
      return {
        amount: roundAmount(dailyRate * quantity),
        mode: "daily",
        remunerationBase,
        baseSalary,
        hourlyRate,
        dailyRate,
        quantity,
        multiplier: 1,
        monthlyAccrual: 0,
        eventDate: normalizeMonthDate(eventMonth || monthRef)
      };
    }
    if (payload.event_type === "vacation_bonus" || payload.event_type === "christmas_bonus") {
      const monthlyAccrual = roundAmount(baseSalary / 12);
      return {
        amount: roundAmount(monthlyAccrual * quantity),
        mode: "bonus",
        remunerationBase,
        baseSalary,
        hourlyRate,
        dailyRate: roundAmount(baseSalary / 30),
        quantity,
        multiplier: 1,
        monthlyAccrual,
        eventDate: normalizeMonthDate(eventMonth || monthRef)
      };
    }
    if (payload.event_type === "overtime_50") {
      return {
        amount: roundAmount(hourlyRate * 1.5 * quantity),
        mode: "overtime",
        remunerationBase,
        baseSalary,
        hourlyRate,
        dailyRate: roundAmount(baseSalary / 30),
        quantity,
        multiplier: 1.5,
        monthlyAccrual: 0,
        eventDate: normalizeMonthDate(eventMonth || monthRef)
      };
    }
    if (payload.event_type === "overtime_100") {
      return {
        amount: roundAmount(hourlyRate * 2 * quantity),
        mode: "overtime",
        remunerationBase,
        baseSalary,
        hourlyRate,
        dailyRate: roundAmount(baseSalary / 30),
        quantity,
        multiplier: 2,
        monthlyAccrual: 0,
        eventDate: normalizeMonthDate(eventMonth || monthRef)
      };
    }
    return {
      amount: Number(payload.amount || 0),
      mode: "manual",
      remunerationBase,
      baseSalary,
      hourlyRate,
      dailyRate: roundAmount(baseSalary / 30),
      quantity,
      multiplier: 1,
      monthlyAccrual: 0,
      eventDate: normalizeMonthDate(eventMonth || monthRef)
    };
  }

  function getAutoEventAmount(payload) {
    return getAutoEventCalculationDetails(payload).amount;
  }

  async function applyAuditFilters() {
    const result = await window.payrollAPI.listAuditLogs({
      ...auditFilters,
      startDate: historyRequestFilters.startDate,
      endDate: historyRequestFilters.endDate
    });
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Auditoria", result?.message, "Não foi possível carregar a auditoria."));
      return;
    }
    setBoot((current) => (current ? { ...current, auditLogs: result.items || [] } : current));
  }

  async function exportAuditLogs() {
    const result = await window.payrollAPI.exportAuditLogs({
      ...auditFilters,
      startDate: historyRequestFilters.startDate,
      endDate: historyRequestFilters.endDate
    });
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback("Exportação da auditoria", result?.message, "Não foi possível exportar a auditoria.")
      );
      return;
    }
    setFeedback(`Auditoria exportada em ${result.path}`);
  }

  async function exportAuditExcel() {
    const result = await window.payrollAPI.exportAuditExcel({
      ...auditFilters,
      startDate: historyRequestFilters.startDate,
      endDate: historyRequestFilters.endDate
    });
    if (!result?.ok) {
      setFeedback("Não foi possível exportar a auditoria para Excel.");
      return;
    }
    setFeedback(`Auditoria Excel criada em ${result.path}`);
  }

  function updateHistoryPreset(preset) {
    setHistoryFilters((current) => ({
      ...current,
      preset,
      ...applyReportPreset(preset, monthRef)
    }));
  }

  function updateHistoryFilterField(field, value) {
    setHistoryFilters((current) => ({
      ...current,
      [field]: value,
      preset: "custom"
    }));
  }

  function updateStatePreset(preset) {
    setStateFilters((current) => ({
      ...current,
      preset,
      ...applyReportPreset(preset, monthRef)
    }));
  }

  function updateStateFilterField(field, value) {
    setStateFilters((current) => ({
      ...current,
      [field]: value,
      preset: field === "search" ? current.preset : "custom"
    }));
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (accessState.setupRequired) {
      setFeedback("Conclua primeiro o registo inicial da empresa e do administrador.");
      setAuthMode("register");
      return;
    }
    const result = await window.payrollAPI.login(loginForm);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Início de sessão", result?.message, "Não foi possível iniciar sessão."));
      return;
    }

    const nextLicenseState = await refreshLicenseState();
    if (!nextLicenseState?.canUseApp) {
      setFeedback(nextLicenseState?.message || "A licença do Kwanza Folha precisa de atenção antes de continuar.");
      return;
    }

    setFeedback(
      result.mustChangePassword
        ? "Altere a palavra-passe inicial antes de continuar."
        : nextLicenseState.status === "developer_active"
          ? `Licença técnica de desenvolvimento ativa até ${nextLicenseState.expireDate || "-"}.`
        : nextLicenseState.status === "trial_active"
          ? `Período gratuito ativo. Está no dia ${Math.max(
              1,
              Number(nextLicenseState.trialDaysTotal || 30) - Number(nextLicenseState.trialDaysRemaining || 0) + 1
            )} de ${nextLicenseState.trialDaysTotal || 30}.`
          : ""
    );
    setUser(result.user);
    if (!boot) await loadBootstrap();
    if (result.mustChangePassword && result.user?.role === "admin") {
      setTab("utilizador");
    }
  }

  async function handleRegister(event) {
    event.preventDefault();

    if (registrationForm.password !== registrationForm.confirmPassword) {
      setFeedback("A confirmação da palavra-passe não coincide.");
      return;
    }

    const result = await window.payrollAPI.registerInitialAccount(registrationForm);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Registo inicial", result?.message, "Não foi possível concluir o registo inicial."));
      return;
    }

    const nextAuthState = await refreshAuthState();
    if (nextAuthState?.setupRequired) {
      setFeedback("O registo foi guardado, mas o sistema continua a pedir configuração inicial. Reveja os dados e tente novamente.");
      return;
    }

    const nextLicenseState = await refreshLicenseState();
    if (!nextLicenseState?.canUseApp) {
      setFeedback(nextLicenseState?.message || "O registo foi concluído, mas a licença não ficou disponível.");
      return;
    }

    setUser(result.user);
    await loadBootstrap();
    setLoginForm({ username: "", password: "" });
    setForgotPasswordForm(initialForgotPasswordForm);
    setRegistrationForm(initialRegistrationForm);
    setAuthMode("login");
    setFeedback(
      nextLicenseState.status === "developer_active"
        ? `Registo concluído com sucesso. A sessão foi iniciada e a licença técnica de desenvolvimento está ativa até ${
            nextLicenseState.expireDate || "-"
          }.`
        : `Registo concluído com sucesso. A sessão foi iniciada e o período gratuito de 15 dias está ativo${
            nextLicenseState.trialExpireAt
              ? ` até ${new Date(nextLicenseState.trialExpireAt).toLocaleDateString("pt-PT")}`
              : ""
          }.`
    );
  }

  async function handlePasswordResetRequest(event) {
    event.preventDefault();
    const identifier = String(forgotPasswordForm.identifier || "").trim();
    if (!identifier) {
      setFeedback("Indique o utilizador ou o e-mail para receber o codigo de redefinicao.");
      return;
    }

    const result = await window.payrollAPI.requestPasswordReset({ identifier });
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Recuperação de acesso",
          result?.message,
          "Nao foi possivel enviar o codigo de redefinicao por e-mail."
        )
      );
      return;
    }

    setLoginForm((current) => ({ ...current, username: identifier, password: "" }));
    setForgotPasswordForm((current) => ({
      ...current,
      identifier,
      resetToken: "",
      newPassword: "",
      confirmPassword: ""
    }));
    setFeedback(result.message || "Foi enviado um codigo de redefinicao por e-mail.");
  }

  async function handlePasswordResetCompletion(event) {
    event.preventDefault();
    const identifier = String(forgotPasswordForm.identifier || "").trim();
    const resetToken = String(forgotPasswordForm.resetToken || "").trim();

    if (!identifier) {
      setFeedback("Indique o utilizador ou o e-mail associado ao pedido.");
      return;
    }
    if (!resetToken) {
      setFeedback("Introduza o codigo de redefinicao enviado por e-mail.");
      return;
    }
    if (forgotPasswordForm.newPassword !== forgotPasswordForm.confirmPassword) {
      setFeedback("A confirmacao da nova palavra-passe nao coincide.");
      return;
    }

    const result = await window.payrollAPI.completePasswordReset({
      identifier,
      resetToken,
      newPassword: forgotPasswordForm.newPassword
    });
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Recuperação de acesso",
          result?.message,
          "Nao foi possivel concluir a redefinicao da palavra-passe."
        )
      );
      return;
    }

    setLoginForm({ username: identifier, password: "" });
    setForgotPasswordForm(initialForgotPasswordForm);
    setAuthMode("login");
    setFeedback("Palavra-passe redefinida com sucesso. Pode iniciar sessao com a nova credencial.");
  }

  async function handleActivateLicense(event) {
    event.preventDefault();

    const invokeWithStartupRetry = async (fn) => {
      const delays = [150, 250, 400, 700, 1200, 2000];
      let last = null;
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        last = await fn();
        if (last?.ok) return last;
        if (isActivationPendingResult(last)) return last;
        if (!isStartupDegradedLicensingMessage(last?.message)) return last;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
      return last;
    };

    let result = null;
    try {
      result = await invokeWithStartupRetry(() =>
        window.payrollAPI.activateLicense({
          email: licenseActivationForm.email,
          serialKey: licenseActivationForm.serialKey
        })
      );
    } catch (error) {
      setFeedback(
        contextualizeFeedback(
          "Licenciamento",
          error?.message,
          "Não foi possível comunicar com o módulo de licenciamento."
        )
      );
      return;
    }

    if (!result?.ok) {
      if (isActivationPendingResult(result)) {
        setLicenseMode("activate");
        setFeedback(getActivationPendingFeedback(result));
        await refreshLicenseState().catch(() => null);
        return;
      }
      setFeedback(contextualizeFeedback("Licenciamento", result?.message, "Não foi possível ativar a licença."));
      return;
    }

    const nextStatus = await refreshLicenseState();
    if (!nextStatus?.canUseApp) {
      setFeedback("A licença foi recebida, mas a validação local não foi concluída.");
      return;
    }

    await refreshAuthState();
    setLicensePaymentState({
      reference: "",
      amount: 0,
      validUntil: "",
      planName: "",
      serialKey: "",
      paymentInstructions: null
    });
    const restoredSession = await window.payrollAPI.restoreSession();
    if (restoredSession?.ok) {
      setUser(restoredSession.user);
      await loadBootstrap();
      setLicenseCenterOpen(false);
      setFeedback(
        `Licença ativada com sucesso. Tempo restante: ${formatRemainingTime(nextStatus.expireDate, Date.now())}.`
      );
      return;
    }

    setLicenseCenterOpen(false);
    setFeedback(`Licença ativada com sucesso. Tempo restante: ${formatRemainingTime(nextStatus.expireDate, Date.now())}.`);
  }

  async function handleCreateLicensePayment(event) {
    event.preventDefault();

    const invokeWithStartupRetry = async (fn) => {
      const delays = [150, 250, 400, 700, 1200, 2000];
      let last = null;
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        last = await fn();
        if (last?.ok) return last;
        if (isActivationPendingResult(last)) return last;
        if (!isStartupDegradedLicensingMessage(last?.message)) return last;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
      return last;
    };

    const payload = {
      ...licensePurchaseForm,
      renewal: licenseMode === "renew",
      serial_key: licenseMode === "renew" ? licenseState.serialKey || licensePurchaseForm.serial_key : ""
    };

    let result = null;
    try {
      result = await invokeWithStartupRetry(() =>
        licenseMode === "renew"
          ? window.payrollAPI.renewLicense(payload)
          : window.payrollAPI.createLicensePayment(payload)
      );
    } catch (error) {
      setFeedback(
        contextualizeFeedback(
          licenseMode === "renew" ? "Renovação da licença" : "Compra da licença",
          error?.message,
          "Não foi possível comunicar com o módulo de licenciamento."
        )
      );
      return;
    }

    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          licenseMode === "renew" ? "Renovação da licença" : "Compra da licença",
          result?.message,
          "Não foi possível gerar a referência de pagamento."
        )
      );
      return;
    }

    setLicenseMode("payment");
    setLicensePaymentState({
      reference: result.reference,
      amount: result.amount,
      validUntil: result.valid_until,
      planName: result.plan,
      serialKey: result.serial_key || payload.serial_key || "",
      paymentInstructions: result.payment_instructions || null
    });
    setFeedback(`Referência ${result.reference} gerada com sucesso. Depois do pagamento, use "Verificar pagamento".`);
  }

  async function handleCheckLicensePayment() {
    if (!licensePaymentState.reference) {
      setFeedback("Ainda não existe uma referência gerada para verificar.");
      return;
    }

    const invokeWithStartupRetry = async (fn) => {
      const delays = [150, 250, 400, 700, 1200, 2000];
      let last = null;
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        last = await fn();
        if (last?.ok) return last;
        if (isActivationPendingResult(last)) return last;
        if (!isStartupDegradedLicensingMessage(last?.message)) return last;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
      return last;
    };

    let result = null;
    try {
      result = await invokeWithStartupRetry(() =>
        window.payrollAPI.checkLicensePayment({ reference: licensePaymentState.reference })
      );
    } catch (error) {
      setFeedback(
        contextualizeFeedback(
          "Pagamento da licença",
          error?.message,
          "Não foi possível comunicar com o módulo de licenciamento."
        )
      );
      return;
    }
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Pagamento da licença", result?.message, "Não foi possível verificar o pagamento."));
      return;
    }

    setLicensePaymentState((current) => ({
      ...current,
      paymentInstructions: result.payment_instructions || current.paymentInstructions || null
    }));

    if (result.status !== "paid") {
      setFeedback(`Pagamento com referência ${result.reference} ainda está em estado ${result.status}.`);
      return;
    }

    setLicenseActivationForm({
      email: licensePurchaseForm.email,
      serialKey: result.serial_key || licensePaymentState.serialKey
    });

    let activationResult = null;
    try {
      const serialKey = result.serial_key || licensePaymentState.serialKey;
      activationResult = await invokeWithStartupRetry(() =>
        window.payrollAPI.activateLicense({
          email: licensePurchaseForm.email,
          serialKey
        })
      );
    } catch (error) {
      setLicenseMode("activate");
      setFeedback(
        contextualizeFeedback(
          "Licenciamento",
          error?.message,
          "O pagamento foi confirmado, mas a ativação não pôde ser concluída."
        )
      );
      return;
    }

    if (!activationResult?.ok) {
      setLicenseMode("activate");
      if (isActivationPendingResult(activationResult)) {
        await refreshLicenseState().catch(() => null);
        setFeedback(getActivationPendingFeedback(activationResult));
        return;
      }
      setFeedback(
        contextualizeFeedback(
          "Licenciamento",
          activationResult?.message,
          "O pagamento foi confirmado, mas a licença ainda não foi ativada neste dispositivo."
        )
      );
      return;
    }

    await refreshLicenseState();
    await refreshAuthState();
    setLicensePaymentState({
      reference: "",
      amount: 0,
      validUntil: "",
      planName: "",
      serialKey: "",
      paymentInstructions: null
    });
    setLicenseMode("activate");
    const restoredSession = await window.payrollAPI.restoreSession();
    if (restoredSession?.ok) {
      setUser(restoredSession.user);
      await loadBootstrap();
      setLicenseCenterOpen(false);
      setFeedback("Pagamento confirmado e licença ativada com sucesso. O acesso ao sistema foi retomado.");
      return;
    }

    setLicenseCenterOpen(false);
    setFeedback("Pagamento confirmado e licença ativada com sucesso.");
  }

  async function handleCloseLicenseGate() {
    await window.payrollAPI.quitApplication();
  }

  async function openLicenseCenter(mode = "purchase") {
    await refreshLicenseState();
    await refreshAuthState();
    setLicenseMode(mode);
    setLicenseCenterOpen(true);
  }

  function closeLicenseCenter() {
    setLicenseCenterOpen(false);
  }

  async function logout() {
    await window.payrollAPI.logout();
    setUser(null);
    setBoot(null);
    setHistoryActiveTab("eventos");
    setAttendanceRecords([]);
    setAttendanceImportLogs([]);
    setFinancialObligations([]);
    setEmployeeDocuments([]);
    setEvents([]);
    setLeaveRequests([]);
    setVacationBalances([]);
    setVacationRequests([]);
    setEmployeeDocumentForm(initialEmployeeDocument);
    setPasswordForm(initialPasswordForm);
    await refreshAuthState();
    setLoginForm((current) => ({ ...current, password: "" }));
    setFeedback("Sessão terminada.");
  }

  async function saveCompany(event) {
    event.preventDefault();
    const result = await window.payrollAPI.saveCompany(companyForm);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Empresa", result?.message, "Não foi possível guardar os dados da empresa."));
      return;
    }
    await loadBootstrap();
    setFeedback("Dados da empresa atualizados.");
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      const payload = {
        ...settingsForm,
        smtpPort: Number(settingsForm.smtpPort || 0),
        smtpSecure: Boolean(settingsForm.smtpSecure),
        allowanceTypes: parseCommaList(settingsForm.allowanceTypes),
        bonusTypes: parseCommaList(settingsForm.bonusTypes),
        irtBrackets: JSON.parse(settingsForm.irtBrackets)
      };
      const result = await window.payrollAPI.saveSettings(payload);
      if (!result?.ok) {
        setFeedback(contextualizeFeedback("Configurações", result?.message, "Não foi possível guardar as configurações."));
        return;
      }
      // Mantém a configuração do servidor de licenças em secure storage (para funcionar antes do login e em casos de DB corrompida).
      if (typeof window.payrollAPI.setLicenseApiBaseUrl === "function") {
        try {
          await window.payrollAPI.setLicenseApiBaseUrl(payload.licenseApiBaseUrl || "");
        } catch {}
      }
      await loadBootstrap();
      setFeedback("Configurações guardadas.");
    } catch {
      setFeedback("Tabela de IRT inválida. Reveja o JSON antes de guardar.");
    }
  }

  async function saveLicenseApiBaseUrl(event) {
    event.preventDefault();
    if (typeof window.payrollAPI?.setLicenseApiBaseUrl !== "function") {
      setFeedback("Esta versão ainda não suporta a configuração do servidor de licenças.");
      return;
    }

    const result = await window.payrollAPI.setLicenseApiBaseUrl(licenseApiUrlForm);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Servidor de licenças", result?.message, "Não foi possível guardar o servidor de licenças."));
      return;
    }
    const refreshed = await window.payrollAPI.getLicenseApiBaseUrl().catch(() => null);
    if (refreshed) {
      setLicenseApiState(refreshed);
    }
    setFeedback("Servidor de licenças guardado. Tente novamente a compra/ativação.");
  }

  async function saveSalaryScale(event) {
    event.preventDefault();
    const payload = {
      ...salaryScaleForm,
      job_title: String(salaryScaleForm.job_title || "").trim(),
      department: String(salaryScaleForm.department || "").trim(),
      min_salary: Number(salaryScaleForm.min_salary || 0),
      reference_salary: Number(salaryScaleForm.reference_salary || 0),
      max_salary: Number(salaryScaleForm.max_salary || 0),
      notes: String(salaryScaleForm.notes || "").trim(),
      active: Boolean(salaryScaleForm.active)
    };
    const result = await window.payrollAPI.saveSalaryScale(payload);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Escala salarial por função",
          result?.message,
          "Não foi possível guardar a escala salarial."
        )
      );
      return;
    }

    setBoot((current) => (current ? { ...current, salaryScales: result.items || [] } : current));
    setSalaryScaleForm(initialSalaryScale);
    setFeedback("Escala salarial guardada com sucesso.");
  }

  function editSalaryScaleRow(scale) {
    setSalaryScaleForm({
      id: scale.id,
      job_title: scale.job_title || "",
      department: scale.department || "",
      min_salary: String(scale.min_salary ?? ""),
      reference_salary: String(scale.reference_salary ?? ""),
      max_salary: String(scale.max_salary ?? ""),
      notes: scale.notes || "",
      active: Boolean(scale.active)
    });
    setTab("configuracoes");
  }

  async function deleteSalaryScale(scaleId) {
    if (!window.confirm("Tem a certeza de que pretende eliminar esta escala salarial?")) return;
    const result = await window.payrollAPI.deleteSalaryScale(scaleId);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Escala salarial por função",
          result?.message,
          "Não foi possível remover a escala salarial."
        )
      );
      return;
    }

    setBoot((current) => (current ? { ...current, salaryScales: result.items || [] } : current));
    setSalaryScaleForm((current) => (Number(current.id) === Number(scaleId) ? initialSalaryScale : current));
    setFeedback("Escala salarial removida.");
  }

  async function saveWorkShift(event) {
    event.preventDefault();
    const payload = {
      ...workShiftForm,
      code: String(workShiftForm.code || "").trim().toUpperCase(),
      name: String(workShiftForm.name || "").trim(),
      department: String(workShiftForm.department || "").trim(),
      profile: String(workShiftForm.profile || "general").trim(),
      start_time: String(workShiftForm.start_time || "").trim(),
      end_time: String(workShiftForm.end_time || "").trim(),
      tolerance_minutes: Number(workShiftForm.tolerance_minutes || 0),
      break_minutes: Number(workShiftForm.break_minutes || 0),
      working_days: workShiftForm.working_days || [],
      notes: String(workShiftForm.notes || "").trim(),
      active: Boolean(workShiftForm.active)
    };
    const result = await window.payrollAPI.saveWorkShift(payload);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Turnos", result?.message, "Não foi possível guardar o turno.")); 
      return;
    }

    setBoot((current) => (current ? { ...current, workShifts: result.items || [] } : current));
    setWorkShiftForm(initialWorkShift);
    setFeedback("Turno guardado com sucesso.");
  }

  function editWorkShiftRow(shift) {
    setWorkShiftForm({
      id: shift.id,
      code: shift.code || "",
      name: shift.name || "",
      department: shift.department || "",
      profile: shift.profile || "general",
      start_time: shift.start_time || "08:00",
      end_time: shift.end_time || "17:00",
      tolerance_minutes: Number(shift.tolerance_minutes || 0),
      break_minutes: Number(shift.break_minutes || 0),
      working_days: shift.working_days || [1, 2, 3, 4, 5],
      notes: shift.notes || "",
      active: Boolean(shift.active)
    });
    setTab("configuracoes");
  }

  async function deleteWorkShift(shiftId) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este turno?")) return;
    const result = await window.payrollAPI.deleteWorkShift(shiftId);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Turnos", result?.message, "Não foi possível remover o turno.")); 
      return;
    }

    setBoot((current) => (current ? { ...current, workShifts: result.items || [] } : current));
    setWorkShiftForm((current) => (Number(current.id) === Number(shiftId) ? initialWorkShift : current));
    setFeedback("Turno removido.");
  }

  async function saveEmployee(event) {
    event.preventDefault();
    try {
        const result = await window.payrollAPI.saveEmployee({
          ...employeeForm,
          full_name: employeeForm.full_name.trim(),
          bi: employeeForm.bi.trim(),
          nif: employeeForm.nif.trim(),
          social_security_number: employeeForm.social_security_number.trim(),
          attendance_code: employeeForm.attendance_code.trim(),
          birth_date: employeeForm.birth_date,
          gender: employeeForm.gender,
          marital_status: employeeForm.marital_status,
          nationality: employeeForm.nationality.trim(),
        personal_phone: employeeForm.personal_phone.trim(),
        personal_email: employeeForm.personal_email.trim(),
        address: employeeForm.address.trim(),
        job_title: employeeForm.job_title.trim(),
          department: employeeForm.department.trim(),
          contract_type: employeeForm.contract_type.trim(),
          shift_id: employeeForm.shift_id ? Number(employeeForm.shift_id) : null,
          iban: employeeForm.iban.trim(),
        bank_account: employeeForm.bank_account.trim(),
        notes: employeeForm.notes.trim(),
        recurring_allowances: (employeeForm.recurring_allowances || [])
          .filter((item) => String(item.label || "").trim())
          .map((item) => ({
            ...item,
            label: String(item.label || "").trim(),
            amount: Number(item.amount || 0),
            fiscalMode: String(item.fiscalMode || "taxable").trim() || "taxable"
          })),
        recurring_bonuses: (employeeForm.recurring_bonuses || [])
          .filter((item) => String(item.label || "").trim())
          .map((item) => ({
            ...item,
            label: String(item.label || "").trim(),
            amount: Number(item.amount || 0),
            fiscalMode: String(item.fiscalMode || "taxable").trim() || "taxable"
          })),
        special_payments: (employeeForm.special_payments || [])
          .filter((item) => String(item.label || "").trim())
          .map((item) => ({
            ...item,
            label: String(item.label || "").trim(),
            amount: Number(item.amount || 0),
            fiscalMode: String(item.fiscalMode || "taxable").trim() || "taxable",
            month: item.month ? Number(item.month) : undefined,
            auto: Boolean(item.auto)
          }))
      });

      if (!result?.ok) {
        setFeedback(contextualizeFeedback("Funcionários", result?.message, "Não foi possível guardar o funcionário."));
        return;
      }

      const employees = result.employees || [];
      setBoot((current) => (current ? { ...current, employees } : current));
      setEventForm((current) => ({
        ...current,
        employee_id: current.employee_id || String(employees[0]?.id || "")
      }));
      setEmployeeForm(initialEmployee);
      setFeedback("Funcionário guardado com sucesso.");
    } catch (error) {
      setFeedback(error?.message || "Não foi possível guardar o funcionário.");
    }
  }

  function editEmployee(employee) {
    setEmployeeForm({
      ...employee,
      base_salary: String(employee.base_salary),
      social_security_number: employee.social_security_number || "",
      attendance_code: employee.attendance_code || "",
      birth_date: employee.birth_date || "",
      gender: employee.gender || "",
      marital_status: employee.marital_status || "",
      nationality: employee.nationality || "Angolana",
      personal_phone: employee.personal_phone || "",
      personal_email: employee.personal_email || "",
      address: employee.address || "",
      shift_id: String(employee.shift_id || ""),
      bank_account: employee.bank_account || "",
      notes: employee.notes || "",
      recurring_allowances: employee.recurring_allowances || [],
      recurring_bonuses: employee.recurring_bonuses || [],
      special_payments: employee.special_payments || []
    });
    setTab("funcionarios");
  }

  async function deleteEmployee(id) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este funcionário?")) return;
    const result = await window.payrollAPI.deleteEmployee(id);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Funcionários", result?.message, "Não foi possível remover o funcionário."));
      return;
    }
    await loadBootstrap();
    setFeedback("Funcionário removido.");
  }

  async function selectEmployee(id) {
    const selectedEmployee = boot?.employees?.find((item) => Number(item.id) === Number(id));
    setAttendanceForm((current) => ({ ...current, employee_id: id, shift_id: String(selectedEmployee?.shift_id || "") }));
    setEventForm((current) => ({ ...current, employee_id: id }));
    setFinancialForm((current) => ({ ...current, employee_id: String(id || ""), start_month_ref: monthRef }));
    setEmployeeDocumentForm((current) => ({ ...initialEmployeeDocument, ...current, employee_id: String(id || ""), file_path: "" }));
    setLeaveForm((current) => ({ ...current, employee_id: id }));
    setVacationBalanceForm((current) => ({ ...current, employee_id: String(id || ""), year_ref: vacationFilters.yearRef }));
    setVacationForm((current) => ({ ...current, employee_id: String(id || ""), year_ref: vacationFilters.yearRef }));
    if (id) {
      await loadEmployeeRhData(id, vacationFilters.yearRef);
    } else {
      setAttendanceRecords([]);
      setFinancialObligations([]);
      setEmployeeDocuments([]);
      setEvents([]);
      setLeaveRequests([]);
      setVacationBalances([]);
      setVacationRequests([]);
      setEmployeeDocumentForm({ ...initialEmployeeDocument, employee_id: "" });
    }
  }

  function syncBootDocumentAlerts(alerts) {
    setBoot((current) =>
      current
        ? {
            ...current,
            documentAlerts: alerts || current.documentAlerts || []
          }
        : current
    );
  }

  async function chooseEmployeeDocumentFile() {
    const filePath = await window.payrollAPI.selectEmployeeDocumentFile();
    if (!filePath) {
      return;
    }

    setEmployeeDocumentForm((current) => ({
      ...current,
      file_path: filePath
    }));
  }

  function editEmployeeDocument(document) {
    if (!document) {
      return;
    }

    setEmployeeDocumentForm({
      ...initialEmployeeDocument,
      ...document,
      id: document.id ?? null,
      employee_id: String(document.employee_id || ""),
      alert_days_before: Number(document.alert_days_before || 30),
      file_path: "",
      file_name: document.file_name || "",
      stored_file_path: document.stored_file_path || ""
    });
  }

  function resetEmployeeDocumentForm() {
    setEmployeeDocumentForm({
      ...initialEmployeeDocument,
      employee_id: String(selectedHistoryEmployeeId || "")
    });
  }

  async function saveEmployeeDocument(event) {
    event.preventDefault();
    const payload = {
      ...employeeDocumentForm,
      employee_id: String(employeeDocumentForm.employee_id || selectedHistoryEmployeeId || ""),
      title: employeeDocumentForm.title.trim(),
      document_number: employeeDocumentForm.document_number.trim(),
      issuer: employeeDocumentForm.issuer.trim(),
      notes: employeeDocumentForm.notes.trim()
    };

    const result = await window.payrollAPI.saveEmployeeDocument(payload);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Documentos", result?.message, "Nao foi possivel guardar o documento laboral."));
      return;
    }

    setEmployeeDocuments(result.items || []);
    syncBootDocumentAlerts(result.alerts || []);
    setEmployeeDocumentForm({
      ...initialEmployeeDocument,
      employee_id: String(payload.employee_id || "")
    });
    setFeedback("Documento laboral guardado com sucesso.");
  }

  async function openEmployeeDocument(documentId) {
    const result = await window.payrollAPI.openEmployeeDocument(documentId);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Documentos", result?.message, "Nao foi possivel abrir o documento laboral."));
      return;
    }

    setFeedback(`Documento aberto a partir de ${result.path}`);
  }

  async function deleteEmployeeDocument(documentId) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este documento laboral?")) {
      return;
    }

    const result = await window.payrollAPI.deleteEmployeeDocument(documentId);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Documentos", result?.message, "Nao foi possivel eliminar o documento laboral."));
      return;
    }

    setEmployeeDocuments(result.items || []);
    syncBootDocumentAlerts(result.alerts || []);
    setEmployeeDocumentForm((current) =>
      Number(current.id || 0) === Number(documentId)
        ? { ...initialEmployeeDocument, employee_id: String(selectedHistoryEmployeeId || "") }
        : current
    );
    setFeedback("Documento laboral eliminado.");
  }

  async function handleDashboardAlertAction(alert) {
    if (alert?.tab === "historico") {
      const nextHistoryTab = alert?.historyTab || "eventos";
      setHistoryActiveTab(nextHistoryTab);

      const targetEmployeeId = Number(alert?.employeeId || 0);
      if (targetEmployeeId) {
        await selectEmployee(targetEmployeeId);
      } else if (nextHistoryTab === "documentos" && !selectedHistoryEmployeeId && boot?.employees?.length) {
        await selectEmployee(Number(boot.employees[0].id));
      }

      setTab("historico");
      return;
    }

    setTab(alert?.tab || "configuracoes");
  }

  function syncBootFinancialObligations(employeeId, items) {
    setBoot((current) =>
      current
        ? {
            ...current,
            financialObligations: [
              ...(current.financialObligations || []).filter(
                (item) => Number(item.employee_id) !== Number(employeeId)
              ),
              ...(items || [])
            ]
          }
        : current
    );
  }

  async function saveFinancialObligation(event) {
    event.preventDefault();
    const payload = {
      ...financialForm,
      employee_id: Number(financialForm.employee_id || 0),
      principal_amount: Number(financialForm.principal_amount || 0),
      installment_count: Number(financialForm.installment_count || 0),
      installment_amount: Number(financialForm.installment_amount || 0),
      label: String(financialForm.label || "").trim(),
      notes: String(financialForm.notes || "").trim(),
      active: Boolean(financialForm.active)
    };
    const result = await window.payrollAPI.saveFinancialObligation(payload);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Empréstimos e adiantamentos",
          result?.message,
          "Não foi possível guardar o registo financeiro."
        )
      );
      return;
    }

    const refresh = await window.payrollAPI.listFinancialObligations({
      employeeId: payload.employee_id,
      monthRef
    });
    const items = refresh?.items || [];
    setFinancialObligations(items);
    syncBootFinancialObligations(payload.employee_id, items);
    setFinancialForm((current) => ({
      ...initialFinancialObligation,
      employee_id: String(current.employee_id || ""),
      start_month_ref: monthRef
    }));
    setFeedback("Registo financeiro guardado.");
  }

  async function deleteFinancialObligation(id) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este empréstimo ou adiantamento?")) return;
    const result = await window.payrollAPI.deleteFinancialObligation(id);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Empréstimos e adiantamentos",
          result?.message,
          "Não foi possível eliminar o registo financeiro."
        )
      );
      return;
    }

    const employeeId = Number(financialForm.employee_id || 0);
    const refresh = employeeId
      ? await window.payrollAPI.listFinancialObligations({ employeeId, monthRef })
      : { items: result.items || [] };
    const items = refresh?.items || [];
    setFinancialObligations(items);
    if (employeeId) {
      syncBootFinancialObligations(employeeId, items);
    }
    setFeedback("Registo financeiro removido.");
  }

  async function saveAttendanceRecord(event) {
    event.preventDefault();
    const payload = {
      ...attendanceForm,
      employee_id: Number(attendanceForm.employee_id || 0),
      shift_id: attendanceForm.shift_id ? Number(attendanceForm.shift_id) : null,
      check_in_time: String(attendanceForm.check_in_time || "").trim(),
      check_out_time: String(attendanceForm.check_out_time || "").trim(),
      hours_worked: Number(attendanceForm.hours_worked || 0),
      delay_minutes: Number(attendanceForm.delay_minutes || 0),
      source: "manual",
      device_label: "",
      notes: String(attendanceForm.notes || "").trim()
    };
    const result = await window.payrollAPI.saveAttendanceRecord(payload);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Assiduidade", result?.message, "Não foi possível guardar o registo de assiduidade."));
      return;
    }

    const savedRecord =
      (result.items || []).find(
        (item) =>
          Number(item.employee_id) === Number(payload.employee_id) && item.attendance_date === payload.attendance_date
      ) || null;

    setAttendanceRecords(result.items || []);
    setBoot((current) =>
      current
        ? {
            ...current,
            attendanceRecords: [
              ...(current.attendanceRecords || []).filter(
                (item) =>
                  !(Number(item.employee_id) === Number(payload.employee_id) && item.attendance_date === payload.attendance_date)
              ),
              ...(result.items || []).filter((item) => item.attendance_date === payload.attendance_date)
            ]
          }
        : current
    );
    setAttendanceForm((current) => ({
      ...current,
      employee_id: String(savedRecord?.employee_id || current.employee_id || payload.employee_id || ""),
      attendance_date: savedRecord?.attendance_date || payload.attendance_date,
      status: savedRecord?.status || payload.status,
      shift_id: String(savedRecord?.shift_id || current.shift_id || payload.shift_id || ""),
      check_in_time: savedRecord?.check_in_time || payload.check_in_time,
      check_out_time: savedRecord?.check_out_time || payload.check_out_time,
      punch_count: Number(savedRecord?.punch_count || payload.punch_count || 0),
      hours_worked: Number(savedRecord?.hours_worked || payload.hours_worked || 0),
      delay_minutes: Number(savedRecord?.delay_minutes || payload.delay_minutes || 0),
      source: "manual",
      device_label: "",
      notes: savedRecord?.notes || payload.notes
    }));
    setFeedback(
      savedRecord?.approval_status === "pending"
        ? "Registo de assiduidade guardado. Aguarda aprovação antes do fecho do mês."
        : "Registo de assiduidade guardado."
    );
  }

  async function deleteAttendanceRecord(id) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este registo de assiduidade?")) return;
    const result = await window.payrollAPI.deleteAttendanceRecord(id);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Assiduidade", result?.message, "Não foi possível eliminar o registo de assiduidade."));
      return;
    }

    if (attendanceForm.employee_id) {
      const refresh = await window.payrollAPI.listAttendanceRecords({
        employeeId: attendanceForm.employee_id,
        monthRef: attendanceFilters.monthRef
      });
      setAttendanceRecords(refresh?.items || []);
    } else {
      setAttendanceRecords(result.items || []);
    }
    setBoot((current) =>
      current
        ? {
            ...current,
            attendanceRecords: (current.attendanceRecords || []).filter((item) => Number(item.id) !== Number(id))
          }
        : current
    );
    setFeedback("Registo de assiduidade removido.");
  }

  async function chooseAttendanceFile() {
    const file = await window.payrollAPI.selectAttendanceFile();
    if (file) {
      setAttendanceImportForm((current) => ({ ...current, file_path: file }));
    }
  }

  async function chooseAttendanceFolder() {
    const folder = await window.payrollAPI.selectAttendanceFolder();
    if (folder) {
      setSettingsForm((current) => ({ ...current, attendanceWatchedFolder: folder }));
    }
  }

  async function importAttendanceFile(event) {
    event.preventDefault();
    const payload = {
      ...attendanceImportForm,
      file_path: String(attendanceImportForm.file_path || "").trim(),
      device_label: String(attendanceImportForm.device_label || "").trim(),
      overwrite_imported: Boolean(attendanceImportForm.overwrite_imported)
    };

    const result = await window.payrollAPI.importAttendanceFile(payload);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Sincronização de assiduidade",
          result?.message,
          "Não foi possível importar o ficheiro do dispositivo."
        )
      );
      return;
    }

    const [importsRefresh, bootstrapRefresh] = await Promise.all([
      window.payrollAPI.listAttendanceImports({ limit: 20 }),
      window.payrollAPI.getBootstrap()
    ]);

    setAttendanceImports(importsRefresh?.items || []);
    setBoot(bootstrapRefresh);
    setAttendanceImportForm((current) => ({
      ...current,
      file_path: ""
    }));

    if (attendanceForm.employee_id) {
      await loadEmployeeRhData(attendanceForm.employee_id, vacationFilters.yearRef);
    } else {
      setAttendanceRecords(bootstrapRefresh?.attendanceRecords || []);
    }

    setFeedback(
      `Sincronização concluída. ${result.summary?.imported || 0} registo(s) importado(s) e ${result.summary?.skipped || 0} ignorado(s).`
    );
  }

  async function syncAttendanceFolder() {
    const result = await window.payrollAPI.syncAttendanceFolder();
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Sincronização automática",
          result?.message,
          "Não foi possível sincronizar a pasta monitorizada."
        )
      );
      return;
    }

    await loadBootstrap();
    if (attendanceForm.employee_id) {
      await loadEmployeeRhData(attendanceForm.employee_id, vacationFilters.yearRef);
    }
    setFeedback(
      `Pasta monitorizada sincronizada. ${result.processedFiles || 0} ficheiro(s) novo(s), ${result.duplicateFiles || 0} duplicado(s) e ${result.errorFiles || 0} com erro.`
    );
  }

  async function approveAttendanceAdjustments() {
    const result = await window.payrollAPI.approveAttendanceAdjustments({ monthRef });
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Assiduidade",
          result?.message,
          "Não foi possível aprovar os ajustes pendentes da assiduidade."
        )
      );
      return;
    }

    await loadBootstrap();
    if (attendanceForm.employee_id) {
      await loadEmployeeRhData(attendanceForm.employee_id, vacationFilters.yearRef);
    }
    setFeedback(`${result.approvedCount || 0} ajuste(s) de assiduidade aprovado(s) em ${monthRef}.`);
  }

  async function closeAttendancePeriod() {
    const result = await window.payrollAPI.closeAttendancePeriod(monthRef);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Fecho da assiduidade",
          result?.message,
          "Não foi possível fechar a assiduidade do mês."
        )
      );
      return;
    }

    await loadBootstrap();
    if (attendanceForm.employee_id) {
      await loadEmployeeRhData(attendanceForm.employee_id, vacationFilters.yearRef);
    }
    setFeedback(`Assiduidade de ${monthRef} fechada com sucesso.`);
  }

  async function reopenAttendancePeriod() {
    const result = await window.payrollAPI.reopenAttendancePeriod(monthRef);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback(
          "Reabertura da assiduidade",
          result?.message,
          "Não foi possível reabrir a assiduidade do mês."
        )
      );
      return;
    }

    await loadBootstrap();
    if (attendanceForm.employee_id) {
      await loadEmployeeRhData(attendanceForm.employee_id, vacationFilters.yearRef);
    }
    setFeedback(`Assiduidade de ${monthRef} reaberta com sucesso.`);
  }

  async function saveEvent(eventOrPayload) {
    const customPayload =
      eventOrPayload && typeof eventOrPayload === "object" && typeof eventOrPayload.preventDefault !== "function"
        ? eventOrPayload
        : null;

    if (eventOrPayload?.preventDefault) {
      eventOrPayload.preventDefault();
    }

    const sourcePayload = customPayload || eventForm;
    const payload = {
      ...sourcePayload,
      amount: getAutoEventAmount(sourcePayload),
      quantity: Number(sourcePayload.quantity || 0),
      description:
        sourcePayload.description ||
        (sourcePayload.event_type === "vacation_bonus"
          ? "Subsídio de férias"
          : sourcePayload.event_type === "christmas_bonus"
            ? "Subsídio de Natal"
            : sourcePayload.event_type === "overtime_50"
              ? `Horas Extra 50% (${Number(sourcePayload.quantity || 0)}h)`
              : sourcePayload.event_type === "overtime_100"
                ? `Horas Extra 100% (${Number(sourcePayload.quantity || 0)}h)`
                : sourcePayload.description)
    };

    const result = await window.payrollAPI.saveEvent(payload);
    if (result?.ok === false) {
      setFeedback(contextualizeFeedback("Eventos", result?.message, "Não foi possível registar o evento."));
      return;
    }

    setEvents(result.events || []);
    if (!customPayload) {
      setEventForm((current) => ({ ...initialEvent, employee_id: current.employee_id }));
    }
    setFeedback(
      payload.event_type === "vacation_bonus"
        ? "Subsídio de férias registado."
        : payload.event_type === "christmas_bonus"
          ? "Subsídio de Natal registado."
          : "Evento registado."
    );
  }

  async function deleteEvent(id) {
    if (!window.confirm("Tem a certeza de que pretende apagar este evento?")) return;
    const result = await window.payrollAPI.deleteEvent(id);
    if (result?.ok === false) {
      setFeedback(contextualizeFeedback("Eventos", result?.message, "Não foi possível remover o evento."));
      return;
    }
    if (eventForm.employee_id) {
      setEvents(await window.payrollAPI.listEvents(eventForm.employee_id));
    }
    setFeedback("Evento removido.");
  }

  async function saveLeaveRequest(event) {
    event.preventDefault();
    const payload = {
      ...leaveForm,
      employee_id: Number(leaveForm.employee_id || 0),
      days: Number(leaveForm.days || 0),
      reason: leaveForm.reason.trim(),
      document_ref: leaveForm.document_ref.trim(),
      proof_type: leaveForm.proof_type.trim(),
      notes: leaveForm.notes.trim(),
      rejection_reason: leaveForm.rejection_reason.trim(),
      affects_payroll: Boolean(leaveForm.affects_payroll)
    };
    const result = await window.payrollAPI.saveLeaveRequest(payload);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Licenças e ausências", result?.message, "Não foi possível registar a licença ou ausência."));
      return;
    }

    setLeaveRequests(result.items || []);
    setLeaveForm((current) => ({ ...initialLeaveRequest, employee_id: current.employee_id }));
    setFeedback("Licença ou ausência registada.");
  }

  async function setLeaveRequestStatus(id, status) {
    const rejectionReason = status === "rejected" ? window.prompt("Indique o motivo da rejeição:", "") || "" : "";
    const result = await window.payrollAPI.setLeaveRequestStatus({ id, status, rejectionReason });
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Licenças e ausências", result?.message, "Não foi possível atualizar o estado da licença."));
      return;
    }
    if (leaveForm.employee_id) {
      setLeaveRequests(await (async () => {
        const refresh = await window.payrollAPI.listLeaveRequests({ employeeId: leaveForm.employee_id });
        return refresh?.items || [];
      })());
    } else {
      setLeaveRequests(result.items || []);
    }
    setFeedback(status === "approved" ? "Licença ou ausência aprovada." : status === "rejected" ? "Licença ou ausência rejeitada." : "Estado atualizado.");
  }

  async function deleteLeaveRequest(id) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este registo de licença ou ausência?")) return;
    const result = await window.payrollAPI.deleteLeaveRequest(id);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Licenças e ausências", result?.message, "Não foi possível eliminar o registo."));
      return;
    }
    if (leaveForm.employee_id) {
      const refresh = await window.payrollAPI.listLeaveRequests({ employeeId: leaveForm.employee_id });
      setLeaveRequests(refresh?.items || []);
    } else {
      setLeaveRequests(result.items || []);
    }
    setFeedback("Registo de licença ou ausência removido.");
  }

  async function saveVacationBalance(event) {
    event.preventDefault();
    const payload = {
      ...vacationBalanceForm,
      employee_id: Number(vacationBalanceForm.employee_id || 0),
      entitled_days: Number(vacationBalanceForm.entitled_days || 0),
      carried_days: Number(vacationBalanceForm.carried_days || 0),
      manual_adjustment: Number(vacationBalanceForm.manual_adjustment || 0),
      notes: String(vacationBalanceForm.notes || "").trim()
    };
    const result = await window.payrollAPI.saveVacationBalance(payload);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Plano de férias", result?.message, "Não foi possível guardar o saldo de férias."));
      return;
    }

    setVacationBalances(result.items || []);
    const latest = result.items?.[0];
    if (latest) {
      setVacationBalanceForm({
        id: latest.id ?? null,
        employee_id: String(latest.employee_id),
        year_ref: latest.year_ref,
        entitled_days: latest.entitled_days,
        carried_days: latest.carried_days,
        manual_adjustment: latest.manual_adjustment,
        notes: latest.notes || ""
      });
    }
    setFeedback("Saldo anual de férias atualizado.");
  }

  async function saveVacationRequest(event) {
    event.preventDefault();
    const payload = {
      ...vacationForm,
      employee_id: Number(vacationForm.employee_id || 0),
      days: Number(vacationForm.days || 0),
      notes: String(vacationForm.notes || "").trim(),
      rejection_reason: String(vacationForm.rejection_reason || "").trim()
    };
    const result = await window.payrollAPI.saveVacationRequest(payload);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Plano de férias", result?.message, "Não foi possível registar o pedido de férias."));
      return;
    }

    setVacationRequests(result.items || []);
    const refreshedBalances = await window.payrollAPI.listVacationBalances({
      employeeId: payload.employee_id,
      yearRef: payload.year_ref
    });
    setVacationBalances(refreshedBalances?.items || []);
    setVacationForm((current) => ({
      ...initialVacationRequest,
      employee_id: current.employee_id,
      year_ref: current.year_ref
    }));
    setFeedback("Pedido de férias registado.");
  }

  async function setVacationRequestStatus(id, status) {
    const rejectionReason =
      status === "rejected" ? window.prompt("Indique o motivo da rejeição das férias:", "") || "" : "";
    const result = await window.payrollAPI.setVacationRequestStatus({ id, status, rejectionReason });
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Plano de férias", result?.message, "Não foi possível atualizar o estado das férias."));
      return;
    }

    if (vacationForm.employee_id) {
      const [requestsRefresh, balancesRefresh] = await Promise.all([
        window.payrollAPI.listVacationRequests({ employeeId: vacationForm.employee_id, yearRef: vacationFilters.yearRef }),
        window.payrollAPI.listVacationBalances({ employeeId: vacationForm.employee_id, yearRef: vacationFilters.yearRef })
      ]);
      setVacationRequests(requestsRefresh?.items || []);
      setVacationBalances(balancesRefresh?.items || []);
    } else {
      setVacationRequests(result.items || []);
    }

    setFeedback(
      status === "approved"
        ? "Férias aprovadas."
        : status === "rejected"
          ? "Férias rejeitadas."
          : status === "taken"
            ? "Férias marcadas como gozadas."
            : "Estado das férias atualizado."
    );
  }

  async function deleteVacationRequest(id) {
    if (!window.confirm("Tem a certeza de que pretende eliminar este pedido de férias?")) return;
    const result = await window.payrollAPI.deleteVacationRequest(id);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Plano de férias", result?.message, "Não foi possível eliminar o pedido de férias."));
      return;
    }

    if (vacationForm.employee_id) {
      const [requestsRefresh, balancesRefresh] = await Promise.all([
        window.payrollAPI.listVacationRequests({ employeeId: vacationForm.employee_id, yearRef: vacationFilters.yearRef }),
        window.payrollAPI.listVacationBalances({ employeeId: vacationForm.employee_id, yearRef: vacationFilters.yearRef })
      ]);
      setVacationRequests(requestsRefresh?.items || []);
      setVacationBalances(balancesRefresh?.items || []);
    } else {
      setVacationRequests(result.items || []);
    }
    setFeedback("Pedido de férias removido.");
  }

  async function runPayroll() {
    const result = await window.payrollAPI.processPayroll(monthRef);
    if (result?.ok === false) {
      setFeedback(contextualizeFeedback("Processamento salarial", result?.message, "Não foi possível processar a folha."));
      return;
    }
    await loadBootstrap();
    setTab("processamento");
    setFeedback(`Processamento concluído para ${monthRef}.`);
  }

  async function reprocessPayrollMonth() {
    const requiresAuthorization = Boolean(reprocessPreviewState.data?.authorizationRequired);
    const confirmationMessage = requiresAuthorization
      ? `O período ${monthRef} está fechado. Pretende avançar com um reprocessamento autorizado sem reabrir o mês?`
      : `Tem a certeza de que pretende reprocessar a folha de ${monthRef}? Os cálculos atuais deste mês serão substituídos.`;
    if (!window.confirm(confirmationMessage)) return;

    let authorizationReason = "";
    if (requiresAuthorization) {
      authorizationReason = String(
        window.prompt(`Indique o motivo da autorização para reprocessar ${monthRef}:`, "Correção fiscal autorizada") || ""
      ).trim();
      if (!authorizationReason) {
        setFeedback("O reprocessamento de períodos fechados exige um motivo de autorização.");
        return;
      }
    }

    const result = await window.payrollAPI.reprocessPayroll({
      monthRef,
      allowClosedPeriod: requiresAuthorization,
      authorizationReason
    });
    if (result?.ok === false) {
      setFeedback(contextualizeFeedback("Reprocessamento salarial", result?.message, "Não foi possível reprocessar a folha."));
      return;
    }
    await loadBootstrap();
    setTab("processamento");
    setFeedback(`Folha de ${monthRef} reprocessada com a regra fiscal atual.`);
  }

  async function closePayrollPeriod() {
    const result = await window.payrollAPI.closePayrollPeriod(monthRef);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Fecho de período", result?.message, "Não foi possível fechar o período."));
      return;
    }
    await loadBootstrap();
    setFeedback(`Período ${monthRef} fechado com sucesso.`);
  }

  async function reopenPayrollPeriod() {
    const result = await window.payrollAPI.reopenPayrollPeriod(monthRef);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Reabertura de período", result?.message, "Não foi possível reabrir o período."));
      return;
    }
    await loadBootstrap();
    setFeedback(`Período ${monthRef} reaberto com sucesso.`);
  }

  async function deletePayrollRun(runId) {
    if (!window.confirm("Tem a certeza de que pretende apagar este pagamento processado?")) return;
    const result = await window.payrollAPI.deletePayrollRun(runId);
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback("Processamento salarial", result?.message, "Não foi possível remover o pagamento processado.")
      );
      return;
    }
    await loadBootstrap();
    setFeedback("Pagamento processado removido.");
  }

  async function deletePayrollMonth() {
    if (!window.confirm(`Tem a certeza de que pretende apagar todos os pagamentos processados de ${monthRef}?`)) return;
    const result = await window.payrollAPI.deletePayrollMonth(monthRef);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Processamento salarial", result?.message, "Não foi possível apagar os pagamentos do mês."));
      return;
    }
    await loadBootstrap();
    setFeedback(`Pagamentos processados de ${monthRef} removidos.`);
  }

  async function generatePayslip(runId) {
    if (!runId) {
      setFeedback("Não foi encontrado um recibo válido para gerar.");
      return;
    }
    const result = await window.payrollAPI.generatePayslip(runId);
    if (!result?.ok) {
      setFeedback("Não foi possível gerar o recibo em PDF.");
      return;
    }
    setFeedback(`Recibo gerado em ${result.path}`);
  }

  async function generatePayslipsBatch() {
    const hasRunsForMonth = (boot?.payrollRuns || []).some((run) => run.month_ref === monthRef);
    if (!hasRunsForMonth) {
      setFeedback(`Não existem salários processados em ${monthRef} para gerar recibos em lote.`);
      return;
    }
    const result = await window.payrollAPI.generatePayslipsByMonth(monthRef);
    if (!result?.ok) {
      setFeedback(result?.message || "Não foi possível gerar os recibos em lote.");
      return;
    }
    setFeedback(`Recibos em lote criados em ${result.path}`);
  }

  function updateReportPreset(preset) {
    const nextRange = applyReportPreset(preset, monthRef);
    setReportFilters((current) => ({
      ...current,
      ...nextRange,
      preset
    }));
  }

  function updateReportFilterField(field, value) {
    setReportFilters((current) => ({
      ...current,
      [field]: value,
      preset: field === "employeeId" ? current.preset : "custom"
    }));
  }

  async function generateMonthlyPackage() {
    const filters = buildReportRequestFilters(reportFilters, monthRef);
    const hasRunsForPeriod = (boot?.payrollRuns || []).some((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    );
    if (!hasRunsForPeriod) {
      setFeedback("Não existem salários processados no período selecionado para exportar o pacote mensal.");
      return;
    }
    const result = await window.payrollAPI.generateMonthlyPackage(filters);
    if (!result?.ok) {
      setFeedback(result?.message || "Não foi possível gerar o pacote mensal.");
      return;
    }
    setFeedback(`Pacote mensal criado em ${result.path}`);
  }

  async function generateReport(type) {
    const filters = buildReportRequestFilters(reportFilters, monthRef);
    const normalizedType = String(type || "").toLowerCase();
    const annualReportTypes = ["anual", "irt-anual", "inss-anual"];
    const attendanceReportTypes = ["faltas", "presencas"];
    const shiftReportTypes = ["turnos-trabalhador", "turnos-departamento", "mapa-docente"];
    const hasRunsForPeriod = (boot?.payrollRuns || []).some((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    );
    const hasAttendanceForPeriod = (boot?.attendanceRecords || []).some((item) =>
      matchesDateRange(item.attendance_date, filters) &&
      (!filters.employeeId || String(item.employee_id) === String(filters.employeeId))
    );
    if (attendanceReportTypes.includes(normalizedType) && !hasAttendanceForPeriod) {
      setFeedback(
        normalizedType === "faltas"
          ? "Não existem registos de faltas no período selecionado para gerar este relatório."
          : "Não existem registos de presenças no período selecionado para gerar este relatório."
      );
      return;
    }
    if (
      !annualReportTypes.includes(normalizedType) &&
      !attendanceReportTypes.includes(normalizedType) &&
      !shiftReportTypes.includes(normalizedType) &&
      !hasRunsForPeriod
    ) {
      setFeedback("Não existem salários processados no período selecionado para gerar este relatório.");
      return;
    }
    const result = await window.payrollAPI.generateReport({ type, ...filters });
    if (!result?.ok) {
      setFeedback(result?.message || "Não foi possível gerar o relatório.");
      return;
    }
    setFeedback(`Relatório gerado em ${result.path}`);
  }

  async function exportMonthlyPayrollExcel() {
    const filters = buildReportRequestFilters(reportFilters, monthRef);
    const hasRunsForPeriod = (boot?.payrollRuns || []).some((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    );
    if (!hasRunsForPeriod) {
      setFeedback("Não existem salários processados no período selecionado para exportar a folha mensal.");
      return;
    }
    const result = await window.payrollAPI.exportMonthlyPayrollExcel(filters);
    if (!result?.ok) {
      setFeedback("Não foi possível exportar a folha salarial para Excel.");
      return;
    }
    setFeedback(`Folha salarial Excel criada em ${result.path}`);
  }

  async function exportStatePaymentsExcel(filtersOverride = null) {
    const filters = filtersOverride || buildReportRequestFilters(reportFilters, monthRef);
    const hasRunsForPeriod = (boot?.payrollRuns || []).some((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    );
    if (!hasRunsForPeriod) {
      setFeedback("Não existem valores legais processados no período selecionado para exportar o mapa do Estado.");
      return;
    }
    const result = await window.payrollAPI.exportStatePaymentsExcel(filters);
    if (!result?.ok) {
      setFeedback("Não foi possível exportar o pagamento ao Estado para Excel.");
      return;
    }
    setFeedback(`Mapa Excel de pagamento ao Estado criado em ${result.path}`);
  }

  async function exportAgtMonthlyRemunerationExcel(filtersOverride = null) {
    const filters = filtersOverride || buildReportRequestFilters(reportFilters, monthRef);
    const hasRunsForPeriod = (boot?.payrollRuns || []).some((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    );
    if (!hasRunsForPeriod) {
      setFeedback("Nao existem salarios processados no periodo selecionado para exportar o mapa mensal AGT.");
      return;
    }
    const result = await window.payrollAPI.exportAgtMonthlyRemunerationExcel(filters);
    if (!result?.ok) {
      setFeedback(result?.message || "Nao foi possivel exportar o mapa mensal de remuneracoes AGT.");
      return;
    }
    setFeedback(`Mapa mensal AGT criado em ${result.path}`);
  }

  async function saveAgtSubmission() {
    if (typeof window.payrollAPI?.saveAgtSubmission !== "function") {
      setFeedback("Esta versao da aplicacao ainda nao suporta o registo operacional da submissao AGT.");
      return;
    }

    const result = await window.payrollAPI.saveAgtSubmission({
      ...agtSubmissionForm,
      month_ref: monthRef,
      submission_mode: agtSubmissionForm.submission_mode || agtMonthlyRemunerationMap.submissionMode
    });
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Entrega AGT", result?.message, "Não foi possível guardar o estado da submissão AGT."));
      return;
    }

    await loadBootstrap();
    setFeedback(`Estado da submissão AGT de ${monthRef} atualizado para ${result.submission?.status || "rascunho"}.`);
  }

  async function exportAttendanceExcel(reportType) {
    const filters = buildReportRequestFilters(reportFilters, monthRef);
    const hasAttendanceForPeriod = (boot?.attendanceRecords || []).some((item) =>
      matchesDateRange(item.attendance_date, filters) &&
      (!filters.employeeId || String(item.employee_id) === String(filters.employeeId))
    );
    if (!hasAttendanceForPeriod) {
      setFeedback(
        reportType === "faltas"
          ? "Não existem registos de faltas no período selecionado para exportação."
          : "Não existem registos de presenças no período selecionado para exportação."
      );
      return;
    }

    const result = await window.payrollAPI.exportAttendanceExcel({ ...filters, reportType });
    if (!result?.ok) {
      setFeedback(result?.message || "Não foi possível exportar o relatório de assiduidade.");
      return;
    }
    setFeedback(
      reportType === "faltas"
        ? `Relatório de faltas em Excel criado em ${result.path}`
        : `Relatório de presenças em Excel criado em ${result.path}`
    );
  }

  async function exportShiftMapExcel(reportType) {
    const filters = buildReportRequestFilters(reportFilters, monthRef);
    const result = await window.payrollAPI.exportShiftMapExcel({ ...filters, reportType });
    if (!result?.ok) {
      setFeedback(result?.message || "Não foi possível exportar o mapa de turnos.");
      return;
    }

    const labels = {
      "turnos-trabalhador": "Mapa mensal de turnos por trabalhador",
      "turnos-departamento": "Mapa mensal de turnos por departamento",
      "mapa-docente": "Mapa docente mensal"
    };
    setFeedback(`${labels[reportType] || "Mapa de turnos"} em Excel criado em ${result.path}`);
  }

  async function exportBankPayroll(format = "csv") {
    const filters = buildReportRequestFilters(reportFilters, monthRef);
    const hasRunsForPeriod = (boot?.payrollRuns || []).some((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    );
    if (!hasRunsForPeriod) {
      setFeedback("Não existem salários processados no período selecionado para exportação bancária.");
      return;
    }
    if ((format === "ps2" || format === "psx") && (!boot?.company?.origin_bank_code || !boot?.company?.origin_account)) {
      setFeedback("Configure o banco e a conta de origem da empresa antes de gerar ficheiros PS2 ou PSX.");
      return;
    }
    const effectiveBankCode =
      format === "ps2" || format === "psx"
        ? boot?.company?.origin_bank_code || selectedBankCode
        : selectedBankCode;
    const bank = angolaBanks.find((item) => item.code === effectiveBankCode) || angolaBanks[0];
    const result = await window.payrollAPI.exportBankPayroll({ bank, format, ...filters });
    if (!result?.ok) {
      setFeedback(
        contextualizeFeedback("Exportação bancária", result?.message, "Não foi possível exportar o ficheiro bancário.")
      );
      return;
    }
    setFeedback(`Exportação ${String(result.format || format).toUpperCase()} de ${result.bank} criada em ${result.path}`);
  }

  async function generateBackup() {
    const result = await window.payrollAPI.createBackup();
    if (result?.ok) {
      await loadBootstrap();
    }
    setFeedback(`Backup criado em ${result.path}`);
  }

  async function restoreBackup(backupPath) {
    if (!window.confirm("Tem a certeza de que pretende restaurar este backup? A aplicação será reiniciada.")) return;
    const result = await window.payrollAPI.restoreBackup(backupPath);
    if (!result?.ok) {
      setFeedback("Não foi possível restaurar o backup selecionado.");
      return;
    }
    setFeedback(result.message || "Backup restaurado. A aplicação será reiniciada.");
  }

  async function checkForUpdates(silent = false) {
    setUpdateState((current) => ({
      ...current,
      checking: true,
      message: silent ? current.message : "A verificar atualizações..."
    }));

    try {
      const result = await window.payrollAPI.checkForUpdates();
      if (!result?.ok) {
        const message = contextualizeFeedback("Atualizações", result?.message, "Não foi possível verificar atualizações.");
        setUpdateState((current) => ({
          ...current,
          checking: false,
          available: false,
          downloaded: false,
          message
        }));
        if (!silent) {
          setFeedback(message);
        }
        return;
      }

      const message = result.available
        ? `Nova versão disponível: ${result.latestVersion}.`
        : "A aplicação já se encontra atualizada.";

      setUpdateState((current) => ({
        ...current,
        checking: false,
        currentVersion: result.currentVersion || current.currentVersion,
        latestVersion: result.latestVersion || current.latestVersion,
        releaseName: result.releaseName || "",
        available: Boolean(result.available),
        downloaded: Boolean(result.alreadyDownloaded),
        path: result.path || current.path,
        publishedAt: result.publishedAt || "",
        message
      }));
      if (!silent && result.available) {
        setFeedback(message);
      }
    } catch {
      const message = "Falha ao contactar o GitHub para verificar atualizações.";
      setUpdateState((current) => ({ ...current, checking: false, message }));
      if (!silent) {
        setFeedback(message);
      }
    }
  }

  async function downloadUpdate() {
    setUpdateState((current) => ({
      ...current,
      downloading: true,
      message: "A descarregar atualização..."
    }));

    try {
      const result = await window.payrollAPI.downloadUpdate();
      if (!result?.ok) {
        const message = contextualizeFeedback("Atualizações", result?.message, "Não foi possível descarregar a atualização.");
        setUpdateState((current) => ({ ...current, downloading: false, message }));
        setFeedback(message);
        return;
      }

      const message = result.available
        ? `Atualização descarregada em ${result.path}.`
        : result.message || "A aplicação já se encontra atualizada.";

      setUpdateState((current) => ({
        ...current,
        downloading: false,
        available: Boolean(result.available),
        downloaded: Boolean(result.downloaded),
        currentVersion: result.currentVersion || current.currentVersion,
        latestVersion: result.latestVersion || current.latestVersion,
        releaseName: result.releaseName || current.releaseName,
        path: result.path || "",
        message
      }));
      setFeedback(message);
    } catch {
      const message = "Falha ao descarregar a atualização.";
      setUpdateState((current) => ({ ...current, downloading: false, message }));
      setFeedback(message);
    }
  }

  async function installUpdate() {
    setUpdateState((current) => ({
      ...current,
      installing: true,
      message: "A abrir o instalador da atualização..."
    }));

    try {
      const result = await window.payrollAPI.installUpdate();
      if (!result?.ok) {
        const message = contextualizeFeedback("Atualizações", result?.message, "Não foi possível iniciar a instalação.");
        setUpdateState((current) => ({ ...current, installing: false, message }));
        setFeedback(message);
        return;
      }

      const message = "Instalador aberto. Conclua a atualização para substituir a versão atual.";
      setUpdateState((current) => ({ ...current, installing: false, message }));
      setFeedback("Instalador aberto. Conclua a atualização e siga o assistente.");
    } catch {
      const message = "Falha ao abrir o instalador descarregado.";
      setUpdateState((current) => ({ ...current, installing: false, message }));
      setFeedback(message);
    }
  }

  async function chooseLogo() {
    const file = await window.payrollAPI.selectLogo();
    if (file) {
      setCompanyForm((current) => ({ ...current, logo_path: file }));
    }
  }

  function editUserRow(item) {
    setUserForm({
      id: item.id,
      full_name: item.full_name,
      email: item.email || "",
      username: item.username,
      password: "",
      role: item.role,
      active: Boolean(item.active)
    });
  }

  async function saveUser(event) {
    event.preventDefault();
    const result = await window.payrollAPI.saveUser(userForm);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Utilizadores", result?.message, "Não foi possível guardar o utilizador."));
      return;
    }
    setUserForm(initialUserForm);
    await loadBootstrap();
    setFeedback("Utilizador guardado com sucesso.");
  }

  async function removeUser(userId) {
    if (!window.confirm("Tem a certeza de que pretende apagar este utilizador?")) return;
    const result = await window.payrollAPI.deleteUser(userId);
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Utilizadores", result?.message, "Não foi possível remover o utilizador."));
      return;
    }
    if (user?.id === userId) {
      await logout();
      return;
    }
    await loadBootstrap();
    setFeedback("Utilizador removido.");
  }

  async function changeOwnPassword(event) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setFeedback("A confirmação da palavra-passe não coincide.");
      return;
    }
    const result = await window.payrollAPI.changePassword({
      userId: user.id,
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword
    });
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Palavra-passe", result?.message, "Não foi possível atualizar a palavra-passe."));
      return;
    }
    setUser((current) => ({ ...current, must_change_password: false }));
    setPasswordForm(initialPasswordForm);
    await loadBootstrap();
    setFeedback("Palavra-passe atualizada com sucesso.");
  }

  async function resetUserPassword(event) {
    event.preventDefault();
    const result = await window.payrollAPI.changePassword({
      userId: Number(resetPasswordForm.userId),
      newPassword: resetPasswordForm.newPassword,
      resetByAdmin: true
    });
    if (!result?.ok) {
      setFeedback(contextualizeFeedback("Utilizadores", result?.message, "Não foi possível redefinir a palavra-passe."));
      return;
    }
    setResetPasswordForm((current) => ({ ...current, newPassword: "" }));
    await loadBootstrap();
    setFeedback("Palavra-passe redefinida. O utilizador terá de a alterar no próximo início de sessão.");
  }

  const stats = useMemo(() => {
    if (!boot) {
      return { net: 0, deductions: 0, employees: 0, runs: 0 };
    }
    const runs = boot.payrollRuns.filter((run) => run.month_ref === monthRef);
    return {
      net: runs.reduce((sum, run) => sum + run.net_salary, 0),
      deductions: runs.reduce((sum, run) => sum + run.mandatory_deductions + run.absence_deduction, 0),
      employees: boot.employees.length,
      runs: runs.length
    };
  }, [boot, monthRef]);

  const reportStats = useMemo(() => {
    if (!boot) {
      return { net: 0, deductions: 0, employees: 0, runs: 0 };
    }
    const runs = boot.payrollRuns.filter((run) =>
      matchesMonthRange(run.month_ref, reportRequestFilters) &&
      (!reportRequestFilters.employeeId || String(run.employee_id) === String(reportRequestFilters.employeeId))
    );
    return {
      net: runs.reduce((sum, run) => sum + run.net_salary, 0),
      deductions: runs.reduce((sum, run) => sum + run.mandatory_deductions + run.absence_deduction, 0),
      employees: reportRequestFilters.employeeId ? runs.length : boot.employees.length,
      runs: runs.length
    };
  }, [boot, reportRequestFilters]);

  const statePayments = useMemo(() => {
    if (!boot) {
      return {
        rows: [],
        totals: { employeeInss: 0, employerInss: 0, irt: 0, total: 0 }
      };
    }

    const rows = boot.payrollRuns
      .filter((run) =>
        matchesMonthRange(run.month_ref, stateRequestFilters) &&
        (!stateRequestFilters.employeeId || String(run.employee_id) === String(stateRequestFilters.employeeId))
      )
      .map((run) => {
        const employeeInss = Number(run.inss_amount || 0);
        const employerInss = Number(run.summary_json?.employerInssAmount || 0);
        const irt = Number(run.irt_amount || 0);
        return {
          id: run.id,
          fullName: run.full_name,
          jobTitle: run.job_title || "-",
          department: run.department || "-",
          employeeInss,
          employerInss,
          irt,
          totalState: employeeInss + employerInss + irt
        };
      });

    return {
      rows,
      totals: rows.reduce(
        (acc, row) => ({
          employeeInss: acc.employeeInss + row.employeeInss,
          employerInss: acc.employerInss + row.employerInss,
          irt: acc.irt + row.irt,
          total: acc.total + row.totalState
        }),
        { employeeInss: 0, employerInss: 0, irt: 0, total: 0 }
      )
    };
  }, [boot, stateRequestFilters]);

  const agtMonthlyRemunerationMap = useMemo(
    () => buildAgtMonthlyRemunerationMapFromBoot(boot, stateRequestFilters),
    [boot, stateRequestFilters]
  );

  const selectedAttendancePeriod = useMemo(() => {
    if (!boot) {
      return {
        month_ref: monthRef,
        status: "open",
        closed_at: null,
        closed_by_name: null
      };
    }

    return (
      boot.attendancePeriods?.find((period) => period.month_ref === monthRef) || {
        month_ref: monthRef,
        status: "open",
        closed_at: null,
        closed_by_name: null
      }
    );
  }, [boot, monthRef]);

  const filteredEmployees = useMemo(() => {
    if (!boot) return [];
      return boot.employees.filter((employee) => {
        const matchesSearch =
          !employeeFilters.search ||
          `${employee.full_name} ${employee.job_title} ${employee.department} ${employee.bi || ""} ${employee.nif || ""} ${employee.social_security_number || ""} ${employee.attendance_code || ""} ${employee.shift_name || ""}`.toLowerCase().includes(employeeFilters.search.toLowerCase());
      const matchesStatus = employeeFilters.status === "todos" || employee.status === employeeFilters.status;
      const matchesDepartment =
        !employeeFilters.department ||
        String(employee.department || "").toLowerCase().includes(employeeFilters.department.toLowerCase());
      return matchesSearch && matchesStatus && matchesDepartment;
    });
  }, [boot, employeeFilters]);

  const filteredEvents = useMemo(() => {
    return events.filter((item) => {
      const matchesSearch =
        !eventFilters.search ||
        `${item.description || ""} ${item.event_type || ""} ${item.event_date || ""}`.toLowerCase().includes(eventFilters.search.toLowerCase());
      const matchesType = eventFilters.type === "todos" || item.event_type === eventFilters.type;
      const matchesPeriod = matchesDateRange(item.event_date, historyRequestFilters);
      return matchesSearch && matchesType && matchesPeriod;
    });
  }, [eventFilters, events, historyRequestFilters]);

  const filteredFinancialObligations = useMemo(() => {
    return financialObligations.filter((item) => matchesMonthRange(item.start_month_ref, historyRequestFilters));
  }, [financialObligations, historyRequestFilters]);

  const filteredAttendanceRecords = useMemo(() => {
    return attendanceRecords.filter((item) => {
      const matchesSearch =
        !attendanceFilters.search ||
        `${item.attendance_date || ""} ${item.status || ""} ${item.notes || ""} ${item.shift_name || ""} ${item.check_in_time || ""} ${item.check_out_time || ""} ${item.source || ""}`
          .toLowerCase()
          .includes(attendanceFilters.search.toLowerCase());
      const matchesStatus = attendanceFilters.status === "todos" || item.status === attendanceFilters.status;
      const matchesMonth = !attendanceFilters.monthRef || String(item.attendance_date || "").slice(0, 7) === attendanceFilters.monthRef;
      const matchesPeriod = matchesDateRange(item.attendance_date, historyRequestFilters);
      return matchesSearch && matchesStatus && matchesMonth && matchesPeriod;
    });
  }, [attendanceFilters, attendanceRecords, historyRequestFilters]);

  const filteredLeaveRequests = useMemo(() => {
    return leaveRequests.filter((item) => {
      const matchesSearch =
        !leaveFilters.search ||
          `${item.reason || ""} ${item.record_type || ""} ${item.start_date || ""} ${item.end_date || ""} ${item.document_ref || ""}`.toLowerCase().includes(leaveFilters.search.toLowerCase());
      const matchesType = leaveFilters.type === "todos" || item.record_type === leaveFilters.type;
      const matchesStatus = leaveFilters.status === "todos" || item.status === leaveFilters.status;
      const matchesPeriod =
        !historyRequestFilters.startDate ||
        !historyRequestFilters.endDate ||
        (
          String(item.start_date || "") <= historyRequestFilters.endDate &&
          String(item.end_date || item.start_date || "") >= historyRequestFilters.startDate
        );
      return matchesSearch && matchesType && matchesStatus && matchesPeriod;
    });
  }, [historyRequestFilters, leaveFilters, leaveRequests]);

  const filteredVacationRequests = useMemo(() => {
    return vacationRequests.filter((item) => {
      const matchesSearch =
        !vacationFilters.search ||
          `${item.start_date || ""} ${item.end_date || ""} ${item.notes || ""} ${item.status || ""}`
          .toLowerCase()
          .includes(vacationFilters.search.toLowerCase());
      const matchesStatus = vacationFilters.status === "todos" || item.status === vacationFilters.status;
      const matchesYear = !vacationFilters.yearRef || item.year_ref === vacationFilters.yearRef;
      const matchesPeriod =
        !historyRequestFilters.startDate ||
        !historyRequestFilters.endDate ||
        (
          String(item.start_date || "") <= historyRequestFilters.endDate &&
          String(item.end_date || item.start_date || "") >= historyRequestFilters.startDate
        );
      return matchesSearch && matchesStatus && matchesYear && matchesPeriod;
    });
  }, [historyRequestFilters, vacationFilters, vacationRequests]);

  const activeVacationBalance = useMemo(
    () =>
      vacationBalances[0] || {
        employee_id: vacationBalanceForm.employee_id,
        year_ref: vacationFilters.yearRef,
        entitled_days: Number(vacationBalanceForm.entitled_days || 22),
        carried_days: Number(vacationBalanceForm.carried_days || 0),
        manual_adjustment: Number(vacationBalanceForm.manual_adjustment || 0),
        approved_days: 0,
        taken_days: 0,
        pending_days: 0,
        remaining_days:
          Number(vacationBalanceForm.entitled_days || 22) +
          Number(vacationBalanceForm.carried_days || 0) +
          Number(vacationBalanceForm.manual_adjustment || 0),
        total_entitlement:
          Number(vacationBalanceForm.entitled_days || 22) +
          Number(vacationBalanceForm.carried_days || 0) +
          Number(vacationBalanceForm.manual_adjustment || 0)
      },
    [vacationBalances, vacationBalanceForm, vacationFilters.yearRef]
  );

  const filteredPayrollRuns = useMemo(() => {
    const runs = (boot?.payrollRuns || []).filter((run) => run.month_ref === monthRef);
    return runs.filter((run) =>
      !processingFilters.search ||
      `${run.full_name} ${run.job_title || ""} ${run.department || ""}`.toLowerCase().includes(processingFilters.search.toLowerCase())
    );
  }, [boot, monthRef, processingFilters]);

  const filteredStatePaymentRows = useMemo(() => {
    return statePayments.rows.filter((row) =>
      !stateFilters.search ||
      `${row.fullName} ${row.jobTitle || ""} ${row.department || ""}`.toLowerCase().includes(stateFilters.search.toLowerCase())
    );
  }, [statePayments.rows, stateFilters]);

  const filteredAgtMonthlyRemunerationRows = useMemo(() => {
    return agtMonthlyRemunerationMap.rows.filter((row) =>
      !stateFilters.search ||
      `${row.fullName} ${row.jobTitle || ""} ${row.department || ""} ${row.nif || ""} ${row.bi || ""}`
        .toLowerCase()
        .includes(stateFilters.search.toLowerCase())
    );
  }, [agtMonthlyRemunerationMap.rows, stateFilters]);

  const filteredAuditLogs = useMemo(() => {
    return (boot?.auditLogs || []).filter((item) => {
      const matchesPeriod =
        !historyRequestFilters.startDate ||
        !historyRequestFilters.endDate ||
        matchesDateRange(String(item.created_at || "").slice(0, 10), historyRequestFilters);
      const matchesUser = !auditFilters.userName || String(item.user_name || "").toLowerCase().includes(auditFilters.userName.toLowerCase());
      const matchesAction = !auditFilters.action || String(item.action || "").toLowerCase().includes(auditFilters.action.toLowerCase());
      const matchesSearch =
        !auditFilters.search ||
        `${item.entity_label || ""} ${item.entity_type || ""} ${item.action || ""} ${item.month_ref || ""}`.toLowerCase().includes(auditFilters.search.toLowerCase());
      return matchesPeriod && matchesUser && matchesAction && matchesSearch;
    });
  }, [auditFilters, boot, historyRequestFilters]);

  const dashboardAlerts = useMemo(() => {
    if (!boot) {
      return [];
    }

    const missingIban = boot.employees.filter((employee) => !String(employee.iban || "").trim());
    const missingBankData = boot.employees.filter(
      (employee) => !String(employee.bank_code || "").trim() || !String(employee.bank_account || "").trim()
    );
    const documentAlerts = Array.isArray(boot.documentAlerts) ? boot.documentAlerts : [];
    const expiredDocuments = documentAlerts.filter((item) => item.lifecycle_status === "expired");
    const expiringDocuments = documentAlerts.filter((item) => item.lifecycle_status === "expiring");
    const alerts = [];

    if (!boot.company.name || !boot.company.nif) {
      alerts.push({
        id: "company-profile",
        tone: "danger",
        title: "Dados da empresa incompletos",
        description: "Preencha o nome e o NIF da empresa para evitar falhas em recibos e relatórios.",
        actionLabel: "Corrigir",
        tab: "utilizador"
      });
    }

    if (!boot.company.origin_account) {
      alerts.push({
        id: "origin-account",
        tone: "warning",
        title: "Conta de origem por configurar",
        description: "A exportação PS2 e PSX exige a conta de origem da empresa nas configurações.",
        actionLabel: "Configurar",
        tab: "utilizador"
      });
    }

    const attendancePeriodClosed = boot.attendancePeriods?.some(
      (period) => period.month_ref === monthRef && period.status === "closed"
    );
    if (!attendancePeriodClosed) {
      alerts.push({
        id: "attendance-open",
        tone: "warning",
        title: "Assiduidade por fechar",
        description: `Feche a assiduidade de ${monthRef} antes de processar a folha salarial.`,
        actionLabel: "Rever assiduidade",
        tab: "eventos"
      });
    }

    if (missingIban.length) {
      alerts.push({
        id: "missing-iban",
        tone: "warning",
        title: `${missingIban.length} funcionário(s) sem IBAN`,
        description: "Alguns colaboradores ainda não têm IBAN preenchido para conferência e exportação.",
        actionLabel: "Rever funcionários",
        tab: "funcionarios"
      });
    }

    if (missingBankData.length) {
      alerts.push({
        id: "missing-bank-data",
        tone: "danger",
        title: `${missingBankData.length} funcionário(s) sem banco ou conta`,
        description: "A exportação bancária oficial exige banco e número da conta bancária em todos os funcionários.",
        actionLabel: "Completar dados",
        tab: "funcionarios"
      });
    }

    if (expiredDocuments.length) {
      alerts.push({
        id: "employee-documents-expired",
        tone: "danger",
        title: `${expiredDocuments.length} documento(s) laboral(is) expirado(s)`,
        description: buildDocumentAlertDescription(expiredDocuments, "expired"),
        actionLabel: "Abrir arquivo laboral",
        tab: "historico",
        historyTab: "documentos",
        employeeId: expiredDocuments.length === 1 ? expiredDocuments[0].employee_id : null
      });
    }

    if (expiringDocuments.length) {
      alerts.push({
        id: "employee-documents-expiring",
        tone: "warning",
        title: `${expiringDocuments.length} documento(s) laboral(is) a expirar`,
        description: buildDocumentAlertDescription(expiringDocuments, "expiring"),
        actionLabel: "Rever documentos",
        tab: "historico",
        historyTab: "documentos",
        employeeId: expiringDocuments.length === 1 ? expiringDocuments[0].employee_id : null
      });
    }

    if (!boot.payrollRuns.some((run) => run.month_ref === monthRef)) {
      alerts.push({
        id: "month-not-processed",
        tone: "info",
        title: "Mês ainda não processado",
        description: `Ainda não existe folha processada para ${monthRef}.`,
        actionLabel: "Ir ao processamento",
        tab: "processamento"
      });
    }

    if (boot.payrollPeriods?.some((period) => period.month_ref === monthRef && period.status === "closed")) {
      alerts.push({
        id: "period-closed",
        tone: "warning",
        title: "Período fechado",
        description: `O período ${monthRef} está fechado e exige reabertura para novas alterações.`,
        actionLabel: "Ver período",
        tab: "processamento"
      });
    }

    return alerts;
  }, [boot, monthRef]);

  const licenseBanner = useMemo(
    () => buildLicenseBannerState(licenseState, licenseClock),
    [licenseState, licenseClock]
  );

  if (!authChecked) {
    return <div className="splash-screen">A carregar o sistema salarial...</div>;
  }

  if (!licenseState.canUseApp) {
    return (
      <LicenseScreen
        licenseState={licenseState}
        plans={licensePlans}
        licenseMode={licenseMode}
        setLicenseMode={setLicenseMode}
        licenseApiState={licenseApiState}
        licenseApiUrlForm={licenseApiUrlForm}
        setLicenseApiUrlForm={setLicenseApiUrlForm}
        saveLicenseApiBaseUrl={saveLicenseApiBaseUrl}
        activationForm={licenseActivationForm}
        setActivationForm={setLicenseActivationForm}
        purchaseForm={licensePurchaseForm}
        setPurchaseForm={setLicensePurchaseForm}
        paymentState={licensePaymentState}
        handleActivateLicense={handleActivateLicense}
        handleCreateLicensePayment={handleCreateLicensePayment}
        handleCheckLicensePayment={handleCheckLicensePayment}
        handleClose={handleCloseLicenseGate}
        feedback={feedback || licenseState.message}
      />
    );
  }

  if (!user) {
    return (
        <LoginScreen
          authMode={authMode}
          setAuthMode={setAuthMode}
          accessState={accessState}
          loginForm={loginForm}
          setLoginForm={setLoginForm}
          forgotPasswordForm={forgotPasswordForm}
          setForgotPasswordForm={setForgotPasswordForm}
          registrationForm={registrationForm}
          setRegistrationForm={setRegistrationForm}
          handleLogin={handleLogin}
          handlePasswordResetRequest={handlePasswordResetRequest}
          handlePasswordResetCompletion={handlePasswordResetCompletion}
          handleRegister={handleRegister}
          feedback={feedback}
        />
    );
  }

  if (!boot) {
    return <div className="splash-screen">A carregar o sistema salarial...</div>;
  }

  const payrollRuns = boot.payrollRuns.filter((run) => run.month_ref === monthRef);
  const selectedPeriod =
    boot.payrollPeriods?.find((period) => period.month_ref === monthRef) || {
      month_ref: monthRef,
      status: "open"
    };
  const selectedPayrollFiscalStatus =
    boot?.payrollFiscalStatuses?.find((status) => status.month_ref === monthRef) || null;
  const affectedPayrollFiscalMonths = boot?.payrollFiscalStatuses?.filter((status) => status.hasFiscalDrift) || [];
  const selectedAgtSubmission =
    selectedStateMonthRef
      ? boot?.agtMonthlySubmissions?.find((item) => item.month_ref === selectedStateMonthRef) || null
      : null;

  const autoCalculatedEventAmount = getAutoEventAmount(eventForm);
  const isAutoCalculatedEvent = [
    "absence",
    "leave",
    "vacation_bonus",
    "christmas_bonus",
    "overtime_50",
    "overtime_100"
  ].includes(eventForm.event_type);
  const selectedHistoryEmployeeId =
    attendanceForm.employee_id || eventForm.employee_id || employeeDocumentForm.employee_id || leaveForm.employee_id || vacationForm.employee_id || "";

  const pageActions = tab === "configuracoes"
    ? (
        <>
          <label className="topbar-control">
            <span>Mês de trabalho</span>
            <input type="month" value={monthRef} onChange={(event) => setMonthRef(event.target.value)} />
          </label>

          <div className="theme-switch" role="group" aria-label="Tema">
            <button
              type="button"
              className={theme === "dark" ? "secondary-btn active-theme" : "secondary-btn"}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
            <button
              type="button"
              className={theme === "light" ? "secondary-btn active-theme" : "secondary-btn"}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
          </div>

          <div className="page-intro__action-group">
            <button type="button" className="secondary-btn" onClick={generateBackup}>
              Backup
            </button>
            <button type="button" className="secondary-btn" onClick={() => setTab("configuracoes")}>
              Configurações
            </button>
            <button type="button" className="secondary-btn" onClick={logout}>
              Sair
            </button>
          </div>
        </>
      )
    : null;

  return (
    <AppShell
      tab={tab}
      setTab={setTab}
      user={user}
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      monthRef={monthRef}
      setMonthRef={setMonthRef}
      runPayroll={runPayroll}
      updateState={updateState}
      licenseBanner={licenseBanner}
      theme={theme}
      setTheme={setTheme}
      pageMeta={pageMeta}
      pageActions={pageActions}
    >

        {user.must_change_password && (
          <div className="feedback feedback--warning banner">
            A palavra-passe inicial ainda está ativa. Atualize-a na sua área de conta para continuar com mais segurança.
          </div>
        )}

        {feedback && (
          <div className={`feedback feedback--${getFeedbackTone(feedback)} banner`}>
            {feedback}
          </div>
        )}

        {tab === "dashboard" && (
          <DashboardSection
            stats={stats}
            monthRef={monthRef}
            boot={boot}
            formatMoney={formatMoney}
            generatePayslip={generatePayslip}
            alerts={dashboardAlerts}
            updateState={updateState}
            setTab={setTab}
            onAlertAction={handleDashboardAlertAction}
          />
        )}

        {tab === "funcionarios" && (
          <EmployeesSection
            employeeForm={employeeForm}
            setEmployeeForm={setEmployeeForm}
            saveEmployee={saveEmployee}
            boot={boot}
            user={user}
            banks={angolaBanks}
            employeeFilters={employeeFilters}
            setEmployeeFilters={setEmployeeFilters}
            employees={filteredEmployees}
            formatMoney={formatMoney}
            editEmployee={editEmployee}
            deleteEmployee={deleteEmployee}
          />
        )}

        {tab === "eventos" && (
          <EventsSection
            eventForm={eventForm}
            setEventForm={setEventForm}
            saveEvent={saveEvent}
            financialForm={financialForm}
            setFinancialForm={setFinancialForm}
            saveFinancialObligation={saveFinancialObligation}
            attendanceForm={attendanceForm}
            setAttendanceForm={setAttendanceForm}
            saveAttendanceRecord={saveAttendanceRecord}
            attendanceImportForm={attendanceImportForm}
            setAttendanceImportForm={setAttendanceImportForm}
            chooseAttendanceFile={chooseAttendanceFile}
            importAttendanceFile={importAttendanceFile}
            syncAttendanceFolder={syncAttendanceFolder}
            leaveForm={leaveForm}
            setLeaveForm={setLeaveForm}
            saveLeaveRequest={saveLeaveRequest}
            vacationBalanceForm={vacationBalanceForm}
            setVacationBalanceForm={setVacationBalanceForm}
            saveVacationBalance={saveVacationBalance}
            vacationForm={vacationForm}
            setVacationForm={setVacationForm}
            saveVacationRequest={saveVacationRequest}
            boot={boot}
            selectEmployee={selectEmployee}
            events={filteredEvents}
            financialObligations={financialObligations}
            attendanceRecords={filteredAttendanceRecords}
            rawAttendanceRecords={attendanceRecords}
            attendanceImports={attendanceImports}
            attendanceImportLogs={attendanceImportLogs}
            leaveRequests={filteredLeaveRequests}
            vacationBalance={activeVacationBalance}
            vacationRequests={filteredVacationRequests}
            eventFilters={eventFilters}
            setEventFilters={setEventFilters}
            attendanceFilters={attendanceFilters}
            setAttendanceFilters={setAttendanceFilters}
            monthRef={monthRef}
            attendancePeriod={selectedAttendancePeriod}
            leaveFilters={leaveFilters}
            setLeaveFilters={setLeaveFilters}
            vacationFilters={vacationFilters}
            setVacationFilters={setVacationFilters}
            formatMoney={formatMoney}
            deleteFinancialObligation={deleteFinancialObligation}
            deleteAttendanceRecord={deleteAttendanceRecord}
            approveAttendanceAdjustments={approveAttendanceAdjustments}
            deleteEvent={deleteEvent}
            setLeaveRequestStatus={setLeaveRequestStatus}
            deleteLeaveRequest={deleteLeaveRequest}
            setVacationRequestStatus={setVacationRequestStatus}
            deleteVacationRequest={deleteVacationRequest}
            closeAttendancePeriod={closeAttendancePeriod}
            reopenAttendancePeriod={reopenAttendancePeriod}
            autoCalculatedAmount={autoCalculatedEventAmount}
            calculateAutomaticEvent={getAutoEventCalculationDetails}
            isAutoCalculatedEvent={isAutoCalculatedEvent}
            user={user}
          />
        )}

        {tab === "historico" && (
          <HistorySection
            boot={boot}
            selectedEmployeeId={selectedHistoryEmployeeId}
            selectEmployee={selectEmployee}
            formatMoney={formatMoney}
            historyFilters={historyFilters}
            updateHistoryPreset={updateHistoryPreset}
            updateHistoryFilterField={updateHistoryFilterField}
            preferredTab={historyActiveTab}
            onActiveTabChange={setHistoryActiveTab}
            employeeDocuments={employeeDocuments}
            employeeDocumentForm={employeeDocumentForm}
            setEmployeeDocumentForm={setEmployeeDocumentForm}
            documentFilters={documentFilters}
            setDocumentFilters={setDocumentFilters}
            chooseEmployeeDocumentFile={chooseEmployeeDocumentFile}
            saveEmployeeDocument={saveEmployeeDocument}
            editEmployeeDocument={editEmployeeDocument}
            openEmployeeDocument={openEmployeeDocument}
            deleteEmployeeDocument={deleteEmployeeDocument}
            resetEmployeeDocumentForm={resetEmployeeDocumentForm}
            events={filteredEvents}
            eventFilters={eventFilters}
            setEventFilters={setEventFilters}
            deleteEvent={deleteEvent}
            financialObligations={filteredFinancialObligations}
            deleteFinancialObligation={deleteFinancialObligation}
            leaveRequests={filteredLeaveRequests}
            leaveFilters={leaveFilters}
            setLeaveFilters={setLeaveFilters}
            setLeaveRequestStatus={setLeaveRequestStatus}
            deleteLeaveRequest={deleteLeaveRequest}
            attendanceRecords={filteredAttendanceRecords}
            attendanceFilters={attendanceFilters}
            setAttendanceFilters={setAttendanceFilters}
            attendancePeriod={selectedAttendancePeriod}
            monthRef={monthRef}
            deleteAttendanceRecord={deleteAttendanceRecord}
            vacationRequests={filteredVacationRequests}
            vacationFilters={vacationFilters}
            setVacationFilters={setVacationFilters}
            setVacationBalanceForm={setVacationBalanceForm}
            setVacationForm={setVacationForm}
            user={user}
            setVacationRequestStatus={setVacationRequestStatus}
            deleteVacationRequest={deleteVacationRequest}
            auditLogs={filteredAuditLogs}
            auditFilters={auditFilters}
            setAuditFilters={setAuditFilters}
            applyAuditFilters={applyAuditFilters}
            exportAuditLogs={exportAuditLogs}
            exportAuditExcel={exportAuditExcel}
          />
        )}

        {tab === "processamento" && (
          <ProcessingSection
            payrollRuns={filteredPayrollRuns}
            monthRef={monthRef}
            formatMoney={formatMoney}
            generatePayslip={generatePayslip}
            deletePayrollRun={deletePayrollRun}
            deletePayrollMonth={deletePayrollMonth}
            payrollFiscalStatus={selectedPayrollFiscalStatus}
            payrollFiscalAffectedMonths={affectedPayrollFiscalMonths}
            reprocessPreview={reprocessPreviewState}
            reprocessPayrollMonth={reprocessPayrollMonth}
            statePaymentRows={filteredStatePaymentRows}
            statePaymentTotals={statePayments.totals}
            period={selectedPeriod}
            user={user}
            closePayrollPeriod={closePayrollPeriod}
            reopenPayrollPeriod={reopenPayrollPeriod}
            processingFilters={processingFilters}
            setProcessingFilters={setProcessingFilters}
          />
        )}

        {tab === "estado" && (
          <StatePaymentsSection
            monthRef={monthRef}
            employees={boot?.employees || []}
            agtMonthlyRemunerationMap={agtMonthlyRemunerationMap}
            agtMonthlyRemunerationRows={filteredAgtMonthlyRemunerationRows}
            agtSubmission={selectedAgtSubmission}
            agtSubmissionForm={agtSubmissionForm}
            setAgtSubmissionForm={setAgtSubmissionForm}
            saveAgtSubmission={saveAgtSubmission}
            exportAgtMonthlyRemunerationExcel={() => exportAgtMonthlyRemunerationExcel(stateRequestFilters)}
            exportStatePaymentsExcel={() => exportStatePaymentsExcel(stateRequestFilters)}
            statePaymentRows={filteredStatePaymentRows}
            statePaymentTotals={statePayments.totals}
            formatMoney={formatMoney}
            stateFilters={stateFilters}
            updateStatePreset={updateStatePreset}
            updateStateFilterField={updateStateFilterField}
            selectedStateMonthRef={selectedStateMonthRef}
          />
        )}

        {tab === "relatorios" && (
          <ReportsSection
            monthRef={monthRef}
            reportFilters={reportFilters}
            updateReportPreset={updateReportPreset}
            updateReportFilterField={updateReportFilterField}
            employees={boot?.employees || []}
            generateReport={generateReport}
            generateMonthlyPackage={generateMonthlyPackage}
            generatePayslipsBatch={generatePayslipsBatch}
            exportMonthlyPayrollExcel={exportMonthlyPayrollExcel}
            exportAgtMonthlyRemunerationExcel={exportAgtMonthlyRemunerationExcel}
            exportStatePaymentsExcel={exportStatePaymentsExcel}
            exportAttendanceExcel={exportAttendanceExcel}
            exportShiftMapExcel={exportShiftMapExcel}
            exportBankPayroll={exportBankPayroll}
            selectedBankCode={selectedBankCode}
            setSelectedBankCode={setSelectedBankCode}
            banks={angolaBanks}
            stats={reportStats}
            formatMoney={formatMoney}
          />
        )}

        {tab === "utilizador" && isAdmin && (
          <UserSection
            user={user}
            company={boot.company}
            boot={boot}
            passwordForm={passwordForm}
            setPasswordForm={setPasswordForm}
            changeOwnPassword={changeOwnPassword}
            companyForm={companyForm}
            setCompanyForm={setCompanyForm}
            saveCompany={saveCompany}
            chooseLogo={chooseLogo}
            resetPasswordForm={resetPasswordForm}
            setResetPasswordForm={setResetPasswordForm}
            resetUserPassword={resetUserPassword}
            userForm={userForm}
            setUserForm={setUserForm}
            saveUser={saveUser}
            initialUserForm={initialUserForm}
            editUserRow={editUserRow}
            removeUser={removeUser}
            licenseState={licenseState}
            licensePlans={licensePlans}
            licenseBanner={licenseBanner}
            openLicenseCenter={openLicenseCenter}
            updateState={updateState}
            checkForUpdates={checkForUpdates}
            downloadUpdate={downloadUpdate}
            installUpdate={installUpdate}
          />
        )}

        {tab === "auditoria" && user.role === "admin" && (
          <AuditSection
            auditLogs={boot.auditLogs || []}
            auditFilters={auditFilters}
            setAuditFilters={setAuditFilters}
            applyAuditFilters={applyAuditFilters}
            exportAuditLogs={exportAuditLogs}
            exportAuditExcel={exportAuditExcel}
          />
        )}

        {tab === "configuracoes" && isAdmin && (
          <SettingsSection
            chooseAttendanceFolder={chooseAttendanceFolder}
            settingsForm={settingsForm}
            setSettingsForm={setSettingsForm}
            saveSettings={saveSettings}
            salaryScaleForm={salaryScaleForm}
            setSalaryScaleForm={setSalaryScaleForm}
            saveSalaryScale={saveSalaryScale}
            initialSalaryScale={initialSalaryScale}
            editSalaryScaleRow={editSalaryScaleRow}
            deleteSalaryScale={deleteSalaryScale}
            workShiftForm={workShiftForm}
            setWorkShiftForm={setWorkShiftForm}
            saveWorkShift={saveWorkShift}
            initialWorkShift={initialWorkShift}
            editWorkShiftRow={editWorkShiftRow}
            deleteWorkShift={deleteWorkShift}
            user={user}
            boot={boot}
            runtimeFlags={runtimeFlags}
            generateBackup={generateBackup}
            restoreBackup={restoreBackup}
          />
        )}

        {licenseCenterOpen && (
          <LicenseScreen
            embedded
            licenseState={licenseState}
            plans={licensePlans}
            licenseMode={licenseMode}
            setLicenseMode={setLicenseMode}
            licenseApiState={licenseApiState}
            licenseApiUrlForm={licenseApiUrlForm}
            setLicenseApiUrlForm={setLicenseApiUrlForm}
            saveLicenseApiBaseUrl={saveLicenseApiBaseUrl}
            activationForm={licenseActivationForm}
            setActivationForm={setLicenseActivationForm}
            purchaseForm={licensePurchaseForm}
            setPurchaseForm={setLicensePurchaseForm}
            paymentState={licensePaymentState}
            handleActivateLicense={handleActivateLicense}
            handleCreateLicensePayment={handleCreateLicensePayment}
            handleCheckLicensePayment={handleCheckLicensePayment}
            handleClose={closeLicenseCenter}
            feedback={feedback || licenseState.message}
          />
        )}
    </AppShell>
  );
}




