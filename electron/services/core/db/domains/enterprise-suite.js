const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildXlsxBuffer, readXlsxRows } = require("../../xlsx");

const ENTERPRISE_TYPES = {
  contracts: {
    table: "employee_contracts",
    entity: "contract",
    fields: [
      "employee_id",
      "contract_type",
      "start_date",
      "end_date",
      "probation_end_date",
      "contract_salary",
      "job_position_id",
      "department_id",
      "status",
      "document_path",
      "notes"
    ],
    required: ["employee_id", "contract_type", "start_date", "contract_salary"]
  },
  documentTemplates: {
    table: "document_templates",
    entity: "document_template",
    fields: ["template_type", "name", "body", "active"],
    required: ["template_type", "name", "body"]
  },
  approvalWorkflows: {
    table: "approval_workflows",
    entity: "approval_workflow",
    fields: ["module", "name", "steps_json", "active"],
    required: ["module", "name"]
  },
  approvalRequests: {
    table: "approval_requests",
    entity: "approval_request",
    fields: ["workflow_id", "module", "entity_type", "entity_id", "requested_by_user_id", "assigned_to_user_id", "status", "reason", "payload_json"],
    required: ["module", "entity_type", "reason"]
  },
  recruitmentJobs: {
    table: "recruitment_jobs",
    entity: "recruitment_job",
    fields: ["company_id", "department_id", "job_position_id", "title", "description", "status", "openings", "opened_at", "closed_at"],
    required: ["title", "status"]
  },
  recruitmentCandidates: {
    table: "recruitment_candidates",
    entity: "recruitment_candidate",
    fields: ["job_id", "full_name", "email", "phone", "stage", "cv_path", "notes", "converted_employee_id"],
    required: ["full_name", "stage"]
  },
  onboardingProcesses: {
    table: "onboarding_processes",
    entity: "onboarding_process",
    fields: ["employee_id", "candidate_id", "status", "start_date", "due_date", "completed_at", "checklist_json", "notes"],
    required: ["employee_id", "status", "start_date"]
  },
  offboardingProcesses: {
    table: "offboarding_processes",
    entity: "offboarding_process",
    fields: ["employee_id", "exit_type", "status", "exit_date", "final_calculation_json", "checklist_json", "notes"],
    required: ["employee_id", "exit_type", "status", "exit_date"]
  },
  performanceReviews: {
    table: "performance_reviews",
    entity: "performance_review",
    fields: ["employee_id", "review_period", "review_type", "manager_id", "score", "goals_json", "criteria_json", "self_review", "manager_review", "feedback", "improvement_plan", "status"],
    required: ["employee_id", "review_period", "review_type"]
  },
  trainingCourses: {
    table: "training_courses",
    entity: "training_course",
    fields: ["title", "provider", "training_type", "start_date", "end_date", "cost", "status", "notes"],
    required: ["title", "training_type"]
  },
  trainingParticipants: {
    table: "training_participants",
    entity: "training_participant",
    fields: ["course_id", "employee_id", "attendance_status", "certificate_path", "evaluation_score", "notes"],
    required: ["course_id", "employee_id"]
  }
};

function nowIso() {
  return new Date().toISOString();
}

