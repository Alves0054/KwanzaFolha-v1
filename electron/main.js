const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const licenseSource = require("./config/license-source");
const { createAppServices } = require("./services/core/create-app-services");
const { SecureStorageService } = require("./services/secure-storage");
const { InstallationIdentityService } = require("./services/installation-identity");
const { AntiTamperService } = require("./services/anti-tamper");
const { hasPermission, getPermissionDeniedMessage } = require("./services/permissions");

const dataRoot = path.join(process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local"), "KwanzaFolha");
const appUserDataPath = path.join(dataRoot, "userData");
const appSessionDataPath = path.join(dataRoot, "session");
const appCachePath = path.join(dataRoot, "cache");
const appLogsPath = path.join(dataRoot, "logs");

function ensureDir(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

app.setPath("userData", appUserDataPath);
app.setPath("sessionData", appSessionDataPath);
app.setPath("cache", appCachePath);
app.setPath("logs", appLogsPath);

ensureDir(app.getPath("userData"));
ensureDir(app.getPath("sessionData"));
ensureDir(app.getPath("cache"));
ensureDir(app.getPath("logs"));

log.transports.file.resolvePath = () => path.join(app.getPath("logs"), "main.log");

let mainWindow;
let services;
let attendanceWatcher = null;
let attendanceSyncTimer = null;
let startupIntegrityState = {
  ok: true,
  message: "",
  details: {}
};
let startupIntegrityNotified = false;

function normalizePathForCompare(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .toLowerCase();
}

function isLocalPackagedBuildRuntime() {
  if (!app.isPackaged || process.env.KWANZA_LOCAL_PACKAGED_DEV_MODE !== "1") {
    return false;
  }

  const executablePath = normalizePathForCompare(process.execPath);
  return executablePath.includes("\\dist-electron\\win-unpacked\\");
}

function isPackagedSmokeE2EMode() {
  const hasSmokeArg =
    process.argv.includes("--smoke-e2e") ||
    process.argv.includes("/smoke-e2e");
  if (!app.isPackaged || !hasSmokeArg) {
    return false;
  }
  return (
    process.env.KWANZA_SMOKE_E2E !== "0"
  );
}

function formatMonthRef(referenceDate = new Date()) {
  const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 7);
  }
  return date.toISOString().slice(0, 7);
}

function buildAoIban(bankRegistryCode, accountDigits = "") {
  const countryCode = "AO";
  const registryCode = String(bankRegistryCode || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
  const domesticAccount = String(accountDigits || "").replace(/\D/g, "").padStart(17, "0").slice(-17);
  const bban = `${registryCode}${domesticAccount}`;
  const candidate = `${bban}${countryCode}00`;
  let remainder = 0;

  for (const character of candidate) {
    const fragment = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of fragment) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  const checksum = String(98 - remainder).padStart(2, "0");
  return `${countryCode}${checksum}${bban}`;
}

function addSmokeStep(report, step, ok, details = {}) {
  report.steps.push({
    step,
    ok: Boolean(ok),
    details,
    at: new Date().toISOString()
  });
}

function resolveSmokeE2EOutputPath() {
  const configuredPath = String(process.env.KWANZA_SMOKE_OUTPUT_PATH || "").trim();
  if (configuredPath) {
    return configuredPath;
  }
  return path.join(app.getPath("logs"), "smoke-e2e-result.json");
}

function writeSmokeE2EReport(report) {
  const outputPath = resolveSmokeE2EOutputPath();
  const parentDir = path.dirname(outputPath);
  ensureDir(parentDir);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  return outputPath;
}

function assertSmokeResult(result, fallbackMessage) {
  if (result?.ok) {
    return result;
  }
  throw new Error(String(result?.message || fallbackMessage || "Falha no smoke E2E empacotado."));
}

function isAlreadyClosedPeriodMessage(message) {
  return /ja esta fechad|já está fechad/i.test(String(message || ""));
}

function isLocalDevelopmentRuntime() {
  if (app.isPackaged) {
    return false;
  }
  return (
    process.env.NODE_ENV !== "production" ||
    Boolean(process.env.VITE_DEV_SERVER_URL) ||
    Boolean(process.defaultApp) ||
    process.env.KWANZA_DEV_LICENSE_MODE === "1"
  );
}

function setStartupIntegrityIssue(stage, message, details = {}) {
  startupIntegrityState = {
    ok: false,
    stage: String(stage || "").trim() || "startup",
    message: String(message || "Falha de integridade detetada durante o arranque."),
    details: details && typeof details === "object" ? details : {}
  };
  log.warn("[BOOT][FALLBACK]", {
    stage: startupIntegrityState.stage,
    message: startupIntegrityState.message,
    ...details
  });
}

function summarizeAnchorVerification(result = {}) {
  return {
    ok: Boolean(result?.ok),
    createdFresh: Boolean(result?.createdFresh),
    suspiciousReinstall: Boolean(result?.suspiciousReinstall),
    restoredAnchorCount: Array.isArray(result?.restoredAnchors) ? result.restoredAnchors.length : 0,
    riskFlagCount: Array.isArray(result?.identity?.riskFlags) ? result.identity.riskFlags.length : 0
  };
}

function cleanupLegacyData() {
  const oldPath = path.join(process.env.APPDATA || "", "Kwanza Folha");
  if (!oldPath || !fs.existsSync(oldPath)) {
    return;
  }

  const backupPath = `${oldPath}.legacy_backup`;
  if (fs.existsSync(backupPath)) {
    return;
  }

  try {
    fs.renameSync(oldPath, backupPath);
    log.warn("[BOOT][LEGACY-MIGRATION] dados legados movidos para backup", { oldPath, backupPath });
  } catch (error) {
    console.warn("legacy cleanup failed", error);
  }
}

function getSessionUser() {
  return services.auth.getAuthenticatedUser();
}

function withAuth(handler) {
  return async (_, ...args) => {
    if (!services?.auth || !services?.licensingCore) {
      return {
        ok: false,
        message: startupIntegrityState?.message || "Os servicos principais ainda nao ficaram disponiveis."
      };
    }
    const user = getSessionUser();
    if (!user) {
      return { ok: false, message: "Sessao invalida. Inicie sessao novamente." };
    }
    const licenseGuard = services.licensingCore.getGuardResult();
    if (!licenseGuard.ok) {
      log.warn("[BOOT][FALLBACK]", {
        stage: "license-guard",
        code: licenseGuard.code || "invalid",
        message: licenseGuard.message || "Licenciamento invalido ou expirado."
      });
      return {
        ok: false,
        message: licenseGuard.message || "Licenciamento invalido ou expirado. Ative ou renove para continuar."
      };
    }
    return handler(user, ...args);
  };
}

function registerStartupIpcFallbacks() {
  const stagePrefix = startupIntegrityState?.stage ? `[${startupIntegrityState.stage}] ` : "";
  const degradedMessage = `${stagePrefix}${startupIntegrityState?.message || "Os servicos principais ainda nao ficaram disponiveis."}`;
  const safeHandle = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  };

  safeHandle("app:get-version", async () => ({ version: app.getVersion() }));
  safeHandle("license:get-status", async () => ({
    ok: true,
    status: "degraded_startup",
    canUseApp: false,
    requiresLicense: false,
    message: degradedMessage
  }));
  safeHandle("license:get-plans", async () => ({ ok: true, plans: [] }));
  safeHandle("auth:get-state", async () => ({ setupRequired: false, canRegister: false, company: null }));
  safeHandle("auth:restore-session", async () => ({ ok: false, message: degradedMessage }));
  safeHandle("auth:login", async () => ({ ok: false, message: degradedMessage }));
  safeHandle("auth:register-initial", async () => ({ ok: false, message: degradedMessage }));
  safeHandle("auth:request-password-reset", async () => ({ ok: false, message: degradedMessage }));
}

function withAdmin(handler) {
  return withAuth(async (user, ...args) => {
    if (user.role !== "admin") {
      return { ok: false, message: "Apenas administradores podem executar esta operacao." };
    }
    return handler(user, ...args);
  });
}

function withPermission(permission, handler) {
  return withAuth(async (user, ...args) => {
    if (!hasPermission(user, permission)) {
      return { ok: false, message: getPermissionDeniedMessage(permission) };
    }
    return handler(user, ...args);
  });
}

function logAudit(user, action, entityType, entityLabel, details = {}, entityId = null, monthRef = null) {
  services.database.recordAudit({
    user_id: user?.id ?? null,
    user_name: user?.full_name || user?.username || "Sistema",
    action,
    entity_type: entityType,
    entity_id: entityId,
    entity_label: entityLabel,
    month_ref: monthRef,
    details
  });
}

