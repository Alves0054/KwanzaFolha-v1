function roundCurrency(value) {
  return Number((value || 0).toFixed(2));
}

const {
  resolveFiscalProfileForMonth,
  summarizeFiscalProfile
} = require("./fiscal-config");
const {
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  calculateSalary: computeSalary,
  calculateLegalDeductions: computeLegalDeductions,
  mandatoryBonusAmount: computeMandatoryBonusAmount
} = require("./core/payroll/salaryEngine");
const {
  calculateAttendanceDeductions: computeAttendanceDeductions
} = require("./core/payroll/absenceCalculator");
const {
  calculateIrt: computeIrt,
  findIrtBracket: findConfiguredIrtBracket
} = require("./core/irt");
const {
  PAYROLL_OVERTIME_HOURLY_DIVISOR,
  PAYROLL_OVERTIME_MULTIPLIERS
} = require("../../shared/domain/payroll-constants");

const SOCIAL_SECURITY_RATE = 0.03;
const DEFAULT_FISCAL_MODE = "taxable";
const FISCAL_MODE_FLAGS = Object.freeze({
  taxable: { subjectToInss: true, subjectToIrt: true },
  taxable_all: { subjectToInss: true, subjectToIrt: true },
  both: { subjectToInss: true, subjectToIrt: true },
  inss_irt: { subjectToInss: true, subjectToIrt: true },
  irt_only: { subjectToInss: false, subjectToIrt: true },
  inss_only: { subjectToInss: true, subjectToIrt: false },
  exempt: { subjectToInss: false, subjectToIrt: false },
  excluded: { subjectToInss: false, subjectToIrt: false },
  nao_sujeito: { subjectToInss: false, subjectToIrt: false },
  isento: { subjectToInss: false, subjectToIrt: false }
});

function proratedBonus(baseSalary, quantity) {
  return computeMandatoryBonusAmount(baseSalary, quantity);
}

function overtimeAmount(remunerationBase, quantity, multiplier) {
  return roundCurrency(
    (Number(remunerationBase || 0) / PAYROLL_OVERTIME_HOURLY_DIVISOR) *
      Number(multiplier || 1) *
      Number(quantity || 0)
  );
}

function monthlyRemunerationBase(baseSalary, allowancesTotal, bonusesTotal) {
  return roundCurrency(Number(baseSalary || 0) + Number(allowancesTotal || 0) + Number(bonusesTotal || 0));
}

function normalizeRatePercent(value, fallbackPercent = SOCIAL_SECURITY_RATE * 100) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return Number(fallbackPercent || 0);
  }
  return numericValue;
}

function ratePercentToDecimal(percentValue) {
  return Number(normalizeRatePercent(percentValue, 0)) / 100;
}

function normalizeFiscalMode(value, fallbackMode = DEFAULT_FISCAL_MODE) {
  const normalized = String(value || fallbackMode)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");

  if (FISCAL_MODE_FLAGS[normalized]) {
    return normalized;
  }

  return fallbackMode;
}

