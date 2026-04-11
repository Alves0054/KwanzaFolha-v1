const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "1";
    args[key] = value;
    if (value !== "1") {
      index += 1;
    }
  }
  return args;
}

function resolveAsarApi() {
  try {
    return require("@electron/asar");
  } catch (error) {
    throw new Error(
      "Nao foi possivel carregar @electron/asar para validar o app empacotado. " +
        "Instale as dependencias e volte a executar."
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(process.cwd(), args.output || "dist-electron");
  const entryPath = args.entry || "electron/main.js";
  const asarPath = path.join(outputDir, "win-unpacked", "resources", "app.asar");

  if (!fs.existsSync(asarPath)) {
    throw new Error(`Nao encontrei app.asar em '${asarPath}'. Execute primeiro o build empacotado.`);
  }

  const asar = resolveAsarApi();
  let extractedContent = "";
  try {
    extractedContent = asar.extractFile(asarPath, entryPath);
  } catch (error) {
    throw new Error(`Nao foi possivel extrair '${entryPath}' do app.asar: ${error.message || error}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kwanza-main-check-"));
  const tempFile = path.join(tempDir, "packaged-main.js");

  try {
    fs.writeFileSync(tempFile, extractedContent, "utf8");
    const checkResult = spawnSync(process.execPath, ["--check", tempFile], {
      encoding: "utf8"
    });

    if (checkResult.status !== 0) {
      const details = [checkResult.stdout, checkResult.stderr].filter(Boolean).join("\n").trim();
      throw new Error(`Sintaxe invalida em '${entryPath}' dentro do app.asar.\n${details}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          asarPath,
          entryPath
        },
        null,
        2
      )
    );
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
