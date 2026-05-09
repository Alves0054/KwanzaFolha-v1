const ANGOLA_IRT_2020_EFFECTIVE_FROM = "2020-09";
const ANGOLA_IRT_2020_EFFECTIVE_TO = "2025-12";
const ANGOLA_IRT_2020_PROFILE_ID = "ao-irt-lei-28-20";
const ANGOLA_IRT_2020_PROFILE_NAME = "Angola IRT Grupo A - Lei 28/20";
const ANGOLA_IRT_2020_LEGAL_REFERENCE =
  "Lei n.º 18/14 (CIRT), alterada pela Lei n.º 28/20, aplicável aos rendimentos do Grupo A desde 1 de Setembro de 2020.";
const ANGOLA_IRT_2020_NOTES =
  "Perfil histórico mantido para folhas até 2025 e reprocessamentos de períodos anteriores.";

const ANGOLA_IRT_2026_EFFECTIVE_FROM = "2026-01";
const ANGOLA_IRT_2026_PROFILE_ID = "ao-irt-oge-2026-lei-14-25";
const ANGOLA_IRT_2026_PROFILE_NAME = "Angola IRT Grupo A - OGE 2026";
const ANGOLA_IRT_2026_LEGAL_REFERENCE =
  "Lei n.º 14/25, de 30 de Dezembro de 2025 (OGE 2026), Anexo I ao Artigo 21.º; validação final obrigatoria por contabilista certificado.";
const ANGOLA_IRT_2026_NOTES =
  "Fonte consultada: texto da Lei n.º 14/25 reproduzido em Angolex e confirmações profissionais sobre OGE 2026. Antes de entrega comercial, confirmar contra Diario da Republica/AGT/MINFIN.";

const CURRENT_ANGOLA_FISCAL_EFFECTIVE_FROM = ANGOLA_IRT_2026_EFFECTIVE_FROM;
const CURRENT_ANGOLA_FISCAL_PROFILE_ID = ANGOLA_IRT_2026_PROFILE_ID;
const CURRENT_ANGOLA_FISCAL_PROFILE_NAME = ANGOLA_IRT_2026_PROFILE_NAME;
const CURRENT_ANGOLA_FISCAL_PROFILE_LEGAL_REFERENCE = ANGOLA_IRT_2026_LEGAL_REFERENCE;
const CURRENT_ANGOLA_FISCAL_PROFILE_NOTES =
  "Motor fiscal alinhado ao IRT Grupo A 2026 e as taxas correntes de INSS (3% trabalhador / 8% entidade empregadora). Validacao contabilistica bloqueante para release comercial.";

const ANGOLA_IRT_GROUP_A_BRACKETS_2020 = Object.freeze([
  { min: 0, max: 100000, rate: 0, fixed: 0 },
  { min: 100000, max: 150000, rate: 0.13, fixed: 0 },
  { min: 150000, max: 200000, rate: 0.16, fixed: 6500 },
  { min: 200000, max: 300000, rate: 0.18, fixed: 14500 },
  { min: 300000, max: 500000, rate: 0.19, fixed: 32500 },
  { min: 500000, max: 1000000, rate: 0.2, fixed: 70500 },
  { min: 1000000, max: null, rate: 0.21, fixed: 170500 }
]);

const ANGOLA_IRT_GROUP_A_REFERENCE_BRACKETS_2020 = Object.freeze([
  { min: 0, max: 100000, rate: 0, fixed: 0 },
  { min: 100000, max: 150000, rate: 0.13, fixed: 0 },
  { min: 150000, max: 200000, rate: 0.16, fixed: 6500 },
  { min: 200000, max: 300000, rate: 0.18, fixed: 14500 },
  { min: 300000, max: 500000, rate: 0.19, fixed: 32500 },
  { min: 500000, max: 1000000, rate: 0.2, fixed: 70500 },
  { min: 1000000, max: Infinity, rate: 0.21, fixed: 170500 }
]);

// IRT Grupo A 2026. Fonte legal a validar no dossie fiscal:
// Lei n.º 14/25, de 30 de Dezembro de 2025 (OGE 2026), Anexo I ao Artigo 21.º.
const ANGOLA_IRT_GROUP_A_BRACKETS_2026 = Object.freeze([
  { min: 0, max: 150000, rate: 0, fixed: 0 },
  { min: 150000, max: 200000, rate: 0.16, fixed: 12500 },
  { min: 200000, max: 300000, rate: 0.18, fixed: 31250 },
  { min: 300000, max: 500000, rate: 0.19, fixed: 49250 },
  { min: 500000, max: 1000000, rate: 0.2, fixed: 87250 },
  { min: 1000000, max: 1500000, rate: 0.21, fixed: 187250 },
  { min: 1500000, max: 2000000, rate: 0.22, fixed: 292250 },
  { min: 2000000, max: 2500000, rate: 0.23, fixed: 402250 },
  { min: 2500000, max: 5000000, rate: 0.24, fixed: 517250 },
  { min: 5000000, max: 10000000, rate: 0.245, fixed: 1117250 },
  { min: 10000000, max: null, rate: 0.25, fixed: 2342250 }
]);