function compact(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function boolInt(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  return value ? 1 : 0;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&após;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function isDate(value) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isMonth(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function defaultOnboardingChecklist() {
  return [
    { label: "Contrato assinado", done: false },
    { label: "Documentos pessoais conferidos", done: false },
    { label: "Equipamento entregue", done: false },
    { label: "Acesso/email criado", done: false },
    { label: "Formação inicial agendada", done: false }
  ];
}

function defaultOffboardingChecklist() {
  return [
    { label: "Calculo final revisto", done: false },
    { label: "Férias não gozadas apuradas", done: false },
    { label: "Equipamentos devolvidos", done: false },
    { label: "Acessos cancelados", done: false },
    { label: "Documentos finais emitidos", done: false }
  ];
}

function todayIso() {
  return nowIso().slice(0, 10);
}

function addDays(dateValue, days) {
  const base = new Date(`${dateValue || todayIso()}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function getConfig(type) {
  const config = ENTERPRISE_TYPES[type];
  if (!config) throw new Error("Módulo empresarial inválido.");
  return config;
}

function ensureEmployee(service, employeeId, message = "Selecione um funcionário válido.") {
  const id = numberOrNull(employeeId);
  if (!id) return { ok: false, message };
  const employee = service.db.prepare("SELECT id, full_name FROM employees WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!employee) return { ok: false, message };
  return { ok: true, employee, id };
}

function existingUserId(service, userId) {
  const id = numberOrNull(userId);
  if (!id) return null;
  const user = service.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  return user ? id : null;
}

function normalizeByType(service, type, payload = {}) {
  const config = getConfig(type);
  const sanitized = { id: numberOrNull(payload.id) };
  for (const field of config.fields) {
    if (field.endsWith("_id")) sanitized[field] = numberOrNull(payload[field]);
    else if (field.endsWith("_json")) sanitized[field] = JSON.stringify(["steps_json", "checklist_json"].includes(field) ? parseJsonArray(payload[field]) : parseJsonObject(payload[field]));
    else if (field === "active") sanitized[field] = boolInt(payload[field], true);
    else if (["contract_salary", "score", "cost", "evaluation_score"].includes(field)) sanitized[field] = Number(payload[field] || 0);
    else if (field === "openings") sanitized[field] = Math.max(1, Number(payload[field] || 1));
    else sanitized[field] = compact(payload[field]);
  }

  for (const field of config.required) {
    if (!sanitized[field] && sanitized[field] !== 0) {
      return { ok: false, message: `Preencha o campo obrigatório: ${field}.` };
    }
  }

  if (type === "contracts") {
    const employeeCheck = ensureEmployee(service, sanitized.employee_id);
    if (!employeeCheck.ok) return employeeCheck;
    if (!isDate(sanitized.start_date) || !isDate(sanitized.end_date) || !isDate(sanitized.probation_end_date)) {
      return { ok: false, message: "As datas do contrato são inválidas." };
    }
    if (sanitized.end_date && sanitized.end_date < sanitized.start_date) {
      return { ok: false, message: "A data de fim não pode ser anterior ao início do contrato." };
    }
    if (sanitized.contract_salary <= 0) {
      return { ok: false, message: "O salário contratual deve ser superior a zero." };
    }
    sanitized.status = sanitized.status || "active";
  }

  if (type === "approvalRequests") {
    sanitized.status = sanitized.status || "pending";
    sanitized.payload_json = JSON.stringify(parseJsonObject(payload.payload_json || payload.payload));
  }

  if (type === "performanceReviews") {
    const employeeCheck = ensureEmployee(service, sanitized.employee_id);
    if (!employeeCheck.ok) return employeeCheck;
    if (!isMonth(sanitized.review_period)) return { ok: false, message: "O período da avaliação deve usar o formato AAAA-MM." };
    if (sanitized.score < 0 || sanitized.score > 100) return { ok: false, message: "A pontuação deve estar entre 0 e 100." };
    sanitized.status = sanitized.status || "draft";
  }

  if (type === "trainingParticipants") {
    const employeeCheck = ensureEmployee(service, sanitized.employee_id);
    if (!employeeCheck.ok) return employeeCheck;
    const course = service.db.prepare("SELECT id FROM training_courses WHERE id = ? AND deleted_at IS NULL").get(sanitized.course_id);
    if (!course) return { ok: false, message: "Selecione uma formação válida." };
    sanitized.attendance_status = sanitized.attendance_status || "registered";
  }

  if (type === "recruitmentCandidates") {
    sanitized.stage = sanitized.stage || "new";
  }

  if (type === "onboardingProcesses") {
    const employeeCheck = ensureEmployee(service, sanitized.employee_id);
    if (!employeeCheck.ok) return employeeCheck;
    if (!isDate(sanitized.start_date) || !isDate(sanitized.due_date) || !isDate(sanitized.completed_at)) {
      return { ok: false, message: "As datas do onboarding são inválidas." };
    }
    sanitized.status = sanitized.status || "pending";
    sanitized.checklist_json = JSON.stringify(parseJsonArray(payload.checklist_json || payload.checklist || defaultOnboardingChecklist()));
  }

  if (type === "offboardingProcesses") {
    const employeeCheck = ensureEmployee(service, sanitized.employee_id);
    if (!employeeCheck.ok) return employeeCheck;
    if (!isDate(sanitized.exit_date)) return { ok: false, message: "A data de saida é inválida." };
    sanitized.status = sanitized.status || "pending";
    sanitized.checklist_json = JSON.stringify(parseJsonArray(payload.checklist_json || payload.checklist || defaultOffboardingChecklist()));
    sanitized.final_calculation_json = JSON.stringify(parseJsonObject(payload.final_calculation_json || payload.finalCalculation));
  }

  return { ok: true, sanitized };
}

function listEnterpriseRecords(service, type, filters = {}) {
  const config = getConfig(type);
  const conditions = [`${config.table}.deleted_at IS NULL`];
  const values = {};
  if (filters.id) {
    conditions.push(`${config.table}.id = @id`);
    values.id = Number(filters.id);
  }
  if (filters.employeeId && config.fields.includes("employee_id")) {
    conditions.push(`${config.table}.employee_id = @employeeId`);
    values.employeeId = Number(filters.employeeId);
  }
  if (filters.status && filters.status !== "todos") {
    conditions.push(`${config.table}.status = @status`);
    values.status = compact(filters.status);
  }
  if (filters.search) {
    conditions.push(`LOWER(${config.table}.row_label) LIKE @search`);
    values.search = `%${compact(filters.search).toLowerCase()}%`;
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const joins = buildEnterpriseJoins(config.table);
  return service.db.prepare(`
    SELECT ${config.table}.*, ${joins.selectSql}
    FROM ${config.table}
    ${joins.joinSql}
    ${where}
    ORDER BY ${config.table}.updated_at DESC, ${config.table}.id DESC
  `).all(values).map((row) => mapEnterpriseRow(type, row));
}

function buildEnterpriseJoins(table) {
  const select = ["'' AS noop_join"];
  const joins = [];
  if (["employee_contracts", "performance_reviews", "training_participants", "onboarding_processes", "offboarding_processes"].includes(table)) {
    select.push("employees.full_name AS employee_name");
    joins.push(`LEFT JOIN employees ON employees.id = ${table}.employee_id`);
  }
  if (table === "onboarding_processes") {
    select.push("recruitment_candidates.full_name AS candidate_name");
    joins.push("LEFT JOIN recruitment_candidates ON recruitment_candidates.id = onboarding_processes.candidate_id");
  }
  if (table === "recruitment_candidates") {
    select.push("recruitment_jobs.title AS job_title");
    joins.push("LEFT JOIN recruitment_jobs ON recruitment_jobs.id = recruitment_candidates.job_id");
  }
  if (table === "training_participants") {
    select.push("training_courses.title AS course_title");
    joins.push("LEFT JOIN training_courses ON training_courses.id = training_participants.course_id");
  }
  return { selectSql: select.join(", "), joinSql: joins.join("\n") };
}

function mapEnterpriseRow(type, row) {
  const mapped = { ...row };
  if (mapped.active !== undefined) mapped.active = Boolean(mapped.active);
  if (mapped.steps_json !== undefined) mapped.steps = parseJsonArray(mapped.steps_json);
  if (mapped.checklist_json !== undefined) mapped.checklist = parseJsonArray(mapped.checklist_json);
  if (mapped.payload_json !== undefined) mapped.payload = parseJsonObject(mapped.payload_json);
  if (mapped.final_calculation_json !== undefined) mapped.finalCalculation = parseJsonObject(mapped.final_calculation_json);
  if (mapped.goals_json !== undefined) mapped.goals = parseJsonObject(mapped.goals_json);
  if (mapped.criteria_json !== undefined) mapped.criteria = parseJsonObject(mapped.criteria_json);
  mapped.type = type;
  return mapped;
}

function getRecordLabel(type, record) {
  if (type === "contracts") return `${record.contract_type || "Contrato"} ${record.employee_id || ""}`.trim();
  if (type === "documentTemplates") return record.name;
  if (type === "approvalWorkflows") return record.name;
  if (type === "approvalRequests") return `${record.module} ${record.entity_type}`;
  if (type === "recruitmentJobs") return record.title;
  if (type === "recruitmentCandidates") return record.full_name;
  if (type === "onboardingProcesses") return `Onboarding ${record.employee_id || ""}`.trim();
  if (type === "offboardingProcesses") return `Offboarding ${record.employee_id || ""}`.trim();
  if (type === "performanceReviews") return `${record.employee_id} ${record.review_period}`;
  if (type === "trainingCourses") return record.title;
  if (type === "trainingParticipants") return `${record.course_id} ${record.employee_id}`;
  return "Registo empresarial";
}

function saveEnterpriseRecord(service, type, payload = {}, userId = null) {
  const config = getConfig(type);
  const validation = normalizeByType(service, type, payload);
  if (!validation.ok) return validation;
  const savedAt = nowIso();
  const sanitized = {
    ...validation.sanitized,
    row_label: getRecordLabel(type, validation.sanitized),
    updated_at: savedAt,
    sync_status: "pending"
  };

  return service.runInTransaction(() => {
    const createdByUserId = existingUserId(service, userId);
    if (sanitized.id) {
      const current = service.db.prepare(`SELECT id FROM ${config.table} WHERE id = ? AND deleted_at IS NULL`).get(sanitized.id);
      if (!current) return { ok: false, message: "O registo selecionado já não existe." };
      const assignments = config.fields
        .concat(["row_label", "updated_at", "sync_status"])
        .map((field) => `${field} = @${field}`)
        .join(", ");
      service.db.prepare(`UPDATE ${config.table} SET ${assignments} WHERE id = @id`).run(sanitized);
    } else {
      const insertFields = config.fields.concat(["global_id", "row_label", "created_by_user_id", "sync_status", "created_at", "updated_at"]);
      const record = {
        ...sanitized,
        global_id: service.createGlobalId ? service.createGlobalId(config.entity) : `${config.entity}-${Date.now()}`,
        created_by_user_id: createdByUserId,
        created_at: savedAt,
        updated_at: savedAt
      };
      service.db.prepare(`INSERT INTO ${config.table} (${insertFields.join(", ")}) VALUES (${insertFields.map((field) => `@${field}`).join(", ")})`).run(record);
      sanitized.id = service.db.prepare("SELECT last_insert_rowid() AS id").get().id;
    }

    if (type === "documentTemplates") {
      snapshotDocumentTemplateVersion(service, sanitized.id, createdByUserId, payload.change_reason || (payload.id ? "Atualizacao do modelo" : "Criacao do modelo"));
    }

    enqueueSyncEvent(service, config.entity, sanitized.id, sanitized.id ? "upsert" : "create", sanitized);
    return { ok: true, item: listEnterpriseRecords(service, type, { id: sanitized.id })[0], modules: getEnterpriseBootstrap(service) };
  });
}

function snapshotDocumentTemplateVersion(service, templateId, userId = null, reason = "") {
  const template = service.db.prepare("SELECT * FROM document_templates WHERE id = ? AND deleted_at IS NULL").get(templateId);
  if (!template) return null;
  const latest = service.db.prepare("SELECT MAX(version_number) AS version FROM document_template_versions WHERE template_id = ?").get(templateId);
  const versionNumber = Number(latest?.version || 0) + 1;
  service.db.prepare(`
    INSERT INTO document_template_versions (
      template_id, version_number, name, template_type, body, change_reason, created_by_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    template.id,
    versionNumber,
    template.name,
    template.template_type,
    template.body,
    compact(reason),
    existingUserId(service, userId),
    nowIso()
  );
  return service.db.prepare("SELECT * FROM document_template_versions WHERE template_id = ? AND version_number = ?").get(template.id, versionNumber);
}

function deleteEnterpriseRecord(service, type, id) {
  const config = getConfig(type);
  const current = service.db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!current) return { ok: false, message: "O registo selecionado já não existe." };
  return service.runInTransaction(() => {
    service.db.prepare(`UPDATE ${config.table} SET deleted_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`).run(nowIso(), nowIso(), id);
    enqueueSyncEvent(service, config.entity, id, "delete", current);
    return { ok: true, modules: getEnterpriseBootstrap(service) };
  });
}

function renderTemplate(body, context) {
  return String(body || "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split(".");
    let current = context;
    for (const part of parts) current = current?.[part];
    return current === undefined || current === null ? "" : String(current);
  });
}

function buildPrintableDocumentHtml(title, content) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 22mm 18mm; }
      body { color: #1f2933; font-family: Arial, Helvetica, sans-serif; font-size: 12pt; line-height: 1.55; margin: 0; }
      main { max-width: 172mm; margin: 0 auto; }
      h1 { color: #003366; font-size: 18pt; margin: 0 0 18pt; }
      pre { font: inherit; margin: 0; white-space: pre-wrap; word-break: break-word; }
      .document-meta { border-top: 1px solid #d0d7e2; color: #5f6b7a; font-size: 9pt; margin-top: 28pt; padding-top: 8pt; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <pre>${escapeHtml(content)}</pre>
      <div class="document-meta">Documento gerado pelo Kwanza Folha para revisão, arquivo e validação interna.</div>
    </main>
  </body>
</html>`;
}

function validateGeneratedDocumentContent({ title, content, html }) {
  const issues = [];
  const text = String(content || "");
  const htmlText = String(html || "");
  if (!String(title || "").trim()) issues.push("Titulo do documento ausente.");
  if (text.trim().length < 20) issues.push("Conteudo demasiado curto para um documento laboral.");
  if (/\{\{\s*[\w.]+\s*\}\}/.test(text)) issues.push("Existem placeholders não resolvidos no documento.");
  if (/<script\b/i.test(htmlText)) issues.push("Conteudo HTML contem script e foi sinalizado para revisao.");
  const longestWord = text.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  if (longestWord > 90) issues.push("Existem palavras/segmentos demasiado longos que podem quebrar o layout impresso.");
  const lineCount = text.split(/\r?\n/).length;
  if (lineCount > 120) issues.push("Documento muito longo para o modelo base; recomenda-se paginacao/modelo dedicado.");
  return {
    status: issues.length ? "warning" : "passed",
    checked_at: nowIso(),
    checks: {
      title: Boolean(String(title || "").trim()),
      has_content: text.trim().length >= 20,
      unresolved_placeholders: (text.match(/\{\{\s*[\w.]+\s*\}\}/g) || []).length,
      scripts_detected: /<script\b/i.test(htmlText),
      longest_word_length: longestWord,
      line_count: lineCount,
      printable_a4_css: /@page\s*\{[^}]*A4/i.test(htmlText)
    },
    issues
  };
}

function generateContractDocument(service, contractId, templateId, userId = null) {
  const contract = listEnterpriseRecords(service, "contracts", { id: contractId })[0];
  if (!contract) return { ok: false, message: "Contrato não encontrado." };
  const template = listEnterpriseRecords(service, "documentTemplates", { id: templateId })[0];
  if (!template) return { ok: false, message: "Modelo documental não encontrado." };
  const employee = service.listEmployees().find((item) => Number(item.id) === Number(contract.employee_id)) || {};
  const company = service.getCompanyProfile ? service.getCompanyProfile() : {};
  const content = renderTemplate(template.body, { contract, employee, company });
  const outputDir = path.join(service.workspaceDir, "Documentos Gerados");
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `contrato-${contract.id}-${Date.now()}.html`;
  const target = path.join(outputDir, fileName);
  const title = `${template.name} - ${employee.full_name || contract.employee_name || contract.id}`;
  const html = buildPrintableDocumentHtml(title, content);
  const qaReport = validateGeneratedDocumentContent({ title, content, html });
  fs.writeFileSync(target, html, "utf8");
  fs.writeFileSync(`${target}.qa.json`, JSON.stringify(qaReport, null, 2), "utf8");
  const templateVersion = service.db.prepare(`
    SELECT *
    FROM document_template_versions
    WHERE template_id = ?
    ORDER BY version_number DESC
    LIMIT 1
  `).get(template.id) || snapshotDocumentTemplateVersion(service, template.id, userId, "Snapshot automatico para documento gerado");
  const generatedAt = nowIso();
  const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  service.db.prepare(`
    INSERT INTO generated_documents (
      global_id, document_type, template_id, template_version_id, employee_id, contract_id,
      title, file_path, content_hash, status, qa_status, qa_report_json, created_by_user_id, sync_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, 'pending', ?, ?)
  `).run(
    service.createGlobalId ? service.createGlobalId("generated-document") : `document-${Date.now()}`,
    template.template_type || "contract",
    template.id,
    templateVersion?.id || null,
    contract.employee_id || null,
    contract.id,
    title,
    target,
    hash,
    qaReport.status,
    JSON.stringify(qaReport),
    existingUserId(service, userId),
    generatedAt,
    generatedAt
  );
  const generatedDocument = service.db.prepare("SELECT * FROM generated_documents WHERE id = last_insert_rowid()").get();
  enqueueSyncEvent(service, "generated_document", generatedDocument.id, "create", generatedDocument);
  return { ok: true, path: target, content, contract, template, templateVersion, generatedDocument, qaReport };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function listDocumentTemplateVersions(service, filters = {}) {
  const rows = service.db.prepare(`
    SELECT document_template_versions.*, users.full_name AS created_by_name
    FROM document_template_versions
    LEFT JOIN users ON users.id = document_template_versions.created_by_user_id
    WHERE (@templateId = 0 OR document_template_versions.template_id = @templateId)
    ORDER BY document_template_versions.template_id ASC, document_template_versions.version_number DESC
  `).all({ templateId: Number(filters.templateId || 0) });
  return rows;
}

function listGeneratedDocuments(service, filters = {}) {
  const rows = service.db.prepare(`
    SELECT generated_documents.*, employees.full_name AS employee_name, document_templates.name AS template_name
    FROM generated_documents
    LEFT JOIN employees ON employees.id = generated_documents.employee_id
    LEFT JOIN document_templates ON document_templates.id = generated_documents.template_id
    WHERE generated_documents.deleted_at IS NULL
      AND (@employeeId = 0 OR generated_documents.employee_id = @employeeId)
      AND (@documentType = '' OR generated_documents.document_type = @documentType)
    ORDER BY generated_documents.created_at DESC, generated_documents.id DESC
    LIMIT 250
  `).all({
    employeeId: Number(filters.employeeId || 0),
    documentType: compact(filters.documentType)
  });
  return rows.map((row) => ({ ...row, qaReport: parseJsonObject(row.qa_report_json) }));
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    const key = compact(row[field]) || "sem_estado";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildEnterpriseExecutiveSummary(service) {
  const employees = service.listEmployees();
  const activeEmployees = employees.filter((employee) => String(employee.status || "").toLowerCase() === "ativo");
  const contracts = listEnterpriseRecords(service, "contracts");
  const candidates = listEnterpriseRecords(service, "recruitmentCandidates");
  const jobs = listEnterpriseRecords(service, "recruitmentJobs");
  const onboarding = listEnterpriseRecords(service, "onboardingProcesses");
  const offboarding = listEnterpriseRecords(service, "offboardingProcesses");
  const reviews = listEnterpriseRecords(service, "performanceReviews");
  const courses = listEnterpriseRecords(service, "trainingCourses");
  const syncEvents = listSyncOutbox(service, { limit: 500 });
  const fiscalMaps = listFiscalMonthlyMaps(service, {});
  const contractAlerts = buildContractAlerts(service, { referenceDate: todayIso(), daysAhead: 45 });
  const completedReviews = reviews.filter((review) => Number(review.score || 0) > 0);
  const averagePerformanceScore = completedReviews.length
    ? Number((completedReviews.reduce((sum, review) => sum + Number(review.score || 0), 0) / completedReviews.length).toFixed(2))
    : 0;
  return {
    generated_at: nowIso(),
    employees: {
      active: activeEmployees.length,
      total: employees.length
    },
    contracts: {
      total: contracts.length,
      active: contracts.filter((contract) => ["active", "renewed"].includes(String(contract.status || "").toLowerCase())).length,
      alerts: contractAlerts.items.length,
      alertsByType: countBy(contractAlerts.items, "alert_type")
    },
    recruitment: {
      openJobs: jobs.filter((job) => String(job.status || "").toLowerCase() === "open").length,
      candidates: candidates.length,
      candidatesByStage: countBy(candidates, "stage")
    },
    lifecycle: {
      onboardingPending: onboarding.filter((item) => !["completed", "cancelled"].includes(String(item.status || "").toLowerCase())).length,
      offboardingPending: offboarding.filter((item) => !["completed", "cancelled"].includes(String(item.status || "").toLowerCase())).length
    },
    performance: {
      reviews: reviews.length,
      averageScore: averagePerformanceScore
    },
    training: {
      courses: courses.length,
      plannedCost: Number(courses.reduce((sum, course) => sum + Number(course.cost || 0), 0).toFixed(2))
    },
    fiscal: {
      maps: fiscalMaps.length,
      mapsByStatus: countBy(fiscalMaps, "status")
    },
    sync: {
      pending: syncEvents.filter((event) => event.status === "pending").length,
      failed: syncEvents.filter((event) => event.status === "failed").length,
      synced: syncEvents.filter((event) => event.status === "synced").length
    }
  };
}

function exportEnterpriseSummaryExcel(service, filters = {}, buildExcelTableDocument) {
  const summary = buildEnterpriseExecutiveSummary(service);
  const rows = [
    ["Funcionários ativos", summary.employees.active],
    ["Funcionários totais", summary.employees.total],
    ["Contratos ativos", summary.contracts.active],
    ["Alertas de contrato", summary.contracts.alerts],
    ["Vagas abertas", summary.recruitment.openJobs],
    ["Candidatos", summary.recruitment.candidates],
    ["Onboarding pendente", summary.lifecycle.onboardingPending],
    ["Offboarding pendente", summary.lifecycle.offboardingPending],
    ["Avaliacoes", summary.performance.reviews],
    ["Pontuação média", summary.performance.averageScore],
    ["Formacoes", summary.training.courses],
    ["Custo previsto de formação", summary.training.plannedCost],
    ["Mapas fiscais", summary.fiscal.maps],
    ["Sync pendente", summary.sync.pending],
    ["Sync falhado", summary.sync.failed]
  ];
  const content = buildExcelTableDocument("Resumo executivo Suite RH", ["Indicador", "Valor"], rows);
  const target = path.join(service.excelExportsDir, `suite-rh-resumo-executivo-${new Date().toISOString().slice(0, 10)}.xls`);
  fs.writeFileSync(target, content, "utf8");
  return { ok: true, path: target, summary };
}

function getEnterpriseBootstrap(service) {
  const executiveSummary = buildEnterpriseExecutiveSummary(service);
  return {
    executiveSummary,
    contracts: listEnterpriseRecords(service, "contracts"),
    contractAlerts: buildContractAlerts(service, { referenceDate: todayIso(), daysAhead: 45 }),
    documentTemplates: listEnterpriseRecords(service, "documentTemplates"),
    documentTemplateVersions: listDocumentTemplateVersions(service, {}),
    generatedDocuments: listGeneratedDocuments(service, {}),
    approvalWorkflows: listEnterpriseRecords(service, "approvalWorkflows"),
    approvalRequests: listEnterpriseRecords(service, "approvalRequests"),
    recruitmentJobs: listEnterpriseRecords(service, "recruitmentJobs"),
    recruitmentCandidates: listEnterpriseRecords(service, "recruitmentCandidates"),
    onboardingProcesses: listEnterpriseRecords(service, "onboardingProcesses"),
    offboardingProcesses: listEnterpriseRecords(service, "offboardingProcesses"),
    performanceReviews: listEnterpriseRecords(service, "performanceReviews"),
    trainingCourses: listEnterpriseRecords(service, "trainingCourses"),
    trainingParticipants: listEnterpriseRecords(service, "trainingParticipants"),
    approvalEvents: listApprovalRequestEvents(service, {}),
    syncOutbox: listSyncOutbox(service, { limit: 50 }),
    payrollVersions: listPayrollRunVersions(service, {}),
    fiscalMaps: listFiscalMonthlyMaps(service, {})
  };
}

function buildContractAlerts(service, filters = {}) {
  const referenceDate = isDate(filters.referenceDate) && filters.referenceDate ? filters.referenceDate : todayIso();
  const daysAhead = Math.max(1, Math.min(365, Number(filters.daysAhead || 45)));
  const limitDate = addDays(referenceDate, daysAhead);
  const activeContracts = service.db.prepare(`
    SELECT employee_contracts.*, employees.full_name AS employee_name
    FROM employee_contracts
    JOIN employees ON employees.id = employee_contracts.employee_id
    WHERE employee_contracts.deleted_at IS NULL
      AND employees.deleted_at IS NULL
      AND employee_contracts.status IN ('active', 'renewed')
    ORDER BY employee_contracts.end_date ASC, employee_contracts.probation_end_date ASC
  `).all();
  const contractedEmployeeIds = new Set(activeContracts.map((contract) => Number(contract.employee_id)));
  const activeEmployees = service.listEmployees().filter((employee) => String(employee.status || "").toLowerCase() === "ativo");
  const withoutContract = activeEmployees
    .filter((employee) => !contractedEmployeeIds.has(Number(employee.id)))
    .map((employee) => ({
      alert_type: "missing_contract",
      severity: "high",
      employee_id: employee.id,
      employee_name: employee.full_name,
      message: "Funcionário ativo sem contrato registado.",
      due_date: ""
    }));
  const endingSoon = activeContracts
    .filter((contract) => contract.end_date && contract.end_date >= referenceDate && contract.end_date <= limitDate)
    .map((contract) => ({
      alert_type: "contract_ending",
      severity: "medium",
      contract_id: contract.id,
      employee_id: contract.employee_id,
      employee_name: contract.employee_name,
      message: "Contrato próximo do fim.",
      due_date: contract.end_date
    }));
  const probationEnding = activeContracts
    .filter((contract) => contract.probation_end_date && contract.probation_end_date >= referenceDate && contract.probation_end_date <= limitDate)
    .map((contract) => ({
      alert_type: "probation_ending",
      severity: "medium",
      contract_id: contract.id,
      employee_id: contract.employee_id,
      employee_name: contract.employee_name,
      message: "Período experimental próximo do fim.",
      due_date: contract.probation_end_date
    }));
  const expired = activeContracts
    .filter((contract) => contract.end_date && contract.end_date < referenceDate)
    .map((contract) => ({
      alert_type: "contract_expired",
      severity: "high",
      contract_id: contract.id,
      employee_id: contract.employee_id,
      employee_name: contract.employee_name,
      message: "Contrato expirado ainda marcado como ativo.",
      due_date: contract.end_date
    }));

  return { referenceDate, daysAhead, items: [...withoutContract, ...expired, ...endingSoon, ...probationEnding] };
}

function transitionContract(service, id, action, payload = {}, userId = null) {
  const contractId = numberOrNull(id);
  const normalizedAction = compact(action).toLowerCase();
  if (!contractId) return { ok: false, message: "Selecione um contrato valido." };
  if (!["renew", "terminate", "expire", "activate"].includes(normalizedAction)) {
    return { ok: false, message: "Ação contratual inválida." };
  }

  return service.runInTransaction(() => {
    const contract = service.db.prepare("SELECT * FROM employee_contracts WHERE id = ? AND deleted_at IS NULL").get(contractId);
    if (!contract) return { ok: false, message: "Contrato não encontrado." };
    const updatedAt = nowIso();
    let nextStatus = contract.status;
    let notes = compact(payload.notes || contract.notes);

    if (normalizedAction === "renew") {
      if (!isDate(payload.end_date || "")) return { ok: false, message: "A nova data de fim do contrato é inválida." };
      nextStatus = "renewed";
      notes = `${notes}${notes ? "\n" : ""}Renovado em ${todayIso()}${payload.end_date ? ` ate ${payload.end_date}` : ""}.`;
      service.db.prepare(`
        UPDATE employee_contracts
        SET end_date = COALESCE(NULLIF(?, ''), end_date),
            probation_end_date = COALESCE(NULLIF(?, ''), probation_end_date),
            status = ?,
            notes = ?,
            updated_at = ?,
            sync_status = 'pending'
        WHERE id = ?
      `).run(compact(payload.end_date), compact(payload.probation_end_date), nextStatus, notes, updatedAt, contractId);
    } else {
      nextStatus = normalizedAction === "terminate" ? "terminated" : normalizedAction === "expire" ? "expired" : "active";
      notes = `${notes}${notes ? "\n" : ""}${normalizedAction} em ${todayIso()}.`;
      service.db.prepare(`
        UPDATE employee_contracts
        SET status = ?, notes = ?, updated_at = ?, sync_status = 'pending'
        WHERE id = ?
      `).run(nextStatus, notes, updatedAt, contractId);
    }

    enqueueSyncEvent(service, "contract", contractId, normalizedAction, { id: contractId, from_status: contract.status, to_status: nextStatus });
    return { ok: true, item: listEnterpriseRecords(service, "contracts", { id: contractId })[0], modules: getEnterpriseBootstrap(service) };
  });
}

function listApprovalRequestEvents(service, filters = {}) {
  const conditions = ["1 = 1"];
  const values = {};
  if (filters.requestId) {
    conditions.push("approval_request_events.request_id = @requestId");
    values.requestId = Number(filters.requestId);
  }
  const rows = service.db.prepare(`
    SELECT approval_request_events.*, users.full_name AS actor_name
    FROM approval_request_events
    LEFT JOIN users ON users.id = approval_request_events.actor_user_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY approval_request_events.created_at DESC, approval_request_events.id DESC
  `).all(values);
  return rows;
}

function transitionApprovalRequest(service, id, action, userId = null, notes = "") {
  const requestId = numberOrNull(id);
  const normalizedAction = compact(action).toLowerCase();
  if (!requestId) return { ok: false, message: "Selecione um pedido de aprovação válido." };
  if (!["approve", "reject", "cancel", "reopen"].includes(normalizedAction)) {
    return { ok: false, message: "Ação de aprovação inválida." };
  }

  return service.runInTransaction(() => {
    const request = service.db.prepare("SELECT * FROM approval_requests WHERE id = ? AND deleted_at IS NULL").get(requestId);
    if (!request) return { ok: false, message: "Pedido de aprovação não encontrado." };
    const workflow = request.workflow_id
      ? service.db.prepare("SELECT * FROM approval_workflows WHERE id = ? AND deleted_at IS NULL").get(request.workflow_id)
      : null;
    const steps = parseJsonArray(workflow?.steps_json);
    const currentStep = Number(request.current_step || 0);
    const terminalStatuses = ["approved", "rejected", "cancelled"];
    if (terminalStatuses.includes(String(request.status || "").toLowerCase()) && normalizedAction !== "reopen") {
      return { ok: false, message: "Este pedido já foi decidido." };
    }

    let nextStep = currentStep;
    let nextStatus = request.status || "pending";
    const decidedAt = nowIso();
    const actorId = existingUserId(service, userId);

    if (normalizedAction === "approve") {
      const finalStep = !steps.length || currentStep + 1 >= steps.length;
      nextStatus = finalStep ? "approved" : "in_review";
      nextStep = finalStep ? currentStep : currentStep + 1;
    } else if (normalizedAction === "reject") {
      nextStatus = "rejected";
    } else if (normalizedAction === "cancel") {
      nextStatus = "cancelled";
    } else if (normalizedAction === "reopen") {
      nextStatus = "pending";
      nextStep = 0;
    }

    const isDecision = ["approved", "rejected", "cancelled"].includes(nextStatus);
    service.db.prepare(`
      UPDATE approval_requests
      SET status = ?,
          current_step = ?,
          decided_by_user_id = ?,
          decided_at = ?,
          updated_at = ?,
          sync_status = 'pending'
      WHERE id = ?
    `).run(nextStatus, nextStep, isDecision ? actorId : null, isDecision ? decidedAt : null, decidedAt, requestId);

    service.db.prepare(`
      INSERT INTO approval_request_events (
        request_id, action, from_status, to_status, step_index, actor_user_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestId, normalizedAction, request.status, nextStatus, nextStep, actorId, compact(notes), decidedAt);

    enqueueSyncEvent(service, "approval_request", requestId, normalizedAction, {
      id: requestId,
      from_status: request.status,
      to_status: nextStatus,
      step_index: nextStep,
      notes: compact(notes)
    });

    return {
      ok: true,
      item: listEnterpriseRecords(service, "approvalRequests", { id: requestId })[0],
      events: listApprovalRequestEvents(service, { requestId }),
      modules: getEnterpriseBootstrap(service)
    };
  });
}

function enqueueSyncEvent(service, entityType, entityId, action, payload = {}) {
  service.db.prepare(`
    INSERT INTO sync_outbox (global_id, entity_type, entity_id, action, payload_json, status, attempt_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(
    service.createGlobalId ? service.createGlobalId("sync-event") : `sync-${Date.now()}`,
    entityType,
    entityId ?? null,
    action,
    JSON.stringify(payload || {}),
    nowIso(),
    nowIso()
  );
}

function listSyncOutbox(service, filters = {}) {
  const limit = Math.max(1, Math.min(500, Number(filters.limit || 100)));
  const rows = service.db.prepare(`
    SELECT *
    FROM sync_outbox
    WHERE (@status = '' OR status = @status)
    ORDER BY created_at ASC
    LIMIT ${limit}
  `).all({ status: compact(filters.status) });
  return rows.map((row) => ({ ...row, payload: parseJsonObject(row.payload_json) }));
}

function markSyncEvent(service, id, status, errorMessage = "") {
  const normalized = ["pending", "synced", "failed"].includes(compact(status)) ? compact(status) : "pending";
  service.db.prepare(`
    UPDATE sync_outbox
    SET status = ?, last_error = ?, attempt_count = attempt_count + 1, updated_at = ?
    WHERE id = ?
  `).run(normalized, compact(errorMessage), nowIso(), id);
  return { ok: true, items: listSyncOutbox(service, { limit: 100 }) };
}

function retryFailedSyncEvents(service) {
  const updatedAt = nowIso();
  const result = service.db.prepare(`
    UPDATE sync_outbox
    SET status = 'pending', last_error = '', updated_at = ?
    WHERE status = 'failed'
  `).run(updatedAt);
  return { ok: true, retried: result.changes || 0, items: listSyncOutbox(service, { limit: 100 }) };
}

function exportSyncOutboxPackage(service, filters = {}) {
  const status = compact(filters.status) || "pending";
  const limit = Math.max(1, Math.min(1000, Number(filters.limit || 500)));
  const events = listSyncOutbox(service, { status, limit });
  if (!events.length) {
    return { ok: false, message: "Não existem eventos de sincronização para exportar." };
  }
  const generatedAt = nowIso();
  const packageId = service.createGlobalId ? service.createGlobalId("sync-package") : `sync-package-${Date.now()}`;
  const payload = {
    package_id: packageId,
    generated_at: generatedAt,
    status,
    total_events: events.length,
    events: events.map((event) => ({
      id: event.id,
      global_id: event.global_id,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      action: event.action,
      status: event.status,
      attempt_count: event.attempt_count,
      created_at: event.created_at,
      updated_at: event.updated_at,
      payload: event.payload
    }))
  };
  const body = JSON.stringify(payload, null, 2);
  const checksum = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  const outputDir = path.join(service.workspaceDir, "Sync");
  fs.mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, `${packageId}.json`);
  fs.writeFileSync(target, JSON.stringify({ ...payload, sha256: checksum }, null, 2), "utf8");
  return { ok: true, path: target, packageId, checksum, count: events.length, status };
}

function createPayrollRunVersion(service, monthRef, userId = null, reason = "") {
  if (!isMonth(monthRef)) return { ok: false, message: "Indique um período válido no formato AAAA-MM." };
  const runs = service.listPayrollRuns({ monthRef });
  if (!runs.length) return { ok: false, message: "Não existem folhas processadas para versionar neste período." };
  const latest = service.db.prepare("SELECT MAX(version_number) AS version FROM payroll_run_versions WHERE month_ref = ?").get(monthRef);
  const versionNumber = Number(latest?.version || 0) + 1;
  service.db.prepare(`
    INSERT INTO payroll_run_versions (month_ref, version_number, reason, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(monthRef, versionNumber, compact(reason) || "Snapshot manual", JSON.stringify(runs), existingUserId(service, userId), nowIso());
  return { ok: true, versionNumber, items: listPayrollRunVersions(service, { monthRef }) };
}

function listPayrollRunVersions(service, filters = {}) {
  const rows = service.db.prepare(`
    SELECT payroll_run_versions.*, users.full_name AS created_by_name
    FROM payroll_run_versions
    LEFT JOIN users ON users.id = payroll_run_versions.created_by_user_id
    WHERE (@monthRef = '' OR payroll_run_versions.month_ref = @monthRef)
    ORDER BY month_ref DESC, version_number DESC
  `).all({ monthRef: compact(filters.monthRef) });
  return rows.map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot_json || "[]") }));
}