function parseFiscalFlag(value, fallbackValue) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallbackValue;
  }

  if (["1", "true", "sim", "yes"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "nao", "não", "no"].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function resolveFiscalTreatment(item, fallbackMode = DEFAULT_FISCAL_MODE) {
  const fiscalMode = normalizeFiscalMode(
    item?.fiscalMode ?? item?.fiscal_mode ?? item?.taxMode ?? item?.tax_mode,
    fallbackMode
  );
  const defaultFlags = FISCAL_MODE_FLAGS[fiscalMode] || FISCAL_MODE_FLAGS[fallbackMode] || FISCAL_MODE_FLAGS.taxable;

  return {
    fiscalMode,
    subjectToInss: parseFiscalFlag(
      item?.subjectToInss ?? item?.subject_to_inss ?? item?.includeInInss ?? item?.include_in_inss ?? item?.taxTreatment?.subjectToInss,
      defaultFlags.subjectToInss
    ),
    subjectToIrt: parseFiscalFlag(
      item?.subjectToIrt ?? item?.subject_to_irt ?? item?.includeInIrt ?? item?.include_in_irt ?? item?.taxTreatment?.subjectToIrt,
      defaultFlags.subjectToIrt
    )
  };
}

function normalizeCompensationItems(items, fallbackMode = DEFAULT_FISCAL_MODE) {
  return (items || [])
    .map((item, index) => {
      const treatment = resolveFiscalTreatment(item, fallbackMode);
      const amount = roundCurrency(Number(item?.amount ?? item?.valor ?? 0));
      return {
        ...item,
        label: String(item?.label || item?.descricao || `Item ${index + 1}`).trim(),
        amount,
        fiscalMode: treatment.fiscalMode,
        subjectToInss: treatment.subjectToInss,
        subjectToIrt: treatment.subjectToIrt
      };
    })
    .filter((item) => Number.isFinite(item.amount) && item.amount !== 0);
}

function sumCompensationItems(items) {
  return roundCurrency((items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0));
}

function buildFiscalBaseComponents({ baseSalary, allowances, bonuses, overtimeEntries, absenceDeduction, leaveDeduction }) {
  const components = [
    {
      source: "base_salary",
      label: "Salário base",
      amount: roundCurrency(Number(baseSalary || 0)),
      fiscalMode: DEFAULT_FISCAL_MODE,
      subjectToInss: true,
      subjectToIrt: true
    },
    ...(allowances || []).map((item) => ({ ...item, source: "allowance" })),
    ...(bonuses || []).map((item) => ({ ...item, source: "bonus" })),
    ...(overtimeEntries || []).map((item) => ({ ...item, source: item.source || "overtime" }))
  ];

  if (Number(absenceDeduction || 0) > 0) {
    components.push({
      source: "absence_deduction",
      label: "Reducao por faltas sem vencimento",
      amount: roundCurrency(-Number(absenceDeduction || 0)),
      fiscalMode: DEFAULT_FISCAL_MODE,
      subjectToInss: true,
      subjectToIrt: true
    });
  }

  if (Number(leaveDeduction || 0) > 0) {
    components.push({
      source: "leave_deduction",
      label: "Redução por licença sem vencimento",
      amount: roundCurrency(-Number(leaveDeduction || 0)),
      fiscalMode: DEFAULT_FISCAL_MODE,
      subjectToInss: true,
      subjectToIrt: true
    });
  }

  return components;
}

function sumFiscalBase(components, flagName) {
  return roundCurrency(
    Math.max(
      (components || []).reduce(
        (sum, item) => sum + (item?.[flagName] ? Number(item.amount || 0) : 0),
        0
      ),
      0
    )
  );
}

function buildFiscalBreakdown(components, flagName) {
  return (components || [])
    .filter((item) => item?.[flagName] && Number(item.amount || 0) !== 0)
    .map((item) => ({
      source: item.source,
      label: item.label,
      amount: roundCurrency(Number(item.amount || 0)),
      fiscalMode: item.fiscalMode
    }));
}

function isValidMonthRef(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function monthRefDiff(startMonthRef, targetMonthRef) {
  const [startYear, startMonth] = String(startMonthRef || "").split("-").map(Number);
  const [targetYear, targetMonth] = String(targetMonthRef || "").split("-").map(Number);
  return (targetYear - startYear) * 12 + (targetMonth - startMonth);
}

function buildInstallmentSchedule(principalAmount, installmentCount, installmentAmount) {
  const total = roundCurrency(principalAmount);
  const count = Math.max(1, Number(installmentCount || 1));
  const regularInstallment = roundCurrency(Number(installmentAmount || total / count));
  const schedule = [];
  let remaining = total;

  for (let index = 0; index < count; index += 1) {
    const amount = index === count - 1 ? roundCurrency(remaining) : roundCurrency(Math.min(regularInstallment, remaining));
    schedule.push(amount);
    remaining = roundCurrency(remaining - amount);
  }

  return schedule;
}

function matchesMonth(date, monthRef) {
  return String(date || "").slice(0, 7) === monthRef;
}

function toUtcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function getMonthBounds(monthRef) {
  const [year, month] = String(monthRef || "").split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0))
  };
}

function overlapDaysInMonth(startDate, endDate, monthRef) {
  const { start, end } = getMonthBounds(monthRef);
  const rangeStart = toUtcDate(startDate);
  const rangeEnd = toUtcDate(endDate);
  const effectiveStart = rangeStart > start ? rangeStart : start;
  const effectiveEnd = rangeEnd < end ? rangeEnd : end;
  if (effectiveStart > effectiveEnd) {
    return 0;
  }
  return Math.floor((effectiveEnd - effectiveStart) / 86400000) + 1;
}

function summarizeLeaveRequests(leaveRequests, monthRef) {
  const summary = {
    unjustifiedAbsenceDays: 0,
    justifiedAbsenceDays: 0,
    leaveWithoutPayDays: 0,
    leaveWithPayDays: 0,
    medicalLeaveDays: 0,
    maternityLeaveDays: 0,
    paternityLeaveDays: 0,
    familyLeaveDays: 0,
    otherLeaveDays: 0
  };

  leaveRequests.forEach((record) => {
    const days = overlapDaysInMonth(record.start_date, record.end_date, monthRef) || Number(record.days || 0);
    switch (record.record_type) {
      case "unjustified_absence":
        summary.unjustifiedAbsenceDays += days;
        break;
      case "justified_absence":
        summary.justifiedAbsenceDays += days;
        break;
      case "leave_without_pay":
        summary.leaveWithoutPayDays += days;
        break;
      case "leave_with_pay":
        summary.leaveWithPayDays += days;
        break;
      case "medical_leave":
        summary.medicalLeaveDays += days;
        break;
      case "maternity_leave":
        summary.maternityLeaveDays += days;
        break;
      case "paternity_leave":
        summary.paternityLeaveDays += days;
        break;
      case "family_leave":
        summary.familyLeaveDays += days;
        break;
      default:
        summary.otherLeaveDays += days;
        break;
    }
  });

  return summary;
}

