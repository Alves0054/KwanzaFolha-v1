const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const STORE_VERSION = 1;
const FALLBACK_STORE_VERSION = 1;
const FALLBACK_STORE_MARKER = "kwanza-folha-secure-store-fallback";

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function isPermissionError(error) {
  return ["EPERM", "EACCES"].includes(String(error?.code || "").toUpperCase());
}

function sanitizeSecretName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Nome de segredo invalido.");
  }
  return normalized;
}

function decodeUtf8Buffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "utf8");
}

class SecureStorageService {
  constructor({ userDataPath, appName = "Kwanza Folha", programDataPath = null }) {
    this.userDataPath = userDataPath;
    this.appName = appName;
    this.programDataPath =
      programDataPath || path.join(process.env.ProgramData || "C:\\ProgramData", this.appName);
    this.userStoreDir = path.join(this.userDataPath, "secure-store");
    this.machineStoreDir = path.join(this.programDataPath, "secure-store");
    ensureDir(this.userStoreDir);
    this.machineStoreAvailable = true;
    try {
      ensureDir(this.machineStoreDir);
    } catch {
      this.machineStoreAvailable = false;
    }
    this.dpapiAvailable = true;
  }

  getSecretPaths(name) {
    const normalized = sanitizeSecretName(name);
    return {
      userPath: path.join(this.userStoreDir, `${normalized}.bin`),
      machinePath: path.join(this.machineStoreDir, `${normalized}.bin`)
    };
  }

