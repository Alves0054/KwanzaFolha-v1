const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
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
    const checkResult = runNodeSyntaxCheck(tempFile, extractedContent.toString("utf8"));

    if (checkResult.error) {
      throw new Error(
        `Falha ao executar validacao de sintaxe de '${entryPath}' no app.asar: ${
          checkResult.error.message || checkResult.error
        }`
      );
    }

    if (typeof checkResult.status !== "number") {
      throw new Error(
        `Falha ao validar sintaxe de '${entryPath}' no app.asar: status de processo invalido.`
      );
    }

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

function runNodeSyntaxCheck(tempFile, sourceCode) {
  const candidates = [process.execPath, process.argv0, "node"].filter(Boolean);
  let lastResult = null;

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--check", tempFile], {
      encoding: "utf8"
    });
    lastResult = result;

    if (!result.error) {
      return result;
    }

    const message = String(result.error.message || "");
    const code = result.error.code;
    const isRecoverableSpawnIssue = code === "EPERM" || code === "ENOENT" || message.includes("spawnSync");
    if (!isRecoverableSpawnIssue) {
      return result;
    }
  }

  if (lastResult && lastResult.error) {
    try {
      new vm.Script(sourceCode, { filename: tempFile });
      return {
        status: 0,
        stdout: "",
        stderr: "",
        signal: null
      };
    } catch (parseError) {
      return {
        status: 1,
        stdout: "",
        stderr: String(parseError && parseError.stack ? parseError.stack : parseError),
        signal: null
      };
    }
  }

  return lastResult || { error: new Error("Nao foi possivel executar o runtime Node para validacao.") };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
