const ORGANIZATION_ENTITY_CONFIG = {
  companies: {
    table: "companies",
    label: "empresa",
    orderBy: "LOWER(companies.name) ASC",
    fields: [
      "name",
      "nif",
      "address",
      "phone",
      "email",
      "logo_path",
      "fiscal_regime",
      "receipt_footer",
      "report_notes",
      "active"
    ],
    required: ["name", "nif"],
    searchFields: ["companies.name", "companies.nif", "companies.email", "companies.phone"]
  },
  branches: {
    table: "company_branches",
    label: "filial",
    orderBy: "LOWER(company_branches.name) ASC",
    fields: ["company_id", "name", "code", "address", "manager", "phone", "email", "active"],
    required: ["company_id", "name"],
    searchFields: ["company_branches.name", "company_branches.code", "company_branches.manager", "company_branches.address"]
  },
  departments: {
    table: "departments",
    label: "departamento",
    orderBy: "LOWER(departments.name) ASC",
    fields: ["company_id", "branch_id", "cost_center_id", "name", "code", "manager", "active"],
    required: ["company_id", "name", "code"],
    searchFields: ["departments.name", "departments.code", "departments.manager"]
  },
  jobPositions: {
    table: "job_positions",
    label: "cargo",
    orderBy: "LOWER(job_positions.name) ASC",
    fields: [
      "company_id",
      "department_id",
      "name",
      "professional_category",
      "suggested_base_salary",
      "description",
      "hierarchy_level",
      "active"
    ],
    required: ["company_id", "name"],
    searchFields: ["job_positions.name", "job_positions.professional_category", "job_positions.description"]
  },
  costCenters: {
    table: "cost_centers",
    label: "centro de custo",
    orderBy: "LOWER(cost_centers.code) ASC",
    fields: ["company_id", "department_id", "code", "name", "active"],
    required: ["company_id", "code", "name"],
    searchFields: ["cost_centers.code", "cost_centers.name"]
  }
};

function compactText(value) {
  return String(value || "").trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  return compactText(value).toLowerCase();
}

function isValidEmail(value) {
  const normalized = normalizeEmail(value);
  return !normalized || /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized);
}

function normalizeActive(value) {
  return value === undefined || value === null ? 1 : value ? 1 : 0;
}

function normalizeOptionalId(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getConfig(entityType) {
  const config = ORGANIZATION_ENTITY_CONFIG[entityType];
  if (!config) {
    throw new Error("Tipo de entidade organizacional inválido.");
  }
  return config;
}

function getRow(service, table, id) {
  return service.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id) || null;
}

function getCompanyOptions(service) {
  return service.db.prepare(`
    SELECT id, name, nif, active
    FROM companies
    WHERE deleted_at IS NULL
    ORDER BY LOWER(name) ASC
  `).all();
}

function assertCompanyExists(service, companyId) {
  if (!companyId) {
    return { ok: false, message: "Selecione a empresa." };
  }
  const row = getRow(service, "companies", companyId);
  if (!row) {
    return { ok: false, message: "A empresa selecionada não existe ou foi removida." };
  }
  return { ok: true, row };
}

function assertBranchMatchesCompany(service, branchId, companyId) {
  if (!branchId) {
    return { ok: true };
  }
  const row = getRow(service, "company_branches", branchId);
  if (!row || Number(row.company_id) !== Number(companyId)) {
    return { ok: false, message: "A filial selecionada não pertence à empresa indicada." };
  }
  return { ok: true, row };
}

function assertDepartmentMatchesCompany(service, departmentId, companyId) {
  if (!departmentId) {
    return { ok: true };
  }
  const row = getRow(service, "departments", departmentId);
  if (!row || Number(row.company_id) !== Number(companyId)) {
    return { ok: false, message: "O departamento selecionado não pertence à empresa indicada." };
  }
  return { ok: true, row };
}

function assertCostCenterMatchesCompany(service, costCenterId, companyId) {
  if (!costCenterId) {
    return { ok: true };
  }
  const row = getRow(service, "cost_centers", costCenterId);
  if (!row || Number(row.company_id) !== Number(companyId)) {
    return { ok: false, message: "O centro de custo selecionado não pertence à empresa indicada." };
  }
  return { ok: true, row };
}

