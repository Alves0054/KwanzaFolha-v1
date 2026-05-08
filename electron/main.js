const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const licenseSource = require("./config/license-source");
const { createAppServices } = require("./services/core/create-app-services");
const { LicensingService, createLicensingCore } = require("./services/core/licensing");
const { SecureStorageService } = require("./services/secure-storage");
const { InstallationIdentityService } = require("./services/installation-identity");
const { AntiTamperService } = require("./services/anti-tamper");
const { SupportDiagnosticsService } = require("./services/support-diagnostics");
const startupErrors = require("./services/startup-errors");
const { hasPermission, getPermissionDeniedMessage } = require("./services/permissions");
const { enforceEmployeeLimit } = require("../shared/domain/licensing-limits");
const { LICENSE_PLANS } = require("../shared/license-plans");

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
let bootLicensingCore = null;
let supportDiagnostics;
let attendanceWatcher = null;
let servicesReadyPromiseResolve = null;
let servicesReadyPromiseReject = null;
const servicesReadyPromise = new Promise((resolve, reject) => {
  servicesReadyPromiseResolve = resolve;
  servicesReadyPromiseReject = reject;
});

function markServicesReady(nextServices) {
  log.info("[BOOT] services marked ready", {
    hasDatabase: Boolean(nextServices?.database),
    hasLicensingCore: Boolean(nextServices?.licensingCore)
  });
  if (servicesReadyPromiseResolve) {
    servicesReadyPromiseResolve(nextServices);
    servicesReadyPromiseResolve = null;
    servicesReadyPromiseReject = null;
  }
}

function markServicesFailed(error) {
  log.error("[BOOT] services marked failed", {
    message: String(error?.message || error || "unknown")
  });
  if (servicesReadyPromiseReject) {
    servicesReadyPromiseReject(error || new Error("Falha ao inicializar os serviços principais."));
    servicesReadyPromiseResolve = null;
    servicesReadyPromiseReject = null;
  }
}

function buildStartupDegradedMessage(fallback = "Os serviços principais ainda não ficaram disponíveis.") {
  const stagePrefix = startupIntegrityState?.stage ? `[${startupIntegrityState.stage}] ` : "";
  return `${stagePrefix}${startupIntegrityState?.message || fallback}`;
}

function sanitizeActivationPayload(payload = {}) {
  return {
    email: String(payload?.email || "").trim().toLowerCase(),
    serialKey: String(payload?.serialKey || payload?.serial_key || "").trim().toUpperCase()
  };
}

function buildActivationPendingResponse(activationResult = {}, reason = "") {
  const integrityBlocked = startupIntegrityState && startupIntegrityState.ok === false;
  const technicalReason = integrityBlocked
    ? startupIntegrityState.message || "Falha de integridade no arranque."
    : reason || "O módulo local de ativação ainda não iniciou.";
  const message = integrityBlocked
    ? `A licença foi recebida e gravada localmente, mas o arranque comercial está bloqueado: ${technicalReason}`
    : "Licença recebida com sucesso. Reinicie o aplicativo para concluir a ativação.";

  return {
    ok: false,
    status: integrityBlocked ? "activation_blocked_by_integrity" : "activation_pending_services",
    licenseStored: true,
    canUseApp: false,
    serialKey: activationResult?.serialKey || activationResult?.serial_key || "",
    expireDate: activationResult?.expireDate || activationResult?.expire_date || "",
    message,
    technicalReason
  };
}

async function activateLicenseThroughAvailableCore(payload, options = {}) {
  const normalizedPayload = sanitizeActivationPayload(payload);
  const source = String(options.source || "ipc").trim() || "ipc";

  log.info("[LICENSING][ACTIVATE] activation requested", {
    source,
    email: normalizedPayload.email,
    hasSerial: Boolean(normalizedPayload.serialKey),
    servicesReady: Boolean(services?.licensingCore),
    bootCoreReady: Boolean(bootLicensingCore)
  });
  recordSupportEvent("info", "licensing", "licensing.activate.requested", "Pedido de ativação local recebido.", {
    source,
    email: normalizedPayload.email,
    hasSerial: Boolean(normalizedPayload.serialKey),
    servicesReady: Boolean(services?.licensingCore)
  });

  if (!normalizedPayload.serialKey) {
    return { ok: false, message: "Introduza o serial da licença antes de ativar." };
  }

  const readyServices = services?.licensingCore
    ? services
    : await waitForServicesReady({ timeoutMs: 30000 });

  if (readyServices?.licensingCore) {
    const result = await readyServices.licensingCore.activateLicense(normalizedPayload);
    recordSupportEvent(
      result?.ok ? "info" : "error",
      "licensing",
      "licensing.activate.local",
      result?.ok ? "Licença ativada pelo core principal." : result?.message || "Falha na ativação pelo core principal.",
      {
        source,
        email: normalizedPayload.email,
        status: String(result?.status || "").trim(),
        ok: Boolean(result?.ok)
      }
    );
    return result;
  }

  if (!bootLicensingCore?.activateLicense) {
    const message = buildStartupDegradedMessage("O módulo local de ativação ainda não iniciou.");
    recordSupportEvent("error", "licensing", "licensing.activate.unavailable", message, {
      source,
      email: normalizedPayload.email,
      startupIntegrity: startupIntegrityState
    });
    return {
      ok: false,
      status: "activation_services_unavailable",
      message: `A licença foi recebida, mas o módulo local de ativação ainda não iniciou. ${message}`
    };
  }

  log.warn("[LICENSING][ACTIVATE] using boot licensing core because main services are unavailable", {
    source,
    email: normalizedPayload.email,
    startupIntegrity: startupIntegrityState
  });
  recordSupportEvent("warn", "licensing", "licensing.activate.boot-core", "Ativacao encaminhada para o core independente de boot.", {
    source,
    email: normalizedPayload.email,
    startupIntegrity: startupIntegrityState
  });

  const result = await bootLicensingCore.activateLicense(normalizedPayload);
  if (!result?.ok) {
    recordSupportEvent("error", "licensing", "licensing.activate.boot-core.failed", result?.message || "Falha na ativação pelo core de boot.", {
      source,
      email: normalizedPayload.email,
      status: String(result?.status || "").trim()
    });
    return result;
  }

  recordSupportEvent("warn", "licensing", "licensing.activate.boot-core.stored", "Licença gravada pelo core de boot; app continua a aguardar serviços principais.", {
    source,
    email: normalizedPayload.email,
    status: String(result?.status || "").trim(),
    startupIntegrity: startupIntegrityState
  });
  return buildActivationPendingResponse(result, buildStartupDegradedMessage("Serviços principais indisponíveis após a ativação local."));
}

