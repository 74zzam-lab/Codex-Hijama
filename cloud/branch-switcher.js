/**
 * Branch Switcher — topbar selector for multi-branch admin/accountant (Cloud V2).
 * V2-5.10: confirmed work-branch switch + BranchContexts operational write branch.
 */
(function (global) {
  'use strict';

  const ALL_BRANCHES_VALUE = '__ALL__';
  let _pendingBranch = null;
  let _confirmOpen = false;

  function getBranches() {
    const doc = global.LicenseCloud?.loadLocal?.();
    if (doc?.branches?.length) return doc.branches.filter(b => b && b.active !== false);
    return [{ id: 'BR-MAIN', name: 'الفرع الرئيسي', active: true }];
  }

  function shouldShow() {
    if (!global.CloudMeta?.isCloudV2Enabled?.()) return false;
    if (!global.currentUser) return false;
    if (!global.BranchScope?.canUserSwitchBranch?.(global.currentUser)) return false;
    return getBranches().length > 1;
  }

  function branchName(bid) {
    return getBranches().find(b => b.id === bid)?.name || bid;
  }

  function refreshSurfaces() {
    if (typeof global.reloadClientStoreFromDb === 'function') global.reloadClientStoreFromDb();
    if (typeof global.refreshCaseDerivedViews === 'function') global.refreshCaseDerivedViews();
    if (typeof global.refreshDashboard === 'function') global.refreshDashboard();
    if (typeof global.refreshDailyTable === 'function') global.refreshDailyTable();
    if (typeof global.refreshBookingsTable === 'function') global.refreshBookingsTable();
    if (typeof global.refreshClientsView === 'function') global.refreshClientsView(false);
    if (typeof global.refreshInvoicesPage === 'function') global.refreshInvoicesPage(false);
    if (typeof global.refreshDashboardAlerts === 'function') global.refreshDashboardAlerts();
    if (typeof global.refreshDoctorsTable === 'function') global.refreshDoctorsTable();
    if (typeof global.refreshUsersTable === 'function') global.refreshUsersTable();
    if (typeof global.renderReportsPage === 'function') global.renderReportsPage();
    if (typeof global.renderOwnerHubPage === 'function') global.renderOwnerHubPage();
    if (typeof global.showPage === 'function') {
      try {
        const active = document.querySelector('.page.active')?.id;
        if (active) global.showPage(active.replace('Page', ''));
      } catch { /* empty */ }
    }
    if (typeof global.BranchSwitcher?.populate === 'function') global.BranchSwitcher.populate();
  }

  async function applyBranchSwitch(bid) {
    try { sessionStorage.setItem('__tdw_branch_drawer_pref__', bid); } catch { /* empty */ }
    if (bid === ALL_BRANCHES_VALUE) {
      try { global.OwnerBranchMode?.exitToOwnerMode?.(); } catch { /* empty */ }
      const cleared = global.BranchContexts?.clearOperationalWriteBranch?.();
      const clearedInMain = await cleared?.mainCommit;
      if (clearedInMain?.ok === false) {
        global.notify?.('تعذر تثبيت وضع القراءة الآمن في العملية الرئيسية', 'danger');
        return { ok: false, error: clearedInMain.error || 'main_write_context_clear_failed' };
      }
      global.BranchScope?.setActiveBranchId?.('*');
      global.notify?.('🌐 عرض كل الفروع (تجميعي) — وضع قراءة للعمليات', 'info');
    } else {
      const selected = global.BranchContexts?.setOperationalWriteBranch?.(bid, { bindDevice: false });
      const selectedInMain = await selected?.mainCommit;
      if (selectedInMain?.ok === false) {
        global.notify?.('تعذر تثبيت فرع الكتابة في العملية الرئيسية', 'danger');
        return { ok: false, error: selectedInMain.error || 'main_write_context_failed' };
      }
      global.BranchScope?.setActiveBranchId?.(bid);
      try {
        if (global.RolePolicy?.isOrganizationOwner?.(global.currentUser)
          || String(global.currentUser?.role || '').toLowerCase() === 'owner') {
          global.OwnerBranchMode?.enterBranchMode?.(bid);
        }
      } catch { /* empty */ }
      global.notify?.('🌿 تم التبديل إلى: ' + branchName(bid), 'info');
    }
    if (global.SqliteBridge?.hydrateIntoMemory) {
      const hydrated = await global.SqliteBridge.hydrateIntoMemory();
      if (hydrated?.ok === false) {
        global.notify?.('تعذر تحميل بيانات الفرع المعتمدة من SQLite', 'danger');
        return hydrated;
      }
    }
    refreshSurfaces();
    if (bid !== ALL_BRANCHES_VALUE && global.DriveAdapter?.isConnected?.()) {
      try {
        const pulled = await global.CloudBootstrap?.hydrateFromDrive?.(bid, {
          markComplete: false,
          allowMissingLicense: true,
          skipAnalysis: true,
          force: true
        });
        if (pulled?.ok !== true) {
          global.notify?.('⚠️ تم تبديل الفرع، لكن تعذر سحب آخر بياناته: ' + (pulled?.error || pulled?.reason || 'pull_failed'), 'warning');
        }
      } catch (error) {
        global.notify?.('⚠️ تم تبديل الفرع، لكن تعذر سحب آخر بياناته: ' + (error?.message || 'pull_failed'), 'warning');
      }
      refreshSurfaces();
    }
    if (typeof global.applyBranchViewModeUi === 'function') global.applyBranchViewModeUi();
  }

  function confirmSwitch(bid, sel) {
    if (_confirmOpen) return;
    const from = global.BranchContexts?.getOperationalWriteBranch?.()
      || global.BranchScope?.getActiveBranchId?.()
      || 'BR-MAIN';
    if (bid === from || bid === ALL_BRANCHES_VALUE && from === '*') {
      applyBranchSwitch(bid);
      return;
    }
    const msg = bid === ALL_BRANCHES_VALUE
      ? 'التبديل إلى عرض كل الفروع؟ العمليات التشغيلية للقراءة فقط.'
      : `تأكيد العمل على فرع «${branchName(bid)}» (${bid})؟ سيتم تحديث القوائم والحفظ لهذا الفرع.`;
  _pendingBranch = bid;
    _confirmOpen = true;
    if (typeof global.confirmAsync === 'function') {
      global.confirmAsync(msg, { title: 'تبديل فرع العمل' }).then((ok) => {
        _confirmOpen = false;
        if (ok) applyBranchSwitch(bid);
        else if (sel) sel.value = from === '*' ? ALL_BRANCHES_VALUE : from;
        _pendingBranch = null;
      });
      return;
    }
    if (global.confirm(msg)) {
      _confirmOpen = false;
      applyBranchSwitch(bid);
    } else if (sel) {
      sel.value = from === '*' ? ALL_BRANCHES_VALUE : from;
    }
    _pendingBranch = null;
    _confirmOpen = false;
  }

  function ensureDOM() {
    if (document.getElementById('topbar-branch-switcher')) return;
    const actions = document.querySelector('.topbar-actions');
    if (!actions) return;
    const wrap = document.createElement('div');
    wrap.id = 'topbar-branch-switch-wrap';
    wrap.style.cssText = 'display:none;align-items:center;gap:6px';
    wrap.innerHTML = `
      <label for="topbar-branch-switcher" style="font-size:11px;font-weight:700;color:var(--text-muted);white-space:nowrap">🌿 الفرع</label>
      <select id="topbar-branch-switcher" class="form-control" style="min-width:130px;max-width:180px;padding:6px 10px;font-size:12px;font-weight:700;height:34px"></select>`;
    actions.insertBefore(wrap, actions.firstChild);
    const sel = wrap.querySelector('#topbar-branch-switcher');
    if (sel) {
      sel.addEventListener('change', () => {
        const bid = sel.value;
        if (!bid) return;
        if (!global.BranchScope?.userCanAccessBranch?.(global.currentUser, bid)
          && bid !== ALL_BRANCHES_VALUE) {
          global.notify?.('⛔ لا يمكنك الوصول لهذا الفرع', 'danger');
          sel.value = global.BranchScope?.getActiveBranchId?.() || bid;
          return;
        }
        confirmSwitch(bid, sel);
      });
    }
  }

  function populate() {
    const sel = document.getElementById('topbar-branch-switcher');
    if (!sel) return;
    const branches = getBranches();
    const scope = global.BranchScope?.getUserBranchScope?.(global.currentUser) || [];
    const canAll = scope.includes('*')
      || global.RolePolicy?.isOrganizationOwner?.(global.currentUser)
      || String(global.currentUser?.role || '').toLowerCase() === 'owner';
    const visible = scope.includes('*') ? branches : branches.filter(b => scope.includes(b.id));
    let active = global.BranchContexts?.getOperationalWriteBranch?.()
      || global.BranchScope?.getActiveBranchId?.()
      || branches[0]?.id;
    try {
      const pref = sessionStorage.getItem('__tdw_branch_drawer_pref__');
      if (pref) active = pref;
    } catch { /* empty */ }
    const opts = [];
    if (canAll) {
      opts.push(`<option value="${ALL_BRANCHES_VALUE}">🌐 كل الفروع (All Branches)</option>`);
    }
    visible.forEach((b) => {
      opts.push(`<option value="${String(b.id).replace(/"/g, '&quot;')}">${b.name || b.id}</option>`);
    });
    sel.innerHTML = opts.join('');
    if (active && [...sel.options].some((o) => o.value === active)) sel.value = active;
    else if (canAll && active === ALL_BRANCHES_VALUE) sel.value = ALL_BRANCHES_VALUE;
  }

  function applyVisibility() {
    ensureDOM();
    const wrap = document.getElementById('topbar-branch-switch-wrap');
    if (!wrap) return;
    const show = shouldShow();
    wrap.style.display = show ? 'flex' : 'none';
    if (show) populate();
  }

  global.BranchSwitcher = {
    shouldShow,
    applyVisibility,
    populate,
    applyBranchSwitch,
    ALL_BRANCHES_VALUE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
