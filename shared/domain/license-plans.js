const LICENSE_PLANS = [
  {
    code: "starter",
    name: "Starter",
    price: 7500,
    currency: "Kz",
    billingCycle: "monthly",
    durationDays: 30,
    periodDays: 30,
    maxUsers: null,
    maxEmployees: 10,
    maxDevices: 1,
    features: [
      "Até 10 funcionários ativos",
      "Até 1 PC/dispositivo por licença",
      "Validade de 30 dias",
      "Renovação mensal"
    ]
  },
  {
    code: "basico",
    name: "Básico",
    price: 12500,
    currency: "Kz",
    billingCycle: "monthly",
    durationDays: 30,
    periodDays: 30,
    maxUsers: null,
    maxEmployees: 25,
    maxDevices: 2,
    features: [
      "Até 25 funcionários ativos",
      "Até 2 PCs/dispositivos por licença",
      "Validade de 30 dias",
      "Renovação mensal"
    ]
  },
  {
    code: "profissional",
    name: "Profissional",
    price: 15000,
    currency: "Kz",
    billingCycle: "monthly",
    durationDays: 30,
    periodDays: 30,
    maxUsers: null,
    maxEmployees: 50,
    maxDevices: 3,
    features: [
      "Até 50 funcionários ativos",
      "Até 3 PCs/dispositivos por licença",
      "Validade de 30 dias",
      "Renovação mensal"
    ]
  },
  {
    code: "empresa",
    name: "Empresa",
    price: 28000,
    currency: "Kz",
    billingCycle: "monthly",
    durationDays: 30,
    periodDays: 30,
    maxUsers: null,
    maxEmployees: 100,
    maxDevices: 4,
    features: [
      "Até 100 funcionários ativos",
      "Até 4 PCs/dispositivos por licença",
      "Validade de 30 dias",
      "Renovação mensal"
    ]
  },
  {
    code: "business",
    name: "Business",
    price: 48500,
    currency: "Kz",
    billingCycle: "monthly",
    durationDays: 30,
    periodDays: 30,
    maxUsers: null,
    maxEmployees: 200,
    maxDevices: 6,
    features: [
      "Até 200 funcionários ativos",
      "Até 6 PCs/dispositivos por licença",
      "Validade de 30 dias",
      "Renovação mensal"
    ]
  }
];

const DEFAULT_LICENSE_PLAN = LICENSE_PLANS.find((plan) => plan.code === "profissional") || LICENSE_PLANS[0];

module.exports = {
  LICENSE_PLANS,
  DEFAULT_LICENSE_PLAN
};