function summarizeVacationRequests(vacationRequests, monthRef) {
  return vacationRequests.reduce(
    (acc, record) => {
      const days = overlapDaysInMonth(record.start_date, record.end_date, monthRef) || Number(record.days || 0);
      if (record.status === "approved") {
        acc.approvedVacationDays += days;
      }
      if (record.status === "taken") {
        acc.takenVacationDays += days;
      }
      return acc;
    },
    { approvedVacationDays: 0, takenVacationDays: 0 }
  );
}

function findIrtBracket(materiaColectavel, brackets) {
  return findConfiguredIrtBracket(materiaColectavel, brackets || []);
}

function calculateIRT(materiaColectavel, brackets) {
  return computeIrt(materiaColectavel, brackets || []);
}

function calculateSalary(salarioBase, brackets, employeeRate = CURRENT_INSS_EMPLOYEE_RATE_PERCENT) {
  return computeSalary(salarioBase, brackets, employeeRate);
}

function calculateAttendanceDeductions(baseSalary, absencesDays, leaveDays) {
  return computeAttendanceDeductions(baseSalary, absencesDays, leaveDays);
}

function calculateLegalDeductions(baseSalaryOrOptions, employerRate, brackets, employeeRate = CURRENT_INSS_EMPLOYEE_RATE_PERCENT) {
  return computeLegalDeductions(baseSalaryOrOptions, employerRate, brackets, employeeRate);
}

function summarizeAttendanceRecords(attendanceRecords, settings = {}) {
  const delayThresholdMinutes = Math.max(1, Number(settings.attendanceDelayPenaltyThresholdMinutes || 240));
  const delayEquivalentDays = Math.max(0, Number(settings.attendanceDelayPenaltyEquivalentDays || 0.5));

  const summary = (attendanceRecords || []).reduce(
    (acc, item) => {
      const status = String(item?.status || "").trim().toLowerCase();
      const delayMinutes = Number(item?.delay_minutes || 0);

      if (status === "present") {
        acc.presentDays += 1;
      }
      if (status === "delay") {
        acc.delayDays += 1;
      }
      if (status === "absent") {
        acc.absenceDays += 1;
        acc.absenceEquivalentDays += 1;
      }
      if (status === "half_absence") {
        acc.halfAbsenceDays += 1;
        acc.absenceEquivalentDays += 0.5;
      }
      if (status === "leave") {
        acc.leaveDays += 1;
      }
      if (status === "vacation") {
        acc.vacationDays += 1;
      }

      acc.totalDelayMinutes += delayMinutes;
      return acc;
    },
    {
      presentDays: 0,
      delayDays: 0,
      absenceDays: 0,
      halfAbsenceDays: 0,
      leaveDays: 0,
      vacationDays: 0,
      totalDelayMinutes: 0,
      absenceEquivalentDays: 0
    }
  );

  const delayPenaltyDays = roundCurrency(
    Math.floor(summary.totalDelayMinutes / delayThresholdMinutes) * delayEquivalentDays
  );

  return {
    ...summary,
    totalDelayMinutes: roundCurrency(summary.totalDelayMinutes),
    absenceEquivalentDays: roundCurrency(summary.absenceEquivalentDays),
    delayPenaltyDays,
    delayThresholdMinutes,
    delayEquivalentDays
  };
}