function validateOrganizationPayload(service, entityType, payload = {}) {
  const config = getConfig(entityType);
  const id = normalizeOptionalId(payload.id);
  const sanitized = { id, active: normalizeActive(payload.active) };

  for (const field of config.fields) {
    if (field.endsWith("_id")) {
      sanitized[field] = normalizeOptionalId(payload[field]);
    } else if (field === "active") {
      sanitized.active = normalizeActive(payload.active);
    } else if (field.includes("salary") || field === "hierarchy_level") {
      sanitized[field] = Number(payload[field] || 0);
    } else if (field === "email") {
      sanitized[field] = normalizeEmail(payload[field]);
    } else if (field === "nif") {
      sanitized[field] = onlyDigits(payload[field]);
    } else if (field === "code") {
      sanitized[field] = compactText(payload[field]).toUpperCase();
    } else {
      sanitized[field] = compactText(payload[field]);
    }
  }

  for (const field of config.required) {
    if (!sanitized[field]) {
      return { ok: false, message: `Preencha o campo obrigatório de ${config.label}: ${field}.` };
    }
  }

  if (sanitized.nif && !/^\d{8,14}$/.test(sanitized.nif)) {
    return { ok: false, message: "O NIF deve conter entre 8 e 14 digitos." };
  }
  if (sanitized.email && !isValidEmail(sanitized.email)) {
    return { ok: false, message: "O e-mail indicado e inválido." };
  }
  if (sanitized.phone && !/^\+?[\d\s-]{7,20}$/.test(sanitized.phone)) {
    return { ok: false, message: "O contacto telefonico deve conter entre 7 e 20 digitos." };
  }
  if (sanitized.suggested_base_salary < 0) {
    return { ok: false, message: "O salário base sugerido não pode ser negativo." };
  }
  if (sanitized.hierarchy_level < 0) {
    return { ok: false, message: "O nível hierárquico não pode ser negativo." };
  }

  if (entityType !== "companies") {
    const companyCheck = assertCompanyExists(service, sanitized.company_id);
    if (!companyCheck.ok) return companyCheck;
  }
  if (entityType === "departments") {
    const branchCheck = assertBranchMatchesCompany(service, sanitized.branch_id, sanitized.company_id);
    if (!branchCheck.ok) return branchCheck;
    const costCenterCheck = assertCostCenterMatchesCompany(service, sanitized.cost_center_id, sanitized.company_id);
    if (!costCenterCheck.ok) return costCenterCheck;
  }
  if (entityType === "jobPositions") {
    const departmentCheck = assertDepartmentMatchesCompany(service, sanitized.department_id, sanitized.company_id);
    if (!departmentCheck.ok) return departmentCheck;
  }
  if (entityType === "costCenters") {
    const departmentCheck = assertDepartmentMatchesCompany(service, sanitized.department_id, sanitized.company_id);
    if (!departmentCheck.ok) return departmentCheck;
  }

  const duplicateCheck = validateOrganizationDuplicate(service, entityType, sanitized);
  if (!duplicateCheck.ok) {
    return duplicateCheck;
  }

  return { ok: true, sanitized };
}

function validateOrganizationDuplicate(service, entityType, sanitized) {
  if (entityType === "companies" && sanitized.nif) {
    const duplicate = service.db
      .prepare("SELECT id FROM companies WHERE nif = ? AND deleted_at IS NULL AND (? IS NULL OR id <> ?)")
      .get(sanitized.nif, sanitized.id, sanitized.id);
    if (duplicate) {
      return { ok: false, message: "Ja existe uma empresa ativa com este NIF." };
    }
  }

  if (entityType === "branches" && sanitized.code) {
    const duplicate = service.db
      .prepare("SELECT id FROM company_branches WHERE company_id = ? AND UPPER(code) = UPPER(?) AND deleted_at IS NULL AND (? IS NULL OR id <> ?)")
      .get(sanitized.company_id, sanitized.code, sanitized.id, sanitized.id);
    if (duplicate) {
      return { ok: false, message: "Ja existe uma filial com este codigo nesta empresa." };
    }
  }

  if (entityType === "departments") {
    const duplicate = service.db
      .prepare("SELECT id FROM departments WHERE company_id = ? AND (UPPER(code) = UPPER(?) OR LOWER(name) = LOWER(?)) AND deleted_at IS NULL AND (? IS NULL OR id <> ?)")
      .get(sanitized.company_id, sanitized.code, sanitized.name, sanitized.id, sanitized.id);
    if (duplicate) {
      return { ok: false, message: "Ja existe um departamento com este codigo ou nome nesta empresa." };
    }
  }

  if (entityType === "jobPositions") {
    const duplicate = service.db
      .prepare("SELECT id FROM job_positions WHERE company_id = ? AND COALESCE(department_id, 0) = COALESCE(?, 0) AND LOWER(name) = LOWER(?) AND deleted_at IS NULL AND (? IS NULL OR id <> ?)")
      .get(sanitized.company_id, sanitized.department_id, sanitized.name, sanitized.id, sanitized.id);
    if (duplicate) {
      return { ok: false, message: "Ja existe este cargo no mesmo departamento." };
    }
  }

  if (entityType === "costCenters") {
    const duplicate = service.db
      .prepare("SELECT id FROM cost_centers WHERE company_id = ? AND UPPER(code) = UPPER(?) AND deleted_at IS NULL AND (? IS NULL OR id <> ?)")
      .get(sanitized.company_id, sanitized.code, sanitized.id, sanitized.id);
    if (duplicate) {
      return { ok: false, message: "Ja existe um centro de custo com este codigo nesta empresa." };
    }
  }

  return { ok: true };
}

