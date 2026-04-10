function createReportsCore(database, pdfService, payrollService) {
  return {
    getMonthlySummary: (monthRef) => payrollService.getMonthlySummary(monthRef),
    generatePayslip: (payrollRunId) => pdfService.generatePayslip(payrollRunId),
    generatePayslipsByMonth: (monthRef) => pdfService.generatePayslipsByMonth(monthRef),
    exportMonthlyPackage: (monthRef) => pdfService.exportMonthlyPackage(monthRef),
    generateReport: (payload) => pdfService.generateReport(payload),
    exportMonthlyPayrollExcel: (monthRef) => database.exportMonthlyPayrollExcel(monthRef),
    exportAgtMonthlyRemunerationExcel: (monthRef) => database.exportAgtMonthlyRemunerationExcel(monthRef),
    exportStatePaymentsExcel: (monthRef) => database.exportStatePaymentsExcel(monthRef),
    exportAttendanceExcel: (monthRef, reportType) => database.exportAttendanceExcel(monthRef, reportType),
    exportShiftMapExcel: (monthRef, reportType) => database.exportShiftMapExcel(monthRef, reportType),
    exportBankPayrollCsv: (bank, monthRef) => database.exportBankPayrollCsv(bank, monthRef),
    exportBankPayrollFile: (bank, monthRef, format) => database.exportBankPayrollFile(bank, monthRef, format)
  };
}

module.exports = {
  createReportsCore
};
