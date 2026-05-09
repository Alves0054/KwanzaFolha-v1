const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PRECHECK_REQUIRED_DOCS = Object.freeze([
  "README.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/instalacao/INSTALACAO.md",
  "docs/instalacao/REQUISITOS.md",
  "docs/utilizador/MANUAL_CLIENTE.md",
  "docs/fiscalidade/IRT_2026_FONTES_E_VALIDACAO.md",
  "docs/fiscalidade/TESTES_FISCAIS.md",
  "docs/fiscalidade/VALIDACAO_CONTABILISTA.md",
  "docs/legal/CONTRATO_LICENCA.md",
  "docs/legal/TERMOS_DE_USO.md",
  "docs/legal/POLITICA_PRIVACIDADE.md",
  "docs/entrega/CHECKLIST_ENTREGA.md",
  "docs/entrega/RELEASE_NOTES.md",
  "docs/entrega/CHECKSUMS.md",
  "docs/entrega/README_ENTREGA.md",
  "docs/validacao-externa-pendente/CHECKLIST_VALIDACAO_EXTERNA.md"
]);

const REQUIRED_NPM_SCRIPTS = Object.freeze([
  "test",
  "test:node",
  "build:installer",
  "build:signed",
  "release:prepare",
  "release:prepare:beta",
  "smoke:packaged",
  "smoke:packaged:e2e",
  "verify:packaged:main"
]);

const FORBIDDEN_REPO_PATTERNS = Object.freeze([
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
  /(^|\/)\.env(\.[^/]+)?$/i,
  /(^|\/)license-private\.pem$/i,
  /(^|\/)settings\.json$/i,
  /(^|\/)licensing-server\/storage\//i,
  /(^|\/).*kwanza-folha.*\.sqlite(\.enc)?$/i
]);

const FORBIDDEN_DIST_PATTERNS = Object.freeze([
  /\.p12$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.sqlite(\.enc)?$/i,
  /\.db$/i,
  /developer-license\.json$/i,
  /session-state\.json$/i,
  /data-protection\.key$/i,
  /license-private\.pem$/i
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const maybeValue = argv[index + 1];
    if (!maybeValue || String(maybeValue).startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = maybeValue;
    index += 1;
  }
  return args;
}

function collectFilesRecursively(rootDir) {
  const result = [];
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      result.push(fullPath);
    }
  }

  return result;
}

function normalizeRelativePath(filePath, rootDir) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function listTrackedFiles(rootDir) {
  if (String(process.env.KWANZA_RELEASE_SKIP_GIT || "").trim() === "1") {
    return null;
  }

  const candidates = [
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe"
  ];

  for (const candidate of candidates) {
    try {
      const output = execFileSync(candidate, ["ls-files"], {
        cwd: rootDir,
        encoding: "utf8"
      });
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {}
  }

  return null;
}

function listFilesystemFiles(rootDir) {
  return collectFilesRecursively(rootDir)
    .map((filePath) => normalizeRelativePath(filePath, rootDir))
    .filter((relativePath) => {
      if (relativePath.startsWith(".git/")) return false;
      if (relativePath.startsWith("node_modules/")) return false;
      if (relativePath.startsWith("artifacts/")) return false;
      if (relativePath.startsWith("dist/")) return false;
      if (relativePath.startsWith("dist-electron/")) return false;
      if (relativePath.startsWith("logs/")) return false;
      if (relativePath.startsWith("licensing-server.local/")) return false;
      return true;
    });
}

function assertRequiredDocs(rootDir, requiredDocs = PRECHECK_REQUIRED_DOCS) {
  const missing = requiredDocs.filter((doc) => !fs.existsSync(path.join(rootDir, doc)));
  if (missing.length) {
    throw new Error(`Documentacao obrigatoria em falta: ${missing.join(", ")}`);
  }
}

function assertPackageScripts(rootDir, requiredScripts = REQUIRED_NPM_SCRIPTS) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const scripts = packageJson.scripts || {};
  const missing = requiredScripts.filter((scriptName) => !scripts[scriptName]);
  if (missing.length) {
    throw new Error(`Scripts obrigatórios em falta no package.json: ${missing.join(", ")}`);
  }
}

function assertCommercialBuildScripts(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const scripts = packageJson.scripts || {};
  const publicBuildScripts = ["build", "build:installer"];

  for (const scriptName of publicBuildScripts) {
    const command = String(scripts[scriptName] || "").trim();
    if (!/build:signed/.test(command) && !/build-signed\.ps1/i.test(command)) {
      throw new Error(`${scriptName} deve gerar sempre build comercial assinada via build-signed.ps1.`);
    }
    if (/electron-builder/i.test(command)) {
      throw new Error(`${scriptName} nao pode chamar electron-builder diretamente; use build:unsigned apenas dentro do fluxo assinado.`);
    }
  }

  for (const scriptName of ["build:unsigned", "build:installer:unsigned"]) {
    if (!scripts[scriptName]) {
      throw new Error(`Script interno em falta no package.json: ${scriptName}.`);
    }
  }
}

function assertSecureLicenseSource(rootDir) {
  const licenseSource = require(path.join(rootDir, "electron", "config", "license-source.js"));
  const apiUrl = String(licenseSource.apiBaseUrl || "").trim().toLowerCase();
  if (!apiUrl.startsWith("https://")) {
    throw new Error("electron/config/license-source.js deve apontar para API HTTPS em producao.");
  }
}

