'use strict';

const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'html', 'head', 'body', 'meta', 'title', 'style',
  'main', 'section', 'article', 'header', 'footer', 'nav',
  'div', 'span', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 'small',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'img', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text',
];

const GLOBAL_ATTRIBUTES = [
  'class', 'id', 'dir', 'lang', 'title', 'style', 'role',
  'aria-label', 'aria-hidden', 'colspan', 'rowspan',
];

const PRINT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
].join('; ');

function sanitizeCss(css) {
  return String(css || '')
    .replace(/@import\b[^;]*(?:;|$)/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/(?:expression|javascript|vbscript|behavior|-moz-binding)\s*[:(]/gi, 'blocked(');
}

function sanitizePrintDocument(input) {
  const cleaned = sanitizeHtml(String(input || ''), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': GLOBAL_ATTRIBUTES,
      meta: ['charset', 'name', 'content'],
      img: ['src', 'alt', 'width', 'height', ...GLOBAL_ATTRIBUTES],
      svg: ['viewBox', 'width', 'height', 'xmlns', ...GLOBAL_ATTRIBUTES],
      path: ['d', 'fill', 'stroke', 'stroke-width'],
      circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'fill', 'stroke'],
      line: ['x1', 'y1', 'x2', 'y2', 'stroke'],
      polyline: ['points', 'fill', 'stroke'],
      polygon: ['points', 'fill', 'stroke'],
      col: ['span', 'width', 'style'],
    },
    allowedSchemes: ['data', 'blob'],
    allowedSchemesByTag: { img: ['data', 'blob'] },
    allowProtocolRelative: false,
    // Style tags are required for pixel-identical print output; sanitizeCss and
    // PRINT_CSP remove imports, URLs, script and network execution.
    allowVulnerableTags: true,
    disallowedTagsMode: 'discard',
    parser: { lowerCaseAttributeNames: false },
  });

  const withoutDangerousCss = sanitizeCss(cleaned);
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`;
  const withCsp = /<head(?:\s[^>]*)?>/i.test(withoutDangerousCss)
    ? withoutDangerousCss.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${cspMeta}`)
    : `<html><head>${cspMeta}<meta charset="utf-8"></head><body>${withoutDangerousCss}</body></html>`;
  return `<!DOCTYPE html>${withCsp}`;
}

module.exports = {
  ALLOWED_TAGS,
  PRINT_CSP,
  sanitizeCss,
  sanitizePrintDocument,
};
