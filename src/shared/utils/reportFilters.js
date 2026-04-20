function normalizeMonthDate(monthRef) {
  const normalized = String(monthRef || "").trim();
  return /^\d{4}-\d{2}$/.test(normalized) ? `${normalized}-01` : new Date().toISOString().slice(0, 10);
}

function buildMonthDateRange(monthRef) {
  const normalized = String(monthRef || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    const today = new Date().toISOString().slice(0, 10);
    return { startDate: today, endDate: today };
  }
  const [year, month] = normalized.split("-").map(Number);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function buildInitialReportFilters(monthRef) {
  return {
    ...buildMonthDateRange(monthRef),
    employeeId: "",
    preset: "month"
  };
}

function buildFilterState(monthRef, extras = {}) {
  return {
    ...buildInitialReportFilters(monthRef),
    ...extras
  };
}

function shiftDate(dateValue, offsetDays = 0) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function applyReportPreset(preset, monthRef) {
  const monthRange = buildMonthDateRange(monthRef);
  const today = new Date().toISOString().slice(0, 10);
  switch (preset) {
    case "week":
      return { startDate: shiftDate(today, -6), endDate: today };
    case "year":
      return { startDate: `${today.slice(0, 4)}-01-01`, endDate: `${today.slice(0, 4)}-12-31` };
    case "all":
      return { startDate: "1900-01-01", endDate: "2100-12-31" };
    case "month":
    default:
      return monthRange;
  }
}

function buildReportRequestFilters(reportFilters = {}, monthRef = "") {
  const fallbackRange = buildMonthDateRange(monthRef);
  let startDate = reportFilters.startDate || fallbackRange.startDate;
  let endDate = reportFilters.endDate || fallbackRange.endDate;
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }
  const startMonthRef = String(startDate || "").slice(0, 7);
  const endMonthRef = String(endDate || "").slice(0, 7);
  return {
    monthRef: startMonthRef && startMonthRef === endMonthRef ? startMonthRef : "",
    startDate,
    endDate,
    employeeId: reportFilters.employeeId || ""
  };
}

function matchesMonthRange(monthRef, filters = {}) {
  const normalized = String(monthRef || "").trim();
  const startMonthRef = String(filters.startDate || "").slice(0, 7);
  const endMonthRef = String(filters.endDate || "").slice(0, 7);
  if (!startMonthRef || !endMonthRef) {
    return normalized === filters.monthRef;
  }
  return normalized >= startMonthRef && normalized <= endMonthRef;
}

function matchesDateRange(dateValue, filters = {}) {
  const normalized = String(dateValue || "").slice(0, 10);
  if (!filters.startDate || !filters.endDate) {
    return true;
  }
  return normalized >= filters.startDate && normalized <= filters.endDate;
}

export {
  normalizeMonthDate,
  buildMonthDateRange,
  buildInitialReportFilters,
  buildFilterState,
  applyReportPreset,
  buildReportRequestFilters,
  matchesMonthRange,
  matchesDateRange
};
