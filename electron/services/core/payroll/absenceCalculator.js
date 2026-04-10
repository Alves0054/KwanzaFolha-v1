const { roundCurrency } = require("../fiscal/utils");

const MONTHLY_ABSENCE_DIVISOR = 30;

function calculateDailySalaryRate(baseSalary, divisor = MONTHLY_ABSENCE_DIVISOR) {
  return roundCurrency(Number(baseSalary || 0) / Number(divisor || MONTHLY_ABSENCE_DIVISOR));
}

function calculateAttendanceDeductions(baseSalary, absencesDays, leaveDays) {
  const attendanceBaseSalary = roundCurrency(Number(baseSalary || 0));
  const dailyRate = calculateDailySalaryRate(attendanceBaseSalary, MONTHLY_ABSENCE_DIVISOR);
  const absenceDeduction = roundCurrency(dailyRate * Number(absencesDays || 0));
  const leaveDeduction = roundCurrency(dailyRate * Number(leaveDays || 0));

  return {
    attendanceBaseSalary,
    dailyRate,
    absenceDeduction,
    leaveDeduction,
    attendanceDeduction: roundCurrency(absenceDeduction + leaveDeduction)
  };
}

module.exports = {
  MONTHLY_ABSENCE_DIVISOR,
  calculateAttendanceDeductions,
  calculateDailySalaryRate
};
