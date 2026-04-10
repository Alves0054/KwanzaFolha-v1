function createSettingsCore(database) {
  return {
    getBootstrap: (currentUser) => database.getBootstrapData(currentUser),
    getCompanyProfile: () => database.getCompanyProfile(),
    saveCompanyProfile: (payload) => database.saveCompanyProfile(payload),
    getSystemSettings: (monthRef) => database.getSystemSettings(monthRef),
    saveSystemSettings: (payload) => database.saveSystemSettings(payload)
  };
}

module.exports = {
  createSettingsCore
};
