const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const BetterSqlite3 = require("better-sqlite3");

const {
  DatabaseService,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  parseAttendanceImportContent
} = require("../electron/services/database");
const {
  GRUPO_A_IRT_BRACKETS,
  calculateAngolaPayrollGrupoA,
  calculateBaseIrtGrupoA,
  calculateInssGrupoA,
  calculateIRT,
  calculateIrtGrupoA,
  calculateSalary,
  calculateAttendanceDeductions,
  calculateLegalDeductions,
  calculatePayrollRunForEmployee,
  normalizeSubsidios,
  summarizeAttendanceRecords,
  summarizeFinancialObligations,
  sumSubsidiosGrupoA,
  PayrollService
} = require("../electron/services/payroll");
const { LicensingService } = require("../electron/services/licensing");
const { MailerService } = require("../electron/services/mailer");
const { PdfService } = require("../electron/services/pdf");
const { UpdaterService, extractSemanticVersion, resolveReleaseVersion } = require("../electron/services/updater");
const { buildFiscalProfile, resolveFiscalProfileForMonth } = require("../electron/services/fiscal-config");
const { hasPermission, getPermissionDeniedMessage } = require("../electron/services/permissions");
const { buildReleaseManifest, collectReleaseArtifacts, writeReleaseBundle } = require("../scripts/release-artifacts");
const { DEFAULT_LICENSE_PLAN } = require("../shared/license-plans");
const { LicensingServer } = require("../licensing-server/server");

const brackets = DEFAULT_SETTINGS.irtBrackets;

const pendingTests = [];

function runTest(name, fn) {
  const execution = Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      console.error(error.stack || error.message || error);
      process.exitCode = 1;
    });

  pendingTests.push(execution);
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function buildAoIban(bankRegistryCode, accountDigits = "00000000000000000") {
  const countryCode = "AO";
  const bban = `${String(bankRegistryCode || "").padStart(4, "0")}${String(accountDigits || "").padStart(17, "0")}`;
  const candidate = `${bban}${countryCode}00`;
  let remainder = 0;

  for (const character of candidate) {
    const fragment = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of fragment) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  const checksum = String(98 - remainder).padStart(2, "0");
  return `${countryCode}${checksum}${bban}`;
}

runTest("IRT aplica escalÃµes legais", () => {
  assert.equal(calculateIRT(100000, brackets), 0);
  assert.equal(calculateIRT(100001, brackets), 0.13);
  assert.equal(calculateIRT(150001, brackets), 6500.16);
  assert.equal(calculateIRT(194000, brackets), 13540);
});

runTest("Salário legal calcula segurança social e matéria colectável", () => {
  const result = calculateSalary(200000, brackets);
  assert.deepEqual(result, {
    salarioBase: 200000,
    segurancaSocial: 6000,
    materiaColectavel: 194000,
    irt: 13540,
    salarioLiquido: 180460
  });
});

runTest("Grupo A calcula INSS e IRT sobre a remuneracao tributavel do periodo", () => {
  const result = calculateAngolaPayrollGrupoA({
    salarioBase: 200000,
    subsidios: [
      { descricao: "Subsidio de Alimentacao", valor: 30000 },
      { descricao: "Subsidio de Transporte", valor: 20000 }
    ]
  });

  assert.deepEqual(result, {
    salarioBase: 200000,
    subsidios: 50000,
    salarioBruto: 250000,
    baseInss: 250000,
    irtBaseBeforeInss: 250000,
    inss: 7500,
    baseIRT: 242500,
    irt: 22150,
    salarioLiquido: 220350
  });
});

runTest("Grupo A usa a tabela progressiva em JSON com a formula parcela fixa mais taxa marginal", () => {
  assert.deepEqual(GRUPO_A_IRT_BRACKETS, [
    { min: 0, max: 100000, rate: 0, fixed: 0 },
    { min: 100000, max: 150000, rate: 0.13, fixed: 0 },
    { min: 150000, max: 200000, rate: 0.16, fixed: 6500 },
    { min: 200000, max: 300000, rate: 0.18, fixed: 14500 },
    { min: 300000, max: 500000, rate: 0.19, fixed: 32500 },
    { min: 500000, max: 1000000, rate: 0.2, fixed: 70500 },
    { min: 1000000, max: Infinity, rate: 0.21, fixed: 170500 }
  ]);
  assert.equal(calculateInssGrupoA(120000), 3600);
  assert.equal(calculateBaseIrtGrupoA(120000, 3600), 116400);
  assert.equal(calculateIrtGrupoA(116400), 2132);
});

runTest("Perfil fiscal escolhe a versao legal pela data de vigencia do mes", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    activeFiscalProfileId: "ao-irt-lei-28-20-202604",
    fiscalProfiles: [
      buildFiscalProfile({
        ...DEFAULT_SETTINGS.fiscalProfiles[0],
        id: DEFAULT_SETTINGS.activeFiscalProfileId,
        name: DEFAULT_SETTINGS.fiscalProfiles[0].name,
        effectiveFrom: "2020-09",
        inssEmployeeRate: 3,
        inssEmployerRate: 8,
        irtBrackets: DEFAULT_SETTINGS.irtBrackets
      }),
      buildFiscalProfile({
        id: "ao-irt-lei-28-20-202604",
        name: "Perfil fiscal abril 2026",
        effectiveFrom: "2026-04",
        inssEmployeeRate: 4,
        inssEmployerRate: 10,
        irtBrackets: DEFAULT_SETTINGS.irtBrackets
      })
    ]
  };

  const marchProfile = resolveFiscalProfileForMonth(settings, "2026-03");
  const aprilProfile = resolveFiscalProfileForMonth(settings, "2026-04");

  assert.equal(marchProfile.id, DEFAULT_SETTINGS.activeFiscalProfileId);
  assert.equal(marchProfile.effectiveFrom, "2020-09");
  assert.equal(marchProfile.inssEmployerRate, 8);
  assert.equal(aprilProfile.id, "ao-irt-lei-28-20-202604");
  assert.equal(aprilProfile.inssEmployeeRate, 4);
  assert.equal(aprilProfile.inssEmployerRate, 10);
});

runTest("Perfil fiscal padrao declara base legal atual sem UCF", () => {
  const defaultProfile = DEFAULT_SETTINGS.fiscalProfiles[0];

  assert.equal(defaultProfile.effectiveFrom, "2020-09");
  assert.match(defaultProfile.legalReference, /Lei n\.º 18\/14/i);
  assert.match(defaultProfile.legalReference, /Lei n\.º 28\/20/i);
  assert.match(defaultProfile.notes, /3%\s*trabalhador/i);
  assert.match(defaultProfile.notes, /8%\s*entidade empregadora/i);
  assert.doesNotMatch(defaultProfile.notes, /UCF|Despacho\s*n\.?\s*1\/00|Janeiro de 2000/i);
});

runTest("Fontes fiscais centrais nao referenciam UCF nem a regra de Janeiro de 2000", () => {
  const targets = [
    path.join(__dirname, "..", "electron", "services", "fiscal-config.js"),
    path.join(__dirname, "..", "electron", "services", "database.js"),
    path.join(__dirname, "..", "electron", "services", "angola-payroll-group-a.js"),
    path.join(__dirname, "..", "electron", "services", "core", "fiscal", "index.js")
  ];

  for (const target of targets) {
    const content = fs.readFileSync(target, "utf8");
    assert.doesNotMatch(
      content,
      /Despacho\s*n\.?\s*1\/00|Janeiro de 2000|Unidade de Corre[cç][aã]o Fiscal|[^a-z]UCF[^a-z]|effectiveFrom:\s*"2000-01"|DEFAULT_FISCAL_EFFECTIVE_FROM\s*=\s*"2000-01"/i
    );
  }
});

