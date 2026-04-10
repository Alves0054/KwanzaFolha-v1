const CURRENT_ANGOLA_FISCAL_EFFECTIVE_FROM = "2020-09";
const CURRENT_ANGOLA_FISCAL_PROFILE_ID = "ao-irt-lei-28-20";
const CURRENT_ANGOLA_FISCAL_PROFILE_NAME = "Angola IRT Grupo A - Lei 28/20";
const CURRENT_ANGOLA_FISCAL_PROFILE_LEGAL_REFERENCE =
  "Lei n.º 18/14 (CIRT), alterada pela Lei n.º 28/20, aplicável aos rendimentos do Grupo A desde 1 de Setembro de 2020.";
const CURRENT_ANGOLA_FISCAL_PROFILE_NOTES =
  "Motor fiscal alinhado apenas à tabela progressiva vigente do IRT Grupo A e às taxas correntes de INSS (3% trabalhador / 8% entidade empregadora).";

const CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS = Object.freeze([
  { min: 0, max: 100000, rate: 0, fixed: 0 },
  { min: 100000, max: 150000, rate: 0.13, fixed: 0 },
  { min: 150000, max: 200000, rate: 0.16, fixed: 6500 },
  { min: 200000, max: 300000, rate: 0.18, fixed: 14500 },
  { min: 300000, max: 500000, rate: 0.19, fixed: 32500 },
  { min: 500000, max: 1000000, rate: 0.2, fixed: 70500 },
  { min: 1000000, max: null, rate: 0.21, fixed: 170500 }
]);

const CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS = Object.freeze([
  { min: 0, max: 100000, rate: 0, fixed: 0 },
  { min: 100000, max: 150000, rate: 0.13, fixed: 0 },
  { min: 150000, max: 200000, rate: 0.16, fixed: 6500 },
  { min: 200000, max: 300000, rate: 0.18, fixed: 14500 },
  { min: 300000, max: 500000, rate: 0.19, fixed: 32500 },
  { min: 500000, max: 1000000, rate: 0.2, fixed: 70500 },
  { min: 1000000, max: Infinity, rate: 0.21, fixed: 170500 }
]);

const CURRENT_INSS_EMPLOYEE_RATE_PERCENT = 3;
const CURRENT_INSS_EMPLOYER_RATE_PERCENT = 8;

function cloneFiscalBrackets(brackets = CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS) {
  return (brackets || []).map((bracket) => ({ ...bracket }));
}

module.exports = {
  CURRENT_ANGOLA_FISCAL_EFFECTIVE_FROM,
  CURRENT_ANGOLA_FISCAL_PROFILE_ID,
  CURRENT_ANGOLA_FISCAL_PROFILE_LEGAL_REFERENCE,
  CURRENT_ANGOLA_FISCAL_PROFILE_NAME,
  CURRENT_ANGOLA_FISCAL_PROFILE_NOTES,
  CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS,
  CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS,
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  CURRENT_INSS_EMPLOYER_RATE_PERCENT,
  cloneFiscalBrackets
};
