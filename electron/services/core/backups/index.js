function createBackupsCore(database) {
  return {
    list: () => database.listBackups(),
    create: (label) => database.createBackup(label),
    restore: (backupPath) => database.restoreBackup(backupPath)
  };
}

module.exports = {
  createBackupsCore
};
