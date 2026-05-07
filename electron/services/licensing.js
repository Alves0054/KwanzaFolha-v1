const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const licenseSource = require("../config/license-source");
const { LICENSE_PLANS, DEFAULT_LICENSE_PLAN } = require("../../shared/license-plans");

let defaultLogger = console;
try {
  // electron-log is available in the packaged app and gives support a persistent trace.
  // Tests keep working with the console fallback.
  // eslint-disable-next-line global-require
  defaultLogger = require("electron-log");
} catch {}

const TRIAL_DAYS = 15;
const DEVELOPMENT_LICENSE_DAYS = 365;
const LICENSE_API_URL_SECRET = "licensing-api-url";
const HARDWARE_CHANGE_WEIGHTS = {
  motherboardSerial: 30,
  cpuId: 20,
  diskSerials: 20,
  macAddresses: 15,
  biosSerial: 10,
  machineGuid: 5
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64UrlDecode(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDateIso(value) {
  return String(value || "").slice(0, 10);
}

function addDaysToIso(value, days) {
  const baseDate = new Date(value);
  if (Number.isNaN(baseDate.getTime())) {
    return "";
  }
  return new Date(baseDate.getTime() + Number(days || 0) * 86400000).toISOString();
}

function daysBetween(todayIso, futureIso) {
  const start = new Date(`${todayIso}T00:00:00Z`);
  const end = new Date(`${futureIso}T00:00:00Z`);
  return Math.ceil((end - start) / 86400000);
}

function daysRemainingFromNow(futureIso) {
  const futureTime = new Date(futureIso).getTime();
  if (Number.isNaN(futureTime)) {
    return 0;
  }
  const difference = futureTime - Date.now();
  return difference <= 0 ? 0 : Math.ceil(difference / 86400000);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeHardwareSignal(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim().toUpperCase())
      .filter(Boolean)
      .sort()
      .join("|");
  }
  return String(value || "").trim().toUpperCase();
}

function calculateHardwareChangeScore(expected = {}, current = {}) {
  let score = 0;
  for (const [field, weight] of Object.entries(HARDWARE_CHANGE_WEIGHTS)) {
    if (normalizeHardwareSignal(expected[field]) !== normalizeHardwareSignal(current[field])) {
      score += weight;
    }
  }
  return score;
}

class LicensingService {
  constructor({
    app,
    userDataPath,
    currentVersion,
    productName,
    database,
    secureStorage = null,
    installationIdentity = null,
    logger = null
  }) {
    this.app = app;
    this.userDataPath = userDataPath;
    this.currentVersion = currentVersion;
    this.productName = productName || "Kwanza Folha";
    this.database = database || null;
    this.secureStorage = secureStorage;
    this.installationIdentity = installationIdentity;
    this.logger = logger || defaultLogger;
    this.config = licenseSource;
    this.licensePath = path.join(userDataPath, this.config.localLicenseFile || "license.json");
    this.legacyLicensePath = path.join(userDataPath, "license.dat");
    this.developerLicenseMarkerPath = path.join(userDataPath, "developer-license.json");
    this.publicKeyPath = path.join(__dirname, "..", "config", "license-public.pem");
    this.localLicenseSecretName = "license-cache";
    this.localTrialSecretName = "trial-cache";
    this.cachedStatus = null;
    this.lastCheckAt = 0;
  }

  log(level, message, details = {}) {
    const writer = this.logger?.[level] || this.logger?.info || console.log;
    try {
      writer.call(this.logger, message, details);
    } catch {}
  }

  getStoredApiBaseUrl() {
    if (!this.secureStorage?.loadSecret) {
      return "";
    }
    try {
      return String(this.secureStorage.loadSecret(LICENSE_API_URL_SECRET) || "").trim();
    } catch {
      return "";
    }
  }

  getSettingsApiBaseUrl() {
    try {
      const settings = this.database?.getSystemSettings ? this.database.getSystemSettings() : null;
      return String(settings?.licenseApiBaseUrl || "").trim();
    } catch {
      return "";
    }
  }

  getApiBaseUrlState() {
    const stored = this.getStoredApiBaseUrl();
    const settings = this.getSettingsApiBaseUrl();
    const env = String(process.env.KWANZA_LICENSE_API_URL || "").trim();
    const fallback = String(this.config.apiBaseUrl || "").trim();
    const candidate = (env || stored || settings || fallback || "").replace(/\/+$/, "");

    try {
      const resolved = this.getApiBaseUrl();
      return { ok: true, candidate, resolved, source: env ? "env" : stored ? "secure" : settings ? "settings" : "default" };
    } catch (error) {
      return {
        ok: false,
        candidate,
        resolved: "",
        source: env ? "env" : stored ? "secure" : settings ? "settings" : "default",
        message: String(error?.message || error)
      };
    }
  }

  setApiBaseUrl(rawValue) {
    const value = String(rawValue || "").trim().replace(/\/+$/, "");
    if (!this.secureStorage?.storeSecret || !this.secureStorage?.removeSecret) {
      return { ok: false, message: "Secure storage indisponivel para guardar a configuração do servidor de licenças." };
    }

    if (!value) {
      try {
        this.secureStorage.removeSecret(LICENSE_API_URL_SECRET);
      } catch {}
      this.cachedStatus = null;
      return { ok: true, apiBaseUrl: "", cleared: true };
    }

    if (this.app?.isPackaged) {
      if (!value.startsWith("https://")) {
        return { ok: false, message: "A aplicação empacotada só permite servidores de licenciamento com HTTPS." };
      }
      if (/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value)) {
        return { ok: false, message: "Não é permitido configurar localhost como servidor de licenças em produção." };
      }
    }

    try {
      // valida URL sintaticamente
      // eslint-disable-next-line no-new
      new URL(value);
    } catch {
      return { ok: false, message: "URL do servidor de licenças inválida. Exemplo: https://license.suaempresa.ao" };
    }

    this.secureStorage.storeSecret(LICENSE_API_URL_SECRET, value, { mirror: true, entropy: LICENSE_API_URL_SECRET });
    this.cachedStatus = null;
    return { ok: true, apiBaseUrl: value };
  }

  getPlans() {
    return LICENSE_PLANS.map((plan) => ({ ...plan }));
  }

  readDeveloperLicenseMarker() {
    if (!fs.existsSync(this.developerLicenseMarkerPath)) {
      return null;
    }
    return safeJsonParse(fs.readFileSync(this.developerLicenseMarkerPath, "utf8"), null);
  }

  isLocalDevelopmentRuntime() {
    if (this.app?.isPackaged) {
      return false;
    }

    return (
      process.env.NODE_ENV !== "production" ||
      Boolean(process.env.VITE_DEV_SERVER_URL) ||
      Boolean(process.defaultApp)
    );
  }

  isDevelopmentLicenseMode() {
    const marker = this.readDeveloperLicenseMarker();
    const isLocalRuntime = this.isLocalDevelopmentRuntime();
    if (!isLocalRuntime) {
      return false;
    }

    return (
      process.env.KWANZA_DEV_LICENSE_MODE === "1" ||
      Boolean(marker?.enabled)
    );
  }

  buildDevelopmentLicenseStatus() {
    const installation = this.getInstallationFingerprint();
    const marker = this.readDeveloperLicenseMarker();
    const startedAt = String(marker?.startedAt || installation.createdAt || nowIso()).trim();
    const expireDate = String(marker?.expireDate || addDaysToIso(startedAt, DEVELOPMENT_LICENSE_DAYS)).trim();
    return {
      ok: true,
      status: "developer_active",
      canUseApp: true,
      requiresLicense: false,
      plan: "developer",
      maxUsers: 0,
      maxEmployees: 0,
      maxDevices: 0,
      trialDaysTotal: DEVELOPMENT_LICENSE_DAYS,
      trialDaysRemaining: daysRemainingFromNow(expireDate),
      trialStartedAt: startedAt,
      trialExpireAt: expireDate,
      expireDate,
      companyName: this.database?.getCompanyProfile?.()?.name || "",
      message: `Licença técnica de desenvolvimento ativa até ${normalizeDateIso(expireDate)} para edição e testes locais.`
    };
  }

  getPlan(planCode) {
    return (
      this.getPlans().find((plan) => plan.code === String(planCode || "").trim().toLowerCase()) ||
      { ...DEFAULT_LICENSE_PLAN }
    );
  }

  getPublicKey() {
    return fs.readFileSync(this.publicKeyPath, "utf8");
  }

  getPublicKeyFingerprint() {
    try {
      return sha256(this.getPublicKey().replace(/\s+/g, "")).slice(0, 16);
    } catch (error) {
      this.log("warn", "[LICENSING] public key fingerprint unavailable", {
        publicKeyPath: this.publicKeyPath,
        error: String(error?.message || error)
      });
      return "";
    }
  }

  getApiBaseUrl() {
    const configuredUrl = String(process.env.KWANZA_LICENSE_API_URL || this.getStoredApiBaseUrl() || this.getSettingsApiBaseUrl() || this.config.apiBaseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    const productionDefaultUrl = "https://license.alvesestudio.ao";
    let apiBaseUrl = configuredUrl;

    if (this.app?.isPackaged) {
      if (!apiBaseUrl) {
        apiBaseUrl = productionDefaultUrl;
      }

      if (!apiBaseUrl.startsWith("https://")) {
        throw new Error("A aplicação empacotada só permite servidores de licenciamento com HTTPS.");
      }

      if (/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiBaseUrl)) {
        apiBaseUrl = productionDefaultUrl;
      }
    }

    if (!apiBaseUrl) {
      throw new Error("Configure a URL do servidor de licenciamento antes de continuar.");
    }

    return apiBaseUrl;
  }

  buildHardwareSnapshot() {
    if (this.installationIdentity?.generateHardwareFingerprint) {
      return this.installationIdentity.generateHardwareFingerprint();
    }
    return {
      motherboardSerial: "fallback-board",
      cpuId: os.cpus()?.[0]?.model || "cpu",
      biosSerial: "",
      diskSerials: [],
      macAddresses: [],
      machineGuid: "",
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch()
    };
  }

  getCanonicalHardwareSnapshot(snapshot = null) {
    if (this.installationIdentity?.canonicalizeHardwareData) {
      return this.installationIdentity.canonicalizeHardwareData(snapshot || this.buildHardwareSnapshot());
    }
    return snapshot || this.buildHardwareSnapshot();
  }

  buildDeviceHash() {
    if (this.installationIdentity?.getDeviceHash) {
      return this.installationIdentity.getDeviceHash();
    }
    return sha256(JSON.stringify(this.getCanonicalHardwareSnapshot()));
  }

  getInstallationFingerprint() {
    if (this.installationIdentity?.getFingerprintPayload) {
      return this.installationIdentity.getFingerprintPayload();
    }

    const hardwareSnapshot = this.buildHardwareSnapshot();
    return {
      installId: "",
      fingerprintHash: sha256(JSON.stringify(this.getCanonicalHardwareSnapshot(hardwareSnapshot))),
      hardwareSnapshot,
      canonicalHardwareData: this.getCanonicalHardwareSnapshot(hardwareSnapshot),
      riskFlags: []
    };
  }

  getAppChecksumTarget() {
    if (this.app?.isPackaged && process.resourcesPath) {
      const appAsarPath = path.join(process.resourcesPath, "app.asar");
      if (fs.existsSync(appAsarPath)) {
        return appAsarPath;
      }
    }

    const devMainPath = path.join(process.cwd(), "electron", "main.js");
    if (fs.existsSync(devMainPath)) {
      return devMainPath;
    }

    return process.execPath;
  }

  checksumFile(filePath) {
    const targetPath = String(filePath || "").trim();
    if (!targetPath) {
      return "";
    }

    try {
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        this.log("warn", "[LICENSING] checksum target unavailable", { filePath: targetPath });
        return "";
      }

      const hash = crypto.createHash("sha256");
      hash.update(fs.readFileSync(targetPath));
      return hash.digest("hex");
    } catch (error) {
      this.log("warn", "[LICENSING] checksum target could not be read", {
        filePath: targetPath,
        error: String(error?.message || error)
      });
      return "";
    }
  }

  buildRuntimeIntegrity() {
    const executablePath = process.execPath;
    const appTarget = this.getAppChecksumTarget();

    return {
      appVersion: this.currentVersion,
      executablePath,
      executableChecksum: this.checksumFile(executablePath),
      appTarget,
      appChecksum: this.checksumFile(appTarget)
    };
  }

  buildEncryptionKey(deviceHash) {
    return crypto.createHash("sha256").update(`${this.config.productCode}:${deviceHash}:license-cache`).digest();
  }

  encryptLegacyLocalLicense(payload, deviceHash) {
    const iv = crypto.randomBytes(12);
    const key = this.buildEncryptionKey(deviceHash);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      data: encrypted.toString("hex")
    });
  }

  decryptLegacyLocalLicense(content, deviceHash) {
    const parsed = safeJsonParse(content);
    if (!parsed?.iv || !parsed?.tag || !parsed?.data) {
      throw new Error("Ficheiro de licença local inválido.");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.buildEncryptionKey(deviceHash),
      Buffer.from(parsed.iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(parsed.data, "hex")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  }

  saveProtectedJson(secretName, payload) {
    if (!this.secureStorage?.storeSecret) {
      return false;
    }
    this.secureStorage.storeSecret(secretName, JSON.stringify(payload));
    return true;
  }

  readProtectedJson(secretName) {
    if (!this.secureStorage?.loadSecret) {
      return null;
    }
    const raw = this.secureStorage.loadSecret(secretName);
    return raw ? safeJsonParse(raw) : null;
  }

  saveLocalLicense(payload) {
    this.log("info", "[LICENSING] saving local license", {
      serialKey: String(payload?.serial_key || "").trim(),
      hasSecureStorage: Boolean(this.secureStorage?.storeSecret)
    });
    try {
      const storedInProtectedCache = this.saveProtectedJson(this.localLicenseSecretName, payload);
      if (!storedInProtectedCache) {
        const deviceHash = this.buildDeviceHash();
        fs.writeFileSync(this.licensePath, this.encryptLegacyLocalLicense(payload, deviceHash), "utf8");
      }
      if (storedInProtectedCache && fs.existsSync(this.licensePath)) {
        fs.unlinkSync(this.licensePath);
      }
      if (storedInProtectedCache && this.legacyLicensePath !== this.licensePath && fs.existsSync(this.legacyLicensePath)) {
        fs.unlinkSync(this.legacyLicensePath);
      }
      this.log("info", "[LICENSING] local license saved", {
        serialKey: String(payload?.serial_key || "").trim(),
        storage: storedInProtectedCache ? "secure-storage" : "encrypted-file"
      });
    } catch (error) {
      this.log("error", "[LICENSING] failed to save local license", {
        serialKey: String(payload?.serial_key || "").trim(),
        error: String(error?.stack || error?.message || error)
      });
      throw new Error("Não foi possível gravar a licença local. Verifique permissões da base de dados e do armazenamento seguro.");
    }
  }

  clearLocalLicense() {
    if (this.secureStorage?.removeSecret) {
      this.secureStorage.removeSecret(this.localLicenseSecretName);
    }
    if (fs.existsSync(this.licensePath)) {
      fs.unlinkSync(this.licensePath);
    }
    if (this.legacyLicensePath !== this.licensePath && fs.existsSync(this.legacyLicensePath)) {
      fs.unlinkSync(this.legacyLicensePath);
    }
    this.cachedStatus = null;
    this.lastCheckAt = 0;
    return { ok: true };
  }

  readLocalLicense() {
    const protectedLicense = this.readProtectedJson(this.localLicenseSecretName);
    if (protectedLicense) {
      return protectedLicense;
    }

    const sourcePath = fs.existsSync(this.licensePath)
      ? this.licensePath
      : this.legacyLicensePath !== this.licensePath && fs.existsSync(this.legacyLicensePath)
        ? this.legacyLicensePath
        : null;

    if (!sourcePath) {
      return null;
    }

    const deviceHash = this.buildDeviceHash();
    const content = fs.readFileSync(sourcePath, "utf8");
    const decrypted = this.decryptLegacyLocalLicense(content, deviceHash);
    this.saveLocalLicense(decrypted);
    return decrypted;
  }

  saveTrialCache(payload) {
    this.saveProtectedJson(this.localTrialSecretName, payload);
    return payload;
  }

  readTrialCache() {
    return this.readProtectedJson(this.localTrialSecretName);
  }

  verifySignedToken(token) {
    if (!String(token || "").includes(".")) {
      return { ok: false, message: "Token de licença inválido." };
    }

    const [payloadPart, signaturePart] = String(token).split(".");
    try {
      const payloadBuffer = base64UrlDecode(payloadPart);
      const signature = base64UrlDecode(signaturePart);
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(payloadBuffer);
      verifier.end();
      const valid = verifier.verify(this.getPublicKey(), signature);
      if (!valid) {
        this.log("error", "[LICENSING] license token signature mismatch", {
          publicKeyFingerprint: this.getPublicKeyFingerprint(),
          publicKeyPath: this.publicKeyPath
        });
        return {
          ok: false,
          status: "license_signature_mismatch",
          message:
            "A licença foi emitida pelo servidor, mas a assinatura digital não corresponde a esta versão do aplicativo. Verifique se a chave privada do servidor e a chave pública da build são do mesmo par."
        };
      }
      const payload = JSON.parse(payloadBuffer.toString("utf8"));
      return { ok: true, payload };
    } catch (error) {
      this.log("error", "[LICENSING] license token validation failed", {
        publicKeyFingerprint: this.getPublicKeyFingerprint(),
        error: String(error?.message || error)
      });
      return {
        ok: false,
        status: "license_token_invalid",
        message: "Não foi possível validar o token de licença recebido do servidor."
      };
    }
  }

  verifyTrialSignature(token) {
    const verification = this.verifySignedToken(token);
    if (!verification.ok) {
      return verification;
    }
    if (String(verification.payload?.token_type || "").toLowerCase() !== "trial") {
      return { ok: false, message: "O token de trial não é válido." };
    }
    return verification;
  }

  verifyLocalIntegrity(localLicense) {
    const currentIntegrity = this.buildRuntimeIntegrity();
    if (!localLicense?.integrity) {
      return { ok: true, currentIntegrity };
    }

    if (String(localLicense.integrity.appVersion || "") !== String(currentIntegrity.appVersion || "")) {
      return { ok: true, currentIntegrity };
    }

    if (
      localLicense.integrity.executableChecksum &&
      localLicense.integrity.executableChecksum !== currentIntegrity.executableChecksum
    ) {
      return {
        ok: false,
        currentIntegrity,
        message: "Foi detetada uma alteracao no executavel do aplicativo."
      };
    }

    if (localLicense.integrity.appChecksum && localLicense.integrity.appChecksum !== currentIntegrity.appChecksum) {
      return {
        ok: false,
        currentIntegrity,
        message: "Foi detetada uma alteracao nos ficheiros criticos da aplicação."
      };
    }

    return { ok: true, currentIntegrity };
  }

  buildStatusFromLocalLicense(localLicense) {
    this.log("info", "[LICENSING] validating local license offline", {
      serialKey: String(localLicense?.serial_key || "").trim()
    });
    const verification = this.verifySignedToken(localLicense?.license_token);
    if (!verification.ok) {
      this.log("warn", "[LICENSING] offline validation failed: invalid token", {
        serialKey: String(localLicense?.serial_key || "").trim(),
        message: verification.message
      });
      return {
        ok: false,
        status: verification.status || "invalid",
        canUseApp: false,
        message: verification.message
      };
    }

    const payload = verification.payload;
    const today = normalizeDateIso(new Date().toISOString());
    const deviceHash = this.buildDeviceHash();
    const installation = this.getInstallationFingerprint();
    if (payload.device_hash !== deviceHash) {
      this.log("warn", "[LICENSING] offline validation failed: device mismatch", {
        serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim()
      });
      return {
        ok: false,
        status: "tampered",
        canUseApp: false,
        message: "Esta licença está associada a outro dispositivo."
      };
    }

    if (payload.install_id && installation.installId && payload.install_id !== installation.installId) {
      this.log("warn", "[LICENSING] offline validation failed: installation mismatch", {
        serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim()
      });
      return {
        ok: false,
        status: "tampered",
        canUseApp: false,
        message: "A licença local não pertence a esta instalação."
      };
    }

    if (payload.hardware_snapshot) {
      const expectedHardware = this.getCanonicalHardwareSnapshot(payload.hardware_snapshot);
      const currentHardware = this.getCanonicalHardwareSnapshot(this.buildHardwareSnapshot());
      const hardwareChangeScore = calculateHardwareChangeScore(expectedHardware, currentHardware);
      if (hardwareChangeScore >= 30) {
        this.log("warn", "[LICENSING] offline validation requires hardware review", {
          serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim(),
          hardwareChangeScore
        });
        return {
          ok: false,
          status: "review_required",
          canUseApp: false,
          message: "Foi detetada uma alteracao suspeita no hardware desta instalação. Contacte o suporte."
        };
      }
    }

    const integrity = this.verifyLocalIntegrity(localLicense);
    if (!integrity.ok) {
      this.log("warn", "[LICENSING] offline validation failed: local integrity", {
        serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim(),
        message: integrity.message
      });
      return {
        ok: false,
        status: "tampered",
        canUseApp: false,
        message: integrity.message
      };
    }

    if (payload.status !== "active") {
      this.log("warn", "[LICENSING] offline validation failed: license not active", {
        serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim(),
        status: payload.status || "invalid"
      });
      return {
        ok: false,
        status: payload.status || "invalid",
        canUseApp: false,
        message: "A licença do Kwanza Folha não está ativa."
      };
    }

    if (today > normalizeDateIso(payload.expire_date)) {
      this.log("warn", "[LICENSING] offline validation failed: expired", {
        serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim(),
        expireDate: payload.expire_date
      });
      return {
        ok: false,
        status: "expired",
        canUseApp: false,
        plan: payload.plan,
        maxUsers: payload.max_users,
        maxEmployees: payload.max_employees ?? payload.max_users ?? 0,
        maxDevices: payload.max_devices ?? 0,
        serialKey: payload.serial_key,
        expireDate: payload.expire_date,
        message: "A sua licença do Kwanza Folha expirou. Renove para continuar usando o sistema."
      };
    }

    this.log("info", "[LICENSING] offline validation succeeded", {
      serialKey: String(payload?.serial_key || localLicense?.serial_key || "").trim(),
      expireDate: payload.expire_date
    });

    return {
      ok: true,
      status: "active",
      canUseApp: true,
      plan: payload.plan,
      maxUsers: payload.max_users,
      maxEmployees: payload.max_employees ?? payload.max_users ?? 0,
      maxDevices: payload.max_devices ?? 0,
      serialKey: payload.serial_key,
      expireDate: payload.expire_date,
      startDate: payload.start_date,
      companyName: payload.company_name,
      email: payload.email,
      deviceHash: payload.device_hash,
      daysRemaining: daysBetween(today, normalizeDateIso(payload.expire_date)),
      integrity
    };
  }

  buildTrialCacheFromLegacyContext(trialContext, installation) {
    if (!trialContext?.trialStartedAt) {
      return null;
    }
    return {
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      trial_started_at: trialContext.trialStartedAt,
      trial_duration_days: TRIAL_DAYS,
      suspicious_reinstall: Array.isArray(installation.riskFlags) && installation.riskFlags.includes("suspicious_reinstall"),
      source: "legacy_migration",
      created_at: nowIso()
    };
  }

  normalizeIsoOrEmpty(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  shouldMigrateTrialStart(existing, candidateStartedAt, installation, trialContext) {
    if (!existing?.trial_started_at) return false;
    if (!candidateStartedAt) return false;
    if (existing?.trial_token) return false; // token assinado manda
    if (String(existing?.source || "") !== "anchored_local") return false;
    if (Boolean(existing?.suspicious_reinstall)) return false;
    // Só migramos se já existe prova de registo inicial (utilizador/admin).
    if (trialContext?.setupRequired) return false;

    const existingIso = this.normalizeIsoOrEmpty(existing.trial_started_at);
    const candidateIso = this.normalizeIsoOrEmpty(candidateStartedAt);
    if (!existingIso || !candidateIso) return false;

    const existingTime = new Date(existingIso).getTime();
    const candidateTime = new Date(candidateIso).getTime();
    if (!(candidateTime > existingTime)) return false;

    // Migração segura: corrigir casos em que o trial foi iniciado na data da instalação
    // (installation.createdAt), mas deveria começar no registo inicial do utilizador/empresa.
    const installationCreatedIso = this.normalizeIsoOrEmpty(installation?.createdAt);
    if (!installationCreatedIso) return false;
    const installationTime = new Date(installationCreatedIso).getTime();

    const deltaExistingToInstall = Math.abs(existingTime - installationTime);
    const oneDayMs = 86400000;
    return deltaExistingToInstall <= oneDayMs;
  }

  ensureAnchoredTrialCache() {
    const installation = this.getInstallationFingerprint();
    const existing = this.readTrialCache();
    const trialContext = this.database?.getLicenseTrialContext ? this.database.getLicenseTrialContext() : null;
    if (existing?.trial_started_at) {
      const candidateStartedAt = String(trialContext?.trialStartedAt || "").trim();
      if (this.shouldMigrateTrialStart(existing, candidateStartedAt, installation, trialContext)) {
        try {
          return this.saveTrialCache({
            ...existing,
            trial_started_at: candidateStartedAt,
            migrated_from_started_at: existing.trial_started_at,
            migrated_at: nowIso(),
            migration_reason: "trial_started_at_should_follow_company_registration"
          });
        } catch {
          return existing;
        }
      }
      return existing;
    }

    const migratedTrial = this.buildTrialCacheFromLegacyContext(trialContext, installation);
    if (migratedTrial) {
      return this.saveTrialCache(migratedTrial);
    }

    if (trialContext?.setupRequired) {
      return null;
    }

    const startedAt = String(trialContext?.trialStartedAt || "").trim() || nowIso();
    return this.saveTrialCache({
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      trial_started_at: startedAt,
      trial_duration_days: TRIAL_DAYS,
      suspicious_reinstall: Array.isArray(installation.riskFlags) && installation.riskFlags.includes("suspicious_reinstall"),
      source: "anchored_local",
      created_at: nowIso()
    });
  }

  buildTrialStatus() {
    if (!this.database?.getLicenseTrialContext) {
      return {
        ok: true,
        status: "setup_required",
        canUseApp: true,
        requiresLicense: false,
        setupRequired: true,
        trialDaysTotal: TRIAL_DAYS,
        message: `Conclua o registo inicial da empresa para iniciar o período gratuito de ${TRIAL_DAYS} dias.`
      };
    }

    const trialContext = this.database.getLicenseTrialContext();
    if (trialContext.setupRequired) {
      return {
        ok: true,
        status: "setup_required",
        canUseApp: true,
        requiresLicense: false,
        setupRequired: true,
        companyName: trialContext.companyName,
        companyEmail: trialContext.companyEmail,
        companyPhone: trialContext.companyPhone,
        companyNif: trialContext.companyNif,
        email: trialContext.adminEmail || trialContext.companyEmail,
        message: `Conclua o registo inicial da empresa para iniciar o período gratuito de ${TRIAL_DAYS} dias.`
      };
    }

    const trialCache = this.ensureAnchoredTrialCache();
    const installation = this.getInstallationFingerprint();
    const signedTrial = trialCache?.trial_token ? this.verifyTrialSignature(trialCache.trial_token) : null;

    let trialStartedAt = String(trialCache?.trial_started_at || "").trim();
    let trialDurationDays = Number(trialCache?.trial_duration_days || TRIAL_DAYS);

    if (signedTrial?.ok) {
      const payload = signedTrial.payload;
      if (payload.install_id && installation.installId && payload.install_id !== installation.installId) {
        return {
          ok: false,
          status: "invalid",
          canUseApp: false,
          requiresLicense: true,
          message: "O token de trial pertence a outra instalação."
        };
      }
      trialStartedAt = String(payload.trial_started_at || trialStartedAt).trim();
      trialDurationDays = Number(payload.trial_duration_days || trialDurationDays || TRIAL_DAYS);
    }

    // Migração segura: se uma instalação antiga iniciou trial com menos dias (ex.: 7),
    // estendemos para TRIAL_DAYS apenas dentro da janela de TRIAL_DAYS (sem reset de data).
    if (!signedTrial?.ok) {
      const legacyDuration = Number(trialCache?.trial_duration_days || 0);
      if (trialStartedAt && legacyDuration > 0 && legacyDuration < TRIAL_DAYS) {
        const candidateExpire = addDaysToIso(trialStartedAt, TRIAL_DAYS);
        const candidateStillActive = Date.now() <= new Date(candidateExpire).getTime();
        if (candidateStillActive) {
          trialDurationDays = TRIAL_DAYS;
          try {
            this.saveTrialCache({
              ...trialCache,
              trial_duration_days: TRIAL_DAYS,
              upgraded_from_days: legacyDuration,
              upgraded_at: nowIso()
            });
          } catch {}
        }
      }
    }

    if (!trialStartedAt) {
      const fallbackStartedAt = nowIso();
      const fallbackExpireAt = addDaysToIso(fallbackStartedAt, trialDurationDays || TRIAL_DAYS);
      return {
        ok: true,
        status: "trial_active",
        canUseApp: true,
        requiresLicense: false,
        plan: "trial",
        maxUsers: 0,
        trialDaysTotal: trialDurationDays || TRIAL_DAYS,
        trialDaysRemaining: daysRemainingFromNow(fallbackExpireAt),
        trialStartedAt: fallbackStartedAt,
        trialExpireAt: fallbackExpireAt,
        companyName: trialContext.companyName,
        companyEmail: trialContext.companyEmail,
        companyPhone: trialContext.companyPhone,
        companyNif: trialContext.companyNif,
        email: trialContext.adminEmail || trialContext.companyEmail,
        warning: true,
        message: `Período gratuito ativo. Pode utilizar o Kwanza Folha durante mais ${daysRemainingFromNow(fallbackExpireAt)} dia(s).`
      };
    }

    const trialExpireAt = addDaysToIso(trialStartedAt, trialDurationDays);
    const isTrialActive = Date.now() <= new Date(trialExpireAt).getTime();

    if (isTrialActive) {
      return {
        ok: true,
        status: "trial_active",
        canUseApp: true,
        requiresLicense: false,
        plan: "trial",
        maxUsers: 0,
        trialDaysTotal: trialDurationDays,
        trialDaysRemaining: daysRemainingFromNow(trialExpireAt),
        trialStartedAt,
        trialExpireAt,
        suspiciousReinstall: Boolean(trialCache?.suspicious_reinstall),
        companyName: trialContext.companyName,
        companyEmail: trialContext.companyEmail,
        companyPhone: trialContext.companyPhone,
        companyNif: trialContext.companyNif,
        email: trialContext.adminEmail || trialContext.companyEmail,
        message: `Período gratuito ativo. Pode utilizar o Kwanza Folha durante mais ${daysRemainingFromNow(trialExpireAt)} dia(s).`
      };
    }

    return {
      ok: false,
      status: "trial_expired",
      canUseApp: false,
      requiresLicense: true,
      trialDaysTotal: trialDurationDays,
      trialStartedAt,
      trialExpireAt,
      suspiciousReinstall: Boolean(trialCache?.suspicious_reinstall),
      companyName: trialContext.companyName,
      companyEmail: trialContext.companyEmail,
      companyPhone: trialContext.companyPhone,
      companyNif: trialContext.companyNif,
      email: trialContext.adminEmail || trialContext.companyEmail,
      message: `O período gratuito de ${trialDurationDays} dias do Kwanza Folha terminou. Compre ou ative a licença mensal para continuar.`
    };
  }

  buildTrialFallbackForLicenseIssue(licenseStatus, issueSource = "local_license") {
    let trialStatus = null;
    try {
      trialStatus = this.buildTrialStatus();
    } catch {
      return licenseStatus;
    }

    if (trialStatus?.canUseApp && String(trialStatus.status || "").toLowerCase() === "trial_active") {
      return {
        ...trialStatus,
        warning: true,
        licenseIssue: {
          source: issueSource,
          status: licenseStatus?.status || "invalid",
          message: licenseStatus?.message || ""
        },
        message: trialStatus.message || `Período gratuito ativo. Pode utilizar o Kwanza Folha durante mais ${trialStatus.trialDaysRemaining || 1} dia(s).`
      };
    }

    return licenseStatus;
  }

  getLicenseStatus(force = false) {
    const now = Date.now();
    if (!force && this.cachedStatus && now - this.lastCheckAt < 10000) {
      return this.cachedStatus;
    }

    if (this.isDevelopmentLicenseMode()) {
      const status = this.buildDevelopmentLicenseStatus();
      this.cachedStatus = status;
      this.lastCheckAt = now;
      return status;
    }

    let status;
    try {
      const localLicense = this.readLocalLicense();
      if (localLicense) {
        status = this.buildStatusFromLocalLicense(localLicense);
        if (!status?.canUseApp) {
          status = this.buildTrialFallbackForLicenseIssue(status, "local_license");
        }
      } else {
        status = this.buildTrialStatus();
      }
    } catch (error) {
      status = {
        ok: false,
        status: "invalid",
        canUseApp: false,
        message: error.message || "A licença local está corrompida ou foi alterada."
      };
      status = this.buildTrialFallbackForLicenseIssue(status, "local_license_read");
    }

    this.cachedStatus = status;
    this.lastCheckAt = now;
    return status;
  }

  getLicenseGuardResult() {
    const status = this.getLicenseStatus();
    if (status.canUseApp) {
      return { ok: true, license: status };
    }
    return {
      ok: false,
      code: String(status.status || "invalid").trim().toLowerCase() || "invalid",
      message: status.message || "A licença do Kwanza Folha é inválida ou expirou. Ative ou renove para continuar.",
      license: status
    };
  }

  async apiRequest(route, payload = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs || 15000);
    try {
      const response = await fetch(`${this.getApiBaseUrl()}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
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
          return new URL(this.getApiBaseUrl()).host;
        } catch {
          return "servidor de licenças";
        }
      })();
      const shouldExposeMessage =
        /licenciamento com HTTPS/i.test(failureMessage) ||
        /Configure a URL do servidor de licenciamento/i.test(failureMessage);

      if (networkCode === "ENOTFOUND") {
        return {
          ok: false,
          message: `Não foi possível resolver o domínio do servidor de licenças (${configuredHost}). Verifique o DNS do subdomínio.`
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
        message:
          shouldExposeMessage
            ? failureMessage
            : error.name === "AbortError"
              ? "O servidor de licenças demorou demasiado tempo a responder."
              : "Não foi possível comunicar com o servidor de licenças."
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createPaymentReference(payload) {
    const requestedPlan = String(payload?.plan || "").trim().toLowerCase();
    return this.apiRequest("/payment/create", {
      ...payload,
      plan: requestedPlan || DEFAULT_LICENSE_PLAN.code
    });
  }

  async checkPaymentStatus(reference) {
    return this.apiRequest("/payment/status", { reference });
  }

  async activateLicense({ email, serialKey }) {
    const normalizedSerialKey = String(serialKey || "").trim().toUpperCase();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    this.log("info", "[LICENSING] starting local activation", {
      email: normalizedEmail,
      hasSerial: Boolean(normalizedSerialKey)
    });
    const deviceHash = this.buildDeviceHash();
    const integrity = this.buildRuntimeIntegrity();
    const installation = this.getInstallationFingerprint();
    const result = await this.apiRequest("/license/activate", {
      email: normalizedEmail,
      serial_key: normalizedSerialKey,
      device_hash: deviceHash,
      device_name: os.hostname(),
      app_version: this.currentVersion,
      integrity,
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      hardware_snapshot: installation.hardwareSnapshot
    });

    if (!result?.ok) {
      this.log("warn", "[LICENSING] activation rejected by server", {
        email: normalizedEmail,
        serialKey: normalizedSerialKey,
        message: result?.message || "unknown"
      });
      return result;
    }

    const localLicense = {
      license_token: result.license_token,
      expire_date: result.expire_date,
      plan: result.plan,
      max_users: result.max_users,
      max_employees: result.max_employees,
      max_devices: result.max_devices,
      serial_key: result.serial_key || normalizedSerialKey,
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      hardware_snapshot: installation.hardwareSnapshot,
      integrity,
      activated_at: nowIso()
    };
    try {
      this.saveLocalLicense(localLicense);
      if (this.secureStorage?.removeSecret) {
        this.secureStorage.removeSecret(this.localTrialSecretName);
      }
    } catch (error) {
      return {
        ok: false,
        status: "local_storage_failed",
        message: error.message || "Não foi possível gravar a licença local."
      };
    }
    const status = this.getLicenseStatus(true);
    if (!status?.canUseApp) {
      this.log("error", "[LICENSING] activation saved but offline validation failed", {
        email: normalizedEmail,
        serialKey: localLicense.serial_key,
        status: status?.status || "invalid",
        message: status?.message || ""
      });
      return {
        ok: false,
        status: status?.status || "invalid",
        message:
          status?.message ||
          "A licença foi gravada, mas a validação local não foi concluída neste dispositivo.",
        localLicenseSaved: true
      };
    }

    this.log("info", "[LICENSING] local activation completed", {
      email: normalizedEmail,
      serialKey: status.serialKey || localLicense.serial_key,
      expireDate: status.expireDate || localLicense.expire_date
    });
    return {
      ok: true,
      ...status
    };
  }

  async renewLicense(payload) {
    return this.createPaymentReference({
      ...payload,
      plan: String(payload?.plan || "").trim().toLowerCase() || DEFAULT_LICENSE_PLAN.code,
      renewal: true
    });
  }

  async registerInstallation() {
    const installation = this.getInstallationFingerprint();
    const result = await this.apiRequest("/install/register", {
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      device_hash: this.buildDeviceHash(),
      device_name: os.hostname(),
      app_version: this.currentVersion,
      hardware_snapshot: installation.hardwareSnapshot,
      risk_flags: installation.riskFlags
    });

    if (result?.ok && result.trial_token) {
      this.saveTrialCache({
        install_id: installation.installId,
        fingerprint_hash: installation.fingerprintHash,
        trial_started_at: result.trial_started_at,
        trial_duration_days: result.trial_duration_days || TRIAL_DAYS,
        trial_token: result.trial_token,
        suspicious_reinstall: Boolean(result.suspicious_reinstall),
        source: "server",
        created_at: nowIso()
      });
    }

    return result;
  }

  async heartbeatInstallation() {
    const installation = this.getInstallationFingerprint();
    const result = await this.apiRequest("/install/heartbeat", {
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      device_hash: this.buildDeviceHash(),
      app_version: this.currentVersion
    });

    if (result?.ok && result.trial_token) {
      this.saveTrialCache({
        install_id: installation.installId,
        fingerprint_hash: installation.fingerprintHash,
        trial_started_at: result.trial_started_at,
        trial_duration_days: result.trial_duration_days || TRIAL_DAYS,
        trial_token: result.trial_token,
        suspicious_reinstall: Boolean(result.suspicious_reinstall),
        source: "server",
        created_at: nowIso()
      });
    }

    return result;
  }

  async validateInstallation() {
    const installation = this.getInstallationFingerprint();
    return this.apiRequest("/install/validate", {
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      device_hash: this.buildDeviceHash(),
      app_version: this.currentVersion
    });
  }

  async primeInstallation() {
    try {
      const localLicense = this.readLocalLicense();
      if (localLicense) {
        return this.heartbeatInstallation();
      }
      const trialCache = this.readTrialCache();
      if (trialCache?.trial_token) {
        return this.heartbeatInstallation();
      }
      return this.registerInstallation();
    } catch {
      return { ok: false };
    }
  }
}

module.exports = {
  LicensingService,
  LICENSE_PLANS
};
