const LICENSE_PLANS = [
  {
    code: "kwanzafolha-mensal",
    name: "KwanzaFolha Mensal",
    price: 15000,
    currency: "Kz",
    maxUsers: null,
    periodDays: 30,
    features: [
      "Acesso completo ao sistema",
      "Multiplos utilizadores dentro da empresa",
      "Validade de 30 dias",
      "Renovacao mensal"
    ]
  }
];

const DEFAULT_LICENSE_PLAN = LICENSE_PLANS[0];

module.exports = {
  LICENSE_PLANS,
  DEFAULT_LICENSE_PLAN
};