function assertNoForbiddenTrackedFiles(rootDir) {
  const tracked = listTrackedFiles(rootDir);
  if (!tracked) {
    const filesystemFiles = listFilesystemFiles(rootDir);
    const offenders = filesystemFiles.filter((relativePath) =>
      FORBIDDEN_REPO_PATTERNS.some((pattern) => pattern.test(relativePath))
    );
    if (offenders.length) {
      throw new Error(`Ficheiros sensiveis detetados (scan filesystem): ${offenders.join(", ")}`);
    }

    return { skipped: false, reason: "git_ls_files_unavailable", method: "filesystem" };
  }

  const offenders = tracked.filter((trackedPath) =>
    FORBIDDEN_REPO_PATTERNS.some((pattern) => pattern.test(trackedPath))
  );
  if (offenders.length) {
    throw new Error(
      `Ficheiros sensiveis nao podem ficar versionados: ${offenders.join(", ")}`
    );
  }
  return { skipped: false, method: "git" };
}

function parseBooleanFlag(value, fallbackValue = false) {
  if (value === undefined || value === null) {
    return fallbackValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "nao"].includes(normalized)) {
    return false;
  }
  return fallbackValue;
}

function assertPackagedArtifacts(distDir, packageVersion, options = {}) {
  const requireReleaseBundle = options.requireReleaseBundle !== false;
  const installerPattern = new RegExp(`^KwanzaFolha-Setup-${packageVersion.replace(/\./g, "\\.")}\\.exe$`, "i");
  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  if (!fileNames.some((name) => installerPattern.test(name))) {
    throw new Error(`Nao encontrei instalador da versao ${packageVersion} em ${distDir}.`);
  }
  if (!fileNames.some((name) => installerPattern.test(name.replace(".exe.blockmap", ".exe")) && name.endsWith(".exe.blockmap"))) {
    throw new Error("Nao encontrei ficheiro .blockmap correspondente ao instalador.");
  }

  if (requireReleaseBundle) {
    for (const requiredFile of ["SHA256SUMS.txt", "release-manifest.json", "release-notes-template.md"]) {
      if (!fileNames.includes(requiredFile)) {
        throw new Error(`Artefacto obrigatório em falta em dist-electron: ${requiredFile}`);
      }
    }
  }
}

function assertNoForbiddenDistFiles(distDir, rootDir) {
  const allFiles = collectFilesRecursively(distDir);
  const offenders = allFiles
    .map((filePath) => normalizeRelativePath(filePath, rootDir))
    .filter((relativePath) => {
      if (relativePath.includes("/.smoke-localappdata/")) return false;
      if (relativePath.includes("/.smoke-programdata/")) return false;
      if (relativePath.includes("/diagnostics-logs/")) return false;
      return true;
    })
    .filter((relativePath) => FORBIDDEN_DIST_PATTERNS.some((pattern) => pattern.test(relativePath)));

  if (offenders.length) {
    throw new Error(`Pacote de distribuicao contem ficheiros proibidos: ${offenders.join(", ")}`);
  }
}

function assertReleaseManifest(distDir) {
  const manifestPath = path.join(distDir, "release-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length) {
    throw new Error("release-manifest.json sem lista de artefactos.");
  }
  if (manifest.artifacts.some((artifact) => String(artifact.kind || "").toLowerCase() === "portable")) {
    throw new Error("release-manifest.json nao pode listar artefactos portateis.");
  }
}

function validateReleaseReadiness({
  rootDir,
  phase = "preflight",
  distDir = path.join(rootDir, "dist-electron"),
  requireReleaseBundle = true
}) {
  const normalizedPhase = String(phase || "preflight").trim().toLowerCase();
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assertRequiredDocs(rootDir);
  assertPackageScripts(rootDir);
  assertCommercialBuildScripts(rootDir);
  assertSecureLicenseSource(rootDir);
  const trackedCheck = assertNoForbiddenTrackedFiles(rootDir);

  if (normalizedPhase === "packaged") {
    if (!fs.existsSync(distDir)) {
      throw new Error(`Pasta de artefactos nao encontrada: ${distDir}`);
    }
    assertPackagedArtifacts(distDir, packageJson.version, {
      requireReleaseBundle
    });
    assertNoForbiddenDistFiles(distDir, rootDir);
    if (requireReleaseBundle) {
      assertReleaseManifest(distDir);
    }
  }

  return {
    ok: true,
    phase: normalizedPhase,
    version: packageJson.version,
    distDir,
    trackedFilesCheck: trackedCheck
  };
}

function main() {
  const args = parseArgs();
  const rootDir = path.resolve(__dirname, "..");
  const phase = String(args.phase || "preflight").trim().toLowerCase();
  const distDir = path.resolve(rootDir, args.distDir || "dist-electron");
  const requireReleaseBundle = parseBooleanFlag(args.expectReleaseBundle, true);
  const result = validateReleaseReadiness({
    rootDir,
    phase,
    distDir,
    requireReleaseBundle
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  PRECHECK_REQUIRED_DOCS,
  REQUIRED_NPM_SCRIPTS,
  parseBooleanFlag,
  parseArgs,
  validateReleaseReadiness
};