function summarizeFinancialObligations(financialObligations, monthRef) {
  const entries = (financialObligations || []).flatMap((item) => {
    if (!item?.active || !isValidMonthRef(item.start_month_ref) || !isValidMonthRef(monthRef)) {
      return [];
    }
    const monthOffset = monthRefDiff(item.start_month_ref, monthRef);
    const schedule = buildInstallmentSchedule(item.principal_amount, item.installment_count, item.installment_amount);
    if (monthOffset < 0 || monthOffset >= schedule.length) {
      return [];
    }
    const amount = Number(schedule[monthOffset] || 0);
    if (!(amount > 0)) {
      return [];
    }
    return [{
      id: item.id,
      type: item.entry_type,
      label: item.label,
      installmentIndex: monthOffset + 1,
      installmentCount: Number(item.installment_count || schedule.length),
      amount: roundCurrency(amount)
    }];
  });

  return {
    items: entries,
    total: roundCurrency(entries.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  };
}

function calculatePayrollRunForEmployee(
  employee,
  settings,
  employeeEvents,
  monthRef,
  approvedLeaveRequests = [],
  approvedVacationRequests = [],
  activeFinancialObligations = [],
  attendanceRecords = []
) {
  const resolvedFiscalProfile = resolveFiscalProfileForMonth(settings, monthRef);
  const allowances = [...(employee.recurring_allowances || [])];
  const bonuses = [...(employee.recurring_bonuses || [])];
  const specialPayments = [...(employee.special_payments || [])];
  const monthNumber = Number(monthRef.split("-")[1]);

  const dynamicAllowances = employeeEvents
    .filter((event) => event.event_type === "extra_payment")
    .map((event) => ({
      label: event.description || "Pagamento extraordinario",
      amount: Number(event.amount || 0)
    }));

  const overtimeEntries = employeeEvents
    .filter((event) => event.event_type === "overtime" || event.event_type === "overtime_50" || event.event_type === "overtime_100")
    .map((event) => ({
      source: event.event_type,
      quantity: Number(event.quantity || 0),
      label:
        event.description ||
        (event.event_type === "overtime_50"
          ? `Horas Extra 50% (${Number(event.quantity || 0)}h)`
          : event.event_type === "overtime_100"
            ? `Horas Extra 100% (${Number(event.quantity || 0)}h)`
            : `Horas Extra (${Number(event.quantity || 0)}h)`),
      amount:
        event.event_type === "overtime_50"
          ? overtimeAmount(
              employee.base_salary,
              event.quantity || 0,
              PAYROLL_OVERTIME_MULTIPLIERS.regular
            )
          : event.event_type === "overtime_100"
            ? overtimeAmount(
                employee.base_salary,
                event.quantity || 0,
                PAYROLL_OVERTIME_MULTIPLIERS.holidayOrRestDay
              )
            : Number(event.amount || 0)
    }));

  const eventBonuses = employeeEvents
    .filter((event) => event.event_type === "vacation_bonus" || event.event_type === "christmas_bonus")
    .map((event) => ({
      label: event.description || (event.event_type === "vacation_bonus" ? "Subsídio de férias" : "Subsídio de Natal"),
      amount: computeMandatoryBonusAmount(employee.base_salary, event.quantity || 1)
    }));

  const penalties = employeeEvents
    .filter((event) => event.event_type === "penalty")
    .reduce((sum, event) => sum + Number(event.amount || 0), 0);

  const eventAbsenceDays = employeeEvents
    .filter((event) => event.event_type === "absence")
    .reduce((sum, event) => sum + Number(event.quantity || 1), 0);

  const eventLeaveDays = employeeEvents
    .filter((event) => event.event_type === "leave")
    .reduce((sum, event) => sum + Number(event.quantity || 1), 0);

  const leaveSummary = summarizeLeaveRequests(approvedLeaveRequests, monthRef);
  const vacationSummary = summarizeVacationRequests(approvedVacationRequests, monthRef);
  const attendanceSummary = summarizeAttendanceRecords(attendanceRecords, settings);
  const hasAttendanceData = (attendanceRecords || []).length > 0;
  const manualAbsencesDays = roundCurrency(eventAbsenceDays + leaveSummary.unjustifiedAbsenceDays);
  const manualLeaveDays = roundCurrency(eventLeaveDays + leaveSummary.leaveWithoutPayDays);
  const attendanceAbsencesDays = roundCurrency(
    attendanceSummary.absenceEquivalentDays + attendanceSummary.delayPenaltyDays
  );
  const attendanceLeaveDays = roundCurrency(attendanceSummary.leaveDays);
  const absencesDays = hasAttendanceData
    ? roundCurrency(Math.max(manualAbsencesDays, attendanceAbsencesDays))
    : manualAbsencesDays;
  const leaveDays = hasAttendanceData
    ? roundCurrency(Math.max(manualLeaveDays, attendanceLeaveDays))
    : manualLeaveDays;

  for (const item of specialPayments) {
    if (item.auto && Number(item.month) === monthNumber) {
      bonuses.push({ label: item.label, amount: Number(item.amount || 0) });
    }
  }

  if (Number(settings.vacationMonth) === monthNumber && !eventBonuses.some((item) => item.label.toLowerCase().includes("ferias"))) {
    bonuses.push({
      label: "Subsídio de férias",
      amount: Number(employee.base_salary || 0)
    });
  }

  if (Number(settings.christmasMonth) === monthNumber && !eventBonuses.some((item) => item.label.toLowerCase().includes("natal"))) {
    bonuses.push({
      label: "Subsídio de Natal",
      amount: Number(employee.base_salary || 0)
    });
  }

  bonuses.push(...eventBonuses);

  const normalizedAllowances = normalizeCompensationItems([...allowances, ...dynamicAllowances]);
  const normalizedBonuses = normalizeCompensationItems(bonuses);
  const allowancesTotal = sumCompensationItems(normalizedAllowances);
  const bonusesTotal = sumCompensationItems(normalizedBonuses);
  const remunerationBase = monthlyRemunerationBase(employee.base_salary, allowancesTotal, bonusesTotal);
  const overtimeCalculatedEntries = normalizeCompensationItems(
    overtimeEntries.map((item) => ({
      ...item,
      amount:
        item.source === "overtime_50"
          ? overtimeAmount(
              remunerationBase,
              item.quantity || 0,
              PAYROLL_OVERTIME_MULTIPLIERS.regular
            )
          : item.source === "overtime_100"
            ? overtimeAmount(
                remunerationBase,
                item.quantity || 0,
                PAYROLL_OVERTIME_MULTIPLIERS.holidayOrRestDay
              )
            : Number(item.amount || 0)
    }))
  );
  const overtimeTotal = sumCompensationItems(overtimeCalculatedEntries);
  const grossSalary = roundCurrency(remunerationBase + overtimeTotal);

  const attendanceDeductions = calculateAttendanceDeductions(employee.base_salary, absencesDays, leaveDays);
  const fiscalBaseComponents = buildFiscalBaseComponents({
    baseSalary: employee.base_salary,
    allowances: normalizedAllowances,
    bonuses: normalizedBonuses,
    overtimeEntries: overtimeCalculatedEntries,
    absenceDeduction: attendanceDeductions.absenceDeduction,
    leaveDeduction: attendanceDeductions.leaveDeduction
  });
  const legalDeductions = calculateLegalDeductions({
    socialSecurityBase: sumFiscalBase(fiscalBaseComponents, "subjectToInss"),
    irtBaseBeforeSocialSecurity: sumFiscalBase(fiscalBaseComponents, "subjectToIrt"),
    employerRatePercent: resolvedFiscalProfile.inssEmployerRate ?? settings.inssEmployerRate ?? 0,
    employeeRatePercent: resolvedFiscalProfile.inssEmployeeRate ?? settings.inssEmployeeRate ?? SOCIAL_SECURITY_RATE * 100,
    brackets: resolvedFiscalProfile.irtBrackets || settings.irtBrackets || []
  });
  const financialDeductions = summarizeFinancialObligations(activeFinancialObligations, monthRef);
  const payableGrossSalary = roundCurrency(Math.max(grossSalary - attendanceDeductions.attendanceDeduction, 0));
  const mandatoryDeductions = roundCurrency(
    legalDeductions.segurancaSocial + legalDeductions.irt + roundCurrency(penalties) + Number(financialDeductions.total || 0)
  );
  const totalDeductions = roundCurrency(mandatoryDeductions + attendanceDeductions.attendanceDeduction);
  const netSalary = roundCurrency(grossSalary - totalDeductions);
  const employerCost = roundCurrency(payableGrossSalary + legalDeductions.employerInssAmount);

  return {
    baseSalary: roundCurrency(Number(employee.base_salary)),
    allowances: normalizedAllowances,
    overtime: overtimeCalculatedEntries,
    bonuses: normalizedBonuses,
    specialPayments,
    absencesDays,
    leaveDays,
    manualAbsencesDays,
    manualLeaveDays,
    attendanceAbsencesDays,
    attendanceLeaveDays,
    attendancePresentDays: roundCurrency(attendanceSummary.presentDays),
    attendanceDelayDays: roundCurrency(attendanceSummary.delayDays),
    attendanceDelayMinutes: attendanceSummary.totalDelayMinutes,
    delayPenaltyDays: attendanceSummary.delayPenaltyDays,
    halfAbsenceDays: roundCurrency(attendanceSummary.halfAbsenceDays),
    justifiedAbsenceDays: roundCurrency(leaveSummary.justifiedAbsenceDays),
    leaveWithPayDays: roundCurrency(leaveSummary.leaveWithPayDays),
    medicalLeaveDays: roundCurrency(leaveSummary.medicalLeaveDays),
    maternityLeaveDays: roundCurrency(leaveSummary.maternityLeaveDays),
    paternityLeaveDays: roundCurrency(leaveSummary.paternityLeaveDays),
    familyLeaveDays: roundCurrency(leaveSummary.familyLeaveDays),
    otherLeaveDays: roundCurrency(leaveSummary.otherLeaveDays),
    approvedVacationDays: roundCurrency(vacationSummary.approvedVacationDays),
    takenVacationDays: roundCurrency(vacationSummary.takenVacationDays),
    attendanceVacationDays: roundCurrency(attendanceSummary.vacationDays),
    penalties: roundCurrency(penalties),
    financialDeductions: roundCurrency(financialDeductions.total),
    financialItems: financialDeductions.items,
    remunerationBase,
    grossSalary,
    payableGrossSalary,
    allowancesTotal,
    overtimeTotal,
    bonusesTotal,
    legalBases: {
      grossCompositionBase: remunerationBase,
      grossSalary,
      payableGrossSalary,
      socialSecurityBase: legalDeductions.socialSecurityBase,
      irtBaseBeforeSocialSecurity: legalDeductions.irtBaseBeforeSocialSecurity,
      attendanceBaseSalary: attendanceDeductions.attendanceBaseSalary,
      materiaColectavel: legalDeductions.materiaColectavel
    },
    fiscalBreakdown: {
      socialSecurityBaseItems: buildFiscalBreakdown(fiscalBaseComponents, "subjectToInss"),
      irtBaseItems: buildFiscalBreakdown(fiscalBaseComponents, "subjectToIrt")
    },
    segurancaSocial: legalDeductions.segurancaSocial,
    materiaColectavel: legalDeductions.materiaColectavel,
    inssAmount: legalDeductions.segurancaSocial,
    employerInssAmount: legalDeductions.employerInssAmount,
    irtAmount: legalDeductions.irt,
    absenceDeduction: attendanceDeductions.absenceDeduction,
    leaveDeduction: attendanceDeductions.leaveDeduction,
    attendanceDeduction: attendanceDeductions.attendanceDeduction,
    dailyRate: attendanceDeductions.dailyRate,
    mandatoryDeductions,
    totalDeductions,
    netSalary,
    employerCost,
    fiscalProfile: summarizeFiscalProfile(resolvedFiscalProfile),
    fiscalProfileVersion: String(resolvedFiscalProfile.version || "").trim()
  };
}

function summarizeTotals(items = []) {
  return (items || []).reduce(
    (acc, item) => {
      acc.gross = roundCurrency(acc.gross + Number(item.grossSalary || item.gross_salary || 0));
      acc.net = roundCurrency(acc.net + Number(item.netSalary || item.net_salary || 0));
      acc.irt = roundCurrency(acc.irt + Number(item.irtAmount || item.irt_amount || 0));
      acc.inss = roundCurrency(acc.inss + Number(item.inssAmount || item.inss_amount || 0));
      acc.absence = roundCurrency(acc.absence + Number(item.attendanceDeduction || item.absence_deduction || 0));
      acc.financial = roundCurrency(acc.financial + Number(item.financialDeductions || item.summary_json?.financialDeductions || 0));
      acc.employerInss = roundCurrency(acc.employerInss + Number(item.employerInssAmount || item.summary_json?.employerInssAmount || 0));
      acc.employerCost = roundCurrency(acc.employerCost + Number(item.employerCost || item.summary_json?.employerCost || 0));
      return acc;
    },
    { gross: 0, net: 0, irt: 0, inss: 0, absence: 0, financial: 0, employerInss: 0, employerCost: 0 }
  );
}

function extractComparableRunState(item = {}) {
  const summary = item.summary_json || item;
  return {
    grossSalary: roundCurrency(Number(summary.grossSalary ?? item.gross_salary ?? 0)),
    netSalary: roundCurrency(Number(summary.netSalary ?? item.net_salary ?? 0)),
    irtAmount: roundCurrency(Number(summary.irtAmount ?? item.irt_amount ?? 0)),
    inssAmount: roundCurrency(Number(summary.inssAmount ?? item.inss_amount ?? 0)),
    attendanceDeduction: roundCurrency(Number(summary.attendanceDeduction ?? item.absence_deduction ?? 0)),
    financialDeductions: roundCurrency(Number(summary.financialDeductions ?? 0)),
    fiscalProfileVersion: String(summary.fiscalProfileVersion || summary.fiscalProfile?.version || "").trim(),
    fiscalProfileName: String(summary.fiscalProfile?.name || "").trim()
  };
}

function buildChangedFields(beforeState = {}, afterState = {}) {
  const changedFields = [];
  for (const field of Object.keys(afterState)) {
    const beforeValue = beforeState?.[field];
    const afterValue = afterState?.[field];
    const numbersChanged =
      Number.isFinite(beforeValue) &&
      Number.isFinite(afterValue) &&
      Math.abs(Number(beforeValue) - Number(afterValue)) > 0.009;
    const genericChanged =
      !Number.isFinite(beforeValue) || !Number.isFinite(afterValue)
        ? JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)
        : false;
    if (numbersChanged || genericChanged) {
      changedFields.push(field);
    }
  }
  return changedFields;
}