function payrollVersionKey(row) {
  return String(row.employee_id || row.employeeId || row.bi || row.full_name || row.employee_name || "");
}

function payrollVersionEmployeeName(row) {
  return row.employee_name || row.full_name || row.name || `Funcionário ${row.employee_id || ""}`.trim();
}

function payrollVersionNumber(row, field) {
  return Number(row?.[field] || 0);
}

function resolvePayrollVersionPair(service, monthRef, leftVersionNumber = null, rightVersionNumber = null) {
  if (!isMonth(monthRef)) return { ok: false, message: "Indique um período válido no formato AAAA-MM." };
  const versions = listPayrollRunVersions(service, { monthRef });
  if (versions.length < 2 && (!leftVersionNumber || !rightVersionNumber)) {
    return { ok: false, message: "São necessárias pelo menos duas versões da folha para comparar." };
  }
  const left = leftVersionNumber
    ? versions.find((item) => Number(item.version_number) === Number(leftVersionNumber))
    : versions[1];
  const right = rightVersionNumber
    ? versions.find((item) => Number(item.version_number) === Number(rightVersionNumber))
    : versions[0];
  if (!left || !right) return { ok: false, message: "Versões da folha não encontradas para comparação." };
  if (Number(left.version_number) === Number(right.version_number)) {
    return { ok: false, message: "Selecione duas versões diferentes para comparar." };
  }
  return { ok: true, left, right };
}

