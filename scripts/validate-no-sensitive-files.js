const fs = require("fs");
const path = require("path");

const DEFAULT_IGNORE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron"
]);

const FORBIDDEN_PATH_PATTERNS = Object.freeze([
  { pattern: /\.sqlite(\.enc)?$/i, label: "sqlite" },
  { pattern: /\.db$/i, label: "database" },
  { pattern: /(^|\/)\.env(\.[^/]+)?$/i, label: "dotenv" },
  { pattern: /\.p12$/i, label: "pkcs12" },
  { pattern: /\.pfx$/i, label: "pkcs12" },
  { pattern: /\.key$/i, label: "private-key" },
  { pattern: /(^|\/)license-private\.pem$/i, label: "license-private-key" },
  { pattern: /(^|\/)settings\.json$/i, label: "settings-json" }
]);

const FORBIDDEN_PATH_SEGMENTS = Object.freeze([
  "/storage/keys/",
  "/storage/keys",
  "/logs/",
  "/artifacts/"
]);

const ALLOWED_EXACT_PATHS = new Set([
  "artifacts/irt-oficial.html",
  "RELEASE_NOTES_TEMPLATE.md"
]);

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

function normalizeRelative(filePath, rootDir) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function shouldIgnoreDir(entryName) {
  return DEFAULT_IGNORE_DIR_NAMES.has(entryName);
}

function collectFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name)) {
          continue;
        }
        stack.push(path.join(current, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      results.push(path.join(current, entry.name));
    }
  }

  return results;
}

function looksLikePlaceholderSettingsJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.includes("ALTERAR")) {
      return true;
    }

    const parsed = JSON.parse(raw);
    const webhookSecret = String(parsed?.webhook?.secret || "").trim();
    const adminPasswordHash = String(parsed?.admin?.passwordHash || "").trim();
    const adminTokenHash = String(parsed?.admin?.tokenHash || "").trim();
    const smtpPassword = String(parsed?.smtp?.password || "").trim();

    if (!webhookSecret && !adminPasswordHash && !adminTokenHash && !smtpPassword) {
      return true;
    }
  } catch {}

  return false;
}

function classifyForbidden(relativePath, absolutePath = "") {
  if (ALLOWED_EXACT_PATHS.has(relativePath)) {
    return null;
  }

  const normalized = `/${String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "")}`;

  const segmentHit = FORBIDDEN_PATH_SEGMENTS.find((segment) => normalized.toLowerCase().includes(segment));
  if (segmentHit) {
    return `segment:${segmentHit}`;
  }

  const patternHit = FORBIDDEN_PATH_PATTERNS.find((entry) => entry.pattern.test(normalized));
  if (patternHit) {
    // Permit example/template variants.
    if (patternHit.label === "dotenv" && /(^|\/)\.env\.example$/i.test(normalized)) {
      return null;
    }
    if (patternHit.label === "settings-json" && /settings\.production\.example\.json$/i.test(normalized)) {
      return null;
    }
    if (patternHit.label === "settings-json" && absolutePath && looksLikePlaceholderSettingsJson(absolutePath)) {
      return null;
    }
    return `pattern:${patternHit.label}`;
  }

  return null;
}

function scanDirectory(rootDir, label) {
  const files = collectFiles(rootDir);
  const offenders = [];

  for (const filePath of files) {
    const relativePath = normalizeRelative(filePath, rootDir);
    const reason = classifyForbidden(relativePath, filePath);
    if (reason) {
      offenders.push({ relativePath, reason });
    }
  }

  if (offenders.length) {
    const list = offenders.map((item) => `${item.relativePath} (${item.reason})`).join(", ");
    throw new Error(`Ficheiros sensiveis detetados em ${label}: ${list}`);
  }

  return { ok: true, label, filesScanned: files.length };
}

function main() {
  const args = parseArgs();
  const rootDir = path.resolve(process.cwd(), args.rootDir || ".");
  const distDir = args.distDir ? path.resolve(rootDir, args.distDir) : null;

  const results = [];
  results.push(scanDirectory(rootDir, "workspace"));
  if (distDir && fs.existsSync(distDir)) {
    results.push(scanDirectory(distDir, "dist"));
  }

  console.log(JSON.stringify({ ok: true, rootDir, distDir, results }, null, 2));
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
  classifyForbidden,
  collectFiles,
  normalizeRelative,
  parseArgs,
  scanDirectory
};
