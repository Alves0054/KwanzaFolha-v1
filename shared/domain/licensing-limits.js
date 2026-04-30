function normalizePositiveInt(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.floor(numberValue));
}

function resolvePlanLimits(plan = {}) {
  return {
    maxEmployees: normalizePositiveInt(plan.maxEmployees),
    maxDevices: normalizePositiveInt(plan.maxDevices)
  };
}

function canActivateDevice({ existingDeviceHashes = [], deviceHash = "", maxDevices = 0 } = {}) {
  const normalizedHash = String(deviceHash || "").trim();
  if (!normalizedHash) {
    return { ok: false, reason: "missing_device_hash" };
  }

  const normalizedExisting = Array.from(
    new Set(existingDeviceHashes.map((item) => String(item || "").trim()).filter(Boolean))
  );

  if (normalizedExisting.includes(normalizedHash)) {
    return { ok: true, allowed: true, alreadyRegistered: true, totalDevices: normalizedExisting.length };
  }

  const limit = normalizePositiveInt(maxDevices);
  if (limit > 0 && normalizedExisting.length >= limit) {
    return { ok: false, allowed: false, reason: "device_limit_reached", totalDevices: normalizedExisting.length, maxDevices: limit };
  }

  return { ok: true, allowed: true, alreadyRegistered: false, totalDevices: normalizedExisting.length + 1 };
}

function enforceEmployeeLimit({ existingActiveEmployees = 0, maxEmployees = 0 } = {}) {
  const limit = normalizePositiveInt(maxEmployees);
  const current = normalizePositiveInt(existingActiveEmployees);
  if (limit > 0 && current >= limit) {
    return { ok: false, reason: "employee_limit_reached", maxEmployees: limit, currentActiveEmployees: current };
  }
  return { ok: true, maxEmployees: limit, currentActiveEmployees: current };
}

module.exports = {
  normalizePositiveInt,
  resolvePlanLimits,
  canActivateDevice,
  enforceEmployeeLimit
};

