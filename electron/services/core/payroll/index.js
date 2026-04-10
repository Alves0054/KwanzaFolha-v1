const { PayrollService } = require("../../payroll");
const { calculateAttendanceDeductions, calculateDailySalaryRate } = require("./absenceCalculator");
const {
  calculateLegalDeductions,
  calculateSalary,
  mandatoryBonusAmount,
  monthlyRemunerationBase,
  overtimeAmount
} = require("./salaryEngine");

function createPayrollCore(database) {
  const payroll = new PayrollService(database);

  return {
    payroll,
    process: (monthRef) => payroll.processMonthlyPayroll(monthRef),
    getMonthlySummary: (monthRef) => payroll.getMonthlySummary(monthRef)
  };
}

module.exports = {
  PayrollService,
  calculateAttendanceDeductions,
  calculateDailySalaryRate,
  calculateLegalDeductions,
  calculateSalary,
  createPayrollCore,
  mandatoryBonusAmount,
  monthlyRemunerationBase,
  overtimeAmount
};
