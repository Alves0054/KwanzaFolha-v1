function buildDefaultPayrollPeriod(monthRef) {
  return {
    month_ref: monthRef,
    status: "open",
    closed_at: null,
    closed_by_user_id: null,
    closed_by_name: null,
    reopened_at: null,
    reopened_by_user_id: null,
    reopened_by_name: null,
    updated_at: null
  };
}

function buildClosePayrollPeriodPayload(monthRef, userId, timestampFactory) {
  const now = timestampFactory();
  return {
    month_ref: monthRef,
    closed_at: now,
    closed_by_user_id: userId,
    updated_at: now
  };
}

function buildReopenPayrollPeriodPayload(monthRef, userId, timestampFactory) {
  const now = timestampFactory();
  return {
    month_ref: monthRef,
    reopened_at: now,
    reopened_by_user_id: userId,
    updated_at: now
  };
}

module.exports = {
  buildClosePayrollPeriodPayload,
  buildDefaultPayrollPeriod,
  buildReopenPayrollPeriodPayload
};

