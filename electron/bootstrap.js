const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");

function resolveFallbackLogDir() {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || process.cwd(),
      "AppData",
      "Local"
    );
  return path.join(localAppData, "KwanzaFolha", "logs");
}

function appendFatalBootLog(error) {
  try {
    const logDir = resolveFallbackLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "bootstrap-fatal.log");
    const stamp = new Date().toISOString();
    const body = [
      `[${stamp}] Fatal bootstrap error`,
      `Message: ${String(error?.message || error || "Unknown error")}`,
      `Stack:`,
      String(error?.stack || "(sem stack)"),
      ""
    ].join("\n");
    fs.appendFileSync(logPath, body, "utf8");
    return logPath;
  } catch {
    return "";
  }
}

function showFatalDialog(error, logPath) {
  try {
    const detailParts = [
      String(error?.stack || error?.message || error || "Erro desconhecido.")
    ];
    if (logPath) {
      detailParts.push(`Log: ${logPath}`);
    }
    dialog.showErrorBox(
      "Kwanza Folha - Erro de Arranque",
      `Falha fatal ao iniciar a aplicacao.\n\n${detailParts.join("\n\n")}`
    );
  } catch {}
}

try {
  require("./main");
} catch (error) {
  const logPath = appendFatalBootLog(error);
  showFatalDialog(error, logPath);
  app.exit(1);
}