class PayrollService {
  constructor(database) {
    this.database = database;
  }

  buildMonthProcessingSnapshot(monthRef) {
    try {
      const settings = this.database.getSystemSettings(monthRef);
      const fiscalProfile = resolveFiscalProfileForMonth(settings, monthRef);
      const employees = this.database.listEmployees().filter((employee) => employee.status === "ativo");
      const events = this.database.listEvents();
      const leaveRequests = this.database.listLeaveRequests({ status: "approved" });
      const vacationRequests = []
        .concat(this.database.listVacationRequests({ status: "approved" }))
        .concat(this.database.listVacationRequests({ status: "taken" }));
      const attendanceRecords = typeof this.database.listAttendanceRecords === "function"
        ? this.database.listAttendanceRecords({ monthRef, approvalStatus: "approved" })
        : [];
      const financialObligations = typeof this.database.listFinancialObligations === "function"
        ? this.database.listFinancialObligations({ active: true, monthRef })
        : [];
      const results = [];
      const persistedRuns = [];

      if (!employees.length) {
        return {
          ok: false,
          message: "Não existem funcionários ativos para processar neste período."
        };
      }

      for (const employee of employees) {
        const employeeEvents = events.filter((event) => event.employee_id === employee.id && matchesMonth(event.event_date, monthRef));
        const employeeLeaveRequests = leaveRequests.filter(
          (record) =>
            Number(record.employee_id) === Number(employee.id) &&
            String(record.start_date || "").slice(0, 7) <= monthRef &&
            String(record.end_date || "").slice(0, 7) >= monthRef
        );
        const employeeVacationRequests = vacationRequests.filter(
          (record) =>
            Number(record.employee_id) === Number(employee.id) &&
            String(record.start_date || "").slice(0, 7) <= monthRef &&
            String(record.end_date || "").slice(0, 7) >= monthRef
        );
        const employeeFinancialObligations = financialObligations.filter(
          (record) => Number(record.employee_id) === Number(employee.id)
        );
        const employeeAttendanceRecords = attendanceRecords.filter(
          (record) => Number(record.employee_id) === Number(employee.id)
        );
        const summary = calculatePayrollRunForEmployee(
          employee,
          settings,
          employeeEvents,
          monthRef,
          employeeLeaveRequests,
          employeeVacationRequests,
          employeeFinancialObligations,
          employeeAttendanceRecords
        );

        persistedRuns.push({
          month_ref: monthRef,
          employee_id: employee.id,
          gross_salary: summary.grossSalary,
          allowances_total: summary.allowancesTotal,
          bonuses_total: summary.bonusesTotal,
          mandatory_deductions: summary.mandatoryDeductions,
          absence_deduction: summary.attendanceDeduction,
          net_salary: summary.netSalary,
          irt_amount: summary.irtAmount,
          inss_amount: summary.inssAmount,
          summary_json: JSON.stringify(summary),
          generated_at: new Date().toISOString()
        });

        results.push({ employee_id: employee.id, full_name: employee.full_name, month_ref: monthRef, ...summary });
      }

      return {
        ok: true,
        month_ref: monthRef,
        fiscalProfile: summarizeFiscalProfile(fiscalProfile),
        items: results,
        persistedRuns,
        totals: summarizeTotals(results)
      };
    } catch (error) {
      return {
        ok: false,
        message: `Não foi possível processar a folha de ${monthRef}. ${error.message || "Reveja os dados do período e tente novamente."}`
      };
    }
  }