function comparePayrollRunVersions(service, monthRef, leftVersionNumber = null, rightVersionNumber = null) {
  const pair = resolvePayrollVersionPair(service, monthRef, leftVersionNumber, rightVersionNumber);
  if (!pair.ok) return pair;
  const leftRows = new Map((pair.left.snapshot || []).map((row) => [payrollVersionKey(row), row]));
  const rightRows = new Map((pair.right.snapshot || []).map((row) => [payrollVersionKey(row), row]));
  const keys = Array.from(new Set([...leftRows.keys(), ...rightRows.keys()])).filter(Boolean);
  const rows = keys.map((key) => {
    const before = leftRows.get(key) || null;
    const after = rightRows.get(key) || null;
    const grossBefore = payrollVersionNumber(before, "gross_salary");
    const grossAfter = payrollVersionNumber(after, "gross_salary");
    const netBefore = payrollVersionNumber(before, "net_salary");
    const netAfter = payrollVersionNumber(after, "net_salary");
    const irtBefore = payrollVersionNumber(before, "irt_amount");
    const irtAfter = payrollVersionNumber(after, "irt_amount");
    const inssBefore = payrollVersionNumber(before, "inss_amount");
    const inssAfter = payrollVersionNumber(after, "inss_amount");
    const status = before && after
      ? (grossBefore !== grossAfter || netBefore !== netAfter || irtBefore !== irtAfter || inssBefore !== inssAfter ? "changed" : "unchanged")
      : before ? "removed" : "added";
    return {
      employee_id: after?.employee_id || before?.employee_id || null,
      employee_name: payrollVersionEmployeeName(after || before || {}),
      status,
      gross_before: grossBefore,
      gross_after: grossAfter,
      gross_delta: Number((grossAfter - grossBefore).toFixed(2)),
      net_before: netBefore,
      net_after: netAfter,
      net_delta: Number((netAfter - netBefore).toFixed(2)),
      irt_before: irtBefore,
      irt_after: irtAfter,
      irt_delta: Number((irtAfter - irtBefore).toFixed(2)),
      inss_before: inssBefore,
      inss_after: inssAfter,
      inss_delta: Number((inssAfter - inssBefore).toFixed(2))
    };
  });
  const totals = rows.reduce((acc, row) => ({
    gross_delta: Number((acc.gross_delta + row.gross_delta).toFixed(2)),
    net_delta: Number((acc.net_delta + row.net_delta).toFixed(2)),
    irt_delta: Number((acc.irt_delta + row.irt_delta).toFixed(2)),
    inss_delta: Number((acc.inss_delta + row.inss_delta).toFixed(2)),
    changed: acc.changed + (row.status === "changed" ? 1 : 0),
    added: acc.added + (row.status === "added" ? 1 : 0),
    removed: acc.removed + (row.status === "removed" ? 1 : 0)
  }), { gross_delta: 0, net_delta: 0, irt_delta: 0, inss_delta: 0, changed: 0, added: 0, removed: 0 });
  return {
    ok: true,
    monthRef,
    leftVersion: pair.left.version_number,
    rightVersion: pair.right.version_number,
    totals,
    rows
  };
}

