function saveAttendanceRecord(service, payload, nowIso) {
  const validation = service.validateAttendancePayload(payload);
  if (!validation.ok) {
    return validation;
  }

  const monthRef = String(validation.sanitized.attendance_date).slice(0, 7);
  let periodState = service.ensurePeriodOpen(monthRef);
  if (!periodState.ok) {
    return periodState;
  }
  periodState = service.ensureAttendancePeriodOpen(monthRef);
  if (!periodState.ok) {
    return periodState;
  }

  const record = {
    ...validation.sanitized,
    approved_by_user_id: validation.sanitized.approval_status === "approved" ? payload.approved_by_user_id ?? null : null,
    approved_at: validation.sanitized.approval_status === "approved" ? payload.approved_at || nowIso() : null,
    updated_at: nowIso()
  };

  if (payload.id) {
    service.db.prepare(`
      UPDATE attendance_records
      SET employee_id = @employee_id,
          attendance_date = @attendance_date,
          status = @status,
          shift_id = @shift_id,
          check_in_time = @check_in_time,
          check_out_time = @check_out_time,
          punch_count = @punch_count,
          approval_status = @approval_status,
          approved_by_user_id = @approved_by_user_id,
          approved_at = @approved_at,
          hours_worked = @hours_worked,
          delay_minutes = @delay_minutes,
          source = @source,
          device_label = @device_label,
          batch_id = @batch_id,
          notes = @notes,
          updated_at = @updated_at
      WHERE id = @id
    `).run({ ...record, batch_id: payload.batch_id ?? null, id: payload.id });
  } else {
    service.db.prepare(`
      INSERT INTO attendance_records (
        employee_id, attendance_date, status, shift_id, check_in_time, check_out_time,
        punch_count, approval_status, approved_by_user_id, approved_at,
        hours_worked, delay_minutes, source, device_label, batch_id, notes, created_at, updated_at
      ) VALUES (
        @employee_id, @attendance_date, @status, @shift_id, @check_in_time, @check_out_time,
        @punch_count, @approval_status, @approved_by_user_id, @approved_at,
        @hours_worked, @delay_minutes, @source, @device_label, @batch_id, @notes, @created_at, @updated_at
      )
      ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
        status = excluded.status,
        shift_id = excluded.shift_id,
        check_in_time = excluded.check_in_time,
        check_out_time = excluded.check_out_time,
        punch_count = excluded.punch_count,
        approval_status = excluded.approval_status,
        approved_by_user_id = excluded.approved_by_user_id,
        approved_at = excluded.approved_at,
        hours_worked = excluded.hours_worked,
        delay_minutes = excluded.delay_minutes,
        source = excluded.source,
        device_label = excluded.device_label,
        batch_id = excluded.batch_id,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run({ ...record, batch_id: payload.batch_id ?? null, created_at: nowIso() });
  }

  return { ok: true, items: service.listAttendanceRecords({ employeeId: validation.sanitized.employee_id }) };
}

function deleteAttendanceRecord(service, attendanceId) {
  const current = service.db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(attendanceId);
  if (!current) {
    return { ok: false, message: "Registo de assiduidade não encontrado." };
  }

  const monthRef = String(current.attendance_date || "").slice(0, 7);
  let periodState = service.ensurePeriodOpen(monthRef);
  if (!periodState.ok) {
    return periodState;
  }
  periodState = service.ensureAttendancePeriodOpen(monthRef);
  if (!periodState.ok) {
    return periodState;
  }

  service.db.prepare("DELETE FROM attendance_records WHERE id = ?").run(attendanceId);
  return { ok: true, items: service.listAttendanceRecords({ employeeId: current.employee_id }) };
}

function approveAttendanceAdjustments(service, monthRef, userId, filters = {}, isValidMonthRef, nowIso) {
  if (!isValidMonthRef(monthRef)) {
    return { ok: false, message: "O período da assiduidade é inválido." };
  }

  let periodState = service.ensurePeriodOpen(monthRef);
  if (!periodState.ok) {
    return periodState;
  }
  periodState = service.ensureAttendancePeriodOpen(monthRef);
  if (!periodState.ok) {
    return periodState;
  }

  const employeeId = Number(filters.employeeId || 0) || null;
  const pendingItems = service.listAttendanceRecords({
    monthRef,
    employeeId,
    approvalStatus: "pending"
  });

  if (!pendingItems.length) {
    return { ok: false, message: "Não existem ajustes pendentes de aprovação para este critério." };
  }

  if (employeeId) {
    service.db.prepare(`
      UPDATE attendance_records
      SET approval_status = 'approved',
          approved_by_user_id = ?,
          approved_at = ?,
          updated_at = ?
      WHERE employee_id = ?
        AND substr(attendance_date, 1, 7) = ?
        AND approval_status = 'pending'
    `).run(userId, nowIso(), nowIso(), employeeId, monthRef);
  } else {
    service.db.prepare(`
      UPDATE attendance_records
      SET approval_status = 'approved',
          approved_by_user_id = ?,
          approved_at = ?,
          updated_at = ?
      WHERE substr(attendance_date, 1, 7) = ?
        AND approval_status = 'pending'
    `).run(userId, nowIso(), nowIso(), monthRef);
  }

  return {
    ok: true,
    approvedCount: pendingItems.length,
    items: service.listAttendanceRecords({ monthRef, employeeId }),
    period: service.getAttendancePeriod(monthRef)
  };
}

function closeAttendancePeriod(service, monthRef, userId, isValidMonthRef, nowIso) {
  if (!isValidMonthRef(monthRef)) {
    return { ok: false, message: "O período de assiduidade é inválido." };
  }

  const payrollState = service.ensurePeriodOpen(monthRef);
  if (!payrollState.ok) {
    return {
      ok: false,
      message: `O período salarial ${monthRef} está fechado. Reabra-o antes de alterar o fecho da assiduidade.`
    };
  }

  const current = service.getAttendancePeriod(monthRef);
  if (current.status === "closed") {
    return { ok: false, message: "A assiduidade deste mês já está fechada." };
  }

  const summary = service.buildAttendanceClosureSummary(monthRef);
  if (summary.pendingAdjustments) {
    return {
      ok: false,
      message: `Ainda existem ${summary.pendingAdjustments} ajuste(s) de assiduidade pendente(s) de aprovação neste mês.`
    };
  }
  if (summary.entryWithoutExit || summary.exitWithoutEntry || summary.duplicateMarks || summary.sameDayConflicts) {
    return {
      ok: false,
      message: `Existem inconsistências operacionais por resolver: ${summary.entryWithoutExit} entrada(s) sem saída, ${summary.exitWithoutEntry} saída(s) sem entrada, ${summary.duplicateMarks} marcação(ões) duplicada(s) e ${summary.sameDayConflicts} conflito(s) de férias/licença.`
    };
  }

  service.db.prepare(`
    INSERT INTO attendance_periods (month_ref, status, closed_at, closed_by_user_id, reopened_at, reopened_by_user_id, updated_at)
    VALUES (@month_ref, 'closed', @closed_at, @closed_by_user_id, NULL, NULL, @updated_at)
    ON CONFLICT(month_ref) DO UPDATE SET
      status = 'closed',
      closed_at = excluded.closed_at,
      closed_by_user_id = excluded.closed_by_user_id,
      reopened_at = NULL,
      reopened_by_user_id = NULL,
      updated_at = excluded.updated_at
  `).run({
    month_ref: monthRef,
    closed_at: nowIso(),
    closed_by_user_id: userId,
    updated_at: nowIso()
  });

  return {
    ok: true,
    period: service.getAttendancePeriod(monthRef),
    summary
  };
}

function reopenAttendancePeriod(service, monthRef, userId, isValidMonthRef, nowIso) {
  if (!isValidMonthRef(monthRef)) {
    return { ok: false, message: "O período de assiduidade é inválido." };
  }

  const payrollState = service.ensurePeriodOpen(monthRef);
  if (!payrollState.ok) {
    return {
      ok: false,
      message: `O período salarial ${monthRef} está fechado. Reabra-o antes de reabrir a assiduidade.`
    };
  }

  const current = service.getAttendancePeriod(monthRef);
  if (current.status !== "closed") {
    return { ok: false, message: "A assiduidade deste mês já está aberta." };
  }

  service.db.prepare(`
    INSERT INTO attendance_periods (month_ref, status, closed_at, closed_by_user_id, reopened_at, reopened_by_user_id, updated_at)
    VALUES (@month_ref, 'open', NULL, NULL, @reopened_at, @reopened_by_user_id, @updated_at)
    ON CONFLICT(month_ref) DO UPDATE SET
      status = 'open',
      reopened_at = excluded.reopened_at,
      reopened_by_user_id = excluded.reopened_by_user_id,
      updated_at = excluded.updated_at
  `).run({
    month_ref: monthRef,
    reopened_at: nowIso(),
    reopened_by_user_id: userId,
    updated_at: nowIso()
  });

  return { ok: true, period: service.getAttendancePeriod(monthRef) };
}

module.exports = {
  approveAttendanceAdjustments,
  closeAttendancePeriod,
  deleteAttendanceRecord,
  reopenAttendancePeriod,
  saveAttendanceRecord
};