  previewReprocessMonth(monthRef) {
    const payrollPeriod =
      typeof this.database.getPayrollPeriod === "function"
        ? this.database.getPayrollPeriod(monthRef)
        : { status: "open" };
    const attendancePeriod =
      typeof this.database.getAttendancePeriod === "function"
        ? this.database.getAttendancePeriod(monthRef)
        : { status: "closed" };
    const currentRuns = (typeof this.database.listPayrollRuns === "function" ? this.database.listPayrollRuns() : [])
      .filter((run) => String(run.month_ref || "").trim() === String(monthRef || "").trim());

    if (!currentRuns.length) {
      return {
        ok: false,
        message: `Não existem salários processados em ${monthRef} para comparar antes do reprocessamento.`
      };
    }

    const snapshot = this.buildMonthProcessingSnapshot(monthRef);
    if (!snapshot.ok) {
      return snapshot;
    }

    const currentByEmployee = new Map(currentRuns.map((run) => [Number(run.employee_id), run]));
    const nextByEmployee = new Map(snapshot.items.map((item) => [Number(item.employee_id), item]));
    const changedEmployees = [];
    let unchangedCount = 0;

    for (const employeeId of new Set([...currentByEmployee.keys(), ...nextByEmployee.keys()])) {
      const beforeRun = currentByEmployee.get(employeeId) || null;
      const afterRun = nextByEmployee.get(employeeId) || null;
      const beforeState = extractComparableRunState(beforeRun || {});
      const afterState = extractComparableRunState(afterRun || {});
      const changedFields = buildChangedFields(beforeState, afterState);

      if (!changedFields.length) {
        unchangedCount += 1;
        continue;
      }

      changedEmployees.push({
        employee_id: employeeId,
        full_name: afterRun?.full_name || beforeRun?.full_name || "",
        department: afterRun?.department || beforeRun?.department || "",
        job_title: afterRun?.job_title || beforeRun?.job_title || "",
        changedFields,
        before: beforeState,
        after: afterState,
        delta: {
          grossSalary: roundCurrency(afterState.grossSalary - beforeState.grossSalary),
          netSalary: roundCurrency(afterState.netSalary - beforeState.netSalary),
          irtAmount: roundCurrency(afterState.irtAmount - beforeState.irtAmount),
          inssAmount: roundCurrency(afterState.inssAmount - beforeState.inssAmount),
          attendanceDeduction: roundCurrency(afterState.attendanceDeduction - beforeState.attendanceDeduction),
          financialDeductions: roundCurrency(afterState.financialDeductions - beforeState.financialDeductions)
        }
      });
    }

    const beforeTotals = summarizeTotals(currentRuns);
    const afterTotals = summarizeTotals(snapshot.items);
    const deltaTotals = Object.keys(afterTotals).reduce((acc, key) => {
      acc[key] = roundCurrency(Number(afterTotals[key] || 0) - Number(beforeTotals[key] || 0));
      return acc;
    }, {});
    const authorizationRequired = payrollPeriod.status === "closed";
    const canApply =
      attendancePeriod.status === "closed" &&
      (payrollPeriod.status === "open" || authorizationRequired);

    return {
      ok: true,
      month_ref: monthRef,
      periodStatus: payrollPeriod.status || "open",
      attendancePeriodStatus: attendancePeriod.status || "open",
      authorizationRequired,
      canApply,
      reprocessBlockReason:
        attendancePeriod.status !== "closed"
          ? `Feche primeiro a assiduidade de ${monthRef} antes de reprocessar a folha.`
          : authorizationRequired
            ? `O período ${monthRef} está fechado. É necessária autorização explícita para reprocessar sem reabrir o mês.`
            : "",
      currentProfile:
        (typeof this.database.getSystemSettings === "function" &&
          summarizeFiscalProfile(resolveFiscalProfileForMonth(this.database.getSystemSettings(monthRef), monthRef))) ||
        snapshot.fiscalProfile,
      nextProfile: snapshot.fiscalProfile,
      totals: {
        before: beforeTotals,
        after: afterTotals,
        delta: deltaTotals
      },
      changedCount: changedEmployees.length,
      unchangedCount,
      runCount: currentRuns.length,
      changedEmployees
    };
  }

