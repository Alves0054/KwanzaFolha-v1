const { roundCurrency } = require("../fiscal/utils");
const {
  CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS,
  CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS
} = require("../fiscal");

function normalizeIrtBrackets(brackets = CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS) {
  return (Array.isArray(brackets) ? brackets : [])
    .map((bracket) => ({
      min: Number(bracket?.min || 0),
      max:
        bracket?.max === null || bracket?.max === undefined || bracket?.max === ""
          ? null
          : bracket.max === Infinity
            ? Infinity
            : Number(bracket.max),
      rate: Number(bracket?.rate || 0),
      fixed: Number(bracket?.fixed || 0)
    }))
    .sort((left, right) => Number(left.min || 0) - Number(right.min || 0));
}

function findIrtBracket(taxableIncome, brackets = CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS) {
  const income = roundCurrency(Math.max(Number(taxableIncome || 0), 0));
  return normalizeIrtBrackets(brackets).find((bracket) => {
    const max = bracket.max;
    return income >= bracket.min && (max === null || max === Infinity || income <= max);
  }) || null;
}

function calculateTaxableIncomeAfterInss(irtBaseBeforeInss, employeeInssAmount) {
  return roundCurrency(Math.max(Number(irtBaseBeforeInss || 0) - Number(employeeInssAmount || 0), 0));
}

function calculateIrt(taxableIncome, brackets = CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS) {
  const income = roundCurrency(Math.max(Number(taxableIncome || 0), 0));
  if (income <= 0) {
    return 0;
  }

  const bracket = findIrtBracket(income, brackets);
  if (!bracket) {
    return 0;
  }

  return roundCurrency(Number(bracket.fixed || 0) + Math.max(income - Number(bracket.min || 0), 0) * Number(bracket.rate || 0));
}

function calculateIrtGrupoA(taxableIncome, brackets = CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS) {
  return calculateIrt(taxableIncome, brackets);
}

module.exports = {
  CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS,
  CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS,
  calculateIrt,
  calculateIrtGrupoA,
  calculateTaxableIncomeAfterInss,
  findIrtBracket,
  normalizeIrtBrackets
};