function buildOrganizationWhere(config, filters = {}) {
  const conditions = [`${config.table}.deleted_at IS NULL`];
  const values = {};
  if (filters.id) {
    conditions.push(`${config.table}.id = @id`);
    values.id = Number(filters.id);
  }
  if (filters.companyId && config.table !== "companies") {
    conditions.push(`${config.table}.company_id = @companyId`);
    values.companyId = Number(filters.companyId);
  }
  if (filters.active !== undefined && filters.active !== null && filters.active !== "todos" && filters.active !== "") {
    conditions.push(`${config.table}.active = @active`);
    values.active = filters.active ? 1 : 0;
  }
  if (filters.search) {
    const searchSql = config.searchFields.map((field) => `LOWER(COALESCE(${field}, '')) LIKE @search`).join(" OR ");
    conditions.push(`(${searchSql})`);
    values.search = `%${compactText(filters.search).toLowerCase()}%`;
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, values };
}

function listCompanies(service, filters = {}) {
  const config = getConfig("companies");
  const query = buildOrganizationWhere(config, filters);
  return service.db.prepare(`
    SELECT
      companies.*,
      (SELECT COUNT(*) FROM company_branches WHERE company_branches.company_id = companies.id AND company_branches.deleted_at IS NULL) AS branch_count,
      (SELECT COUNT(*) FROM departments WHERE departments.company_id = companies.id AND departments.deleted_at IS NULL) AS department_count,
      (SELECT COUNT(*) FROM job_positions WHERE job_positions.company_id = companies.id AND job_positions.deleted_at IS NULL) AS job_position_count,
      (SELECT COUNT(*) FROM cost_centers WHERE cost_centers.company_id = companies.id AND cost_centers.deleted_at IS NULL) AS cost_center_count,
      (SELECT COUNT(*) FROM employees WHERE employees.company_id = companies.id) AS employee_count
    FROM companies
    ${query.whereClause}
    ORDER BY ${config.orderBy}
  `).all(query.values).map(mapOrganizationRow);
}

function listBranches(service, filters = {}) {
  const config = getConfig("branches");
  const query = buildOrganizationWhere(config, filters);
  return service.db.prepare(`
    SELECT
      company_branches.*,
      companies.name AS company_name,
      (SELECT COUNT(*) FROM employees WHERE employees.branch_id = company_branches.id) AS employee_count
    FROM company_branches
    INNER JOIN companies ON companies.id = company_branches.company_id
    ${query.whereClause}
    ORDER BY ${config.orderBy}
  `).all(query.values).map(mapOrganizationRow);
}

function listDepartments(service, filters = {}) {
  const config = getConfig("departments");
  const query = buildOrganizationWhere(config, filters);
  return service.db.prepare(`
    SELECT
      departments.*,
      companies.name AS company_name,
      company_branches.name AS branch_name,
      cost_centers.code AS cost_center_code,
      cost_centers.name AS cost_center_name,
      (SELECT COUNT(*) FROM employees WHERE employees.department_id = departments.id OR LOWER(TRIM(employees.department)) = LOWER(TRIM(departments.name))) AS employee_count,
      (SELECT COUNT(*) FROM job_positions WHERE job_positions.department_id = departments.id AND job_positions.deleted_at IS NULL) AS job_position_count
    FROM departments
    INNER JOIN companies ON companies.id = departments.company_id
    LEFT JOIN company_branches ON company_branches.id = departments.branch_id
    LEFT JOIN cost_centers ON cost_centers.id = departments.cost_center_id
    ${query.whereClause}
    ORDER BY ${config.orderBy}
  `).all(query.values).map(mapOrganizationRow);
}