  runDpapiCommand(mode, payloadBase64, entropy = "") {
    const script = `
Add-Type -AssemblyName System.Security
$payload = [Convert]::FromBase64String($env:KWANZA_DPAPI_PAYLOAD)
$entropy = if ([string]::IsNullOrWhiteSpace($env:KWANZA_DPAPI_ENTROPY)) { $null } else { [Text.Encoding]::UTF8.GetBytes($env:KWANZA_DPAPI_ENTROPY) }
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($env:KWANZA_DPAPI_MODE -eq 'protect') {
  $sealed = [System.Security.Cryptography.ProtectedData]::Protect($payload, $entropy, $scope)
  [Console]::Write([Convert]::ToBase64String($sealed))
} else {
  $opened = [System.Security.Cryptography.ProtectedData]::Unprotect($payload, $entropy, $scope)
  [Console]::Write([Convert]::ToBase64String($opened))
}
`.trim();

    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          KWANZA_DPAPI_MODE: mode,
          KWANZA_DPAPI_PAYLOAD: payloadBase64,
          KWANZA_DPAPI_ENTROPY: String(entropy || "")
        },
        windowsHide: true
      }
    );

    return String(output || "").trim();
  }

  deriveFallbackKey(entropy = "") {
    return crypto
      .createHash("sha256")
      .update(
        [
          "kwanza-folha-secure-storage",
          this.appName,
          this.userDataPath,
          this.programDataPath,
          process.env.USERNAME || "",
          process.env.USERPROFILE || "",
          process.env.COMPUTERNAME || "",
          String(entropy || "")
        ].join("|"),
        "utf8"
      )
      .digest();
  }

  protectDataFallback(value, entropy = "") {
    const payload = decodeUtf8Buffer(value);
    const iv = crypto.randomBytes(12);
    const key = this.deriveFallbackKey(entropy);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.from(
      JSON.stringify({
        marker: FALLBACK_STORE_MARKER,
        version: FALLBACK_STORE_VERSION,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: encrypted.toString("base64")
      }),
      "utf8"
    );
  }

  unprotectDataFallback(value, entropy = "") {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value || ""));
    if (
      parsed?.marker !== FALLBACK_STORE_MARKER ||
      Number(parsed?.version) !== FALLBACK_STORE_VERSION ||
      !parsed?.iv ||
      !parsed?.tag ||
      !parsed?.ciphertext
    ) {
      throw new Error("Segredo fallback invalido.");
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.deriveFallbackKey(entropy),
      Buffer.from(parsed.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, "base64")), decipher.final()]);
  }

  protectDataDPAPI(value, entropy = "") {
    if (!this.dpapiAvailable) {
      return this.protectDataFallback(value, entropy);
    }

    try {
      const payloadBase64 = decodeUtf8Buffer(value).toString("base64");
      const sealed = this.runDpapiCommand("protect", payloadBase64, entropy);
      return Buffer.from(sealed, "base64");
    } catch (error) {
      this.dpapiAvailable = false;
      return this.protectDataFallback(value, entropy);
    }
  }

  unprotectDataDPAPI(value, entropy = "") {
    const payloadBuffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "base64");

    if (payloadBuffer.toString("utf8", 0, 1) === "{") {
      return this.unprotectDataFallback(payloadBuffer, entropy);
    }

    if (!this.dpapiAvailable) {
      return this.unprotectDataFallback(payloadBuffer, entropy);
    }

    try {
      const opened = this.runDpapiCommand("unprotect", payloadBuffer.toString("base64"), entropy);
      return Buffer.from(opened, "base64");
    } catch (error) {
      this.dpapiAvailable = false;
      return this.unprotectDataFallback(payloadBuffer, entropy);
    }
  }

  wrapSecretPayload(name, rawValue) {
    const valueBuffer = decodeUtf8Buffer(rawValue);
    return Buffer.from(
      JSON.stringify({
        version: STORE_VERSION,
        name: sanitizeSecretName(name),
        value: valueBuffer.toString("base64"),
        createdAt: new Date().toISOString()
      }),
      "utf8"
    );
  }

  unwrapSecretPayload(name, rawBuffer) {
    const parsed = JSON.parse(Buffer.from(rawBuffer).toString("utf8"));
    if (!parsed || Number(parsed.version) !== STORE_VERSION || parsed.name !== sanitizeSecretName(name)) {
      throw new Error("Segredo protegido invalido.");
    }
    return Buffer.from(String(parsed.value || ""), "base64");
  }

  storeSecret(name, value, options = {}) {
    const { mirror = true, entropy = name } = options;
    const payload = this.wrapSecretPayload(name, value);
    const sealed = this.protectDataDPAPI(payload, entropy);
    const { userPath, machinePath } = this.getSecretPaths(name);
    let machinePathWritten = false;
    if (this.machineStoreAvailable) {
      try {
        fs.writeFileSync(machinePath, sealed);
        machinePathWritten = true;
      } catch (error) {
        if (isPermissionError(error)) {
          this.machineStoreAvailable = false;
        } else {
          throw error;
        }
      }
    }
    if (mirror) {
      fs.writeFileSync(userPath, sealed);
    }
    return { ok: true, paths: { userPath, machinePath: machinePathWritten ? machinePath : null } };
  }

  loadSecret(name, options = {}) {
    const { entropy = name, asBuffer = false } = options;
    const { userPath, machinePath } = this.getSecretPaths(name);
    const locations = this.machineStoreAvailable ? [machinePath, userPath] : [userPath];

    for (const location of locations) {
      if (!fs.existsSync(location)) {
        continue;
      }

      try {
        const opened = this.unprotectDataDPAPI(fs.readFileSync(location), entropy);
        const valueBuffer = this.unwrapSecretPayload(name, opened);
        return asBuffer ? valueBuffer : valueBuffer.toString("utf8");
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  hasSecret(name) {
    const { userPath, machinePath } = this.getSecretPaths(name);
    return (this.machineStoreAvailable && fs.existsSync(machinePath)) || fs.existsSync(userPath);
  }

  removeSecret(name) {
    const { userPath, machinePath } = this.getSecretPaths(name);
    if (this.machineStoreAvailable && fs.existsSync(machinePath)) {
      try {
        fs.unlinkSync(machinePath);
      } catch (error) {
        if (isPermissionError(error)) {
          this.machineStoreAvailable = false;
        } else {
          throw error;
        }
      }
    }
    if (fs.existsSync(userPath)) {
      fs.unlinkSync(userPath);
    }
    return { ok: true };
  }
}

module.exports = {
  SecureStorageService
};
