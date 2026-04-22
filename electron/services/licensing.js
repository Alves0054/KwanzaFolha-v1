const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const licenseSource = require("../config/license-source");
const { LICENSE_PLANS, DEFAULT_LICENSE_PLAN } = require("../../shared/license-plans");

const TRIAL_DAYS = 30;
const DEVELOPMENT_LICENSE_DAYS = 365;
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
    installationIdentity = null
  }) {
    this.app = app;
    this.userDataPath = userDataPath;
    this.currentVersion = currentVersion;
    this.productName = productName || "Kwanza Folha";
    this.database = database || null;
    this.secureStorage = secureStorage;
    this.installationIdentity = installationIdentity;
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

  getApiBaseUrl() {
    const configuredUrl = String(process.env.KWANZA_LICENSE_API_URL || this.config.apiBaseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    const productionDefaultUrl = "https://license.alvesestudio.ao";
    let apiBaseUrl = configuredUrl;

    if (this.app?.isPackaged) {
      if (!apiBaseUrl) {
        apiBaseUrl = productionDefaultUrl;
      }

      if (!apiBaseUrl.startsWith("https://")) {
        throw new Error("A aplicacao empacotada so permite servidores de licenciamento com HTTPS.");
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
    if (this.app?.isPackaged) {
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
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
  }

  buildRuntimeIntegrity() {
    const executablePath = process.execPath;
    const appTarget = this.getAppChecksumTarget();

    return {
      appVersion: this.currentVersion,
      executablePath,
      executableChecksum: fs.existsSync(executablePath) ? this.checksumFile(executablePath) : "",
      appTarget,
      appChecksum: fs.existsSync(appTarget) ? this.checksumFile(appTarget) : ""
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
      throw new Error("Ficheiro de licenca local invalido.");
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
      return { ok: false, message: "Token de licenca invalido." };
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
        return { ok: false, message: "A assinatura digital da licenca e invalida." };
      }
      const payload = JSON.parse(payloadBuffer.toString("utf8"));
      return { ok: true, payload };
    } catch {
      return { ok: false, message: "Nao foi possivel validar o token de licenca." };
    }
  }

  verifyTrialSignature(token) {
    const verification = this.verifySignedToken(token);
    if (!verification.ok) {
      return verification;
    }
    if (String(verification.payload?.token_type || "").toLowerCase() !== "trial") {
      return { ok: false, message: "O token de trial nao e valido." };
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
        message: "Foi detetada uma alteracao nos ficheiros criticos da aplicacao."
      };
    }

    return { ok: true, currentIntegrity };
  }

  buildStatusFromLocalLicense(localLicense) {
    const verification = this.verifySignedToken(localLicense?.license_token);
    if (!verification.ok) {
      return {
        ok: false,
        status: "invalid",
        canUseApp: false,
        message: verification.message
      };
    }

    const payload = verification.payload;
    const today = normalizeDateIso(new Date().toISOString());
    const deviceHash = this.buildDeviceHash();
    const installation = this.getInstallationFingerprint();
    if (payload.device_hash !== deviceHash) {
      return {
        ok: false,
        status: "tampered",
        canUseApp: false,
        message: "Esta licenca esta associada a outro dispositivo."
      };
    }

    if (payload.install_id && installation.installId && payload.install_id !== installation.installId) {
      return {
        ok: false,
        status: "tampered",
        canUseApp: false,
        message: "A licenca local nao pertence a esta instalacao."
      };
    }

    if (payload.hardware_snapshot) {
      const expectedHardware = this.getCanonicalHardwareSnapshot(payload.hardware_snapshot);
      const currentHardware = this.getCanonicalHardwareSnapshot(this.buildHardwareSnapshot());
      const hardwareChangeScore = calculateHardwareChangeScore(expectedHardware, currentHardware);
      if (hardwareChangeScore >= 30) {
        return {
          ok: false,
          status: "review_required",
          canUseApp: false,
          message: "Foi detetada uma alteracao suspeita no hardware desta instalacao. Contacte o suporte."
        };
      }
    }

    const integrity = this.verifyLocalIntegrity(localLicense);
    if (!integrity.ok) {
      return {
        ok: false,
        status: "tampered",
        canUseApp: false,
        message: integrity.message
      };
    }

    if (payload.status !== "active") {
      return {
        ok: false,
        status: payload.status || "invalid",
        canUseApp: false,
        message: "A licenca do Kwanza Folha nao esta ativa."
      };
    }

    if (today > normalizeDateIso(payload.expire_date)) {
      return {
        ok: false,
        status: "expired",
        canUseApp: false,
        plan: payload.plan,
        maxUsers: payload.max_users,
        serialKey: payload.serial_key,
        expireDate: payload.expire_date,
        message: "Sua licenca do Kwanza Folha expirou. Renove para continuar usando o sistema."
      };
    }

    return {
      ok: true,
      status: "active",
      canUseApp: true,
      plan: payload.plan,
      maxUsers: payload.max_users,
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

  ensureAnchoredTrialCache() {
    const installation = this.getInstallationFingerprint();
    const existing = this.readTrialCache();
    if (existing?.trial_started_at) {
      return existing;
    }

    const trialContext = this.database?.getLicenseTrialContext ? this.database.getLicenseTrialContext() : null;
    const migratedTrial = this.buildTrialCacheFromLegacyContext(trialContext, installation);
    if (migratedTrial) {
      return this.saveTrialCache(migratedTrial);
    }

    if (trialContext?.setupRequired) {
      return null;
    }

    return this.saveTrialCache({
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      trial_started_at: installation.createdAt || nowIso(),
      trial_duration_days: TRIAL_DAYS,
      suspicious_reinstall: Array.isArray(installation.riskFlags) && installation.riskFlags.includes("suspicious_reinstall"),
      source: "anchored_local",
      created_at: nowIso()
    });
  }

  buildTrialStatus() {
    if (!this.database?.getLicenseTrialContext) {
      return {
        ok: false,
        status: "missing",
        canUseApp: false,
        requiresLicense: true,
        message: "Ative o Kwanza Folha para continuar a usar o sistema."
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
        message: "Conclua o registo inicial da empresa para iniciar o periodo gratuito de 30 dias."
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
          message: "O token de trial pertence a outra instalacao."
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
      return {
        ok: false,
        status: "missing",
        canUseApp: false,
        requiresLicense: true,
        companyName: trialContext.companyName,
        companyEmail: trialContext.companyEmail,
        companyPhone: trialContext.companyPhone,
        companyNif: trialContext.companyNif,
        email: trialContext.adminEmail || trialContext.companyEmail,
        message: "Nao foi possivel localizar o inicio do periodo gratuito. Ative ou compre a licenca mensal para continuar."
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
        message: `Periodo gratuito ativo. Pode utilizar o Kwanza Folha durante mais ${daysRemainingFromNow(trialExpireAt)} dia(s).`
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
      message: "O periodo gratuito de 30 dias do Kwanza Folha terminou. Compre ou ative a licenca mensal para continuar."
    };
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
      status = localLicense ? this.buildStatusFromLocalLicense(localLicense) : this.buildTrialStatus();
    } catch (error) {
      status = {
        ok: false,
        status: "invalid",
        canUseApp: false,
        message: error.message || "A licenca local esta corrompida ou foi alterada."
      };
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
      message: status.message || "A licenca do Kwanza Folha e invalida ou expirou. Ative ou renove para continuar.",
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
          message: result?.message || `Nao foi possivel concluir o pedido (${response.status}).`
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
          return "servidor de licencas";
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
              ? "O servidor de licencas demorou demasiado tempo a responder."
              : "Nao foi possivel comunicar com o servidor de licencas."
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createPaymentReference(payload) {
    return this.apiRequest("/payment/create", {
      ...payload,
      plan: DEFAULT_LICENSE_PLAN.code
    });
  }

  async checkPaymentStatus(reference) {
    return this.apiRequest("/payment/status", { reference });
  }

  async activateLicense({ email, serialKey }) {
    const deviceHash = this.buildDeviceHash();
    const integrity = this.buildRuntimeIntegrity();
    const installation = this.getInstallationFingerprint();
    const result = await this.apiRequest("/license/activate", {
      email,
      serial_key: serialKey,
      device_hash: deviceHash,
      device_name: os.hostname(),
      app_version: this.currentVersion,
      integrity,
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      hardware_snapshot: installation.hardwareSnapshot
    });

    if (!result?.ok) {
      return result;
    }

    const localLicense = {
      license_token: result.license_token,
      expire_date: result.expire_date,
      plan: result.plan,
      max_users: result.max_users,
      serial_key: result.serial_key,
      install_id: installation.installId,
      fingerprint_hash: installation.fingerprintHash,
      hardware_snapshot: installation.hardwareSnapshot,
      integrity,
      activated_at: nowIso()
    };
    this.saveLocalLicense(localLicense);
    if (this.secureStorage?.removeSecret) {
      this.secureStorage.removeSecret(this.localTrialSecretName);
    }
    return {
      ok: true,
      ...this.getLicenseStatus(true)
    };
  }

  async renewLicense(payload) {
    return this.createPaymentReference({
      ...payload,
      plan: DEFAULT_LICENSE_PLAN.code,
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
