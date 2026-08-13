/**
 * V2-5.8 — Shared Owner create/confirm form (mandatory password).
 * Never logs password values.
 */
(function (global) {
  'use strict';

  const MIN_PASSWORD_LENGTH = 8;

  function validatePasswordPair(password, confirm) {
    const p = String(password || '');
    const c = String(confirm == null ? password : confirm);
    if (!p) return { ok: false, error: 'password_required', code: 'owner_password_required' };
    if (p.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: 'password_too_short', code: 'owner_password_weak', min: MIN_PASSWORD_LENGTH };
    }
    if (c !== p) return { ok: false, error: 'password_mismatch', code: 'owner_password_mismatch' };
    return { ok: true };
  }

  function validateCreateInput(input) {
    input = input || {};
    const fullName = String(input.fullName || input.name || '').trim();
    const email = String(input.email || '').trim();
    const username = String(input.username || email.split('@')[0] || '').trim().toLowerCase();
    const recoveryCode = String(input.recoveryCode || input.recoveryPin || '').trim();
    const orgAccepted = input.acceptOrganization === true || input.acceptOrganization === 'true' || input.acceptOrganization === 1;

    if (!fullName) return { ok: false, error: 'name_required' };
    if (!email || !/@/.test(email)) return { ok: false, error: 'email_required' };
    if (!username) return { ok: false, error: 'username_required' };
    if (!recoveryCode) return { ok: false, error: 'recovery_required' };
    if (!orgAccepted) return { ok: false, error: 'org_accept_required' };

    const pw = validatePasswordPair(input.password, input.passwordConfirm);
    if (!pw.ok) return pw;

    return {
      ok: true,
      value: {
        fullName,
        email,
        username,
        password: String(input.password),
        recoveryCode,
        acceptOrganization: true
      }
    };
  }

  function renderFormHtml(opts) {
    opts = opts || {};
    const idPrefix = opts.idPrefix || 'ocf';
    return `
<form id="${idPrefix}-form" class="tdw-form ocf-form" autocomplete="off" novalidate>
  <div class="form-group">
    <label for="${idPrefix}-name">الاسم الكامل</label>
    <input type="text" id="${idPrefix}-name" class="form-control" required autocomplete="name">
    <div class="tdw-field-error" id="${idPrefix}-name-err" hidden></div>
  </div>
  <div class="form-group">
    <label for="${idPrefix}-email">البريد الإلكتروني</label>
    <input type="email" id="${idPrefix}-email" class="form-control" required autocomplete="email" dir="ltr">
    <div class="tdw-field-error" id="${idPrefix}-email-err" hidden></div>
  </div>
  <div class="form-group">
    <label for="${idPrefix}-username">اسم المستخدم</label>
    <input type="text" id="${idPrefix}-username" class="form-control" required autocomplete="username" dir="ltr">
    <div class="tdw-field-error" id="${idPrefix}-username-err" hidden></div>
  </div>
  <div class="form-group">
    <label for="${idPrefix}-password">كلمة المرور (إلزامية — ${MIN_PASSWORD_LENGTH}+)</label>
    <div class="tdw-password-row">
      <input type="password" id="${idPrefix}-password" class="form-control" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password">
      <button type="button" class="btn btn-ghost btn-sm tdw-toggle-pw" data-target="${idPrefix}-password" aria-label="إظهار كلمة المرور">إظهار</button>
    </div>
    <div class="tdw-field-error" id="${idPrefix}-password-err" hidden></div>
  </div>
  <div class="form-group">
    <label for="${idPrefix}-confirm">تأكيد كلمة المرور</label>
    <div class="tdw-password-row">
      <input type="password" id="${idPrefix}-confirm" class="form-control" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password">
      <button type="button" class="btn btn-ghost btn-sm tdw-toggle-pw" data-target="${idPrefix}-confirm" aria-label="إظهار التأكيد">إظهار</button>
    </div>
    <div class="tdw-field-error" id="${idPrefix}-confirm-err" hidden></div>
  </div>
  <div class="form-group">
    <label for="${idPrefix}-recovery">وسيلة الاسترداد (رمز / PIN)</label>
    <input type="text" id="${idPrefix}-recovery" class="form-control" required autocomplete="off" dir="ltr">
    <div class="tdw-field-error" id="${idPrefix}-recovery-err" hidden></div>
  </div>
  <div class="form-group" style="display:flex;gap:8px;align-items:flex-start">
    <input type="checkbox" id="${idPrefix}-accept" style="width:auto;min-height:auto;margin-top:4px">
    <label for="${idPrefix}-accept" style="font-weight:600">أوافق على ربط حساب المالك بهذه المؤسسة</label>
  </div>
  <div class="tdw-field-error" id="${idPrefix}-form-err" hidden></div>
</form>`;
  }

  function bindPasswordToggles(root) {
    root = root || document;
    root.querySelectorAll('.tdw-toggle-pw').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-target');
        const input = document.getElementById(id);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'إخفاء' : 'إظهار';
      });
    });
  }

  function readForm(idPrefix) {
    idPrefix = idPrefix || 'ocf';
    return {
      fullName: document.getElementById(`${idPrefix}-name`)?.value || '',
      email: document.getElementById(`${idPrefix}-email`)?.value || '',
      username: document.getElementById(`${idPrefix}-username`)?.value || '',
      password: document.getElementById(`${idPrefix}-password`)?.value || '',
      passwordConfirm: document.getElementById(`${idPrefix}-confirm`)?.value || '',
      recoveryCode: document.getElementById(`${idPrefix}-recovery`)?.value || '',
      acceptOrganization: !!document.getElementById(`${idPrefix}-accept`)?.checked
    };
  }

  function showFieldError(idPrefix, field, message) {
    const el = document.getElementById(`${idPrefix}-${field}-err`);
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function hasUsableOwnerCredential() {
    const users = global.users || global.DB?.get?.('users', []) || [];
    return users.some((user) => user
      && user.active !== false
      && /^(?:owner|hq_admin)$/i.test(String(user.role || ''))
      && /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(user.password || '')));
  }

  // First-owner setup is pre-auth, but Main must authenticate the password
  // before it binds the resulting owner session. A renderer role claim alone
  // can never create this session.
  async function bindCommittedOwnerSession(userId, password) {
    const api = global.cuppingElectron || global.tadawi;
    const rbac = api?.rbac;
    if (!rbac?.authenticateUser || !rbac?.bindSession) return { ok: true, skipped: true };
    const authenticated = await rbac.authenticateUser({ userId, role: 'owner', password });
    if (!authenticated?.ok || !authenticated.proof) {
      return { ok: false, error: authenticated?.error || 'setup_owner_authentication_failed' };
    }
    const bound = await rbac.bindSession({ userId, role: 'owner', authProof: authenticated.proof });
    if (!bound?.ok) return { ok: false, error: bound?.error || 'setup_owner_session_bind_failed' };
    const branchId = global.DeviceConfig?.load?.()?.lockedBranchId;
    if (branchId && rbac.setWriteBranch) {
      const branch = await rbac.setWriteBranch(branchId);
      if (!branch?.ok) return { ok: false, error: branch?.error || 'setup_owner_write_branch_failed' };
    }
    return { ok: true, session: bound.session || null };
  }

  async function commitInitialOwner(value) {
    const api = global.cuppingElectron || global.tadawi;
    const commit = api?.database?.setupCommitOwner;
    if (typeof commit !== 'function') return null;
    const session = await api?.rbac?.getSession?.();
    if (session?.ok) return null;
    const committed = await commit({
      fullName: value.fullName,
      username: value.username,
      email: value.email,
      password: value.password,
      recoveryCode: value.recoveryCode,
    });
    if (!committed?.ok) return { ok: false, error: committed?.error || 'setup_owner_commit_failed' };
    const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
    if (hydrated?.ok === false) return { ok: false, error: hydrated.error || 'setup_owner_hydrate_failed' };
    const bound = await bindCommittedOwnerSession(committed.userId, value.password);
    if (!bound.ok) return { ok: false, error: bound.error, committed: true };
    try { global.OwnerSetupState?.clearRequired?.(); } catch { /* observer only */ }
    return {
      ok: true,
      username: committed.username || value.username,
      email: value.email,
      userId: committed.userId,
      credentialRevision: committed.credentialRevision,
      setupCommitted: true,
      sessionBound: true,
    };
  }

  async function createOwnerFromForm(idPrefix) {
    idPrefix = idPrefix || 'ocf';
    ['name', 'email', 'username', 'password', 'confirm', 'recovery', 'form'].forEach((f) => showFieldError(idPrefix, f, ''));
    const raw = readForm(idPrefix);
    const validated = validateCreateInput(raw);
    if (!validated.ok) {
      const map = {
        name_required: ['name', 'الاسم مطلوب'],
        email_required: ['email', 'بريد إلكتروني صالح مطلوب'],
        username_required: ['username', 'اسم المستخدم مطلوب'],
        recovery_required: ['recovery', 'وسيلة الاسترداد مطلوبة'],
        org_accept_required: ['form', 'يجب الموافقة على ربط المالك بالمؤسسة'],
        password_required: ['password', 'كلمة المرور إلزامية'],
        password_too_short: ['password', `كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`],
        password_mismatch: ['confirm', 'كلمتا المرور غير متطابقتين']
      };
      const row = map[validated.error] || ['form', validated.error || 'تعذّر التحقق'];
      showFieldError(idPrefix, row[0], row[1]);
      return { ok: false, error: validated.error, code: validated.code || validated.error };
    }

    // A stale profile from an interrupted legacy setup is not a usable owner.
    if (hasUsableOwnerCredential()) {
      showFieldError(idPrefix, 'form', 'حساب المالك موجود مسبقاً');
      return { ok: false, error: 'profile_exists', code: 'owner_duplicate' };
    }

    const v = validated.value;
    try {
      const setupCommitted = await commitInitialOwner(v);
      if (setupCommitted) {
        if (!setupCommitted.ok) showFieldError(idPrefix, 'form', setupCommitted.error || 'setup_owner_commit_failed');
        return setupCommitted;
      }
    } catch (err) {
      return { ok: false, error: err?.code || err?.message || 'setup_owner_commit_failed' };
    }
    const res = await global.OwnerProfile.createProfile({
      username: v.username,
      password: v.password,
      recoveryCode: v.recoveryCode,
      email: v.email,
      fullName: v.fullName
    });
    if (!res?.ok) {
      const ue = global.ActivationErrors?.toUserError?.(res, res.error === 'profile_exists' ? 'owner_duplicate' : 'unknown');
      showFieldError(idPrefix, 'form', ue ? ue.title : (res.error || 'فشل الإنشاء'));
      return res;
    }

    // Ensure a login user with role owner exists (hashed via app helpers when available).
    try {
      const users = global.users || global.DB?.get?.('users', []) || [];
      let ownerUser = users.find((u) => u && String(u.username || '').toLowerCase() === v.username);
      const hash = typeof global.hashPW === 'function'
        ? await global.hashPW(v.password, v.username)
        : `pending:${Date.now()}`;
      if (!ownerUser) {
        ownerUser = {
          id: 'owner-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
          fullName: v.fullName,
          username: v.username,
          password: hash,
          role: 'owner',
          email: v.email,
          active: true,
          empNum: '',
          doctorId: ''
        };
        users.push(ownerUser);
      } else {
        ownerUser.role = 'owner';
        ownerUser.fullName = v.fullName;
        ownerUser.email = v.email;
        ownerUser.password = hash;
        ownerUser.active = true;
      }
      ownerUser.mustChangePassword = false;
      ownerUser.seedDefaultPassword = false;
      ownerUser.passwordChangedAt = new Date().toISOString();
      ownerUser.credentialRevision = (Number(ownerUser.credentialRevision) || 0) + 1;
      users.forEach((candidate) => {
        if (candidate === ownerUser || String(candidate?.role || '').toLowerCase() !== 'owner') return;
        if (candidate.seedDefaultPassword === true || candidate.mustChangePassword === true) {
          candidate.active = false;
          candidate.supersededByOwnerId = ownerUser.id;
        }
      });
      if (global.OwnerManagement?.bindOwnerToCurrentContext) {
        global.OwnerManagement.bindOwnerToCurrentContext(ownerUser);
      } else if (global.BranchScope?.applyDefaultScopeToUser) {
        global.BranchScope.applyDefaultScopeToUser(ownerUser);
      }
      const committed = typeof global.persistData === 'function'
        ? await global.persistData('users', users)
        : await global.SqliteBridge?.setAuthoritative?.('users', users);
      if (!committed || committed.ok === false) throw new Error(committed?.error || 'owner_users_commit_failed');
      global.users = users;
      try { await global.OwnerMigration?.promoteUserToOwnerRole?.(v.username); } catch { /* empty */ }
      global.OwnerSetupState?.clearRequired?.();
    } catch (err) {
      return { ok: false, error: 'user_sync_failed', message: String(err && err.message || err) };
    }

    return { ok: true, username: v.username, email: v.email };
  }

  const api = {
    MIN_PASSWORD_LENGTH,
    validatePasswordPair,
    validateCreateInput,
    hasUsableOwnerCredential,
    bindCommittedOwnerSession,
    commitInitialOwner,
    renderFormHtml,
    bindPasswordToggles,
    readForm,
    showFieldError,
    createOwnerFromForm
  };
  global.OwnerCreateForm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