function exportPayrollVersionComparisonExcel(service, payload = {}, buildExcelTableDocument) {
  const comparison = comparePayrollRunVersions(service, payload.monthRef, payload.leftVersionNumber, payload.rightVersionNumber);
  if (!comparison.ok) return comparison;
  const content = buildExcelTableDocument(
    `Comparacao folha ${comparison.monthRef} v${comparison.leftVersion}-v${comparison.rightVersion}`,
    ["Funcionário", "Estado", "Bruto antes", "Bruto depois", "Delta bruto", "Líquido antes", "Líquido depois", "Delta líquido", "IRT delta", "INSS delta"],
    comparison.rows.map((row) => [
      row.employee_name,
      row.status,
      row.gross_before.toFixed(2),
      row.gross_after.toFixed(2),
      row.gross_delta.toFixed(2),
      row.net_before.toFixed(2),
      row.net_after.toFixed(2),
      row.net_delta.toFixed(2),
      row.irt_delta.toFixed(2),
      row.inss_delta.toFixed(2)
    ])
  );
  const target = path.join(service.excelExportsDir, `folha-versoes-${comparison.monthRef}-v${comparison.leftVersion}-v${comparison.rightVersion}.xls`);
  fs.writeFileSync(target, content, "utf8");
  return { ok: true, path: target, comparison };
}

