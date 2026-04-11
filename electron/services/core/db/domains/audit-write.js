function recordAudit(service, payload, nowIso) {
  service.db.prepare(`
    INSERT INTO audit_logs (
      user_id, user_name, action, entity_type, entity_id, entity_label, month_ref, details_json, created_at
    ) VALUES (
      @user_id, @user_name, @action, @entity_type, @entity_id, @entity_label, @month_ref, @details_json, @created_at
    )
  `).run({
    user_id: payload.user_id ?? null,
    user_name: payload.user_name || "Sistema",
    action: payload.action,
    entity_type: payload.entity_type || "system",
    entity_id: payload.entity_id ?? null,
    entity_label: payload.entity_label || "",
    month_ref: payload.month_ref || null,
    details_json: JSON.stringify(payload.details || {}),
    created_at: nowIso()
  });
}

module.exports = {
  recordAudit
};

