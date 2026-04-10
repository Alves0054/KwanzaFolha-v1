const { app, shell } = require("electron");
const { MailerService } = require("../../services/mailer");
const { PdfService } = require("../../services/pdf");
const { UpdaterService } = require("../../services/updater");
const { DatabaseService, createDbCore } = require("./db");
const { createAuthCore } = require("./auth");
const { createAttendanceCore } = require("./attendance");
const { createSettingsCore } = require("./settings");
const { createBackupsCore } = require("./backups");
const { createReportsCore } = require("./reports");
const { LicensingService, createLicensingCore } = require("./licensing");
const { createPayrollCore } = require("./payroll");

function createAppServices({
  userDataPath,
  documentsPath,
  programDataPath = null,
  secureStorage = null,
  installationIdentity = null
}) {
  const database = new DatabaseService(userDataPath, documentsPath, {
    programDataPath,
    secureStorage,
    installationIdentity
  });
  const mailer = new MailerService({ database, productName: app.getName() });
  const licensing = new LicensingService({
    app,
    userDataPath,
    currentVersion: app.getVersion(),
    productName: app.getName(),
    database,
    secureStorage,
    installationIdentity
  });
  const payrollCore = createPayrollCore(database);
  const pdf = new PdfService(database);
  const updater = new UpdaterService({
    app,
    shell,
    workspaceDir: userDataPath,
    currentVersion: app.getVersion(),
    productName: app.getName()
  });

  return {
    database,
    mailer,
    licensing,
    payroll: payrollCore.payroll,
    pdf,
    updater,
    db: createDbCore(database),
    auth: createAuthCore(database),
    attendance: createAttendanceCore(database),
    settings: createSettingsCore(database),
    backups: createBackupsCore(database),
    reports: createReportsCore(database, pdf, payrollCore.payroll),
    payrollCore,
    licensingCore: createLicensingCore(licensing)
  };
}

module.exports = {
  createAppServices
};
