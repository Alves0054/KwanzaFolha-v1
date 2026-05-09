module.exports = {
  apiBaseUrl: "https://license.alvesestudio.ao",
  requestTimeoutMs: 15000,
  productCode: "KWANZAFOLHA",
  localLicenseFile: "license.json",
  fingerprintPepper: "",
  // Builds unsigned devem arrancar o trial de 15 dias. Ative como true apenas
  // quando o instalador oficial estiver assinado e o bloqueio estrito for desejado.
  requireSignedExecutable: false,
  expectedSignerThumbprint: "E2DD19624522D4F4FAB08207C8709030E4FF70CD",
  expectedSignerThumbprints: [
    "E2DD19624522D4F4FAB08207C8709030E4FF70CD",
    "E894DF0A0DD300FCC80DCE5C696FD10E0E455859",
    "4A0C48787CA403C12B8F95C3ACA44F6B55044DB5"
  ]
};