function buildFinalFiscalMap(service, monthRef, mapType = "agt", userId = null) {
  if (!isMonth(monthRef)) return { ok: false, message: "Indique um período válido no formato AAAA-MM." };
  const payrollRows = service.listPayrollRuns({ monthRef });
  if (!payrollRows.length) return { ok: false, message: "Não existem salários processados para o mapa fiscal." };
  const agtMap = service.buildAgtMonthlyRemunerationMap ? service.buildAgtMonthlyRemunerationMap(monthRef) : null;
  const totals = {
    gross: payrollRows.reduce((sum, row) => sum + Number(row.gross_salary || 0), 0),
    net: payrollRows.reduce((sum, row) => sum + Number(row.net_salary || 0), 0),
    employeeInss: payrollRows.reduce((sum, row) => sum + Number(row.inss_amount || 0), 0),
    employerInss: payrollRows.reduce((sum, row) => sum + Number(row.summary_json?.employerInssAmount || 0), 0),
    irt: payrollRows.reduce((sum, row) => sum + Number(row.irt_amount || 0), 0)
  };
  const payload = {
    mapType: compact(mapType) || "agt",
    monthRef,
    totals,
    validation: agtMap?.validation || {},
    rows: agtMap?.items || payrollRows
  };
  service.db.prepare(`
    INSERT INTO fiscal_monthly_maps (month_ref, map_type, status, payload_json, totals_json, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
    ON CONFLICT(month_ref, map_type) DO UPDATE SET
      payload_json = excluded.payload_json,
      totals_json = excluded.totals_json,
      updated_at = excluded.updated_at
  `).run(monthRef, payload.mapType, JSON.stringify(payload), JSON.stringify(totals), existingUserId(service, userId), nowIso(), nowIso());
  return { ok: true, map: listFiscalMonthlyMaps(service, { monthRef, mapType: payload.mapType })[0] };
}