  processMonth(monthRef, options = {}) {
    const authorizationRequired =
      typeof this.database.getPayrollPeriod === "function" &&
      this.database.getPayrollPeriod(monthRef)?.status === "closed";

    if (authorizationRequired) {
      if (!options.allowClosedPeriod) {
        return {
          ok: false,
          message: `O período ${monthRef} está fechado. Reabra-o ou execute um reprocessamento autorizado.`
        };
      }
      if (!String(options.authorizationReason || "").trim()) {
        return {
          ok: false,
          message: "Indique o motivo da autorização antes de reprocessar um período fechado."
        };
      }
    } else {
      const periodState = this.database.ensurePeriodOpen(monthRef);
      if (!periodState.ok) {
        return periodState;
      }
    }

    const attendanceState = this.database.ensureAttendancePeriodClosed(monthRef);
    if (!attendanceState.ok) {
      return attendanceState;
    }

    const payrollValidation = this.database.validateEmployeesForPayroll(monthRef);
    if (!payrollValidation.ok) {
      return payrollValidation;
    }

    const snapshot = this.buildMonthProcessingSnapshot(monthRef);
    if (!snapshot.ok) {
      return snapshot;
    }

    const preview = options.includePreview === false ? null : this.previewReprocessMonth(monthRef);
    if (
      typeof this.database.createPayrollRunVersion === "function" &&
      typeof this.database.listPayrollRuns === "function" &&
      this.database.listPayrollRuns({ monthRef }).length
    ) {
      this.database.createPayrollRunVersion(
        monthRef,
        options.userId || null,
        options.authorizationReason || (options.resetExisting ? "Snapshot antes de reprocessamento" : "Snapshot antes de processamento")
      );
    }

    if (typeof this.database.savePayrollRunsSnapshot === "function") {
      this.database.savePayrollRunsSnapshot(monthRef, snapshot.persistedRuns, {
        resetExisting: options.resetExisting === true
      });
    } else {
      if (options.resetExisting === true && typeof this.database.clearPayrollRunsByMonth === "function") {
        this.database.clearPayrollRunsByMonth(monthRef);
      }

      for (const payrollRun of snapshot.persistedRuns) {
        this.database.upsertPayrollRun(payrollRun);
      }

      if (typeof this.database.prunePayrollRunsByMonth === "function") {
        this.database.prunePayrollRunsByMonth(
          monthRef,
          snapshot.items.map((employee) => employee.employee_id)
        );
      }
    }

    return {
      ok: true,
      month_ref: monthRef,
      fiscalProfile: snapshot.fiscalProfile,
      items: snapshot.items,
      totals: snapshot.totals,
      changedCount: preview?.ok ? preview.changedCount : snapshot.items.length,
      changedEmployees: preview?.ok ? preview.changedEmployees : [],
      authorization: authorizationRequired
        ? {
            required: true,
            reason: String(options.authorizationReason || "").trim()
          }
        : {
            required: false,
            reason: ""
          }
    };
  }