function listJobPositions(service, filters = {}) {
  const config = getConfig("jobPositions");
  const query = buildOrganizationWhere(config, filters);
  return service.db.prepare(`
    SELECT
      job_positions.*,
      companies.name AS company_name,
      departments.name AS department_name,
      (SELECT COUNT(*) FROM employees WHERE employees.job_position_id = job_positions.id OR LOWER(TRIM(employees.job_title)) = LOWER(TRIM(job_positions.name))) AS employee_count
    FROM job_positions
    INNER JOIN companies ON companies.id = job_positions.company_id
    LEFT JOIN departments ON departments.id = job_positions.department_id
    ${query.whereClause}
    ORDER BY ${config.orderBy}
  `).all(query.values).map(mapOrganizationRow);
}

function listCostCenters(service, filters = {}) {
  const config = getConfig("costCenters");
  const query = buildOrganizationWhere(config, filters);
  return service.db.prepare(`
    SELECT
      cost_centers.*,
      companies.name AS company_name,
      departments.name AS department_name,
      (SELECT COUNT(*) FROM employees WHERE employees.cost_center_id = cost_centers.id) AS employee_count
    FROM cost_centers
    INNER JOIN companies ON companies.id = cost_centers.company_id
    LEFT JOIN departments ON departments.id = cost_centers.department_id
    ${query.whereClause}
    ORDER BY ${config.orderBy}
  `).all(query.values).map(mapOrganizationRow);
}

function mapOrganizationRow(row) {
  return {
    ...row,
    active: Boolean(row.active),
    employee_count: Number(row.employee_count || 0),
    branch_count: Number(row.branch_count || 0),
    department_count: Number(row.department_count || 0),
    job_position_count: Number(row.job_position_count || 0),
    cost_center_count: Number(row.cost_center_count || 0)
  };
}

function listOrganizationEntities(service, entityType, filters = {}) {
  if (entityType === "companies") return listCompanies(service, filters);
  if (entityType === "branches") return listBranches(service, filters);
  if (entityType === "departments") return listDepartments(service, filters);
  if (entityType === "jobPositions") return listJobPositions(service, filters);
  if (entityType === "costCenters") return listCostCenters(service, filters);
  throw new Error("Tipo de entidade organizacional inválido.");
}

function getOrganizationSnapshot(service, entityType, id) {
  return listOrganizationEntities(service, entityType, { id })[0] || null;
}

function saveOrganizationEntity(service, entityType, payload = {}, nowIso) {
  const config = getConfig(entityType);
  const validation = validateOrganizationPayload(service, entityType, payload);
  if (!validation.ok) {
    return validation;
  }

  const savedAt = nowIso();
  const sanitized = {
    ...validation.sanitized,
    updated_at: savedAt,
    sync_status: "pending"
  };

  return service.runInTransaction(() => {
    if (sanitized.id) {
      const current = getRow(service, config.table, sanitized.id);
      if (!current) {
        return { ok: false, message: `O registo de ${config.label} selecionado já não existe.` };
      }
      const assignments = config.fields
        .map((field) => `${field} = @${field}`)
        .concat(["updated_at = @updated_at", "sync_status = @sync_status"])
        .join(", ");
      service.db.prepare(`UPDATE ${config.table} SET ${assignments} WHERE id = @id`).run(sanitized);
    } else {
      const insertFields = config.fields.concat(["global_id", "sync_status", "created_at", "updated_at"]);
      const values = insertFields.map((field) => `@${field}`).join(", ");
      const record = {
        ...sanitized,
        global_id: service.createGlobalId ? service.createGlobalId(config.table) : `${config.table}-${Date.now()}`,
        created_at: savedAt,
        updated_at: savedAt
      };
      service.db.prepare(`INSERT INTO ${config.table} (${insertFields.join(", ")}) VALUES (${values})`).run(record);
      sanitized.id = service.db.prepare("SELECT last_insert_rowid() AS id").get().id;
    }

    return {
      ok: true,
      item: getOrganizationSnapshot(service, entityType, sanitized.id),
      organization: getOrganizationBootstrap(service)
    };
  });
}

