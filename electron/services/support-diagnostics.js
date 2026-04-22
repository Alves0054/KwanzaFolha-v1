const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function sanitizeDetails(details = {}) {
  const blockedKeys = new Set([
    "password",
    "token",
    "secret",
    "certificate",
    "privateKey",
    "license_token"
  ]);

  const visit = (value) => {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => visit(entry));
    }

    const sanitized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (blockedKeys.has(String(key || "").trim())) {
        sanitized[key] = "[REDACTED]";
        continue;
      }
      sanitized[key] = visit(nestedValue);
    }
    return sanitized;
  };

  return visit(details);
}

function copyIfExists(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

class SupportDiagnosticsService {
  constructor({
    userDataPath,
    logsPath,
    appName = "Kwanza Folha",
    appVersion = ""
  }) {
    this.userDataPath = userDataPath;
    this.logsPath = logsPath;
    this.appName = appName;
    this.appVersion = appVersion;
    this.diagnosticsRoot = path.join(this.userDataPath, "Diagnostico");
    this.supportRoot = path.join(this.diagnosticsRoot, "Suporte");
    this.crashRoot = path.join(this.diagnosticsRoot, "CrashReports");
    this.eventsPath = path.join(this.logsPath, "operations-events.jsonl");
    ensureDir(this.logsPath);
    ensureDir(this.diagnosticsRoot);
    ensureDir(this.supportRoot);
    ensureDir(this.crashRoot);
  }

  recordEvent({
    level = "info",
    category = "system",
    event = "event",
    message = "",
    details = {}
  }) {
    const entry = {
      id: crypto.randomUUID(),
      at: nowIso(),
      level: String(level || "info").trim().toLowerCase(),
      category: String(category || "system").trim().toLowerCase(),
      event: String(event || "event").trim(),
      message: String(message || "").trim(),
      details: sanitizeDetails(details)
    };
    fs.appendFileSync(this.eventsPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  recordCrash(scope, error, details = {}) {
    const stamp = nowIso().replace(/[:.]/g, "-");
    const filePath = path.join(this.crashRoot, `crash-${scope}-${stamp}.json`);
    const payload = {
      appName: this.appName,
      appVersion: this.appVersion,
      scope: String(scope || "unknown"),
      at: nowIso(),
      error: {
        message: String(error?.message || error || "").trim(),
        stack: String(error?.stack || "").trim(),
        name: String(error?.name || "").trim()
      },
      details: sanitizeDetails(details)
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    this.recordEvent({
      level: "error",
      category: "crash",
      event: `crash.${scope}`,
      message: payload.error.message || "Erro inesperado.",
      details: {
        reportPath: filePath
      }
    });
    return filePath;
  }

  buildHealthSnapshot(extra = {}) {
    let pendingEvents = 0;
    if (fs.existsSync(this.eventsPath)) {
      pendingEvents = fs
        .readFileSync(this.eventsPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim()).length;
    }

    const crashReports = fs.existsSync(this.crashRoot)
      ? fs.readdirSync(this.crashRoot).filter((name) => name.endsWith(".json")).length
      : 0;

    return {
      ok: true,
      appName: this.appName,
      appVersion: this.appVersion,
      generatedAt: nowIso(),
      supportRoot: this.supportRoot,
      crashRoot: this.crashRoot,
      eventsPath: this.eventsPath,
      eventsCount: pendingEvents,
      crashReports,
      ...sanitizeDetails(extra)
    };
  }

  exportSupportBundle(payload = {}) {
    const stamp = nowIso().replace(/[:.]/g, "-");
    const bundleDir = path.join(this.supportRoot, `support-bundle-${stamp}`);
    ensureDir(bundleDir);

    const copiedFiles = [];
    const filesToCopy = [
      { source: path.join(this.logsPath, "main.log"), target: path.join(bundleDir, "main.log") },
      { source: this.eventsPath, target: path.join(bundleDir, "operations-events.jsonl") },
      { source: path.join(this.logsPath, "smoke-e2e-result.json"), target: path.join(bundleDir, "smoke-e2e-result.json") }
    ];

    for (const item of filesToCopy) {
      if (copyIfExists(item.source, item.target)) {
        copiedFiles.push(path.basename(item.target));
      }
    }

    const crashFiles = fs.existsSync(this.crashRoot)
      ? fs
          .readdirSync(this.crashRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => entry.name)
          .sort()
          .slice(-5)
      : [];
    for (const crashFileName of crashFiles) {
      if (
        copyIfExists(
          path.join(this.crashRoot, crashFileName),
          path.join(bundleDir, "crashes", crashFileName)
        )
      ) {
        copiedFiles.push(path.join("crashes", crashFileName));
      }
    }

    const manifestPath = path.join(bundleDir, "manifest.json");
    const manifest = {
      generatedAt: nowIso(),
      appName: this.appName,
      appVersion: this.appVersion,
      context: sanitizeDetails(payload),
      files: copiedFiles,
      health: this.buildHealthSnapshot()
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    copiedFiles.push("manifest.json");

    this.recordEvent({
      level: "info",
      category: "support",
      event: "support.bundle.exported",
      message: "Pacote de diagnostico exportado para suporte.",
      details: {
        bundleDir,
        files: copiedFiles
      }
    });

    return {
      ok: true,
      bundleDir,
      manifestPath,
      files: copiedFiles
    };
  }

  getLatestSupportBundle() {
    if (!fs.existsSync(this.supportRoot)) {
      return null;
    }
    const candidates = fs
      .readdirSync(this.supportRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("support-bundle-"))
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(this.supportRoot, entry.name),
        createdAt:
          fs.statSync(path.join(this.supportRoot, entry.name)).mtimeMs || 0
      }))
      .sort((left, right) => right.createdAt - left.createdAt);

    if (!candidates.length) {
      return null;
    }
    const latest = candidates[0];
    return {
      path: latest.fullPath,
      manifest: safeReadJson(path.join(latest.fullPath, "manifest.json"), null)
    };
  }
}

module.exports = {
  SupportDiagnosticsService
};
