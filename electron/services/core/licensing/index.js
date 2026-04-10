const { LicensingService } = require("../../licensing");

function createLicensingCore(service) {
  return {
    service,
    getStatus: (force = false) => service.getLicenseStatus(force),
    getGuardResult: () => service.getLicenseGuardResult(),
    getPlans: () => service.getPlans(),
    createPaymentReference: (payload) => service.createPaymentReference(payload),
    checkPaymentStatus: (reference) => service.checkPaymentStatus(reference),
    activateLicense: (payload) => service.activateLicense(payload),
    renewLicense: (payload) => service.renewLicense(payload),
    primeInstallation: () => service.primeInstallation(),
    validateInstallation: () => service.validateInstallation()
  };
}

module.exports = {
  LicensingService,
  createLicensingCore
};
