function saveEmployeeDocument(service, payload, userId, nowIso, safeUnlink) {
  const validation = service.validateEmployeeDocumentPayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const sanitized = validation.sanitized;
  const current = payload?.id ? service.db.prepare("SELECT * FROM employee_documents WHERE id = ?").get(payload.id) : null;
  if (payload?.id && !current) {
    return { ok: false, message: "O documento laboral selecionado já não existe." };
  }
  if (!current && !sanitized.file_path) {
    return { ok: false, message: "Selecione o ficheiro do documento para concluir o registo." };
  }

  let storedFile = {
    file_name: current?.file_name || "",
    stored_file_path: current?.stored_file_path || "",
    file_size: Number(current?.file_size || 0)
  };

  if (sanitized.file_path) {
    storedFile = service.storeEmployeeDocumentAttachment(validation.employee, sanitized.file_path, sanitized.title);
    if (current?.stored_file_path && current.stored_file_path !== storedFile.stored_file_path && service.isManagedEmployeeDocumentPath(current.stored_file_path)) {
      safeUnlink(current.stored_file_path);
    }
  }

  const savedAt = nowIso();
  const record = {
    employee_id: sanitized.employee_id,
    category: sanitized.category,
    title: sanitized.title,
    document_number: sanitized.document_number,
    issuer: sanitized.issuer,
    issue_date: sanitized.issue_date,
    effective_date: sanitized.effective_date,
    expiry_date: sanitized.expiry_date,
    alert_days_before: sanitized.alert_days_before,
    file_name: storedFile.file_name,
    stored_file_path: storedFile.stored_file_path,
    file_size: storedFile.file_size,
    notes: sanitized.notes,
    status: sanitized.status,
    created_by_user_id: current?.created_by_user_id ?? userId ?? null,
    created_at: current?.created_at || savedAt,
    updated_at: savedAt
  };

  if (current) {
    service.db.prepare(`
      UPDATE employee_documents
      SET employee_id = @employee_id,
          category = @category,
          title = @title,
          document_number = @document_number,
          issuer = @issuer,
          issue_date = @issue_date,
          effective_date = @effective_date,
          expiry_date = @expiry_date,
          alert_days_before = @alert_days_before,
          file_name = @file_name,
          stored_file_path = @stored_file_path,
          file_size = @file_size,
          notes = @notes,
          status = @status,
          updated_at = @updated_at
      WHERE id = @id
    `).run({ ...record, id: payload.id });
  } else {
    service.db.prepare(`
      INSERT INTO employee_documents (
        employee_id, category, title, document_number, issuer, issue_date, effective_date, expiry_date,
        alert_days_before, file_name, stored_file_path, file_size, notes, status, created_by_user_id, created_at, updated_at
      ) VALUES (
        @employee_id, @category, @title, @document_number, @issuer, @issue_date, @effective_date, @expiry_date,
        @alert_days_before, @file_name, @stored_file_path, @file_size, @notes, @status, @created_by_user_id, @created_at, @updated_at
      )
    `).run(record);
  }

  return {
    ok: true,
    document: service.listEmployeeDocuments({ id: payload?.id || service.db.prepare("SELECT last_insert_rowid() AS id").get().id })[0] || null,
    items: service.listEmployeeDocuments({ employeeId: sanitized.employee_id }),
    alerts: service.listEmployeeDocumentAlerts()
  };
}

function deleteEmployeeDocument(service, documentId, safeUnlink) {
  const current = service.db.prepare("SELECT * FROM employee_documents WHERE id = ?").get(documentId);
  if (!current) {
    return { ok: false, message: "O documento laboral selecionado já não existe." };
  }

  service.db.prepare("DELETE FROM employee_documents WHERE id = ?").run(documentId);
  if (current.stored_file_path && service.isManagedEmployeeDocumentPath(current.stored_file_path)) {
    safeUnlink(current.stored_file_path);
  }

  return {
    ok: true,
    items: service.listEmployeeDocuments({ employeeId: current.employee_id }),
    alerts: service.listEmployeeDocumentAlerts()
  };
}

module.exports = {
  deleteEmployeeDocument,
  saveEmployeeDocument
};

