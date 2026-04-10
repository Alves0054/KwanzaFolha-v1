const crypto = require("crypto");
const {
  CURRENT_ANGOLA_FISCAL_EFFECTIVE_FROM,
  CURRENT_ANGOLA_FISCAL_PROFILE_ID,
  CURRENT_ANGOLA_FISCAL_PROFILE_LEGAL_REFERENCE,
  CURRENT_ANGOLA_FISCAL_PROFILE_NAME,
  CURRENT_ANGOLA_FISCAL_PROFILE_NOTES,
  CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS,
  CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
  CURRENT_INSS_EMPLOYER_RATE_PERCENT
} = require("./core/fiscal");

const DEFAULT_FISCAL_PROFILE_ID = CURRENT_ANGOLA_FISCAL_PROFILE_ID;
const DEFAULT_FISCAL_PROFILE_NAME = CURRENT_ANGOLA_FISCAL_PROFILE_NAME;
const DEFAULT_FISCAL_EFFECTIVE_FROM = CURRENT_ANGOLA_FISCAL_EFFECTIVE_FROM;

function isValidMonthRef(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return false;
  }

  const [year, month] = normalized.split("-").map(Number);
  return year >= 1900 && month >= 1 && month <= 12;
}

function normalizeMonthRef(value, fallbackValue = "") {
  const normalized = String(value || "").trim();
  return isValidMonthRef(normalized) ? normalized : fallbackValue;
}

function getCurrentMonthRef() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeIrtBrackets(brackets = []) {
  return (Array.isArray(brackets) ? brackets : [])
    .map((bracket) => ({
      min: Number(bracket?.min || 0),
      max: bracket?.max === null || bracket?.max === undefined || bracket?.max === "" ? null : Number(bracket.max),
      rate: Number(bracket?.rate || 0),
      fixed: Number(bracket?.fixed || 0)
    }))
    .sort((left, right) => Number(left.min || 0) - Number(right.min || 0));
}

