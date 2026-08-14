(function (global) {
  'use strict';

  // SHA-256 of the complete canonical legacy license document, including its
  // historical signature. This permits a controlled read-only migration
  // without shipping the legacy signing key to customers.
  const CL = global.CommercialLicense || {};
  CL.legacyLicenseAllowlist = Object.freeze([
    '5fe23e4b0266d6e152742de13dd1d10ed4c883e25add3140b9e08da2a68adf5a',
  ]);
  global.CommercialLicense = CL;
})(typeof window !== 'undefined' ? window : global);