runTest("DatabaseService ativa foreign keys e regista migracoes formais", () => {
  const basePath = makeTempDir("kwanza-db-schema-");
  const documentsPath = makeTempDir("kwanza-documents-schema-");
  const service = new DatabaseService(basePath, documentsPath);

  try {
    assert.equal(service.db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(service.db.pragma("user_version", { simple: true }), CURRENT_SCHEMA_VERSION);

    const migrations = service.db
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC")
      .all();
    assert.equal(migrations.length, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(
      migrations.map((migration) => migration.version),
      Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1)
    );

    const payrollIndexes = service.db.prepare("PRAGMA index_list(payroll_runs)").all().map((row) => row.name);
    assert.ok(payrollIndexes.includes("idx_payroll_runs_month_generated_at"));
  } finally {
    service.prepareForShutdown();
  }
});

runTest("DatabaseService migra base legada e preserva dados principais", () => {
  const basePath = makeTempDir("kwanza-db-legacy-");
  const documentsPath = makeTempDir("kwanza-documents-legacy-");
  const legacyDbPath = path.join(basePath, "kwanza-folha.sqlite");
  const legacyDb = new BetterSqlite3(legacyDbPath);

  legacyDb.exec(`
    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE company_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      nif TEXT,
      email TEXT,
      address TEXT,
      phone TEXT,
      logo_path TEXT,
      updated_at TEXT
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      bi TEXT NOT NULL,
      nif TEXT NOT NULL,
      job_title TEXT NOT NULL,
      department TEXT NOT NULL,
      base_salary REAL NOT NULL,
      contract_type TEXT NOT NULL,
      hire_date TEXT NOT NULL,
      iban TEXT,
      status TEXT NOT NULL,
      recurring_allowances TEXT NOT NULL DEFAULT '[]',
      recurring_bonuses TEXT NOT NULL DEFAULT '[]',
      special_payments TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  legacyDb
    .prepare("INSERT INTO system_settings (id, json, updated_at) VALUES (1, ?, ?)")
    .run(JSON.stringify({ currency: "Kz" }), "2026-04-08T10:00:00.000Z");
  legacyDb
    .prepare("INSERT INTO company_profile (id, name, nif, email, address, phone, logo_path, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)")
    .run("Empresa Legada", "5000000000", "empresa@example.com", "Luanda", "222000000", "", "2026-04-08T10:00:00.000Z");
  legacyDb
    .prepare("INSERT INTO users (full_name, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("Admin Legado", "admin", "hash", "admin", 1, "2026-04-08T10:00:00.000Z");
  legacyDb
    .prepare(`
      INSERT INTO employees (
        full_name, bi, nif, job_title, department, base_salary, contract_type,
        hire_date, iban, status, recurring_allowances, recurring_bonuses, special_payments, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?)
    `)
    .run(
      "Maria Antonia",
      "123456789LA000",
      "5000000012",
      "Tecnica de RH",
      "Recursos Humanos",
      180000,
      "effective",
      "2025-01-02",
      "AO06004000000000000000000",
      "active",
      "2026-04-08T10:00:00.000Z",
      "2026-04-08T10:00:00.000Z"
    );
  legacyDb.close();

  const service = new DatabaseService(basePath, documentsPath);

  try {
    assert.equal(service.db.pragma("user_version", { simple: true }), CURRENT_SCHEMA_VERSION);
    assert.equal(service.hasColumn("users", "email"), true);
    assert.equal(service.hasColumn("users", "must_change_password"), true);
    assert.equal(service.hasColumn("company_profile", "origin_bank_code"), true);
    assert.equal(service.hasColumn("employees", "attendance_code"), true);
    assert.equal(service.hasColumn("employees", "shift_id"), true);

    const employee = service.db.prepare("SELECT full_name, attendance_code FROM employees WHERE id = 1").get();
    assert.equal(employee.full_name, "Maria Antonia");
    assert.equal(employee.attendance_code, null);
  } finally {
    service.prepareForShutdown();
  }
});

runTest("Repositorio documental guarda anexos, sinaliza validade e remove ficheiro gerido", () => {
  const basePath = makeTempDir("kwanza-db-documents-");
  const documentsPath = makeTempDir("kwanza-documents-repo-");
  const service = new DatabaseService(basePath, documentsPath);

  try {
    const employeeResult = service.saveEmployee({
      full_name: "Marta Domingos",
      document_type: "bi",
      bi: "123456789LA042",
      driver_license_number: "",
      nif: "5000000023",
      social_security_number: "12345678901",
      attendance_code: "EMP001",
      birth_date: "1995-03-12",
      gender: "feminino",
      marital_status: "solteira",
      nationality: "Angolana",
      personal_phone: "",
      personal_email: "",
      address: "Luanda",
      job_title: "Analista de RH",
      department: "RH",
      base_salary: 250000,
      contract_type: "Indeterminado",
      hire_date: "2025-01-10",
      shift_id: "",
      iban: buildAoIban("0040", "12345678901234567"),
      bank_code: "BAI",
      bank_account: "004012345678901234567",
      status: "ativo",
      notes: "",
      recurring_allowances: [],
      recurring_bonuses: [],
      special_payments: []
    });

    assert.equal(employeeResult.ok, true);
    const employee = employeeResult.employees.find((item) => item.full_name === "Marta Domingos");
    assert.ok(employee);

    const sourceDir = makeTempDir("kwanza-doc-source-");
    const sourceFile = path.join(sourceDir, "contrato-trabalho.pdf");
    fs.writeFileSync(sourceFile, "documento de teste", "utf8");
    const expiryDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

    const saveResult = service.saveEmployeeDocument({
      employee_id: employee.id,
      category: "contract",
      title: "Contrato de trabalho",
      document_number: "CT-2026-001",
      issuer: "Kwanza Folha",
      issue_date: "2026-04-01",
      effective_date: "2026-04-01",
      expiry_date: expiryDate,
      alert_days_before: 10,
      notes: "Documento inicial de teste.",
      status: "active",
      file_path: sourceFile
    }, null);

    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.items.length, 1);
    assert.equal(saveResult.items[0].lifecycle_status, "expiring");
    assert.equal(saveResult.items[0].file_exists, true);
    assert.match(saveResult.items[0].stored_file_path, /Documentos Laborais/i);
    assert.equal(fs.existsSync(saveResult.items[0].stored_file_path), true);

    const alerts = service.listEmployeeDocumentAlerts({ daysAhead: 10 });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].title, "Contrato de trabalho");

    const storedPath = saveResult.items[0].stored_file_path;
    const deleteResult = service.deleteEmployeeDocument(saveResult.items[0].id);
    assert.equal(deleteResult.ok, true);
    assert.equal(fs.existsSync(storedPath), false);
  } finally {
    service.prepareForShutdown();
  }
});

runTest("Subsídios obrigatórios por evento usam o salário base integral", () => {
  const result = calculatePayrollRunForEmployee(
    {
      base_salary: 180000,
      recurring_allowances: [],
      recurring_bonuses: [],
      special_payments: []
    },
    {
      ...DEFAULT_SETTINGS,
      vacationMonth: 6,
      christmasMonth: 12
    },
    [
      { event_type: "vacation_bonus", quantity: 1 },
      { event_type: "christmas_bonus", quantity: 1 }
    ],
    "2026-05",
    [],
    [],
    [],
    []
  );

  assert.deepEqual(
    result.bonuses.map((item) => item.amount),
    [180000, 180000]
  );
});

runTest("Permissoes separam operacao do dia a dia de acoes criticas", () => {
  const admin = { role: "admin" };
  const operator = { role: "operador" };

  assert.equal(hasPermission(admin, "employees.manage"), true);
  assert.equal(hasPermission(operator, "employees.view"), true);
  assert.equal(hasPermission(operator, "events.manage"), true);
  assert.equal(hasPermission(operator, "attendance.manage"), true);
  assert.equal(hasPermission(operator, "vacation.manage"), true);
  assert.equal(hasPermission(operator, "employees.manage"), false);
  assert.equal(hasPermission(operator, "financial.manage"), false);
  assert.equal(hasPermission(operator, "vacation.balance.manage"), false);
  assert.equal(hasPermission(operator, "payroll.process"), false);
  assert.equal(getPermissionDeniedMessage("payroll.process"), "O seu perfil nao tem permissao para processar a folha salarial.");
});

runTest("Configuracoes criam nova versao fiscal com o mes de vigencia escolhido", () => {
  const result = DatabaseService.prototype.buildVersionedFiscalSettings.call({}, DEFAULT_SETTINGS, {
    inssEmployeeRate: 4,
    inssEmployerRate: 9,
    irtBrackets: DEFAULT_SETTINGS.irtBrackets,
    fiscalProfileEffectiveFrom: "2026-07",
    fiscalProfileName: "Perfil fiscal Julho 2026",
    fiscalProfileLegalReference: "Validacao AGT 07/2026",
    fiscalProfileNotes: "Entrada em vigor acordada para julho"
  });

  const juneProfile = resolveFiscalProfileForMonth(result, "2026-06");
  const julyProfile = resolveFiscalProfileForMonth(result, "2026-07");

  assert.equal(juneProfile.inssEmployeeRate, DEFAULT_SETTINGS.inssEmployeeRate);
  assert.equal(julyProfile.effectiveFrom, "2026-07");
  assert.equal(julyProfile.inssEmployeeRate, 4);
  assert.equal(julyProfile.inssEmployerRate, 9);
  assert.equal(julyProfile.name, "Perfil fiscal Julho 2026");
  assert.equal(julyProfile.legalReference, "Validacao AGT 07/2026");
  assert.ok(result.fiscalProfiles.some((profile) => profile.effectiveFrom === "2026-07"));
});

runTest("Sessao assinada restaura utilizador valido e rejeita adulteracao", () => {
  const userDataPath = makeTempDir("kwanza-session-user-");
  const service = {
    sessionPath: path.join(userDataPath, "session-state.json"),
    sessionSecretPath: path.join(userDataPath, "session-state.key"),
    sessionSecret: null,
    getSessionSecret: DatabaseService.prototype.getSessionSecret,
    signSessionPayload: DatabaseService.prototype.signSessionPayload,
    readSessionPayload: DatabaseService.prototype.readSessionPayload,
    persistSession: DatabaseService.prototype.persistSession,
    clearSession: DatabaseService.prototype.clearSession,
    restoreSession: DatabaseService.prototype.restoreSession,
    getAuthenticatedUser: DatabaseService.prototype.getAuthenticatedUser,
    isInitialSetupPending() {
      return false;
    },
    getUserById(userId) {
      if (Number(userId) !== 7) {
        return null;
      }
      return {
        id: 7,
        username: "admin",
        full_name: "Administrador",
        role: "admin",
        active: 1,
        must_change_password: 0
      };
    },
    getUserPayload(user) {
      return {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: "",
        role: user.role,
        must_change_password: Boolean(user.must_change_password)
      };
    }
  };

  service.persistSession(7);
  assert.ok(fs.existsSync(service.sessionPath));
  assert.ok(fs.existsSync(service.sessionSecretPath));

  const persistedEnvelope = JSON.parse(fs.readFileSync(service.sessionPath, "utf8"));
  assert.equal(persistedEnvelope.version, 1);
  assert.equal(typeof persistedEnvelope.payload, "string");
  assert.equal(typeof persistedEnvelope.signature, "string");

  const restored = service.restoreSession();
  assert.equal(restored.ok, true);
  assert.equal(restored.user.username, "admin");

  const tamperedEnvelope = {
    ...persistedEnvelope,
    payload: Buffer.from(JSON.stringify({ userId: 999999, savedAt: new Date().toISOString() }), "utf8").toString("base64")
  };
  fs.writeFileSync(service.sessionPath, JSON.stringify(tamperedEnvelope, null, 2), "utf8");

  const tamperedRestore = service.restoreSession();
  assert.equal(tamperedRestore.ok, false);
  assert.equal(service.getAuthenticatedUser(), null);
  assert.equal(fs.existsSync(service.sessionPath), false);
});

runTest("Mapa mensal AGT valida identificacao fiscal e agrega bases tributaveis", () => {
  const result = DatabaseService.prototype.buildAgtMonthlyRemunerationMap.call(
    {
      getCompanyProfile() {
        return { name: "Empresa Teste", nif: "5000000000" };
      },
      listPayrollRuns() {
        return [
          {
            id: 1,
            employee_id: 12,
            month_ref: "2026-04",
            full_name: "Carlos Silva",
            department: "RH",
            job_title: "Tecnico",
            nif: "1234567890",
            bi: "004455667LA012",
            social_security_number: "12345678901",
            inss_amount: 6000,
            irt_amount: 14000,
            gross_salary: 250000,
            summary_json: {
              payableGrossSalary: 247500,
              fiscalProfileVersion: "abc123",
              fiscalProfile: { name: "Perfil fiscal abril 2026" },
              legalBases: {
                irtBaseBeforeSocialSecurity: 247500,
                materiaColectavel: 241500
              }
            }
          }
        ];
      }
    },
    "2026-04"
  );

  assert.equal(result.ok, true);
  assert.equal(result.validation.ready, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].gross_remuneration, 247500);
  assert.equal(result.items[0].taxable_base, 241500);
  assert.equal(result.totals.irtWithheld, 14000);
  assert.equal(result.validation.missingEmployeeNiss, 0);
  assert.equal(result.validation.inconsistentRows, 0);
});

runTest("Grupo A valida entradas numericas e evita NaN", () => {
  assert.throws(() => calculateAngolaPayrollGrupoA({ salarioBase: "abc", subsidios: [] }), /salarioBase/i);
  assert.throws(() => normalizeSubsidios([{ descricao: "Alimentacao", valor: "x" }]), /subsidios\[0\]\.valor/i);
  assert.equal(sumSubsidiosGrupoA([{ descricao: "A", valor: 1000 }, 2000]), 3000);
});

runTest("Faltas e licenças usam salário base dividido por 30", () => {
  const result = calculateAttendanceDeductions(300000, 2, 1);
  assert.equal(result.dailyRate, 10000);
  assert.equal(result.absenceDeduction, 20000);
  assert.equal(result.leaveDeduction, 10000);
  assert.equal(result.attendanceDeduction, 30000);
});

runTest("Folha separa base bruta das bases legais e calcula horas extra depois da remuneraÃ§Ã£o", () => {
  const employee = {
    id: 1,
    full_name: "Carlos Silva",
    base_salary: 200000,
    recurring_allowances: [{ label: "Alimentacao", amount: 20000 }],
    recurring_bonuses: [{ label: "Desempenho", amount: 10000 }],
    special_payments: []
  };

  const settings = {
    ...DEFAULT_SETTINGS,
    vacationMonth: 8,
    christmasMonth: 12
  };

  const events = [
    { event_type: "overtime_50", quantity: 10, description: "", amount: 0 },
    { event_type: "absence", quantity: 1, description: "", amount: 0 },
    { event_type: "penalty", quantity: 1, description: "Multa", amount: 5000 }
  ];

  const result = calculatePayrollRunForEmployee(employee, settings, events, "2026-04");
  assert.equal(result.remunerationBase, 230000);
  assert.equal(result.overtimeTotal, 19602.27);
  assert.equal(result.grossSalary, 249602.27);
  assert.equal(result.payableGrossSalary, 242935.6);
  assert.equal(result.legalBases.socialSecurityBase, 242935.6);
  assert.equal(result.legalBases.irtBaseBeforeSocialSecurity, 242935.6);
  assert.equal(result.legalBases.materiaColectavel, 235647.53);
  assert.equal(result.inssAmount, 7288.07);
  assert.equal(result.irtAmount, 20916.56);
  assert.equal(result.absenceDeduction, 6666.67);
  assert.equal(result.mandatoryDeductions, 33204.63);
  assert.equal(result.totalDeductions, 39871.3);
  assert.equal(result.netSalary, 209730.97);
  assert.equal(result.employerCost, 262370.45);
});

runTest("Encargos legais explicitam a base do INSS e do IRT", () => {
  const result = calculateLegalDeductions(350000, 8, brackets);
  assert.equal(result.socialSecurityBase, 350000);
  assert.equal(result.irtBaseBeforeSocialSecurity, 350000);
  assert.equal(result.segurancaSocial, 10500);
  assert.equal(result.materiaColectavel, 339500);
  assert.equal(result.irt, 40005);
  assert.equal(result.employerInssAmount, 28000);
});

runTest("Folha fiscal respeita a classificacao por verba e reduz a base por faltas", () => {
  const result = calculatePayrollRunForEmployee(
    {
      id: 2,
      full_name: "Ana Costa",
      base_salary: 200000,
      recurring_allowances: [{ label: "Alimentacao", amount: 20000, fiscalMode: "taxable" }],
      recurring_bonuses: [
        { label: "Bonus Comercial", amount: 10000, fiscalMode: "irt_only" },
        { label: "Abono Interno", amount: 5000, fiscalMode: "exempt" }
      ],
      special_payments: []
    },
    DEFAULT_SETTINGS,
    [{ event_type: "absence", quantity: 1, description: "", amount: 0 }],
    "2026-04"
  );

  assert.equal(result.grossSalary, 235000);
  assert.equal(result.payableGrossSalary, 228333.33);
  assert.equal(result.legalBases.socialSecurityBase, 213333.33);
  assert.equal(result.legalBases.irtBaseBeforeSocialSecurity, 223333.33);
  assert.equal(result.legalBases.materiaColectavel, 216933.33);
  assert.equal(result.inssAmount, 6400);
  assert.equal(result.irtAmount, 17548);
  assert.equal(result.netSalary, 204385.33);
  assert.deepEqual(
    result.fiscalBreakdown.irtBaseItems.map((item) => item.label),
    ["Salario base", "Alimentacao", "Bonus Comercial", "Reducao por faltas sem vencimento"]
  );
});

runTest("Empréstimos e adiantamentos geram desconto automático no mês devido", () => {
  const summary = summarizeFinancialObligations(
    [
      {
        id: 10,
        active: true,
        entry_type: "loan",
        label: "Empréstimo pessoal",
        principal_amount: 120000,
        installment_count: 6,
        installment_amount: 20000,
        start_month_ref: "2026-01"
      },
      {
        id: 11,
        active: true,
        entry_type: "advance",
        label: "Adiantamento de salário",
        principal_amount: 30000,
        installment_count: 3,
        installment_amount: 10000,
        start_month_ref: "2026-03"
      }
    ],
    "2026-04"
  );

  assert.equal(summary.total, 30000);
  assert.equal(summary.items.length, 2);
  assert.equal(summary.items[0].installmentIndex, 4);
  assert.equal(summary.items[1].installmentIndex, 2);
});

runTest("Folha inclui empréstimos e adiantamentos no total de descontos", () => {
  const employee = {
    id: 1,
    full_name: "Carlos Silva",
    base_salary: 200000,
    recurring_allowances: [],
    recurring_bonuses: [],
    special_payments: []
  };

  const result = calculatePayrollRunForEmployee(
    employee,
    DEFAULT_SETTINGS,
    [],
    "2026-04",
    [],
    [],
    [
      {
        id: 15,
        active: true,
        entry_type: "loan",
        label: "Empréstimo",
        principal_amount: 60000,
        installment_count: 6,
        installment_amount: 10000,
        start_month_ref: "2026-02"
      }
    ]
  );

  assert.equal(result.financialDeductions, 10000);
  assert.equal(result.totalDeductions, 29540);
  assert.equal(result.netSalary, 170460);
});

runTest("Validação de registo financeiro rejeita prestações incoerentes", () => {
  const service = {
    db: {
      prepare() {
        return {
          get() {
            return { id: 1, full_name: "Maria Fernandes", hire_date: "2024-05-10" };
          }
        };
      }
    }
  };

  const invalid = DatabaseService.prototype.validateFinancialObligationPayload.call(service, {
    employee_id: 1,
    entry_type: "loan",
    label: "Emp",
    principal_amount: 100000,
    installment_count: 4,
    installment_amount: 40000,
    start_month_ref: "2024-04"
  });
  assert.equal(invalid.ok, false);
});

runTest("Empresa exige banco e conta de origem em conjunto para PS2/PSX", () => {
  let savedCompany = null;
  const service = {
    db: {
      prepare() {
        return {
          run(payload) {
            savedCompany = { ...payload };
          }
        };
      }
    },
    getSystemSettings() {
      return { ...DEFAULT_SETTINGS };
    },
    saveSystemSettings() {},
    getCompanyProfile() {
      return {
        name: savedCompany?.name || "",
        nif: savedCompany?.nif || "",
        email: savedCompany?.email || "",
        address: savedCompany?.address || "",
        phone: savedCompany?.phone || "",
        logo_path: savedCompany?.logo_path || "",
        origin_bank_code: savedCompany?.origin_bank_code || "",
        origin_account: savedCompany?.origin_account || ""
      };
    }
  };

  const invalid = DatabaseService.prototype.saveCompanyProfile.call(service, {
    name: "Empresa Teste",
    nif: "5000000001",
    origin_bank_code: "ATLANTICO",
    origin_account: ""
  });
  assert.equal(invalid.ok, false);

  const valid = DatabaseService.prototype.saveCompanyProfile.call(service, {
    name: "Empresa Teste",
    nif: "5000000001",
    origin_bank_code: "ATLANTICO",
    origin_account: "300200100999"
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.company.origin_bank_code, "ATLANTICO");
  assert.equal(valid.company.origin_account, "300200100999");
});

runTest("Validação do funcionário identifica o banco pelo IBAN quando o código é reconhecido", () => {
  const service = {
    db: {
      prepare() {
        return {
          get() {
            return null;
          }
        };
      }
    },
    findSalaryScaleForEmployee() {
      return null;
    }
  };
  const iban = buildAoIban("0040", "00000000000001234");

  const result = DatabaseService.prototype.validateEmployeePayload.call(service, {
    full_name: "Carlos Manuel",
    bi: "123456789LA042",
    nif: "5001234567",
    social_security_number: "12345678",
    birth_date: "1990-01-10",
    gender: "Masculino",
    marital_status: "Solteiro(a)",
    nationality: "Angolana",
    personal_phone: "+244951055152",
    personal_email: "carlos@empresa.ao",
    address: "Luanda",
    job_title: "Analista",
    department: "Financeiro",
    contract_type: "Indeterminado",
    hire_date: "2024-03-01",
    shift_id: "",
    iban,
    bank_code: "",
    bank_account: "",
    notes: "",
    base_salary: 150000
  });

  assert.equal(result.ok, true);
  assert.equal(result.sanitized.bank_code, "BAI");
});

runTest("Preparação da recuperação de acesso gera um codigo temporario e mascara o e-mail", () => {
  const service = {
    isInitialSetupPending() {
      return false;
    },
    db: {
      prepare() {
        return {
          get() {
            return {
              id: 7,
              full_name: "Maria Fernandes",
              username: "maria",
              email: "maria.fernandes@empresa.ao",
              active: 1,
              password_hash: "hash-atual",
              must_change_password: 0
            };
          }
        };
      }
    }
  };

  const result = DatabaseService.prototype.preparePasswordReset.call(service, "maria");
  assert.equal(result.ok, true);
  assert.equal(result.reset.username, "maria");
  assert.equal(result.reset.email, "maria.fernandes@empresa.ao");
  assert.match(result.reset.maskedEmail, /@empresa\.ao$/);
  assert.match(result.reset.resetToken, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/);
  assert.ok(new Date(result.reset.expiresAt).getTime() > Date.now());
});

runTest("Recuperacao de acesso consome um codigo valido e grava a nova palavra-passe", () => {
  let storedHash = "";
  let consumedToken = null;
  let revokedTokens = null;

  const service = {
    isInitialSetupPending() {
      return false;
    },
    runInTransaction(work) {
      return work();
    },
    listUsers() {
      return [{ id: 7, username: "maria" }];
    },
    db: {
      prepare(sql) {
        if (sql.includes("FROM users") && sql.includes("active = 1")) {
          return {
            get() {
              return {
                id: 7,
                full_name: "Maria Fernandes",
                username: "maria",
                email: "maria.fernandes@empresa.ao",
                active: 1
              };
            }
          };
        }
        if (sql.includes("FROM password_reset_tokens")) {
          return {
            get() {
              return {
                id: 11,
                user_id: 7,
                token_hash: "hash",
                expires_at: "2099-04-30T10:00:00.000Z"
              };
            }
          };
        }
        if (sql.includes("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")) {
          return {
            run(passwordHash) {
              storedHash = passwordHash;
            }
          };
        }
        if (sql.includes("UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?")) {
          return {
            run(consumedAt, id) {
              consumedToken = { consumedAt, id };
            }
          };
        }
        if (sql.includes("UPDATE password_reset_tokens") && sql.includes("id != ?")) {
          return {
            run(revokedAt, userId, id) {
              revokedTokens = { revokedAt, userId, id };
            }
          };
        }
        throw new Error(`SQL inesperado: ${sql}`);
      }
    }
  };

  const result = DatabaseService.prototype.completePasswordReset.call(service, {
    identifier: "maria",
    resetToken: "ABCD-EFGH-JKLM",
    newPassword: "nova1234"
  });

  assert.equal(result.ok, true);
  assert.equal(bcrypt.compareSync("nova1234", storedHash), true);
  assert.equal(consumedToken.id, 11);
  assert.equal(revokedTokens.userId, 7);
});

runTest("Login aceita utilizador ou e-mail em minúsculas com hash bcrypt", () => {
  const userRecord = {
    id: 9,
    full_name: "Maria Fernandes",
    email: "maria@empresa.ao",
    username: "maria",
    role: "admin",
    active: 1,
    must_change_password: 0,
    password_hash: bcrypt.hashSync("segredo123", 10)
  };

  const service = {
    isInitialSetupPending() {
      return false;
    },
    db: {
      prepare() {
        return {
          get() {
            return userRecord;
          }
        };
      }
    },
    getUserPayload: DatabaseService.prototype.getUserPayload
  };

  const loginByUsername = DatabaseService.prototype.login.call(service, {
    username: "maria",
    password: "segredo123"
  });
  assert.equal(loginByUsername.ok, true);
  assert.equal(loginByUsername.user.username, "maria");

  const loginByEmail = DatabaseService.prototype.login.call(service, {
    username: "MARIA@EMPRESA.AO",
    password: "segredo123"
  });
  assert.equal(loginByEmail.ok, true);
  assert.equal(loginByEmail.user.email, "maria@empresa.ao");
});

runTest("Login aceita hashes sha256 legadas e atualiza-as para bcrypt", () => {
  const userRecord = {
    id: 11,
    full_name: "Rita Almeida",
    email: "rita@empresa.ao",
    username: "rita",
    role: "admin",
    active: 1,
    must_change_password: 0,
    password_hash: require("node:crypto").createHash("sha256").update("segredo123").digest("hex")
  };
  const updates = [];

  const service = {
    isInitialSetupPending() {
      return false;
    },
    db: {
      prepare(sql) {
        if (sql.includes("SELECT * FROM users")) {
          return {
            get() {
              return userRecord;
            }
          };
        }
        if (sql.includes("UPDATE users SET password_hash = ? WHERE id = ?")) {
          return {
            run(nextHash, userId) {
              updates.push({ nextHash, userId });
            }
          };
        }
        throw new Error(`SQL inesperado: ${sql}`);
      }
    },
    getUserPayload: DatabaseService.prototype.getUserPayload
  };

  const result = DatabaseService.prototype.login.call(service, {
    username: "rita",
    password: "segredo123"
  });

  assert.equal(result.ok, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].userId, 11);
  assert.match(updates[0].nextHash, /^\$2[aby]\$/);
});

runTest("Correio eletrónico valida campos SMTP obrigatórios antes de enviar", () => {
  const mailer = new MailerService({
    database: {
      getSystemSettings() {
        return {
          ...DEFAULT_SETTINGS,
          smtpHost: "",
          smtpPort: 587,
          smtpUser: "",
          smtpPassword: "",
          smtpFromEmail: ""
        };
      },
      getCompanyProfile() {
        return { name: "Empresa Teste", email: "info@empresa.ao" };
      }
    },
    productName: "Kwanza Folha"
  });

  const result = mailer.validateMailConfig();
  assert.equal(result.ok, false);
  assert.match(result.message, /SMTP/i);
});

runTest("Licença local cifrada valida token assinado e expiração offline", () => {
  const userDataPath = makeTempDir("kwanza-license-cache-");
  const service = new LicensingService({
    app: { isPackaged: false },
    userDataPath,
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  const keyPair = require("node:crypto").generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  service.getPublicKey = () => keyPair.publicKey;
  const payload = {
    serial_key: "KWZ-ABCD-EF12-3456-7890",
    plan: DEFAULT_LICENSE_PLAN.name,
    max_users: null,
    start_date: "2026-04-01",
    expire_date: "2099-04-30",
    status: "active",
    email: "cliente@empresa.ao",
    company_name: "Empresa Teste",
    device_hash: service.buildDeviceHash(),
    issued_at: new Date().toISOString()
  };

  const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const signer = require("node:crypto").createSign("RSA-SHA256");
  signer.update(payloadBuffer);
  signer.end();
  const token = `${payloadBuffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}.${signer
    .sign(keyPair.privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;

  service.saveLocalLicense({
    license_token: token,
    integrity: service.buildRuntimeIntegrity()
  });

  const status = service.getLicenseStatus(true);
  assert.equal(status.ok, true);
  assert.equal(status.status, "active");
  assert.equal(status.canUseApp, true);
  assert.equal(status.plan, DEFAULT_LICENSE_PLAN.name);
});

runTest("Licenciamento permite o registo inicial antes da compra da licença", () => {
  const service = new LicensingService({
    app: { isPackaged: false },
    userDataPath: makeTempDir("kwanza-license-setup-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha",
    database: {
      getLicenseTrialContext() {
        return {
          setupRequired: true,
          trialStartedAt: "",
          companyName: "",
          companyEmail: "",
          companyPhone: "",
          companyNif: "",
          adminEmail: ""
        };
      }
    }
  });

  const status = service.getLicenseStatus(true);
  assert.equal(status.status, "setup_required");
  assert.equal(status.canUseApp, true);
});

runTest("Licenciamento mantém 7 dias gratuitos ativos após o registo inicial", () => {
  const service = new LicensingService({
    app: { isPackaged: false },
    userDataPath: makeTempDir("kwanza-license-trial-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha",
    database: {
      getLicenseTrialContext() {
        return {
          setupRequired: false,
          trialStartedAt: new Date().toISOString(),
          companyName: "Empresa Exemplo",
          companyEmail: "empresa@exemplo.ao",
          companyPhone: "923000000",
          companyNif: "5000000000",
          adminEmail: "admin@exemplo.ao"
        };
      }
    }
  });

  const status = service.getLicenseStatus(true);
  assert.equal(status.status, "trial_active");
  assert.equal(status.canUseApp, true);
  assert.equal(status.trialDaysTotal, 7);
  assert.ok(status.trialDaysRemaining >= 1);
});

runTest("Licenciamento bloqueia o aplicativo quando os 7 dias gratuitos terminam", () => {
  const service = new LicensingService({
    app: { isPackaged: false },
    userDataPath: makeTempDir("kwanza-license-expired-trial-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha",
    database: {
      getLicenseTrialContext() {
        return {
          setupRequired: false,
          trialStartedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
          companyName: "Empresa Exemplo",
          companyEmail: "empresa@exemplo.ao",
          companyPhone: "923000000",
          companyNif: "5000000000",
          adminEmail: "admin@exemplo.ao"
        };
      }
    }
  });

  const status = service.getLicenseStatus(true);
  assert.equal(status.status, "trial_expired");
  assert.equal(status.canUseApp, false);
  assert.match(status.message, /7 dias/i);
});

runTest("Licenciamento tecnico de desenvolvimento libera a edicao local por 1 ano", () => {
  const service = new LicensingService({
    app: { isPackaged: true, getAppPath: () => "C:\\Users\\nunes\\Documents\\Pagamentos\\dist-electron\\win-unpacked\\resources\\app.asar" },
    userDataPath: makeTempDir("kwanza-license-dev-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha",
    database: {
      getCompanyProfile() {
        return { name: "Empresa Dev" };
      }
    },
    installationIdentity: {
      getFingerprintPayload() {
        return {
          installId: "dev-install",
          fingerprintHash: "hash",
          hardwareSnapshot: {},
          canonicalHardwareData: {},
          riskFlags: [],
          createdAt: "2026-04-09T10:00:00.000Z"
        };
      }
    }
  });

  const status = service.getLicenseStatus(true);
  assert.equal(status.status, "developer_active");
  assert.equal(status.canUseApp, true);
  assert.equal(status.requiresLicense, false);
  assert.equal(status.trialDaysTotal, 365);
  assert.match(status.message, /Licença técnica de desenvolvimento ativa/i);
});

runTest("Licenciamento tecnico nao entra em producao instalada fora do ambiente local", () => {
  const service = new LicensingService({
    app: { isPackaged: true, getAppPath: () => "C:\\Program Files\\Kwanza Folha\\resources\\app.asar" },
    userDataPath: makeTempDir("kwanza-license-prod-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha",
    database: {
      getLicenseTrialContext() {
        return { setupRequired: true };
      }
    }
  });

  assert.equal(service.isDevelopmentLicenseMode(), false);
});

runTest("Marcador tecnico local nao ativa licenciamento em instalacao de producao", () => {
  const userDataPath = makeTempDir("kwanza-license-prod-marker-");
  fs.writeFileSync(
    path.join(userDataPath, "developer-license.json"),
    JSON.stringify({ enabled: true, startedAt: "2026-04-10T00:00:00.000Z", expireDate: "2027-04-10T00:00:00.000Z" }),
    "utf8"
  );

  const service = new LicensingService({
    app: { isPackaged: true, getAppPath: () => "C:\\Program Files\\Kwanza Folha\\resources\\app.asar" },
    userDataPath,
    currentVersion: "1.0.0",
    productName: "Kwanza Folha",
    database: {
      getLicenseTrialContext() {
        return { setupRequired: true };
      }
    }
  });

  assert.equal(service.isDevelopmentLicenseMode(), false);
});

runTest("Webhook de pagamento confirma a referência paga com segredo válido", async () => {
  const confirmedReferences = [];
  const service = {
    settings: {
      webhook: {
        secret: "segredo-webhook",
        paidStatuses: ["paid", "confirmed"],
        cancelledStatuses: ["cancelled"]
      }
    },
    getWebhookSettings: LicensingServer.prototype.getWebhookSettings,
    parseWebhookAmount: LicensingServer.prototype.parseWebhookAmount,
    normalizeWebhookStatus: LicensingServer.prototype.normalizeWebhookStatus,
    validateWebhookRequest: LicensingServer.prototype.validateWebhookRequest,
    normalizeWebhookPayload: LicensingServer.prototype.normalizeWebhookPayload,
    getPaymentByReference(reference) {
      return { reference, amount: 15000, status: "pending" };
    },
    async confirmPayment(reference) {
      confirmedReferences.push(reference);
      return { ok: true, reference, status: "paid", serial_key: "KWZ-TEST-0001-0002-0003" };
    },
    cancelPayment(reference) {
      return { ok: true, reference, status: "cancelled" };
    }
  };

  const result = await LicensingServer.prototype.handlePaymentWebhook.call(
    service,
    {
      headers: {
        "x-kwanza-webhook-secret": "segredo-webhook"
      }
    },
    {
      data: {
        reference_number: "928374",
        status: "paid"
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.webhook_status, "paid");
  assert.equal(result.received_amount, null);
  assert.deepEqual(confirmedReferences, ["928374"]);
});

runTest("Webhook de pagamento rejeita pedido sem segredo válido", async () => {
  const service = {
    settings: {
      webhook: {
        secret: "segredo-webhook",
        paidStatuses: ["paid"],
        cancelledStatuses: ["cancelled"]
      }
    },
    getWebhookSettings: LicensingServer.prototype.getWebhookSettings,
    parseWebhookAmount: LicensingServer.prototype.parseWebhookAmount,
    normalizeWebhookStatus: LicensingServer.prototype.normalizeWebhookStatus,
    validateWebhookRequest: LicensingServer.prototype.validateWebhookRequest,
    normalizeWebhookPayload: LicensingServer.prototype.normalizeWebhookPayload,
    getPaymentByReference() {
      return { reference: "928374", amount: 15000, status: "pending" };
    },
    async confirmPayment() {
      throw new Error("Não deveria confirmar o pagamento sem autorização.");
    },
    cancelPayment() {
      throw new Error("Não deveria cancelar o pagamento sem autorização.");
    }
  };

  const result = await LicensingServer.prototype.handlePaymentWebhook.call(
    service,
    {
      headers: {}
    },
    {
      reference: "928374",
      status: "paid"
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 401);
  assert.match(result.message, /autorizado/i);
});

runTest("Webhook de pagamento valida o valor recebido quando ele vem no payload", async () => {
  const service = {
    settings: {
      webhook: {
        secret: "",
        paidStatuses: ["paid"],
        cancelledStatuses: ["cancelled"],
        requireAmountMatch: true
      }
    },
    getWebhookSettings: LicensingServer.prototype.getWebhookSettings,
    parseWebhookAmount: LicensingServer.prototype.parseWebhookAmount,
    normalizeWebhookStatus: LicensingServer.prototype.normalizeWebhookStatus,
    validateWebhookRequest: LicensingServer.prototype.validateWebhookRequest,
    normalizeWebhookPayload: LicensingServer.prototype.normalizeWebhookPayload,
    getPaymentByReference(reference) {
      return { reference, amount: 15000, status: "pending" };
    },
    async confirmPayment() {
      throw new Error("Não deveria confirmar com valor divergente.");
    },
    cancelPayment() {
      throw new Error("Não deveria cancelar neste cenário.");
    }
  };

  const result = await LicensingServer.prototype.handlePaymentWebhook.call(
    service,
    { headers: {} },
    {
      transaction: {
        reference: "928374",
        status: "payment.confirmed",
        amount: "20.000,00",
        provider: "gateway-real"
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.expected_amount, 15000);
  assert.equal(result.received_amount, 20000);
});

runTest("Autenticação administrativa aceita bearer token com hash", () => {
  const service = {
    settings: {
      admin: {
        tokenHash: require("node:crypto").createHash("sha256").update("token-admin-seguro").digest("hex")
      }
    },
    getAdminAuthSettings: LicensingServer.prototype.getAdminAuthSettings
  };

  const result = LicensingServer.prototype.authenticateAdminRequest.call(service, {
    headers: {
      authorization: "Bearer token-admin-seguro"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, "bearer");
});

runTest("Rate limiting bloqueia excesso de pedidos administrativos", () => {
  const service = {
    rateLimitBuckets: new Map(),
    settings: {
      rateLimit: {
        windowMs: 60000,
        maxRequests: 50,
        maxSensitiveRequests: 10,
        maxAdminRequests: 1
      }
    },
    getRateLimitSettings: LicensingServer.prototype.getRateLimitSettings,
    resolveClientIp: LicensingServer.prototype.resolveClientIp
  };
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.writeHeaders = headers;
    },
    end(body) {
      this.body = body;
    }
  };
  const request = {
    headers: {},
    socket: {
      remoteAddress: "127.0.0.1"
    }
  };

  const first = LicensingServer.prototype.consumeRateLimit.call(service, "admin", request, response);
  const second = LicensingServer.prototype.consumeRateLimit.call(service, "admin", request, response);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(response.statusCode, 429);
  assert.match(response.body, /demasiados pedidos/i);
});

runTest("Licenciamento reutiliza referencia pendente no mesmo checkout", () => {
  let reusableLookup = null;
  const service = {
    settings: {
      sales: {
        enabled: true
      }
    },
    getSalesSettings: LicensingServer.prototype.getSalesSettings,
    isCommercialLicensingEnabled: LicensingServer.prototype.isCommercialLicensingEnabled,
    getCommercialLicensingMessage: LicensingServer.prototype.getCommercialLicensingMessage,
    getPlan() {
      return { code: "standard", name: "Plano Standard", price: 15000, maxUsers: 10 };
    },
    upsertCustomer() {
      return { id: 4 };
    },
    findReusablePendingPayment(payload) {
      reusableLookup = payload;
      return {
        reference: "123456789012",
        amount: 15000,
        valid_until: "2026-04-07T10:00:00.000Z"
      };
    },
    generateReference() {
      throw new Error("Nao deveria gerar nova referencia quando existe pagamento pendente reutilizavel.");
    }
  };

  const result = LicensingServer.prototype.createPayment.call(service, {
    empresa: "Empresa Teste",
    nif: "5000000001",
    email: "financeiro@empresa.ao",
    telefone: "+244923000001",
    renewal: true,
    serial_key: "KWZ-ABCD-EFGH-IJKL"
  });

  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.reference, "123456789012");
  assert.deepEqual(reusableLookup, {
    userId: 4,
    planCode: "standard",
    renewal: 1,
    serialKey: "KWZ-ABCD-EFGH-IJKL"
  });
});

runTest("Licenciamento comercial fica suspenso por omissão", () => {
  const service = {
    settings: {
      sales: {}
    },
    getSalesSettings: LicensingServer.prototype.getSalesSettings,
    isCommercialLicensingEnabled: LicensingServer.prototype.isCommercialLicensingEnabled,
    getCommercialLicensingMessage: LicensingServer.prototype.getCommercialLicensingMessage
  };

  const result = LicensingServer.prototype.createPayment.call(service, {
    company_name: "Empresa Piloto",
    email: "piloto@empresa.ao"
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /temporariamente suspenso/i);
});

runTest("Confirmacao de pagamento retoma entrega pendente sem duplicar a confirmacao principal", async () => {
  let confirmedReference = "";
  let deliveredInvoicePath = "";
  const service = {
    settings: {
      sales: {
        enabled: true
      }
    },
    getSalesSettings: LicensingServer.prototype.getSalesSettings,
    isCommercialLicensingEnabled: LicensingServer.prototype.isCommercialLicensingEnabled,
    getCommercialLicensingMessage: LicensingServer.prototype.getCommercialLicensingMessage,
    confirmPaymentCore(reference) {
      confirmedReference = reference;
      return {
        ok: true,
        payment: { id: 9, reference: "123456789012" },
        license: { serial_key: "KWZ-TEST-0001-0002-0003", expire_date: "2026-12-31" },
        invoice: { id: 7, invoice_number: "FT-20260406-0001", pdf_path: "C:\\temp\\invoice.pdf" },
        plan: { name: "Plano Standard" },
        user: { email: "cliente@empresa.ao" }
      };
    },
    async ensureInvoicePdfArtifact() {
      return { ok: true, path: "C:\\temp\\invoice.pdf" };
    },
    async ensureInvoiceEmailDelivery({ invoicePath }) {
      deliveredInvoicePath = invoicePath;
      return { ok: false, message: "SMTP indisponivel no momento." };
    },
    getInvoiceByPaymentId() {
      return { invoice_number: "FT-20260406-0001", pdf_path: "C:\\temp\\invoice.pdf" };
    }
  };

  const result = await LicensingServer.prototype.confirmPayment.call(service, "123456789012");

  assert.equal(result.ok, true);
  assert.equal(result.status, "paid");
  assert.equal(result.invoice_ready, true);
  assert.equal(result.email_sent, false);
  assert.equal(confirmedReference, "123456789012");
  assert.equal(deliveredInvoicePath, "C:\\temp\\invoice.pdf");
  assert.equal(result.invoice_number, "FT-20260406-0001");
});

runTest("Build empacotada recusa servidor de licenciamento sem HTTPS", async () => {
  const userDataPath = makeTempDir("kwanza-license-api-");
  const service = new LicensingService({
    app: { isPackaged: true },
    userDataPath,
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  const previousApiUrl = process.env.KWANZA_LICENSE_API_URL;
  const previousAllowInsecureApi = process.env.KWANZA_ALLOW_INSECURE_LICENSE_API;
  delete process.env.KWANZA_ALLOW_INSECURE_LICENSE_API;
  process.env.KWANZA_LICENSE_API_URL = "http://127.0.0.1:3055";

  try {
    const result = await service.apiRequest("/payment/status", { reference: "123456789012" });
    assert.equal(result.ok, false);
    assert.match(result.message, /HTTPS/i);
  } finally {
    if (previousApiUrl === undefined) {
      delete process.env.KWANZA_LICENSE_API_URL;
    } else {
      process.env.KWANZA_LICENSE_API_URL = previousApiUrl;
    }

    if (previousAllowInsecureApi === undefined) {
      delete process.env.KWANZA_ALLOW_INSECURE_LICENSE_API;
    } else {
      process.env.KWANZA_ALLOW_INSECURE_LICENSE_API = previousAllowInsecureApi;
    }
  }
});

runTest("Endpoint público de confirmação manual responde 403", async () => {
  const response = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(payload = "") {
      this.body = payload;
    }
  };

  const service = {
    rateLimitBuckets: new Map(),
    settings: {
      rateLimit: {
        windowMs: 60000,
        maxRequests: 50,
        maxSensitiveRequests: 10,
        maxAdminRequests: 5
      }
    },
    getRateLimitSettings: LicensingServer.prototype.getRateLimitSettings,
    resolveClientIp: LicensingServer.prototype.resolveClientIp,
    consumeRateLimit: LicensingServer.prototype.consumeRateLimit
  };

  await LicensingServer.prototype.handleRequest.call(
    service,
    {
      method: "POST",
      url: "/payment/confirm",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" }
    },
    response
  );

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /desativado/i);
});

runTest("ValidaÃ§Ã£o avanÃ§ada de funcionÃ¡rio rejeita BI, NIF, IBAN e datas invÃ¡lidas", () => {
  const validation = DatabaseService.prototype.validateEmployeePayload({
    full_name: "Jo",
    bi: "ABC",
    nif: "12A",
    job_title: "",
    department: "",
    base_salary: 0,
    contract_type: "",
    hire_date: "2026-13-50",
    iban: "123"
  });
  assert.equal(validation.ok, false);

  const ibanValidation = DatabaseService.prototype.validateEmployeePayload({
    full_name: "Joao Pedro",
    bi: "123456789LA042",
    nif: "50014781",
    job_title: "Tecnico",
    department: "RH",
    base_salary: 100000,
    contract_type: "Indeterminado",
    hire_date: "2024-05-10",
    bank_code: "ATLANTICO",
    bank_account: "12345",
    iban: "AO06004400001123456789012"
  });
  assert.equal(ibanValidation.ok, false);
  assert.match(ibanValidation.message, /IBAN/i);
});

runTest("ValidaÃ§Ã£o avanÃ§ada aceita dados fortes e datas coerentes", () => {
  const validation = DatabaseService.prototype.validateEmployeePayload({
    full_name: "Maria Fernandes",
    bi: "123456789LA042",
    nif: "50014781",
    job_title: "Tecnica",
    department: "RH",
    base_salary: 150000,
    contract_type: "Indeterminado",
    hire_date: "2024-05-10",
    bank_code: "ATLANTICO",
    bank_account: "000600000123456789311",
    iban: "AO62000600000123456789311"
  });
  assert.equal(validation.ok, true);
});

runTest("Validação do funcionário aceita passaporte e carta de condução opcional", () => {
  const validation = DatabaseService.prototype.validateEmployeePayload({
    full_name: "Jean Claude",
    document_type: "passport",
    bi: "PA4455667",
    driver_license_number: "LC-998877",
    nif: "50014781",
    job_title: "Consultor",
    department: "Operações",
    base_salary: 180000,
    contract_type: "Indeterminado",
    hire_date: "2024-05-10",
    bank_code: "ATLANTICO",
    bank_account: "000600000123456789311",
    iban: "AO62000600000123456789311"
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.sanitized.document_type, "passport");
  assert.equal(validation.sanitized.driver_license_number, "LC-998877");
});

runTest("Escala salarial por função valida intervalos e bloqueia salários fora da faixa definida", () => {
  const scaleValidation = DatabaseService.prototype.validateSalaryScalePayload.call(
    {
      db: {
        prepare() {
          return {
            get() {
              return null;
            }
          };
        }
      }
    },
    {
      job_title: "Técnico de RH",
      department: "RH",
      min_salary: 120000,
      reference_salary: 150000,
      max_salary: 180000,
      notes: "Escala base do departamento",
      active: true
    }
  );
  assert.equal(scaleValidation.ok, true);

  const employeeValidationService = {
    db: {},
    findSalaryScaleForEmployee() {
      return scaleValidation.sanitized;
    }
  };

  const invalidEmployee = DatabaseService.prototype.validateEmployeePayload.call(employeeValidationService, {
    full_name: "Paulo Ernesto",
    bi: "123456789LA042",
    nif: "50014781",
    social_security_number: "221158073",
    job_title: "Técnico de RH",
    department: "RH",
    base_salary: 90000,
    contract_type: "Indeterminado",
    hire_date: "2024-05-10",
    bank_code: "ATLANTICO",
    bank_account: "000600000123456789311",
    iban: "AO62000600000123456789311"
  });
  assert.equal(invalidEmployee.ok, false);
  assert.match(invalidEmployee.message, /escala salarial/i);

  const validEmployee = DatabaseService.prototype.validateEmployeePayload.call(employeeValidationService, {
    full_name: "Paulo Ernesto",
    bi: "123456789LA042",
    nif: "50014781",
    social_security_number: "221158073",
    job_title: "Técnico de RH",
    department: "RH",
    base_salary: 150000,
    contract_type: "Indeterminado",
    hire_date: "2024-05-10",
    bank_code: "ATLANTICO",
    bank_account: "000600000123456789311",
    iban: "AO62000600000123456789311"
  });
  assert.equal(validEmployee.ok, true);
});

runTest("Turnos validam horários, perfil e dias de trabalho", () => {
  const service = {
    db: {
      prepare() {
        return {
          get() {
            return null;
          }
        };
      }
    }
  };

  const validShift = DatabaseService.prototype.validateWorkShiftPayload.call(service, {
    code: "DOC-MANHA",
    name: "Docente - Manhã",
    department: "Corpo Docente",
    profile: "docente_morning",
    start_time: "07:30",
    end_time: "12:30",
    tolerance_minutes: 10,
    break_minutes: 15,
    working_days: [1, 2, 3, 4, 5],
    active: true
  });
  assert.equal(validShift.ok, true);
  assert.match(validShift.sanitized.class_blocks_json, /Bloco letivo/);

  const invalidShift = DatabaseService.prototype.validateWorkShiftPayload.call(service, {
    code: "X",
    name: "Noite",
    profile: "general",
    start_time: "18:00",
    end_time: "08:00",
    working_days: []
  });
  assert.equal(invalidShift.ok, false);
});

runTest("Parser de importação de assiduidade reconhece colunas de biométrico/cartão", () => {
  const rows = parseAttendanceImportContent([
    "codigo;data;hora;estado;equipamento",
    "DOC-001;03/04/2026;07:42;Atraso;Terminal A",
    "DOC-001;03/04/2026;12:35;Saida;Terminal A"
  ].join("\n"));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].employee_code, "DOC-001");
  assert.equal(rows[0].attendance_date, "2026-04-03");
  assert.equal(rows[0].time, "07:42");
  assert.equal(rows[0].status, "delay");
  assert.equal(rows[1].status, "present");
});

runTest("Sincronização por pasta monitorizada agrega ficheiros, deduplica e preserva o perfil do dispositivo", () => {
  const watchedFolder = makeTempDir("kwanza-attendance-watch-");
  const calls = [];
  const service = {
    getSystemSettings() {
      return {
        ...DEFAULT_SETTINGS,
        attendanceWatchedFolder: watchedFolder,
        attendanceWatchedSourceType: "card",
        attendanceCardProfile: "card_generic",
        attendanceIncrementalImport: true
      };
    },
    importAttendanceFile(payload) {
      calls.push(payload);
      if (payload.file_path.endsWith("terminal-a.csv")) {
        return { ok: true, duplicated: true, summary: { imported: 0, skipped: 0 } };
      }
      return { ok: true, duplicated: false, summary: { imported: 2, skipped: 1 } };
    }
  };

  fs.writeFileSync(path.join(watchedFolder, "terminal-a.csv"), "teste", "utf8");
  fs.writeFileSync(path.join(watchedFolder, "terminal-b.txt"), "teste", "utf8");
  fs.writeFileSync(path.join(watchedFolder, "ignorar.pdf"), "teste", "utf8");

  const result = DatabaseService.prototype.syncAttendanceWatchedFolder.call(service);
  assert.equal(result.ok, true);
  assert.equal(result.processedFiles, 1);
  assert.equal(result.duplicateFiles, 1);
  assert.equal(result.errorFiles, 0);
  assert.equal(result.importedRows, 2);
  assert.equal(result.skippedRows, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.source_type === "card"));
  assert.ok(calls.every((item) => item.device_profile === "card_generic"));
  assert.ok(calls.every((item) => item.import_mode === "watched_folder"));
  assert.ok(calls.every((item) => item.incremental_import === true));
});

runTest("Validação de licença rejeita datas incoerentes", () => {
  const service = {
    db: {
      prepare() {
        return {
          get() {
            return { id: 1, full_name: "Maria Fernandes", hire_date: "2024-05-10" };
          }
        };
      }
    }
  };

  const validation = DatabaseService.prototype.validateLeaveRequestPayload.call(service, {
    employee_id: 1,
    record_type: "leave_without_pay",
    start_date: "2024-05-15",
    end_date: "2024-05-10",
    days: 2,
    reason: "Licença"
  });
  assert.equal(validation.ok, false);
  assert.match(validation.message, /data final/i);
});

runTest("Validação de férias rejeita sobreposição com licença e saldo insuficiente", () => {
  const service = {
    db: {
      prepare(sql) {
        return {
          get() {
            if (sql.includes("FROM employees")) {
              return { id: 1, full_name: "Maria Fernandes", hire_date: "2024-05-10" };
            }
            if (sql.includes("FROM vacation_requests")) {
              return null;
            }
            if (sql.includes("FROM leave_requests")) {
              return { id: 2 };
            }
            return null;
          },
          all() {
            return [];
          }
        };
      }
    },
    calculateVacationYearSummary() {
      return {
        remainingDays: 5
      };
    }
  };

  const overlap = DatabaseService.prototype.validateVacationRequestPayload.call(service, {
    employee_id: 1,
    year_ref: "2026",
    start_date: "2026-08-10",
    end_date: "2026-08-15",
    days: 6
  });
  assert.equal(overlap.ok, false);
  assert.match(overlap.message, /licença ou ausência/i);

  service.db.prepare = (sql) => ({
    get() {
      if (sql.includes("FROM employees")) {
        return { id: 1, full_name: "Maria Fernandes", hire_date: "2024-05-10" };
      }
      return null;
    },
    all() {
      return [];
    }
  });

  const insufficient = DatabaseService.prototype.validateVacationRequestPayload.call(service, {
    employee_id: 1,
    year_ref: "2026",
    start_date: "2026-08-10",
    end_date: "2026-08-15",
    days: 6
  });
  assert.equal(insufficient.ok, false);
  assert.match(insufficient.message, /saldo disponível/i);
});

runTest("Validação de assiduidade rejeita datas inválidas e estados desconhecidos", () => {
  const service = {
    db: {
      prepare() {
        return {
          get() {
            return { id: 1, full_name: "Maria Fernandes", hire_date: "2024-05-10" };
          }
        };
      }
    }
  };

  const invalidDate = DatabaseService.prototype.validateAttendancePayload.call(service, {
    employee_id: 1,
    attendance_date: "2024-02-30",
    status: "present"
  });
  assert.equal(invalidDate.ok, false);
  assert.match(invalidDate.message, /data da assiduidade/i);

  const invalidStatus = DatabaseService.prototype.validateAttendancePayload.call(service, {
    employee_id: 1,
    attendance_date: "2024-05-15",
    status: "unknown"
  });
  assert.equal(invalidStatus.ok, false);
  assert.match(invalidStatus.message, /estado da assiduidade/i);
});

runTest("Validação de assiduidade infere a contagem de marcações do dia", () => {
  const service = {
    db: {
      prepare() {
        return {
          get() {
            return { id: 1, full_name: "Maria Fernandes", hire_date: "2024-05-10", shift_id: null };
          }
        };
      }
    }
  };

  const complete = DatabaseService.prototype.validateAttendancePayload.call(service, {
    employee_id: 1,
    attendance_date: "2024-05-15",
    status: "present",
    check_in_time: "08:00",
    check_out_time: "17:00"
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.sanitized.punch_count, 2);

  const singlePunch = DatabaseService.prototype.validateAttendancePayload.call(service, {
    employee_id: 1,
    attendance_date: "2024-05-16",
    status: "present",
    check_in_time: "08:00",
    check_out_time: "08:00"
  });
  assert.equal(singlePunch.ok, true);
  assert.equal(singlePunch.sanitized.punch_count, 1);

  const explicitPunches = DatabaseService.prototype.validateAttendancePayload.call(service, {
    employee_id: 1,
    attendance_date: "2024-05-17",
    status: "present",
    check_in_time: "08:00",
    check_out_time: "17:00",
    punch_count: 4
  });
  assert.equal(explicitPunches.ok, true);
  assert.equal(explicitPunches.sanitized.punch_count, 4);
});

runTest("Resumo de assiduidade converte atrasos acumulados em penalização automática", () => {
  const summary = summarizeAttendanceRecords(
    [
      { status: "present", delay_minutes: 0 },
      { status: "delay", delay_minutes: 125 },
      { status: "delay", delay_minutes: 120 },
      { status: "half_absence", delay_minutes: 0 },
      { status: "absent", delay_minutes: 0 },
      { status: "leave", delay_minutes: 0 }
    ],
    {
      attendanceDelayPenaltyThresholdMinutes: 120,
      attendanceDelayPenaltyEquivalentDays: 0.5
    }
  );

  assert.equal(summary.presentDays, 1);
  assert.equal(summary.delayDays, 2);
  assert.equal(summary.absenceDays, 1);
  assert.equal(summary.halfAbsenceDays, 1);
  assert.equal(summary.leaveDays, 1);
  assert.equal(summary.totalDelayMinutes, 245);
  assert.equal(summary.absenceEquivalentDays, 1.5);
  assert.equal(summary.delayPenaltyDays, 1);
});

runTest("Folha considera faltas injustificadas e licenças sem vencimento aprovadas", () => {
  const employee = {
    id: 1,
    full_name: "Carlos Silva",
    base_salary: 300000,
    recurring_allowances: [],
    recurring_bonuses: [],
    special_payments: []
  };

  const result = calculatePayrollRunForEmployee(employee, DEFAULT_SETTINGS, [], "2026-04", [
    { record_type: "unjustified_absence", start_date: "2026-04-03", end_date: "2026-04-04", days: 2 },
    { record_type: "leave_without_pay", start_date: "2026-04-10", end_date: "2026-04-10", days: 1 },
    { record_type: "medical_leave", start_date: "2026-04-15", end_date: "2026-04-16", days: 2 }
  ]);

  assert.equal(result.absencesDays, 2);
  assert.equal(result.leaveDays, 1);
  assert.equal(result.medicalLeaveDays, 2);
  assert.equal(result.absenceDeduction, 20000);
  assert.equal(result.leaveDeduction, 10000);
});

runTest("Folha usa a assiduidade aprovada para reforçar faltas, licenças e atrasos relevantes", () => {
  const employee = {
    id: 1,
    full_name: "Carlos Silva",
    base_salary: 300000,
    recurring_allowances: [],
    recurring_bonuses: [],
    special_payments: []
  };

  const result = calculatePayrollRunForEmployee(
    employee,
    {
      ...DEFAULT_SETTINGS,
      attendanceDelayPenaltyThresholdMinutes: 120,
      attendanceDelayPenaltyEquivalentDays: 0.5
    },
    [],
    "2026-04",
    [],
    [],
    [],
    [
      { status: "absent", delay_minutes: 0 },
      { status: "half_absence", delay_minutes: 0 },
      { status: "delay", delay_minutes: 120 },
      { status: "leave", delay_minutes: 0 }
    ]
  );

  assert.equal(result.attendanceAbsencesDays, 2);
  assert.equal(result.attendanceLeaveDays, 1);
  assert.equal(result.delayPenaltyDays, 0.5);
  assert.equal(result.absencesDays, 2);
  assert.equal(result.leaveDays, 1);
  assert.equal(result.absenceDeduction, 20000);
  assert.equal(result.leaveDeduction, 10000);
});

runTest("PayrollService bloqueia processamento em perÃ­odo fechado", () => {
  const database = {
    ensurePeriodOpen: () => ({ ok: false, message: "O perÃ­odo 2026-05 estÃ¡ fechado e nÃ£o pode ser alterado." }),
    validateEmployeesForPayroll: () => ({ ok: true }),
    getSystemSettings: () => DEFAULT_SETTINGS,
    listEmployees: () => [],
    listEvents: () => [],
    listLeaveRequests: () => [],
    listVacationRequests: () => []
  };
  const payroll = new PayrollService(database);
  const result = payroll.processMonth("2026-05");
  assert.equal(result.ok, false);
  assert.match(result.message, /fechado/i);
});

runTest("PayrollService exige a assiduidade mensal fechada antes do processamento", () => {
  const database = {
    ensurePeriodOpen: () => ({ ok: true }),
    ensureAttendancePeriodClosed: () => ({ ok: false, message: "Feche a assiduidade de 2026-06 antes de processar a folha." }),
    validateEmployeesForPayroll: () => ({ ok: true }),
    getSystemSettings: () => DEFAULT_SETTINGS,
    listEmployees: () => [],
    listEvents: () => [],
    listLeaveRequests: () => [],
    listVacationRequests: () => []
  };
  const payroll = new PayrollService(database);
  const result = payroll.processMonth("2026-06");
  assert.equal(result.ok, false);
  assert.match(result.message, /assiduidade/i);
});

runTest("PayrollService bloqueia processamento quando a validaÃ§Ã£o dos funcionÃ¡rios falha", () => {
  const database = {
    ensurePeriodOpen: () => ({ ok: true }),
    ensureAttendancePeriodClosed: () => ({ ok: true }),
    validateEmployeesForPayroll: () => ({ ok: false, message: "Existem dados inválidos." }),
    getSystemSettings: () => DEFAULT_SETTINGS,
    listEmployees: () => [],
    listEvents: () => [],
    listLeaveRequests: () => [],
    listVacationRequests: () => []
  };
  const payroll = new PayrollService(database);
  const result = payroll.processMonth("2026-06");
  assert.equal(result.ok, false);
  assert.match(result.message, /dados inválidos/i);
});

runTest("PayrollService bloqueia processamento sem funcionários ativos", () => {
  const database = {
    ensurePeriodOpen: () => ({ ok: true }),
    ensureAttendancePeriodClosed: () => ({ ok: true }),
    validateEmployeesForPayroll: () => ({ ok: true }),
    getSystemSettings: () => DEFAULT_SETTINGS,
    listEmployees: () => [],
    listEvents: () => [],
    listLeaveRequests: () => [],
    listVacationRequests: () => []
  };
  const payroll = new PayrollService(database);
  const result = payroll.processMonth("2026-06");
  assert.equal(result.ok, false);
  assert.match(result.message, /funcionários ativos/i);
});

runTest("PayrollService reprocessa o mes aberto e grava a versao fiscal aplicada", () => {
  let savedSnapshot = null;
  const settings = {
    ...DEFAULT_SETTINGS,
    activeFiscalProfileId: "ao-irt-lei-28-20-202604",
    fiscalProfiles: [
      buildFiscalProfile({
        ...DEFAULT_SETTINGS.fiscalProfiles[0],
        id: DEFAULT_SETTINGS.activeFiscalProfileId,
        name: DEFAULT_SETTINGS.fiscalProfiles[0].name,
        effectiveFrom: "2020-09",
        inssEmployeeRate: 3,
        inssEmployerRate: 8,
        irtBrackets: DEFAULT_SETTINGS.irtBrackets
      }),
      buildFiscalProfile({
        id: "ao-irt-lei-28-20-202604",
        name: "Perfil fiscal abril 2026",
        effectiveFrom: "2026-04",
        inssEmployeeRate: 4,
        inssEmployerRate: 10,
        irtBrackets: DEFAULT_SETTINGS.irtBrackets
      })
    ]
  };
  const database = {
    ensurePeriodOpen: () => ({ ok: true }),
    ensureAttendancePeriodClosed: () => ({ ok: true }),
    validateEmployeesForPayroll: () => ({ ok: true }),
    getSystemSettings: () => settings,
    listEmployees: () => [
      {
        id: 1,
        full_name: "Carlos Silva",
        status: "ativo",
        base_salary: 200000,
        recurring_allowances: [],
        recurring_bonuses: [],
        special_payments: []
      }
    ],
    listEvents: () => [],
    listLeaveRequests: () => [],
    listVacationRequests: () => [],
    listAttendanceRecords: () => [],
    listFinancialObligations: () => [],
    savePayrollRunsSnapshot(monthRef, payrollRuns, options) {
      savedSnapshot = {
        monthRef,
        options,
        payrollRuns
      };
    }
  };

  const payroll = new PayrollService(database);
  const result = payroll.reprocessMonth("2026-04");

  assert.equal(result.ok, true);
  assert.equal(savedSnapshot.monthRef, "2026-04");
  assert.deepEqual(savedSnapshot.options, { resetExisting: true });
  assert.equal(result.fiscalProfile.id, "ao-irt-lei-28-20-202604");
  assert.equal(savedSnapshot.payrollRuns.length, 1);
  const savedSummary = JSON.parse(savedSnapshot.payrollRuns[0].summary_json);
  assert.equal(savedSummary.fiscalProfile.id, "ao-irt-lei-28-20-202604");
  assert.equal(savedSummary.fiscalProfileVersion, result.fiscalProfile.version);
});

runTest("PayrollService exige autorizacao para reprocessar periodo fechado", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    fiscalProfiles: [
      buildFiscalProfile({
        id: "ao-irt-lei-28-20-202604",
        name: "Perfil fiscal abril 2026",
        effectiveFrom: "2026-04",
        inssEmployeeRate: 3,
        inssEmployerRate: 8,
        irtBrackets: DEFAULT_SETTINGS.irtBrackets
      })
    ],
    activeFiscalProfileId: "ao-irt-lei-28-20-202604"
  };
  const historicalSummary = {
    baseSalary: 200000,
    grossSalary: 200000,
    netSalary: 180000,
    irtAmount: 14000,
    inssAmount: 6000,
    attendanceDeduction: 0,
    financialDeductions: 0,
    employerInssAmount: 16000,
    employerCost: 216000,
    fiscalProfile: { id: "perfil-antigo", name: "Perfil antigo", version: "old-version" },
    fiscalProfileVersion: "old-version"
  };
  const database = {
    getPayrollPeriod: () => ({ month_ref: "2026-04", status: "closed" }),
    getAttendancePeriod: () => ({ month_ref: "2026-04", status: "closed" }),
    ensureAttendancePeriodClosed: () => ({ ok: true }),
    validateEmployeesForPayroll: () => ({ ok: true }),
    getSystemSettings: () => settings,
    listEmployees: () => [
      {
        id: 1,
        full_name: "Carlos Silva",
        status: "ativo",
        base_salary: 200000,
        recurring_allowances: [],
        recurring_bonuses: [],
        special_payments: []
      }
    ],
    listEvents: () => [],
    listLeaveRequests: () => [],
    listVacationRequests: () => [],
    listAttendanceRecords: () => [],
    listFinancialObligations: () => [],
    listPayrollRuns: () => [
      {
        id: 7,
        employee_id: 1,
        month_ref: "2026-04",
        full_name: "Carlos Silva",
        department: "RH",
        job_title: "Tecnico",
        inss_amount: 6000,
        irt_amount: 14000,
        gross_salary: 200000,
        net_salary: 180000,
        absence_deduction: 0,
        summary_json: historicalSummary
      }
    ],
    savePayrollRunsSnapshot() {
      throw new Error("Nao devia persistir sem autorizacao.");
    }
  };

  const payroll = new PayrollService(database);
  const preview = payroll.previewReprocessMonth("2026-04");
  assert.equal(preview.ok, true);
  assert.equal(preview.authorizationRequired, true);

  const blocked = payroll.reprocessMonth("2026-04");
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /autoriza/i);
});

runTest("PayrollService nao persiste folha parcial quando um calculo falha", () => {
  let saveCalled = false;
  const database = {
    ensurePeriodOpen: () => ({ ok: true }),
    ensureAttendancePeriodClosed: () => ({ ok: true }),
    validateEmployeesForPayroll: () => ({ ok: true }),
    getSystemSettings: () => DEFAULT_SETTINGS,
    listEmployees: () => [
      {
        id: 1,
        full_name: "Carlos Silva",
        status: "ativo",
        base_salary: 200000,
        recurring_allowances: [],
        recurring_bonuses: [],
        special_payments: []
      }
    ],
    listEvents() {
      throw new Error("Falha controlada ao preparar os eventos do periodo.");
    },
    listLeaveRequests: () => [],
    listVacationRequests: () => [],
    listAttendanceRecords: () => [],
    listFinancialObligations: () => [],
    savePayrollRunsSnapshot() {
      saveCalled = true;
    }
  };

  const payroll = new PayrollService(database);
  const result = payroll.processMonth("2026-04");

  assert.equal(result.ok, false);
  assert.equal(saveCalled, false);
  assert.match(result.message, /não foi possível processar a folha/i);
});

runTest("Aprovação em lote da assiduidade converte ajustes pendentes em aprovados", () => {
  let runCount = 0;
  const service = {
    ensurePeriodOpen: () => ({ ok: true }),
    ensureAttendancePeriodOpen: () => ({ ok: true }),
    listAttendanceRecords(filters = {}) {
      if (filters.approvalStatus === "pending") {
        return [
          { id: 1, employee_id: 3, attendance_date: "2026-04-02", approval_status: "pending" },
          { id: 2, employee_id: 4, attendance_date: "2026-04-03", approval_status: "pending" }
        ];
      }
      return [
        { id: 1, employee_id: 3, attendance_date: "2026-04-02", approval_status: "approved" },
        { id: 2, employee_id: 4, attendance_date: "2026-04-03", approval_status: "approved" }
      ];
    },
    getAttendancePeriod(monthRef) {
      return { month_ref: monthRef, status: "open" };
    },
    db: {
      prepare() {
        return {
          run() {
            runCount += 1;
            return {};
          }
        };
      }
    }
  };

  const result = DatabaseService.prototype.approveAttendanceAdjustments.call(service, "2026-04", 9);
  assert.equal(result.ok, true);
  assert.equal(result.approvedCount, 2);
  assert.equal(runCount, 1);
  assert.equal(result.items.length, 2);
});

runTest("Auditoria exporta CSV com alterações registadas", () => {
  const auditDir = makeTempDir("kwanza-audit-");
  const service = {
    auditExportsDir: auditDir,
    listAuditLogs() {
      return [
        {
          created_at: "2026-04-03T10:00:00.000Z",
          user_name: "Administrador",
          action: "employee.update",
          entity_type: "employee",
          entity_label: "Carlos Silva",
          month_ref: "2026-04",
          details_json: {
            changes: {
              department: { before: "RH", after: "Financeiro" }
            }
          }
        }
      ];
    }
  };

  const result = DatabaseService.prototype.exportAuditCsv.call(service, { action: "employee.update" });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.path));
  const content = fs.readFileSync(result.path, "utf8");
  assert.match(content, /Carlos Silva/);
  assert.match(content, /Financeiro/);
});

runTest("GestÃ£o de utilizadores cria e remove utilizador com resposta contextual", () => {
  const users = [{ id: 1, full_name: "Administrador", username: "admin", role: "admin", active: 1, must_change_password: 0 }];
  const runRecorder = [];
  const service = {
    db: {
      prepare(sql) {
        if (sql.includes("SELECT * FROM users WHERE id = ?")) {
          return { get(id) { return users.find((item) => item.id === id); } };
        }
        if (sql.includes("INSERT INTO users")) {
          return {
            run(payload) {
              runRecorder.push(payload);
              users.push({
                id: 2,
                full_name: payload.full_name,
                username: payload.username,
                role: payload.role,
                active: payload.active,
                must_change_password: payload.must_change_password
              });
            }
          };
        }
        if (sql.includes("DELETE FROM users")) {
          return {
            run(id) {
              const index = users.findIndex((item) => item.id === id);
              if (index >= 0) users.splice(index, 1);
            }
          };
        }
        throw new Error(`SQL nÃ£o suportado no teste: ${sql}`);
      }
    },
    countActiveAdmins() {
      return 1;
    },
    listUsers() {
      return users.map((item) => ({ ...item, active: Boolean(item.active), created_at: "" }));
    }
  };

  const createResult = DatabaseService.prototype.saveUser.call(service, {
    full_name: "Operador Teste",
    username: "operador.teste",
    password: "1234",
    role: "operador",
    active: true
  });
  assert.equal(createResult.ok, true);
  assert.equal(runRecorder.length, 1);
  const created = createResult.users.find((item) => item.username === "operador.teste");
  assert.ok(created);

  const deleteResult = DatabaseService.prototype.deleteUser.call(service, created.id);
  assert.equal(deleteResult.ok, true);
  assert.ok(!deleteResult.users.find((item) => item.id === created.id));
});

runTest("Exportação bancária falha com mensagem específica quando não há salários processados", () => {
  const service = {
    getCompanyProfile() {
      return { name: "Empresa Teste", nif: "50014781" };
    },
    bankExportsDir: makeTempDir("kwanza-bank-empty-"),
    db: {
      prepare() {
        return { all() { return []; } };
      }
    }
  };

  const result = DatabaseService.prototype.exportBankPayrollCsv.call(service, { code: "ATLANTICO", name: "Banco Millennium Atlantico" }, "2026-04");
  assert.equal(result.ok, false);
  assert.match(result.message, /salários processados/i);
});

runTest("Exportação bancária gera CSV quando existe folha processada", () => {
  const targetDir = makeTempDir("kwanza-bank-full-");
  const service = {
    getCompanyProfile() {
      return { name: "Empresa Teste", nif: "50014781" };
    },
    bankExportsDir: targetDir,
    db: {
      prepare() {
        return {
          all() {
            return [
              {
                month_ref: "2026-04",
                net_salary: 140000,
                generated_at: new Date().toISOString(),
                full_name: "Maria Fernandes",
                iban: "AO62000600000123456789311",
                nif: "50014781",
                bi: "123456789LA042",
                department: "RH",
                job_title: "TÃ©cnica",
                contract_type: "Indeterminado"
              }
            ];
          }
        };
      }
    }
  };

  const result = DatabaseService.prototype.exportBankPayrollCsv.call(service, { code: "ATLANTICO", name: "Banco Millennium Atlantico" }, "2026-04");
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.path));
  const content = fs.readFileSync(result.path, "utf8");
  assert.match(content, /Empresa Teste/);
  assert.match(content, /Maria Fernandes/);
});

runTest("Updater devolve mensagem clara quando a configuraÃ§Ã£o estÃ¡ incompleta", () => {
  const updater = new UpdaterService({
    app: { quit() {} },
    shell: { openPath() {} },
    workspaceDir: makeTempDir("kwanza-update-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  const result = updater.validateConfig({ owner: "", repo: "", assetHint: "setup", prerelease: false });
  assert.equal(result.ok, false);
  assert.match(result.message, /GitHub/i);
});

runTest("Updater avisa quando nÃ£o existe atualizaÃ§Ã£o descarregada", () => {
  const updater = new UpdaterService({
    app: { quit() {} },
    shell: { openPath() {} },
    workspaceDir: makeTempDir("kwanza-update-install-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  const result = updater.installDownloadedUpdate();
  assert.equal(result.ok, false);
  assert.match(result.message, /atualiza/i);
});

runTest("Updater abre o instalador descarregado quando o ficheiro existe", async () => {
  const workspaceDir = makeTempDir("kwanza-update-open-");
  const installerPath = path.join(workspaceDir, "KwanzaFolha-Setup-1.0.1.exe");
  fs.writeFileSync(installerPath, "dummy", "utf8");
  const installerSha256 = require("node:crypto").createHash("sha256").update("dummy").digest("hex");

  let quitCalled = false;
  const updater = new UpdaterService({
    app: { quit() { quitCalled = true; } },
    shell: { openPath() { return Promise.resolve(""); } },
    workspaceDir,
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  updater.downloadedUpdate = {
    version: "1.0.1",
    path: installerPath,
    releaseName: "v1.0.1",
    sha256: installerSha256
  };

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (handler) => {
    handler();
    return 0;
  };

  try {
    const result = await updater.installDownloadedUpdate();
    assert.equal(result.ok, true);
    assert.equal(result.path, installerPath);
    assert.equal(quitCalled, true);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

runTest("Updater bloqueia o instalador quando o hash SHA-256 nao confere", async () => {
  const workspaceDir = makeTempDir("kwanza-update-integrity-");
  const installerPath = path.join(workspaceDir, "KwanzaFolha-Setup-1.0.1.exe");
  fs.writeFileSync(installerPath, "dummy", "utf8");

  const updater = new UpdaterService({
    app: { quit() {} },
    shell: { openPath() { throw new Error("Nao deveria abrir um instalador adulterado."); } },
    workspaceDir,
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  updater.downloadedUpdate = {
    version: "1.0.1",
    path: installerPath,
    releaseName: "v1.0.1",
    sha256: "0".repeat(64)
  };

  const result = await updater.installDownloadedUpdate();
  assert.equal(result.ok, false);
  assert.match(result.message, /sha-256/i);
});

runTest("Updater reutiliza resposta de checkForUpdates quando a aplicação já está atualizada", async () => {
  const updater = new UpdaterService({
    app: { quit() {} },
    shell: { openPath() {} },
    workspaceDir: makeTempDir("kwanza-update-latest-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  updater.checkForUpdates = async () => ({
    ok: true,
    available: false,
    currentVersion: "1.0.0",
    latestVersion: "1.0.0"
  });

  const result = await updater.downloadUpdate();
  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.match(result.message, /atualizada/i);
});

runTest("Updater valida o manifesto SHA-256 antes de concluir o download", async () => {
  const workspaceDir = makeTempDir("kwanza-update-download-");
  const installerSha256 = require("node:crypto").createHash("sha256").update("dummy").digest("hex");
  const updater = new UpdaterService({
    app: { quit() {} },
    shell: { openPath() {} },
    workspaceDir,
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  updater.checkForUpdates = async () => ({
    ok: true,
    available: true,
    currentVersion: "1.0.0",
    latestVersion: "1.0.1",
    releaseName: "v1.0.1",
    downloadUrl: "https://example.com/KwanzaFolha-Setup-1.0.1.exe",
    assetName: "KwanzaFolha-Setup-1.0.1.exe",
    checksumUrl: "https://example.com/checksums.txt",
    checksumAssetName: "checksums.txt"
  });
  updater.fetchChecksumManifest = async () => `${installerSha256}  KwanzaFolha-Setup-1.0.1.exe`;
  updater.downloadReleaseAsset = async (_url, destination) => {
    fs.writeFileSync(destination, "dummy", "utf8");
    return destination;
  };

  const result = await updater.downloadUpdate();
  assert.equal(result.ok, true);
  assert.equal(result.integrityVerified, true);
  assert.equal(updater.downloadedUpdate.sha256, installerSha256);
});

runTest("Updater usa o nome da release quando a tag não é uma versão semântica", () => {
  const version = resolveReleaseVersion({
    tag_name: "latest",
    name: "v1.0.1"
  });
  assert.equal(version, "1.0.1");
});

runTest("Updater extrai versões semânticas de nomes de release variaveis", () => {
  assert.equal(extractSemanticVersion("v1.0.2"), "1.0.2");
  assert.equal(extractSemanticVersion("Release v1.0.3"), "1.0.3");
  assert.equal(extractSemanticVersion("Kwanza Folha 2.1.0"), "2.1.0");
});

runTest("Updater informa quando existe release sem instalador anexado", async () => {
  const updater = new UpdaterService({
    app: { quit() {} },
    shell: { openPath() {} },
    workspaceDir: makeTempDir("kwanza-update-missing-asset-"),
    currentVersion: "1.0.0",
    productName: "Kwanza Folha"
  });

  updater.fetchLatestRelease = async () => ({
    ok: true,
    release: {
      tag_name: "latest",
      name: "v1.0.1",
      published_at: "2026-04-03T08:00:00.000Z",
      body: "",
      html_url: "https://github.com/Alves0054/KwanzaFolha/releases/tag/latest"
    },
    asset: null
  });

  const checkResult = await updater.checkForUpdates();
  assert.equal(checkResult.ok, true);
  assert.equal(checkResult.available, true);
  assert.equal(checkResult.latestVersion, "1.0.1");
  assert.match(checkResult.message, /instalador/i);

  const downloadResult = await updater.downloadUpdate();
  assert.equal(downloadResult.ok, false);
  assert.match(downloadResult.message, /instalador/i);
});

runTest("Pipeline de release gera manifesto e checksums dos artefactos publicados", () => {
  const distDir = makeTempDir("kwanza-release-artifacts-");
  const installerPath = path.join(distDir, "KwanzaFolha-Setup-1.0.0.exe");
  const blockmapPath = path.join(distDir, "KwanzaFolha-Setup-1.0.0.exe.blockmap");
  fs.writeFileSync(installerPath, "installer", "utf8");
  fs.writeFileSync(blockmapPath, "blockmap", "utf8");

  const artifacts = collectReleaseArtifacts({
    distDir,
    version: "1.0.0",
    target: "all"
  });

  assert.equal(artifacts.length, 2);
  assert.equal(artifacts.some((artifact) => artifact.kind === "installer"), true);
  assert.equal(artifacts.some((artifact) => artifact.kind === "portable"), false);
  assert.equal(artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)), true);

  const manifest = buildReleaseManifest({
    packageMetadata: {
      name: "kwanza-folha",
      productName: "Kwanza Folha",
      version: "1.0.0"
    },
    channel: "stable",
    artifacts
  });

  const outputs = writeReleaseBundle({
    distDir,
    manifest,
    artifacts,
    notesTemplate: "# Release 1.0.0\n"
  });

  assert.ok(fs.existsSync(outputs.checksumPath));
  assert.ok(fs.existsSync(outputs.manifestPath));
  assert.ok(fs.existsSync(outputs.notesPath));
  assert.match(fs.readFileSync(outputs.checksumPath, "utf8"), /KwanzaFolha-Setup-1\.0\.0\.exe/);
  assert.equal(JSON.parse(fs.readFileSync(outputs.manifestPath, "utf8")).updater.checksumRequired, true);
});

runTest("Exportação oficial gera ficheiros PS2 e PSX com o formato esperado", () => {
  const targetDir = makeTempDir("kwanza-bank-official-");
  const service = {
    getCompanyProfile() {
      return { name: "Empresa Teste", nif: "50014781", origin_account: "300200100999" };
    },
    bankExportsDir: targetDir,
    db: {
      prepare() {
        return {
          all() {
            return [
              {
                month_ref: "2026-04",
                net_salary: 250000,
                full_name: "Joao Manuel Pedro",
                bank_code: "ATLANTICO",
                bank_account: "000123456789",
                iban: "AO62000600000123456789311"
              },
              {
                month_ref: "2026-04",
                net_salary: 180000,
                full_name: "Maria Jose Alfredo",
                bank_code: "BAI",
                bank_account: "004567891234",
                iban: "AO62000600000123456789311"
              }
            ];
          }
        };
      }
    }
  };

  const ps2 = DatabaseService.prototype.exportBankPayrollFile.call(
    service,
    { code: "ATLANTICO", exportCode: "ATL", name: "Banco Millennium Atlantico" },
    "2026-04",
    "ps2"
  );
  assert.equal(ps2.ok, true);
  const ps2Content = fs.readFileSync(ps2.path, "utf8");
  assert.match(ps2Content, /^PS2;300200100999;000123456789;250000;JOAO MANUEL PEDRO;AOA$/m);

  const psx = DatabaseService.prototype.exportBankPayrollFile.call(
    service,
    { code: "ATLANTICO", exportCode: "ATL", name: "Banco Millennium Atlantico" },
    "2026-04",
    "psx"
  );
  assert.equal(psx.ok, true);
  const psxContent = fs.readFileSync(psx.path, "utf8");
  assert.match(psxContent, /^PSX;300200100999;BAI;004567891234;180000;MARIA JOSE ALFREDO;AOA$/m);
});

runTest("PdfService bloqueia relatórios sem salários processados", async () => {
  const service = new PdfService({
    getCompanyProfile() {
      return { name: "Empresa Teste" };
    },
    listPayrollRuns() {
      return [];
    },
    buildAttendanceReportData() {
      return { rows: [] };
    },
    buildShiftMapData() {
      return { ok: true, employeeRows: [], departmentRows: [], teacherRows: [] };
    }
  });

  const reportResult = await service.generateReport({ type: "descontos", monthRef: "2026-04" });
  assert.equal(reportResult.ok, false);
  assert.match(reportResult.message, /salários processados/i);

  const absenceResult = await service.generateReport({ type: "faltas", monthRef: "2026-04" });
  assert.equal(absenceResult.ok, false);
  assert.match(absenceResult.message, /faltas/i);

  const presenceResult = await service.generateReport({ type: "presencas", monthRef: "2026-04" });
  assert.equal(presenceResult.ok, false);
  assert.match(presenceResult.message, /presenças/i);

  const shiftWorkerResult = await service.generateReport({ type: "turnos-trabalhador", monthRef: "2026-04" });
  assert.equal(shiftWorkerResult.ok, false);
  assert.match(shiftWorkerResult.message, /turnos/i);

  const shiftDepartmentResult = await service.generateReport({ type: "turnos-departamento", monthRef: "2026-04" });
  assert.equal(shiftDepartmentResult.ok, false);
  assert.match(shiftDepartmentResult.message, /departamentos/i);

  const docenteResult = await service.generateReport({ type: "mapa-docente", monthRef: "2026-04" });
  assert.equal(docenteResult.ok, false);
  assert.match(docenteResult.message, /docente/i);

  const annualIrtResult = await service.generateReport({ type: "irt-anual", monthRef: "2026-04" });
  assert.equal(annualIrtResult.ok, false);
  assert.match(annualIrtResult.message, /IRT/i);

  const annualInssResult = await service.generateReport({ type: "inss-anual", monthRef: "2026-04" });
  assert.equal(annualInssResult.ok, false);
  assert.match(annualInssResult.message, /Segurança Social/i);

  service.buildMonthlyReportData = () => ({ rows: [], company: {} });
  const monthlyResult = await service.generateMonthlyExecutiveReport("2026-04");
  assert.equal(monthlyResult.ok, false);
  assert.match(monthlyResult.message, /relatório mensal/i);

  const batchResult = await service.generatePayslipsByMonth("2026-04");
  assert.equal(batchResult.ok, false);
  assert.match(batchResult.message, /recibos em lote/i);
});

runTest("PdfService cria pacote mensal com os ficheiros consolidados", async () => {
  const packageRoot = makeTempDir("kwanza-package-");
  const sourcePdf = path.join(packageRoot, "mensal.pdf");
  const sourceDiscounts = path.join(packageRoot, "descontos.pdf");
  const sourceEmployee = path.join(packageRoot, "funcionario.pdf");
  const sourcePayslips = path.join(packageRoot, "recibos.pdf");
  const sourcePayrollExcel = path.join(packageRoot, "folha.xls");
  const sourceStateExcel = path.join(packageRoot, "estado.xls");

  [sourcePdf, sourceDiscounts, sourceEmployee, sourcePayslips, sourcePayrollExcel, sourceStateExcel].forEach((filePath, index) => {
    fs.writeFileSync(filePath, `ficheiro-${index + 1}`, "utf8");
  });

  const service = new PdfService({
    workspaceDir: packageRoot,
    listPayrollRuns() {
      return [{ id: 1, month_ref: "2026-04" }];
    },
    exportMonthlyPayrollExcel() {
      return { ok: true, path: sourcePayrollExcel };
    },
    exportStatePaymentsExcel() {
      return { ok: true, path: sourceStateExcel };
    }
  });

  service.generateMonthlyExecutiveReport = async () => ({ ok: true, path: sourcePdf });
  service.generateReport = async ({ type }) => ({ ok: true, path: type === "descontos" ? sourceDiscounts : sourceEmployee });
  service.generatePayslipsByMonth = async () => ({ ok: true, path: sourcePayslips });

  const result = await service.exportMonthlyPackage("2026-04");
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.path));
  assert.equal(result.files.length, 6);
  assert.ok(result.files.every((filePath) => fs.existsSync(filePath)));
});

runTest("Exportações Excel geram ficheiros compatíveis para folha, Estado, assiduidade e auditoria", () => {
  const excelDir = makeTempDir("kwanza-excel-");
  const auditDir = makeTempDir("kwanza-audit-excel-");
  const payrollRuns = [
    {
      id: 1,
      employee_id: 1,
      month_ref: "2026-04",
      full_name: "Carlos Silva",
      job_title: "Tecnico",
      department: "RH",
      nif: "1234567890",
      bi: "004455667LA012",
      social_security_number: "12345678901",
      gross_salary: 250000,
      allowances_total: 30000,
      bonuses_total: 10000,
      inss_amount: 6000,
      irt_amount: 14000,
      mandatory_deductions: 20000,
      absence_deduction: 2500,
      net_salary: 227500,
      summary_json: {
        baseSalary: 200000,
        employerInssAmount: 16000,
        payableGrossSalary: 247500,
        fiscalProfileVersion: "agt20260401",
        fiscalProfile: { name: "Perfil fiscal abril 2026" },
        legalBases: {
          irtBaseBeforeSocialSecurity: 247500,
          materiaColectavel: 241500
        }
      }
    }
  ];

  const service = {
    excelExportsDir: excelDir,
    auditExportsDir: auditDir,
    getCompanyProfile() {
      return { name: "Empresa Teste", nif: "5000000000" };
    },
    listPayrollRuns() {
      return payrollRuns;
    },
    buildAgtMonthlyRemunerationMap: DatabaseService.prototype.buildAgtMonthlyRemunerationMap,
    buildAttendanceReportData(monthRef, reportType) {
      return {
        monthRef,
        reportType,
        rows: [
          {
            index: 1,
            full_name: "Carlos Silva",
            job_title: "Tecnico",
            department: "RH",
            attendance_date: "2026-04-10",
            status_label: reportType === "faltas" ? "Falta" : "Presente",
            hours_worked: reportType === "faltas" ? 0 : 8,
            delay_minutes: reportType === "faltas" ? 0 : 15,
            notes: "Registo de teste"
          }
        ]
      };
    },
    buildShiftMapData() {
      return {
        ok: true,
        employeeRows: [
          {
            index: 1,
            full_name: "Carlos Silva",
            department: "RH",
            job_title: "Tecnico",
            shift_name: "Turno Geral",
            schedule_label: "08:00 - 17:00",
            planned_days: 22,
            present_days: 20,
            delay_days: 1,
            absent_days: 1,
            half_absence_days: 0,
            leave_days: 0,
            vacation_days: 0,
            expected_hours: 176,
            hours_worked: 168,
            punctuality_rate: 95.24,
            absenteeism_rate: 4.55
          }
        ],
        departmentRows: [
          {
            index: 1,
            department: "RH",
            employees_count: 1,
            shifts_label: "Turno Geral",
            present_days: 20,
            delay_days: 1,
            absent_days: 1,
            leave_days: 0,
            vacation_days: 0,
            incomplete_records: 0,
            expected_hours: 176,
            hours_worked: 168,
            coverage_rate: 95.45
          }
        ],
        teacherRows: [
          {
            index: 1,
            full_name: "Helena Docente",
            department: "Corpo Docente",
            shift_name: "Docente - Manhã",
            blocks_label: "Bloco letivo da manhã: 07:30-12:30",
            planned_days: 22,
            expected_hours: 110,
            hours_worked: 104,
            present_days: 21,
            delay_days: 1,
            absent_days: 0,
            attendance_rate: 100
          }
        ]
      };
    },
    listAuditLogs() {
      return [
        {
          created_at: "2026-04-03T10:00:00.000Z",
          user_name: "Administrador",
          action: "employee.update",
          entity_type: "employee",
          entity_label: "Carlos Silva",
          month_ref: "2026-04",
          details_json: {
            changes: {
              department: { before: "RH", after: "Financeiro" }
            }
          }
        }
      ];
    }
  };

  const payrollResult = DatabaseService.prototype.exportMonthlyPayrollExcel.call(service, "2026-04");
  assert.equal(payrollResult.ok, true);
  assert.ok(fs.existsSync(payrollResult.path));
  assert.match(fs.readFileSync(payrollResult.path, "utf8"), /Folha salarial 2026-04/);

  const stateResult = DatabaseService.prototype.exportStatePaymentsExcel.call(service, "2026-04");
  assert.equal(stateResult.ok, true);
  assert.ok(fs.existsSync(stateResult.path));
  assert.match(fs.readFileSync(stateResult.path, "utf8"), /Pagamento ao Estado 2026-04/);

  const agtResult = DatabaseService.prototype.exportAgtMonthlyRemunerationExcel.call(service, "2026-04");
  assert.equal(agtResult.ok, true);
  assert.ok(fs.existsSync(agtResult.path));
  assert.match(fs.readFileSync(agtResult.path, "utf8"), /Mapa Mensal de Remuneracoes AGT 2026-04/);

  const absencesResult = DatabaseService.prototype.exportAttendanceExcel.call(service, "2026-04", "faltas");
  assert.equal(absencesResult.ok, true);
  assert.ok(fs.existsSync(absencesResult.path));
  assert.match(fs.readFileSync(absencesResult.path, "utf8"), /Relatório de faltas 2026-04/);

  const presencesResult = DatabaseService.prototype.exportAttendanceExcel.call(service, "2026-04", "presencas");
  assert.equal(presencesResult.ok, true);
  assert.ok(fs.existsSync(presencesResult.path));
  assert.match(fs.readFileSync(presencesResult.path, "utf8"), /Relatório de presenças 2026-04/);

  const shiftWorkerResult = DatabaseService.prototype.exportShiftMapExcel.call(service, "2026-04", "turnos-trabalhador");
  assert.equal(shiftWorkerResult.ok, true);
  assert.ok(fs.existsSync(shiftWorkerResult.path));
  assert.match(fs.readFileSync(shiftWorkerResult.path, "utf8"), /Mapa mensal de turnos por trabalhador 2026-04/);

  const shiftDepartmentResult = DatabaseService.prototype.exportShiftMapExcel.call(service, "2026-04", "turnos-departamento");
  assert.equal(shiftDepartmentResult.ok, true);
  assert.ok(fs.existsSync(shiftDepartmentResult.path));
  assert.match(fs.readFileSync(shiftDepartmentResult.path, "utf8"), /Mapa mensal de turnos por departamento 2026-04/);

  const docenteMapResult = DatabaseService.prototype.exportShiftMapExcel.call(service, "2026-04", "mapa-docente");
  assert.equal(docenteMapResult.ok, true);
  assert.ok(fs.existsSync(docenteMapResult.path));
  assert.match(fs.readFileSync(docenteMapResult.path, "utf8"), /Mapa docente 2026-04/);

  const auditResult = DatabaseService.prototype.exportAuditExcel.call(service, {});
  assert.equal(auditResult.ok, true);
  assert.ok(fs.existsSync(auditResult.path));
  assert.match(fs.readFileSync(auditResult.path, "utf8"), /Auditoria do Sistema/);
});

runTest("Base e backups ficam cifrados em repouso sem perder compatibilidade com backups legados", () => {
  const backupDir = makeTempDir("kwanza-restore-backups-");
  const dbRoot = makeTempDir("kwanza-restore-db-");
  const dbPath = path.join(dbRoot, "kwanza-folha.runtime.sqlite");
  const encryptedDbPath = path.join(dbRoot, "kwanza-folha.sqlite.enc");
  const legacyDbPath = path.join(dbRoot, "kwanza-folha.sqlite");
  const dataProtectionKeyPath = path.join(dbRoot, "data-protection.key");
  const backupPath = path.join(backupDir, "kwanza-folha-backup-teste.sqlite");

  fs.writeFileSync(dbPath, "estado-atual", "utf8");
  fs.writeFileSync(backupPath, "estado-restaurado", "utf8");

  const service = {
    backupDir,
    dbPath,
    encryptedDbPath,
    legacyDbPath,
    dataProtectionKeyPath,
    dataProtectionSecret: null,
    db: {
      open: true,
      pragma() {},
      close() {}
    },
    getDataProtectionSecret: DatabaseService.prototype.getDataProtectionSecret,
    deriveDataProtectionKey: DatabaseService.prototype.deriveDataProtectionKey,
    encryptBuffer: DatabaseService.prototype.encryptBuffer,
    decryptEncryptedEnvelope: DatabaseService.prototype.decryptEncryptedEnvelope,
    writeEncryptedFileFromSource: DatabaseService.prototype.writeEncryptedFileFromSource,
    restoreEncryptedFileToTarget: DatabaseService.prototype.restoreEncryptedFileToTarget,
    isEncryptedDataFile: DatabaseService.prototype.isEncryptedDataFile,
    syncEncryptedDatabaseSnapshot: DatabaseService.prototype.syncEncryptedDatabaseSnapshot,
    createBackup: DatabaseService.prototype.createBackup,
    closeConnection() {
      DatabaseService.prototype.closeConnection.call(this);
      this.closed = true;
    },
    openConnection() {
      this.reopened = true;
      this.db = { open: true, pragma() {}, close() {} };
    },
    cleanupRuntimeDatabaseArtifacts: DatabaseService.prototype.cleanupRuntimeDatabaseArtifacts,
    setupSchema() {
      this.schemaReloaded = true;
    },
    seedDefaults() {
      this.defaultsReloaded = true;
    },
    listBackups: DatabaseService.prototype.listBackups,
    restoreBackup: DatabaseService.prototype.restoreBackup,
    prepareForShutdown: DatabaseService.prototype.prepareForShutdown
  };

  const encryptedBackup = service.createBackup("manual");
  assert.equal(encryptedBackup.ok, true);
  assert.ok(encryptedBackup.path.endsWith(".sqlite.enc"));
  assert.equal(service.isEncryptedDataFile(encryptedBackup.path, "backup"), true);
  assert.ok(!fs.readFileSync(encryptedBackup.path, "utf8").includes("estado-atual"));

  const restoreResult = service.restoreBackup(backupPath);
  assert.equal(restoreResult.ok, true);
  assert.ok(fs.existsSync(restoreResult.safetyBackupPath));
  assert.ok(restoreResult.safetyBackupPath.endsWith(".sqlite.enc"));
  assert.equal(service.isEncryptedDataFile(restoreResult.safetyBackupPath, "backup"), true);
  assert.equal(fs.readFileSync(dbPath, "utf8"), "estado-restaurado");
  assert.ok(!fs.readFileSync(restoreResult.safetyBackupPath, "utf8").includes("estado-atual"));
  assert.equal(service.closed, true);
  assert.equal(service.reopened, true);
  assert.equal(service.schemaReloaded, true);
  assert.equal(service.defaultsReloaded, true);
  assert.ok(fs.existsSync(encryptedDbPath));
  assert.equal(service.isEncryptedDataFile(encryptedDbPath, "database"), true);
  assert.ok(restoreResult.backups.length >= 2);

  const shutdownResult = service.prepareForShutdown();
  assert.equal(shutdownResult.ok, true);
  assert.equal([true, false].includes(fs.existsSync(dbPath)), true);
  assert.equal(fs.existsSync(`${dbPath}-wal`), false);
  assert.equal(fs.existsSync(`${dbPath}-shm`), false);
  assert.equal(fs.existsSync(encryptedDbPath), true);
  assert.ok(!fs.readFileSync(encryptedDbPath, "utf8").includes("estado-restaurado"));
});

Promise.all(pendingTests).then(() => {
  if (!process.exitCode) {
    console.log("Todos os testes passaram.");
  }
});

