const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const nextValue = argv[index + 1];
    if (!nextValue || String(nextValue).startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = nextValue;
    index += 1;
  }

  return args;
}

function readPackageMetadata(rootDir) {
  const packagePath = path.join(rootDir, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

function normalizeChannel(value) {
  const channel = String(value || "stable").trim().toLowerCase();
  return channel === "beta" ? "beta" : "stable";
}

function detectArtifactKind(fileName) {
  const normalized = String(fileName || "").toLowerCase();
  if (normalized.includes("-setup-") && normalized.endsWith(".exe")) {
    return "installer";
  }
  if (normalized.endsWith(".blockmap")) {
    return "blockmap";
  }
  return "other";
}

function filterArtifactsByTarget(artifacts, target = "all") {
  const normalizedTarget = String(target || "all").trim().toLowerCase();
  if (normalizedTarget === "installer") {
    return artifacts.filter((artifact) => artifact.kind === "installer" || artifact.kind === "blockmap");
  }
  return artifacts;
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function collectReleaseArtifacts({ distDir, version, target = "all" }) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`A pasta de distribuicao '${distDir}' nao existe.`);
  }

  const expectedVersion = String(version || "").trim();
  const files = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.includes(expectedVersion))
    .filter((name) => name.endsWith(".exe") || name.endsWith(".blockmap"))
    .map((name) => {
      const absolutePath = path.join(distDir, name);
      return {
        name,
        path: absolutePath,
        kind: detectArtifactKind(name),
        sizeBytes: fs.statSync(absolutePath).size,
        sha256: computeFileSha256(absolutePath)
      };
    });

  const filtered = filterArtifactsByTarget(files, target);
  if (!filtered.length) {
    throw new Error(`Nao encontrei artefactos de release para a versao ${expectedVersion} em '${distDir}'.`);
  }

  if ((target === "all" || target === "installer") && !filtered.some((artifact) => artifact.kind === "installer")) {
    throw new Error("Nao encontrei o instalador assinado esperado para a release.");
  }

  return filtered.sort((left, right) => left.name.localeCompare(right.name));
}

function buildReleaseNotesTemplate({ version, channel, artifacts }) {
  const releaseLabel = channel === "beta" ? "beta controlada" : "estavel";
  const artifactLines = artifacts
    .map((artifact) => `- ${artifact.name} (${artifact.kind}, SHA-256: ${artifact.sha256})`)
    .join("\n");

  return [
    `# Release ${version}`,
    "",
    `Canal: ${releaseLabel}`,
    "",
    "## Validacoes obrigatorias",
    "",
    "- npm test concluido com sucesso",
    "- build assinado concluido e assinatura validada",
    "- instalacao por cima da versao anterior validada",
    "- verificacao de atualizacao validada em ambiente de teste",
    "",
    "## Artefactos",
    "",
    artifactLines,
    "",
    "## Notas da release",
    "",
    "- Resuma aqui as alteracoes funcionais e correcoes principais.",
    "- Indique riscos conhecidos, se existirem.",
    "- Referencie o parecer fiscal/juridico quando a release alterar regras legais.",
    ""
  ].join("\n");
}

function buildReleaseManifest({ packageMetadata, channel, artifacts }) {
  return {
    productName: packageMetadata.productName || packageMetadata.name,
    version: packageMetadata.version,
    channel,
    generatedAt: new Date().toISOString(),
    updater: {
      checksumRequired: true,
      checksumFile: "SHA256SUMS.txt"
    },
    artifacts: artifacts.map((artifact) => ({
      name: artifact.name,
      kind: artifact.kind,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256
    }))
  };
}

function writeReleaseBundle({ distDir, manifest, artifacts, notesTemplate }) {
  const checksumLines = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n");
  const checksumPath = path.join(distDir, "SHA256SUMS.txt");
  const manifestPath = path.join(distDir, "release-manifest.json");
  const notesPath = path.join(distDir, "release-notes-template.md");

  fs.writeFileSync(checksumPath, `${checksumLines}\n`, "utf8");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(notesPath, notesTemplate, "utf8");

  return {
    checksumPath,
    manifestPath,
    notesPath
  };
}

function main() {
  const args = parseArgs();
  const rootDir = path.resolve(__dirname, "..");
  const distDir = path.resolve(rootDir, args.distDir || "dist-electron");
  const packageMetadata = readPackageMetadata(rootDir);
  const channel = normalizeChannel(args.channel);
  const target = String(args.target || "all").trim().toLowerCase();
  const artifacts = collectReleaseArtifacts({
    distDir,
    version: packageMetadata.version,
    target
  });
  const manifest = buildReleaseManifest({
    packageMetadata,
    channel,
    artifacts
  });
  const notesTemplate = buildReleaseNotesTemplate({
    version: packageMetadata.version,
    channel,
    artifacts
  });
  const outputs = writeReleaseBundle({
    distDir,
    manifest,
    artifacts,
    notesTemplate
  });

  console.log(JSON.stringify({
    ok: true,
    version: packageMetadata.version,
    channel,
    distDir,
    artifacts: artifacts.map((artifact) => artifact.name),
    outputs
  }, null, 2));
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
  buildReleaseManifest,
  buildReleaseNotesTemplate,
  collectReleaseArtifacts,
  computeFileSha256,
  detectArtifactKind,
  normalizeChannel,
  parseArgs,
  writeReleaseBundle
};
