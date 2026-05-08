const MONTHLY_PERIOD_DAYS = 30;
const ANNUAL_PERIOD_DAYS = 365;

function buildBillingOptions(monthlyPrice) {
  const normalizedMonthlyPrice = Number(monthlyPrice || 0);
  const annualPrice = normalizedMonthlyPrice * 12;

  return [
    {
      code: "monthly",
      name: "Mensal",
      label: "Pagamento mensal",
      price: normalizedMonthlyPrice,
      durationDays: MONTHLY_PERIOD_DAYS,
      periodDays: MONTHLY_PERIOD_DAYS,
      renewalLabel: "Renovação mensal"
    },
    {
      code: "annual",
      name: "Anual",
      label: "Pagamento anual",
      price: annualPrice,
      durationDays: ANNUAL_PERIOD_DAYS,
      periodDays: ANNUAL_PERIOD_DAYS,
      renewalLabel: "Renovação anual"
    }
  ];
}

function createPlan({ code, name, price, maxEmployees, maxDevices }) {
  const billingOptions = buildBillingOptions(price);

  return {
    code,
    name,
    price,
    monthlyPrice: price,
    annualPrice: price * 12,
    currency: "Kz",
    billingCycle: "monthly",
    durationDays: MONTHLY_PERIOD_DAYS,
    periodDays: MONTHLY_PERIOD_DAYS,
    maxUsers: null,
    maxEmployees,
    maxDevices,
    billingOptions,
    features: [
      `Até ${maxEmployees} funcionários ativos`,
      `Até ${maxDevices} ${maxDevices === 1 ? "PC/dispositivo" : "PCs/dispositivos"} por licença`,
      "Pagamento mensal ou anual",
      "Funcionamento offline durante a validade da licença"
    ]
  };
}

const LICENSE_PLANS = [
  createPlan({ code: "starter", name: "Starter", price: 7500, maxEmployees: 10, maxDevices: 1 }),
  createPlan({ code: "basico", name: "Básico", price: 12500, maxEmployees: 25, maxDevices: 2 }),
  createPlan({ code: "profissional", name: "Profissional", price: 15000, maxEmployees: 50, maxDevices: 3 }),
  createPlan({ code: "empresa", name: "Empresa", price: 28000, maxEmployees: 100, maxDevices: 4 }),
  createPlan({ code: "business", name: "Business", price: 48500, maxEmployees: 200, maxDevices: 6 })
];

const DEFAULT_LICENSE_PLAN = LICENSE_PLANS.find((plan) => plan.code === "profissional") || LICENSE_PLANS[0];

function normalizeBillingCycle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "annual" || normalized === "anual" ? "annual" : "monthly";
}

function resolvePlanBilling(plan, billingCycle = "monthly") {
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  const options = Array.isArray(plan?.billingOptions) ? plan.billingOptions : buildBillingOptions(plan?.price);
  return options.find((option) => option.code === normalizedCycle) || options[0];
}

module.exports = {
  ANNUAL_PERIOD_DAYS,
  DEFAULT_LICENSE_PLAN,
  LICENSE_PLANS,
  MONTHLY_PERIOD_DAYS,
  normalizeBillingCycle,
  resolvePlanBilling
};
