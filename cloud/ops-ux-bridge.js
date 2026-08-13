/**
 * V2-5.6 — wire OpsProgress / RestoreWizard / BackupHistory / OpsStatus into UI helpers.
 */
(function (global) {
  'use strict';

  const DIALOG_ID = 'ops-ux-restore-wizard';
  const PROGRESS_ID = 'ops-ux-progress';
  const STATUS_ID = 'ops-ux-status-strip';
  const HISTORY_ID = 'ops-ux-backup-history';

  function el(tag, attrs, html) {
    if (typeof document === 'undefined') return null;
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    if (html != null) node.innerHTML = html;
    return node;
  }

  function ensureShell() {
    if (typeof document === 'undefined') return null;
    let root = document.getElementById(DIALOG_ID);
    if (root) return root;
    const a11y = global.UxA11y?.criticalDialogAttrs?.() || {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'ops-ux-restore-title',
    };
    root = el('div', {
      id: DIALOG_ID,
      className: 'ops-ux-dialog',
      role: a11y.role || 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'ops-ux-restore-title',
      style: 'display:none;position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.45);align-items:center;justify-content:center;padding:16px',
    });
    root.innerHTML = `
      <div class="ops-ux-dialog-panel" tabindex="-1" style="background:var(--card,#fff);color:var(--text,#111);max-width:560px;width:100%;max-height:90vh;overflow:auto;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">
        <h3 id="ops-ux-restore-title" style="margin:0 0 8px;font-size:1.15rem">معالج الاستعادة / Restore Wizard</h3>
        <p id="ops-ux-restore-step" class="ops-ux-muted" style="margin:0 0 12px;color:var(--text-muted,#667)"></p>
        <div id="ops-ux-restore-body"></div>
        <div id="${PROGRESS_ID}" style="margin-top:12px;display:none">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:4px">
            <span id="ops-ux-progress-label">—</span>
            <strong id="ops-ux-progress-pct" dir="ltr">0%</strong>
          </div>
          <div style="height:8px;background:var(--surface-dark,#e5e7eb);border-radius:999px;overflow:hidden">
            <div id="ops-ux-progress-bar" style="height:100%;width:0%;background:var(--primary,#3D5A80);transition:width .2s"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn btn-ghost btn-sm" id="ops-ux-btn-pause" aria-label="Pause operation">⏸️ Pause</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ops-ux-btn-resume" aria-label="Resume operation">▶️ Resume</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ops-ux-btn-retry" aria-label="Retry operation">🔁 Retry</button>
            <button type="button" class="btn btn-danger btn-sm" id="ops-ux-btn-cancel" aria-label="Cancel operation safely">✖️ Cancel</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost btn-sm" id="ops-ux-btn-close" aria-label="Close restore wizard">إغلاق</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('keydown', (ev) => {
      const panel = root.querySelector('.ops-ux-dialog-panel');
      if (panel) global.UxA11y?.trapFocus?.(panel, ev);
    });
    document.getElementById('ops-ux-btn-close')?.addEventListener('click', () => hideWizard());
    return root;
  }

  function showWizard() {
    const root = ensureShell();
    if (!root) return;
    root.style.display = 'flex';
    const panel = root.querySelector('.ops-ux-dialog-panel');
    panel?.focus?.();
  }

  function hideWizard() {
    const root = document.getElementById(DIALOG_ID);
    if (root) root.style.display = 'none';
  }

  function renderProgress(snapshot) {
    const box = document.getElementById(PROGRESS_ID);
    if (!box || !snapshot) return;
    box.style.display = 'block';
    const pct = Math.max(0, Math.min(100, Number(snapshot.percent) || 0));
    if (pct === 100 && snapshot.status !== 'complete') {
      try { global.OpsProgress?.assertHonestProgress?.(snapshot); } catch { /* keep honest UI */ }
    }
    const honestPct = snapshot.status === 'complete' ? pct : Math.min(pct, 99);
    const bar = document.getElementById('ops-ux-progress-bar');
    const label = document.getElementById('ops-ux-progress-label');
    const pctEl = document.getElementById('ops-ux-progress-pct');
    if (bar) bar.style.width = honestPct + '%';
    if (label) label.textContent = `${snapshot.op || ''} · ${snapshot.stage || snapshot.status || ''}`;
    if (pctEl) pctEl.textContent = honestPct + '%';
  }

  function mountStatusStrip(hostSelector) {
    if (typeof document === 'undefined') return null;
    const host = typeof hostSelector === 'string' ? document.querySelector(hostSelector) : hostSelector;
    if (!host) return null;
    let strip = document.getElementById(STATUS_ID);
    if (!strip) {
      strip = el('div', { id: STATUS_ID, className: 'ops-ux-status-strip', role: 'status', 'aria-live': 'polite' });
      strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;font-size:12px;margin:8px 0;padding:8px 10px;background:var(--surface,#F8F9FB);border-radius:8px';
      host.prepend(strip);
    }
    return strip;
  }

  function refreshStatusStrip(hostSelector, input) {
    const strip = mountStatusStrip(hostSelector);
    if (!strip || !global.OpsStatus) return null;
    const st = global.OpsStatus.buildStatus(input || {});
    const fmt = global.OpsStatus.formatLargeCount;
    const reconnect = global.OpsStatus.reconnectHint(st.online);
    strip.innerHTML = `
      <span><strong>${st.online ? 'Online' : 'Offline'}</strong> · ${reconnect.hintAr || st.reconnectHintAr || ''}</span>
      <span dir="ltr">Pending: ${fmt(st.pendingCount)}</span>
      <span dir="ltr">Conflicts: ${fmt(st.conflictCount)}</span>
      <span dir="ltr">Dead-letter: ${fmt(st.deadLetterCount)}</span>
      <span>Last sync: ${st.lastSuccessfulSyncAt || '—'}</span>
      <span>Devices: ${fmt((st.devices || []).length)}</span>`;
    return st;
  }

  function mountBackupHistory(hostSelector, entries) {
    if (typeof document === 'undefined' || !global.BackupHistory) return null;
    const host = typeof hostSelector === 'string' ? document.querySelector(hostSelector) : hostSelector;
    if (!host) return null;
    let box = document.getElementById(HISTORY_ID);
    if (!box) {
      box = el('div', { id: HISTORY_ID });
      box.style.cssText = 'margin-top:12px';
      host.appendChild(box);
    }
    const list = global.BackupHistory.sortByNewest((entries || []).map((e) => global.BackupHistory.normalizeEntry(e)));
    box.innerHTML = `<div class="card-title" style="font-size:14px;margin-bottom:8px">سجل Backup V2 / Restore points</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto">
      ${list.map((e) => `<button type="button" class="btn btn-ghost btn-sm" data-restore-point="${e.id}" aria-label="Select restore point ${e.label}" style="justify-content:space-between;text-align:start">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">${global.OpsStatus?.truncateName?.(e.label, 48) || e.label}</span>
        <span dir="ltr" style="font-size:11px;color:var(--text-muted)">${e.validation} · ${e.createdAt || ''}</span>
      </button>`).join('') || '<div class="oh-muted">لا توجد نقاط استعادة محلية</div>'}
      </div>`;
    return list;
  }

  async function runRestoreWizardFlow(options) {
    options = options || {};
    const Wizard = global.RestoreWizard;
    const Progress = global.OpsProgress;
    const Danger = global.DangerConfirm;
    if (!Wizard || !Progress || !Danger) throw new Error('ops_ux_modules_missing');

    ensureShell();
    showWizard();
    Wizard.start();
    const stepEl = document.getElementById('ops-ux-restore-step');
    const body = document.getElementById('ops-ux-restore-body');
    const setStep = () => {
      const s = Wizard.getState();
      if (stepEl) stepEl.textContent = `الخطوة: ${s.step}`;
    };
    setStep();

    const point = options.point || { id: options.filePath || 'manual', path: options.filePath, label: options.filePath || 'manual' };
    Wizard.selectPoint(point);
    setStep();

    Wizard.validate(() => {
      if (typeof options.validate === 'function') return options.validate(point);
      return { ok: true, validation: 'valid', detail: 'selected' };
    });
    setStep();

    const preState = Wizard.buildPreSummary({
      filePath: point.path || point.id,
      willOverwrite: true,
      identity: options.identity || {},
      counts: options.counts || {},
    });
    const pre = preState.preSummary || preState;
    if (body) {
      body.innerHTML = `<div style="font-size:13px;line-height:1.6">
        <p><strong>ملخص ما قبل الاستعادة</strong></p>
        <pre style="white-space:pre-wrap;background:var(--surface,#f5f5f5);padding:8px;border-radius:8px;font-size:12px" dir="ltr">${JSON.stringify(pre, null, 2)}</pre>
        <label for="ops-ux-typed-confirm">اكتب <b>استعادة</b> للتأكيد</label>
        <input id="ops-ux-typed-confirm" class="form-control" autocomplete="off" aria-label="Type restore confirmation phrase" style="margin-top:6px">
        <button type="button" class="btn btn-accent btn-sm" id="ops-ux-btn-confirm-restore" style="margin-top:10px" aria-label="Confirm restore overwrite">تأكيد الاستعادة</button>
      </div>`;
    }
    setStep();

    const typed = await new Promise((resolve) => {
      const btn = document.getElementById('ops-ux-btn-confirm-restore');
      if (!btn) return resolve(options.typedPhrase || '');
      btn.onclick = () => resolve(document.getElementById('ops-ux-typed-confirm')?.value || '');
      if (options.typedPhrase) {
        const input = document.getElementById('ops-ux-typed-confirm');
        if (input) input.value = options.typedPhrase;
        resolve(options.typedPhrase);
      }
    });

    const confirm = Wizard.confirmOverwrite({ typedPhrase: typed });
    if (!confirm.ok) {
      if (body) body.innerHTML += `<p style="color:var(--danger)">❌ ${confirm.error || 'confirm_failed'}</p>`;
      return { ok: false, error: confirm.error || 'confirm_failed' };
    }
    setStep();

    const session = Progress.createSession({
      op: 'restore',
      stages: ['inspect', 'emergency', 'replace', 'verify', 'relaunch'],
    });
    Wizard.startRunning(session);
    const sid = session.id;
    renderProgress(Progress.getSnapshot(sid));
    setStep();
    document.getElementById('ops-ux-btn-pause')?.addEventListener('click', () => {
      Progress.pause(sid); renderProgress(Progress.getSnapshot(sid));
    });
    document.getElementById('ops-ux-btn-resume')?.addEventListener('click', () => {
      Progress.resume(sid); renderProgress(Progress.getSnapshot(sid));
    });
    document.getElementById('ops-ux-btn-retry')?.addEventListener('click', () => {
      Progress.retry(sid); renderProgress(Progress.getSnapshot(sid));
    });
    document.getElementById('ops-ux-btn-cancel')?.addEventListener('click', () => {
      Progress.requestCancel(sid);
      Progress.markCancelled(sid);
      Wizard.cancel();
      renderProgress(Progress.getSnapshot(sid));
    });

    Progress.setStage(sid, 'inspect');
    Progress.setRatio(sid, 0.15);
    renderProgress(Progress.getSnapshot(sid));

    let result = { ok: false };
    try {
      if (typeof options.execute === 'function') {
        Progress.setStage(sid, 'replace');
        Progress.setRatio(sid, 0.55);
        renderProgress(Progress.getSnapshot(sid));
        result = await options.execute({ point, sessionId: sid });
      } else {
        result = { ok: true, skippedExecute: true };
      }
      Progress.setStage(sid, 'verify');
      Progress.setRatio(sid, 0.9);
      renderProgress(Progress.getSnapshot(sid));
      if (result && result.ok) {
        Progress.markComplete(sid);
        renderProgress(Progress.getSnapshot(sid));
        const post = Wizard.finish({
          ok: true,
          postSummary: {
            restoredAt: new Date().toISOString(),
            filePath: point.path || point.id,
            verified: true,
            detail: result,
          },
        });
        if (body) {
          body.innerHTML += `<div style="margin-top:10px"><strong>ملخص ما بعد الاستعادة</strong>
            <pre style="white-space:pre-wrap;background:var(--surface,#f5f5f5);padding:8px;border-radius:8px;font-size:12px" dir="ltr">${JSON.stringify(post.postSummary || post, null, 2)}</pre></div>`;
        }
        setStep();
        return { ok: true, postSummary: post.postSummary || post, session: Progress.getSnapshot(sid) };
      }
      Progress.markFailed(sid, result?.error || 'restore_failed');
      Wizard.finish({ ok: false, postSummary: { error: result?.error || 'restore_failed' } });
      renderProgress(Progress.getSnapshot(sid));
      return { ok: false, error: result?.error || 'restore_failed' };
    } catch (err) {
      Progress.markFailed(sid, String(err && err.message || err));
      Wizard.finish({ ok: false, postSummary: { error: String(err && err.message || err) } });
      renderProgress(Progress.getSnapshot(sid));
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  function redactAndExportLogs(rows) {
    const Redact = global.OpsLogRedact;
    if (!Redact) return rows;
    return Redact.exportRedactedLogs(rows || []);
  }

  function recoveryFor(category, lang) {
    const msg = global.ErrorRecoveryUx?.fromClassify?.(category) || global.ErrorRecoveryUx?.get?.('generic');
    if (!msg) return null;
    const isEn = String(lang || global.UxI18n?.getLang?.() || 'ar') === 'en';
    return {
      title: isEn ? msg.titleEn : msg.titleAr,
      body: isEn ? msg.bodyEn : msg.bodyAr,
      recovery: isEn ? msg.recoveryEn : msg.recoveryAr,
      code: msg.code,
      leakSafe: msg.leakSafe !== false,
    };
  }

  global.OpsUxBridge = {
    ensureShell,
    showWizard,
    hideWizard,
    renderProgress,
    mountStatusStrip,
    refreshStatusStrip,
    mountBackupHistory,
    runRestoreWizardFlow,
    /** V2-5.9 alias — BootFlow and callers expect openRestoreWizard */
    openRestoreWizard: runRestoreWizardFlow,
    redactAndExportLogs,
    recoveryFor,
    DIALOG_ID,
    PROGRESS_ID,
    STATUS_ID,
    HISTORY_ID,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.OpsUxBridge;
  }
})(typeof window !== 'undefined' ? window : globalThis);
