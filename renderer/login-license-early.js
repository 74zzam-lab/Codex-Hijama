/* global document, window, setTimeout */
(function loginLicenseEarlyBoot() {
  'use strict';

  function licStatusLooksPending(text) {
    return /جار[ٍي]?\s*التحقق/.test(String(text || ''));
  }

  function finalizeLicCheckUi(reason) {
    var el = document.getElementById('login-license-status');
    if (!el || !licStatusLooksPending(el.textContent)) return;
    if (window._licStatus === 'valid') {
      el.textContent = '✓ الترخيص صالح';
      el.style.color = '#5dde8a';
      return;
    }
    if (window._licStatus !== 'expired' && window._licStatus !== 'blocked') {
      window._licStatus = 'none';
      window._licBlocked = false;
    }
    el.textContent = reason || '⛔ تعذّر إكمال التحقق بسرعة — الدخول للموظفين فقط (قراءة)';
    el.style.color = '#ffa05a';
    try { window._licApplyLoginRestrictions?.(); } catch { /* empty */ }
    try { window.licUpdateLoginDevNotice?.(); } catch { /* empty */ }
    try { window.licUpdateLoginDriveBootstrapPanel?.(); } catch { /* empty */ }
  }

  function earlyClearLoginLicensePending(reason) {
    finalizeLicCheckUi(reason);
  }

  var login = document.getElementById('loginScreen');
  var license = document.getElementById('licenseScreen');
  var shell = document.getElementById('app-shell');
  if (license) { license.classList.add('hidden'); license.style.display = ''; }
  if (login) login.classList.remove('hidden');
  if (shell) shell.classList.add('app-shell--locked');
  document.body.classList.add('app-locked');

  [0, 4500, 9000, 15000].forEach(function (ms) {
    setTimeout(function () {
      try { earlyClearLoginLicensePending(); } catch { /* empty */ }
    }, ms);
  });

  window.finalizeLicCheckUi = finalizeLicCheckUi;
  window.licCheck = function licCheckEarlyStub(options) {
    if (typeof window.__realLicCheck === 'function') {
      return window.__realLicCheck(options);
    }
    options = options || {};
    if (options.silent !== true) {
      var statusEl = document.getElementById('login-license-status');
      if (statusEl) statusEl.textContent = 'جارٍ التحقق من الترخيص...';
    }
    return Promise.resolve(false);
  };
  window.__loginLicenseEarlyBooted = true;
})();
