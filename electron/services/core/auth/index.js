function createAuthCore(database) {
  return {
    getState: () => database.getAuthState(),
    login: (credentials) => database.login(credentials),
    logout: () => database.clearSession(),
    restoreSession: () => database.restoreSession(),
    persistSession: (userId) => database.persistSession(userId),
    registerInitialAccount: (payload) => database.registerInitialAccount(payload),
    preparePasswordReset: (identifier) => database.preparePasswordReset(identifier),
    createPasswordResetRequest: (payload) => database.createPasswordResetRequest(payload),
    revokePasswordResetRequest: (payload) => database.revokePasswordResetRequest(payload),
    completePasswordReset: (payload) => database.completePasswordReset(payload),
    changePassword: (payload) => database.changePassword(payload),
    changeOwnPassword: (payload) => database.changeOwnPassword(payload),
    getAuthenticatedUser: () => database.getAuthenticatedUser()
  };
}

module.exports = {
  createAuthCore
};
