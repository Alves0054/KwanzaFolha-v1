const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const IDENTITY_VERSION = 1;
const REGISTRY_VALUE_NAME = "InstallationIdentity";

function safeString(value) {
  return String(value || "").trim();
}

function uniqueSorted(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => safeString(value).toUpperCase())
        .filter(Boolean)
    )
  ).sort();
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class InstallationIdentityService {
  constructor({ appName = "Kwanza Folha", productCode = "KWANZAFOLHA", userDataPath, secureStorage, programDataPath = null }) {
    this.appName = appName;
    this.productCode = productCode;
    this.userDataPath = userDataPath;
    this.secureStorage = secureStorage;
    this.registryPath = "Registry::HKEY_CURRENT_USER\\Software\\KwanzaFolha";
    this.registryFallbackPath = "Registry::HKEY_LOCAL_MACHINE\\Software\\KwanzaFolha";
    this.programDataDir = programDataPath || path.join(process.env.ProgramData || "C:\\ProgramData", this.appName);
    this.programDataIdentityPath = path.join(this.programDataDir, "install.dat");
    this.appDataIdentityPath = path.join(this.userDataPath, "install.cache");
    this.cachedIdentity = null;

    this.programDataAvailable = true;
    try {
      fs.mkdirSync(this.programDataDir, { recursive: true });
    } catch {
      this.programDataAvailable = false;
    }
    fs.mkdirSync(this.userDataPath, { recursive: true });
  }

  runPowerShell(script, env = {}) {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env
      },
      windowsHide: true
    }).trim();
  }

  queryPowerShellValue(script, fallback = "") {
    try {
      const value = this.runPowerShell(script);
      return safeString(value) || fallback;
    } catch {
      return fallback;
    }
  }

  generateHardwareFingerprint() {
    const motherboardSerial = this.queryPowerShellValue(
      "(Get-CimInstance Win32_BaseBoard | Select-Object -First 1 -ExpandProperty SerialNumber)"
    );
    const cpuId = this.queryPowerShellValue(
      "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId)"
    );
    const biosSerial = this.queryPowerShellValue(
      "(Get-CimInstance Win32_BIOS | Select-Object -First 1 -ExpandProperty SerialNumber)"
    );
    const diskSerials = uniqueSorted(
      this.queryPowerShellValue(
        "(Get-CimInstance Win32_DiskDrive | Where-Object { $_.SerialNumber } | Select-Object -ExpandProperty SerialNumber) -join \"`n\""
      )
        .split(/\r?\n/)
    );
    const macAddresses = uniqueSorted(
      this.queryPowerShellValue(
        "(Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.MACAddress -and $_.IPEnabled } | Select-Object -ExpandProperty MACAddress) -join \"`n\""
      )
        .split(/\r?\n/)
    );
    const machineGuid = this.queryPowerShellValue(
      "(Get-ItemProperty -Path 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid"
    );

    return {
      motherboardSerial,
      cpuId,
      biosSerial,
      diskSerials,
      macAddresses,
      machineGuid,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch()
    };
  }

  canonicalizeHardwareData(snapshot = {}) {
    return {
      motherboardSerial: safeString(snapshot.motherboardSerial).toUpperCase(),
      cpuId: safeString(snapshot.cpuId).toUpperCase(),
      biosSerial: safeString(snapshot.biosSerial).toUpperCase(),
      diskSerials: uniqueSorted(snapshot.diskSerials),
      macAddresses: uniqueSorted(snapshot.macAddresses),
      machineGuid: safeString(snapshot.machineGuid).toUpperCase(),
      hostname: safeString(snapshot.hostname).toUpperCase(),
      platform: safeString(snapshot.platform).toLowerCase(),
      arch: safeString(snapshot.arch).toLowerCase()
    };
  }

  createFingerprintHash(canonicalHardwareData) {
    const serverPepper =
      safeString(process.env.KWANZA_FINGERPRINT_PEPPER) ||
      safeString(process.env.KWANZA_SERVER_PEPPER) ||
      `${this.productCode}:fingerprint`;
    return crypto
      .createHmac("sha256", serverPepper)
      .update(JSON.stringify(canonicalHardwareData), "utf8")
      .digest("hex");
  }

  buildIdentityPayload(overrides = {}) {
    const hardwareSnapshot = this.generateHardwareFingerprint();
    const canonicalHardwareData = this.canonicalizeHardwareData(hardwareSnapshot);
    return {
      version: IDENTITY_VERSION,
      installId: crypto.randomBytes(32).toString("hex"),
      installSecret: crypto.randomBytes(32).toString("hex"),
      hardwareSnapshot,
      canonicalHardwareData,
      fingerprintHash: this.createFingerprintHash(canonicalHardwareData),
      riskFlags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  sealIdentity(identity) {
    return this.secureStorage.protectDataDPAPI(Buffer.from(JSON.stringify(identity), "utf8"), "installation-identity");
  }

  unsealIdentity(buffer) {
    const opened = this.secureStorage.unprotectDataDPAPI(buffer, "installation-identity");
    const parsed = safeJsonParse(opened.toString("utf8"));
    if (!parsed?.installId || !parsed?.installSecret) {
      throw new Error("Identidade de instalacao invalida.");
    }
    return parsed;
  }

  writeRegistryAnchor(sealedValue) {
    const script = `
New-Item -Path $env:KWANZA_REGISTRY_PATH -Force | Out-Null
Set-ItemProperty -Path $env:KWANZA_REGISTRY_PATH -Name '${REGISTRY_VALUE_NAME}' -Value $env:KWANZA_REGISTRY_VALUE
`.trim();
    try {
      this.runPowerShell(script, {
        KWANZA_REGISTRY_PATH: this.registryPath,
        KWANZA_REGISTRY_VALUE: sealedValue.toString("base64")
      });
      return { ok: true, target: "hkcu" };
    } catch (error) {
      try {
        this.runPowerShell(script, {
          KWANZA_REGISTRY_PATH: this.registryFallbackPath,
          KWANZA_REGISTRY_VALUE: sealedValue.toString("base64")
        });
        return { ok: true, target: "hklm" };
      } catch {
        return { ok: false };
      }
    }
  }

  readRegistryAnchor() {
    const script = `
$paths = @($env:KWANZA_REGISTRY_PATH, $env:KWANZA_REGISTRY_FALLBACK_PATH)
foreach ($path in $paths) {
  try {
    $value = (Get-ItemProperty -Path $path -Name '${REGISTRY_VALUE_NAME}' -ErrorAction Stop).'${REGISTRY_VALUE_NAME}'
    if ($value) {
      [Console]::Write($value)
      exit 0
    }
  } catch {}
}
`.trim();
    try {
      const output = this.runPowerShell(script, {
        KWANZA_REGISTRY_PATH: this.registryPath,
        KWANZA_REGISTRY_FALLBACK_PATH: this.registryFallbackPath
      });
      return output ? Buffer.from(output, "base64") : null;
    } catch {
      return null;
    }
  }

  writeFileAnchor(targetPath, sealedValue) {
    if (targetPath === this.programDataIdentityPath && !this.programDataAvailable) {
      return { ok: false, path: targetPath };
    }
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, sealedValue);
      return { ok: true, path: targetPath };
    } catch (error) {
      if (targetPath === this.programDataIdentityPath) {
        this.programDataAvailable = false;
      }
      return { ok: false, path: targetPath, error: error.message };
    }
  }

  readFileAnchor(targetPath) {
    if (targetPath === this.programDataIdentityPath && !this.programDataAvailable) {
      return null;
    }
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.readFileSync(targetPath);
  }

  saveInstallationIdentity(identity) {
    const normalized = {
      ...identity,
      version: IDENTITY_VERSION,
      updatedAt: new Date().toISOString()
    };
    const sealed = this.sealIdentity(normalized);
    const registryResult = this.writeRegistryAnchor(sealed);
    const programDataResult = this.writeFileAnchor(this.programDataIdentityPath, sealed);
    const appDataResult = this.writeFileAnchor(this.appDataIdentityPath, sealed);
    this.cachedIdentity = normalized;
    return {
      ...normalized,
      storageState: {
        registry: registryResult,
        programData: programDataResult,
        appData: appDataResult
      }
    };
  }

  loadInstallationIdentity() {
    if (this.cachedIdentity) {
      return this.cachedIdentity;
    }

    const anchors = [
      { name: "registry", buffer: this.readRegistryAnchor() },
      { name: "programData", buffer: this.readFileAnchor(this.programDataIdentityPath) },
      { name: "appData", buffer: this.readFileAnchor(this.appDataIdentityPath) }
    ];

    const decoded = anchors
      .filter((anchor) => anchor.buffer)
      .map((anchor) => {
        try {
          return { ...anchor, identity: this.unsealIdentity(anchor.buffer) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!decoded.length) {
      return null;
    }

    const grouped = new Map();
    for (const item of decoded) {
      const key = `${item.identity.installId}:${item.identity.installSecret}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(item);
    }

    const selectedGroup = Array.from(grouped.values()).sort((left, right) => right.length - left.length)[0];
    const selected = selectedGroup[0].identity;
    this.cachedIdentity = selected;
    return selected;
  }

  restoreMissingAnchor(anchorName, identity) {
    const sealed = this.sealIdentity(identity);
    if (anchorName === "registry") {
      return this.writeRegistryAnchor(sealed);
    }
    if (anchorName === "programData") {
      return this.writeFileAnchor(this.programDataIdentityPath, sealed);
    }
    if (anchorName === "appData") {
      return this.writeFileAnchor(this.appDataIdentityPath, sealed);
    }
    return { ok: false };
  }

  verifyInstallationAnchors() {
    let identity = this.loadInstallationIdentity();
    if (!identity) {
      identity = this.buildIdentityPayload();
      this.saveInstallationIdentity(identity);
      return {
        ok: true,
        identity,
        restoredAnchors: ["registry", "programData", "appData"],
        suspiciousReinstall: false,
        createdFresh: true
      };
    }

    const missingAnchors = [];
    if (!this.readRegistryAnchor()) {
      missingAnchors.push("registry");
    }
    if (this.programDataAvailable && !this.readFileAnchor(this.programDataIdentityPath)) {
      missingAnchors.push("programData");
    }
    if (!this.readFileAnchor(this.appDataIdentityPath)) {
      missingAnchors.push("appData");
    }

    for (const anchor of missingAnchors) {
      this.restoreMissingAnchor(anchor, identity);
    }

    const suspiciousReinstall = missingAnchors.includes("appData") && missingAnchors.length < 3;
    if (suspiciousReinstall) {
      const riskFlags = new Set(identity.riskFlags || []);
      riskFlags.add("suspicious_reinstall");
      identity = this.saveInstallationIdentity({
        ...identity,
        riskFlags: Array.from(riskFlags)
      });
    }

    return {
      ok: true,
      identity,
      restoredAnchors: missingAnchors,
      suspiciousReinstall,
      createdFresh: false
    };
  }

  migrateLegacyInstallation() {
    return this.verifyInstallationAnchors();
  }

  getIdentity() {
    return this.loadInstallationIdentity() || this.saveInstallationIdentity(this.buildIdentityPayload());
  }

  getDeviceHash() {
    const identity = this.getIdentity();
    return crypto
      .createHmac("sha256", identity.installSecret)
      .update(identity.fingerprintHash, "utf8")
      .digest("hex");
  }

  getFingerprintPayload() {
    const identity = this.getIdentity();
    return {
      installId: identity.installId,
      fingerprintHash: identity.fingerprintHash,
      hardwareSnapshot: identity.hardwareSnapshot,
      canonicalHardwareData: identity.canonicalHardwareData,
      riskFlags: Array.isArray(identity.riskFlags) ? identity.riskFlags : [],
      createdAt: identity.createdAt
    };
  }

  verifyExecutableSignature(executablePath, expectedThumbprint = "", options = {}) {
    const isDevelopmentMode = Boolean(options?.developmentMode);
    const normalizedAllowedThumbprints = Array.from(
      new Set(
        [
          expectedThumbprint,
          ...(Array.isArray(options?.allowedThumbprints) ? options.allowedThumbprints : [])
        ]
          .map((value) => safeString(value).toUpperCase())
          .filter(Boolean)
      )
    );
    if (!executablePath || !fs.existsSync(executablePath)) {
      return isDevelopmentMode
        ? {
            ok: true,
            warning: true,
            code: "dev_signature_target_missing",
            message: "Executavel nao encontrado para validacao de assinatura em modo de desenvolvimento."
          }
        : { ok: false, code: "signature_target_missing", message: "Executavel nao encontrado para validacao de assinatura." };
    }

    try {
      const script = `
$signature = Get-AuthenticodeSignature -FilePath $env:KWANZA_EXE_PATH
$thumbprint = ''
if ($signature.SignerCertificate) { $thumbprint = $signature.SignerCertificate.Thumbprint }
[Console]::Write((@{
  status = [string]$signature.Status
  thumbprint = [string]$thumbprint
  subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }
} | ConvertTo-Json -Compress))
`.trim();
      const output = this.runPowerShell(script, { KWANZA_EXE_PATH: executablePath });
      const result = safeJsonParse(output, {});
      const normalizedThumbprint = safeString(result.thumbprint).toUpperCase();
      const status = String(result.status || "").toLowerCase();
      const matchesExpectedThumbprint = Boolean(
        normalizedThumbprint &&
        normalizedAllowedThumbprints.includes(normalizedThumbprint)
      );
      if (status !== "valid") {
        if (matchesExpectedThumbprint) {
          return {
            ok: true,
            warning: true,
            code: "untrusted_chain_with_expected_thumbprint",
            message:
              "Assinatura do executavel corresponde ao certificado esperado, mas a cadeia de confianca nao foi validada neste Windows.",
            result
          };
        }
        if (isDevelopmentMode) {
          return {
            ok: true,
            warning: true,
            code: status === "notsigned" ? "dev_unsigned" : "dev_invalid_signature",
            message: "Assinatura digital nao valida em modo de desenvolvimento local.",
            result
          };
        }
        return {
          ok: false,
          code: status === "notsigned" ? "unsigned" : "invalid_signature",
          message: "A assinatura digital do executavel nao e valida.",
          result
        };
      }
      if (normalizedAllowedThumbprints.length > 0 && !matchesExpectedThumbprint) {
        return {
          ok: false,
          code: "thumbprint_mismatch",
          message: "O thumbprint do executavel nao corresponde ao certificado esperado.",
          result
        };
      }
      return { ok: true, code: "valid", result };
    } catch (error) {
      return isDevelopmentMode
        ? {
            ok: true,
            warning: true,
            code: "dev_signature_check_failed",
            message: "Nao foi possivel validar a assinatura no modo de desenvolvimento local.",
            error: error.message
          }
        : { ok: false, code: "signature_check_failed", message: "Nao foi possivel validar a assinatura do executavel.", error: error.message };
    }
  }
}

module.exports = {
  InstallationIdentityService
};