function updateFiscalMonthlyMapStatus(service, id, payload = {}, userId = null) {
  const mapId = numberOrNull(id);
  const status = compact(payload.status).toLowerCase();
  const allowed = ["draft", "ready", "pending", "submitted", "accepted", "rejected"];
  if (!mapId) return { ok: false, message: "Selecione um mapa fiscal valido." };
  if (!allowed.includes(status)) return { ok: false, message: "Estado do mapa fiscal inválido." };
  const current = service.db.prepare("SELECT * FROM fiscal_monthly_maps WHERE id = ?").get(mapId);
  if (!current) return { ok: false, message: "Mapa fiscal não encontrado." };

  service.db.prepare(`
    UPDATE fiscal_monthly_maps
    SET status = ?,
        proof_path = ?,
        proof_reference = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    status,
    compact(payload.proof_path || current.proof_path),
    compact(payload.proof_reference || current.proof_reference),
    nowIso(),
    mapId
  );
  enqueueSyncEvent(service, "fiscal_monthly_map", mapId, "status", {
    id: mapId,
    from_status: current.status,
    to_status: status,
    proof_reference: compact(payload.proof_reference || current.proof_reference),
    user_id: existingUserId(service, userId)
  });
  return { ok: true, map: listFiscalMonthlyMaps(service, { monthRef: current.month_ref, mapType: current.map_type })[0], modules: getEnterpriseBootstrap(service) };
}

function listFiscalMonthlyMaps(service, filters = {}) {
  const rows = service.db.prepare(`
    SELECT fiscal_monthly_maps.*, users.full_name AS created_by_name
    FROM fiscal_monthly_maps
    LEFT JOIN users ON users.id = fiscal_monthly_maps.created_by_user_id
    WHERE (@monthRef = '' OR month_ref = @monthRef)
      AND (@mapType = '' OR map_type = @mapType)
    ORDER BY month_ref DESC, map_type ASC
  `).all({ monthRef: compact(filters.monthRef), mapType: compact(filters.mapType) });
  return rows.map((row) => ({ ...row, payload: parseJsonObject(row.payload_json), totals: parseJsonObject(row.totals_json) }));
}

function convertCandidateToEmployee(service, candidateId, payload = {}, userId = null) {
  const id = numberOrNull(candidateId);
  if (!id) return { ok: false, message: "Selecione um candidato valido." };

  try {
    return service.runInTransaction(() => {
      const candidate = service.db.prepare(`
        SELECT recruitment_candidates.*, recruitment_jobs.title AS job_title, recruitment_jobs.company_id, recruitment_jobs.department_id, recruitment_jobs.job_position_id
        FROM recruitment_candidates
        LEFT JOIN recruitment_jobs ON recruitment_jobs.id = recruitment_candidates.job_id
        WHERE recruitment_candidates.id = ? AND recruitment_candidates.deleted_at IS NULL
      `).get(id);
      if (!candidate) return { ok: false, message: "Candidato não encontrado." };
      if (candidate.converted_employee_id) return { ok: false, message: "Este candidato já foi convertido em funcionário." };

      const employeePayload = {
        full_name: compact(payload.full_name) || candidate.full_name,
        document_type: compact(payload.document_type) || "bi",
        bi: compact(payload.bi),
        nif: compact(payload.nif),
        social_security_number: compact(payload.social_security_number || payload.inss),
        company_id: numberOrNull(payload.company_id) || candidate.company_id || null,
        department_id: numberOrNull(payload.department_id) || candidate.department_id || null,
        job_position_id: numberOrNull(payload.job_position_id) || candidate.job_position_id || null,
        job_title: compact(payload.job_title) || candidate.job_title || "Funcionário",
        department: compact(payload.department) || "Geral",
        base_salary: Number(payload.base_salary || 0),
        contract_type: compact(payload.contract_type) || "Indeterminado",
        hire_date: compact(payload.hire_date) || todayIso(),
        iban: compact(payload.iban),
        bank_code: compact(payload.bank_code),
        bank_account: compact(payload.bank_account),
        personal_phone: compact(payload.personal_phone) || candidate.phone,
        personal_email: compact(payload.personal_email) || candidate.email,
        status: "ativo",
        recurring_allowances: [],
        recurring_bonuses: [],
        special_payments: []
      };
      const saved = service.saveEmployee(employeePayload);
      if (!saved.ok) return saved;
      const employee = saved.employees.find((item) => String(item.bi || "").toUpperCase() === employeePayload.bi.toUpperCase())
        || saved.employees.find((item) => item.full_name === employeePayload.full_name);
      if (!employee?.id) throw new Error("Funcionário convertido não encontrado após gravação.");

      service.db.prepare(`
        UPDATE recruitment_candidates
        SET stage = 'hired',
            converted_employee_id = ?,
            updated_at = ?,
            sync_status = 'pending'
        WHERE id = ?
      `).run(employee.id, nowIso(), id);

      const onboardingResult = saveEnterpriseRecord(service, "onboardingProcesses", {
        employee_id: employee.id,
        candidate_id: id,
        status: "pending",
        start_date: employeePayload.hire_date,
        due_date: addDays(employeePayload.hire_date, 7),
        checklist_json: defaultOnboardingChecklist(),
        notes: `Processo criado automaticamente a partir do candidato ${candidate.full_name}.`
      }, userId);
      if (!onboardingResult.ok) throw new Error(onboardingResult.message || "Não foi possível criar o onboarding.");

      let contract = null;
      if (payload.create_contract !== false) {
        const contractResult = saveEnterpriseRecord(service, "contracts", {
          employee_id: employee.id,
          contract_type: employeePayload.contract_type,
          start_date: employeePayload.hire_date,
          end_date: compact(payload.contract_end_date),
          probation_end_date: compact(payload.probation_end_date),
          contract_salary: employeePayload.base_salary,
          job_position_id: employeePayload.job_position_id,
          department_id: employeePayload.department_id,
          status: "active",
          notes: compact(payload.contract_notes) || `Contrato inicial criado a partir do candidato ${candidate.full_name}.`
        }, userId);
        if (!contractResult.ok) throw new Error(contractResult.message || "Não foi possível criar o contrato inicial.");
        contract = contractResult.item;
      }

      enqueueSyncEvent(service, "recruitment_candidate", id, "convert_to_employee", { candidate_id: id, employee_id: employee.id });
      return { ok: true, employee, contract, onboarding: onboardingResult.item, modules: getEnterpriseBootstrap(service), employees: service.listEmployees() };
    });
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
}

const EMPLOYEE_EXPORT_HEADERS = [
  "Nome",
  "Tipo documento",
  "BI",
  "NIF",
  "INSS",
  "Empresa",
  "Departamento",
  "Cargo",
  "Salário base",
  "Tipo contrato",
  "Data de admissão",
  "IBAN",
  "Banco",
  "Conta",
  "Telefone",
  "Email",
  "Estado"
];

function exportEmployeesExcel(service, filters = {}) {
  const rows = service.listEmployees().filter((employee) => {
    if (filters.status && filters.status !== "todos" && employee.status !== filters.status) return false;
    if (filters.companyId && Number(employee.company_id) !== Number(filters.companyId)) return false;
    return true;
  });
  const excelRows = rows.map((row) => [
      row.full_name,
      row.document_type || "bi",
      row.bi,
      row.nif,
      row.social_security_number,
      row.company_name,
      row.department,
      row.job_title,
      Number(row.base_salary || 0).toFixed(2),
      row.contract_type,
      row.hire_date,
      row.iban,
      row.bank_code,
      row.bank_account,
      row.personal_phone,
      row.personal_email,
      row.status
    ]);
  const target = path.join(service.excelExportsDir, `funcionários-${new Date().toISOString().slice(0, 10)}.xlsx`);
  fs.writeFileSync(target, buildXlsxBuffer({ headers: EMPLOYEE_EXPORT_HEADERS, rows: excelRows }));
  return { ok: true, path: target, count: rows.length, format: "xlsx" };
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < String(line || "").length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimited(content) {
  const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const parseLine = (line) => parseDelimitedLine(line, delimiter);
  const headers = parseLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = cells[index] || "";
      return acc;
    }, {});
  });
}

function parseHtmlTable(content) {
  const rows = [];
  const rowMatches = String(content || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [];
    const cellMatches = rowHtml.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
    for (const cellHtml of cellMatches) {
      cells.push(decodeHtmlEntities(cellHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")));
    }
    if (cells.length) rows.push(cells);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells) => headers.reduce((acc, header, index) => {
    acc[header] = cells[index] || "";
    return acc;
  }, {}));
}

function parseXlsxTable(filePath) {
  const rows = readXlsxRows(fs.readFileSync(filePath));
  const visibleRows = rows.filter((row) => row.some((cell) => String(cell || "").trim()));
  if (visibleRows.length < 2) return [];
  const headers = visibleRows[0].map(normalizeHeader);
  return visibleRows.slice(1).map((cells) => headers.reduce((acc, header, index) => {
    acc[header] = String(cells[index] ?? "").trim();
    return acc;
  }, {}));
}

function parseEmployeeImportRows(filePath) {
  if (/\.xlsx$/i.test(filePath)) {
    return parseXlsxTable(filePath);
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (/<table[\s>]/i.test(content) || /<tr[\s>]/i.test(content)) {
    return parseHtmlTable(content);
  }
  return parseDelimited(content);
}

function importEmployeesFile(service, filePath, userId = null) {
  const resolved = path.resolve(String(filePath || ""));
  if (!fs.existsSync(resolved)) return { ok: false, message: "O ficheiro de importação não existe." };
  const rows = parseEmployeeImportRows(resolved);
  if (!rows.length) return { ok: false, message: "O ficheiro não contém linhas de funcionários." };
  const result = service.runInTransaction(() => {
    const imported = [];
    const errors = [];
    rows.forEach((row, index) => {
      const payload = {
        full_name: row.nome || row.full_name || row.nome_completo,
        document_type: row.tipo_documento || row.document_type || "bi",
        bi: row.bi || row.documento || row.numero_documento,
        nif: row.nif,
        social_security_number: row.inss || row.numero_inss || row.social_security_number,
        job_title: row.cargo || row.job_title,
        department: row.departamento || row.department,
        base_salary: row.salario_base || row.base_salary,
        contract_type: row.tipo_contrato || row.contract_type || "Indeterminado",
        hire_date: row.data_admissao || row.hire_date || row.admissao || nowIso().slice(0, 10),
        iban: row.iban,
        bank_code: row.banco || row.bank_code,
        bank_account: row.conta || row.bank_account,
        personal_phone: row.telefone || row.personal_phone || row.phone,
        personal_email: row.email || row.personal_email,
        status: row.estado || row.status || "ativo",
        recurring_allowances: [],
        recurring_bonuses: [],
        special_payments: []
      };
      const saved = service.saveEmployee(payload);
      if (saved.ok) imported.push(payload.full_name);
      else errors.push({ line: index + 2, name: payload.full_name, message: saved.message });
    });
    service.db.prepare(`
      INSERT INTO employee_import_batches (file_name, file_path, total_rows, imported_rows, failed_rows, errors_json, imported_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(path.basename(resolved), resolved, rows.length, imported.length, errors.length, JSON.stringify(errors), existingUserId(service, userId), nowIso());
    return { ok: errors.length === 0, imported: imported.length, failed: errors.length, errors, employees: service.listEmployees() };
  });
  return result.ok ? result : { ...result, message: `${result.failed} linha(s) falharam na importação.` };
}

module.exports = {
  ENTERPRISE_TYPES,
  getEnterpriseBootstrap,
  buildEnterpriseExecutiveSummary,
  exportEnterpriseSummaryExcel,
  listEnterpriseRecords,
  saveEnterpriseRecord,
  deleteEnterpriseRecord,
  generateContractDocument,
  listDocumentTemplateVersions,
  listGeneratedDocuments,
  buildContractAlerts,
  transitionContract,
  listApprovalRequestEvents,
  transitionApprovalRequest,
  enqueueSyncEvent,
  listSyncOutbox,
  markSyncEvent,
  retryFailedSyncEvents,
  exportSyncOutboxPackage,
  createPayrollRunVersion,
  listPayrollRunVersions,
  comparePayrollRunVersions,
  exportPayrollVersionComparisonExcel,
  buildFinalFiscalMap,
  updateFiscalMonthlyMapStatus,
  listFiscalMonthlyMaps,
  convertCandidateToEmployee,
  exportEmployeesExcel,
  importEmployeesFile
};
