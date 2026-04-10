const angolaBanks = [
  { code: "ATLANTICO", exportCode: "ATL", registryCodes: ["0055", "0054"], name: "Banco Millennium Atlantico" },
  { code: "BAI", exportCode: "BAI", registryCodes: ["0040"], name: "Banco Angolano de Investimentos" },
  { code: "BFA", exportCode: "BFA", registryCodes: ["0006"], name: "Banco de Fomento Angola" },
  { code: "BIC", exportCode: "BIC", registryCodes: ["0051", "0005"], name: "Banco BIC" },
  { code: "BPC", exportCode: "BPC", registryCodes: [], name: "Banco de Poupanca e Credito" },
  { code: "SBA", exportCode: "SBA", registryCodes: ["0060"], name: "Standard Bank Angola" },
  { code: "BCI", exportCode: "BCI", registryCodes: [], name: "Banco de Comercio e Industria" },
  { code: "BNI", exportCode: "BNI", registryCodes: [], name: "Banco de Negocios Internacional" },
  { code: "BCA", exportCode: "BCA", registryCodes: [], name: "Banco Comercial Angolano" },
  { code: "BDA", exportCode: "BDA", registryCodes: [], name: "Banco de Desenvolvimento de Angola" },
  { code: "BIR", exportCode: "BIR", registryCodes: [], name: "Banco de Investimento Rural" },
  { code: "BKEVE", exportCode: "BKEVE", registryCodes: [], name: "Banco Keve" },
  { code: "BVALOR", exportCode: "BVALOR", registryCodes: [], name: "Banco Valor" },
  { code: "BSOL", exportCode: "BSOL", registryCodes: ["0044"], name: "Banco Sol" },
  { code: "BCS", exportCode: "BCS", registryCodes: [], name: "Banco de Credito do Sul" },
  { code: "BYETU", exportCode: "BYETU", registryCodes: [], name: "Banco Yetu" },
  { code: "ACCESS", exportCode: "ACCESS", registryCodes: [], name: "Access Bank Angola" },
  { code: "BCGA", exportCode: "BCGA", registryCodes: [], name: "Banco Caixa Geral Angola" },
  { code: "BCH", exportCode: "BCH", registryCodes: [], name: "Banco Comercial do Huambo" },
  { code: "BOC", exportCode: "BOC", registryCodes: [], name: "Banco da China - Sucursal em Luanda" }
];

function normalizeIban(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function extractAngolaBankRegistryCode(iban) {
  const normalized = normalizeIban(iban);
  return /^AO\d{23}$/.test(normalized) ? normalized.slice(4, 8) : "";
}

function inferBankFromIban(iban, banks = angolaBanks) {
  const registryCode = extractAngolaBankRegistryCode(iban);
  if (!registryCode) {
    return null;
  }

  return (
    banks.find((bank) => (bank.registryCodes || []).map((item) => String(item || "")).includes(registryCode)) || null
  );
}

module.exports = {
  angolaBanks,
  normalizeIban,
  extractAngolaBankRegistryCode,
  inferBankFromIban
};
