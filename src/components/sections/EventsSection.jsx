import { useEffect, useState } from "react";
import { roundAmount } from "../../shared/utils/number";

const leaveTypeOptions = [
  { value: "justified_absence", label: "Ausência justificada" },
  { value: "unjustified_absence", label: "Falta injustificada" },
  { value: "leave_with_pay", label: "Licença com vencimento" },
  { value: "leave_without_pay", label: "Licença sem vencimento" },
  { value: "medical_leave", label: "Licença médica" },
  { value: "maternity_leave", label: "Licença de maternidade" },
  { value: "paternity_leave", label: "Licença de paternidade" },
  { value: "family_leave", label: "Licença por motivo familiar" },
  { value: "other_leave", label: "Outro tipo de licença" }
];

const payrollSensitiveTypes = ["unjustified_absence", "leave_without_pay"];

const attendanceStatusOptions = [
  { value: "present", label: "Presente" },
  { value: "delay", label: "Atraso" },
  { value: "absent", label: "Falta" },
  { value: "half_absence", label: "Meia falta" },
  { value: "leave", label: "Licença" },
  { value: "vacation", label: "Férias" }
];

const attendanceCalendarWeekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const attendanceStatusesWithoutSchedule = ["absent", "leave", "vacation"];

function normalizeMonthDate(monthRef) {
  const normalized = String(monthRef || "").trim();
  return /^\d{4}-\d{2}$/.test(normalized) ? `${normalized}-01` : new Date().toISOString().slice(0, 10);
}

function normalizeTimeValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) {
    return null;
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculateShiftHoursValue(shift) {
  const start = timeToMinutes(shift?.start_time);
  const end = timeToMinutes(shift?.end_time);
  if (start === null || end === null || end <= start) {
    return 0;
  }

  return roundAmount(Math.max(end - start - Number(shift?.break_minutes || 0), 0) / 60);
}

function getAttendanceStatusTone(value) {
  switch (value) {
    case "present":
      return "present";
    case "delay":
      return "delay";
    case "absent":
      return "absent";
    case "half_absence":
      return "half-absence";
    case "leave":
      return "leave";
    case "vacation":
      return "vacation";
    default:
      return "neutral";
  }
}

function getAttendanceStatusShortLabel(value) {
  switch (value) {
    case "present":
      return "P";
    case "delay":
      return "A";
    case "absent":
      return "F";
    case "half_absence":
      return "1/2";
    case "leave":
      return "L";
    case "vacation":
      return "Fe";
    default:
      return "--";
  }
}

function buildAttendanceCalendar(monthRef, records) {
  const [year, month] = String(monthRef || "")
    .split("-")
    .map((value) => Number(value));

  if (!year || !month) {
    return [];
  }

  const recordMap = new Map((records || []).map((item) => [item.attendance_date, item]));
  const firstDay = new Date(year, month - 1, 1);
  const totalDays = new Date(year, month, 0).getDate();
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const cells = [];

  for (let index = 0; index < leadingDays; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const record = recordMap.get(dateKey) || null;

    cells.push({
      dateKey,
      day,
      record,
      tone: getAttendanceStatusTone(record?.status),
      shortLabel: getAttendanceStatusShortLabel(record?.status)
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

function formatLeaveType(value) {
  return leaveTypeOptions.find((item) => item.value === value)?.label || value;
}

function formatAttendanceStatus(value) {
  return attendanceStatusOptions.find((item) => item.value === value)?.label || value;
}

function formatVacationStatus(value) {
  switch (value) {
    case "approved":
      return "Aprovadas";
    case "rejected":
      return "Rejeitadas";
    case "taken":
      return "Gozadas";
    default:
      return "Pendentes";
  }
}

function formatFinancialType(value) {
  return value === "advance" ? "Adiantamento" : "Empréstimo";
}

function formatCalendarLongDate(value) {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("pt-PT", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      });
}

function getAttendanceDraftDefaults(status, shift) {
  const shiftHours = calculateShiftHoursValue(shift);
  const regularHours = shiftHours || 8;

  if (status === "half_absence") {
    return {
      check_in_time: shift?.start_time || "",
      check_out_time: shift?.end_time || "",
      hours_worked: roundAmount(regularHours / 2),
      delay_minutes: 0
    };
  }

  if (attendanceStatusesWithoutSchedule.includes(status)) {
    return {
      check_in_time: "",
      check_out_time: "",
      hours_worked: 0,
      delay_minutes: 0
    };
  }

  return {
    check_in_time: shift?.start_time || "",
    check_out_time: shift?.end_time || "",
    hours_worked: regularHours,
    delay_minutes: status === "delay" ? Number(shift?.tolerance_minutes || 15) : 0
  };
}

function getAttendanceImportOutcomeTone(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "neutral";
  if (normalized.includes("error")) return "absent";
  if (normalized.includes("duplicate") || normalized.includes("skipped")) return "warning";
  if (normalized.includes("updated")) return "delay";
  return "present";
}

function formatAttendanceImportOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const labels = {
    processed: "Processado",
    duplicate: "Duplicado",
    error: "Com erro",
    imported: "Importado",
    updated: "Atualizado",
    skipped_without_employee: "Ignorado sem trabalhador",
    skipped_closed_period: "Ignorado por período fechado",
    skipped_manual: "Ignorado por registo manual",
    skipped_existing_import: "Ignorado por registo importado",
    file_duplicate: "Ficheiro duplicado"
  };
  return labels[normalized] || normalized || "Sem estado";
}

export default function EventsSection(props) {
  const {
    eventForm,
    setEventForm,
    saveEvent,
    financialForm,
    setFinancialForm,
    saveFinancialObligation,
    attendanceForm,
    setAttendanceForm,
    saveAttendanceRecord,
    attendanceImportForm,
    setAttendanceImportForm,
    chooseAttendanceFile,
    importAttendanceFile,
    syncAttendanceFolder,
    leaveForm,
    setLeaveForm,
    saveLeaveRequest,
    vacationBalanceForm,
    setVacationBalanceForm,
    saveVacationBalance,
    vacationForm,
    setVacationForm,
    saveVacationRequest,
    boot,
    selectEmployee,
    events,
    financialObligations,
    attendanceRecords,
    rawAttendanceRecords,
    attendanceImports,
    attendanceImportLogs,
    leaveRequests,
    vacationBalance,
    vacationRequests,
    eventFilters,
    setEventFilters,
    attendanceFilters,
    setAttendanceFilters,
    monthRef,
    attendancePeriod,
    leaveFilters,
    setLeaveFilters,
    vacationFilters,
    setVacationFilters,
    formatMoney,
    deleteFinancialObligation,
    deleteAttendanceRecord,
    approveAttendanceAdjustments,
    deleteEvent,
    setLeaveRequestStatus,
    deleteLeaveRequest,
    setVacationRequestStatus,
    deleteVacationRequest,
    closeAttendancePeriod,
    reopenAttendancePeriod,
    autoCalculatedAmount,
    calculateAutomaticEvent,
    isAutoCalculatedEvent,
    user
  } = props;

  const [bonusDrafts, setBonusDrafts] = useState(() => ({
    vacation_bonus: { quantity: 12, event_date: normalizeMonthDate(new Date().toISOString().slice(0, 7)) },
    christmas_bonus: { quantity: 12, event_date: normalizeMonthDate(new Date().toISOString().slice(0, 7)) }
  }));
  const [movementDrafts, setMovementDrafts] = useState(() => ({
    overtime_50: {
      quantity: 1,
      event_date: normalizeMonthDate(new Date().toISOString().slice(0, 7)),
      description: "Hora extra a 50%"
    },
    overtime_100: {
      quantity: 1,
      event_date: normalizeMonthDate(new Date().toISOString().slice(0, 7)),
      description: "Hora extra a 100%"
    },
    extra_payment: {
      amount: "",
      event_date: normalizeMonthDate(new Date().toISOString().slice(0, 7)),
      description: "Pagamento extraordinário"
    },
    penalty: {
      amount: "",
      event_date: normalizeMonthDate(new Date().toISOString().slice(0, 7)),
      description: "Penalização"
    }
  }));

  useEffect(() => {
    setBonusDrafts((current) => ({
      vacation_bonus: {
        ...current.vacation_bonus,
        event_date:
          String(current.vacation_bonus?.event_date || "").slice(0, 7) === monthRef
            ? current.vacation_bonus.event_date
            : normalizeMonthDate(monthRef)
      },
      christmas_bonus: {
        ...current.christmas_bonus,
        event_date:
          String(current.christmas_bonus?.event_date || "").slice(0, 7) === monthRef
            ? current.christmas_bonus.event_date
            : normalizeMonthDate(monthRef)
      }
    }));
  }, [monthRef]);

  useEffect(() => {
    setMovementDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          {
            ...value,
            event_date:
              String(value?.event_date || "").slice(0, 7) === monthRef
                ? value.event_date
                : normalizeMonthDate(monthRef)
          }
        ])
      )
    );
  }, [monthRef]);

  const selectedEmployee =
    boot?.employees?.find((employee) => Number(employee.id) === Number(attendanceForm.employee_id || eventForm.employee_id || leaveForm.employee_id || vacationForm.employee_id || 0)) ||
    null;
  const assignedShift = boot.workShifts?.find((shift) => Number(shift.id) === Number(selectedEmployee?.shift_id || attendanceForm.shift_id || 0)) || null;
  const assignedShiftHours = calculateShiftHoursValue(assignedShift);
  const activeAttendanceMonthRef = monthRef;
  const attendanceMonthRecords = (rawAttendanceRecords || []).filter(
    (item) => String(item.attendance_date || "").slice(0, 7) === activeAttendanceMonthRef
  );
  const leaveSummary = leaveRequests.reduce(
    (acc, item) => {
      const days = Number(item.days || 0);
      if (item.status === "pending") acc.pending += 1;
      if (item.status === "approved" && item.record_type === "justified_absence") acc.justified += days;
      if (item.status === "approved" && item.record_type === "unjustified_absence") acc.unjustified += days;
      if (item.status === "approved" && item.record_type === "leave_without_pay") acc.withoutPay += days;
      return acc;
    },
    { justified: 0, unjustified: 0, withoutPay: 0, pending: 0 }
  );

  const attendanceSummary = attendanceMonthRecords.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "present") acc.present += 1;
      if (item.status === "delay") acc.delay += 1;
      if (item.status === "absent" || item.status === "half_absence") acc.absence += 1;
      if (item.status === "leave") acc.leave += 1;
      if (item.status === "vacation") acc.vacation += 1;
      return acc;
    },
    { total: 0, present: 0, delay: 0, absence: 0, leave: 0, vacation: 0 }
  );
  const attendanceCalendar = buildAttendanceCalendar(activeAttendanceMonthRef, attendanceMonthRecords);
  const pendingAttendanceAdjustments = (boot?.attendanceRecords || []).filter(
    (item) =>
      String(item.attendance_date || "").slice(0, 7) === monthRef &&
      String(item.approval_status || "").toLowerCase() === "pending"
  ).length;
  const attendancePeriodClosed = attendancePeriod?.status === "closed";
  const canManageFinancialObligations = Boolean(user);
  const canManageVacationBalance = Boolean(user);

  const financialSummary = financialObligations.reduce(
    (acc, item) => {
      acc.total += 1;
      acc.monthly += Number(item.current_month_amount || 0);
      acc.remaining += Number(item.remaining_balance || 0);
      if (item.entry_type === "advance") {
        acc.advances += 1;
      } else {
        acc.loans += 1;
      }
      return acc;
    },
    { total: 0, loans: 0, advances: 0, monthly: 0, remaining: 0 }
  );
  const overtime50Details = calculateAutomaticEvent?.({
    employee_id: eventForm.employee_id,
    event_type: "overtime_50",
    quantity: Number(movementDrafts.overtime_50.quantity || 0),
    event_date: movementDrafts.overtime_50.event_date,
    amount: 0,
    description: movementDrafts.overtime_50.description || "Hora extra a 50%"
  });
  const overtime100Details = calculateAutomaticEvent?.({
    employee_id: eventForm.employee_id,
    event_type: "overtime_100",
    quantity: Number(movementDrafts.overtime_100.quantity || 0),
    event_date: movementDrafts.overtime_100.event_date,
    amount: 0,
    description: movementDrafts.overtime_100.description || "Hora extra a 100%"
  });
  const vacationBonusDetails = calculateAutomaticEvent?.({
    employee_id: eventForm.employee_id,
    event_type: "vacation_bonus",
    quantity: Number(bonusDrafts.vacation_bonus.quantity || 0),
    event_date: bonusDrafts.vacation_bonus.event_date,
    amount: 0,
    description: "Subsídio de férias"
  });
  const christmasBonusDetails = calculateAutomaticEvent?.({
    employee_id: eventForm.employee_id,
    event_type: "christmas_bonus",
    quantity: Number(bonusDrafts.christmas_bonus.quantity || 0),
    event_date: bonusDrafts.christmas_bonus.event_date,
    amount: 0,
    description: "Subsídio de Natal"
  });
  const attendanceCalendarCells = attendanceCalendar.flat().filter(Boolean);
  const selectedCalendarDate = String(attendanceForm.attendance_date || "").startsWith(`${activeAttendanceMonthRef}-`)
    ? String(attendanceForm.attendance_date)
    : "";
  const selectedCalendarRecord = attendanceCalendarCells.find((item) => item.dateKey === selectedCalendarDate)?.record || null;
  const manualAttendanceShift =
    (boot.workShifts || []).find(
      (shift) => Number(shift.id) === Number(attendanceForm.shift_id || selectedCalendarRecord?.shift_id || selectedEmployee?.shift_id || 0)
    ) || null;
  const manualAttendanceNeedsSchedule = !attendanceStatusesWithoutSchedule.includes(attendanceForm.status);

  function buildAttendanceDraft(dateKey, record = null, forcedStatus = null) {
    const draftShiftId = String(record?.shift_id || attendanceForm.shift_id || selectedEmployee?.shift_id || "");
    const draftShift =
      (boot.workShifts || []).find((shift) => Number(shift.id) === Number(draftShiftId || 0)) || null;
    const nextStatus = forcedStatus || record?.status || "present";
    const defaults = getAttendanceDraftDefaults(nextStatus, draftShift);

    if (record && !forcedStatus) {
      return {
        ...attendanceForm,
        employee_id: String(record.employee_id || selectedEmployee?.id || attendanceForm.employee_id || ""),
        attendance_date: dateKey,
        status: record.status || "present",
        shift_id: draftShiftId,
        check_in_time: record.check_in_time || defaults.check_in_time,
        check_out_time: record.check_out_time || defaults.check_out_time,
        punch_count: Number(record.punch_count || 0),
        hours_worked: Number(record.hours_worked || defaults.hours_worked),
        delay_minutes: Number(record.delay_minutes || defaults.delay_minutes),
        source: "manual",
        device_label: "",
        notes: record.notes || ""
      };
    }

    return {
      ...attendanceForm,
      employee_id: String(selectedEmployee?.id || attendanceForm.employee_id || ""),
      attendance_date: dateKey,
      status: nextStatus,
      shift_id: draftShiftId,
      check_in_time: defaults.check_in_time,
      check_out_time: defaults.check_out_time,
      punch_count: 0,
      hours_worked: defaults.hours_worked,
      delay_minutes: defaults.delay_minutes,
      source: "manual",
      device_label: "",
      notes: forcedStatus && record ? record.notes || "" : ""
    };
  }

  function handleCalendarDateSelect(cell) {
    if (!cell || !selectedEmployee) return;
    setAttendanceForm(buildAttendanceDraft(cell.dateKey, cell.record));
  }

  function handleAttendanceStatusShortcut(status) {
    if (!selectedEmployee || !selectedCalendarDate) return;
    setAttendanceForm(buildAttendanceDraft(selectedCalendarDate, selectedCalendarRecord, status));
  }

  function applyShiftScheduleToDraft() {
    if (!manualAttendanceShift) return;
    const defaults = getAttendanceDraftDefaults(attendanceForm.status, manualAttendanceShift);
    setAttendanceForm((current) => ({
      ...current,
      shift_id: String(manualAttendanceShift.id || current.shift_id || ""),
      check_in_time: defaults.check_in_time,
      check_out_time: defaults.check_out_time,
      hours_worked: defaults.hours_worked,
      delay_minutes: current.status === "delay" ? defaults.delay_minutes : current.delay_minutes
    }));
  }

  async function launchBonusEvent(eventType) {
    const draft = bonusDrafts[eventType] || { quantity: 12, event_date: normalizeMonthDate(monthRef) };
    await saveEvent({
      employee_id: eventForm.employee_id,
      event_type: eventType,
      event_date: draft.event_date,
      quantity: Number(draft.quantity || 0),
      amount: 0,
      description: eventType === "vacation_bonus" ? "Subsídio de férias" : "Subsídio de Natal"
    });
  }

  async function launchMovementEvent(eventType) {
    const draft = movementDrafts[eventType] || {};
    const automaticEvent = eventType === "overtime_50" || eventType === "overtime_100";
    const defaultDescriptions = {
      overtime_50: "Hora extra a 50%",
      overtime_100: "Hora extra a 100%",
      extra_payment: "Pagamento extraordinário",
      penalty: "Penalização"
    };

    await saveEvent({
      employee_id: eventForm.employee_id,
      event_type: eventType,
      event_date: draft.event_date || normalizeMonthDate(monthRef),
      quantity: automaticEvent ? Number(draft.quantity || 0) : 1,
      amount: automaticEvent ? 0 : Number(draft.amount || 0),
      description: String(draft.description || defaultDescriptions[eventType] || "").trim()
    });
  }

  return (
    <section className="two-column">
      <div className="panel">
        <div className="section-heading">
          <h2>Eventos salariais</h2>
          <p>Registe horas extra, subsídios específicos, penalizações e pagamentos extraordinários do período.</p>
        </div>

        <div className="movement-employee-bar">
          <label>Funcionário associado aos movimentos
            <select value={eventForm.employee_id} onChange={(event) => selectEmployee(Number(event.target.value))}>
              <option value="">Selecionar</option>
              {boot.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>
          <div className="movement-employee-bar__summary">
            <span className="status-chip status-chip--info">
              {selectedEmployee ? selectedEmployee.full_name : "Selecione um trabalhador"}
            </span>
            <small>
              {selectedEmployee
                ? `${selectedEmployee.job_title || "Sem cargo"} · salário base ${formatMoney(selectedEmployee.base_salary || 0)}`
                : "Selecione o trabalhador para lançar bónus, horas extra e outros movimentos."}
            </small>
          </div>
        </div>

        <div className="bonus-event-grid">
          <article className="bonus-event-card">
            <div className="bonus-event-card__header">
              <div>
                <span className="status-chip status-chip--success">Subsídio de férias</span>
                <h3>Cartão próprio de férias</h3>
              </div>
              <strong>{formatMoney(vacationBonusDetails?.amount || 0)}</strong>
            </div>
            <p className="bonus-event-card__formula">Fórmula: salário base ÷ 12 × meses de direito.</p>
            <div className="bonus-event-card__meta">
              <span>Base: {formatMoney(vacationBonusDetails?.baseSalary || 0)}</span>
              <span>Proporção mensal: {formatMoney(vacationBonusDetails?.monthlyAccrual || 0)}</span>
            </div>
            <div className="grid-form bonus-event-form">
              <label>Data do lançamento
                <input
                  type="date"
                  value={bonusDrafts.vacation_bonus.event_date}
                  onChange={(event) =>
                    setBonusDrafts((current) => ({
                      ...current,
                      vacation_bonus: { ...current.vacation_bonus, event_date: event.target.value }
                    }))
                  }
                />
              </label>
              <label>Meses de direito
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={bonusDrafts.vacation_bonus.quantity}
                  onChange={(event) =>
                    setBonusDrafts((current) => ({
                      ...current,
                      vacation_bonus: { ...current.vacation_bonus, quantity: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <button type="button" disabled={!eventForm.employee_id} onClick={() => launchBonusEvent("vacation_bonus")}>
              Lançar subsídio de férias
            </button>
          </article>

          <article className="bonus-event-card">
            <div className="bonus-event-card__header">
              <div>
                <span className="status-chip status-chip--warning">Subsídio de Natal</span>
                <h3>Cartão próprio de Natal</h3>
              </div>
              <strong>{formatMoney(christmasBonusDetails?.amount || 0)}</strong>
            </div>
            <p className="bonus-event-card__formula">Fórmula: salário base ÷ 12 × meses de direito.</p>
            <div className="bonus-event-card__meta">
              <span>Base: {formatMoney(christmasBonusDetails?.baseSalary || 0)}</span>
              <span>Proporção mensal: {formatMoney(christmasBonusDetails?.monthlyAccrual || 0)}</span>
            </div>
            <div className="grid-form bonus-event-form">
              <label>Data do lançamento
                <input
                  type="date"
                  value={bonusDrafts.christmas_bonus.event_date}
                  onChange={(event) =>
                    setBonusDrafts((current) => ({
                      ...current,
                      christmas_bonus: { ...current.christmas_bonus, event_date: event.target.value }
                    }))
                  }
                />
              </label>
              <label>Meses de direito
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={bonusDrafts.christmas_bonus.quantity}
                  onChange={(event) =>
                    setBonusDrafts((current) => ({
                      ...current,
                      christmas_bonus: { ...current.christmas_bonus, quantity: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <button type="button" disabled={!eventForm.employee_id} onClick={() => launchBonusEvent("christmas_bonus")}>
              Lançar subsídio de Natal
            </button>
          </article>
        </div>

        <div className="bonus-event-grid">
          <article className="bonus-event-card">
            <div className="bonus-event-card__header">
              <div>
                <span className="status-chip status-chip--info">Hora extra 50%</span>
                <h3>Cartão próprio de horas extra a 50%</h3>
              </div>
              <strong>{formatMoney(overtime50Details?.amount || 0)}</strong>
            </div>
            <p className="bonus-event-card__formula">Fórmula: taxa horária × 1,5 × quantidade de horas.</p>
            <div className="bonus-event-card__meta">
              <span>Base remuneratória: {formatMoney(overtime50Details?.remunerationBase || 0)}</span>
              <span>Taxa horária: {formatMoney(overtime50Details?.hourlyRate || 0)}</span>
            </div>
            <div className="grid-form bonus-event-form">
              <label>Data do lançamento
                <input
                  type="date"
                  value={movementDrafts.overtime_50.event_date}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      overtime_50: { ...current.overtime_50, event_date: event.target.value }
                    }))
                  }
                />
              </label>
              <label>Quantidade de horas
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={movementDrafts.overtime_50.quantity}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      overtime_50: { ...current.overtime_50, quantity: event.target.value }
                    }))
                  }
                />
              </label>
              <label className="full-span">Descrição
                <input
                  value={movementDrafts.overtime_50.description}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      overtime_50: { ...current.overtime_50, description: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <button type="button" disabled={!eventForm.employee_id} onClick={() => launchMovementEvent("overtime_50")}>
              Lançar hora extra a 50%
            </button>
          </article>

          <article className="bonus-event-card">
            <div className="bonus-event-card__header">
              <div>
                <span className="status-chip status-chip--info">Hora extra 100%</span>
                <h3>Cartão próprio de horas extra a 100%</h3>
              </div>
              <strong>{formatMoney(overtime100Details?.amount || 0)}</strong>
            </div>
            <p className="bonus-event-card__formula">Fórmula: taxa horária × 2 × quantidade de horas.</p>
            <div className="bonus-event-card__meta">
              <span>Base remuneratória: {formatMoney(overtime100Details?.remunerationBase || 0)}</span>
              <span>Taxa horária: {formatMoney(overtime100Details?.hourlyRate || 0)}</span>
            </div>
            <div className="grid-form bonus-event-form">
              <label>Data do lançamento
                <input
                  type="date"
                  value={movementDrafts.overtime_100.event_date}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      overtime_100: { ...current.overtime_100, event_date: event.target.value }
                    }))
                  }
                />
              </label>
              <label>Quantidade de horas
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={movementDrafts.overtime_100.quantity}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      overtime_100: { ...current.overtime_100, quantity: event.target.value }
                    }))
                  }
                />
              </label>
              <label className="full-span">Descrição
                <input
                  value={movementDrafts.overtime_100.description}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      overtime_100: { ...current.overtime_100, description: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <button type="button" disabled={!eventForm.employee_id} onClick={() => launchMovementEvent("overtime_100")}>
              Lançar hora extra a 100%
            </button>
          </article>

          <article className="bonus-event-card">
            <div className="bonus-event-card__header">
              <div>
                <span className="status-chip status-chip--success">Pagamento extraordinário</span>
                <h3>Cartão próprio de crédito extraordinário</h3>
              </div>
              <strong>{formatMoney(Number(movementDrafts.extra_payment.amount || 0))}</strong>
            </div>
            <p className="bonus-event-card__formula">Use este cartão para prémios, reforços ou pagamentos pontuais fora da rotina.</p>
            <div className="bonus-event-card__meta">
              <span>Tipo: crédito adicional do período</span>
              <span>Integra o bruto do mês selecionado</span>
            </div>
            <div className="grid-form bonus-event-form">
              <label>Data do lançamento
                <input
                  type="date"
                  value={movementDrafts.extra_payment.event_date}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      extra_payment: { ...current.extra_payment, event_date: event.target.value }
                    }))
                  }
                />
              </label>
              <label>Valor
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={movementDrafts.extra_payment.amount}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      extra_payment: { ...current.extra_payment, amount: event.target.value }
                    }))
                  }
                />
              </label>
              <label className="full-span">Descrição
                <input
                  value={movementDrafts.extra_payment.description}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      extra_payment: { ...current.extra_payment, description: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!eventForm.employee_id || !Number(movementDrafts.extra_payment.amount || 0)}
              onClick={() => launchMovementEvent("extra_payment")}
            >
              Lançar pagamento extraordinário
            </button>
          </article>

          <article className="bonus-event-card">
            <div className="bonus-event-card__header">
              <div>
                <span className="status-chip status-chip--danger">Penalização</span>
                <h3>Cartão próprio de penalização</h3>
              </div>
              <strong>{formatMoney(Number(movementDrafts.penalty.amount || 0))}</strong>
            </div>
            <p className="bonus-event-card__formula">Use para descontos disciplinares, correções internas ou outros ajustes redutores.</p>
            <div className="bonus-event-card__meta">
              <span>Tipo: desconto extraordinário do período</span>
              <span>Integra os descontos do mês selecionado</span>
            </div>
            <div className="grid-form bonus-event-form">
              <label>Data do lançamento
                <input
                  type="date"
                  value={movementDrafts.penalty.event_date}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      penalty: { ...current.penalty, event_date: event.target.value }
                    }))
                  }
                />
              </label>
              <label>Valor
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={movementDrafts.penalty.amount}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      penalty: { ...current.penalty, amount: event.target.value }
                    }))
                  }
                />
              </label>
              <label className="full-span">Descrição
                <input
                  value={movementDrafts.penalty.description}
                  onChange={(event) =>
                    setMovementDrafts((current) => ({
                      ...current,
                      penalty: { ...current.penalty, description: event.target.value }
                    }))
                  }
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!eventForm.employee_id || !Number(movementDrafts.penalty.amount || 0)}
              onClick={() => launchMovementEvent("penalty")}
            >
              Lançar penalização
            </button>
          </article>
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Licenças e ausências</h2>
          <p>Faça o registo formal, a justificação e a aprovação das ausências e licenças laborais.</p>
        </div>

        <form className="grid-form" onSubmit={saveLeaveRequest}>
          <label>Funcionário
            <select value={leaveForm.employee_id} onChange={(event) => selectEmployee(Number(event.target.value))}>
              <option value="">Selecionar</option>
              {boot.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>
          <label>Tipo
            <select
              value={leaveForm.record_type}
              onChange={(event) =>
                setLeaveForm((current) => ({
                  ...current,
                  record_type: event.target.value,
                  affects_payroll: payrollSensitiveTypes.includes(event.target.value)
                }))
              }
            >
              {leaveTypeOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>Data inicial
            <input type="date" value={leaveForm.start_date} onChange={(event) => setLeaveForm((current) => ({ ...current, start_date: event.target.value }))} />
          </label>
          <label>Data final
            <input type="date" value={leaveForm.end_date} onChange={(event) => setLeaveForm((current) => ({ ...current, end_date: event.target.value }))} />
          </label>
          <label>Número de dias
            <input type="number" value={leaveForm.days} onChange={(event) => setLeaveForm((current) => ({ ...current, days: event.target.value }))} />
          </label>
          <label>Tipo de comprovativo
            <input
              value={leaveForm.proof_type}
              onChange={(event) => setLeaveForm((current) => ({ ...current, proof_type: event.target.value }))}
              placeholder="Atestado, declaração, despacho..."
            />
          </label>
          <label>Referência do documento
            <input
              value={leaveForm.document_ref}
              onChange={(event) => setLeaveForm((current) => ({ ...current, document_ref: event.target.value }))}
              placeholder="Número do processo ou documento"
            />
          </label>
          <label>Impacta a folha
            <select
              value={leaveForm.affects_payroll ? "sim" : "nao"}
              onChange={(event) => setLeaveForm((current) => ({ ...current, affects_payroll: event.target.value === "sim" }))}
            >
              <option value="nao">Não</option>
              <option value="sim">Sim</option>
            </select>
          </label>
          <label className="full-span">Motivo ou fundamento
            <input value={leaveForm.reason} onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))} />
          </label>
          <label className="full-span">Observações
            <textarea rows="3" value={leaveForm.notes} onChange={(event) => setLeaveForm((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <button type="submit">Registar licença ou ausência</button>
        </form>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Empréstimos e adiantamentos</h2>
          <p>Registe descontos parcelados para que a folha aplique automaticamente a prestação de cada mês.</p>
        </div>

        <div className="processing-period-bar">
          <div>
            <strong>Assiduidade de {monthRef}</strong>
            <small>
              {attendancePeriodClosed
                ? "Mês fechado para cálculo salarial. Reabra apenas se precisar de corrigir ajustes."
                : "Feche a assiduidade depois da conferência. A folha salarial só pode ser processada com este mês fechado."}
            </small>
          </div>
          <div className="action-row">
            <span className={`status-chip ${attendancePeriodClosed ? "status-chip--success" : "status-chip--warning"}`}>
              {attendancePeriodClosed ? "Fechada" : "Aberta"}
            </span>
            <span className={`status-chip ${pendingAttendanceAdjustments > 0 ? "status-chip--warning" : "status-chip--success"}`}>
              {pendingAttendanceAdjustments} ajuste(s) pendente(s)
            </span>
            {user?.role === "admin" && pendingAttendanceAdjustments > 0 && !attendancePeriodClosed && (
              <button type="button" className="secondary-btn" onClick={approveAttendanceAdjustments}>
                Aprovar ajustes pendentes
              </button>
            )}
            {user?.role === "admin" && !attendancePeriodClosed && (
              <button type="button" className="secondary-btn" onClick={closeAttendancePeriod}>
                Fechar assiduidade
              </button>
            )}
            {user?.role === "admin" && attendancePeriodClosed && (
              <button type="button" className="secondary-btn" onClick={reopenAttendancePeriod}>
                Reabrir assiduidade
              </button>
            )}
          </div>
        </div>

        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Empréstimos</span>
            <strong>{financialSummary.loans}</strong>
            <small>Registos ativos</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Adiantamentos</span>
            <strong>{financialSummary.advances}</strong>
            <small>Registos ativos</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Desconto do mês</span>
            <strong>{formatMoney(financialSummary.monthly)}</strong>
            <small>Aplicação automática</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Saldo em dívida</span>
            <strong>{formatMoney(financialSummary.remaining)}</strong>
            <small>Valor remanescente</small>
          </article>
        </div>

        {canManageFinancialObligations ? (
          <form className="grid-form" onSubmit={saveFinancialObligation}>
            <label>Funcionário
              <select value={financialForm.employee_id} onChange={(event) => selectEmployee(Number(event.target.value))}>
                <option value="">Selecionar</option>
                {boot.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                ))}
              </select>
            </label>
            <label>Tipo
              <select value={financialForm.entry_type} onChange={(event) => setFinancialForm((current) => ({ ...current, entry_type: event.target.value }))}>
                <option value="loan">Empréstimo</option>
                <option value="advance">Adiantamento</option>
              </select>
            </label>
            <label>Mês de início
              <input type="month" value={financialForm.start_month_ref} onChange={(event) => setFinancialForm((current) => ({ ...current, start_month_ref: event.target.value }))} />
            </label>
            <label>Valor total
              <input type="number" value={financialForm.principal_amount} onChange={(event) => setFinancialForm((current) => ({ ...current, principal_amount: event.target.value }))} />
            </label>
            <label>Número de prestações
              <input type="number" value={financialForm.installment_count} onChange={(event) => setFinancialForm((current) => ({ ...current, installment_count: event.target.value }))} />
            </label>
            <label>Valor da prestação
              <input
                type="number"
                value={financialForm.installment_amount}
                onChange={(event) => setFinancialForm((current) => ({ ...current, installment_amount: event.target.value }))}
                placeholder="Opcional"
              />
            </label>
            <label className="full-span">Descrição
              <input
                value={financialForm.label}
                onChange={(event) => setFinancialForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Ex.: Empréstimo para equipamento"
              />
            </label>
            <label className="full-span">Observações
              <textarea rows="2" value={financialForm.notes} onChange={(event) => setFinancialForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <label>Ativo
              <select value={financialForm.active ? "sim" : "nao"} onChange={(event) => setFinancialForm((current) => ({ ...current, active: event.target.value === "sim" }))}>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            </label>
            <button type="submit">Guardar registo financeiro</button>
          </form>
        ) : (
          <p className="empty-note">
            Inicie sessão para criar ou alterar empréstimos e adiantamentos.
          </p>
        )}

        <div className="table-list compact">
          {financialObligations.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>
                  {formatFinancialType(item.entry_type)} · início {item.start_month_ref} · {item.installment_count} prestação(ões)
                </small>
                <small>
                  Prestação atual {formatMoney(item.current_month_amount || 0)} · saldo {formatMoney(item.remaining_balance || 0)}
                </small>
              </div>
              <div className="payroll-values">
                <span className={`status-chip ${item.active ? "status-chip--success" : "status-chip--neutral"}`}>
                  {item.active ? "Ativo" : "Inativo"}
                </span>
                {canManageFinancialObligations && (
                  <button className="link-btn danger" onClick={() => deleteFinancialObligation(item.id)}>Excluir</button>
                )}
              </div>
            </div>
          ))}
          {!financialObligations.length && (
            <p className="empty-note">Sem empréstimos ou adiantamentos ativos para o trabalhador selecionado.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Controlo do ponto</h2>
          <p>Acompanhe a assiduidade do mês e use o calendário manual no fim da página para lançar ou corrigir cada dia.</p>
        </div>

        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Presenças</span>
            <strong>{attendanceSummary.present}</strong>
            <small>No mês filtrado</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Atrasos</span>
            <strong>{attendanceSummary.delay}</strong>
            <small>Registos com atraso</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Faltas</span>
            <strong>{attendanceSummary.absence}</strong>
            <small>Totais do período</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Licenças</span>
            <strong>{attendanceSummary.leave}</strong>
            <small>Registos aprovados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Férias</span>
            <strong>{attendanceSummary.vacation}</strong>
            <small>Registos lançados</small>
          </article>
        </div>

        <div className="attendance-manual-callout">
          <div>
            <strong>Lançamento manual por calendário</strong>
            <small>
              Clique num dia no painel final para preencher entrada, saída, atraso, ausência, licença ou férias com mais rapidez.
            </small>
          </div>
          {selectedEmployee ? (
            <div className="attendance-manual-callout__meta">
              <span className="attendance-state attendance-state--neutral">{selectedEmployee.full_name}</span>
              {selectedEmployee.attendance_code ? (
                <span className="attendance-state attendance-state--neutral">
                  Código {selectedEmployee.attendance_code}
                </span>
              ) : null}
              <span className={`attendance-state attendance-state--${assignedShift ? "present" : "delay"}`}>
                {assignedShift ? `Turno: ${assignedShift.name}` : "Sem turno atribuído"}
              </span>
            </div>
          ) : (
            <p className="empty-note">Selecione um trabalhador para ativar o lançamento manual no calendário.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Sincronização com biométrico ou cartão</h2>
          <p>Importe o ficheiro exportado do dispositivo para atualizar a assiduidade sem substituir registos manuais.</p>
        </div>

        <form className="grid-form" onSubmit={importAttendanceFile}>
          <label>Origem
            <select
              value={attendanceImportForm.source_type}
              onChange={(event) => setAttendanceImportForm((current) => ({ ...current, source_type: event.target.value }))}
            >
              <option value="biometric">Dispositivo biométrico</option>
              <option value="card">Leitor de cartão</option>
            </select>
          </label>
          <label>Equipamento ou terminal
            <input
              value={attendanceImportForm.device_label}
              onChange={(event) => setAttendanceImportForm((current) => ({ ...current, device_label: event.target.value }))}
              placeholder="Ex.: Terminal principal"
            />
          </label>
          <label className="full-span">Ficheiro de sincronização
            <div className="inline-actions">
              <input value={attendanceImportForm.file_path} readOnly placeholder="Selecione um ficheiro .csv ou .txt" />
              <button type="button" className="secondary-btn" onClick={chooseAttendanceFile} disabled={attendancePeriodClosed}>
                Selecionar
              </button>
            </div>
          </label>
          <label>Atualizar importações anteriores
            <select
              value={attendanceImportForm.overwrite_imported ? "sim" : "nao"}
              onChange={(event) => setAttendanceImportForm((current) => ({ ...current, overwrite_imported: event.target.value === "sim" }))}
            >
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
          </label>
          <p className="empty-note full-span">
            O ficheiro pode usar colunas como código do funcionário, data, hora, estado e equipamento. O sistema usa o código biométrico/cartão, o BI, o NIF, a Segurança Social ou o ID interno para localizar o trabalhador.
          </p>
          <div className="action-row full-span">
            <button type="submit" disabled={attendancePeriodClosed}>Importar marcações</button>
            <button type="button" className="secondary-btn" onClick={syncAttendanceFolder} disabled={attendancePeriodClosed}>
              Sincronizar pasta monitorizada
            </button>
          </div>
        </form>

        <div className="table-list">
          {(attendanceImports || []).map((item) => (
            <div className="table-row attendance-import-row" key={item.id}>
              <div>
                <strong>{item.file_name}</strong>
                <small>{item.device_label || "Sem equipamento identificado"}</small>
                <small>{new Date(item.created_at).toLocaleString("pt-PT")}</small>
                <small>{item.technical_message || "Sem ocorrências técnicas neste ficheiro."}</small>
              </div>
              <div className="attendance-import-row__meta">
                <span className={`attendance-state attendance-state--${item.source_type === "card" ? "card" : "device"}`}>
                  {item.source_type === "card" ? "Cartão" : "Biométrico"}
                </span>
                <span className={`attendance-state attendance-state--${getAttendanceImportOutcomeTone(item.sync_status)}`}>
                  {formatAttendanceImportOutcome(item.sync_status)}
                </span>
                <span className="attendance-state attendance-state--neutral">
                  {item.month_ref || "Vários meses"}
                </span>
                <span className="attendance-state attendance-state--neutral">
                  {item.import_mode === "watched_folder" ? "Pasta monitorizada" : "Importação manual"}
                </span>
                <span className="attendance-state attendance-state--neutral">
                  {item.device_profile || "Perfil genérico"}
                </span>
                <span className="attendance-state attendance-state--present">
                  {item.imported_rows} importado(s)
                </span>
                <span className="attendance-state attendance-state--warning">
                  {item.skipped_rows} ignorado(s)
                </span>
              </div>
            </div>
          ))}
          {!(attendanceImports || []).length && (
            <p className="empty-note">Ainda não existem sincronizações de assiduidade registadas.</p>
          )}
        </div>

        <div className="section-heading compact">
          <h3>Logs técnicos por ficheiro e trabalhador</h3>
          <p>Consulte duplicações, ficheiros ignorados, trabalhadores não encontrados e importações processadas pelo sistema.</p>
        </div>

        <div className="table-list compact">
          {(attendanceImportLogs || []).map((item) => (
            <div className="table-row attendance-import-row" key={item.id}>
              <div>
                <strong>{item.file_name || "Ficheiro sem identificação"}</strong>
                <small>
                  {item.full_name || item.employee_code || "Sem trabalhador associado"}
                  {item.attendance_date ? ` | ${item.attendance_date}` : ""}
                </small>
                <small>{item.message}</small>
              </div>
              <div className="attendance-import-row__meta">
                <span className={`attendance-state attendance-state--${item.source_type === "card" ? "card" : "device"}`}>
                  {item.source_type === "card" ? "Cartão" : "Biométrico"}
                </span>
                <span className="attendance-state attendance-state--neutral">
                  {item.import_mode === "watched_folder" ? "Pasta monitorizada" : "Importação manual"}
                </span>
                <span className={`attendance-state attendance-state--${getAttendanceImportOutcomeTone(item.outcome)}`}>
                  {formatAttendanceImportOutcome(item.outcome)}
                </span>
              </div>
            </div>
          ))}
          {!(attendanceImportLogs || []).length && (
            <p className="empty-note">Ainda não existem logs técnicos de sincronização.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Plano de férias</h2>
          <p>Defina o saldo anual, marque períodos de férias e acompanhe o consumo do direito do trabalhador.</p>
        </div>

        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Saldo anual</span>
            <strong>{Number(vacationBalance.total_entitlement || 0)}</strong>
            <small>{vacationFilters.yearRef}</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Já aprovados</span>
            <strong>{Number(vacationBalance.approved_days || 0)}</strong>
            <small>Dias marcados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Gozados</span>
            <strong>{Number(vacationBalance.taken_days || 0)}</strong>
            <small>Dias concluídos</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Restantes</span>
            <strong>{Number(vacationBalance.remaining_days || 0)}</strong>
            <small>Saldo disponível</small>
          </article>
        </div>

        {canManageVacationBalance ? (
          <form className="grid-form" onSubmit={saveVacationBalance}>
            <div className="full-span section-heading compact">
              <h3>Saldo anual</h3>
              <p>Ajuste o direito base, os dias transitados e qualquer correção manual do colaborador.</p>
            </div>
            <label>Funcionário
              <select value={vacationBalanceForm.employee_id} onChange={(event) => selectEmployee(Number(event.target.value))}>
                <option value="">Selecionar</option>
                {boot.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                ))}
              </select>
            </label>
            <label>Ano de referência
              <input
                value={vacationBalanceForm.year_ref}
                onChange={(event) => {
                  setVacationBalanceForm((current) => ({ ...current, year_ref: event.target.value }));
                  setVacationForm((current) => ({ ...current, year_ref: event.target.value }));
                  setVacationFilters((current) => ({ ...current, yearRef: event.target.value }));
                }}
              />
            </label>
            <label>Dias de direito
              <input type="number" value={vacationBalanceForm.entitled_days} onChange={(event) => setVacationBalanceForm((current) => ({ ...current, entitled_days: event.target.value }))} />
            </label>
            <label>Dias transitados
              <input type="number" value={vacationBalanceForm.carried_days} onChange={(event) => setVacationBalanceForm((current) => ({ ...current, carried_days: event.target.value }))} />
            </label>
            <label>Ajuste manual
              <input type="number" value={vacationBalanceForm.manual_adjustment} onChange={(event) => setVacationBalanceForm((current) => ({ ...current, manual_adjustment: event.target.value }))} />
            </label>
            <label className="full-span">Observações do saldo
              <textarea rows="2" value={vacationBalanceForm.notes} onChange={(event) => setVacationBalanceForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <button type="submit">Guardar saldo anual</button>
          </form>
        ) : (
          <p className="empty-note">
            Inicie sessão para ajustar o saldo anual de férias.
          </p>
        )}

        <form className="grid-form" onSubmit={saveVacationRequest}>
          <div className="full-span section-heading compact">
            <h3>Marcação de férias</h3>
            <p>Registe o período pretendido, acompanhe a aprovação e marque férias gozadas quando aplicável.</p>
          </div>
          <label>Funcionário
            <select value={vacationForm.employee_id} onChange={(event) => selectEmployee(Number(event.target.value))}>
              <option value="">Selecionar</option>
              {boot.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>
          <label>Ano
            <input value={vacationForm.year_ref} onChange={(event) => setVacationForm((current) => ({ ...current, year_ref: event.target.value }))} />
          </label>
          <label>Data inicial
            <input type="date" value={vacationForm.start_date} onChange={(event) => setVacationForm((current) => ({ ...current, start_date: event.target.value }))} />
          </label>
          <label>Data final
            <input type="date" value={vacationForm.end_date} onChange={(event) => setVacationForm((current) => ({ ...current, end_date: event.target.value }))} />
          </label>
          <label>Número de dias
            <input type="number" value={vacationForm.days} onChange={(event) => setVacationForm((current) => ({ ...current, days: event.target.value }))} />
          </label>
          <label className="full-span">Observações
            <textarea rows="2" value={vacationForm.notes} onChange={(event) => setVacationForm((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <button type="submit">Registar pedido de férias</button>
        </form>
      </div>

      <div className="movement-legacy-history" hidden>

      <div className="panel">
        <div className="section-heading">
          <h2>Histórico de eventos</h2>
          <p>Consulte os eventos salariais lançados para o colaborador selecionado.</p>
        </div>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={eventFilters.search}
              onChange={(event) => setEventFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Descrição, tipo ou data"
            />
          </label>
          <label>Tipo
            <select value={eventFilters.type} onChange={(event) => setEventFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="todos">Todos</option>
              <option value="vacation_bonus">Subsídio de férias</option>
              <option value="christmas_bonus">Subsídio de Natal</option>
              <option value="overtime_50">Hora extra a 50%</option>
              <option value="overtime_100">Hora extra a 100%</option>
              <option value="penalty">Penalização</option>
              <option value="extra_payment">Pagamento extraordinário</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {events.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.description || item.event_type}</strong>
                <small>{item.event_date}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatMoney(item.amount)}</strong>
                <button className="link-btn danger" onClick={() => deleteEvent(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {events.length === 0 && <p className="empty-note">Sem eventos encontrados com os filtros atuais.</p>}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Histórico de empréstimos e adiantamentos</h2>
          <p>Consulte as prestações previstas, o desconto do mês e o saldo remanescente por colaborador.</p>
        </div>

        <div className="table-list">
          {financialObligations.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>{formatFinancialType(item.entry_type)} | início {item.start_month_ref} | {item.installment_count} prestação(ões)</small>
                <small>Valor total {formatMoney(item.principal_amount)} | prestação do mês {formatMoney(item.current_month_amount || 0)}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatMoney(item.remaining_balance || 0)}</strong>
                <small>{item.active ? "Ativo" : "Inativo"} | {item.remaining_installments} prestação(ões) por liquidar</small>
                {canManageFinancialObligations && (
                  <button className="link-btn danger" onClick={() => deleteFinancialObligation(item.id)}>Excluir</button>
                )}
              </div>
            </div>
          ))}
          {financialObligations.length === 0 && <p className="empty-note">Sem empréstimos ou adiantamentos para o colaborador selecionado.</p>}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Histórico de licenças e ausências</h2>
          <p>Consulte o estado, o impacto salarial e os dados documentais do colaborador selecionado.</p>
        </div>

        <div className="stats-grid stats-grid--mini">
          <article className="stat-card stat-card--compact">
            <span>Dias justificados</span>
            <strong>{leaveSummary.justified}</strong>
            <small>Registos aprovados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Faltas injustificadas</span>
            <strong>{leaveSummary.unjustified}</strong>
            <small>Com impacto salarial</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Licenças sem vencimento</span>
            <strong>{leaveSummary.withoutPay}</strong>
            <small>Dias aprovados</small>
          </article>
          <article className="stat-card stat-card--compact">
            <span>Pendentes</span>
            <strong>{leaveSummary.pending}</strong>
            <small>Aguardam decisão</small>
          </article>
        </div>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={leaveFilters.search}
              onChange={(event) => setLeaveFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Motivo, documento ou data"
            />
          </label>
          <label>Tipo
            <select value={leaveFilters.type} onChange={(event) => setLeaveFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="todos">Todos</option>
              {leaveTypeOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="full-span">Estado
            <select value={leaveFilters.status} onChange={(event) => setLeaveFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="todos">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Rejeitadas</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {leaveRequests.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{formatLeaveType(item.record_type)}</strong>
                <small>{item.start_date} até {item.end_date} | {item.days} dia(s)</small>
                <small>{item.reason}</small>
              </div>
              <div className="payroll-values">
                <strong>{item.status === "approved" ? "Aprovada" : item.status === "rejected" ? "Rejeitada" : "Pendente"}</strong>
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn" onClick={() => setLeaveRequestStatus(item.id, "approved")}>Aprovar</button>}
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn danger" onClick={() => setLeaveRequestStatus(item.id, "rejected")}>Rejeitar</button>}
                <button className="link-btn danger" onClick={() => deleteLeaveRequest(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {leaveRequests.length === 0 && <p className="empty-note">Sem registos de licenças ou ausências com os filtros atuais.</p>}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Histórico de assiduidade</h2>
          <p>Consulte a presença diária, filtre por mês e acompanhe atrasos, faltas, licenças e férias.</p>
        </div>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={attendanceFilters.search}
              onChange={(event) => setAttendanceFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Data, estado ou observação"
            />
          </label>
          <label>Mês
            <input type="month" value={attendanceFilters.monthRef} onChange={(event) => setAttendanceFilters((current) => ({ ...current, monthRef: event.target.value }))} />
          </label>
          <label className="full-span">Estado
            <select value={attendanceFilters.status} onChange={(event) => setAttendanceFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="todos">Todos</option>
              {attendanceStatusOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="attendance-quick-filters">
          <button
            type="button"
            className={`attendance-filter-chip ${attendanceFilters.status === "todos" ? "attendance-filter-chip--active" : ""}`}
            onClick={() => setAttendanceFilters((current) => ({ ...current, status: "todos" }))}
          >
            Todos
          </button>
          {attendanceStatusOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`attendance-filter-chip attendance-filter-chip--${getAttendanceStatusTone(item.value)} ${attendanceFilters.status === item.value ? "attendance-filter-chip--active" : ""}`}
              onClick={() => setAttendanceFilters((current) => ({ ...current, status: item.value }))}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={`attendance-filter-chip ${activeAttendanceMonthRef === monthRef ? "attendance-filter-chip--active" : ""}`}
            onClick={() => setAttendanceFilters((current) => ({ ...current, monthRef, status: "todos" }))}
          >
            Usar mes da folha
          </button>
        </div>

        <p className="empty-note attendance-empty-note--legacy">
          Use os filtros rapidos para alternar o estado com um clique e consulte o calendario mensal do trabalhador abaixo.
        </p>

        <div className="attendance-calendar-panel attendance-calendar-panel--legacy">
          <div className="attendance-calendar__header">
            <div>
              <strong>{selectedEmployee ? `Calendario de ${selectedEmployee.full_name}` : "Calendario mensal do trabalhador"}</strong>
              <small>
                {selectedEmployee
                  ? `Visao diaria da assiduidade em ${activeAttendanceMonthRef}.`
                  : "Selecione um trabalhador para ver a distribuicao diaria da assiduidade."}
              </small>
            </div>
            <div className="attendance-calendar__legend">
              {attendanceStatusOptions.map((item) => (
                <span key={item.value} className={`attendance-state attendance-state--${getAttendanceStatusTone(item.value)}`}>
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          {!selectedEmployee ? (
            <p className="empty-note">Selecione um trabalhador para ativar o calendario visual da assiduidade.</p>
          ) : attendanceMonthRecords.length === 0 ? (
            <p className="empty-note">Não existem registos de assiduidade para {activeAttendanceMonthRef} com o trabalhador selecionado.</p>
          ) : (
            <div className="attendance-calendar">
              {attendanceCalendarWeekdays.map((label) => (
                <span key={label} className="attendance-calendar__weekday">{label}</span>
              ))}
              {attendanceCalendar.flat().map((cell, index) =>
                cell ? (
                  <div key={cell.dateKey} className={`attendance-calendar__day attendance-calendar__day--${cell.tone}`}>
                    <strong>{cell.day}</strong>
                    <span className="attendance-calendar__badge">{cell.shortLabel}</span>
                    <small>{formatAttendanceStatus(cell.record?.status)}</small>
                  </div>
                ) : (
                  <div key={`empty-${index}`} className="attendance-calendar__day attendance-calendar__day--empty" />
                )
              )}
            </div>
          )}
        </div>

        <div className="table-list">
          {attendanceRecords.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.attendance_date}</strong>
                <small>
                  {formatAttendanceStatus(item.status)} | {Number(item.hours_worked || 0)} hora(s) | {Number(item.delay_minutes || 0)} minuto(s) de atraso
                </small>
                <small>
                  {item.shift_name ? `Turno: ${item.shift_name}` : "Sem turno"} | Entrada {item.check_in_time || "--:--"} | Saída {item.check_out_time || "--:--"}
                </small>
                <small>
                  Origem: {item.source === "manual" ? "Manual" : item.source === "card_import" ? "Cartão" : "Biométrico"}
                  {item.device_label ? ` | ${item.device_label}` : ""}
                </small>
                <small>
                  Aprovação: {item.approval_status === "approved"
                    ? `Aprovado${item.approved_by_name ? ` por ${item.approved_by_name}` : ""}`
                    : "Pendente"}
                </small>
                <small>{item.notes || "Sem observações."}</small>
              </div>
              <div className="payroll-values">
                <span className={`attendance-state attendance-state--${getAttendanceStatusTone(item.status)}`}>
                  {formatAttendanceStatus(item.status)}
                </span>
                <button className="link-btn danger" disabled={attendancePeriodClosed} onClick={() => deleteAttendanceRecord(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {attendanceRecords.length === 0 && <p className="empty-note">Sem registos de assiduidade com os filtros atuais.</p>}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Histórico de férias</h2>
          <p>Consulte as marcações do ano, filtre por estado e acompanhe o consumo do saldo anual.</p>
        </div>

        <div className="grid-form filter-grid">
          <label>Pesquisar
            <input
              value={vacationFilters.search}
              onChange={(event) => setVacationFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Notas, datas ou estado"
            />
          </label>
          <label>Ano
            <input
              value={vacationFilters.yearRef}
              onChange={(event) => {
                setVacationFilters((current) => ({ ...current, yearRef: event.target.value }));
                setVacationBalanceForm((current) => ({ ...current, year_ref: event.target.value }));
                setVacationForm((current) => ({ ...current, year_ref: event.target.value }));
              }}
              placeholder="2026"
            />
          </label>
          <label className="full-span">Estado
            <select value={vacationFilters.status} onChange={(event) => setVacationFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="todos">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="taken">Gozadas</option>
              <option value="rejected">Rejeitadas</option>
            </select>
          </label>
        </div>

        <div className="table-list">
          {vacationRequests.map((item) => (
            <div className="table-row" key={item.id}>
              <div>
                <strong>{item.start_date} até {item.end_date}</strong>
                <small>{item.days} dia(s) | {formatVacationStatus(item.status)}</small>
                <small>{item.notes || "Sem observações adicionais."}</small>
              </div>
              <div className="payroll-values">
                <strong>{formatVacationStatus(item.status)}</strong>
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn" onClick={() => setVacationRequestStatus(item.id, "approved")}>Aprovar</button>}
                {user?.role === "admin" && item.status === "pending" && <button className="link-btn danger" onClick={() => setVacationRequestStatus(item.id, "rejected")}>Rejeitar</button>}
                {user?.role === "admin" && item.status === "approved" && <button className="link-btn" onClick={() => setVacationRequestStatus(item.id, "taken")}>Marcar como gozadas</button>}
                <button className="link-btn danger" onClick={() => deleteVacationRequest(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
          {vacationRequests.length === 0 && <p className="empty-note">Sem pedidos de férias com os filtros atuais.</p>}
        </div>
      </div>
      </div>

      <div className="panel panel--full">
        <div className="section-heading">
          <h2>Calendário manual do ponto</h2>
          <p>Clique num dia do mês para lançar ou corrigir entrada, saída, atraso, ausência, licença ou férias.</p>
        </div>

        {!selectedEmployee ? (
          <p className="empty-note">
            Selecione um trabalhador acima para ativar o calendário manual e preencher a assiduidade por dia.
          </p>
        ) : (
          <div className="attendance-manual-shell">
            <div className="attendance-calendar-panel attendance-calendar-panel--interactive">
              <div className="attendance-calendar__header">
                <div>
                  <strong>{`Calendário de ${selectedEmployee.full_name}`}</strong>
                  <small>{`Mês em edição: ${activeAttendanceMonthRef}. Clique num dia para abrir o preenchimento manual.`}</small>
                </div>
                <div className="attendance-calendar__legend">
                  {attendanceStatusOptions.map((item) => (
                    <span key={item.value} className={`attendance-state attendance-state--${getAttendanceStatusTone(item.value)}`}>
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="attendance-calendar attendance-calendar--interactive">
                {attendanceCalendarWeekdays.map((label) => (
                  <span key={label} className="attendance-calendar__weekday">{label}</span>
                ))}
                {attendanceCalendar.flat().map((cell, index) =>
                  cell ? (
                    <button
                      key={cell.dateKey}
                      type="button"
                      className={`attendance-calendar__day attendance-calendar__day--interactive attendance-calendar__day--${cell.tone} ${
                        selectedCalendarDate === cell.dateKey ? "attendance-calendar__day--selected" : ""
                      }`}
                      onClick={() => handleCalendarDateSelect(cell)}
                    >
                      <strong>{cell.day}</strong>
                      <span className="attendance-calendar__badge">{cell.shortLabel}</span>
                      <small>{cell.record ? formatAttendanceStatus(cell.record.status) : "Sem registo"}</small>
                      <small className="attendance-calendar__time">
                        {cell.record?.check_in_time || "--:--"} - {cell.record?.check_out_time || "--:--"}
                      </small>
                    </button>
                  ) : (
                    <div key={`manual-empty-${index}`} className="attendance-calendar__day attendance-calendar__day--empty" />
                  )
                )}
              </div>
            </div>

            <div className="attendance-manual-editor">
              {selectedCalendarDate ? (
                <>
                  <div className="attendance-manual-editor__header">
                    <div>
                      <span className="status-chip status-chip--info">Dia selecionado</span>
                      <h3>{formatCalendarLongDate(selectedCalendarDate)}</h3>
                      <p>
                        {manualAttendanceShift
                          ? `Turno aplicado: ${manualAttendanceShift.name} (${manualAttendanceShift.start_time} - ${manualAttendanceShift.end_time}) · carga diária prevista: ${assignedShiftHours || attendanceForm.hours_worked || 0} hora(s)`
                          : "Sem turno associado. Pode preencher os horários manualmente."}
                      </p>
                    </div>
                    <div className="attendance-manual-editor__meta">
                      <span className={`attendance-state attendance-state--${getAttendanceStatusTone(attendanceForm.status)}`}>
                        {formatAttendanceStatus(attendanceForm.status)}
                      </span>
                      <span className="attendance-state attendance-state--neutral">
                        {selectedCalendarRecord ? "Com registo anterior" : "Novo lançamento"}
                      </span>
                    </div>
                  </div>

                  <div className="attendance-status-picker">
                    {attendanceStatusOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={`attendance-status-button ${
                          attendanceForm.status === item.value ? "attendance-status-button--active" : ""
                        }`}
                        onClick={() => handleAttendanceStatusShortcut(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <form className="grid-form attendance-manual-form" onSubmit={saveAttendanceRecord}>
                    <label>Funcionário
                      <input value={selectedEmployee.full_name} readOnly />
                    </label>
                    <label>Turno aplicado
                      <select
                        value={attendanceForm.shift_id || ""}
                        onChange={(event) => setAttendanceForm((current) => ({ ...current, shift_id: event.target.value }))}
                      >
                        <option value="">Turno do funcionário</option>
                        {(boot.workShifts || []).filter((shift) => shift.active).map((shift) => (
                          <option key={shift.id} value={shift.id}>{shift.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>Data
                      <input type="date" value={attendanceForm.attendance_date} readOnly />
                    </label>
                    <label>Estado
                      <select value={attendanceForm.status} onChange={(event) => handleAttendanceStatusShortcut(event.target.value)}>
                        {attendanceStatusOptions.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>Hora de entrada
                      <input
                        type="time"
                        value={attendanceForm.check_in_time || ""}
                        disabled={!manualAttendanceNeedsSchedule}
                        onChange={(event) => setAttendanceForm((current) => ({ ...current, check_in_time: event.target.value }))}
                      />
                    </label>
                    <label>Hora de saída
                      <input
                        type="time"
                        value={attendanceForm.check_out_time || ""}
                        disabled={!manualAttendanceNeedsSchedule}
                        onChange={(event) => setAttendanceForm((current) => ({ ...current, check_out_time: event.target.value }))}
                      />
                    </label>
                    <label>Horas trabalhadas
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={attendanceForm.hours_worked}
                        disabled={!manualAttendanceNeedsSchedule}
                        onChange={(event) => setAttendanceForm((current) => ({ ...current, hours_worked: event.target.value }))}
                      />
                    </label>
                    <label>Minutos de atraso
                      <input
                        type="number"
                        min="0"
                        value={attendanceForm.delay_minutes}
                        disabled={!manualAttendanceNeedsSchedule || attendanceForm.status !== "delay"}
                        onChange={(event) => setAttendanceForm((current) => ({ ...current, delay_minutes: event.target.value }))}
                      />
                    </label>
                    <label className="full-span">Observações
                      <textarea
                        rows="3"
                        value={attendanceForm.notes}
                        onChange={(event) => setAttendanceForm((current) => ({ ...current, notes: event.target.value }))}
                        placeholder="Explique o atraso, ausência, justificativo ou qualquer nota interna."
                      />
                    </label>
                    <div className="attendance-manual-form__actions full-span">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={applyShiftScheduleToDraft}
                        disabled={!manualAttendanceNeedsSchedule || !manualAttendanceShift}
                      >
                        Aplicar horário do turno
                      </button>
                      <button type="submit" disabled={attendancePeriodClosed}>Guardar assiduidade do dia</button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="attendance-manual-placeholder">
                  <strong>Escolha um dia no calendário</strong>
                  <p>Assim que clicar num dia, o editor manual abre com os campos de entrada, saída, atraso e estado.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
