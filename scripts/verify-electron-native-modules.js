const { createRequire } = require("module");
const { spawnSync } = require("child_process");
const path = require("path");

function runElectronChild() {
  const electronExe = require("electron");
  const result = spawnSync(electronExe, [__filename, "--child"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    },
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function verifyInElectronRuntime() {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const runtime = {
    electron: process.versions.electron || null,
    node: process.versions.node,
    modules: process.versions.modules
  };

  if (!runtime.electron) {
    throw new Error("Verificacao de modulos nativos deve correr dentro do runtime Electron.");
  }

  req("better-sqlite3-multiple-ciphers");
  console.log(
    JSON.stringify({
      ok: true,
      module: "better-sqlite3-multiple-ciphers",
      runtime
    })
  );
}

if (process.argv.includes("--child")) {
  try {
    verifyInElectronRuntime();
  } catch (error) {
    console.error(String(error?.stack || error));
    process.exit(1);
  }
} else {
  runElectronChild();
}
