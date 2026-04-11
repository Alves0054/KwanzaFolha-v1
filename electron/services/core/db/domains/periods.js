const ATTENDANCE_PERIODS_SELECT = `
  SELECT
    attendance_periods.*,
    closer.full_name AS closed_by_name,
    reopener.full_name AS reopened_by_name
  FROM attendance_periods
  LEFT JOIN users AS closer ON closer.id = attendance_periods.closed_by_user_id
  LEFT JOIN users AS reopener ON reopener.id = attendance_periods.reopened_by_user_id
`;

const PAYROLL_PERIODS_SELECT = `
  SELECT
    payroll_periods.*,
    closer.full_name AS closed_by_name,
    reopener.full_name AS reopened_by_name
  FROM payroll_periods
  LEFT JOIN users AS closer ON closer.id = payroll_periods.closed_by_user_id
  LEFT JOIN users AS reopener ON reopener.id = payroll_periods.reopened_by_user_id
`;

function buildDefaultAttendancePeriod(monthRef) {
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

module.exports = {
  ATTENDANCE_PERIODS_SELECT,
  PAYROLL_PERIODS_SELECT,
  buildDefaultAttendancePeriod
};

