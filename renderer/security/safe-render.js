/* global document, Element, console, window */
(function installSafeRendering(global) {
  'use strict';

  if (!global.DOMPurify) throw new Error('DOMPurify is required before safe-render.js');

  const metrics = { assignments: 0, blockedAttributes: 0, blockedElements: 0 };
  let sanitizing = false;

  global.DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (['script', 'iframe', 'object', 'embed', 'base', 'link', 'form'].includes(String(data.tagName || '').toLowerCase())) {
      metrics.blockedElements += 1;
    }
  });
  global.DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const name = String(data.attrName || '').toLowerCase();
    if (name.startsWith('on') || name === 'srcdoc') {
      data.keepAttr = false;
      metrics.blockedAttributes += 1;
      if (name.startsWith('on')) {
        for (const resourceAttr of ['src', 'srcset', 'href', 'xlink:href', 'action', 'formaction']) {
          node?.removeAttribute?.(resourceAttr);
        }
        node?.setAttribute?.('data-tdw-blocked-action', '1');
      }
      return;
    }
    if (name === 'style' && /(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding)/i.test(data.attrValue || '')) {
      data.keepAttr = false;
      metrics.blockedAttributes += 1;
    }
  });

  function sanitizeStructuredHtml(value) {
    metrics.assignments += 1;
    let source = String(value ?? '');
    const register = global.tdwRegisterAction;
    if (typeof register === 'function' && /\son(?:click|change|input|keydown|contextmenu)\s*=/i.test(source)) {
      const template = document.createElement('template');
      sanitizing = true;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        descriptor.set.call(template, source);
      } finally {
        sanitizing = false;
      }
      for (const element of template.content.querySelectorAll('*')) {
        for (const eventName of ['click', 'change', 'input', 'keydown', 'contextmenu']) {
          const attr = `on${eventName}`;
          const code = element.getAttribute(attr);
          if (!code) continue;
          const key = register(code);
          element.removeAttribute(attr);
          if (!key) {
            // A stored payload with an event attribute must not retain a loadable URL
            // after its executable action is rejected.
            element.setAttribute('data-tdw-blocked-action', '1');
            for (const resourceAttr of ['src', 'srcset', 'href', 'xlink:href', 'action', 'formaction']) {
              element.removeAttribute(resourceAttr);
            }
            continue;
          }
          const dataName = eventName === 'click'
            ? 'data-tdw-action-key'
            : eventName === 'contextmenu'
              ? 'data-tdw-context-action-key'
              : `data-tdw-${eventName}-action-key`;
          element.setAttribute(dataName, key);
        }
      }
      source = template.innerHTML;
    }
    sanitizing = true;
    try {
      return global.DOMPurify.sanitize(source, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'link', 'form'],
        FORBID_ATTR: ['srcdoc'],
        ALLOW_DATA_ATTR: true,
        ALLOW_ARIA_ATTR: true,
        ALLOW_UNKNOWN_PROTOCOLS: false,
      });
    } finally {
      sanitizing = false;
    }
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setText(element, value) {
    if (element) element.textContent = String(value ?? '');
    return element;
  }

  function setStructuredHtml(element, value) {
    if (element) element.innerHTML = sanitizeStructuredHtml(value);
    return element;
  }

  function classify(value, options = {}) {
    if (options.staticTrusted === true) return { type: 'static-trusted-template', value: String(value ?? '') };
    if (options.text === true) return { type: 'dynamic-text', value: String(value ?? '') };
    if (options.legacy === true) return { type: 'unsafe-legacy-interpolation', value: sanitizeStructuredHtml(value) };
    return { type: 'dynamic-structured-ui', value: sanitizeStructuredHtml(value) };
  }

  const inner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const outer = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
  const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  if (inner?.set && inner?.get) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: inner.configurable,
      enumerable: inner.enumerable,
      get: inner.get,
      set(value) { inner.set.call(this, sanitizing ? value : sanitizeStructuredHtml(value)); },
    });
  }
  if (outer?.set && outer?.get) {
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: outer.configurable,
      enumerable: outer.enumerable,
      get: outer.get,
      set(value) { outer.set.call(this, sanitizing ? value : sanitizeStructuredHtml(value)); },
    });
  }
  Element.prototype.insertAdjacentHTML = function safeInsertAdjacentHTML(position, value) {
    return nativeInsertAdjacentHTML.call(this, position, sanitizing ? value : sanitizeStructuredHtml(value));
  };

  const PAGINATION_FUNCTIONS = new Set([
    'goDailyTablePage', 'goAttLogPage', 'goMessageLogPage', 'goBulkTablePage',
    'goClientsPage', 'goBookingsPage', 'goExpensesPage',
  ]);

  function dataValue(element, name) {
    return decodeURIComponent(String(element.dataset[name] || ''));
  }

  async function dispatch(element, event, actionOverride) {
    const action = actionOverride || element.dataset.tdwHandler;
    switch (action) {
      case 'time-update': return global.updateTimePickerVal?.(dataValue(element, 'target'));
      case 'time-ampm': return global.setAMPM?.(dataValue(element, 'target'), element.dataset.ampm);
      case 'time-manual-enter':
        if (event.key === 'Enter') { event.preventDefault(); return global.applyManualTime?.(dataValue(element, 'target')); }
        return undefined;
      case 'time-manual-live': return global.liveManualTime?.(dataValue(element, 'target'));
      case 'time-manual-apply': return global.applyManualTime?.(dataValue(element, 'target'));
      case 'time-confirm': return global.confirmTimePicker?.(dataValue(element, 'target'));
      case 'employee-period': {
        const [year, month] = String(element.value || '').split('-').map(Number);
        return global.showEmployeeDashboard?.(year, month);
      }
      case 'employee-print': return global.printEmployeeReport?.();
      case 'phone-client': return global.selectPhoneClient?.(dataValue(element, 'id'));
      case 'extra-type': return global.onExtraSvcTypeChange?.(element);
      case 'extra-calc': return global.calcExtraRow?.(element);
      case 'extra-total': return global.updateExtraTotal?.();
      case 'extra-remove':
        element.closest('.extra-service-row')?.remove();
        return global.updateExtraTotal?.();
      case 'old-extra-total': return global.ocCalcFinancials?.();
      case 'old-extra-remove':
        element.closest('.extra-service-row')?.remove();
        return global.ocCalcFinancials?.();
      case 'context-case': return global.showContextCase?.(global.recentDashCases?.[Number(element.dataset.index)]);
      case 'theme':
        global.applyTheme?.(dataValue(element, 'key'), true);
        global.renderThemeCards?.('themeGrid');
        return global.renderThemeCards?.('themeGridModal');
      case 'bulk-remove':
        global.manualBulkNumbers?.splice(Number(element.dataset.index), 1);
        return global.renderManualBulkList?.();
      case 'page-size': return global.onTablePageSizeChange?.(element.value);
      case 'paginate': {
        const fnName = String(element.dataset.fn || '');
        if (!PAGINATION_FUNCTIONS.has(fnName)) return undefined;
        return global[fnName]?.(Number(element.dataset.page));
      }
      case 'next-session': return global.openNextSession?.(dataValue(element, 'key'), dataValue(element, 'name'), dataValue(element, 'phone'));
      case 'whatsapp': return global.openWhatsApp?.(dataValue(element, 'phone'), dataValue(element, 'name'));
      case 'whatsapp-promo': return global.openWhatsAppPromo?.(dataValue(element, 'phone'), dataValue(element, 'name'));
      case 'show-clients': return global.showPage?.('clients');
      case 'context-booking': return global.showContextBooking?.(global.bookings?.find((item) => String(item.id) === dataValue(element, 'id')));
      case 'dev-contact-toggle': return global.toggleLoginDevContact?.(false);
      case 'dev-contact-close': return global.closeDevContactModal?.();
      case 'license-feature-toggle': return global.licOnFeatureToggle?.();
      case 'license-card-toggle': return global.licToggleFeatCard?.(dataValue(element, 'id'));
      case 'stop-propagation': return event.stopPropagation();
      case 'license-group': return global.licSetGroupFeatures?.(dataValue(element, 'id'), element.dataset.enabled === '1');
      case 'license-capability': return global.licSetCapabilityFeatures?.(dataValue(element, 'id'), element.dataset.enabled === '1');
      case 'license-runtime': return global.licToggleRuntimeFeature?.(dataValue(element, 'id'), !!element.checked);
      case 'license-copy-key': return global.licCopyGeneratedKey?.();
      case 'action-more': return global.toggleActionMoreMenu?.(event, element.dataset.menuId);
      default: return undefined;
    }
  }

  for (const eventName of ['click', 'change', 'input', 'keydown']) {
    document.addEventListener(eventName, (event) => {
      const element = event.target.closest?.(`[data-tdw-event="${eventName}"],[data-tdw-input-event="${eventName}"]`);
      if (!element) return;
      const alternate = element.dataset.tdwInputEvent === eventName ? element.dataset.tdwInputHandler : null;
      void Promise.resolve(dispatch(element, event, alternate)).catch((error) => console.error('safe UI action failed', error));
    });
  }

  global.SafeRender = Object.freeze({
    escapeText,
    escapeAttribute: escapeText,
    setText,
    setStructuredHtml,
    sanitizeStructuredHtml,
    classify,
    metrics,
  });
})(typeof window !== 'undefined' ? window : globalThis);
