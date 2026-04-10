const { roundCurrency } = require("../fiscal/utils");
const {
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  calculateInssBreakdown,
  ratePercentToDecimal
} = require("../inss");
const {
  CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS,
  calculateIrt,
  calculateIrtGrupoA,
  calculateTaxableIncomeAfterInss
} = require("../irt");

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

function mandatoryBonusAmount(baseSalary, quantity = 1) {
  return roundCurrency(Number(baseSalary || 0) * Number(quantity || 0));
}

function overtimeAmount(remunerationBase, quantity, multiplier) {
  return roundCurrency((Number(remunerationBase || 0) / 176) * Number(multiplier || 1) * Number(quantity || 0));
}

function monthlyRemunerationBase(baseSalary, allowancesTotal, bonusesTotal) {
  return roundCurrency(Number(baseSalary || 0) + Number(allowancesTotal || 0) + Number(bonusesTotal || 0));
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
      label: "Salario base",
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
      label: "Reducao por licenca sem vencimento",
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

function calculateSalary(salarioBase, brackets, employeeRate = CURRENT_INSS_EMPLOYEE_RATE_PERCENT) {
  const base = roundCurrency(Number(salarioBase || 0));
  const segurancaSocial = roundCurrency(base * ratePercentToDecimal(employeeRate));
  const materiaColectavel = calculateTaxableIncomeAfterInss(base, segurancaSocial);
  const irt = calculateIrt(materiaColectavel, brackets || CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS);
  const salarioLiquido = roundCurrency(base - segurancaSocial - irt);
  return {
    salarioBase: base,
    segurancaSocial,
    materiaColectavel,
    irt,
    salarioLiquido
  };
}

function calculateLegalDeductions(baseSalaryOrOptions, employerRate, brackets, employeeRate = CURRENT_INSS_EMPLOYEE_RATE_PERCENT) {
  const options =
    baseSalaryOrOptions && typeof baseSalaryOrOptions === "object" && !Array.isArray(baseSalaryOrOptions)
      ? {
          socialSecurityBase: Number(baseSalaryOrOptions.socialSecurityBase || 0),
          irtBaseBeforeSocialSecurity: Number(
            baseSalaryOrOptions.irtBaseBeforeSocialSecurity ?? baseSalaryOrOptions.irtBase ?? baseSalaryOrOptions.socialSecurityBase ?? 0
          ),
          employerRatePercent: Number(
            baseSalaryOrOptions.employerRatePercent ?? baseSalaryOrOptions.employerRate ?? employerRate ?? 0
          ),
          employeeRatePercent: Number(
            baseSalaryOrOptions.employeeRatePercent ?? baseSalaryOrOptions.employeeRate ?? employeeRate ?? 0
          ),
          brackets: baseSalaryOrOptions.brackets || brackets || []
        }
      : {
          socialSecurityBase: Number(baseSalaryOrOptions || 0),
          irtBaseBeforeSocialSecurity: Number(baseSalaryOrOptions || 0),
          employerRatePercent: Number(employerRate || 0),
          employeeRatePercent: Number(employeeRate || 0),
          brackets: brackets || []
        };

  const socialSecurityBase = roundCurrency(Math.max(Number(options.socialSecurityBase || 0), 0));
  const irtBaseBeforeSocialSecurity = roundCurrency(
    Math.max(Number(options.irtBaseBeforeSocialSecurity ?? socialSecurityBase), 0)
  );
  const inssBreakdown = calculateInssBreakdown({
    baseAmount: socialSecurityBase,
    employeeRatePercent: options.employeeRatePercent,
    employerRatePercent: options.employerRatePercent
  });
  const materiaColectavel = calculateTaxableIncomeAfterInss(irtBaseBeforeSocialSecurity, inssBreakdown.employeeAmount);
  const irt = calculateIrt(materiaColectavel, options.brackets || CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS);

  return {
    socialSecurityBase,
    irtBaseBeforeSocialSecurity,
    socialSecurityEmployeeRate: inssBreakdown.employeeRateDecimal,
    socialSecurityEmployerRate: inssBreakdown.employerRateDecimal,
    segurancaSocial: inssBreakdown.employeeAmount,
    materiaColectavel,
    irt,
    employerInssAmount: inssBreakdown.employerAmount
  };
}

module.exports = {
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  DEFAULT_FISCAL_MODE,
  FISCAL_MODE_FLAGS,
  buildFiscalBaseComponents,
  buildFiscalBreakdown,
  calculateLegalDeductions,
  calculateSalary,
  mandatoryBonusAmount,
  monthlyRemunerationBase,
  normalizeCompensationItems,
  normalizeFiscalMode,
  overtimeAmount,
  parseFiscalFlag,
  resolveFiscalTreatment,
  roundCurrency,
  sumCompensationItems,
  sumFiscalBase
};
