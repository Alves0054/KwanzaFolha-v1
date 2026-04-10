const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function checksumFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

class AntiTamperService {
  constructor({ app, appRoot, manifestPath }) {
    this.app = app;
    this.appRoot = appRoot;
    this.manifestPath = manifestPath;
  }

  getDefaultManifestPath() {
    if (this.manifestPath) {
      return this.manifestPath;
    }

    if (this.app?.isPackaged) {
      return path.join(process.resourcesPath, "app.asar", "electron", "config", "integrity-manifest.json");
    }

    return path.join(this.appRoot, "electron", "config", "integrity-manifest.json");
  }

  loadManifest() {
    const manifestPath = this.getDefaultManifestPath();
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    return safeJsonParse(fs.readFileSync(manifestPath, "utf8"));
  }

  resolveTrackedPath(relativePath) {
    if (this.app?.isPackaged) {
      return path.join(process.resourcesPath, "app.asar", relativePath);
    }
    return path.join(this.appRoot, relativePath);
  }

  detectDebugEnvironment() {
    const flags = [...process.execArgv, ...(process.argv || [])].join(" ");
    const hasDebugFlag = /--inspect|--remote-debugging-port|--inspect-brk/i.test(flags);
    const hasNodeDebugEnv = /--inspect|--remote-debugging-port/i.test(String(process.env.NODE_OPTIONS || ""));
    return {
      ok: !(hasDebugFlag || hasNodeDebugEnv),
      message: hasDebugFlag || hasNodeDebugEnv ? "Ambiente de debug detetado no processo principal." : ""
    };
  }

  verifyCriticalModules() {
    const manifest = this.loadManifest();
    if (!manifest?.files || !Array.isArray(manifest.files) || !manifest.files.length) {
      return { ok: true, skipped: true, message: "Manifesto de integridade indisponivel." };
    }

    const mismatches = [];
    for (const file of manifest.files) {
      const shouldVerifyInCurrentMode = this.app?.isPackaged
        ? file.packaged !== false
        : file.development !== false;
      if (!shouldVerifyInCurrentMode) {
        continue;
      }

      const targetPath = this.resolveTrackedPath(file.path);
      if (!fs.existsSync(targetPath)) {
        mismatches.push({ path: file.path, reason: "missing" });
        continue;
      }

      const actualHash = checksumFile(targetPath);
      if (String(actualHash) !== String(file.sha256)) {
        mismatches.push({ path: file.path, reason: "hash_mismatch" });
      }
    }

    if (mismatches.length) {
      return {
        ok: false,
        message: "Foram detetadas alteracoes em modulos criticos da aplicacao.",
        mismatches
      };
    }

    return { ok: true, skipped: false };
  }
}

module.exports = {
  AntiTamperService
};