  reprocessMonth(monthRef, options = {}) {
    return this.processMonth(monthRef, { ...options, resetExisting: true });
  }

  getMonthlySummary(monthRef) {
    const runs = this.database.listPayrollRuns().filter((run) => run.month_ref === monthRef);
    return {
      month_ref: monthRef,
      employeeCount: runs.length,
      totalGross: roundCurrency(runs.reduce((sum, run) => sum + run.gross_salary, 0)),
      totalNet: roundCurrency(runs.reduce((sum, run) => sum + run.net_salary, 0)),
      totalIrt: roundCurrency(runs.reduce((sum, run) => sum + run.irt_amount, 0)),
      totalInss: roundCurrency(runs.reduce((sum, run) => sum + run.inss_amount, 0)),
      totalAbsence: roundCurrency(runs.reduce((sum, run) => sum + run.absence_deduction, 0)),
      totalFinancial: roundCurrency(runs.reduce((sum, run) => sum + Number(run.summary_json?.financialDeductions || 0), 0)),
      totalEmployerInss: roundCurrency(runs.reduce((sum, run) => sum + Number(run.summary_json?.employerInssAmount || 0), 0)),
      totalEmployerCost: roundCurrency(runs.reduce((sum, run) => sum + Number(run.summary_json?.employerCost || 0), 0)),
      rows: runs
    };
  }
}

const {
  GRUPO_A_IRT_BRACKETS,
  calculateAngolaPayrollGrupoA,
  calculateBaseIrtGrupoA,
  calculateInssGrupoA,
  calculateIrtGrupoA,
  findIrtBracketGrupoA,
  normalizeSubsidios,
  sumSubsidiosGrupoA
} = require("./angola-payroll-group-a");

module.exports = {
  PayrollService,
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
  findIrtBracketGrupoA,
  normalizeSubsidios,
  summarizeAttendanceRecords,
  summarizeFinancialObligations,
  sumSubsidiosGrupoA
};
