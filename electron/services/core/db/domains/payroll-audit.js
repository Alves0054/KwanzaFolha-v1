function roundCurrency(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function safeNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveEmployeeInssRate(summary = {}, fallback = 0) {
  const directRate = Number(summary?.socialSecurityEmployeeRate);
  if (Number.isFinite(directRate) && directRate > 0) {
    return roundCurrency(directRate * 100);
  }
  return roundCurrency(Number(fallback || 0));
}

function resolveEmployerInssRate(summary = {}, fallback = 0) {
  const directRate = Number(summary?.socialSecurityEmployerRate);
  if (Number.isFinite(directRate) && directRate > 0) {
    return roundCurrency(directRate * 100);
  }
  return roundCurrency(Number(fallback || 0));
}

function buildCalculationTrace(summary = {}, run = {}) {
  const baseSalary = safeNumber(summary.baseSalary);
  const allowancesTotal = safeNumber(summary.allowancesTotal ?? run.allowances_total);
  const bonusesTotal = safeNumber(summary.bonusesTotal ?? run.bonuses_total);
  const overtimeTotal = safeNumber(summary.overtimeTotal);
  const grossSalary = safeNumber(summary.grossSalary ?? run.gross_salary);
  const attendanceDeduction = safeNumber(summary.attendanceDeduction ?? run.absence_deduction);
  const employeeInss = safeNumber(summary.inssAmount ?? run.inss_amount);
  const employerInss = safeNumber(summary.employerInssAmount);
  const irt = safeNumber(summary.irtAmount ?? run.irt_amount);
  const penalties = safeNumber(summary.penalties);
  const financialDeductions = safeNumber(summary.financialDeductions);
  const mandatoryDeductions = safeNumber(summary.mandatoryDeductions ?? run.mandatory_deductions);
  const totalDeductions = safeNumber(summary.totalDeductions);
  const netSalary = safeNumber(summary.netSalary ?? run.net_salary);
  const legalBases = summary.legalBases || {};

  return {
    grossSalaryFormula:
      "gross_salary = base_salary + allowances_total + bonuses_total + overtime_total",
    grossSalaryFormulaValues: {
      baseSalary: roundCurrency(baseSalary),
      allowancesTotal: roundCurrency(allowancesTotal),
      bonusesTotal: roundCurrency(bonusesTotal),
      overtimeTotal: roundCurrency(overtimeTotal),
      grossSalary: roundCurrency(grossSalary)
    },
    inssFormula: "employee_inss = social_security_base * employee_inss_rate_percent / 100",
    inssFormulaValues: {
      socialSecurityBase: roundCurrency(safeNumber(legalBases.socialSecurityBase)),
      employeeInss: roundCurrency(employeeInss),
      employerInss: roundCurrency(employerInss)
    },
    irtFormula: "irt = fixed + (taxable_base - bracket_min) * bracket_rate",
    irtFormulaValues: {
      irtBaseBeforeSocialSecurity: roundCurrency(safeNumber(legalBases.irtBaseBeforeSocialSecurity)),
      taxableBase: roundCurrency(safeNumber(summary.materiaColectavel)),
      irt: roundCurrency(irt)
    },
    attendanceFormula:
      "attendance_deduction = daily_rate * (absence_days + leave_days)",
    attendanceFormulaValues: {
      dailyRate: roundCurrency(safeNumber(summary.dailyRate)),
      absenceDays: roundCurrency(safeNumber(summary.absencesDays)),
      leaveDays: roundCurrency(safeNumber(summary.leaveDays)),
      attendanceDeduction: roundCurrency(attendanceDeduction)
    },
    netSalaryFormula:
      "net_salary = gross_salary - mandatory_deductions - attendance_deduction",
    netSalaryFormulaValues: {
      grossSalary: roundCurrency(grossSalary),
      mandatoryDeductions: roundCurrency(mandatoryDeductions),
      attendanceDeduction: roundCurrency(attendanceDeduction),
      penalties: roundCurrency(penalties),
      financialDeductions: roundCurrency(financialDeductions),
      totalDeductions: roundCurrency(totalDeductions),
      netSalary: roundCurrency(netSalary)
    }
  };
}

function mapPayrollRunToAuditEntry(run = {}, context = {}) {
  const summary = run?.summary_json || {};
  const fiscalProfile = summary?.fiscalProfile || {};
  const employeeInssRate = resolveEmployeeInssRate(
    summary,
    context.fiscalProfile?.inssEmployeeRate
  );
  const employerInssRate = resolveEmployerInssRate(
    summary,
    context.fiscalProfile?.inssEmployerRate
  );

  return {
    payrollRunId: Number(run.id || 0),
    employeeId: Number(run.employee_id || 0),
    employeeName: String(run.full_name || "").trim(),
    department: String(run.department || "").trim(),
    jobTitle: String(run.job_title || "").trim(),
    monthRef: String(run.month_ref || "").trim(),
    generatedAt: String(run.generated_at || "").trim(),
    fiscalProfile: {
      id: String(fiscalProfile.id || context.fiscalProfile?.id || "").trim(),
      name: String(fiscalProfile.name || context.fiscalProfile?.name || "").trim(),
      version: String(summary.fiscalProfileVersion || fiscalProfile.version || "").trim(),
      effectiveFrom: String(fiscalProfile.effectiveFrom || context.fiscalProfile?.effectiveFrom || "").trim(),
      legalReference: String(fiscalProfile.legalReference || context.fiscalProfile?.legalReference || "").trim(),
      inssEmployeeRatePercent: employeeInssRate,
      inssEmployerRatePercent: employerInssRate
    },
    inputs: {
      baseSalary: roundCurrency(safeNumber(summary.baseSalary)),
      allowancesTotal: roundCurrency(
        safeNumber(summary.allowancesTotal ?? run.allowances_total)
      ),
      bonusesTotal: roundCurrency(
        safeNumber(summary.bonusesTotal ?? run.bonuses_total)
      ),
      overtimeTotal: roundCurrency(safeNumber(summary.overtimeTotal)),
      absencesDays: roundCurrency(safeNumber(summary.absencesDays)),
      leaveDays: roundCurrency(safeNumber(summary.leaveDays)),
      penalties: roundCurrency(safeNumber(summary.penalties)),
      financialDeductions: roundCurrency(safeNumber(summary.financialDeductions))
    },
    outputs: {
      grossSalary: roundCurrency(safeNumber(summary.grossSalary ?? run.gross_salary)),
      payableGrossSalary: roundCurrency(safeNumber(summary.payableGrossSalary)),
      inssEmployeeAmount: roundCurrency(safeNumber(summary.inssAmount ?? run.inss_amount)),
      inssEmployerAmount: roundCurrency(safeNumber(summary.employerInssAmount)),
      irtAmount: roundCurrency(safeNumber(summary.irtAmount ?? run.irt_amount)),
      attendanceDeduction: roundCurrency(
        safeNumber(summary.attendanceDeduction ?? run.absence_deduction)
      ),
      mandatoryDeductions: roundCurrency(
        safeNumber(summary.mandatoryDeductions ?? run.mandatory_deductions)
      ),
      totalDeductions: roundCurrency(safeNumber(summary.totalDeductions)),
      netSalary: roundCurrency(safeNumber(summary.netSalary ?? run.net_salary)),
      employerCost: roundCurrency(safeNumber(summary.employerCost))
    },
    legalBases: {
      socialSecurityBase: roundCurrency(
        safeNumber(summary?.legalBases?.socialSecurityBase)
      ),
      irtBaseBeforeSocialSecurity: roundCurrency(
        safeNumber(summary?.legalBases?.irtBaseBeforeSocialSecurity)
      ),
      taxableBase: roundCurrency(
        safeNumber(summary?.legalBases?.materiaColectavel ?? summary.materiaColectavel)
      )
    },
    formulas: buildCalculationTrace(summary, run),
    roundingPolicy: "roundCurrency(value) with 2 decimal places (Number.toFixed(2)).",
    source: {
      runTable: "payroll_runs",
      summaryJsonField: "payroll_runs.summary_json",
      codeModules: [
        "electron/services/payroll.js",
        "electron/services/core/payroll/salaryEngine.js",
        "electron/services/core/payroll/absenceCalculator.js",
        "electron/services/core/irt/irtCalculator.js",
        "electron/services/core/inss/inssCalculator.js"
      ]
    }
  };
}

function buildPayrollAuditArtifact({
  company = {},
  filters = {},
  fiscalProfile = {},
  rows = [],
  generatedAt = new Date().toISOString()
}) {
  const entries = rows.map((row) =>
    mapPayrollRunToAuditEntry(row, {
      fiscalProfile
    })
  );

  const totals = entries.reduce(
    (acc, entry) => {
      acc.grossSalary = roundCurrency(acc.grossSalary + safeNumber(entry.outputs.grossSalary));
      acc.inssEmployeeAmount = roundCurrency(
        acc.inssEmployeeAmount + safeNumber(entry.outputs.inssEmployeeAmount)
      );
      acc.inssEmployerAmount = roundCurrency(
        acc.inssEmployerAmount + safeNumber(entry.outputs.inssEmployerAmount)
      );
      acc.irtAmount = roundCurrency(acc.irtAmount + safeNumber(entry.outputs.irtAmount));
      acc.netSalary = roundCurrency(acc.netSalary + safeNumber(entry.outputs.netSalary));
      return acc;
    },
    {
      grossSalary: 0,
      inssEmployeeAmount: 0,
      inssEmployerAmount: 0,
      irtAmount: 0,
      netSalary: 0
    }
  );

  return {
    schemaVersion: 1,
    generatedAt,
    company: {
      name: String(company.name || "").trim(),
      nif: String(company.nif || "").trim()
    },
    period: {
      monthRef: String(filters.monthRef || "").trim(),
      startDate: String(filters.startDate || "").trim(),
      endDate: String(filters.endDate || "").trim(),
      periodLabel: String(filters.periodLabel || "").trim(),
      periodFileLabel: String(filters.periodFileLabel || "").trim(),
      employeeId: String(filters.employeeId || "").trim()
    },
    fiscalProfile: {
      id: String(fiscalProfile.id || "").trim(),
      name: String(fiscalProfile.name || "").trim(),
      version: String(fiscalProfile.version || "").trim(),
      effectiveFrom: String(fiscalProfile.effectiveFrom || "").trim(),
      legalReference: String(fiscalProfile.legalReference || "").trim(),
      notes: String(fiscalProfile.notes || "").trim(),
      inssEmployeeRate: Number(fiscalProfile.inssEmployeeRate || 0),
      inssEmployerRate: Number(fiscalProfile.inssEmployerRate || 0),
      irtBracketsCount: Array.isArray(fiscalProfile.irtBrackets)
        ? fiscalProfile.irtBrackets.length
        : 0
    },
    totals,
    entries
  };
}

function buildPayrollAuditCsv(artifact = {}) {
  const header = [
    "Payroll Run ID",
    "Funcionario ID",
    "Funcionario",
    "Periodo",
    "Salario Base",
    "Bruto",
    "INSS Funcionario",
    "INSS Empresa",
    "IRT",
    "Descontos Totais",
    "Liquido",
    "Perfil Fiscal",
    "Versao Fiscal"
  ];

  const rows = [header];
  for (const entry of artifact.entries || []) {
    rows.push([
      entry.payrollRunId,
      entry.employeeId,
      entry.employeeName,
      entry.monthRef,
      entry.inputs.baseSalary,
      entry.outputs.grossSalary,
      entry.outputs.inssEmployeeAmount,
      entry.outputs.inssEmployerAmount,
      entry.outputs.irtAmount,
      entry.outputs.totalDeductions,
      entry.outputs.netSalary,
      entry.fiscalProfile.name,
      entry.fiscalProfile.version
    ]);
  }

  return rows
    .map((line) =>
      line
        .map((value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`)
        .join(";")
    )
    .join("\r\n");
}

module.exports = {
  buildPayrollAuditArtifact,
  buildPayrollAuditCsv,
  mapPayrollRunToAuditEntry
};
