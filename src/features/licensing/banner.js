function resolveLicenseTargetDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T23:59:59.999Z`);
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRemainingTime(targetValue, nowValue = Date.now()) {
  const targetDate = resolveLicenseTargetDate(targetValue);
  if (!targetDate) {
    return "";
  }

  const remainingMs = targetDate.getTime() - Number(nowValue || Date.now());
  if (remainingMs <= 0) {
    return "menos de 1 minuto";
  }

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 2) {
    return `${days} dia(s)`;
  }
  if (days === 1) {
    return hours > 0 ? `1 dia e ${hours} hora(s)` : "1 dia";
  }
  if (hours >= 1) {
    return minutes > 0 ? `${hours} hora(s) e ${minutes} minuto(s)` : `${hours} hora(s)`;
  }
  return `${minutes} minuto(s)`;
}

export function buildLicenseBannerState(license, nowValue = Date.now()) {
  if (!license?.canUseApp) {
    return null;
  }

  if (license.status === "developer_active") {
    return {
      tone: "info",
      message: `Licença técnica de desenvolvimento ativa até ${license.expireDate || "-"}.`
    };
  }

  if (license.status === "trial_active") {
    return {
      tone: "warning",
      message: `Período gratuito ativo. Restam ${formatRemainingTime(license.trialExpireAt, nowValue)}.`
    };
  }

  if (license.status === "active") {
    return {
      tone: "success",
      message: `Licença ativa até ${license.expireDate || "-"}.`
    };
  }

  if (license.status === "expired" || license.status === "trial_expired") {
    return {
      tone: "danger",
      message: license.message || "Licença expirada."
    };
  }

  return null;
}