function countOrganizationUsage(service, entityType, id) {
  const numericId = Number(id || 0);
  if (!numericId) return 0;
  if (entityType === "companies") {
    return service.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE company_id = ?").get(numericId).total;
  }
  if (entityType === "branches") {
    return service.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE branch_id = ?").get(numericId).total;
  }
  if (entityType === "departments") {
    const current = getRow(service, "departments", numericId);
    return service.db.prepare(`
      SELECT COUNT(*) AS total
      FROM employees
      WHERE department_id = @id OR LOWER(TRIM(department)) = LOWER(TRIM(@name))
    `).get({ id: numericId, name: current?.name || "" }).total;
  }
  if (entityType === "jobPositions") {
    const current = getRow(service, "job_positions", numericId);
    return service.db.prepare(`
      SELECT COUNT(*) AS total
      FROM employees
      WHERE job_position_id = @id OR LOWER(TRIM(job_title)) = LOWER(TRIM(@name))
    `).get({ id: numericId, name: current?.name || "" }).total;
  }
  if (entityType === "costCenters") {
    return service.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE cost_center_id = ?").get(numericId).total;
  }
  return 0;
}

function deleteOrganizationEntity(service, entityType, id, nowIso) {
  const config = getConfig(entityType);
  const current = getRow(service, config.table, id);
  if (!current) {
    return { ok: false, message: `O registo de ${config.label} selecionado já não existe.` };
  }

  const usageCount = countOrganizationUsage(service, entityType, id);
  if (usageCount > 0) {
    return {
      ok: false,
      message: `Não pode remover este registo porque está associado a ${usageCount} funcionário(s). Pode inativá-lo.`
    };
  }

  service.db.prepare(`UPDATE ${config.table} SET active = 0, deleted_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`).run(
    nowIso(),
    nowIso(),
    id
  );
  return { ok: true, organization: getOrganizationBootstrap(service) };
}

function getOrganizationBootstrap(service) {
  const companies = listCompanies(service);
  return {
    companies,
    branches: listBranches(service),
    departments: listDepartments(service),
    jobPositions: listJobPositions(service),
    costCenters: listCostCenters(service),
    companyOptions: getCompanyOptions(service)
  };
}

function buildOrganizationReport(service, filters = {}) {
  const organization = getOrganizationBootstrap(service);
  const activeCompanies = organization.companies.filter((item) => item.active).length;
  const activeEmployees = service.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE status = 'ativo'").get().total;
  return {
    ok: true,
    filters,
    summary: {
      companies: organization.companies.length,
      activeCompanies,
      branches: organization.branches.length,
      departments: organization.departments.length,
      jobPositions: organization.jobPositions.length,
      costCenters: organization.costCenters.length,
      activeEmployees
    },
    rows: {
      companies: organization.companies,
      branches: organization.branches,
      departments: organization.departments,
      jobPositions: organization.jobPositions,
      costCenters: organization.costCenters
    }
  };
}

function exportOrganizationExcel(service, filters = {}, buildExcelTableDocument) {
  const report = buildOrganizationReport(service, filters);
  const rows = []
    .concat(report.rows.companies.map((row) => ["Empresa", row.name, row.nif, "", row.employee_count, row.active ? "Ativo" : "Inativo"]))
    .concat(report.rows.branches.map((row) => ["Filial", row.name, row.code, row.company_name, row.employee_count, row.active ? "Ativo" : "Inativo"]))
    .concat(report.rows.departments.map((row) => ["Departamento", row.name, row.code, row.company_name, row.employee_count, row.active ? "Ativo" : "Inativo"]))
    .concat(report.rows.jobPositions.map((row) => ["Cargo", row.name, row.professional_category, row.company_name, row.employee_count, row.active ? "Ativo" : "Inativo"]))
    .concat(report.rows.costCenters.map((row) => ["Centro de custo", row.name, row.code, row.company_name, row.employee_count, row.active ? "Ativo" : "Inativo"]));

  if (!rows.length) {
    return { ok: false, message: "Não existem dados organizacionais para exportar." };
  }

  const fs = require("fs");
  const path = require("path");
  const content = buildExcelTableDocument(
    "Organizacao empresarial",
    ["Módulo", "Nome", "Código/NIF/Categoria", "Empresa", "Funcionários", "Estado"],
    rows
  );
  const target = path.join(service.excelExportsDir, `organizacao-empresarial-${new Date().toISOString().slice(0, 10)}.xls`);
  fs.writeFileSync(target, content, "utf8");
  return { ok: true, path: target, count: rows.length, format: "xls", report };
}

module.exports = {
  ORGANIZATION_ENTITY_CONFIG,
  getOrganizationBootstrap,
  getOrganizationSnapshot,
  listOrganizationEntities,
  saveOrganizationEntity,
  deleteOrganizationEntity,
  buildOrganizationReport,
  exportOrganizationExcel
};
