const OPERATOR_PERMISSIONS = new Set([
  "employees.view",
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
  "financial.view",
  "shifts.view",
  "salary_scales.view",
  "payroll.view",
  "reports.view",
  "exports.generate",
  "bank.export",
  "pdf.generate"
]);

const PERMISSION_LABELS = {
  "employees.manage": "gerir o cadastro de funcionarios",
  "events.manage": "registar movimentos salariais",
  "attendance.manage": "registar ou importar assiduidade",
  "leave.manage": "gerir licencas e ausencias",
  "vacation.balance.manage": "ajustar saldos anuais de ferias",
  "vacation.manage": "registar ferias",
  "documents.view": "consultar documentos laborais",
  "documents.manage": "gerir documentos laborais",
  "financial.manage": "gerir emprestimos e adiantamentos",
  "payroll.process": "processar a folha salarial",
  "payroll.period.manage": "alterar periodos da folha",
  "company.manage": "alterar os dados da empresa",
  "settings.manage": "alterar configuracoes do sistema",
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
  const label = PERMISSION_LABELS[permission] || "executar esta operacao";
  return `O seu perfil nao tem permissao para ${label}.`;
}

module.exports = {
  OPERATOR_PERMISSIONS,
  hasPermission,
  getPermissionDeniedMessage
};
