const path = require("path");
const os = require("os");
const { app } = require("electron");
const { DatabaseService } = require("../electron/services/database");
const { angolaBanks } = require("../src/utils/payroll");

app.whenReady().then(() => {
  try {
    const db = new DatabaseService(process.cwd(), path.join(os.homedir(), "Documents"));
    const company = db.getCompanyProfile();
    const employees = db.listEmployees().map((item) => ({
      id: item.id,
      full_name: item.full_name,
      bank_code: item.bank_code,
      bank_account: item.bank_account,
      iban: item.iban,
      status: item.status
    }));
    const months = [...new Set(db.listPayrollRuns().map((run) => run.month_ref))].sort();
    const monthRef = months[months.length - 1] || "";
    const bank = angolaBanks.find((item) => item.code === "ATLANTICO") || angolaBanks[0];

    let ps2 = { ok: false, message: "Sem mês processado." };
    let psx = { ok: false, message: "Sem mês processado." };
    if (monthRef) {
      ps2 = db.exportBankPayrollFile(bank, monthRef, "ps2");
      psx = db.exportBankPayrollFile(bank, monthRef, "psx");
    }

    console.log(JSON.stringify({ company, employees, monthRef, ps2, psx }, null, 2));
  } catch (error) {
    console.error(`ERROR:${error.stack || error.message}`);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
