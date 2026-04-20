const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { LICENSE_PLANS, DEFAULT_LICENSE_PLAN } = require("../shared/license-plans");

const DEFAULT_TRIAL_DAYS = 15;

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || "").trim());
}

function verifySecret(secret, storedHash) {
  const normalizedHash = String(storedHash || "").trim();
  if (!normalizedHash) {
    return false;
  }
  if (isBcryptHash(normalizedHash)) {
    return bcrypt.compareSync(String(secret || ""), normalizedHash);
  }
  return constantTimeEqual(sha256(secret), normalizedHash);
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildSecurityHeaders(extraHeaders = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "Cache-Control": "no-store",
    ...extraHeaders
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, buildSecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  }));
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, buildSecurityHeaders({ "Content-Type": "text/html; charset=utf-8" }));
  response.end(html);
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(value || "").trim());
}

function normalizeDate(value) {
  return String(value || "").slice(0, 10);
}

function addDays(dateIso, days) {
  const base = new Date(`${normalizeDate(dateIso)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function resolvePaymentInstructions(context = {}) {
  const defaults = {
    bankName: "",
    accountName: "",
    iban: "",
    accountNumber: "",
    entity: "",
    referenceLabel: "Referência",
    supportEmail: "",
    supportPhone: "",
    notes: ""
  };
  const instructions = context?.settings?.paymentInstructions || {};
  return {
    bankName: String(instructions.bankName || defaults.bankName || "").trim(),
    accountName: String(instructions.accountName || defaults.accountName || "").trim(),
    iban: String(instructions.iban || defaults.iban || "").trim(),
    accountNumber: String(instructions.accountNumber || defaults.accountNumber || "").trim(),
    entity: String(instructions.entity || defaults.entity || "").trim(),
    referenceLabel: String(instructions.referenceLabel || defaults.referenceLabel || "Referência").trim(),
    supportEmail: String(instructions.supportEmail || defaults.supportEmail || "").trim(),
    supportPhone: String(instructions.supportPhone || defaults.supportPhone || "").trim(),
    notes: String(instructions.notes || defaults.notes || "").trim()
  };
}

class LicensingServer {
  constructor() {
    this.rootDir = path.resolve(__dirname, "..");
    this.configDir = path.join(__dirname, "config");
    this.storageDir = path.join(__dirname, "storage");
    this.invoiceDir = path.join(this.storageDir, "invoices");
    this.keyDir = path.join(this.storageDir, "keys");
    this.dbPath = path.join(this.storageDir, "licensing.sqlite");
    this.privateKeyPath = path.join(this.keyDir, "license-private.pem");
    this.settingsPath = path.join(this.configDir, "settings.json");
    this.rateLimitBuckets = new Map();
    this.runtimeRequireHttps = false;
    this.runtimeHttpsEnabled = false;
    this.runtimeAllowHttpBehindProxy = false;

    ensureDir(this.configDir);
    ensureDir(this.storageDir);
    ensureDir(this.invoiceDir);
    ensureDir(this.keyDir);
    this.ensureSettings();
    const loadedSettings = safeJsonParse(fs.readFileSync(this.settingsPath, "utf8"), {});
    this.settings = this.normalizeSettings(loadedSettings);
    if (JSON.stringify(loadedSettings) !== JSON.stringify(this.settings)) {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    }
    this.db = new Database(this.dbPath);
    this.setupSchema();
  }

  createDefaultSettings() {
    return {
      server: {
        host: "127.0.0.1",
        port: 3055
      },
      https: {
        enabled: false,
        keyPath: "",
        certPath: ""
      },
      smtp: {
        host: "",
        port: 587,
        secure: false,
        user: "",
        password: "",
        fromName: "Kwanza Folha",
        fromEmail: ""
      },
      issuer: {
        companyName: "Kwanza Folha",
        invoicePrefix: "FT",
        emailSubject: "Sua licença do KwanzaFolha"
      },
      webhook: {
        secret: "",
        provider: "generic",
        requireAmountMatch: true,
        paidStatuses: ["paid", "confirmed", "success", "completed"],
        cancelledStatuses: ["cancelled", "canceled", "failed", "expired"]
      },
      admin: {
        username: "admin",
        passwordHash: "",
        tokenHash: ""
      },
      rateLimit: {
        windowMs: 60000,
        maxRequests: 90,
        maxSensitiveRequests: 20,
        maxAdminRequests: 10
      },
      sales: {
        enabled: false,
        disabledMessage: "Licenciamento comercial temporariamente suspenso até à correção fiscal mínima do produto."
      },
      paymentInstructions: {
        bankName: "",
        accountName: "",
        iban: "",
        accountNumber: "",
        entity: "",
        referenceLabel: "Referência",
        supportEmail: "",
        supportPhone: "",
        notes: ""
      },
      security: {
        requireHttps: true,
        allowHttpBehindProxy: false
      }
    };
  }

  normalizeSettings(candidate = {}) {
    const defaults = this.createDefaultSettings();
    const webhook = candidate?.webhook || {};
    const admin = candidate?.admin || {};
    const rateLimit = candidate?.rateLimit || {};
    const sales = candidate?.sales || {};
    const paymentInstructions = candidate?.paymentInstructions || {};
    const security = candidate?.security || {};

    return {
      ...defaults,
      ...candidate,
      server: {
        ...defaults.server,
        ...(candidate?.server || {})
      },
      https: {
        ...defaults.https,
        ...(candidate?.https || {})
      },
      smtp: {
        ...defaults.smtp,
        ...(candidate?.smtp || {})
      },
      issuer: {
        ...defaults.issuer,
        ...(candidate?.issuer || {})
      },
      admin: {
        ...defaults.admin,
        ...admin,
        username: String(admin?.username || defaults.admin.username || "admin").trim(),
        passwordHash: String(admin?.passwordHash || "").trim(),
        tokenHash: String(admin?.tokenHash || "").trim()
      },
      rateLimit: {
        ...defaults.rateLimit,
        ...rateLimit,
        windowMs: Math.max(1000, Number(rateLimit?.windowMs || defaults.rateLimit.windowMs || 60000)),
        maxRequests: Math.max(10, Number(rateLimit?.maxRequests || defaults.rateLimit.maxRequests || 90)),
        maxSensitiveRequests: Math.max(
          3,
          Number(rateLimit?.maxSensitiveRequests || defaults.rateLimit.maxSensitiveRequests || 20)
        ),
        maxAdminRequests: Math.max(2, Number(rateLimit?.maxAdminRequests || defaults.rateLimit.maxAdminRequests || 10))
      },
      sales: {
        ...defaults.sales,
        ...sales,
        enabled: typeof sales?.enabled === "boolean" ? sales.enabled : defaults.sales.enabled,
        disabledMessage: String(sales?.disabledMessage || defaults.sales.disabledMessage || "").trim()
      },
      paymentInstructions: {
        ...defaults.paymentInstructions,
        ...paymentInstructions,
        bankName: String(paymentInstructions?.bankName || defaults.paymentInstructions.bankName || "").trim(),
        accountName: String(paymentInstructions?.accountName || defaults.paymentInstructions.accountName || "").trim(),
        iban: String(paymentInstructions?.iban || defaults.paymentInstructions.iban || "").trim(),
        accountNumber: String(
          paymentInstructions?.accountNumber || defaults.paymentInstructions.accountNumber || ""
        ).trim(),
        entity: String(paymentInstructions?.entity || defaults.paymentInstructions.entity || "").trim(),
        referenceLabel: String(
          paymentInstructions?.referenceLabel || defaults.paymentInstructions.referenceLabel || "Referência"
        ).trim(),
        supportEmail: String(paymentInstructions?.supportEmail || defaults.paymentInstructions.supportEmail || "").trim(),
        supportPhone: String(paymentInstructions?.supportPhone || defaults.paymentInstructions.supportPhone || "").trim(),
        notes: String(paymentInstructions?.notes || defaults.paymentInstructions.notes || "").trim()
      },
      security: {
        ...defaults.security,
        ...security,
        requireHttps:
          typeof security?.requireHttps === "boolean" ? security.requireHttps : defaults.security.requireHttps,
        allowHttpBehindProxy:
          typeof security?.allowHttpBehindProxy === "boolean"
            ? security.allowHttpBehindProxy
            : defaults.security.allowHttpBehindProxy
      },
      webhook: {
        ...defaults.webhook,
        ...webhook,
        provider: String(webhook?.provider || defaults.webhook.provider || "generic").trim().toLowerCase(),
        requireAmountMatch:
          typeof webhook?.requireAmountMatch === "boolean"
            ? webhook.requireAmountMatch
            : defaults.webhook.requireAmountMatch,
        paidStatuses:
          Array.isArray(webhook?.paidStatuses) && webhook.paidStatuses.length
            ? webhook.paidStatuses
            : defaults.webhook.paidStatuses,
        cancelledStatuses:
          Array.isArray(webhook?.cancelledStatuses) && webhook.cancelledStatuses.length
            ? webhook.cancelledStatuses
            : defaults.webhook.cancelledStatuses
      }
    };
  }

  ensureSettings() {
    if (fs.existsSync(this.settingsPath)) {
      return;
    }

    fs.writeFileSync(this.settingsPath, JSON.stringify(this.createDefaultSettings(), null, 2));
  }

  setupSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        telefone TEXT NOT NULL DEFAULT '',
        nif TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        serial_key TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL,
        max_users INTEGER,
        start_date TEXT NOT NULL,
        expire_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        amount REAL NOT NULL,
        plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        valid_until TEXT NOT NULL,
        serial_key TEXT DEFAULT '',
        renewal INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        paid_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        license_id INTEGER NOT NULL,
        invoice_number TEXT NOT NULL UNIQUE,
        amount REAL NOT NULL,
        pdf_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        payment_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (license_id) REFERENCES licenses(id),
        FOREIGN KEY (payment_id) REFERENCES payments(id)
      );

      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_id INTEGER NOT NULL UNIQUE,
        device_hash TEXT NOT NULL,
        device_name TEXT NOT NULL DEFAULT '',
        app_version TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (license_id) REFERENCES licenses(id)
      );

      CREATE TABLE IF NOT EXISTS installations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        install_id TEXT NOT NULL UNIQUE,
        fingerprint_hash TEXT NOT NULL,
        license_id INTEGER DEFAULT NULL,
        trial_started_at TEXT NOT NULL,
        trial_duration_days INTEGER NOT NULL DEFAULT ${DEFAULT_TRIAL_DAYS},
        last_seen_at TEXT NOT NULL,
        risk_flags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (license_id) REFERENCES licenses(id)
      );
    `);

    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices(payment_id) WHERE payment_id IS NOT NULL");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_installations_fingerprint_hash ON installations(fingerprint_hash)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_installations_license_id ON installations(license_id)");
    this.db.prepare(`
      UPDATE installations
      SET trial_duration_days = ?, updated_at = ?
      WHERE trial_duration_days IS NULL OR trial_duration_days < ?
    `).run(DEFAULT_TRIAL_DAYS, nowIso(), DEFAULT_TRIAL_DAYS);

    const invoiceColumns = this.db.prepare("PRAGMA table_info(invoices)").all();
    if (!invoiceColumns.find((column) => column.name === "delivery_status")) {
      this.db.exec("ALTER TABLE invoices ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'");
    }
    if (!invoiceColumns.find((column) => column.name === "email_sent_at")) {
      this.db.exec("ALTER TABLE invoices ADD COLUMN email_sent_at TEXT DEFAULT NULL");
    }
    if (!invoiceColumns.find((column) => column.name === "email_attempts")) {
      this.db.exec("ALTER TABLE invoices ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0");
    }
    if (!invoiceColumns.find((column) => column.name === "last_email_error")) {
      this.db.exec("ALTER TABLE invoices ADD COLUMN last_email_error TEXT NOT NULL DEFAULT ''");
    }
    if (!invoiceColumns.find((column) => column.name === "updated_at")) {
      this.db.exec("ALTER TABLE invoices ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    }
  }

  getPlan(planCode) {
    const normalizedPlanCode = String(planCode || "").trim().toLowerCase();
    return (
      LICENSE_PLANS.find((plan) => plan.code === normalizedPlanCode || plan.name.toLowerCase() === normalizedPlanCode) ||
      DEFAULT_LICENSE_PLAN
    );
  }

  getWebhookSettings() {
    const webhook = this.settings?.webhook || {};
    return {
      secret: String(process.env.KWANZA_WEBHOOK_SECRET || webhook.secret || "").trim(),
      provider: String(webhook.provider || "generic").trim().toLowerCase(),
      requireAmountMatch:
        typeof webhook.requireAmountMatch === "boolean" ? webhook.requireAmountMatch : true,
      paidStatuses: (Array.isArray(webhook.paidStatuses) ? webhook.paidStatuses : [])
        .map((status) => String(status || "").trim().toLowerCase())
        .filter(Boolean),
      cancelledStatuses: (Array.isArray(webhook.cancelledStatuses) ? webhook.cancelledStatuses : [])
        .map((status) => String(status || "").trim().toLowerCase())
        .filter(Boolean)
    };
  }

  getAdminAuthSettings() {
    const admin = this.settings?.admin || {};
    return {
      username: String(process.env.KWANZA_ADMIN_USERNAME || admin.username || "admin").trim(),
      password: String(process.env.KWANZA_ADMIN_PASSWORD || "").trim(),
      passwordHash: String(process.env.KWANZA_ADMIN_PASSWORD_HASH || admin.passwordHash || "").trim(),
      token: String(process.env.KWANZA_ADMIN_TOKEN || "").trim(),
      tokenHash: String(process.env.KWANZA_ADMIN_TOKEN_HASH || admin.tokenHash || "").trim()
    };
  }

  getRateLimitSettings() {
    return this.settings?.rateLimit || this.createDefaultSettings().rateLimit;
  }

  getSalesSettings() {
    return this.settings?.sales || this.createDefaultSettings().sales;
  }

  getSecuritySettings() {
    return this.settings?.security || this.createDefaultSettings().security;
  }

  getPaymentInstructions() {
    const base = resolvePaymentInstructions(this);
    return {
      ...base,
      bankName: String(process.env.KWANZA_PAYMENT_BANK_NAME || base.bankName || "").trim(),
      accountName: String(process.env.KWANZA_PAYMENT_ACCOUNT_NAME || base.accountName || "").trim(),
      iban: String(process.env.KWANZA_PAYMENT_IBAN || base.iban || "").trim(),
      accountNumber: String(process.env.KWANZA_PAYMENT_ACCOUNT_NUMBER || base.accountNumber || "").trim(),
      entity: String(process.env.KWANZA_PAYMENT_ENTITY || base.entity || "").trim(),
      referenceLabel: String(process.env.KWANZA_PAYMENT_REFERENCE_LABEL || base.referenceLabel || "Referencia").trim(),
      supportEmail: String(process.env.KWANZA_PAYMENT_SUPPORT_EMAIL || base.supportEmail || "").trim(),
      supportPhone: String(process.env.KWANZA_PAYMENT_SUPPORT_PHONE || base.supportPhone || "").trim(),
      notes: String(process.env.KWANZA_PAYMENT_NOTES || base.notes || "").trim()
    };
  }

  getPrivateKeyMaterial() {
    const inlineKey = String(process.env.KWANZA_LICENSE_PRIVATE_KEY || "").trim();
    if (inlineKey) {
      return inlineKey.replace(/\\n/g, "\n");
    }

    const envPath = String(process.env.KWANZA_LICENSE_PRIVATE_KEY_PATH || "").trim();
    const resolvedPath = envPath ? path.resolve(envPath) : this.privateKeyPath;
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      throw new Error(
        "A chave privada do licenciamento não está configurada. Defina KWANZA_LICENSE_PRIVATE_KEY ou KWANZA_LICENSE_PRIVATE_KEY_PATH."
      );
    }
    return fs.readFileSync(resolvedPath, "utf8");
  }

  isCommercialLicensingEnabled() {
    const sales = this.getSalesSettings();
    return Boolean(process.env.KWANZA_ENABLE_COMMERCIAL_SALES === "1" || sales.enabled);
  }

  getCommercialLicensingMessage() {
    const sales = this.getSalesSettings();
    return (
      String(process.env.KWANZA_COMMERCIAL_SALES_MESSAGE || sales.disabledMessage || "").trim() ||
      "Licenciamento comercial temporariamente suspenso até à correção fiscal mínima do produto."
    );
  }

  resolveClientIp(request) {
    const forwarded = String(request?.headers?.["x-forwarded-for"] || "")
      .split(",")
      .map((entry) => entry.trim())
      .find(Boolean);
    const remote = forwarded || request?.socket?.remoteAddress || request?.connection?.remoteAddress || "unknown";
    return String(remote).replace(/^::ffff:/, "");
  }

  authenticateAdminRequest(request) {
    const auth = this.getAdminAuthSettings();
    const hasPasswordAuth = Boolean(auth.username && (auth.password || auth.passwordHash));
    const hasTokenAuth = Boolean(auth.token || auth.tokenHash);

    if (!hasPasswordAuth && !hasTokenAuth) {
      return {
        ok: false,
        message:
          "Autenticação administrativa não configurada. Defina KWANZA_ADMIN_PASSWORD_HASH/KWANZA_ADMIN_TOKEN_HASH ou os equivalentes em variáveis de ambiente."
      };
    }

    const authorization = String(request?.headers?.authorization || "").trim();
    if (!authorization) {
      return { ok: false, message: "Autenticação administrativa obrigatória." };
    }

    if (authorization.toLowerCase().startsWith("bearer ")) {
      const token = authorization.slice(7).trim();
      const matchesHash = auth.tokenHash ? verifySecret(token, auth.tokenHash) : false;
      const matchesPlain = auth.token ? constantTimeEqual(token, auth.token) : false;
      if (matchesHash || matchesPlain) {
        return { ok: true, method: "bearer" };
      }
      return { ok: false, message: "Token administrativo inválido." };
    }

    if (authorization.toLowerCase().startsWith("basic ")) {
      try {
        const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
        const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";
        const matchesUser = auth.username ? constantTimeEqual(username, auth.username) : false;
        const matchesHash = auth.passwordHash ? verifySecret(password, auth.passwordHash) : false;
        const matchesPlain = auth.password ? constantTimeEqual(password, auth.password) : false;
        if (matchesUser && (matchesHash || matchesPlain)) {
          return { ok: true, method: "basic", username };
        }
      } catch {}
      return { ok: false, message: "Credenciais administrativas inválidas." };
    }

    return { ok: false, message: "Método de autenticação administrativa não suportado." };
  }

  sendAdminUnauthorized(response, message = "Autenticação administrativa obrigatória.") {
    response.writeHead(401, buildSecurityHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Kwanza Folha Admin"'
    }));
    response.end(message);
  }

  consumeRateLimit(scope, request, response) {
    const settings = this.getRateLimitSettings();
    const limits = {
      general: Math.max(1, Number(settings.maxRequests || 90)),
      sensitive: Math.max(1, Number(settings.maxSensitiveRequests || 20)),
      admin: Math.max(1, Number(settings.maxAdminRequests || 10))
    };
    const limit = limits[scope] || limits.general;
    const windowMs = Math.max(1000, Number(settings.windowMs || 60000));
    const now = Date.now();
    const ip = this.resolveClientIp(request);
    const key = `${scope}:${ip}`;
    const current = this.rateLimitBuckets.get(key);

    if (!current || current.resetAt <= now) {
      this.rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (current.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      sendJson(response, 429, {
        ok: false,
        message: "Foram efetuados demasiados pedidos num intervalo curto. Tente novamente dentro de instantes."
      });
      return false;
    }

    current.count += 1;
    this.rateLimitBuckets.set(key, current);
    return true;
  }

  parseBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const maxBytes = 1024 * 1024;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error("O corpo do pedido excede o limite de 1 MB."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        const contentType = String(request.headers["content-type"] || "");
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) {
          resolve({});
          return;
        }

        if (contentType.includes("application/json")) {
          resolve(safeJsonParse(raw, {}));
          return;
        }

        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(raw);
          resolve(Object.fromEntries(params.entries()));
          return;
        }

        resolve({});
      });
      request.on("error", reject);
    });
  }

  getUserByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(String(email || "").trim().toLowerCase());
  }

  upsertCustomer({ empresa, email, telefone, nif }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const current = this.getUserByEmail(normalizedEmail);
    if (current) {
      this.db.prepare(`
        UPDATE users
        SET empresa = ?, telefone = ?, nif = ?
        WHERE id = ?
      `).run(String(empresa || current.empresa || "").trim(), String(telefone || "").trim(), String(nif || "").trim(), current.id);
      return this.getUserByEmail(normalizedEmail);
    }

    const result = this.db.prepare(`
      INSERT INTO users (empresa, email, telefone, nif, password_hash, created_at)
      VALUES (?, ?, ?, ?, '', ?)
    `).run(
      String(empresa || "").trim(),
      normalizedEmail,
      String(telefone || "").trim(),
      String(nif || "").trim(),
      nowIso()
    );
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  }

  generateReference() {
    while (true) {
      const reference = `${crypto.randomInt(0, 10 ** 6).toString().padStart(6, "0")}${crypto
        .randomInt(0, 10 ** 6)
        .toString()
        .padStart(6, "0")}`;
      const exists = this.db.prepare("SELECT id FROM payments WHERE reference = ?").get(reference);
      if (!exists) {
        return reference;
      }
    }
  }

  generateSerialKey(userId) {
    const hash = sha256(`${userId}:${Date.now()}:${crypto.randomBytes(10).toString("hex")}`).toUpperCase();
    const pieces = hash.slice(0, 16).match(/.{1,4}/g) || [];
    return `KWZ-${pieces.join("-")}`;
  }

  signLicenseToken(payload) {
    const privateKey = this.getPrivateKeyMaterial();
    const payloadJson = JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadJson, "utf8");
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(payloadBuffer);
    signer.end();
    const signature = signer.sign(privateKey);
    return `${base64UrlEncode(payloadBuffer)}.${base64UrlEncode(signature)}`;
  }

  normalizeRiskFlags(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)));
  }

  signTrialToken(payload) {
    return this.signLicenseToken({
      token_type: "trial",
      status: "active",
      issued_at: nowIso(),
      ...payload
    });
  }

  getInstallationByInstallId(installId) {
    return this.db.prepare("SELECT * FROM installations WHERE install_id = ?").get(String(installId || "").trim());
  }

  getInstallationByFingerprint(fingerprintHash) {
    return this.db
      .prepare("SELECT * FROM installations WHERE fingerprint_hash = ? ORDER BY updated_at DESC LIMIT 1")
      .get(String(fingerprintHash || "").trim());
  }

  buildInstallationResponse(installation) {
    return {
      ok: true,
      install_id: installation.install_id,
      fingerprint_hash: installation.fingerprint_hash,
      trial_started_at: installation.trial_started_at,
      trial_duration_days: Number(installation.trial_duration_days || DEFAULT_TRIAL_DAYS),
      suspicious_reinstall: this.normalizeRiskFlags(safeJsonParse(installation.risk_flags, [])).includes("suspicious_reinstall"),
      status: installation.status,
      risk_flags: this.normalizeRiskFlags(safeJsonParse(installation.risk_flags, [])),
      trial_token: this.signTrialToken({
        install_id: installation.install_id,
        fingerprint_hash: installation.fingerprint_hash,
        trial_started_at: installation.trial_started_at,
        trial_duration_days: Number(installation.trial_duration_days || DEFAULT_TRIAL_DAYS),
        risk_flags: this.normalizeRiskFlags(safeJsonParse(installation.risk_flags, []))
      })
    };
  }

  registerInstallation(payload) {
    const installId = String(payload?.install_id || "").trim();
    const fingerprintHash = String(payload?.fingerprint_hash || "").trim();
    if (!installId || !fingerprintHash) {
      return { ok: false, message: "install_id e fingerprint_hash sao obrigatorios." };
    }

    const explicitFlags = this.normalizeRiskFlags(payload?.risk_flags || []);
    let installation = this.getInstallationByInstallId(installId);
    if (!installation) {
      const byFingerprint = this.getInstallationByFingerprint(fingerprintHash);
      if (byFingerprint && byFingerprint.install_id !== installId) {
        explicitFlags.push("suspicious_reinstall");
        installation = byFingerprint;
      }
    }

    if (installation) {
      const riskFlags = new Set(this.normalizeRiskFlags(safeJsonParse(installation.risk_flags, [])));
      explicitFlags.forEach((flag) => riskFlags.add(flag));
      if (installation.fingerprint_hash !== fingerprintHash) {
        riskFlags.add("hardware_changed");
      }

      this.db.prepare(`
        UPDATE installations
        SET fingerprint_hash = ?, last_seen_at = ?, risk_flags = ?, updated_at = ?
        WHERE id = ?
      `).run(
        fingerprintHash,
        nowIso(),
        JSON.stringify(Array.from(riskFlags)),
        nowIso(),
        installation.id
      );
      installation = this.getInstallationByInstallId(installation.install_id);
      return this.buildInstallationResponse(installation);
    }

    this.db.prepare(`
      INSERT INTO installations (
        install_id, fingerprint_hash, license_id, trial_started_at, trial_duration_days,
        last_seen_at, risk_flags, status, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      installId,
      fingerprintHash,
      nowIso(),
      DEFAULT_TRIAL_DAYS,
      nowIso(),
      JSON.stringify(explicitFlags),
      nowIso(),
      nowIso()
    );

    return this.buildInstallationResponse(this.getInstallationByInstallId(installId));
  }

  heartbeatInstallation(payload) {
    const installId = String(payload?.install_id || "").trim();
    const fingerprintHash = String(payload?.fingerprint_hash || "").trim();
    if (!installId || !fingerprintHash) {
      return { ok: false, message: "install_id e fingerprint_hash sao obrigatorios." };
    }

    const installation = this.getInstallationByInstallId(installId);
    if (!installation) {
      return { ok: false, message: "Instalacao nao encontrada.", should_register: true };
    }

    const riskFlags = new Set(this.normalizeRiskFlags(safeJsonParse(installation.risk_flags, [])));
    if (installation.fingerprint_hash !== fingerprintHash) {
      riskFlags.add("hardware_changed");
    }

    this.db.prepare(`
      UPDATE installations
      SET last_seen_at = ?, risk_flags = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso(), JSON.stringify(Array.from(riskFlags)), nowIso(), installation.id);

    return this.buildInstallationResponse(this.getInstallationByInstallId(installId));
  }

  validateInstallation(payload) {
    const installId = String(payload?.install_id || "").trim();
    if (!installId) {
      return { ok: false, message: "install_id e obrigatorio." };
    }
    const installation = this.getInstallationByInstallId(installId);
    if (!installation) {
      return { ok: false, message: "Instalacao nao encontrada." };
    }
    return this.buildInstallationResponse(installation);
  }

  createInvoiceNumber() {
    const datePart = normalizeDate(nowIso()).replace(/-/g, "");
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM invoices WHERE created_at LIKE ?").get(`${normalizeDate(nowIso())}%`).total || 0;
    return `${this.settings.issuer.invoicePrefix || "FT"}-${datePart}-${String(count + 1).padStart(4, "0")}`;
  }

  async generateInvoicePdf({ user, license, payment, invoiceNumber }) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const blue = rgb(0, 0.25, 0.55);
    let y = 780;

    page.drawText("Fatura de Licenciamento", { x: 50, y, size: 22, font: fontBold, color: blue });
    y -= 40;
    page.drawText(`Número da fatura: ${invoiceNumber}`, { x: 50, y, size: 12, font });
    y -= 22;
    page.drawText(`Data: ${normalizeDate(nowIso())}`, { x: 50, y, size: 12, font });
    y -= 35;
    page.drawText(`Empresa: ${user.empresa}`, { x: 50, y, size: 12, font: fontBold });
    y -= 20;
    page.drawText(`NIF: ${user.nif || "-"}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`E-mail: ${user.email}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Telefone: ${user.telefone || "-"}`, { x: 50, y, size: 12, font });
    y -= 35;

    page.drawText(`Plano: ${license.plan}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Serial: ${license.serial_key}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Validade: ${license.expire_date}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Valor: ${Number(payment.amount || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} Kz`, { x: 50, y, size: 12, font: fontBold });

    const pdfBytes = await pdf.save();
    const target = path.join(this.invoiceDir, `${invoiceNumber}.pdf`);
    fs.writeFileSync(target, pdfBytes);
    return target;
  }

  getSmtpConfig() {
    return this.settings.smtp || {};
  }

  async sendLicenseEmail({ user, license, invoicePath }) {
    const smtp = this.getSmtpConfig();
    if (!smtp.host || !smtp.user || !smtp.password || !smtp.fromEmail) {
      return { ok: false, message: "SMTP do servidor de licenças não configurado." };
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port || 587),
      secure: Boolean(smtp.secure),
      auth: {
        user: smtp.user,
        pass: smtp.password
      }
    });

    const subject = this.settings.issuer.emailSubject || "Sua licença do KwanzaFolha";
    const amount = Number(license.amount || DEFAULT_LICENSE_PLAN.price);
    const normalizedSubject = this.settings.issuer.emailSubject || "Sua licença do KwanzaFolha";
    const text = [
      "Obrigado por adquirir o KwanzaFolha.",
      "",
      `Plano: ${license.plan}`,
      `Valor: ${amount.toLocaleString("pt-PT", { minimumFractionDigits: 2 })} Kz`,
      `Validade: ${license.expire_date}`,
      "",
      "Serial:",
      license.serial_key
    ].join("\n");

    await transporter.sendMail({
      from: `"${smtp.fromName || "Kwanza Folha"}" <${smtp.fromEmail}>`,
      to: user.email,
      subject: normalizedSubject,
      text,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937;">
          <h2 style="color: #0c4da2;">Sua licença do KwanzaFolha</h2>
          <p>Obrigado por adquirir o KwanzaFolha.</p>
          <p><strong>Plano:</strong> ${escapeHtml(license.plan)}</p>
          <p><strong>Valor:</strong> ${amount.toLocaleString("pt-PT", { minimumFractionDigits: 2 })} Kz</p>
          <p><strong>Validade:</strong> ${escapeHtml(license.expire_date)}</p>
          <p><strong>Serial:</strong></p>
          <p style="font-size: 18px; font-weight: 700; color: #0f172a;">${escapeHtml(license.serial_key)}</p>
        </div>
      `,
      attachments: invoicePath
        ? [
            {
              filename: path.basename(invoicePath),
              path: invoicePath
            }
          ]
        : []
    });

    return { ok: true };
  }

  createPayment(payload) {
    if (!this.isCommercialLicensingEnabled()) {
      return { ok: false, message: this.getCommercialLicensingMessage() };
    }

    const plan = this.getPlan(DEFAULT_LICENSE_PLAN.code);
    if (!plan) {
      return { ok: false, message: "Plano inválido." };
    }

    const empresa = String(payload?.empresa || "").trim();
    const nif = String(payload?.nif || "").trim();
    const email = String(payload?.email || "").trim().toLowerCase();
    const telefone = String(payload?.telefone || "").trim();

    if (!empresa || !nif || !email || !telefone) {
      return { ok: false, message: "Empresa, NIF, e-mail e telefone são obrigatórios." };
    }
    if (!isValidEmail(email)) {
      return { ok: false, message: "Indique um e-mail válido." };
    }

    const user = this.upsertCustomer({ empresa, email, telefone, nif });
    const renewal = payload?.renewal ? 1 : 0;
    const serialKey = String(payload?.serial_key || "").trim();
    const reusablePayment = this.findReusablePendingPayment({
      userId: user.id,
      planCode: plan.code,
      renewal,
      serialKey
    });

    if (reusablePayment) {
      return {
        ok: true,
        reference: reusablePayment.reference,
        reference_number: reusablePayment.reference,
        amount: reusablePayment.amount,
        valid_until: reusablePayment.valid_until,
        expiration_time: reusablePayment.valid_until,
        plan: plan.name,
        plan_code: plan.code,
        max_users: plan.maxUsers,
        payment_instructions: resolvePaymentInstructions(this),
        reused: true
      };
    }

    const reference = this.generateReference();
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO payments (user_id, reference, amount, plan, status, valid_until, serial_key, renewal, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(user.id, reference, plan.price, plan.code, validUntil, serialKey, renewal, nowIso());

    return {
      ok: true,
      reference,
      reference_number: reference,
      amount: plan.price,
      valid_until: validUntil,
      expiration_time: validUntil,
      plan: plan.name,
      plan_code: plan.code,
      max_users: plan.maxUsers,
      payment_instructions: resolvePaymentInstructions(this)
    };
  }

  getPaymentByReference(reference) {
    return this.db.prepare(`
      SELECT payments.*, users.empresa, users.email, users.telefone, users.nif
      FROM payments
      INNER JOIN users ON users.id = payments.user_id
      WHERE payments.reference = ?
    `).get(String(reference || "").trim());
  }

  getLicenseBySerial(serialKey) {
    return this.db.prepare("SELECT * FROM licenses WHERE serial_key = ?").get(String(serialKey || "").trim());
  }

  getInvoiceByPaymentId(paymentId) {
    return this.db.prepare("SELECT * FROM invoices WHERE payment_id = ?").get(Number(paymentId || 0));
  }

  findReusablePendingPayment({ userId, planCode, renewal = 0, serialKey = "" }) {
    return this.db.prepare(`
      SELECT payments.*
      FROM payments
      WHERE payments.user_id = ?
        AND payments.plan = ?
        AND payments.status = 'pending'
        AND payments.renewal = ?
        AND COALESCE(payments.serial_key, '') = ?
        AND payments.valid_until >= ?
      ORDER BY payments.created_at DESC, payments.id DESC
      LIMIT 1
    `).get(Number(userId || 0), String(planCode || "").trim(), renewal ? 1 : 0, String(serialKey || "").trim(), nowIso());
  }

  markInvoiceDelivery(invoiceId, payload = {}) {
    this.db.prepare(`
      UPDATE invoices
      SET delivery_status = ?,
          email_sent_at = ?,
          email_attempts = COALESCE(email_attempts, 0) + ?,
          last_email_error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      String(payload.status || "pending").trim(),
      payload.emailSentAt || null,
      Number(payload.attemptIncrement || 0),
      String(payload.lastError || "").trim(),
      nowIso(),
      Number(invoiceId || 0)
    );
    return this.db.prepare("SELECT * FROM invoices WHERE id = ?").get(Number(invoiceId || 0));
  }

  runDbTransaction(work) {
    return this.db.transaction(work)();
  }

  confirmPaymentCore(reference) {
    const normalizedReference = String(reference || "").trim();

    try {
      const core = this.runDbTransaction(() => {
        const payment = this.getPaymentByReference(normalizedReference);
        if (!payment) {
          throw new Error("Pagamento não encontrado.");
        }

        const plan = this.getPlan(payment.plan);
        if (!plan) {
          throw new Error("Plano do pagamento inválido.");
        }

        const user = this.getUserByEmail(payment.email);
        if (!user) {
          throw new Error("Cliente do pagamento não encontrado.");
        }

        const today = normalizeDate(nowIso());
        let license = payment.serial_key ? this.getLicenseBySerial(payment.serial_key) : null;

        if (payment.status !== "paid") {
          if (payment.renewal && payment.serial_key) {
            const currentLicense = this.getLicenseBySerial(payment.serial_key);
            if (!currentLicense || Number(currentLicense.user_id) !== Number(user.id)) {
              throw new Error("A licença a renovar não foi encontrada.");
            }

            const nextStart =
              today > normalizeDate(currentLicense.expire_date)
                ? today
                : normalizeDate(currentLicense.expire_date);
            const nextExpire = addDays(nextStart, plan.periodDays);
            this.db.prepare(`
              UPDATE licenses
              SET plan = ?, max_users = ?, start_date = ?, expire_date = ?, status = 'active', updated_at = ?
              WHERE id = ?
            `).run(plan.code, plan.maxUsers, nextStart, nextExpire, nowIso(), currentLicense.id);
            license = this.db.prepare("SELECT * FROM licenses WHERE id = ?").get(currentLicense.id);
          } else {
            const serialKey = this.generateSerialKey(user.id);
            const expireDate = addDays(today, plan.periodDays);
            const insert = this.db.prepare(`
              INSERT INTO licenses (user_id, serial_key, plan, max_users, start_date, expire_date, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
            `).run(user.id, serialKey, plan.code, plan.maxUsers, today, expireDate, nowIso(), nowIso());
            license = this.db.prepare("SELECT * FROM licenses WHERE id = ?").get(insert.lastInsertRowid);
          }

          this.db.prepare("UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, ?), serial_key = ? WHERE id = ?").run(
            nowIso(),
            license.serial_key,
            payment.id
          );
        }

        if (!license && payment.serial_key) {
          license = this.getLicenseBySerial(payment.serial_key);
        }

        if (!license) {
          throw new Error("A licença associada a este pagamento não foi encontrada.");
        }

        let invoice = this.getInvoiceByPaymentId(payment.id);
        if (!invoice) {
          const invoiceNumber = this.createInvoiceNumber();
          const invoicePath = path.join(this.invoiceDir, `${invoiceNumber}.pdf`);
          const createdAt = nowIso();
          const insert = this.db.prepare(`
            INSERT INTO invoices (
              user_id, license_id, invoice_number, amount, pdf_path, created_at, payment_id,
              delivery_status, email_sent_at, email_attempts, last_email_error, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, '', ?)
          `).run(user.id, license.id, invoiceNumber, payment.amount, invoicePath, createdAt, payment.id, createdAt);
          invoice = this.db.prepare("SELECT * FROM invoices WHERE id = ?").get(insert.lastInsertRowid);
        }

        return {
          payment: this.getPaymentByReference(normalizedReference),
          user,
          plan,
          license,
          invoice
        };
      });

      return { ok: true, ...core };
    } catch (error) {
      return { ok: false, message: error.message || "Não foi possível confirmar o pagamento." };
    }
  }

  async ensureInvoicePdfArtifact({ user, license, payment, plan, invoice }) {
    const targetPath = String(invoice?.pdf_path || "").trim() || path.join(this.invoiceDir, `${invoice.invoice_number}.pdf`);
    if (targetPath && fs.existsSync(targetPath)) {
      return { ok: true, path: targetPath, generated: false };
    }

    try {
      const generatedPath = await this.generateInvoicePdf({
        user,
        license: {
          ...license,
          plan: plan.name,
          amount: payment.amount
        },
        payment,
        invoiceNumber: invoice.invoice_number
      });

      if (generatedPath !== invoice.pdf_path) {
        this.db.prepare("UPDATE invoices SET pdf_path = ?, updated_at = ? WHERE id = ?").run(generatedPath, nowIso(), invoice.id);
      }

      return { ok: true, path: generatedPath, generated: true };
    } catch (error) {
      return { ok: false, message: error.message || "Não foi possível gerar a fatura." };
    }
  }

  async ensureInvoiceEmailDelivery({ user, license, payment, plan, invoice, invoicePath }) {
    if (String(invoice?.email_sent_at || "").trim()) {
      return { ok: true, skipped: true, message: "" };
    }

    try {
      const result = await this.sendLicenseEmail({
        user,
        license: {
          ...license,
          plan: plan.name,
          amount: payment.amount
        },
        invoicePath
      });
      const updatedInvoice = this.markInvoiceDelivery(invoice.id, {
        status: result?.ok ? "sent" : "pending",
        emailSentAt: result?.ok ? nowIso() : null,
        attemptIncrement: 1,
        lastError: result?.ok ? "" : result?.message || ""
      });
      return {
        ok: Boolean(result?.ok),
        message: result?.message || "",
        invoice: updatedInvoice
      };
    } catch (error) {
      const updatedInvoice = this.markInvoiceDelivery(invoice.id, {
        status: "pending",
        emailSentAt: null,
        attemptIncrement: 1,
        lastError: error.message || "Falha ao enviar o e-mail da licença."
      });
      return { ok: false, message: error.message || "Falha ao enviar o e-mail da licença.", invoice: updatedInvoice };
    }
  }

  async confirmPaymentLegacy(reference) {
    if (!this.isCommercialLicensingEnabled()) {
      return { ok: false, message: this.getCommercialLicensingMessage() };
    }

    const payment = this.getPaymentByReference(reference);
    if (!payment) {
      return { ok: false, message: "Pagamento não encontrado." };
    }

    if (payment.status === "paid") {
      const existingLicense = payment.serial_key ? this.getLicenseBySerial(payment.serial_key) : null;
      return {
        ok: true,
        reference: payment.reference,
        status: "paid",
        serial_key: existingLicense?.serial_key || payment.serial_key || "",
        expire_date: existingLicense?.expire_date || null
      };
    }

    const plan = this.getPlan(payment.plan);
    if (!plan) {
      return { ok: false, message: "Plano do pagamento inválido." };
    }

    const today = normalizeDate(nowIso());
    const user = this.getUserByEmail(payment.email);
    let license = null;

    if (payment.renewal && payment.serial_key) {
      const currentLicense = this.getLicenseBySerial(payment.serial_key);
      if (!currentLicense || Number(currentLicense.user_id) !== Number(user.id)) {
        return { ok: false, message: "A licença a renovar não foi encontrada." };
      }

      const nextStart = today > normalizeDate(currentLicense.expire_date) ? today : normalizeDate(currentLicense.expire_date);
      const nextExpire = addDays(nextStart, plan.periodDays);
      this.db.prepare(`
        UPDATE licenses
        SET plan = ?, max_users = ?, start_date = ?, expire_date = ?, status = 'active', updated_at = ?
        WHERE id = ?
      `).run(plan.code, plan.maxUsers, nextStart, nextExpire, nowIso(), currentLicense.id);
      license = this.db.prepare("SELECT * FROM licenses WHERE id = ?").get(currentLicense.id);
    } else {
      const serialKey = this.generateSerialKey(user.id);
      const expireDate = addDays(today, plan.periodDays);
      const insert = this.db.prepare(`
        INSERT INTO licenses (user_id, serial_key, plan, max_users, start_date, expire_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(user.id, serialKey, plan.code, plan.maxUsers, today, expireDate, nowIso(), nowIso());
      license = this.db.prepare("SELECT * FROM licenses WHERE id = ?").get(insert.lastInsertRowid);
    }

    this.db.prepare("UPDATE payments SET status = 'paid', paid_at = ?, serial_key = ? WHERE id = ?").run(
      nowIso(),
      license.serial_key,
      payment.id
    );

    const invoiceNumber = this.createInvoiceNumber();
    const invoicePath = await this.generateInvoicePdf({
      user,
      license: {
        ...license,
        plan: plan.name,
        amount: payment.amount
      },
      payment,
      invoiceNumber
    });

    this.db.prepare(`
      INSERT INTO invoices (user_id, license_id, invoice_number, amount, pdf_path, created_at, payment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, license.id, invoiceNumber, payment.amount, invoicePath, nowIso(), payment.id);

    const emailResult = await this.sendLicenseEmail({
      user,
      license: {
        ...license,
        plan: plan.name,
        amount: payment.amount
      },
      invoicePath
    });

    return {
      ok: true,
      reference: payment.reference,
      status: "paid",
      serial_key: license.serial_key,
      expire_date: license.expire_date,
      invoice_number: invoiceNumber,
      invoice_path: invoicePath,
      email_sent: Boolean(emailResult.ok),
      email_message: emailResult.message || ""
    };
  }

  async confirmPayment(reference) {
    if (!this.isCommercialLicensingEnabled()) {
      return { ok: false, message: this.getCommercialLicensingMessage() };
    }

    const core = this.confirmPaymentCore(reference);
    if (!core.ok) {
      return core;
    }

    const pdfResult = await this.ensureInvoicePdfArtifact(core);
    const invoicePath = pdfResult.ok ? pdfResult.path : String(core.invoice?.pdf_path || "").trim();
    const emailResult = pdfResult.ok
      ? await this.ensureInvoiceEmailDelivery({ ...core, invoicePath })
      : {
          ok: false,
          message: pdfResult.message || "Não foi possível gerar a fatura da licença.",
          invoice: core.invoice
        };
    const refreshedInvoice = this.getInvoiceByPaymentId(core.payment.id) || core.invoice;

    return {
      ok: true,
      reference: core.payment.reference,
      status: "paid",
      serial_key: core.license.serial_key,
      expire_date: core.license.expire_date,
      invoice_number: refreshedInvoice?.invoice_number || core.invoice?.invoice_number || "",
      invoice_path: refreshedInvoice?.pdf_path || invoicePath || "",
      invoice_ready: Boolean(pdfResult.ok && (invoicePath || refreshedInvoice?.pdf_path)),
      email_sent: Boolean(emailResult.ok),
      email_message: emailResult.message || ""
    };
  }

  getPaymentStatus(reference) {
    const payment = this.getPaymentByReference(reference);
    if (!payment) {
      return { ok: false, message: "Pagamento não encontrado." };
    }

    let expireDate = null;
    let serialKey = payment.serial_key || "";
    if (payment.serial_key) {
      const license = this.getLicenseBySerial(payment.serial_key);
      expireDate = license?.expire_date || null;
      serialKey = license?.serial_key || serialKey;
    }

    return {
      ok: true,
      reference: payment.reference,
      amount: payment.amount,
      status: payment.status,
      valid_until: payment.valid_until,
      serial_key: serialKey,
      expire_date: expireDate,
      plan: payment.plan,
      payment_instructions: resolvePaymentInstructions(this)
    };
  }

  cancelPayment(reference) {
    const payment = this.getPaymentByReference(reference);
    if (!payment) {
      return { ok: false, message: "Pagamento nÃ£o encontrado." };
    }

    if (payment.status === "paid") {
      return { ok: false, message: "NÃ£o Ã© possÃ­vel cancelar um pagamento que jÃ¡ foi confirmado." };
    }

    if (payment.status === "cancelled") {
      return {
        ok: true,
        reference: payment.reference,
        status: "cancelled",
        message: "O pagamento jÃ¡ estava cancelado."
      };
    }

    this.db.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ?").run(payment.id);
    return {
      ok: true,
      reference: payment.reference,
      status: "cancelled",
      message: "Pagamento cancelado com sucesso."
    };
  }

  validateWebhookRequest(request, payload) {
    const webhook = this.getWebhookSettings();
    if (!webhook.secret) {
      return { ok: true };
    }

    const authorization = String(request?.headers?.authorization || "").trim();
    const bearerToken = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    const providedSecret = firstNonEmpty(
      request?.headers?.["x-kwanza-webhook-secret"],
      request?.headers?.["x-webhook-secret"],
      bearerToken,
      payload?.secret
    );

    if (!providedSecret || providedSecret !== webhook.secret) {
      return { ok: false, message: "Webhook nÃ£o autorizado." };
    }

    return { ok: true };
  }

  parseWebhookAmount(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    const normalized = String(value).trim().replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  normalizeWebhookStatus(...values) {
    const raw = firstNonEmpty(...values).toLowerCase();
    if (!raw) {
      return "";
    }

    const compact = raw.replace(/[\s-]+/g, "_");
    if (
      compact.includes("paid") ||
      compact.includes("confirm") ||
      compact.includes("success") ||
      compact.includes("complete") ||
      compact.includes("approved")
    ) {
      return "paid";
    }

    if (
      compact.includes("cancel") ||
      compact.includes("fail") ||
      compact.includes("expire") ||
      compact.includes("reject") ||
      compact.includes("void")
    ) {
      return "cancelled";
    }

    if (compact.includes("pending") || compact.includes("wait")) {
      return "pending";
    }

    return compact;
  }

  normalizeWebhookPayload(payload) {
    const root = payload && typeof payload === "object" ? payload : {};
    const data = root.data && typeof root.data === "object" ? root.data : {};
    const payment = root.payment && typeof root.payment === "object" ? root.payment : {};
    const dataPayment = data.payment && typeof data.payment === "object" ? data.payment : {};
    const transaction = root.transaction && typeof root.transaction === "object" ? root.transaction : {};
    const dataTransaction = data.transaction && typeof data.transaction === "object" ? data.transaction : {};
    const metadata = root.metadata && typeof root.metadata === "object" ? root.metadata : {};
    const dataMetadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};

    return {
      reference: firstNonEmpty(
        root.reference,
        root.reference_number,
        root.payment_reference,
        root.paymentRef,
        root.order_reference,
        root.order_id,
        root.external_reference,
        root.external_id,
        data.reference,
        data.reference_number,
        data.payment_reference,
        data.order_reference,
        data.order_id,
        payment.reference,
        payment.reference_number,
        payment.order_reference,
        payment.external_reference,
        transaction.reference,
        transaction.reference_number,
        transaction.order_reference,
        dataPayment.reference,
        dataPayment.reference_number,
        dataTransaction.reference,
        dataTransaction.reference_number,
        metadata.reference,
        metadata.reference_number,
        metadata.payment_reference,
        metadata.order_reference,
        dataMetadata.reference,
        dataMetadata.reference_number,
        dataMetadata.payment_reference
      ),
      status: this.normalizeWebhookStatus(
        root.status,
        root.payment_status,
        root.event_status,
        root.event,
        root.event_name,
        root.type,
        data.status,
        data.payment_status,
        data.event,
        data.event_name,
        data.type,
        payment.status,
        payment.event,
        transaction.status,
        transaction.event,
        dataPayment.status,
        dataTransaction.status
      ),
      rawStatus: firstNonEmpty(
        root.status,
        root.payment_status,
        root.event_status,
        root.event,
        root.event_name,
        root.type,
        data.status,
        data.payment_status,
        data.event,
        data.event_name,
        data.type,
        payment.status,
        payment.event,
        transaction.status,
        transaction.event,
        dataPayment.status,
        dataTransaction.status
      ),
      amount: this.parseWebhookAmount(firstNonEmpty(
        root.amount,
        root.amount_paid,
        root.payment_amount,
        data.amount,
        data.amount_paid,
        payment.amount,
        payment.amount_paid,
        transaction.amount,
        transaction.amount_paid,
        dataPayment.amount,
        dataTransaction.amount,
        metadata.amount,
        dataMetadata.amount
      )),
      currency: firstNonEmpty(
        root.currency,
        data.currency,
        payment.currency,
        transaction.currency,
        dataPayment.currency,
        dataTransaction.currency,
        metadata.currency
      ),
      provider: firstNonEmpty(
        root.provider,
        root.gateway,
        data.provider,
        data.gateway,
        payment.provider,
        transaction.provider
      )
    };
  }

  async handlePaymentWebhook(request, payload) {
    const auth = this.validateWebhookRequest(request, payload);
    if (!auth.ok) {
      return { ok: false, httpStatus: 401, message: auth.message };
    }

    const webhook = this.getWebhookSettings();
    const normalized = this.normalizeWebhookPayload(payload);

    if (!normalized.reference) {
      return { ok: false, httpStatus: 400, message: "A referÃªncia do pagamento Ã© obrigatÃ³ria no webhook." };
    }

    const payment = this.getPaymentByReference(normalized.reference);
    if (!payment) {
      return { ok: false, httpStatus: 404, message: "Pagamento nÃ£o encontrado." };
    }

    if (
      webhook.requireAmountMatch &&
      normalized.amount !== null &&
      Math.abs(Number(payment.amount || 0) - Number(normalized.amount || 0)) > 0.009
    ) {
      return {
        ok: false,
        httpStatus: 409,
        reference: normalized.reference,
        expected_amount: Number(payment.amount || 0),
        received_amount: normalized.amount,
        message: "O valor recebido no webhook nÃ£o corresponde ao pagamento registado."
      };
    }

    if (!normalized.status) {
      return {
        ok: true,
        httpStatus: 200,
        status: "ignored",
        reference: normalized.reference,
        message: "Webhook recebido sem estado de pagamento. Nenhuma aÃ§Ã£o foi executada."
      };
    }

    if (webhook.paidStatuses.includes(normalized.status)) {
      const result = await this.confirmPayment(normalized.reference);
      return {
        ...result,
        httpStatus: result.ok ? 200 : 404,
        webhook_status: normalized.status,
        webhook_provider: normalized.provider || webhook.provider || "generic",
        expected_amount: Number(payment.amount || 0),
        received_amount: normalized.amount
      };
    }

    if (webhook.cancelledStatuses.includes(normalized.status)) {
      const result = this.cancelPayment(normalized.reference);
      return {
        ...result,
        httpStatus: result.ok ? 200 : 404,
        webhook_status: normalized.status,
        webhook_provider: normalized.provider || webhook.provider || "generic",
        expected_amount: Number(payment.amount || 0),
        received_amount: normalized.amount
      };
    }

    return {
      ok: true,
      httpStatus: 200,
      status: "ignored",
      reference: normalized.reference,
      webhook_status: normalized.status,
      webhook_raw_status: normalized.rawStatus,
      webhook_provider: normalized.provider || webhook.provider || "generic",
      expected_amount: Number(payment.amount || 0),
      received_amount: normalized.amount,
      message: `Webhook recebido com o estado '${normalized.status}' sem aÃ§Ã£o automÃ¡tica configurada.`
    };
  }

  activateLicense(payload) {
    const email = String(payload?.email || "").trim().toLowerCase();
    const serialKey = String(payload?.serial_key || "").trim();
    const deviceHash = String(payload?.device_hash || "").trim();
    const installId = String(payload?.install_id || "").trim();
    const fingerprintHash = String(payload?.fingerprint_hash || "").trim();
    const hardwareSnapshot =
      payload?.hardware_snapshot && typeof payload.hardware_snapshot === "object" ? payload.hardware_snapshot : null;

    if (!email || !serialKey || !deviceHash) {
      return { ok: false, message: "E-mail, serial e dispositivo são obrigatórios para ativação." };
    }

    const user = this.getUserByEmail(email);
    if (!user) {
      return { ok: false, message: "Cliente não encontrado." };
    }

    const license = this.getLicenseBySerial(serialKey);
    if (!license || Number(license.user_id) !== Number(user.id)) {
      return { ok: false, message: "A licença indicada não existe para este e-mail." };
    }

    if (license.status !== "active") {
      return { ok: false, message: "A licença não está ativa." };
    }

    if (normalizeDate(nowIso()) > normalizeDate(license.expire_date)) {
      this.db.prepare("UPDATE licenses SET status = 'expired', updated_at = ? WHERE id = ?").run(nowIso(), license.id);
      return { ok: false, message: "A licença indicada expirou." };
    }

    const existingDevice = this.db.prepare("SELECT * FROM devices WHERE license_id = ?").get(license.id);
    if (existingDevice && existingDevice.device_hash !== deviceHash) {
      return { ok: false, message: "Esta licença já está associada a outro dispositivo." };
    }

    if (existingDevice) {
      this.db.prepare(`
        UPDATE devices
        SET device_name = ?, app_version = ?, last_seen_at = ?
        WHERE id = ?
      `).run(String(payload?.device_name || os.hostname()), String(payload?.app_version || ""), nowIso(), existingDevice.id);
    } else {
      this.db.prepare(`
        INSERT INTO devices (license_id, device_hash, device_name, app_version, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        license.id,
        deviceHash,
        String(payload?.device_name || os.hostname()),
        String(payload?.app_version || ""),
        nowIso(),
        nowIso()
      );
    }

    if (installId) {
      const installation = this.getInstallationByInstallId(installId) || this.getInstallationByFingerprint(fingerprintHash);
      if (installation) {
        const riskFlags = new Set(this.normalizeRiskFlags(safeJsonParse(installation.risk_flags, [])));
        if (installation.fingerprint_hash && fingerprintHash && installation.fingerprint_hash !== fingerprintHash) {
          riskFlags.add("hardware_changed");
        }
        this.db.prepare(`
          UPDATE installations
          SET fingerprint_hash = ?, license_id = ?, last_seen_at = ?, risk_flags = ?, updated_at = ?
          WHERE id = ?
        `).run(
          fingerprintHash || installation.fingerprint_hash,
          license.id,
          nowIso(),
          JSON.stringify(Array.from(riskFlags)),
          nowIso(),
          installation.id
        );
      } else {
        this.db.prepare(`
          INSERT INTO installations (
            install_id, fingerprint_hash, license_id, trial_started_at, trial_duration_days,
            last_seen_at, risk_flags, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?)
        `).run(
          installId,
          fingerprintHash || sha256(deviceHash),
          license.id,
          nowIso(),
          DEFAULT_TRIAL_DAYS,
          nowIso(),
          nowIso(),
          nowIso()
        );
      }
    }

    const plan = this.getPlan(license.plan);
    const tokenPayload = {
      license_id: license.id,
      serial_key: license.serial_key,
      plan: plan?.name || license.plan,
      max_users: license.max_users,
      start_date: license.start_date,
      expire_date: license.expire_date,
      status: license.status,
      email: user.email,
      company_name: user.empresa,
      device_hash: deviceHash,
      install_id: installId,
      fingerprint_hash: fingerprintHash,
      hardware_snapshot: hardwareSnapshot,
      issued_at: nowIso()
    };
    const token = this.signLicenseToken(tokenPayload);

    return {
      ok: true,
      license_token: token,
      expire_date: license.expire_date,
      plan: plan?.name || license.plan,
      max_users: license.max_users,
      serial_key: license.serial_key
    };
  }

  renderAdminDashboard() {
    const stats = {
      clients: this.db.prepare("SELECT COUNT(*) AS total FROM users").get().total,
      activeLicenses: this.db.prepare("SELECT COUNT(*) AS total FROM licenses WHERE status = 'active'").get().total,
      expiredLicenses: this.db.prepare("SELECT COUNT(*) AS total FROM licenses WHERE status = 'expired'").get().total,
      paidPayments: this.db.prepare("SELECT COUNT(*) AS total FROM payments WHERE status = 'paid'").get().total
    };

    const pendingPayments = this.db.prepare(`
      SELECT payments.reference, payments.amount, payments.plan, payments.created_at, users.empresa, users.email
      FROM payments
      INNER JOIN users ON users.id = payments.user_id
      WHERE payments.status = 'pending'
      ORDER BY payments.created_at DESC
    `).all();

    const licenses = this.db.prepare(`
      SELECT licenses.serial_key, licenses.plan, licenses.expire_date, licenses.status, users.empresa, users.email
      FROM licenses
      INNER JOIN users ON users.id = licenses.user_id
      ORDER BY licenses.updated_at DESC
      LIMIT 30
    `).all();

    const devices = this.db.prepare(`
      SELECT devices.device_name, devices.device_hash, devices.app_version, devices.last_seen_at, licenses.serial_key, users.empresa
      FROM devices
      INNER JOIN licenses ON licenses.id = devices.license_id
      INNER JOIN users ON users.id = licenses.user_id
      ORDER BY devices.last_seen_at DESC
      LIMIT 30
    `).all();

    return `
      <!DOCTYPE html>
      <html lang="pt">
        <head>
          <meta charset="utf-8" />
          <title>Painel Kwanza Folha</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; margin: 0; background: #f4f7fb; color: #1f2937; }
            header { background: #0c2f63; color: white; padding: 24px 32px; }
            main { padding: 24px 32px; display: grid; gap: 24px; }
            .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
            .card { background: white; border-radius: 18px; padding: 18px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
            h2 { margin: 0 0 16px 0; color: #0c2f63; }
            table { width: 100%; border-collapse: collapse; }
            th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
            th { color: #475569; }
            form { margin: 0; }
            button { background: #2563eb; color: white; border: 0; border-radius: 10px; padding: 8px 12px; cursor: pointer; }
            small { color: #64748b; }
          </style>
        </head>
        <body>
          <header>
            <h1>Painel Administrativo do Licenciamento</h1>
            <small>Clientes, licenças, pagamentos e dispositivos do Kwanza Folha</small>
          </header>
          <main>
            <section class="stats">
              <div class="card"><strong>Clientes</strong><div>${stats.clients}</div></div>
              <div class="card"><strong>Licenças ativas</strong><div>${stats.activeLicenses}</div></div>
              <div class="card"><strong>Licenças expiradas</strong><div>${stats.expiredLicenses}</div></div>
              <div class="card"><strong>Pagamentos recebidos</strong><div>${stats.paidPayments}</div></div>
            </section>

            <section class="card">
              <h2>Pagamentos pendentes</h2>
              <table>
                <thead><tr><th>Empresa</th><th>E-mail</th><th>Plano</th><th>Valor</th><th>Referência</th><th>Ação</th></tr></thead>
                <tbody>
                  ${pendingPayments.map((payment) => `
                    <tr>
                      <td>${escapeHtml(payment.empresa)}</td>
                      <td>${escapeHtml(payment.email)}</td>
                      <td>${escapeHtml(payment.plan)}</td>
                      <td>${Number(payment.amount).toLocaleString("pt-PT")} Kz</td>
                      <td>${escapeHtml(payment.reference)}</td>
                      <td>
                        <form method="post" action="/admin/payment/confirm">
                          <input type="hidden" name="reference" value="${escapeHtml(payment.reference)}" />
                          <button type="submit">Confirmar pagamento</button>
                        </form>
                      </td>
                    </tr>
                  `).join("") || '<tr><td colspan="6">Sem pagamentos pendentes.</td></tr>'}
                </tbody>
              </table>
            </section>

            <section class="card">
              <h2>Licenças</h2>
              <table>
                <thead><tr><th>Empresa</th><th>E-mail</th><th>Serial</th><th>Plano</th><th>Validade</th><th>Estado</th></tr></thead>
                <tbody>
                  ${licenses.map((license) => `
                    <tr>
                      <td>${escapeHtml(license.empresa)}</td>
                      <td>${escapeHtml(license.email)}</td>
                      <td>${escapeHtml(license.serial_key)}</td>
                      <td>${escapeHtml(license.plan)}</td>
                      <td>${escapeHtml(license.expire_date)}</td>
                      <td>${escapeHtml(license.status)}</td>
                    </tr>
                  `).join("") || '<tr><td colspan="6">Sem licenças registadas.</td></tr>'}
                </tbody>
              </table>
            </section>

            <section class="card">
              <h2>Dispositivos registados</h2>
              <table>
                <thead><tr><th>Empresa</th><th>Serial</th><th>Dispositivo</th><th>Versão</th><th>Último acesso</th></tr></thead>
                <tbody>
                  ${devices.map((device) => `
                    <tr>
                      <td>${escapeHtml(device.empresa)}</td>
                      <td>${escapeHtml(device.serial_key)}</td>
                      <td>${escapeHtml(device.device_name)}</td>
                      <td>${escapeHtml(device.app_version || "-")}</td>
                      <td>${escapeHtml(device.last_seen_at)}</td>
                    </tr>
                  `).join("") || '<tr><td colspan="5">Sem dispositivos registados.</td></tr>'}
                </tbody>
              </table>
            </section>
          </main>
        </body>
      </html>
    `;
  }

  getForwardedProto(request) {
    return String(request?.headers?.["x-forwarded-proto"] || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .find(Boolean);
  }

  isRequestSecure(request) {
    if (request?.socket?.encrypted) {
      return true;
    }
    return this.getForwardedProto(request) === "https";
  }

  async handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathName = url.pathname;
    const adminRoute = pathName === "/admin" || pathName === "/admin/payment/confirm";
    const sensitiveRoute = adminRoute || [
      "/install/register",
      "/install/heartbeat",
      "/install/validate",
      "/payment/create",
      "/payment/status",
      "/payment/webhook",
      "/payment/confirm",
      "/license/activate"
    ].includes(pathName);

    if (pathName !== "/health" && this.runtimeRequireHttps && !this.isRequestSecure(request)) {
      sendJson(response, 426, {
        ok: false,
        message:
          "Este endpoint exige HTTPS. Aceda por https://license.alvesestudio.ao ou configure o proxy com x-forwarded-proto=https."
      });
      return;
    }

    if (sensitiveRoute) {
      const scope = adminRoute ? "admin" : "sensitive";
      if (!this.consumeRateLimit(scope, request, response)) {
        return;
      }
    }

    if (request.method === "GET" && pathName === "/health") {
      sendJson(response, 200, { ok: true, status: "up" });
      return;
    }

    if (request.method === "GET" && pathName === "/plans") {
      sendJson(response, 200, {
        ok: true,
        plans: LICENSE_PLANS,
        sales_enabled: this.isCommercialLicensingEnabled(),
        payment_instructions: this.getPaymentInstructions()
      });
      return;
    }

    if (adminRoute) {
      const auth = this.authenticateAdminRequest(request);
      if (!auth.ok) {
        this.sendAdminUnauthorized(response, auth.message);
        return;
      }
    }

    if (request.method === "GET" && pathName === "/admin") {
      sendHtml(response, this.renderAdminDashboard());
      return;
    }

    if (request.method === "POST" && pathName === "/admin/payment/confirm") {
      const body = await this.parseBody(request);
      await this.confirmPayment(body.reference);
      redirect(response, "/admin");
      return;
    }

    if (request.method === "POST" && pathName === "/payment/create") {
      const body = await this.parseBody(request);
      sendJson(response, 200, this.createPayment(body));
      return;
    }

    if (request.method === "POST" && pathName === "/payment/status") {
      const body = await this.parseBody(request);
      sendJson(response, 200, this.getPaymentStatus(body.reference));
      return;
    }

    if (request.method === "POST" && pathName === "/payment/confirm") {
      sendJson(response, 403, {
        ok: false,
        message: "O endpoint público de confirmação manual foi desativado. Use o webhook autenticado ou o painel administrativo protegido."
      });
      return;
    }

    if (request.method === "POST" && pathName === "/payment/webhook") {
      const body = await this.parseBody(request);
      const result = await this.handlePaymentWebhook(request, body);
      sendJson(response, result.httpStatus || (result.ok ? 200 : 400), result);
      return;
    }

    if (request.method === "POST" && pathName === "/install/register") {
      const body = await this.parseBody(request);
      sendJson(response, 200, this.registerInstallation(body));
      return;
    }

    if (request.method === "POST" && pathName === "/install/heartbeat") {
      const body = await this.parseBody(request);
      sendJson(response, 200, this.heartbeatInstallation(body));
      return;
    }

    if (request.method === "POST" && pathName === "/install/validate") {
      const body = await this.parseBody(request);
      sendJson(response, 200, this.validateInstallation(body));
      return;
    }

    if (request.method === "POST" && pathName === "/license/activate") {
      const body = await this.parseBody(request);
      sendJson(response, 200, this.activateLicense(body));
      return;
    }

    sendJson(response, 404, { ok: false, message: "Endpoint não encontrado." });
  }

  createHttpHandler() {
    return (request, response) => {
      this.handleRequest(request, response).catch((error) => {
        sendJson(response, 500, { ok: false, message: error.message || "Erro interno do servidor." });
      });
    };
  }

  resolveHttpsOptions() {
    const httpsSettings = this.settings.https || {};
    if (!httpsSettings.enabled) {
      return null;
    }

    const keyPath = path.resolve(this.rootDir, httpsSettings.keyPath || "");
    const certPath = path.resolve(this.rootDir, httpsSettings.certPath || "");
    if (!keyPath || !certPath || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      return null;
    }

    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  }

  listen() {
    const host = this.settings.server?.host || "127.0.0.1";
    const runtimePort = Number(process.env.PORT || this.settings.server?.port || 3055);
    const port = Number.isFinite(runtimePort) && runtimePort > 0 ? runtimePort : 3055;
    const httpsOptions = this.resolveHttpsOptions();
    const security = this.getSecuritySettings();
    const allowHttpBypass = process.env.KWANZA_ALLOW_HTTP === "1";
    const allowHttpBehindProxy =
      security.allowHttpBehindProxy === true || process.env.KWANZA_ALLOW_HTTP_BEHIND_PROXY === "1";
    this.runtimeRequireHttps = security.requireHttps !== false && !allowHttpBypass;
    this.runtimeHttpsEnabled = Boolean(httpsOptions);
    this.runtimeAllowHttpBehindProxy = allowHttpBehindProxy;

    if (this.runtimeRequireHttps && !httpsOptions && !allowHttpBehindProxy) {
      throw new Error(
        "HTTPS obrigatório para o servidor de licenciamento. Configure https.keyPath/certPath ou ative allowHttpBehindProxy=true com proxy reverso HTTPS."
      );
    }

    this.getPrivateKeyMaterial();

    const protocol = httpsOptions ? "https" : "http";
    const server = httpsOptions
      ? https.createServer(httpsOptions, this.createHttpHandler())
      : http.createServer(this.createHttpHandler());

    server.listen(port, host, () => {
      if (this.runtimeRequireHttps && !httpsOptions && allowHttpBehindProxy) {
        console.warn(
          "Licensing server em HTTP interno; HTTPS exigido no edge proxy (x-forwarded-proto=https)."
        );
      }
      console.log(`Licensing server listening on ${protocol}://${host}:${port}`);
    });
  }
}

if (require.main === module) {
  new LicensingServer().listen();
}

module.exports = {
  LicensingServer
};
