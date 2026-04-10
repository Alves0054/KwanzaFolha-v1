function createAttendanceCore(database) {
  return {
    list: (filters) => database.listAttendanceRecords(filters),
    listImports: (filters) => database.listAttendanceImportBatches(filters),
    listImportLogs: (filters) => database.listAttendanceImportLogs(filters),
    save: (payload) => database.saveAttendanceRecord(payload),
    remove: (attendanceId) => database.deleteAttendanceRecord(attendanceId),
    importFile: (payload) => database.importAttendanceFile(payload),
    syncFolder: (payload) => database.syncAttendanceWatchedFolder(payload),
    approveAdjustments: (payload) => database.approveAttendanceAdjustments(payload),
    closePeriod: (monthRef, userId) => database.closeAttendancePeriod(monthRef, userId),
    reopenPeriod: (monthRef, userId) => database.reopenAttendancePeriod(monthRef, userId)
  };
}

module.exports = {
  createAttendanceCore
};
