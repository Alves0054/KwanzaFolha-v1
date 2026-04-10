const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CRITICAL_FILES = [
  { path: "electron/main.js", packaged: true, development: true },
  { path: "electron/services/licensing.js", packaged: true, development: true },
  { path: "electron/services/database.js", packaged: true, development: true },
  { path: "electron/services/secure-storage.js", packaged: true, development: true },
  { path: "electron/services/installation-identity.js", packaged: true, development: true },
  { path: "electron/services/anti-tamper.js", packaged: true, development: true },
  { path: "electron/services/core/create-app-services.js", packaged: true, development: true },
  { path: "licensing-server/server.js", packaged: false, development: true },
  { path: "package.json", packaged: false, development: true }
];

function checksumFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const outputPath = path.join(rootDir, "electron", "config", "integrity-manifest.json");
  const files = CRITICAL_FILES.map((entry) => {
    const absolutePath = path.join(rootDir, entry.path);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Ficheiro critico nao encontrado: ${entry.path}`);
    }
    return {
      path: entry.path,
      sha256: checksumFile(absolutePath),
      packaged: entry.packaged !== false,
      development: entry.development !== false
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    files
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, outputPath, trackedFiles: files.length }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
