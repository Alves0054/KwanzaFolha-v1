const { roundCurrency } = require("../fiscal/utils");
const {
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  CURRENT_INSS_EMPLOYER_RATE_PERCENT
} = require("../fiscal");

function normalizeRatePercent(value, fallbackPercent = CURRENT_INSS_EMPLOYEE_RATE_PERCENT) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return Number(fallbackPercent || 0);
  }
  return numericValue;
}

function ratePercentToDecimal(percentValue) {
  return Number(normalizeRatePercent(percentValue, 0)) / 100;
}

function calculateInssEmployee(baseAmount, employeeRatePercent = CURRENT_INSS_EMPLOYEE_RATE_PERCENT) {
  return roundCurrency(Math.max(Number(baseAmount || 0), 0) * ratePercentToDecimal(employeeRatePercent));
}

function calculateInssEmployer(baseAmount, employerRatePercent = CURRENT_INSS_EMPLOYER_RATE_PERCENT) {
  return roundCurrency(Math.max(Number(baseAmount || 0), 0) * ratePercentToDecimal(employerRatePercent));
}

function calculateInssBreakdown({
  baseAmount = 0,
  employeeRatePercent = CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  employerRatePercent = CURRENT_INSS_EMPLOYER_RATE_PERCENT
} = {}) {
  const normalizedBase = roundCurrency(Math.max(Number(baseAmount || 0), 0));
  const employeeAmount = calculateInssEmployee(normalizedBase, employeeRatePercent);
  const employerAmount = calculateInssEmployer(normalizedBase, employerRatePercent);

  return {
    baseAmount: normalizedBase,
    employeeRatePercent: normalizeRatePercent(employeeRatePercent, CURRENT_INSS_EMPLOYEE_RATE_PERCENT),
    employerRatePercent: normalizeRatePercent(employerRatePercent, CURRENT_INSS_EMPLOYER_RATE_PERCENT),
    employeeRateDecimal: ratePercentToDecimal(employeeRatePercent),
    employerRateDecimal: ratePercentToDecimal(employerRatePercent),
    employeeAmount,
    employerAmount
  };
}

module.exports = {
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  CURRENT_INSS_EMPLOYER_RATE_PERCENT,
  calculateInssBreakdown,
  calculateInssEmployee,
  calculateInssEmployer,
  normalizeRatePercent,
  ratePercentToDecimal
};