async function waitForServicesReady({ timeoutMs = 12000 } = {}) {
  if (services) return services;

  let timeout = null;
  try {
    const result = await Promise.race([
      servicesReadyPromise,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
    return result || services || null;
  } catch {
    return services || null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  function consume(key) {
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    if (current.count >= max) {
      return { ok: false, retryAfterMs: Math.max(1, current.resetAt - now) };
    }
    current.count += 1;
    buckets.set(key, current);
    return { ok: true };
  }

  return { consume };
}

const loginRateLimiter = createRateLimiter({ windowMs: 60_000, max: 12 });
const resetRequestRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 6 });
const resetCompleteRateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
let attendanceSyncTimer = null;
let startupIntegrityState = {
  ok: true,
  message: "",
  details: {}
};
let startupIntegrityNotified = false;

function recordSupportEvent(level, category, event, message, details = {}) {
  try {
    supportDiagnostics?.recordEvent({
      level,
      category,
      event,
      message,
      details
    });
  } catch (error) {
    log.warn("[SUPPORT] falha ao registar evento estruturado", {
      event,
      error: String(error?.message || error)
    });
  }
}

function normalizePathForCompare(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .toLowerCase();
}

function isLocalPackagedBuildRuntime() {
  if (!app.isPackaged) {
    return false;
  }

  const executablePath = normalizePathForCompare(process.execPath);
  // Quando executamos o binário diretamente a partir do `dist-electron/win-unpacked`
  // (QA local), não exigimos integridade comercial estrita para evitar falsos positivos
  // durante o ciclo de build/teste. Instalações reais (ex: Program Files) continuam estritas.
  return executablePath.includes("\\dist-electron\\win-unpacked\\") ||
    (process.env.KWANZA_LOCAL_PACKAGED_DEV_MODE === "1" && executablePath.includes("\\win-unpacked\\"));
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
  recordSupportEvent("warn", "boot", `boot.integrity.${startupIntegrityState.stage}`, startupIntegrityState.message, details);
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

function copyFileIfMissing(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || !fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyDirectoryMissingFiles(sourceDir, targetDir) {
  if (!sourceDir || !targetDir || !fs.existsSync(sourceDir)) {
    return 0;
  }
  let copied = 0;
  for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, item.name);
    const targetPath = path.join(targetDir, item.name);
    if (item.isDirectory()) {
      copied += copyDirectoryMissingFiles(sourcePath, targetPath);
    } else if (item.isFile() && copyFileIfMissing(sourcePath, targetPath)) {
      copied += 1;
    }
  }
  return copied;
}

function findLegacyDataSources() {
  const appData = process.env.APPDATA || "";
  return [
    path.join(appData, "Kwanza Folha"),
    path.join(appData, "Kwanza Folha.legacy_backup"),
    path.join(appData, "kwanza-facto-desktop")
  ].filter((candidate, index, list) => candidate && list.indexOf(candidate) === index && fs.existsSync(candidate));
}

function sourceHasLegacyBusinessData(sourceDir) {
  const candidates = [
    "kwanza-folha.sqlite",
    "kwanza-folha.runtime.sqlite",
    "kwanza-folha.sqlite.enc",
    "license.json",
    "license.dat",
    path.join("secure-store", "license-cache.bin"),
    path.join("secure-store", "trial-cache.bin")
  ];
  return candidates.some((relativePath) => fs.existsSync(path.join(sourceDir, relativePath)));
}

function currentInstallHasDatabase(userDataPath, programDataPath) {
  const protectedDataRoot = path.join(programDataPath || path.join(process.env.ProgramData || "C:\\ProgramData", "Kwanza Folha"), "LocalState");
  const candidates = [
    path.join(protectedDataRoot, "kwanza-folha.sqlite"),
    path.join(protectedDataRoot, "kwanza-folha.runtime.sqlite"),
    path.join(protectedDataRoot, "kwanza-folha.sqlite.enc"),
    path.join(userDataPath, "kwanza-folha.sqlite"),
    path.join(userDataPath, "kwanza-folha.runtime.sqlite"),
    path.join(userDataPath, "kwanza-folha.sqlite.enc")
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function migrateLegacyDataIfNeeded(userDataPath, programDataPath) {
  const sources = findLegacyDataSources().filter(sourceHasLegacyBusinessData);
  if (!sources.length) {
    return;
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const protectedDataRoot = path.join(programDataPath, "LocalState");
  fs.mkdirSync(protectedDataRoot, { recursive: true });

  const sourceDir = sources[0];
  const copied = [];
  const currentHasDatabase = currentInstallHasDatabase(userDataPath, programDataPath);

  if (!currentHasDatabase) {
    for (const fileName of ["kwanza-folha.sqlite.enc", "kwanza-folha.sqlite", "kwanza-folha.runtime.sqlite"]) {
      if (copyFileIfMissing(path.join(sourceDir, fileName), path.join(userDataPath, fileName))) {
        copied.push(fileName);
      }
    }
  }

  for (const fileName of [
    "license.json",
    "license.dat",
    "developer-license.json",
    "data-protection.key",
    "session-state.key",
    "session-state.json",
    "backup-state.json",
    "install.cache"
  ]) {
    if (copyFileIfMissing(path.join(sourceDir, fileName), path.join(userDataPath, fileName))) {
      copied.push(fileName);
    }
  }

  const secureStoreCopied = copyDirectoryMissingFiles(path.join(sourceDir, "secure-store"), path.join(userDataPath, "secure-store"));
  if (secureStoreCopied > 0) {
    copied.push(`secure-store:${secureStoreCopied}`);
  }

  if (copied.length) {
    const receiptPath = path.join(userDataPath, "legacy-migration.json");
    try {
      fs.writeFileSync(
        receiptPath,
        JSON.stringify(
          {
            migrated_at: new Date().toISOString(),
            source: sourceDir,
            copied,
            current_database_preserved: currentHasDatabase
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {}
    log.warn("[BOOT][LEGACY-MIGRATION] dados legados copiados para a instalação atual", {
      sourceDir,
      copied,
      currentHasDatabase
    });
  }
}

function getSessionUser() {
  return services.auth.getAuthenticatedUser();
}

function withAuth(handler) {
  return async (_, ...args) => {
    if (!services?.auth || !services?.licensingCore) {
      recordSupportEvent(
        "error",
        "boot",
        "boot.services.unavailable",
        startupIntegrityState?.message || "Os serviços principais ainda não ficaram disponíveis.",
        startupIntegrityState
      );
      return {
        ok: false,
        message: startupIntegrityState?.message || "Os serviços principais ainda não ficaram disponíveis."
      };
    }
    const user = getSessionUser();
    if (!user) {
      return { ok: false, message: "Sessao inválida. Inicie sessão novamente." };
    }
    const licenseGuard = services.licensingCore.getGuardResult();
    if (!licenseGuard.ok) {
      log.warn("[BOOT][FALLBACK]", {
        stage: "license-guard",
        code: licenseGuard.code || "invalid",
        message: licenseGuard.message || "Licenciamento inválido ou expirado."
      });
      recordSupportEvent(
        "warn",
        "licensing",
        "licensing.guard.denied",
        licenseGuard.message || "Licenciamento inválido ou expirado.",
        {
          code: licenseGuard.code || "invalid",
          status: licenseGuard?.license?.status || ""
        }
      );
      return {
        ok: false,
        message: licenseGuard.message || "Licenciamento inválido ou expirado. Ative ou renove para continuar."
      };
    }
    return handler(user, ...args);
  };
}

function registerStartupIpcFallbacks() {
  const getDegradedMessage = () => buildStartupDegradedMessage();
  const safeHandle = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  };

  async function apiFallbackRequest(route, payload = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const baseUrl = String(process.env.KWANZA_LICENSE_API_URL || "https://license.alvesestudio.ao")
      .trim()
      .replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload || {}),
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          message: result?.message || `Não foi possível concluir o pedido (${response.status}).`
        };
      }
      return result;
    } catch (error) {
      const failureMessage = String(error?.message || "").trim();
      const networkCode = String(error?.cause?.code || error?.code || "").trim().toUpperCase();
      const configuredHost = (() => {
        try {
          return new URL(baseUrl).host;
        } catch {
          return "servidor de licenças";
        }
      })();

      if (networkCode === "ENOTFOUND") {
        return {
          ok: false,
          message: `Não foi possível resolver o dominio do servidor de licenças (${configuredHost}). Verifique o DNS do subdomínio.`
        };
      }

      if (networkCode === "ECONNREFUSED" || networkCode === "EHOSTUNREACH" || networkCode === "ETIMEDOUT") {
        return {
          ok: false,
          message: `Não foi possível ligar ao servidor de licenças (${configuredHost}). Verifique se o serviço está online e com HTTPS ativo.`
        };
      }

      return {
        ok: false,
        message: error.name === "AbortError" ? "O servidor de licenças demorou demasiado tempo a responder." : failureMessage || "Não foi possível comunicar com o servidor de licenças."
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const withServicesOrDegraded = (handler) => async (...args) => {
    const readyServices = await waitForServicesReady({ timeoutMs: 12000 });
    if (!readyServices) {
      return handler(null, ...args);
    }
    return handler(readyServices, ...args);
  };

  safeHandle("app:get-version", async () => ({ version: app.getVersion() }));
  safeHandle("license:get-status", withServicesOrDegraded((readyServices) => {
    if (readyServices?.licensingCore) {
      return readyServices.licensingCore.getStatus(true);
    }

    const degradedMessage = getDegradedMessage();
    let bootStatus = null;
    try {
      bootStatus = bootLicensingCore?.getStatus ? bootLicensingCore.getStatus(true) : null;
    } catch (error) {
      log.warn("[LICENSING][STATUS] boot licensing status failed", {
        error: String(error?.message || error)
      });
    }

    if (bootStatus?.canUseApp) {
      return {
        ...bootStatus,
        ok: false,
        canUseApp: false,
        status: "core_services_unavailable",
        licenseStored: true,
        message: `Licença local válida, mas os serviços principais não iniciaram. ${degradedMessage}`
      };
    }

    return {
      ok: true,
      status: "degraded_startup",
      canUseApp: false,
      requiresLicense: false,
      message: degradedMessage
    };
  }));
  safeHandle("license:get-plans", async () => ({ ok: true, plans: LICENSE_PLANS.map((plan) => ({ ...plan })) }));
  safeHandle("license:get-api-base-url", withServicesOrDegraded((readyServices) => {
    if (!readyServices) {
      return { ok: true, resolved: String(process.env.KWANZA_LICENSE_API_URL || "https://license.alvesestudio.ao").trim(), candidate: "" };
    }
    return readyServices.licensingCore.getApiBaseUrlState();
  }));
  safeHandle("license:set-api-base-url", withServicesOrDegraded((readyServices, _, payload) => {
    if (!readyServices) {
      return { ok: false, message: getDegradedMessage() };
    }
    return readyServices.licensingCore.setApiBaseUrl(payload?.apiBaseUrl);
  }));
  safeHandle("license:create-payment", withServicesOrDegraded(async (readyServices, _, payload) => {
    if (!readyServices) {
      log.info("[LICENSING][PAYMENT] creating payment through startup fallback", {
        plan: String(payload?.plan || "").trim()
      });
      return apiFallbackRequest("/payment/create", payload || {});
    }
    return readyServices.licensingCore.createPaymentReference(payload);
  }));
  safeHandle("license:check-payment", withServicesOrDegraded(async (readyServices, _, payload) => {
    if (!readyServices) {
      const result = await apiFallbackRequest("/payment/status", { reference: payload?.reference });
      log.info("[LICENSING][PAYMENT] startup fallback payment status result", {
        reference: String(payload?.reference || "").trim(),
        status: String(result?.status || "").trim(),
        hasSerial: Boolean(result?.serial_key)
      });
      if (result?.ok && result?.serial_key) {
        recordSupportEvent("info", "licensing", "licensing.payment.serial.received", "Servidor devolveu serial_key durante arranque degradado.", {
          reference: String(payload?.reference || "").trim(),
          status: String(result?.status || "").trim()
        });
      }
      return result;
    }
    return readyServices.licensingCore.checkPaymentStatus(payload?.reference);
  }));
  safeHandle("license:activate", async (_, payload) => activateLicenseThroughAvailableCore(payload, { source: "startup-fallback" }));
  safeHandle("license:renew", withServicesOrDegraded(async (readyServices, _, payload) => {
    if (!readyServices) {
      return apiFallbackRequest("/payment/create", { ...(payload || {}), renewal: true });
    }
    return readyServices.licensingCore.renewLicense(payload);
  }));
  safeHandle("support:health", async () => ({
    ok: true,
    degraded: true,
    startupIntegrity: startupIntegrityState,
    message: getDegradedMessage()
  }));
  safeHandle("support:export-logs", async () => {
    if (!supportDiagnostics) {
      return { ok: false, message: "Serviço de diagnóstico indisponivel." };
    }
    return supportDiagnostics.exportSupportBundle({
      reason: "startup_degraded",
      startupIntegrity: startupIntegrityState
    });
  });
  // Este handler deve existir SEMPRE (antes e depois da inicialização), para evitar
  // o erro "No handler registered for 'auth:get-state'" no arranque do renderer.
  safeHandle("auth:get-state", async () => {
    try {
      if (services?.auth?.getState) {
        return services.auth.getState();
      }
    } catch {}
    return { setupRequired: false, canRegister: false, company: null };
  });
  safeHandle("auth:restore-session", async () => ({ ok: false, message: getDegradedMessage() }));
  safeHandle("auth:login", async () => ({ ok: false, message: getDegradedMessage() }));
  safeHandle("auth:register-initial", async () => ({ ok: false, message: getDegradedMessage() }));
  safeHandle("auth:request-password-reset", async () => ({ ok: false, message: getDegradedMessage() }));
}

function withAdmin(handler) {
  return withAuth(async (user, ...args) => {
    if (user.role !== "admin") {
      return { ok: false, message: "Apenas administradores podem executar esta operação." };
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
  return /^httpsó:\/\//i.test(String(targetUrl || "").trim());
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
    log.error("Não foi possível abrir a ligação externa em segurança", error);
  });
}

function resolveClientManualPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "docs", "utilizador", "Manual do Cliente.pdf"),
    path.join(__dirname, "..", "docs", "utilizador", "Manual do Cliente.pdf"),
    path.join(app.getAppPath(), "docs", "utilizador", "Manual do Cliente.pdf")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function downloadClientManual() {
  const sourcePath = resolveClientManualPath();
  if (!sourcePath) {
    return {
      ok: false,
      message: "O Manual do Cliente não foi encontrado na instalação."
    };
  }

  const downloadsDir = app.getPath("downloads");
  const destinationPath = path.join(downloadsDir, "Kwanza Folha - Manual do Cliente.pdf");
  fs.copyFileSync(sourcePath, destinationPath);

  try {
    shell.showItemInFolder(destinationPath);
  } catch (error) {
    log.warn("Não foi possível mostrar o Manual do Cliente na pasta Downloads.", error);
  }

  return {
    ok: true,
    path: destinationPath,
    message: `Manual do Cliente guardado em ${destinationPath}.`
  };
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
      throw new Error("Serviços principais indisponíveis para o smoke E2E empacotado.");
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
      throw new Error(licenseStatus?.message || "Licença inválida para smoke E2E.");
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
      assertSmokeResult(registerResult, "Não foi possível concluir o registo inicial para o smoke E2E.");
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

    assertSmokeResult(loginResult, "Não foi possível autenticar no smoke E2E empacotado.");
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
      full_name: `Funcionário Smoke ${employeeToken}`,
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
    assertSmokeResult(saveEmployeeResult, "Não foi possível criar funcionário para o smoke E2E.");

    const smokeEmployee = (saveEmployeeResult?.employees || []).find((item) => String(item.attendance_code || "").startsWith("SMK"));
    if (!smokeEmployee?.id) {
      throw new Error("Funcionário smoke não foi localizado após criação.");
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
    assertSmokeResult(attendanceResult, "Não foi possível registar assiduidade para o smoke E2E.");

    const closeAttendanceResult = services.database.closeAttendancePeriod(monthRef, loginResult.user.id);
    if (!closeAttendanceResult?.ok && !isAlreadyClosedPeriodMessage(closeAttendanceResult?.message)) {
      throw new Error(closeAttendanceResult?.message || "Não foi possível fechar a assiduidade do período.");
    }
    addSmokeStep(report, "attendance-close", true, {
      monthRef,
      status: services.database.getAttendancePeriod(monthRef)?.status || "unknown"
    });

    let payrollResult = services.payroll.processMonth(monthRef, {
      includePreview: false,
      resetExisting: true
    });
    if (!payrollResult?.ok && /período .* fechado|período .* fechado/i.test(String(payrollResult?.message || ""))) {
      const reopenResult = services.database.reopenPayrollPeriod(monthRef, loginResult.user.id);
      if (reopenResult?.ok) {
        payrollResult = services.payroll.processMonth(monthRef, {
          includePreview: false,
          resetExisting: true
        });
      }
    }
    assertSmokeResult(payrollResult, "Não foi possível processar a folha no smoke E2E.");
    addSmokeStep(report, "payroll-process", true, {
      monthRef,
      count: payrollResult?.items?.length || 0
    });

    const exportFilters = { monthRef, employeeId: String(smokeEmployee.id) };
    const payrollExport = services.database.exportMonthlyPayrollExcel(exportFilters);
    const stateExport = services.database.exportStatePaymentsExcel(exportFilters);
    const agtExport = services.database.exportAgtMonthlyRemunerationExcel(exportFilters);

    assertSmokeResult(payrollExport, "Falha na exportação Excel da folha salarial.");
    assertSmokeResult(stateExport, "Falha na exportação Excel de pagamento ao Estado.");
    assertSmokeResult(agtExport, "Falha na exportação AGT.");

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
    log.warn("[BOOT][LOCAL-PACKAGED] aviso de assinatura suprimido para validação local.", startupIntegrityState);
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
  const title = isIntegrityIssue ? "Integridade da instalação" : "Inicializacao do sistema";
  const message = isIntegrityIssue
    ? "Erro de integridade da instalação. Contacte o suporte para reativação."
    : "Não foi possível inicializar todos os serviços internos.";
  const detailHint = (() => {
    const stage = String(startupIntegrityState?.stage || "").trim();
    if (stage === "executable-signature") {
      return "Instale uma build assinada (Setup oficial) e evite executar binários não assinados.";
    }
    if (stage === "services-init") {
      return "Reinicie a aplicação. Se persistir, restaure o ultimo backup valido.";
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
      log.error("Não foi possível apresentar o aviso de integridade", error);
    });
}

function resolveStartupFailureMessage(error) {
  return startupErrors.resolveStartupFailureMessage(error);
}

function isRecoverableDatabaseStartupError(error) {
  return startupErrors.isRecoverableDatabaseStartupError(error);
}

function isDatabaseStartupError(error) {
  return startupErrors.isDatabaseStartupError(error);
}

function quarantineRuntimeDatabaseForStartupRetry(userDataPath) {
  const runtimeDbPath = path.join(userDataPath, "kwanza-folha.runtime.sqlite");
  if (!fs.existsSync(runtimeDbPath)) {
    return null;
  }

  const diagnosticsDir = path.join(userDataPath, "Diagnostico", "StartupRecovery");
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinedMainPath = path.join(diagnosticsDir, `kwanza-folha.runtime.${stamp}.sqlite`);

  try {
    fs.copyFileSync(runtimeDbPath, quarantinedMainPath);
    if (fs.existsSync(`${runtimeDbPath}-wal`)) {
      fs.copyFileSync(`${runtimeDbPath}-wal`, `${quarantinedMainPath}-wal`);
    }
    if (fs.existsSync(`${runtimeDbPath}-shm`)) {
      fs.copyFileSync(`${runtimeDbPath}-shm`, `${quarantinedMainPath}-shm`);
    }
  } catch (copyError) {
    log.warn("[BOOT][RECOVERY] não foi possível copiar runtime DB para diagnóstico", {
      error: String(copyError?.message || copyError)
    });
  }

  safeUnlink(runtimeDbPath);
  safeUnlink(`${runtimeDbPath}-wal`);
  safeUnlink(`${runtimeDbPath}-shm`);
  return quarantinedMainPath;
}

function quarantineDatabaseArtifactsForStartupRetry(userDataPath, programDataPath) {
  const diagnosticsDir = path.join(userDataPath, "Diagnostico", "StartupRecovery");
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotRoot = path.join(diagnosticsDir, `full-db-reset-${stamp}`);
  fs.mkdirSync(snapshotRoot, { recursive: true });

  const protectedDataRoot = path.join(programDataPath || "C:\\ProgramData\\Kwanza Folha", "LocalState");
  const candidates = [
    path.join(userDataPath, "kwanza-folha.runtime.sqlite"),
    path.join(userDataPath, "kwanza-folha.runtime.sqlite-wal"),
    path.join(userDataPath, "kwanza-folha.runtime.sqlite-shm"),
    path.join(userDataPath, "kwanza-folha.sqlite"),
    path.join(userDataPath, "kwanza-folha.sqlite.enc"),
    path.join(protectedDataRoot, "kwanza-folha.sqlite"),
    path.join(protectedDataRoot, "kwanza-folha.sqlite.enc"),
    path.join(protectedDataRoot, "kwanza-folha.sqlite-wal"),
    path.join(protectedDataRoot, "kwanza-folha.sqlite-shm")
  ];

  const quarantined = [];
  for (const sourcePath of candidates) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      continue;
    }

    const targetPath = path.join(snapshotRoot, path.basename(sourcePath));
    try {
      fs.copyFileSync(sourcePath, targetPath);
      quarantined.push(targetPath);
    } catch (copyError) {
      log.warn("[BOOT][RECOVERY] não foi possível copiar artefacto DB para diagnóstico", {
        sourcePath,
        error: String(copyError?.message || copyError)
      });
    }

    safeUnlink(sourcePath);
  }

  return {
    snapshotRoot,
    quarantinedCount: quarantined.length
  };
}

function safeUnlink(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  } catch {}
}

function registerIpc() {
  ipcMain.removeHandler("app:get-version");
  ipcMain.removeHandler("app:quit");
  ipcMain.removeHandler("license:get-status");
  ipcMain.removeHandler("license:get-plans");
  ipcMain.removeHandler("license:validate-installation");
  ipcMain.removeHandler("license:get-api-base-url");
  ipcMain.removeHandler("license:set-api-base-url");
  ipcMain.removeHandler("license:create-payment");
  ipcMain.removeHandler("license:check-payment");
  ipcMain.removeHandler("license:activate");
  ipcMain.removeHandler("license:renew");
  ipcMain.removeHandler("auth:get-state");
  ipcMain.removeHandler("auth:login");
  ipcMain.removeHandler("auth:register-initial");
  ipcMain.removeHandler("auth:restore-session");
  ipcMain.removeHandler("auth:request-password-reset");
  ipcMain.removeHandler("organization:list");
  ipcMain.removeHandler("organization:save");
  ipcMain.removeHandler("organization:delete");
  ipcMain.removeHandler("organization:report");
  ipcMain.removeHandler("organization:export-excel");
  ipcMain.removeHandler("enterprise:list");
  ipcMain.removeHandler("enterprise:summary-export");
  ipcMain.removeHandler("enterprise:save");
  ipcMain.removeHandler("enterprise:delete");
  ipcMain.removeHandler("enterprise:generate-contract");
  ipcMain.removeHandler("enterprise:contract-action");
  ipcMain.removeHandler("enterprise:approval-transition");
  ipcMain.removeHandler("enterprise:convert-candidate");
  ipcMain.removeHandler("enterprise:sync-mark");
  ipcMain.removeHandler("enterprise:sync-retry-failed");
  ipcMain.removeHandler("enterprise:sync-export");
  ipcMain.removeHandler("enterprise:payroll-version");
  ipcMain.removeHandler("enterprise:payroll-version-compare");
  ipcMain.removeHandler("enterprise:fiscal-map");
  ipcMain.removeHandler("enterprise:fiscal-map-status");
  ipcMain.removeHandler("employees:import-file");
  ipcMain.removeHandler("employees:export-excel");
  ipcMain.removeHandler("support:health");
  ipcMain.removeHandler("support:export-logs");
  ipcMain.handle("app:get-version", async () => ({ version: app.getVersion() }));
  ipcMain.handle("app:quit", async () => {
    app.quit();
    return { ok: true };
  });
  ipcMain.handle("license:get-status", async () => {
    const status = services.licensingCore.getStatus(true);
    if (!status?.canUseApp) {
      recordSupportEvent(
        "warn",
        "licensing",
        "licensing.status.blocked",
        status?.message || "Licença bloqueada.",
        {
          status: status?.status || "invalid",
          requiresLicense: Boolean(status?.requiresLicense)
        }
      );
    }
    return status;
  });
  ipcMain.handle("license:validate-installation", async () => services.licensingCore.validateInstallation());
  ipcMain.handle("license:get-plans", async () => ({ ok: true, plans: services.licensingCore.getPlans() }));
  ipcMain.handle("license:get-api-base-url", async () => services.licensingCore.getApiBaseUrlState());
  ipcMain.handle("license:set-api-base-url", async (_, payload) => services.licensingCore.setApiBaseUrl(payload?.apiBaseUrl));
  ipcMain.handle("auth:get-state", async () => {
    try {
      if (services?.auth?.getState) {
        return services.auth.getState();
      }
    } catch {}
    return { setupRequired: false, canRegister: false, company: null };
  });
  ipcMain.handle("license:create-payment", async (_, payload) => {
    const result = await services.licensingCore.createPaymentReference(payload);
    recordSupportEvent(
      result?.ok ? "info" : "warn",
      "licensing",
      "licensing.payment.create",
      result?.ok ? "Referência de pagamento criada." : result?.message || "Falha ao criar referência de pagamento.",
      {
        plan: String(payload?.plan || "").trim(),
        ok: Boolean(result?.ok)
      }
    );
    return result;
  });
  ipcMain.handle("license:check-payment", async (_, payload) => {
    const result = await services.licensingCore.checkPaymentStatus(payload?.reference);
    if (result?.ok && result?.serial_key) {
      log.info("[LICENSING][PAYMENT] serial received from server", {
        reference: String(payload?.reference || "").trim(),
        status: String(result?.status || "").trim()
      });
    }
    recordSupportEvent(
      result?.ok ? "info" : "warn",
      "licensing",
      "licensing.payment.status",
      result?.ok ? "Consulta de pagamento concluída." : result?.message || "Falha ao consultar pagamento.",
      {
        reference: String(payload?.reference || "").trim(),
        status: String(result?.status || "").trim(),
        hasSerial: Boolean(result?.serial_key),
        ok: Boolean(result?.ok)
      }
    );
    return result;
  });
  ipcMain.handle("license:activate", async (_, payload) => {
    const result = await activateLicenseThroughAvailableCore(payload, { source: "main-ipc" });
    recordSupportEvent(
      result?.ok ? "info" : "error",
      "licensing",
      "licensing.activate",
      result?.ok ? "Licença ativada com sucesso." : result?.message || "Falha na ativação da licença.",
      {
        email: String(payload?.email || "").trim().toLowerCase(),
        status: String(result?.status || "").trim(),
        ok: Boolean(result?.ok)
      }
    );
    return result;
  });
  ipcMain.handle("license:renew", async (_, payload) => {
    const result = await services.licensingCore.renewLicense(payload);
    recordSupportEvent(
      result?.ok ? "info" : "warn",
      "licensing",
      "licensing.renew",
      result?.ok ? "Fluxo de renovação iniciado." : result?.message || "Falha ao iniciar renovação.",
      {
        email: String(payload?.email || "").trim().toLowerCase(),
        ok: Boolean(result?.ok)
      }
    );
    return result;
  });
  ipcMain.handle("app:get-bootstrap", withAuth(async (user) => ({
    ...services.settings.getBootstrap(user),
    runtime: {
      payrollRuleEditingLocked: app.isPackaged,
      installationIntegrity: startupIntegrityState
    }
  })));
  ipcMain.handle("auth:login", async (_, credentials) => {
    const licenseGuard = services.licensingCore.getGuardResult();
    if (!licenseGuard.ok) {
      return licenseGuard;
    }
    const identifier = String(credentials?.username || credentials?.email || "").trim().toLowerCase() || "unknown";
    const limiter = loginRateLimiter.consume(`auth:login:${identifier}`);
    if (!limiter.ok) {
      return { ok: false, message: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." };
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
    const identifier = String(payload?.identifier || "").trim();
    if (!identifier) {
      return { ok: false, message: "Indique o utilizador ou o e-mail para receber as instruções de redefinição." };
    }

    const normalizedKey = identifier.toLowerCase();
    const limiter = resetRequestRateLimiter.consume(`auth:request-password-reset:${normalizedKey}`);
    if (!limiter.ok) {
      return { ok: true, message: "Se o e-mail existir, enviaremos instruções de redefinição." };
    }

    const genericResponse = { ok: true, message: "Se o e-mail existir, enviaremos instruções de redefinição." };
    try {
      const prepared = services.auth.preparePasswordReset(identifier);
      if (!prepared?.ok) {
        return genericResponse;
      }

      const requestResult = services.auth.createPasswordResetRequest(prepared.reset);
      if (!requestResult?.ok) {
        return genericResponse;
      }

      const mailResult = await services.mailer.sendPasswordResetToken(prepared.reset);
      if (!mailResult?.ok) {
        services.auth.revokePasswordResetRequest(prepared.reset);
        return genericResponse;
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
    } catch (error) {
      log.warn("[AUTH][RESET] falha ao processar pedido de redefinicao", {
        message: String(error?.message || error),
        identifier: normalizedKey
      });
    }

    return genericResponse;
  });
  ipcMain.handle("auth:complete-password-reset", async (_, payload) => {
    const identifier = String(payload?.identifier || "").trim().toLowerCase() || "unknown";
    const limiter = resetCompleteRateLimiter.consume(`auth:complete-password-reset:${identifier}`);
    if (!limiter.ok) {
      return { ok: false, message: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
    }

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
      return { ok: false, message: "Não pode alterar a senha de outro utilizador." };
    }
    if (payload?.resetByAdmin && !hasPermission(user, "users.manage")) {
      return { ok: false, message: getPermissionDeniedMessage("users.manage") };
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
  ipcMain.handle("users:save", withPermission("users.manage", async (user, payload) => {
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
  ipcMain.handle("users:delete", withPermission("users.manage", async (user, userId) => {
    const before = services.database.getUserSnapshot(userId);
    const result = services.database.deleteUser(userId);
    if (result?.ok) {
      logAudit(user, "user.delete", "user", before?.full_name || `Utilizador ${userId}`, { before, after: null }, userId);
    }
    return result;
  }));
  ipcMain.handle("company:save", withPermission("company.manage", async (user, payload) => {
    const before = services.database.getCompanySnapshot();
    const result = services.database.saveCompanyProfile(payload);
    if (!result?.ok) {
      return result;
    }
    const after = services.database.getCompanySnapshot();
    logAudit(user, "company.update", "company", payload.name || "Empresa", { before, after, changes: buildDiff(before, after) });
    return result;
  }));
  ipcMain.handle("organization:list", withPermission("organization.view", async (user, payload) => ({
    ok: true,
    organization: services.database.getOrganizationBootstrap(),
    items: payload?.entityType ? services.database.listOrganizationEntities(payload.entityType, payload.filters || {}) : []
  })));
  ipcMain.handle("organization:save", withPermission("organization.manage", async (user, payload) => {
    const entityType = String(payload?.entityType || "").trim();
    const itemPayload = payload?.item || {};
    const before = itemPayload?.id ? services.database.getOrganizationSnapshot(entityType, itemPayload.id) : null;
    const result = services.database.saveOrganizationEntity(entityType, itemPayload);
    if (result?.ok) {
      const after = result.item || (itemPayload?.id ? services.database.getOrganizationSnapshot(entityType, itemPayload.id) : null);
      logAudit(
        user,
        itemPayload?.id ? "organization.update" : "organization.create",
        entityType || "organization",
        after?.name || itemPayload.name || "Organizacao",
        { before, after, changes: buildDiff(before, after) },
        after?.id ?? itemPayload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("organization:delete", withPermission("organization.manage", async (user, payload) => {
    const entityType = String(payload?.entityType || "").trim();
    const before = services.database.getOrganizationSnapshot(entityType, payload?.id);
    const result = services.database.deleteOrganizationEntity(entityType, payload?.id);
    if (result?.ok) {
      logAudit(
        user,
        "organization.delete",
        entityType || "organization",
        before?.name || `Organizacao ${payload?.id}`,
        { before, after: null },
        payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("organization:report", withPermission("organization.view", async (user, filters) => services.database.buildOrganizationReport(filters || {})));
  ipcMain.handle("organization:export-excel", withPermission("exports.generate", async (user, filters) => services.database.exportOrganizationExcel(filters || {})));
  ipcMain.handle("enterprise:list", withPermission("enterprise.view", async (user, payload) => ({
    ok: true,
    modules: services.database.getEnterpriseModulesBootstrap(),
    items: payload?.type ? services.database.listEnterpriseRecords(payload.type, payload.filters || {}) : []
  })));
  ipcMain.handle("enterprise:summary-export", withPermission("exports.generate", async (user, payload) => {
    const result = services.database.exportEnterpriseSummaryExcel(payload || {});
    if (result?.ok) {
      logAudit(user, "enterprise.summary.export", "enterprise_summary", "Resumo executivo Suite RH", { path: result.path });
    }
    return result;
  }));
  ipcMain.handle("enterprise:save", withPermission("enterprise.manage", async (user, payload) => {
    const type = String(payload?.type || "").trim();
    const item = payload?.item || {};
    const before = item?.id ? services.database.listEnterpriseRecords(type, { id: item.id })[0] || null : null;
    const result = services.database.saveEnterpriseRecord(type, item, user.id);
    if (result?.ok) {
      const after = result.item || null;
      logAudit(
        user,
        item?.id ? "enterprise.update" : "enterprise.create",
        type || "enterprise",
        after?.row_label || after?.name || after?.title || item.name || item.title || "Registo empresarial",
        { before, after, changes: buildDiff(before, after) },
        after?.id ?? item?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("enterprise:delete", withPermission("enterprise.manage", async (user, payload) => {
    const type = String(payload?.type || "").trim();
    const before = services.database.listEnterpriseRecords(type, { id: payload?.id })[0] || null;
    const result = services.database.deleteEnterpriseRecord(type, payload?.id);
    if (result?.ok) {
      logAudit(user, "enterprise.delete", type || "enterprise", before?.row_label || `Registo ${payload?.id}`, { before, after: null }, payload?.id ?? null);
    }
    return result;
  }));
  ipcMain.handle("enterprise:generate-contract", withPermission("documents.manage", async (user, payload) => {
    const result = services.database.generateContractDocument(payload?.contractId, payload?.templateId, user.id);
    if (result?.ok) {
      logAudit(user, "contract.generate_document", "contract", `Contrato ${payload?.contractId}`, { path: result.path }, payload?.contractId ?? null);
    }
    return result;
  }));
  ipcMain.handle("enterprise:contract-action", withPermission("enterprise.manage", async (user, payload) => {
    const before = services.database.listEnterpriseRecords("contracts", { id: payload?.id })[0] || null;
    const result = services.database.transitionContract(payload?.id, payload?.action, payload || {}, user.id);
    if (result?.ok) {
      logAudit(
        user,
        `contract.${String(payload?.action || "").trim() || "transition"}`,
        "contract",
        result.item?.row_label || before?.row_label || `Contrato ${payload?.id}`,
        { before, after: result.item || null, changes: buildDiff(before, result.item || null) },
        payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("enterprise:approval-transition", withPermission("enterprise.manage", async (user, payload) => {
    const before = services.database.listEnterpriseRecords("approvalRequests", { id: payload?.id })[0] || null;
    const result = services.database.transitionApprovalRequest(payload?.id, payload?.action, user.id, payload?.notes || "");
    if (result?.ok) {
      const after = result.item || null;
      logAudit(
        user,
        `approval.${String(payload?.action || "").trim() || "transition"}`,
        "approval_request",
        after?.row_label || `Pedido ${payload?.id}`,
        { before, after, notes: payload?.notes || "", changes: buildDiff(before, after) },
        payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("enterprise:convert-candidate", withPermission("employees.manage", async (user, payload) => {
    const before = services.database.listEnterpriseRecords("recruitmentCandidates", { id: payload?.candidateId })[0] || null;
    const result = services.database.convertCandidateToEmployee(payload?.candidateId, payload?.employee || {}, user.id);
    if (result?.ok) {
      logAudit(
        user,
        "recruitment.convert_to_employee",
        "recruitment_candidate",
        before?.full_name || `Candidato ${payload?.candidateId}`,
        { before, employee: result.employee, contract: result.contract },
        payload?.candidateId ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("enterprise:sync-mark", withPermission("enterprise.manage", async (user, payload) => services.database.markSyncEvent(payload?.id, payload?.status, payload?.errorMessage)));
  ipcMain.handle("enterprise:sync-retry-failed", withPermission("enterprise.manage", async (user) => {
    const result = services.database.retryFailedSyncEvents();
    if (result?.ok) {
      logAudit(user, "sync.retry_failed", "sync_outbox", "Reprocessamento da fila de sincronizacao", { retried: result.retried });
    }
    return result;
  }));
  ipcMain.handle("enterprise:sync-export", withPermission("exports.generate", async (user, payload) => {
    const result = services.database.exportSyncOutboxPackage(payload || {});
    if (result?.ok) {
      logAudit(user, "sync.export_package", "sync_outbox", result.packageId, { path: result.path, count: result.count, checksum: result.checksum });
    }
    return result;
  }));
  ipcMain.handle("enterprise:payroll-version", withPermission("payroll.period.manage", async (user, payload) => {
    const result = services.database.createPayrollRunVersion(payload?.monthRef, user.id, payload?.reason || "");
    if (result?.ok) {
      logAudit(user, "payroll.version.create", "payroll_period", payload?.monthRef, { reason: payload?.reason || "", versionNumber: result.versionNumber }, null, payload?.monthRef);
    }
    return result;
  }));
  ipcMain.handle("enterprise:payroll-version-compare", withPermission("exports.generate", async (user, payload) => {
    const result = services.database.exportPayrollVersionComparisonExcel(payload || {});
    if (result?.ok) {
      logAudit(
        user,
        "payroll.version.compare",
        "payroll_period",
        payload?.monthRef,
        { path: result.path, totals: result.comparison?.totals },
        null,
        payload?.monthRef || null
      );
    }
    return result;
  }));
  ipcMain.handle("enterprise:fiscal-map", withPermission("exports.generate", async (user, payload) => {
    const result = services.database.buildFinalFiscalMap(payload?.monthRef, payload?.mapType || "agt", user.id);
    if (result?.ok) {
      logAudit(user, "fiscal_map.build", "fiscal_map", `${payload?.mapType || "agt"} ${payload?.monthRef}`, { map: result.map }, result.map?.id ?? null, payload?.monthRef);
    }
    return result;
  }));
  ipcMain.handle("enterprise:fiscal-map-status", withPermission("exports.generate", async (user, payload) => {
    const result = services.database.updateFiscalMonthlyMapStatus(payload?.id, payload || {}, user.id);
    if (result?.ok) {
      logAudit(
        user,
        "fiscal_map.status",
        "fiscal_map",
        `${result.map?.map_type || "mapa"} ${result.map?.month_ref || ""}`.trim(),
        { status: payload?.status, proof_reference: payload?.proof_reference || "", proof_path: payload?.proof_path || "" },
        payload?.id ?? null,
        result.map?.month_ref || null
      );
    }
    return result;
  }));
  ipcMain.handle("employees:import-file", withPermission("employees.manage", async (user, payload) => {
    const result = services.database.importEmployeesFile(payload?.filePath, user.id);
    if (result?.ok) {
      logAudit(user, "employees.import", "employee", "Importação de funcionários", { imported: result.imported, failed: result.failed });
    }
    return result;
  }));
  ipcMain.handle("employees:export-excel", withPermission("exports.generate", async (user, filters) => services.database.exportEmployeesExcel(filters || {})));
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

    const licenseStatus = services.licensingCore.getStatus(true);
    const maxEmployees = Number(licenseStatus?.maxEmployees || 0);
    if (maxEmployees > 0) {
      const currentEmployees = services.database.listEmployees();
      const activeCount = currentEmployees.filter((employee) => employee.status === "ativo").length;
      const wasActive = before?.status === "ativo";
      const willBeActive = String(payload?.status || before?.status || "ativo").trim().toLowerCase() === "ativo";
      const needsNewActiveSlot = (!payload?.id && willBeActive) || (payload?.id && !wasActive && willBeActive);
      if (needsNewActiveSlot) {
        const limitCheck = enforceEmployeeLimit({ existingActiveEmployees: activeCount, maxEmployees });
        if (!limitCheck.ok) {
          return {
            ok: false,
            message: `O plano ativo permite no máximo ${maxEmployees} funcionário(s) ativos. Desative um funcionário ou mude de plano para adicionar mais.`
          };
        }
      }
    }

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
      logAudit(user, "employee.delete", "employee", before?.full_name || `Funcionário ${employeeId}`, { before, after: null }, employeeId);
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
      return { ok: false, message: "O documento laboral selecionado já não existe." };
    }
    const storedPath = path.resolve(String(document.stored_file_path || "").trim());
    if (!storedPath || !fs.existsSync(storedPath)) {
      return { ok: false, message: "O ficheiro do documento não foi encontrado na pasta oficial." };
    }

    const allowedExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".txt"]);
    const extension = path.extname(storedPath).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return { ok: false, message: "Extensão de ficheiro não permitida para abertura direta." };
    }

    if (!services.database.isManagedEmployeeDocumentPath(storedPath)) {
      return { ok: false, message: "Caminho do documento inválido (fora da pasta oficial)." };
    }

    try {
      const stat = fs.lstatSync(storedPath);
      if (!stat.isFile()) {
        return { ok: false, message: "O caminho do documento não corresponde a um ficheiro válido." };
      }
      if (stat.isSymbolicLink()) {
        return { ok: false, message: "Não é permitido abrir documentos apontados por atalhos/symlinks." };
      }

      const rootDir = fs.realpathSync(services.database.employeeDocumentsDir);
      const realTarget = fs.realpathSync(storedPath);
      if (!(realTarget === rootDir || realTarget.startsWith(`${rootDir}${path.sep}`))) {
        return { ok: false, message: "O documento resolve para fora da pasta oficial (bloqueado por segurança)." };
      }
    } catch (error) {
      return { ok: false, message: `Não foi possível validar o documento: ${error.message || error}` };
    }

    const openResult = await shell.openPath(storedPath);
    if (openResult) {
      return { ok: false, message: `Não foi possível abrir o documento: ${openResult}` };
    }

    return { ok: true, path: storedPath };
  }));
  ipcMain.handle("hr:list", withPermission("hr.view", async (user, filters) => ({ ok: true, items: services.database.listHrSuiteItems(filters || {}) })));
  ipcMain.handle("hr:save", withPermission("hr.manage", async (user, payload) => {
    const before = payload?.id ? services.database.getHrSuiteSnapshot(payload.id) : null;
    const result = services.database.saveHrSuiteItem(payload, user.id);
    if (result?.ok) {
      const after = result.item || (payload?.id ? services.database.getHrSuiteSnapshot(payload.id) : null);
      logAudit(
        user,
        payload?.id ? "hr.update" : "hr.create",
        "hr_suite_item",
        after?.title || payload?.title || "RH 360",
        { before, after, changes: buildDiff(before, after) },
        after?.id ?? payload?.id ?? null
      );
    }
    return result;
  }));
  ipcMain.handle("hr:delete", withPermission("hr.manage", async (user, itemId) => {
    const before = services.database.getHrSuiteSnapshot(itemId);
    const result = services.database.deleteHrSuiteItem(itemId);
    if (result?.ok) {
      logAudit(user, "hr.delete", "hr_suite_item", before?.title || `RH 360 ${itemId}`, { before, after: null }, itemId);
    }
    return result;
  }));
  ipcMain.handle("hr:open-attachment", withPermission("hr.view", async (user, itemId) => {
    const item = services.database.getHrSuiteSnapshot(itemId);
    if (!item) {
      return { ok: false, message: "O registo RH selecionado já não existe." };
    }
    const storedPath = path.resolve(String(item.attachment_path || "").trim());
    if (!storedPath || !fs.existsSync(storedPath)) {
      return { ok: false, message: "O anexo RH não foi encontrado na pasta oficial." };
    }

    const allowedExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".txt"]);
    const extension = path.extname(storedPath).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return { ok: false, message: "Extensão de ficheiro não permitida para abertura direta." };
    }
    if (!services.database.isManagedHrSuiteAttachmentPath(storedPath)) {
      return { ok: false, message: "Caminho do anexo RH inválido (fora da pasta oficial)." };
    }

    try {
      const stat = fs.lstatSync(storedPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { ok: false, message: "O caminho do anexo RH não corresponde a um ficheiro válido." };
      }
      const rootDir = fs.realpathSync(services.database.hrSuiteDocumentsDir);
      const realTarget = fs.realpathSync(storedPath);
      if (!(realTarget === rootDir || realTarget.startsWith(`${rootDir}${path.sep}`))) {
        return { ok: false, message: "O anexo RH resolve para fora da pasta oficial (bloqueado por segurança)." };
      }
    } catch (error) {
      return { ok: false, message: `Não foi possível validar o anexo RH: ${error.message || error}` };
    }

    const openResult = await shell.openPath(storedPath);
    if (openResult) {
      return { ok: false, message: `Não foi possível abrir o anexo RH: ${openResult}` };
    }
    return { ok: true, path: storedPath };
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
    ipcMain.handle("attendance:approve-adjustments", withPermission("attendance.manage", async (user, payload) => {
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
    ipcMain.handle("attendance:close-period", withPermission("attendance.manage", async (user, monthRef) => {
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
    ipcMain.handle("attendance:reopen-period", withPermission("attendance.manage", async (user, monthRef) => {
      const result = services.database.reopenAttendancePeriod(monthRef, user.id);
      if (result?.ok) {
        logAudit(user, "attendance.reopen_period", "attendance_period", monthRef, { monthRef }, null, monthRef);
      }
      return result;
    }));
    ipcMain.handle("shifts:list", withPermission("shifts.view", async () => ({ ok: true, items: services.database.listWorkShifts() })));
  ipcMain.handle("shifts:save", withPermission("shifts.manage", async (user, payload) => {
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
  ipcMain.handle("shifts:delete", withPermission("shifts.manage", async (user, shiftId) => {
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
  ipcMain.handle("leave:set-status", withPermission("leave.manage", async (user, payload) => {
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
  ipcMain.handle("vacation:set-status", withPermission("vacation.manage", async (user, payload) => {
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
  ipcMain.handle("salary-scales:save", withPermission("salary_scales.manage", async (user, payload) => {
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
  ipcMain.handle("salary-scales:delete", withPermission("salary_scales.manage", async (user, scaleId) => {
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
    const result = services.payroll.processMonth(month, { userId: user.id });
    if (result?.ok) {
      logAudit(user, "payroll.process", "payroll_period", month, { itemCount: result.items?.length || 0 }, null, month);
    }
    return result;
  }));
  ipcMain.handle("payroll:preview-reprocess", withPermission("payroll.process", async (user, monthRef) => {
    return services.payroll.previewReprocessMonth(monthRef);
  }));
  ipcMain.handle("payroll:reprocess", withPermission("payroll.period.manage", async (user, payload) => {
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
      authorizationReason: request.authorizationReason,
      userId: user.id
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
  ipcMain.handle("payroll:delete-run", withPermission("payroll.period.manage", async (user, payrollRunId) => {
    const result = services.database.deletePayrollRun(payrollRunId);
    if (result?.ok) {
      logAudit(user, "payroll.delete_run", "payroll_run", `Pagamento ${payrollRunId}`, { payrollRunId }, payrollRunId);
    }
    return result;
  }));
  ipcMain.handle("payroll:delete-month", withPermission("payroll.period.manage", async (user, monthRef) => {
    const result = services.database.deletePayrollRunsByMonth(monthRef);
    if (result?.ok) {
      logAudit(user, "payroll.delete_month", "payroll_period", monthRef, { monthRef }, null, monthRef);
    }
    return result;
  }));
  ipcMain.handle("payroll:close-period", withPermission("payroll.period.manage", async (user, monthRef) => {
    const result = services.database.closePayrollPeriod(monthRef, user.id);
    if (result?.ok) {
      logAudit(user, "payroll.close_period", "payroll_period", monthRef, { monthRef }, null, monthRef);
    }
    return result;
  }));
  ipcMain.handle("payroll:reopen-period", withPermission("payroll.period.manage", async (user, monthRef) => {
    const result = services.database.reopenPayrollPeriod(monthRef, user.id);
    if (result?.ok) {
      logAudit(user, "payroll.reopen_period", "payroll_period", monthRef, { monthRef }, null, monthRef);
    }
    return result;
  }));
  ipcMain.handle("agt:save-submission", withPermission("exports.generate", async (user, payload) => {
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
  ipcMain.handle("audit:list", withPermission("audit.view", async (user, filters) => ({ ok: true, items: services.database.listAuditLogs(filters || {}) })));
  ipcMain.handle("audit:export", withPermission("audit.view", async (user, filters) => services.database.exportAuditCsv(filters || {})));
  ipcMain.handle("audit:export-excel", withPermission("audit.view", async (user, filters) => services.database.exportAuditExcel(filters || {})));
  ipcMain.handle(
    "audit:export-payroll-calculation",
    withPermission("audit.view", async (user, filters) => services.database.exportPayrollCalculationAudit(filters || {}))
  );
  ipcMain.handle("excel:export-monthly-payroll", withPermission("exports.generate", async (user, payload) => services.database.exportMonthlyPayrollExcel(payload)));
  ipcMain.handle(
    "excel:export-agt-monthly-remuneration",
    withPermission("exports.generate", async (user, payload) => services.database.exportAgtMonthlyRemunerationExcel(payload))
  );
  ipcMain.handle("excel:export-state-payments", withPermission("exports.generate", async (user, payload) => services.database.exportStatePaymentsExcel(payload)));
  ipcMain.handle("excel:export-attendance", withPermission("exports.generate", async (user, payload) => services.database.exportAttendanceExcel(payload, payload?.reportType)));
  ipcMain.handle("excel:export-shift-map", withPermission("exports.generate", async (user, payload) => services.database.exportShiftMapExcel(payload, payload?.reportType)));
  ipcMain.handle("excel:export-hr-suite", withPermission("exports.generate", async (user, payload) => services.database.exportHrSuiteExcel(payload || {})));
  ipcMain.handle("support:health", withAdmin(async () => {
    return supportDiagnostics?.buildHealthSnapshot({
      startupIntegrity: startupIntegrityState
    }) || { ok: false, message: "Serviço de diagnóstico indisponivel." };
  }));
  ipcMain.handle("support:export-logs", withAdmin(async (user, payload) => {
    if (!supportDiagnostics) {
      return { ok: false, message: "Serviço de diagnóstico indisponivel." };
    }
    return supportDiagnostics.exportSupportBundle({
      requestedByUserId: user?.id || null,
      requestedBy: user?.username || user?.full_name || "admin",
      reason: String(payload?.reason || "support_request").trim(),
      startupIntegrity: startupIntegrityState
    });
  }));
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
  ipcMain.handle("backup:create", withPermission("backup.manage", async (user) => {
    const result = services.database.createBackup();
    if (result?.ok) {
      logAudit(user, "backup.create", "backup", "Base de dados", { path: result.path });
    }
    return result;
  }));
  ipcMain.handle("backup:list", withPermission("backup.manage", async () => ({ ok: true, items: services.database.listBackups() })));
  ipcMain.handle("backup:restore", withPermission("backup.manage", async (user, backupPath) => {
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
      message: "Backup restaurado com sucesso. A aplicação será reiniciada para carregar os dados repostos."
    };
  }));
  ipcMain.handle("app:update-check", withAuth(async () => services.updater.checkForUpdates()));
  ipcMain.handle("app:update-download", withPermission("app.update.manage", async () => services.updater.downloadUpdate()));
  ipcMain.handle("app:update-install", withPermission("app.update.manage", async () => services.updater.installDownloadedUpdate()));
  ipcMain.handle("docs:download-client-manual", withAuth(async () => downloadClientManual()));
  ipcMain.handle("dialog:select-logo", withPermission("company.manage", async () => {
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
  ipcMain.handle("dialog:select-employee-import-file", withPermission("employees.manage", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Lista de funcionários", extensions: ["csv", "txt", "tsv", "xls", "html", "htm"] },
        { name: "Todos os ficheiros", extensions: ["*"] }
      ]
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
  ipcMain.handle("dialog:select-hr-attachment", withPermission("hr.manage", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Anexos RH", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "txt"] },
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
  const userDataPath = app.getPath("userData");
  const isSmokeE2E = process.env.KWANZA_SMOKE_E2E === "1";
  const documentsPath = isSmokeE2E ? userDataPath : app.getPath("documents");
  const programDataPath = path.join(process.env.ProgramData || "C:\\ProgramData", "Kwanza Folha");
  const cachePath = app.getPath("cache");
  log.info("[BOOT] resolved paths", { userDataPath, documentsPath, programDataPath, isSmokeE2E });
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.mkdirSync(programDataPath, { recursive: true });
  migrateLegacyDataIfNeeded(userDataPath, programDataPath);
  ensureDir(app.getPath("sessionData"));
  ensureDir(cachePath);
  ensureDir(app.getPath("logs"));

  if (fs.existsSync(cachePath)) {
    try {
      fs.rmSync(cachePath, { recursive: true, force: true });
      ensureDir(cachePath);
    } catch {}
  }

  supportDiagnostics = new SupportDiagnosticsService({
    userDataPath,
    logsPath: app.getPath("logs"),
    appName: app.getName(),
    appVersion: app.getVersion()
  });
  recordSupportEvent("info", "boot", "boot.start", "Sequencia de arranque iniciada.", {
    userDataPath,
    documentsPath,
    programDataPath
  });

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
  log.info("[BOOT] loading independent licensing core");
  bootLicensingCore = createLicensingCore(new LicensingService({
    app,
    userDataPath,
    currentVersion: app.getVersion(),
    productName: app.getName(),
    database: null,
    secureStorage,
    installationIdentity
  }));
  log.info("[BOOT] independent licensing core ready");
  recordSupportEvent("info", "licensing", "licensing.boot-core.ready", "Core independente de licenciamento pronto para ativação critica de boot.", {
    hasSecureStorage: Boolean(secureStorage),
    hasInstallationIdentity: Boolean(installationIdentity)
  });
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
      setStartupIntegrityIssue("installation-identity", "Não foi possível validar as âncoras de segurança da instalação.");
    }
  } catch (error) {
    setStartupIntegrityIssue(
      "installation-identity",
      error.message || "Não foi possível validar a identidade da instalação.",
      { error: String(error?.stack || error?.message || error) }
    );
    log.error("Falha ao validar a identidade da instalação", error);
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
      allowedThumbprints: expectedSignerThumbprints,
      requireSignedExecutable:
        process.env.KWANZA_REQUIRE_SIGNED_EXECUTABLE === "1" ||
        licenseSource.requireSignedExecutable === true
    }
  );
  log.info("[BOOT] executable signature result", executableSignature);
  if (!app.isPackaged && executableSignature.warning && isLocalDevelopmentRuntime()) {
    log.warn("[BOOT][FALLBACK] assinatura validada em modo dev local com excecao controlada", executableSignature);
  } else if (app.isPackaged && executableSignature.warning) {
    log.warn("[BOOT][WARN] assinatura validada com aviso em modo empacotado", executableSignature);
  } else if (app.isPackaged && !executableSignature.ok) {
    if (isLocalPackagedBuildRuntime()) {
      log.warn("[BOOT][LOCAL-PACKAGED] assinatura inválida no binario local de QA; validação estrita mantida apenas para instalacoes comerciais.");
    } else {
    setStartupIntegrityIssue(
      "executable-signature",
      executableSignature.message || "A assinatura do executável não pode ser validada.",
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
      tamperCheck.message || "Foram detetadas alterações nos módulos críticos da aplicação.",
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
    markServicesFailed(new Error(startupIntegrityState.message || "Arranque bloqueado por integridade."));
    recordSupportEvent(
      "error",
      "boot",
      "boot.blocked",
      startupIntegrityState.message || "Arranque bloqueado por integridade.",
      startupIntegrityState
    );
  } else {
    const initializeServices = () => {
      log.info("[BOOT] initializing application services");
      services = createAppServices({ userDataPath, documentsPath, programDataPath, secureStorage, installationIdentity });
      markServicesReady(services);
      log.info("[BOOT] application services ready");
      log.info("[BOOT] registering ipc");
      registerIpc();
      log.info("[BOOT] ipc registered");
      try {
        log.info("[BOOT] initializing database backup");
        services.database.performAutomaticBackup();
        log.info("[BOOT] database backup initialization finished");
      } catch (backupError) {
        log.error("[BOOT][WARN] falha no backup automatico, app segue operacional", backupError);
      }
    };

    try {
      initializeServices();
    } catch (error) {
      if (isDatabaseStartupError(error)) {
        log.warn("[BOOT][RECOVERY] database startup error detected, retrying with runtime DB quarantine", {
          message: String(error?.message || error)
        });
        try {
          const quarantinedPath = quarantineRuntimeDatabaseForStartupRetry(userDataPath);
          log.warn("[BOOT][RECOVERY] runtime DB quarantined for retry", { quarantinedPath });
          initializeServices();
          log.info("[BOOT][RECOVERY] services initialized after runtime DB retry");
        } catch (retryError) {
          if (isDatabaseStartupError(retryError)) {
            log.warn("[BOOT][RECOVERY] runtime retry failed, performing full DB artifact quarantine", {
              message: String(retryError?.message || retryError)
            });
            try {
              const recoverySnapshot = quarantineDatabaseArtifactsForStartupRetry(userDataPath, programDataPath);
              log.warn("[BOOT][RECOVERY] full DB quarantine executed", recoverySnapshot);
              initializeServices();
              log.info("[BOOT][RECOVERY] services initialized after full DB quarantine");
            } catch (finalRetryError) {
              setStartupIntegrityIssue(
                "services-init",
                resolveStartupFailureMessage(finalRetryError),
                { error: String(finalRetryError?.stack || finalRetryError?.message || finalRetryError) }
              );
              markServicesFailed(finalRetryError);
              log.error("Falha ao inicializar os serviços da aplicação após recuperação completa de DB", finalRetryError);
            }
          } else {
            setStartupIntegrityIssue(
              "services-init",
              resolveStartupFailureMessage(retryError),
              { error: String(retryError?.stack || retryError?.message || retryError) }
            );
            markServicesFailed(retryError);
            log.error("Falha ao inicializar os serviços da aplicação após tentativa de recuperação", retryError);
          }
        }
      } else {
        setStartupIntegrityIssue(
          "services-init",
          resolveStartupFailureMessage(error),
          { error: String(error?.stack || error?.message || error) }
        );
        markServicesFailed(error);
        log.error("Falha ao inicializar os serviços da aplicação", error);
      }
    }
  }
  if (!isPackagedSmokeE2EMode()) {
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
  } else {
    log.info("[BOOT][SMOKE-E2E] window creation skipped");
  }
  log.info("[BOOT] startup sequence finished");
  recordSupportEvent("info", "boot", "boot.finished", "Sequencia de arranque concluida.", {
    degradedMode: !services,
    integrityOk: Boolean(startupIntegrityState?.ok)
  });
  if (isPackagedSmokeE2EMode()) {
    log.info("[BOOT] packaged smoke e2e mode enabled");
    void runPackagedSmokeE2EScenario()
      .then((result) => {
        const exitCode = result?.ok ? 0 : 1;
        // Smoke E2E não deve depender do shutdown normal (before-quit + cifragem/DB),
        // porque isso pode bloquear e forçar o harness a matar o processo (exitCode -1 + popup 0x80000003).
        log.info("[BOOT][SMOKE-E2E] forcing process exit", { exitCode });
        try {
          log.info("[BOOT][SMOKE-E2E] calling app.exit", { exitCode });
          try {
            app.exit(exitCode);
          } catch {}

          const hasReallyExit = typeof process.reallyExit === "function";
          log.info("[BOOT][SMOKE-E2E] calling process.reallyExit", { exitCode, hasReallyExit });
          if (hasReallyExit) {
            process.reallyExit(exitCode);
          }
          process.exit(exitCode);
          log.error("[BOOT][SMOKE-E2E] exit returned unexpectedly", { exitCode });
        } catch (exitError) {
          log.error("[BOOT][SMOKE-E2E] process.exit threw", {
            exitCode,
            error: String(exitError?.stack || exitError?.message || exitError)
          });
        }
      })
      .catch((error) => {
        log.error("[BOOT][SMOKE-E2E] erro inesperado", error);
        try {
          log.info("[BOOT][SMOKE-E2E] calling app.exit after error", { exitCode: 1 });
          try {
            app.exit(1);
          } catch {}
          const hasReallyExit = typeof process.reallyExit === "function";
          log.info("[BOOT][SMOKE-E2E] calling process.reallyExit after error", { exitCode: 1, hasReallyExit });
          if (hasReallyExit) {
            process.reallyExit(1);
          }
          process.exit(1);
          log.error("[BOOT][SMOKE-E2E] exit returned unexpectedly after error");
        } catch (exitError) {
          log.error("[BOOT][SMOKE-E2E] process.exit threw after error", {
            error: String(exitError?.stack || exitError?.message || exitError)
          });
        }
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
  if (isPackagedSmokeE2EMode()) {
    return;
  }
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

app.on("render-process-gone", (_event, webContents, details) => {
  const message = `Processo renderer terminou com razão '${details?.reason || "desconhecida"}'.`;
  log.error(message, details);
  recordSupportEvent("error", "crash", "crash.render-process-gone", message, details || {});
  try {
    supportDiagnostics?.recordCrash("render-process", new Error(message), {
      details: details || {},
      webContentsId: webContents?.id || null
    });
  } catch {}
});

app.on("child-process-gone", (_event, details) => {
  const message = `Processo filho terminou com razão '${details?.reason || "desconhecida"}'.`;
  log.error(message, details);
  recordSupportEvent("error", "crash", "crash.child-process-gone", message, details || {});
  try {
    supportDiagnostics?.recordCrash("child-process", new Error(message), {
      details: details || {}
    });
  } catch {}
});

process.on("uncaughtException", (error) => {
  log.error("Erro inesperado", error);
  recordSupportEvent("error", "crash", "crash.uncaught-exception", String(error?.message || error), {
    stack: String(error?.stack || "")
  });
  try {
    supportDiagnostics?.recordCrash("uncaught-exception", error);
  } catch {}
});

process.on("unhandledRejection", (error) => {
  log.error("Promessa rejeitada sem tratamento", error);
  recordSupportEvent("error", "crash", "crash.unhandled-rejection", String(error?.message || error), {
    stack: String(error?.stack || "")
  });
  try {
    supportDiagnostics?.recordCrash("unhandled-rejection", error);
  } catch {}
});
