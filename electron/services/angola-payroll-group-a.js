const {
  CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS
} = require("./core/fiscal");
const { parseNonNegativeNumber } = require("./core/fiscal/utils");
const {
  calculateInssEmployee
} = require("./core/inss");
const {
  calculateIrtGrupoA,
  calculateTaxableIncomeAfterInss,
  findIrtBracket
} = require("./core/irt");
const {
  normalizeCompensationItems,
  roundCurrency,
  sumCompensationItems
} = require("./core/payroll/salaryEngine");

const GRUPO_A_IRT_BRACKETS = CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS;
const INSS_TRABALHADOR_RATE = 0.03;

function normalizeSubsidioItem(item, index) {
  if (typeof item === "number" || typeof item === "string") {
    return {
      descricao: `Subsídio ${index + 1}`,
      valor: parseNonNegativeNumber(item, `subsidios[${index}]`)
    };
  }

  if (!item || typeof item !== "object") {
    throw new TypeError("Cada subsídio deve ser um número ou um objeto com valor.");
  }

  return {
    descricao: String(item.descricao || item.label || item.description || `Subsídio ${index + 1}`).trim(),
    valor: parseNonNegativeNumber(item.valor ?? item.value ?? item.amount, `subsidios[${index}].valor`),
    fiscalMode: item.fiscalMode ?? item.fiscal_mode,
    subjectToInss: item.subjectToInss ?? item.subject_to_inss,
    subjectToIrt: item.subjectToIrt ?? item.subject_to_irt
  };
}

function normalizeSubsidios(subsidios) {
  if (subsidios === undefined || subsidios === null) {
    return [];
  }

  if (!Array.isArray(subsidios)) {
    return [normalizeSubsidioItem(subsidios, 0)];
  }

  return normalizeCompensationItems(subsidios.map((item, index) => normalizeSubsidioItem(item, index)));
}

function sumSubsidiosGrupoA(subsidios) {
  return roundCurrency(sumCompensationItems(normalizeSubsidios(subsidios)));
}

function findIrtBracketGrupoA(baseIRT, brackets = GRUPO_A_IRT_BRACKETS) {
  return findIrtBracket(baseIRT, brackets);
}

function calculateInssGrupoA(salarioBase) {
  return calculateInssEmployee(salarioBase, INSS_TRABALHADOR_RATE * 100);
}

function calculateBaseIrtGrupoA(salarioBase, inss = calculateInssGrupoA(salarioBase)) {
  return calculateTaxableIncomeAfterInss(salarioBase, inss);
}

function calculateAngolaPayrollGrupoA(payload = {}, options = {}) {
  const salarioBase = parseNonNegativeNumber(payload.salarioBase, "salarioBase");
  const subsidiosNormalizados = normalizeSubsidios(payload.subsidios);
  const subsidios = sumCompensationItems(subsidiosNormalizados);
  const salarioBruto = roundCurrency(salarioBase + subsidios);
  const baseInss = roundCurrency(
    salarioBase +
      subsidiosNormalizados.reduce(
        (total, item) => total + (item.subjectToInss !== false ? Number(item.amount || 0) : 0),
        0
      )
  );
  const irtBaseBeforeInss = roundCurrency(
    salarioBase +
      subsidiosNormalizados.reduce(
        (total, item) => total + (item.subjectToIrt !== false ? Number(item.amount || 0) : 0),
        0
      )
  );
  const inss = calculateInssGrupoA(baseInss);
  const baseIRT = calculateBaseIrtGrupoA(irtBaseBeforeInss, inss);
  const irt = calculateIrtGrupoA(baseIRT, options.irtBrackets || GRUPO_A_IRT_BRACKETS);
  const salarioLiquido = roundCurrency(salarioBruto - inss - irt);

  return {
    salarioBase,
    subsidios,
    salarioBruto,
    baseInss,
    irtBaseBeforeInss,
    inss,
    baseIRT,
    irt,
    salarioLiquido
  };
}

module.exports = {
  GRUPO_A_IRT_BRACKETS,
  INSS_TRABALHADOR_RATE,
  normalizeSubsidios,
  sumSubsidiosGrupoA,
  findIrtBracketGrupoA,
  calculateInssGrupoA,
  calculateBaseIrtGrupoA,
  calculateIrtGrupoA,
  calculateAngolaPayrollGrupoA
};