function buildDiff(beforeState = null, afterState = null) {
  const before = beforeState || {};
  const after = afterState || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes = {};

  for (const key of keys) {
    const left = JSON.stringify(before[key] ?? null);
    const right = JSON.stringify(after[key] ?? null);
    if (left !== right) {
      changes[key] = {
        before: before[key] ?? null,
        after: after[key] ?? null
      };
    }
  }

  return changes;
}

function resolveWindowIcon() {
  const candidates = [
    path.join(process.resourcesPath || "", "Folha.png"),
    path.join(__dirname, "..", "build", "Folha.png"),
    path.join(__dirname, "..", "build", "icon.ico"),
    path.join(__dirname, "..", "assets", "icon.ico"),
    path.join(__dirname, "..", "src", "assets", "logos", "logo-icon.png")
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveAppUrl() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return `file://${path.join(__dirname, "..", "dist", "index.html")}`;
}

function isHttpUrl(targetUrl) {
  return /^https?:\/\//i.test(String(targetUrl || "").trim());
}

function isAllowedAppNavigation(targetUrl) {
  const normalized = String(targetUrl || "").trim();
  if (!normalized) {
    return false;
  }

  try {
    const target = new URL(normalized);
    if (process.env.VITE_DEV_SERVER_URL) {
      const devServer = new URL(process.env.VITE_DEV_SERVER_URL);
      return target.origin === devServer.origin;
    }
    return target.protocol === "file:";
  } catch (error) {
    return false;
  }
}

function openExternalSafely(targetUrl) {
  if (!isHttpUrl(targetUrl)) {
    return;
  }

  shell.openExternal(String(targetUrl).trim()).catch((error) => {
    log.error("Nao foi possivel abrir a ligacao externa em seguranca", error);
  });
}

function stopAttendanceWatcher() {
  if (attendanceSyncTimer) {
    clearTimeout(attendanceSyncTimer);
    attendanceSyncTimer = null;
  }
  if (attendanceWatcher) {
    attendanceWatcher.close();
    attendanceWatcher = null;
  }
}

function runWatchedAttendanceSync() {
  if (!services?.database) {
    return null;
  }

  const settings = services.database.getSystemSettings();
  if (!settings.attendanceAutoSyncEnabled || !String(settings.attendanceWatchedFolder || "").trim()) {
    return null;
  }

  const result = services.database.syncAttendanceWatchedFolder({
    folder_path: settings.attendanceWatchedFolder,
    source_type: settings.attendanceWatchedSourceType,
    device_profile:
      settings.attendanceWatchedSourceType === "card"
        ? settings.attendanceCardProfile
        : settings.attendanceBiometricProfile,
    imported_by_user_id: null
  });

  if (result?.ok && (result.processedFiles || result.duplicateFiles || result.errorFiles)) {
    services.database.recordAudit({
      user_id: null,
      user_name: "Sistema",
      action: "attendance.auto_sync",
      entity_type: "attendance_watch_folder",
      entity_label: settings.attendanceWatchedFolder,
      details: {
        folderPath: settings.attendanceWatchedFolder,
        processedFiles: result.processedFiles,
        duplicateFiles: result.duplicateFiles,
        errorFiles: result.errorFiles,
        importedRows: result.importedRows,
        skippedRows: result.skippedRows
      }
    });
  }

  return result;
}

function scheduleWatchedAttendanceSync() {
  if (attendanceSyncTimer) {
    clearTimeout(attendanceSyncTimer);
  }

  attendanceSyncTimer = setTimeout(() => {
    attendanceSyncTimer = null;
    try {
      runWatchedAttendanceSync();
    } catch (error) {
      log.error("Erro ao sincronizar a pasta monitorizada de assiduidade", error);
    }
  }, 1200);
}

function refreshAttendanceWatcher() {
  stopAttendanceWatcher();
  if (!services?.database) {
    return;
  }

  const settings = services.database.getSystemSettings();
  const folderPath = String(settings.attendanceWatchedFolder || "").trim();
  if (!settings.attendanceAutoSyncEnabled || !folderPath || !fs.existsSync(folderPath)) {
    return;
  }

  try {
    attendanceWatcher = fs.watch(folderPath, { persistent: false }, () => {
      scheduleWatchedAttendanceSync();
    });
    scheduleWatchedAttendanceSync();
  } catch (error) {
    log.error("Não foi possível ativar a monitorização automática da assiduidade", error);
  }
}

async function runPackagedSmokeE2EScenario() {
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    steps: [],
    artifacts: {},
    error: null
  };

  try {
    if (!services?.database || !services?.auth || !services?.payroll || !services?.licensingCore) {
      throw new Error("Servicos principais indisponiveis para o smoke E2E empacotado.");
    }

    const primeResult = services.licensingCore.primeInstallation
      ? await services.licensingCore.primeInstallation().catch(() => ({ ok: false }))
      : { ok: false, skipped: true };
    addSmokeStep(report, "license-prime", true, {
      ok: Boolean(primeResult?.ok),
      skipped: Boolean(primeResult?.skipped)
    });

    const licenseStatus = services.licensingCore.getStatus(true);
    if (!licenseStatus?.canUseApp) {
      throw new Error(licenseStatus?.message || "Licenca invalida para smoke E2E.");
    }
    addSmokeStep(report, "license", true, {
      status: licenseStatus.status || "unknown",
      requiresLicense: Boolean(licenseStatus.requiresLicense),
      canUseApp: Boolean(licenseStatus.canUseApp)
    });

    const authState = services.auth.getState();
    const uniqueToken = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-6);
    const credentials = {
      username: `smoke${uniqueToken}`,
      password: "Smoke1234!"
    };

    if (authState?.setupRequired) {
      const registerResult = services.auth.registerInitialAccount({
        company_name: "Kwanza Folha Smoke CI",
        company_nif: `500${uniqueToken}21`,
        company_email: "smoke-ci@kwanzafolha.ao",
        company_phone: "222000111",
        company_address: "Luanda",
        full_name: "Administrador Smoke",
        admin_email: "smoke-admin@kwanzafolha.ao",
        username: credentials.username,
        password: credentials.password
      });
      assertSmokeResult(registerResult, "Nao foi possivel concluir o registo inicial para o smoke E2E.");
      addSmokeStep(report, "register-initial", true, {
        setupRequired: true,
        username: credentials.username
      });
    } else {
      addSmokeStep(report, "register-initial", true, {
        setupRequired: false,
        skipped: true
      });
    }

    const loginAttempts = [
      credentials,
      { username: "admin", password: "admin123" },
      { username: "administrador", password: "admin123" }
    ];

    let loginResult = null;
    let loginAttemptedAs = "";
    for (const attempt of loginAttempts) {
      const candidate = services.auth.login(attempt);
      if (candidate?.ok) {
        loginResult = candidate;
        loginAttemptedAs = attempt.username;
        break;
      }
    }

    if (!loginResult) {
      const createSmokeUserResult = services.database.saveUser({
        full_name: "Administrador Smoke",
        email: "smoke-admin@kwanzafolha.ao",
        username: credentials.username,
        password: credentials.password,
        role: "admin",
        active: true
      });
      if (createSmokeUserResult?.ok) {
        const createdUserLogin = services.auth.login(credentials);
        if (createdUserLogin?.ok) {
          loginResult = createdUserLogin;
          loginAttemptedAs = credentials.username;
        }
      }
    }

    assertSmokeResult(loginResult, "Nao foi possivel autenticar no smoke E2E empacotado.");
    if (loginResult?.user?.id) {
      services.auth.persistSession(loginResult.user.id);
    }
    addSmokeStep(report, "login", true, {
      username: loginAttemptedAs,
      userId: loginResult?.user?.id || null
    });

    const monthRef = formatMonthRef();
    const employeeToken = `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`.slice(-6);
    const bankRegistryCode = "0040";
    const domesticAccount = `${employeeToken}${String(Math.floor(Math.random() * 1_000_000_000_000)).padStart(11, "0")}`;
    const employeeIban = buildAoIban(bankRegistryCode, domesticAccount);
    const saveEmployeeResult = services.database.saveEmployee({
      full_name: `Funcionario Smoke ${employeeToken}`,
      document_type: "bi",
      bi: `123456789LA${employeeToken.slice(-3)}`,
      driver_license_number: "",
      nif: `500${employeeToken}67`,
      social_security_number: `12${employeeToken}345`,
      attendance_code: `SMK${employeeToken}`,
      birth_date: "1991-04-15",
      gender: "masculino",
      marital_status: "solteiro",
      nationality: "Angolana",
      personal_phone: "923000000",
      personal_email: "func-smoke@kwanzafolha.ao",
      address: "Luanda",
      job_title: "Analista de Testes",
      department: "Operacoes",
      base_salary: 280000,
      contract_type: "Indeterminado",
      hire_date: `${monthRef}-01`,
      shift_id: "",
      iban: employeeIban,
      bank_code: "BAI",
      bank_account: `${bankRegistryCode}${domesticAccount}`,
      status: "ativo",
      notes: "Registo automatico para smoke release.",
      recurring_allowances: [],
      recurring_bonuses: [],
      special_payments: []
    });
    assertSmokeResult(saveEmployeeResult, "Nao foi possivel criar funcionario para o smoke E2E.");

    const smokeEmployee = (saveEmployeeResult?.employees || []).find((item) => String(item.attendance_code || "").startsWith("SMK"));
    if (!smokeEmployee?.id) {
      throw new Error("Funcionario smoke nao foi localizado apos criacao.");
    }
    addSmokeStep(report, "employee-create", true, {
      employeeId: smokeEmployee.id,
      monthRef
    });

    const attendanceResult = services.database.saveAttendanceRecord({
      employee_id: smokeEmployee.id,
      attendance_date: `${monthRef}-05`,
      status: "present",
      shift_id: smokeEmployee.shift_id || null,
      check_in_time: "08:00",
      check_out_time: "17:00",
      hours_worked: 8,
      delay_minutes: 0,
      source: "manual",
      approval_status: "approved",
      notes: "Entrada automatica do smoke release."
    });
    assertSmokeResult(attendanceResult, "Nao foi possivel registar assiduidade para o smoke E2E.");

    const closeAttendanceResult = services.database.closeAttendancePeriod(monthRef, loginResult.user.id);
    if (!closeAttendanceResult?.ok && !isAlreadyClosedPeriodMessage(closeAttendanceResult?.message)) {
      throw new Error(closeAttendanceResult?.message || "Nao foi possivel fechar a assiduidade do periodo.");
    }
    addSmokeStep(report, "attendance-close", true, {
      monthRef,
      status: services.database.getAttendancePeriod(monthRef)?.status || "unknown"
    });

    let payrollResult = services.payroll.processMonth(monthRef, {
      includePreview: false,
      resetExisting: true
    });
    if (!payrollResult?.ok && /periodo .* fechado|período .* fechado/i.test(String(payrollResult?.message || ""))) {
      const reopenResult = services.database.reopenPayrollPeriod(monthRef, loginResult.user.id);
      if (reopenResult?.ok) {
        payrollResult = services.payroll.processMonth(monthRef, {
          includePreview: false,
          resetExisting: true
        });
      }
    }
    assertSmokeResult(payrollResult, "Nao foi possivel processar a folha no smoke E2E.");
    addSmokeStep(report, "payroll-process", true, {
      monthRef,
      count: payrollResult?.items?.length || 0
    });

    const exportFilters = { monthRef, employeeId: String(smokeEmployee.id) };
    const payrollExport = services.database.exportMonthlyPayrollExcel(exportFilters);
    const stateExport = services.database.exportStatePaymentsExcel(exportFilters);
    const agtExport = services.database.exportAgtMonthlyRemunerationExcel(exportFilters);

    assertSmokeResult(payrollExport, "Falha na exportacao Excel da folha salarial.");
    assertSmokeResult(stateExport, "Falha na exportacao Excel de pagamento ao Estado.");
    assertSmokeResult(agtExport, "Falha na exportacao AGT.");

    report.artifacts = {
      payrollExcel: payrollExport.path,
      stateExcel: stateExport.path,
      agtExcel: agtExport.path
    };
    addSmokeStep(report, "exports", true, report.artifacts);

    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error?.stack || error?.message || error);
    log.error("[BOOT][SMOKE-E2E] falha", error);
  } finally {
    report.finishedAt = new Date().toISOString();
    const outputPath = writeSmokeE2EReport(report);
    report.outputPath = outputPath;
    log.info("[BOOT][SMOKE-E2E] resultado", { ok: report.ok, outputPath, steps: report.steps.length });
  }

  return report;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: "#07182e",
    title: "Kwanza Folha",
    icon: resolveWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:kwanza",
      webSecurity: true,
      webviewTag: false,
      spellcheck: false
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences) => {
    event.preventDefault();
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
  });
  if (typeof mainWindow.webContents.session?.setPermissionRequestHandler === "function") {
    mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
  }
  if (typeof mainWindow.webContents.session?.setPermissionCheckHandler === "function") {
    mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  }
  if (app.isPackaged) {
    mainWindow.webContents.on("devtools-opened", () => {
      mainWindow.webContents.closeDevTools();
      setStartupIntegrityIssue("debug-environment", "Tentativa de abrir ferramentas de desenvolvimento detetada no ambiente protegido.");
      notifyStartupIntegrityIssue();
    });
  }
  mainWindow.loadURL(resolveAppUrl());
}

