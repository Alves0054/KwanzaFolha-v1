const OPERATOR_PERMISSIONS = new Set([
  "employees.view",
  "employees.manage",
  "organization.view",
  "organization.manage",
  "enterprise.view",
  "enterprise.manage",
  "events.view",
  "events.manage",
  "attendance.view",
  "attendance.manage",
  "leave.view",
  "leave.manage",
  "vacation.view",
  "vacation.manage",
  "documents.view",
  "documents.manage",
  "hr.view",
  "hr.manage",
  "financial.view",
  "financial.manage",
  "shifts.view",
  "shifts.manage",
  "salary_scales.view",
  "salary_scales.manage",
  "payroll.view",
  "payroll.process",
  "payroll.period.manage",
  "reports.view",
  "audit.view",
  "exports.generate",
  "bank.export",
  "pdf.generate",
  "company.manage",
  "users.manage",
  "backup.manage",
  "app.update.manage",
  "vacation.balance.manage"
]);

const PERMISSION_LABELS = {
  "employees.manage": "gerir o cadastro de funcionários",
  "organization.manage": "gerir empresas, filiais, departamentos, cargos e centros de custo",
  "enterprise.manage": "gerir contratos, recrutamento, desempenho, formação, workflows e sincronização",
  "events.manage": "registar movimentos salariais",
  "attendance.manage": "registar ou importar assiduidade",
  "leave.manage": "gerir licenças e ausências",
  "vacation.balance.manage": "ajustar saldos anuais de férias",
  "vacation.manage": "registar férias",
  "documents.view": "consultar documentos laborais",
  "documents.manage": "gerir documentos laborais",
  "hr.view": "consultar RH 360",
  "hr.manage": "gerir RH 360",
  "financial.manage": "gerir empréstimos e adiantamentos",
  "payroll.process": "processar a folha salarial",
  "payroll.period.manage": "alterar períodos da folha",
  "company.manage": "alterar os dados da empresa",
  "settings.manage": "alterar configurações do sistema",
  "users.manage": "gerir utilizadores",
  "salary_scales.manage": "gerir escalas salariais",
  "shifts.manage": "gerir turnos",
  "audit.view": "consultar auditoria",
  "backup.manage": "gerir backups",
  "app.update.manage": "instalar atualizacoes"
};

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function hasPermission(user, permission) {
  if (!user) {
    return false;
  }

  const role = normalizeRole(user.role);
  if (role === "admin") {
    return true;
  }

  if (role !== "operador") {
    return false;
  }

  return OPERATOR_PERMISSIONS.has(permission);
}

function getPermissionDeniedMessage(permission) {
  const label = PERMISSION_LABELS[permission] || "executar esta operação";
  return `O seu perfil não tem permissão para ${label}.`;
}

module.exports = {
  OPERATOR_PERMISSIONS,
  hasPermission,
  getPermissionDeniedMessage
};