function buildFiscalProfileVersion(profile) {
  const payload = JSON.stringify({
    id: profile.id,
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    inssEmployeeRate: Number(profile.inssEmployeeRate || 0),
    inssEmployerRate: Number(profile.inssEmployerRate || 0),
    irtBrackets: normalizeIrtBrackets(profile.irtBrackets)
  });

  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

function buildFiscalProfile(payload = {}) {
  const baseProfile = {
    id: DEFAULT_FISCAL_PROFILE_ID,
    name: DEFAULT_FISCAL_PROFILE_NAME,
    effectiveFrom: DEFAULT_FISCAL_EFFECTIVE_FROM,
    effectiveTo: "",
    legalReference: CURRENT_ANGOLA_FISCAL_PROFILE_LEGAL_REFERENCE,
    notes: CURRENT_ANGOLA_FISCAL_PROFILE_NOTES,
    inssEmployeeRate: CURRENT_INSS_EMPLOYEE_RATE_PERCENT,
    inssEmployerRate: CURRENT_INSS_EMPLOYER_RATE_PERCENT,
    irtBrackets: CURRENT_ANGOLA_IRT_GROUP_A_BRACKETS
  };

  const profile = {
    ...baseProfile,
    ...payload,
    id: String(payload.id || baseProfile.id).trim() || baseProfile.id,
    name: String(payload.name || baseProfile.name).trim() || baseProfile.name,
    effectiveFrom: normalizeMonthRef(payload.effectiveFrom, baseProfile.effectiveFrom),
    effectiveTo: normalizeMonthRef(payload.effectiveTo, ""),
    legalReference: String(payload.legalReference ?? baseProfile.legalReference ?? "").trim(),
    notes: String(payload.notes ?? baseProfile.notes ?? "").trim(),
    inssEmployeeRate: Number(payload.inssEmployeeRate ?? baseProfile.inssEmployeeRate),
    inssEmployerRate: Number(payload.inssEmployerRate ?? baseProfile.inssEmployerRate),
    irtBrackets: normalizeIrtBrackets(payload.irtBrackets ?? baseProfile.irtBrackets)
  };

  return {
    ...profile,
    version: buildFiscalProfileVersion(profile)
  };
}

function buildDefaultFiscalProfile(payload = {}) {
  return buildFiscalProfile({
    id: DEFAULT_FISCAL_PROFILE_ID,
    name: DEFAULT_FISCAL_PROFILE_NAME,
    effectiveFrom: DEFAULT_FISCAL_EFFECTIVE_FROM,
    ...payload
  });
}

function deduplicateProfileIds(profiles) {
  const seen = new Set();
  return (profiles || []).map((profile, index) => {
    let nextId = String(profile.id || `fiscal-profile-${index + 1}`).trim() || `fiscal-profile-${index + 1}`;
    let suffix = 2;

    while (seen.has(nextId)) {
      nextId = `${profile.id || `fiscal-profile-${index + 1}`}-${suffix}`;
      suffix += 1;
    }

    seen.add(nextId);
    return buildFiscalProfile({ ...profile, id: nextId });
  });
}

function sortFiscalProfiles(profiles) {
  return [...(profiles || [])].sort((left, right) => {
    if (left.effectiveFrom !== right.effectiveFrom) {
      return String(left.effectiveFrom || "").localeCompare(String(right.effectiveFrom || ""), "pt");
    }
    if (left.effectiveTo !== right.effectiveTo) {
      return String(left.effectiveTo || "").localeCompare(String(right.effectiveTo || ""), "pt");
    }
    return String(left.id || "").localeCompare(String(right.id || ""), "pt");
  });
}

function normalizeFiscalProfiles(profiles, fallbackProfile = null) {
  const sourceProfiles =
    Array.isArray(profiles) && profiles.length
      ? profiles
      : [fallbackProfile || buildDefaultFiscalProfile()];

  return sortFiscalProfiles(
    deduplicateProfileIds(sourceProfiles.map((profile) => buildFiscalProfile(profile)))
  );
}

function resolveFiscalProfileFromProfiles(profiles, activeFiscalProfileId, monthRef) {
  const normalizedProfiles = normalizeFiscalProfiles(profiles);
  const normalizedMonthRef = normalizeMonthRef(monthRef, getCurrentMonthRef());
  const matchingProfiles = normalizedProfiles.filter(
    (profile) =>
      profile.effectiveFrom <= normalizedMonthRef &&
      (!profile.effectiveTo || profile.effectiveTo >= normalizedMonthRef)
  );

  if (matchingProfiles.length) {
    return matchingProfiles[matchingProfiles.length - 1];
  }

  return (
    normalizedProfiles.find((profile) => profile.id === String(activeFiscalProfileId || "").trim()) ||
    normalizedProfiles[normalizedProfiles.length - 1]
  );
}

function normalizeFiscalSettings(settings = {}, referenceMonthRef = getCurrentMonthRef()) {
  const fallbackProfile = buildDefaultFiscalProfile({
    id: settings.activeFiscalProfileId || DEFAULT_FISCAL_PROFILE_ID,
    name: settings.activeFiscalProfileName || DEFAULT_FISCAL_PROFILE_NAME,
    inssEmployeeRate: settings.inssEmployeeRate,
    inssEmployerRate: settings.inssEmployerRate,
    irtBrackets: settings.irtBrackets
  });

  const fiscalProfiles = normalizeFiscalProfiles(settings.fiscalProfiles, fallbackProfile);
  const selectedProfile =
    fiscalProfiles.find((profile) => profile.id === String(settings.activeFiscalProfileId || "").trim()) ||
    fiscalProfiles[fiscalProfiles.length - 1];
  const activeProfileForMonth = resolveFiscalProfileFromProfiles(
    fiscalProfiles,
    selectedProfile.id,
    referenceMonthRef
  );

  return {
    fiscalProfiles,
    activeFiscalProfileId: selectedProfile.id,
    selectedProfile,
    activeProfileForMonth
  };
}

function resolveFiscalProfileForMonth(settings = {}, monthRef = getCurrentMonthRef()) {
  const normalized = normalizeFiscalSettings(settings, monthRef);
  return normalized.activeProfileForMonth;
}

function summarizeFiscalProfile(profile = {}) {
  return {
    id: String(profile.id || "").trim(),
    name: String(profile.name || "").trim(),
    effectiveFrom: String(profile.effectiveFrom || "").trim(),
    effectiveTo: String(profile.effectiveTo || "").trim(),
    legalReference: String(profile.legalReference || "").trim(),
    version: String(profile.version || "").trim()
  };
}

function getPayrollRunFiscalVersion(summary = {}) {
  return String(summary?.fiscalProfileVersion || summary?.fiscalProfile?.version || "").trim();
}

function getPayrollRunFiscalProfileId(summary = {}) {
  return String(summary?.fiscalProfile?.id || "").trim();
}

function isPayrollRunUsingCurrentFiscalProfile(runSummary = {}, profile = {}) {
  const currentVersion = String(profile?.version || "").trim();
  const currentProfileId = String(profile?.id || "").trim();
  return (
    getPayrollRunFiscalVersion(runSummary) === currentVersion &&
    getPayrollRunFiscalProfileId(runSummary) === currentProfileId
  );
}

module.exports = {
  DEFAULT_FISCAL_EFFECTIVE_FROM,
  DEFAULT_FISCAL_PROFILE_ID,
  DEFAULT_FISCAL_PROFILE_NAME,
  buildDefaultFiscalProfile,
  buildFiscalProfile,
  buildFiscalProfileVersion,
  getCurrentMonthRef,
  getPayrollRunFiscalProfileId,
  getPayrollRunFiscalVersion,
  isPayrollRunUsingCurrentFiscalProfile,
  isValidMonthRef,
  normalizeFiscalProfiles,
  normalizeFiscalSettings,
  normalizeIrtBrackets,
  normalizeMonthRef,
  resolveFiscalProfileForMonth,
  summarizeFiscalProfile
};