const ANGOLA_IRT_GROUP_A_REFERENCE_BRACKETS_2026 = Object.freeze([
  ...ANGOLA_IRT_GROUP_A_BRACKETS_2026.slice(0, -1).map((bracket) => ({ ...bracket })),
  { min: 10000000, max: Infinity, rate: 0.25, fixed: 2342250 }
]);

const CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS = ANGOLA_IRT_GROUP_A_BRACKETS_2026;
const CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS = ANGOLA_IRT_GROUP_A_REFERENCE_BRACKETS_2026;
const CURRENT_INSS_EMPLOYEE_RATE_PERCENT = 3;
const CURRENT_INSS_EMPLOYER_RATE_PERCENT = 8;

function cloneFiscalBrackets(brackets = CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS) {
  return (brackets || []).map((bracket) => ({ ...bracket }));
}

function getStatutoryFiscalProfiles() {
  return [
    {
      id: ANGOLA_IRT_2020_PROFILE_ID,
      name: ANGOLA_IRT_2020_PROFILE_NAME,
      effectiveFrom: ANGOLA_IRT_2020_EFFECTIVE_FROM,
      effectiveTo: ANGOLA_IRT_2020_EFFECTIVE_TO,
      legalReference: ANGOLA_IRT_2020_LEGAL_REFERENCE,
      notes: ANGOLA_IRT_2020_NOTES,
      inssEmployeeRate: CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
      inssEmployerRate: CURRENT_INSS_EMPLOYER_RATE_PERCENT,
      irtBrackets: cloneFiscalBrackets(ANGOLA_IRT_GROUP_A_BRACKETS_2020)
    },
    {
      id: ANGOLA_IRT_2026_PROFILE_ID,
      name: ANGOLA_IRT_2026_PROFILE_NAME,
      effectiveFrom: ANGOLA_IRT_2026_EFFECTIVE_FROM,
      effectiveTo: "",
      legalReference: ANGOLA_IRT_2026_LEGAL_REFERENCE,
      notes: ANGOLA_IRT_2026_NOTES,
      inssEmployeeRate: CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
      inssEmployerRate: CURRENT_INSS_EMPLOYER_RATE_PERCENT,
      irtBrackets: cloneFiscalBrackets(ANGOLA_IRT_GROUP_A_BRACKETS_2026)
    }
  ];
}

module.exports = {
  ANGOLA_IRT_2020_EFFECTIVE_FROM,
  ANGOLA_IRT_2020_EFFECTIVE_TO,
  ANGOLA_IRT_2020_LEGAL_REFERENCE,
  ANGOLA_IRT_2020_NOTES,
  ANGOLA_IRT_2020_PROFILE_ID,
  ANGOLA_IRT_2020_PROFILE_NAME,
  ANGOLA_IRT_2026_EFFECTIVE_FROM,
  ANGOLA_IRT_2026_LEGAL_REFERENCE,
  ANGOLA_IRT_2026_NOTES,
  ANGOLA_IRT_2026_PROFILE_ID,
  ANGOLA_IRT_2026_PROFILE_NAME,
  ANGOLA_IRT_GROUP_A_BRACKETS_2020,
  ANGOLA_IRT_GROUP_A_BRACKETS_2026,
  ANGOLA_IRT_GROUP_A_REFERENCE_BRACKETS_2020,
  ANGOLA_IRT_GROUP_A_REFERENCE_BRACKETS_2026,
  CURRENT_ANGOLA_FISCAL_EFFECTIVE_FROM,
  CURRENT_ANGOLA_FISCAL_PROFILE_ID,
  CURRENT_ANGOLA_FISCAL_PROFILE_LEGAL_REFERENCE,
  CURRENT_ANGOLA_FISCAL_PROFILE_NAME,
  CURRENT_ANGOLA_FISCAL_PROFILE_NOTES,
  CURRENT_ANGOLA_GROUP_A_REFERENCE_BRACKETS,
  CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS,
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  CURRENT_INSS_EMPLOYER_RATE_PERCENT,
  cloneFiscalBrackets,
  getStatutoryFiscalProfiles
};