function notifyStartupIntegrityIssue() {
  if (!startupIntegrityState?.message || !mainWindow || startupIntegrityNotified) {
    return;
  }
  if (isPackagedSmokeE2EMode()) {
    log.warn("[BOOT][SMOKE-E2E] aviso de integridade suprimido para evitar bloqueio interativo", startupIntegrityState);
    return;
  }
  if (isLocalPackagedBuildRuntime() && String(startupIntegrityState?.stage || "") === "executable-signature") {
    log.warn("[BOOT][LOCAL-PACKAGED] aviso de assinatura suprimido para validacao local.", startupIntegrityState);
    return;
  }

  const integrityStages = new Set([
    "installation-identity",
    "executable-signature",
    "module-integrity",
    "debug-environment",
    "legacy-data-cleanup"
  ]);
  const isIntegrityIssue = integrityStages.has(String(startupIntegrityState?.stage || "").trim());
  const title = isIntegrityIssue ? "Integridade da instalacao" : "Inicializacao do sistema";
  const message = isIntegrityIssue
    ? "Erro de integridade da instalacao. Contacte o suporte para reativacao."
    : "Nao foi possivel inicializar todos os servicos internos.";
  const detailHint = (() => {
    const stage = String(startupIntegrityState?.stage || "").trim();
    if (stage === "executable-signature") {
      return "Instale uma build assinada (Setup oficial) e evite executar binarios nao assinados.";
    }
    if (stage === "services-init") {
      return "Reinicie a aplicacao. Se persistir, restaure o ultimo backup valido.";
    }
    return "";
  })();
  const detail = detailHint
    ? `${startupIntegrityState.message}\n\n${detailHint}`
    : startupIntegrityState.message;

  startupIntegrityNotified = true;
  dialog
    .showMessageBox(mainWindow, {
      type: "warning",
      title,
      message,
      detail
    })
    .catch((error) => {
      log.error("Nao foi possivel apresentar o aviso de integridade", error);
    });
}

function resolveStartupFailureMessage(error) {
  const rawMessage = String(error?.message || "");

  if (/NODE_MODULE_VERSION|compiled against a different Node\.js version|better-sqlite3/i.test(rawMessage)) {
    return "Falha de compatibilidade dos modulos SQLite. Atualize/reinstale a aplicacao para a mesma versao do Electron.";
  }

  if (/Unsupported state or unable to authenticate data|failed to decrypt database|decrypt/i.test(rawMessage)) {
    return "Nao foi possivel abrir a base de dados cifrada. Valide a chave local e os ficheiros de dados.";
  }

  if (/file is not a database|database disk image is malformed/i.test(rawMessage)) {
    return "A base de dados local estava invalida e o sistema tentou recuperar automaticamente. Reinicie a aplicacao e valide os dados recentes.";
  }

  if (/license|licenca|licensing/i.test(rawMessage)) {
    return "Nao foi possivel inicializar o servico de licenciamento. O sistema abriu em modo restrito para evitar falhas totais.";
  }

  if (/ipc|handler/i.test(rawMessage)) {
    return "Falha ao registar canais internos (IPC). Reinicie a aplicacao e valide os modulos do sistema.";
  }

  return "Erro de integridade da instalacao. Contacte o suporte para reativacao.";
}

function registerIpc() {
  ipcMain.removeHandler("app:get-version");
  ipcMain.removeHandler("license:get-status");
  ipcMain.removeHandler("license:get-plans");
  ipcMain.removeHandler("auth:get-state");
  ipcMain.removeHandler("auth:login");
  ipcMain.removeHandler("auth:register-initial");
  ipcMain.removeHandler("auth:restore-session");
  ipcMain.removeHandler("auth:request-password-reset");
  ipcMain.handle("app:get-version", async () => ({ version: app.getVersion() }));
  ipcMain.handle("app:quit", async () => {
    app.quit();
    return { ok: true };
  });
  ipcMain.handle("license:get-status", async () => services.licensingCore.getStatus(true));
  ipcMain.handle("license:validate-installation", async () => services.licensingCore.validateInstallation());
  ipcMain.handle("license:get-plans", async () => ({ ok: true, plans: services.licensingCore.getPlans() }));
  ipcMain.handle("license:create-payment", async (_, payload) => services.licensingCore.createPaymentReference(payload));
  ipcMain.handle("license:check-payment", async (_, payload) => services.licensingCore.checkPaymentStatus(payload?.reference));
  ipcMain.handle("license:activate", async (_, payload) => services.licensingCore.activateLicense(payload));
  ipcMain.handle("license:renew", async (_, payload) => services.licensingCore.renewLicense(payload));
  ipcMain.handle("app:get-bootstrap", withAuth(async (user) => ({
    ...services.settings.getBootstrap(user),
    runtime: {
      payrollRuleEditingLocked: app.isPackaged,
      installationIntegrity: startupIntegrityState
    }
  })));
  ipcMain.handle("auth:get-state", async () => services.auth.getState());
  ipcMain.handle("auth:login", async (_, credentials) => {
    const licenseGuard = services.licensingCore.getGuardResult();
    if (!licenseGuard.ok) {
      return licenseGuard;
    }
    const result = services.auth.login(credentials);
    if (result.ok) {
      services.auth.persistSession(result.user.id);
    }
    return result;
  });
  ipcMain.handle("auth:register-initial", async (_, payload) => {
    const licenseGuard = services.licensingCore.getGuardResult();
    if (!licenseGuard.ok) {
      return licenseGuard;
    }
    const result = services.auth.registerInitialAccount(payload);
    if (result?.ok && result.user?.id) {
      services.auth.persistSession(result.user.id);
    }
    return result;
  });
  ipcMain.handle("auth:restore-session", async () => services.auth.restoreSession());
  ipcMain.handle("auth:logout", async () => services.auth.logout());
  ipcMain.handle("auth:request-password-reset", async (_, payload) => {
    const prepared = services.auth.preparePasswordReset(payload?.identifier);
    if (!prepared?.ok) {
      return prepared;
    }

    const requestResult = services.auth.createPasswordResetRequest(prepared.reset);
    if (!requestResult?.ok) {
      return requestResult;
    }

    const mailResult = await services.mailer.sendPasswordResetToken(prepared.reset);
    if (!mailResult?.ok) {
      services.auth.revokePasswordResetRequest(prepared.reset);
      return mailResult;
    }

    services.database.recordAudit({
      user_id: null,
      user_name: "Sistema",
      action: "password.reset_email",
      entity_type: "user",
      entity_id: prepared.reset.userId,
      entity_label: prepared.reset.fullName || prepared.reset.username,
      details: {
        email: prepared.reset.maskedEmail,
        username: prepared.reset.username,
        expiresAt: prepared.reset.expiresAt
      }
    });

    return {
      ok: true,
      message: `Foi enviado um codigo temporario de redefinicao para ${prepared.reset.maskedEmail}.`
    };
  });
  ipcMain.handle("auth:complete-password-reset", async (_, payload) => {
    const result = services.auth.completePasswordReset(payload || {});
    if (result?.ok) {
      services.database.recordAudit({
        user_id: null,
        user_name: "Sistema",
        action: "password.reset_complete",
        entity_type: "user",
        entity_label: String(payload?.identifier || "").trim(),
        details: {
          identifier: String(payload?.identifier || "").trim()
        }
      });
    }
    return result;
  });
  ipcMain.handle("auth:change-password", withAuth(async (user, payload) => {
    if (!payload?.resetByAdmin && Number(payload?.userId) !== Number(user.id)) {
      return { ok: false, message: "Nao pode alterar a senha de outro utilizador." };
    }
    if (payload?.resetByAdmin && user.role !== "admin") {
      return { ok: false, message: "Apenas administradores podem redefinir senhas." };
    }
    const result = services.auth.changePassword(payload);
    if (result?.ok) {
      logAudit(
        user,
        payload?.resetByAdmin ? "password.reset" : "password.change",
        "user",
        payload?.resetByAdmin ? `Utilizador ${payload.userId}` : user.full_name,
        { resetByAdmin: Boolean(payload?.resetByAdmin), targetUserId: payload?.userId ?? user.id },
        payload?.userId ?? user.id
      );
    }
    return result;
  }));
  ipcMain.handle("users:save", withAdmin(async (user, payload) => {
    if (!payload?.id) {
      const licenseStatus = services.licensingCore.getStatus();
      const maxUsers = 0;
      if (maxUsers > 0) {
        const activeUsers = services.database.listUsers().filter((item) => item.active).length;
        if (activeUsers >= maxUsers) {
          return {
            ok: false,
            message: `O plano ativo permite no máximo ${maxUsers} utilizador(es). Renove ou mude de plano para criar mais acessos.`
          };
        }
      }
    }

    const before = payload?.id ? services.database.getUserSnapshot(payload.id) : null;
    const result = services.database.saveUser(payload);
    if (result?.ok) {
      const savedUser = result.users?.find((item) => item.username === String(payload.username || "").trim().toLowerCase()) || null;
      const after = savedUser ? services.database.getUserSnapshot(savedUser.id) : null;
      logAudit(
        user,
        payload?.id ? "user.update" : "user.create",
        "user",
        payload.full_name || payload.username,
        {
          before,
          after,
          changes: buildDiff(before, after)
        },
        savedUser?.id ?? payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("users:delete", withAdmin(async (user, userId) => {
    const before = services.database.getUserSnapshot(userId);
    const result = services.database.deleteUser(userId);
    if (result?.ok) {
      logAudit(user, "user.delete", "user", before?.full_name || `Utilizador ${userId}`, { before, after: null }, userId);
    }
    return result;
  }));
  ipcMain.handle("company:save", withAdmin(async (user, payload) => {
    const before = services.database.getCompanySnapshot();
    const result = services.database.saveCompanyProfile(payload);
    if (!result?.ok) {
      return result;
    }
    const after = services.database.getCompanySnapshot();
    logAudit(user, "company.update", "company", payload.name || "Empresa", { before, after, changes: buildDiff(before, after) });
    return result;
  }));
  ipcMain.handle("settings:save", withAdmin(async (user, payload) => {
      if (app.isPackaged) {
        const currentSettings = services.database.getSystemSettings();
        if (JSON.stringify(currentSettings.irtBrackets || []) !== JSON.stringify(payload?.irtBrackets || [])) {
          return {
            ok: false,
            message:
              "A tabela de IRT está bloqueada em produção. Use uma atualização oficial do motor fiscal para alterar escalões."
          };
        }
      }
      const before = services.database.getSettingsSnapshot();
      const result = services.database.saveSystemSettings(payload);
      if (!result?.ok) {
        return result;
      }
      const after = services.database.getSettingsSnapshot();
      logAudit(user, "settings.update", "settings", "Sistema", { before, after, changes: buildDiff(before, after) });
      refreshAttendanceWatcher();
      return result;
    }));
  ipcMain.handle("employees:list", withPermission("employees.view", async () => services.database.listEmployees()));
  ipcMain.handle("employees:save", withPermission("employees.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getEmployeeSnapshot(payload.id) : null;
    const result = services.database.saveEmployee(payload);
    if (result?.ok) {
      const savedEmployee =
        (payload?.id && services.database.getEmployeeSnapshot(payload.id)) ||
        result.employees?.find((item) => item.full_name === payload.full_name && String(item.bi || "").toUpperCase() === String(payload.bi || "").toUpperCase()) ||
        null;
      const after = savedEmployee ? services.database.getEmployeeSnapshot(savedEmployee.id) : null;
      logAudit(
        user,
        payload?.id ? "employee.update" : "employee.create",
        "employee",
        payload.full_name,
        {
          before,
          after,
          changes: buildDiff(before, after)
        },
        savedEmployee?.id ?? payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("employees:delete", withPermission("employees.manage", async (user, employeeId) => {
    const before = services.database.getEmployeeSnapshot(employeeId);
    const result = services.database.deleteEmployee(employeeId);
    if (result?.ok) {
      logAudit(user, "employee.delete", "employee", before?.full_name || `Funcionario ${employeeId}`, { before, after: null }, employeeId);
    }
    return result;
  }));
  ipcMain.handle("documents:list", withPermission("documents.view", async (user, filters) => ({ ok: true, items: services.database.listEmployeeDocuments(filters || {}) })));
  ipcMain.handle("documents:save", withPermission("documents.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getEmployeeDocumentSnapshot(payload.id) : null;
    const result = services.database.saveEmployeeDocument(payload, user.id);
    if (result?.ok) {
      const after = result.document || (payload?.id ? services.database.getEmployeeDocumentSnapshot(payload.id) : null);
      logAudit(
        user,
        payload?.id ? "document.update" : "document.create",
        "employee_document",
        after?.title || payload?.title || "Documento laboral",
        { before, after, changes: buildDiff(before, after) },
        after?.id ?? payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("documents:delete", withPermission("documents.manage", async (user, documentId) => {
    const before = services.database.getEmployeeDocumentSnapshot(documentId);
    const result = services.database.deleteEmployeeDocument(documentId);
    if (result?.ok) {
      logAudit(
        user,
        "document.delete",
        "employee_document",
        before?.title || `Documento ${documentId}`,
        { before, after: null },
        documentId
      );
    }
    return result;
  }));
  ipcMain.handle("documents:open", withPermission("documents.view", async (user, documentId) => {
    const document = services.database.getEmployeeDocumentSnapshot(documentId);
    if (!document) {
      return { ok: false, message: "O documento laboral selecionado ja nao existe." };
    }
    if (!document.stored_file_path || !fs.existsSync(document.stored_file_path)) {
      return { ok: false, message: "O ficheiro do documento nao foi encontrado na pasta oficial." };
    }

    const openResult = await shell.openPath(document.stored_file_path);
    if (openResult) {
      return { ok: false, message: `Nao foi possivel abrir o documento: ${openResult}` };
    }

    return { ok: true, path: document.stored_file_path };
  }));
  ipcMain.handle("events:list", withPermission("events.view", async (user, employeeId) => services.database.listEvents(employeeId)));
  ipcMain.handle("events:save", withPermission("events.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getEventSnapshot(payload.id) : null;
    const result = services.database.saveEvent(payload);
    if (result?.ok) {
      const savedEvent =
        (payload?.id && services.database.getEventSnapshot(payload.id)) ||
        result.events?.find((item) => Number(item.employee_id) === Number(payload.employee_id) && item.event_type === payload.event_type && item.event_date === payload.event_date && Number(item.quantity || 0) === Number(payload.quantity || 0)) ||
        null;
      const after = savedEvent ? services.database.getEventSnapshot(savedEvent.id) : null;
      logAudit(
        user,
        payload?.id ? "event.update" : "event.create",
        "event",
        payload.description || payload.event_type,
        {
          before,
          after,
          changes: buildDiff(before, after)
        },
        savedEvent?.id ?? payload?.id ?? null,
        String(payload.event_date || "").slice(0, 7)
      );
    }
    return result;
  }));
  ipcMain.handle("events:delete", withPermission("events.manage", async (user, eventId) => {
    const before = services.database.getEventSnapshot(eventId);
    const result = services.database.deleteEvent(eventId);
    if (result?.ok) {
      logAudit(
        user,
        "event.delete",
        "event",
        before?.description || before?.event_type || `Evento ${eventId}`,
        { before, after: null },
        eventId,
        String(before?.event_date || "").slice(0, 7) || null
      );
    }
    return result;
  }));
  ipcMain.handle("attendance:list", withPermission("attendance.view", async (user, filters) => ({ ok: true, items: services.database.listAttendanceRecords(filters || {}) })));
  ipcMain.handle("attendance:imports", withPermission("attendance.view", async (user, filters) => ({ ok: true, items: services.database.listAttendanceImportBatches(filters || {}) })));
  ipcMain.handle("attendance:import-logs", withPermission("attendance.view", async (user, filters) => ({ ok: true, items: services.database.listAttendanceImportLogs(filters || {}) })));
  ipcMain.handle("attendance:save", withPermission("attendance.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getAttendanceSnapshot(payload.id) : null;
    const result = services.database.saveAttendanceRecord(payload);
    if (result?.ok) {
      const savedRecord =
        (payload?.id && services.database.getAttendanceSnapshot(payload.id)) ||
        result.items?.find((item) => Number(item.employee_id) === Number(payload.employee_id) && item.attendance_date === payload.attendance_date) ||
        null;
      const after = savedRecord ? services.database.getAttendanceSnapshot(savedRecord.id) : null;
      logAudit(
        user,
        payload?.id ? "attendance.update" : "attendance.create",
        "attendance_record",
        `${payload?.attendance_date || ""} - ${payload?.status || ""}`,
        { before, after, changes: buildDiff(before, after) },
        savedRecord?.id ?? payload?.id ?? null,
        String(payload?.attendance_date || "").slice(0, 7) || null
      );
      }
      return result;
    }));
  ipcMain.handle("attendance:import-file", withPermission("attendance.manage", async (user, payload) => {
      const result = services.database.importAttendanceFile({
        ...(payload || {}),
        imported_by_user_id: user.id
      });
    if (result?.ok) {
      logAudit(
        user,
        "attendance.import",
        "attendance_import_batch",
        result.batch?.file_name || "Importação de assiduidade",
        {
          after: result.batch,
          summary: result.summary,
          source_type: payload?.source_type || "biometric"
        },
        result.batch?.id ?? null,
        result.batch?.month_ref || null
      );
    }
    return result;
  }));
  ipcMain.handle("attendance:delete", withPermission("attendance.manage", async (user, attendanceId) => {
    const before = services.database.getAttendanceSnapshot(attendanceId);
    const result = services.database.deleteAttendanceRecord(attendanceId);
    if (result?.ok) {
      logAudit(
        user,
        "attendance.delete",
        "attendance_record",
        before ? `${before.attendance_date} - ${before.status}` : `Assiduidade ${attendanceId}`,
        { before, after: null },
        attendanceId,
        String(before?.attendance_date || "").slice(0, 7) || null
      );
      }
      return result;
    }));
    ipcMain.handle("attendance:sync-folder", withPermission("attendance.manage", async (user, payload) => {
      const result = services.database.syncAttendanceWatchedFolder({
        ...(payload || {}),
        imported_by_user_id: user.id
      });
      if (result?.ok) {
        logAudit(
          user,
          "attendance.sync_folder",
          "attendance_watch_folder",
          result.folderPath || payload?.folder_path || "Pasta monitorizada",
          {
            folderPath: result.folderPath || payload?.folder_path || null,
            processedFiles: result.processedFiles,
            duplicateFiles: result.duplicateFiles,
            errorFiles: result.errorFiles,
            importedRows: result.importedRows,
            skippedRows: result.skippedRows
          }
        );
      }
      return result;
    }));
    ipcMain.handle("attendance:approve-adjustments", withAdmin(async (user, payload) => {
      const monthRef = String(payload?.monthRef || "").trim();
      const employeeId = payload?.employeeId ? Number(payload.employeeId) : null;
      const result = services.database.approveAttendanceAdjustments(monthRef, user.id, { employeeId });
      if (result?.ok) {
        logAudit(
          user,
          "attendance.approve_adjustments",
          "attendance_period",
          monthRef,
          {
            monthRef,
            employeeId,
            approvedCount: result.approvedCount
          },
          employeeId,
          monthRef
        );
      }
      return result;
    }));
    ipcMain.handle("attendance:close-period", withAdmin(async (user, monthRef) => {
      const result = services.database.closeAttendancePeriod(monthRef, user.id);
      if (result?.ok) {
        logAudit(
          user,
          "attendance.close_period",
          "attendance_period",
          monthRef,
          {
            monthRef,
            summary: result.summary
          },
          null,
          monthRef
        );
      }
      return result;
    }));
    ipcMain.handle("attendance:reopen-period", withAdmin(async (user, monthRef) => {
      const result = services.database.reopenAttendancePeriod(monthRef, user.id);
      if (result?.ok) {
        logAudit(user, "attendance.reopen_period", "attendance_period", monthRef, { monthRef }, null, monthRef);
      }
      return result;
    }));
    ipcMain.handle("shifts:list", withPermission("shifts.view", async () => ({ ok: true, items: services.database.listWorkShifts() })));
  ipcMain.handle("shifts:save", withAdmin(async (user, payload) => {
    const before = payload?.id ? services.database.getWorkShiftSnapshot(payload.id) : null;
    const result = services.database.saveWorkShift(payload);
    if (result?.ok) {
      const savedShift =
        (payload?.id && services.database.getWorkShiftSnapshot(payload.id)) ||
        result.items?.find((item) => String(item.code || "").trim().toUpperCase() === String(payload?.code || "").trim().toUpperCase()) ||
        result.items?.find((item) => String(item.name || "").trim().toLowerCase() === String(payload?.name || "").trim().toLowerCase()) ||
        null;
      const after = savedShift ? services.database.getWorkShiftSnapshot(savedShift.id) : null;
      logAudit(
        user,
        payload?.id ? "shift.update" : "shift.create",
        "work_shift",
        payload?.name || payload?.code || "Turno",
        { before, after, changes: buildDiff(before, after) },
        savedShift?.id ?? payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("shifts:delete", withAdmin(async (user, shiftId) => {
    const before = services.database.getWorkShiftSnapshot(shiftId);
    const result = services.database.deleteWorkShift(shiftId);
    if (result?.ok) {
      logAudit(
        user,
        "shift.delete",
        "work_shift",
        before?.name || before?.code || `Turno ${shiftId}`,
        { before, after: null },
        shiftId
      );
    }
    return result;
  }));
  ipcMain.handle("leave:list", withPermission("leave.view", async (user, filters) => ({ ok: true, items: services.database.listLeaveRequests(filters || {}) })));
  ipcMain.handle("leave:save", withPermission("leave.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getLeaveRequestSnapshot(payload.id) : null;
    const result = services.database.saveLeaveRequest(payload);
    if (result?.ok) {
      const savedLeaveRequest =
        (payload?.id && services.database.getLeaveRequestSnapshot(payload.id)) ||
        result.items?.find((item) => Number(item.employee_id) === Number(payload.employee_id) && item.start_date === payload.start_date && item.record_type === payload.record_type) ||
        null;
      const after = savedLeaveRequest ? services.database.getLeaveRequestSnapshot(savedLeaveRequest.id) : null;
      logAudit(
        user,
        payload?.id ? "leave.update" : "leave.create",
        "leave_request",
        payload.reason || payload.record_type,
        { before, after, changes: buildDiff(before, after) },
        savedLeaveRequest?.id ?? payload?.id ?? null,
        String(payload.start_date || "").slice(0, 7)
      );
    }
    return result;
  }));
  ipcMain.handle("leave:set-status", withAdmin(async (user, payload) => {
    const before = services.database.getLeaveRequestSnapshot(payload?.id);
    const result = services.database.setLeaveRequestStatus(payload?.id, payload?.status, user.id, payload?.rejectionReason);
    if (result?.ok) {
      const after = services.database.getLeaveRequestSnapshot(payload?.id);
      logAudit(
        user,
        `leave.${String(payload?.status || "").toLowerCase()}`,
        "leave_request",
        before?.reason || before?.record_type || `Licença ${payload?.id}`,
        { before, after, changes: buildDiff(before, after) },
        payload?.id ?? null,
        String(before?.start_date || "").slice(0, 7) || null
      );
    }
    return result;
  }));
  ipcMain.handle("leave:delete", withPermission("leave.manage", async (user, leaveRequestId) => {
    const before = services.database.getLeaveRequestSnapshot(leaveRequestId);
    const result = services.database.deleteLeaveRequest(leaveRequestId);
    if (result?.ok) {
      logAudit(
        user,
        "leave.delete",
        "leave_request",
        before?.reason || before?.record_type || `Licença ${leaveRequestId}`,
        { before, after: null },
        leaveRequestId,
        String(before?.start_date || "").slice(0, 7) || null
      );
    }
    return result;
  }));
  ipcMain.handle("vacation:balances", withPermission("vacation.view", async (user, filters) => ({ ok: true, items: services.database.listVacationBalances(filters || {}) })));
  ipcMain.handle("vacation:save-balance", withPermission("vacation.balance.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getVacationBalanceSnapshot(payload.id) : null;
    const result = services.database.saveVacationBalance(payload);
    if (result?.ok) {
      const after =
        (payload?.id && services.database.getVacationBalanceSnapshot(payload.id)) ||
        services.database.listVacationBalances({ employeeId: payload.employee_id, yearRef: payload.year_ref })[0] ||
        null;
      logAudit(
        user,
        payload?.id ? "vacation.balance_update" : "vacation.balance_create",
        "vacation_balance",
        `${payload?.year_ref || ""} - saldo de férias`,
        { before, after, changes: buildDiff(before, after) },
        after?.id ?? payload?.id ?? null,
        payload?.year_ref ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("vacation:list", withPermission("vacation.view", async (user, filters) => ({ ok: true, items: services.database.listVacationRequests(filters || {}) })));
  ipcMain.handle("vacation:save", withPermission("vacation.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getVacationRequestSnapshot(payload.id) : null;
    const result = services.database.saveVacationRequest(payload);
    if (result?.ok) {
      const savedRequest =
        (payload?.id && services.database.getVacationRequestSnapshot(payload.id)) ||
        result.items?.find((item) => Number(item.employee_id) === Number(payload.employee_id) && item.start_date === payload.start_date) ||
        null;
      const after = savedRequest ? services.database.getVacationRequestSnapshot(savedRequest.id) : null;
      logAudit(
        user,
        payload?.id ? "vacation.update" : "vacation.create",
        "vacation_request",
        `${payload?.start_date || ""} a ${payload?.end_date || ""}`,
        { before, after, changes: buildDiff(before, after) },
        savedRequest?.id ?? payload?.id ?? null,
        String(payload?.start_date || "").slice(0, 7) || null
      );
    }
    return result;
  }));
  ipcMain.handle("vacation:set-status", withAdmin(async (user, payload) => {
    const before = services.database.getVacationRequestSnapshot(payload?.id);
    const result = services.database.setVacationRequestStatus(payload?.id, payload?.status, user.id, payload?.rejectionReason);
    if (result?.ok) {
      const after = services.database.getVacationRequestSnapshot(payload?.id);
      logAudit(
        user,
        `vacation.${String(payload?.status || "").toLowerCase()}`,
        "vacation_request",
        before ? `${before.start_date} a ${before.end_date}` : `Férias ${payload?.id}`,
        { before, after, changes: buildDiff(before, after) },
        payload?.id ?? null,
        String(before?.start_date || "").slice(0, 7) || null
      );
    }
    return result;
  }));
  ipcMain.handle("vacation:delete", withPermission("vacation.manage", async (user, vacationRequestId) => {
    const before = services.database.getVacationRequestSnapshot(vacationRequestId);
    const result = services.database.deleteVacationRequest(vacationRequestId);
    if (result?.ok) {
      logAudit(
        user,
        "vacation.delete",
        "vacation_request",
        before ? `${before.start_date} a ${before.end_date}` : `Férias ${vacationRequestId}`,
        { before, after: null },
        vacationRequestId,
        String(before?.start_date || "").slice(0, 7) || null
      );
    }
    return result;
  }));
  ipcMain.handle("financial:list", withPermission("financial.view", async (user, filters) => ({ ok: true, items: services.database.listFinancialObligations(filters || {}) })));
  ipcMain.handle("financial:save", withPermission("financial.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getFinancialObligationSnapshot(payload.id) : null;
    const result = services.database.saveFinancialObligation(payload);
    if (result?.ok) {
      const savedObligation =
        (payload?.id && services.database.getFinancialObligationSnapshot(payload.id)) ||
        result.items?.find((item) => Number(item.employee_id) === Number(payload.employee_id) && item.label === payload.label) ||
        null;
      const after = savedObligation ? services.database.getFinancialObligationSnapshot(savedObligation.id) : null;
      logAudit(
        user,
        payload?.id ? "financial.update" : "financial.create",
        "financial_obligation",
        payload.label || (payload.entry_type === "advance" ? "Adiantamento" : "Empréstimo"),
        { before, after, changes: buildDiff(before, after) },
        savedObligation?.id ?? payload?.id ?? null,
        payload?.start_month_ref || null
      );
    }
    return result;
  }));
  ipcMain.handle("financial:delete", withPermission("financial.manage", async (user, obligationId) => {
    const before = services.database.getFinancialObligationSnapshot(obligationId);
    const result = services.database.deleteFinancialObligation(obligationId);
    if (result?.ok) {
      logAudit(
        user,
        "financial.delete",
        "financial_obligation",
        before?.label || `Registo financeiro ${obligationId}`,
        { before, after: null },
        obligationId,
        before?.start_month_ref || null
      );
    }
    return result;
  }));
  ipcMain.handle("salary-scales:list", withPermission("salary_scales.view", async () => ({ ok: true, items: services.database.listSalaryScales() })));
  ipcMain.handle("salary-scales:save", withAdmin(async (user, payload) => {
    const before = payload?.id ? services.database.getSalaryScaleSnapshot(payload.id) : null;
    const result = services.database.saveSalaryScale(payload);
    if (result?.ok) {
      const savedScale =
        (payload?.id && services.database.getSalaryScaleSnapshot(payload.id)) ||
        result.items?.find((item) =>
          String(item.job_title || "").trim().toLowerCase() === String(payload?.job_title || "").trim().toLowerCase() &&
          String(item.department || "").trim().toLowerCase() === String(payload?.department || "").trim().toLowerCase()
        ) ||
        null;
      const after = savedScale ? services.database.getSalaryScaleSnapshot(savedScale.id) : null;
      logAudit(
        user,
        payload?.id ? "salary_scale.update" : "salary_scale.create",
        "salary_scale",
        payload?.department ? `${payload.job_title} / ${payload.department}` : payload.job_title,
        { before, after, changes: buildDiff(before, after) },
        savedScale?.id ?? payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("salary-scales:delete", withAdmin(async (user, scaleId) => {
    const before = services.database.getSalaryScaleSnapshot(scaleId);
    const result = services.database.deleteSalaryScale(scaleId);
    if (result?.ok) {
      logAudit(
        user,
        "salary_scale.delete",
        "salary_scale",
        before?.department ? `${before.job_title} / ${before.department}` : before?.job_title || `Escala ${scaleId}`,
        { before, after: null },
        scaleId
      );
    }
    return result;
  }));
  ipcMain.handle("payroll:process", withPermission("payroll.process", async (user, month) => {
    const result = services.payroll.processMonth(month);
    if (result?.ok) {
      logAudit(user, "payroll.process", "payroll_period", month, { itemCount: result.items?.length || 0 }, null, month);
    }
    return result;
  }));
  ipcMain.handle("payroll:preview-reprocess", withAdmin(async (user, monthRef) => {
    return services.payroll.previewReprocessMonth(monthRef);
  }));
  ipcMain.handle("payroll:reprocess", withAdmin(async (user, payload) => {
    const request =
      typeof payload === "string"
        ? { monthRef: payload }
        : {
            monthRef: payload?.monthRef,
            allowClosedPeriod: Boolean(payload?.allowClosedPeriod),
            authorizationReason: String(payload?.authorizationReason || "").trim()
          };
    const result = services.payroll.reprocessMonth(request.monthRef, {
      allowClosedPeriod: request.allowClosedPeriod,
      authorizationReason: request.authorizationReason
    });
    if (result?.ok) {
      logAudit(
        user,
        "payroll.reprocess",
        "payroll_period",
        request.monthRef,
        {
          itemCount: result.items?.length || 0,
          changedCount: result.changedCount || 0,
          fiscalProfile: result.fiscalProfile || null,
          authorization: result.authorization || null,
          totals: result.totals || null,
          authorizationReason: request.authorizationReason || ""
        },
        null,
        request.monthRef
      );
    }
    return result;
  }));
  ipcMain.handle("payroll:list", withPermission("payroll.view", async () => services.database.listPayrollRuns()));
  ipcMain.handle("payroll:delete-run", withAdmin(async (user, payrollRunId) => {
    const result = services.database.deletePayrollRun(payrollRunId);
    if (result?.ok) {
      logAudit(user, "payroll.delete_run", "payroll_run", `Pagamento ${payrollRunId}`, { payrollRunId }, payrollRunId);
    }
    return result;
  }));
  ipcMain.handle("payroll:delete-month", withAdmin(async (user, monthRef) => {
    const result = services.database.deletePayrollRunsByMonth(monthRef);
    if (result?.ok) {
      logAudit(user, "payroll.delete_month", "payroll_period", monthRef, { monthRef }, null, monthRef);
    }
    return result;
  }));
  ipcMain.handle("payroll:close-period", withAdmin(async (user, monthRef) => {
    const result = services.database.closePayrollPeriod(monthRef, user.id);
    if (result?.ok) {
      logAudit(user, "payroll.close_period", "payroll_period", monthRef, { monthRef }, null, monthRef);
    }
    return result;
  }));
  ipcMain.handle("payroll:reopen-period", withAdmin(async (user, monthRef) => {
    const result = services.database.reopenPayrollPeriod(monthRef, user.id);
    if (result?.ok) {
      logAudit(user, "payroll.reopen_period", "payroll_period", monthRef, { monthRef }, null, monthRef);
    }
    return result;
  }));
  ipcMain.handle("agt:save-submission", withAdmin(async (user, payload) => {
    const result = services.database.saveAgtMonthlySubmission(payload, user.id);
    if (result?.ok) {
      logAudit(
        user,
        "agt.submission.save",
        "agt_submission",
        payload?.month_ref || "Mapa AGT",
        {
          status: result.submission?.status || "",
          submissionMode: result.submission?.submission_mode || "",
          proofReference: result.submission?.proof_reference || "",
          proofPath: result.submission?.proof_path || ""
        },
        null,
        payload?.month_ref || null
      );
    }
    return result;
  }));
  ipcMain.handle("reports:summary", withPermission("reports.view", async (user, month) => services.payroll.getMonthlySummary(month)));
  ipcMain.handle("audit:list", withAdmin(async (user, filters) => ({ ok: true, items: services.database.listAuditLogs(filters || {}) })));
  ipcMain.handle("audit:export", withAdmin(async (user, filters) => services.database.exportAuditCsv(filters || {})));
  ipcMain.handle("audit:export-excel", withAdmin(async (user, filters) => services.database.exportAuditExcel(filters || {})));
  ipcMain.handle("excel:export-monthly-payroll", withPermission("exports.generate", async (user, payload) => services.database.exportMonthlyPayrollExcel(payload)));
  ipcMain.handle(
    "excel:export-agt-monthly-remuneration",
    withPermission("exports.generate", async (user, payload) => services.database.exportAgtMonthlyRemunerationExcel(payload))
  );
  ipcMain.handle("excel:export-state-payments", withPermission("exports.generate", async (user, payload) => services.database.exportStatePaymentsExcel(payload)));
  ipcMain.handle("excel:export-attendance", withPermission("exports.generate", async (user, payload) => services.database.exportAttendanceExcel(payload, payload?.reportType)));
  ipcMain.handle("excel:export-shift-map", withPermission("exports.generate", async (user, payload) => services.database.exportShiftMapExcel(payload, payload?.reportType)));
  ipcMain.handle("bank:export-payroll", withPermission("bank.export", async (user, payload) => {
    const format = String(payload?.format || "csv").toLowerCase();
    if (format === "ps2" || format === "psx") {
      return services.database.exportBankPayrollFile(payload.bank, payload, format);
    }
    return services.database.exportBankPayrollCsv(payload.bank, payload);
  }));
  ipcMain.handle("pdf:payslip", withPermission("pdf.generate", async (user, payrollRunId) => services.pdf.generatePayslip(payrollRunId)));
  ipcMain.handle("pdf:payslips-by-month", withPermission("pdf.generate", async (user, monthRef) => services.pdf.generatePayslipsByMonth(monthRef)));
  ipcMain.handle("pdf:monthly-package", withPermission("pdf.generate", async (user, payload) => services.pdf.exportMonthlyPackage(payload)));
  ipcMain.handle("pdf:report", withPermission("pdf.generate", async (user, payload) => services.pdf.generateReport(payload)));
  ipcMain.handle("backup:create", withAdmin(async (user) => {
    const result = services.database.createBackup();
    if (result?.ok) {
      logAudit(user, "backup.create", "backup", "Base de dados", { path: result.path });
    }
    return result;
  }));
  ipcMain.handle("backup:list", withAdmin(async () => ({ ok: true, items: services.database.listBackups() })));
  ipcMain.handle("backup:restore", withAdmin(async (user, backupPath) => {
    const result = services.database.restoreBackup(backupPath);
    if (!result?.ok) {
      return result;
    }

    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);

    return {
      ...result,
      message: "Backup restaurado com sucesso. A aplicacao sera reiniciada para carregar os dados repostos."
    };
  }));
  ipcMain.handle("app:update-check", withAuth(async () => services.updater.checkForUpdates()));
  ipcMain.handle("app:update-download", withPermission("app.update.manage", async () => services.updater.downloadUpdate()));
  ipcMain.handle("app:update-install", withPermission("app.update.manage", async () => services.updater.installDownloadedUpdate()));
  ipcMain.handle("dialog:select-logo", withAdmin(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "svg"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  }));
  ipcMain.handle("dialog:select-attendance-file", withPermission("attendance.manage", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Ficheiros de assiduidade", extensions: ["csv", "txt", "dat", "log"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  }));
  ipcMain.handle("dialog:select-attendance-folder", withAdmin(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  }));
  ipcMain.handle("dialog:select-document-file", withPermission("documents.manage", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Documentos laborais", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "txt"] },
        { name: "Todos os ficheiros", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  }));
}

app.whenReady().then(() => {
  log.info("[BOOT] starting app");
  startupIntegrityNotified = false;
  app.setName("Kwanza Folha");
  Menu.setApplicationMenu(null);
  registerStartupIpcFallbacks();
  cleanupLegacyData();
  const userDataPath = app.getPath("userData");
  const documentsPath = app.getPath("documents");
  const programDataPath = path.join(process.env.ProgramData || "C:\\ProgramData", "Kwanza Folha");
  const cachePath = app.getPath("cache");
  log.info("[BOOT] resolved paths", { userDataPath, documentsPath, programDataPath });
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.mkdirSync(programDataPath, { recursive: true });
  ensureDir(app.getPath("sessionData"));
  ensureDir(cachePath);
  ensureDir(app.getPath("logs"));

  if (fs.existsSync(cachePath)) {
    try {
      fs.rmSync(cachePath, { recursive: true, force: true });
      ensureDir(cachePath);
    } catch {}
  }

  log.info("[BOOT] loading secure storage");
  const secureStorage = new SecureStorageService({
    userDataPath,
    appName: "Kwanza Folha",
    programDataPath
  });
  log.info("[BOOT] secure storage ready");
  log.info("[BOOT] loading installation identity");
  const installationIdentity = new InstallationIdentityService({
    appName: "Kwanza Folha",
    userDataPath,
    productCode: "KWANZAFOLHA",
    secureStorage,
    programDataPath
  });
  log.info("[BOOT] installation identity service ready");
  log.info("[BOOT] loading anti-tamper");
  const antiTamper = new AntiTamperService({
    app,
    appRoot: path.join(__dirname, "..")
  });
  log.info("[BOOT] anti-tamper ready");

  try {
    log.info("[BOOT] migrating legacy installation");
    installationIdentity.migrateLegacyInstallation();
    log.info("[BOOT] verifying installation anchors");
    const anchors = installationIdentity.verifyInstallationAnchors();
    log.info("[BOOT] installation anchors verified", summarizeAnchorVerification(anchors));
    if (!anchors.ok) {
      setStartupIntegrityIssue("installation-identity", "Nao foi possivel validar as ancoras de seguranca da instalacao.");
    }
  } catch (error) {
    setStartupIntegrityIssue(
      "installation-identity",
      error.message || "Nao foi possivel validar a identidade da instalacao.",
      { error: String(error?.stack || error?.message || error) }
    );
    log.error("Falha ao validar a identidade da instalacao", error);
  }

  log.info("[BOOT] verifying executable signature");
  const expectedSignerThumbprints = Array.from(
    new Set(
      [
        process.env.KWANZA_AUTHENTICODE_THUMBPRINT,
        process.env.KWANZA_AUTHENTICODE_THUMBPRINTS,
        licenseSource.expectedSignerThumbprint,
        ...(Array.isArray(licenseSource.expectedSignerThumbprints) ? licenseSource.expectedSignerThumbprints : [])
      ]
        .flatMap((value) => String(value || "").split(","))
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  );
  const executableSignature = installationIdentity.verifyExecutableSignature(
    process.execPath,
    expectedSignerThumbprints[0] || "",
    {
      developmentMode: !app.isPackaged || isLocalPackagedBuildRuntime(),
      allowedThumbprints: expectedSignerThumbprints
    }
  );
  log.info("[BOOT] executable signature result", executableSignature);
  if (!app.isPackaged && executableSignature.warning && isLocalDevelopmentRuntime()) {
    log.warn("[BOOT][FALLBACK] assinatura validada em modo dev local com excecao controlada", executableSignature);
  } else if (app.isPackaged && executableSignature.warning) {
    log.warn("[BOOT][WARN] assinatura validada com aviso em modo empacotado", executableSignature);
  } else if (app.isPackaged && !executableSignature.ok) {
    if (isLocalPackagedBuildRuntime()) {
      log.warn("[BOOT][LOCAL-PACKAGED] assinatura invalida no binario local de QA; validacao estrita mantida apenas para instalacoes comerciais.");
    } else {
    setStartupIntegrityIssue(
      "executable-signature",
      executableSignature.message || "A assinatura do executavel nao pode ser validada.",
      { code: executableSignature.code || "invalid_signature" }
    );
    }
  }

  log.info("[BOOT] verifying module integrity");
  const tamperCheck = antiTamper.verifyCriticalModules();
  log.info("[BOOT] module integrity result", tamperCheck);
  if (!tamperCheck.ok) {
    setStartupIntegrityIssue(
      "module-integrity",
      tamperCheck.message || "Foram detetadas alteracoes nos modulos criticos da aplicacao.",
      { mismatches: tamperCheck.mismatches || [] }
    );
  }

  log.info("[BOOT] detecting debug environment");
  const debugCheck = antiTamper.detectDebugEnvironment();
  log.info("[BOOT] debug environment result", debugCheck);
  if (app.isPackaged && !debugCheck.ok) {
    setStartupIntegrityIssue("debug-environment", debugCheck.message || "Ambiente de debug detetado.");
  }

  const allowPackagedSmokeBoot = isPackagedSmokeE2EMode();
  const enforceCommercialIntegrity = app.isPackaged && !isLocalPackagedBuildRuntime();
  const blockCommercialStartup = enforceCommercialIntegrity && !startupIntegrityState.ok && !allowPackagedSmokeBoot;
  if (allowPackagedSmokeBoot && !startupIntegrityState.ok) {
    log.warn("[BOOT][SMOKE-E2E] integrity issue detected, but commercial services are allowed for packaged smoke validation only.", {
      stage: startupIntegrityState.stage || "startup",
      message: startupIntegrityState.message || "Falha de integridade no arranque."
    });
  }
  if (blockCommercialStartup) {
    log.error("[BOOT][BLOCKED] startup integrity failed in packaged mode. Commercial services were not initialized.", {
      stage: startupIntegrityState.stage || "startup",
      message: startupIntegrityState.message || "Falha de integridade no arranque."
    });
  } else {
    try {
      log.info("[BOOT] initializing application services");
      services = createAppServices({ userDataPath, documentsPath, programDataPath, secureStorage, installationIdentity });
      log.info("[BOOT] application services ready");
      log.info("[BOOT] initializing database backup");
      services.database.performAutomaticBackup();
      log.info("[BOOT] database backup initialization finished");
      log.info("[BOOT] registering ipc");
      registerIpc();
      log.info("[BOOT] ipc registered");
    } catch (error) {
      setStartupIntegrityIssue(
        "services-init",
        resolveStartupFailureMessage(error),
        { error: String(error?.stack || error?.message || error) }
      );
      log.error("Falha ao inicializar os servicos da aplicacao", error);
    }
  }
  log.info("[BOOT] creating window");
  createWindow();
  log.info("[BOOT] window creation requested");
  notifyStartupIntegrityIssue();
  if (services) {
    refreshAttendanceWatcher();
    log.info("[BOOT] priming installation license state");
    if (services?.licensingCore?.primeInstallation) {
      void services.licensingCore.primeInstallation().catch((error) => {
        log.error("Falha ao preparar o estado inicial de licenciamento", error);
      });
    }
  } else {
    log.warn("[BOOT][FALLBACK] commercial services unavailable; startup kept in degraded mode.");
  }
  log.info("[BOOT] startup sequence finished");
  if (isPackagedSmokeE2EMode()) {
    log.info("[BOOT] packaged smoke e2e mode enabled");
    void runPackagedSmokeE2EScenario()
      .then((result) => {
        const exitCode = result?.ok ? 0 : 1;
        setTimeout(() => app.exit(exitCode), 400);
      })
      .catch((error) => {
        log.error("[BOOT][SMOKE-E2E] erro inesperado", error);
        setTimeout(() => app.exit(1), 400);
      });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      notifyStartupIntegrityIssue();
    }
  });
});

app.on("before-quit", () => {
  stopAttendanceWatcher();
  try {
    services?.database?.prepareForShutdown();
  } catch (error) {
    log.error("Erro ao cifrar a base de dados durante o encerramento", error);
  }
});

app.on("window-all-closed", () => {
  stopAttendanceWatcher();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  log.error("Erro inesperado", error);
});

process.on("unhandledRejection", (error) => {
  log.error("Promessa rejeitada sem tratamento", error);
});
