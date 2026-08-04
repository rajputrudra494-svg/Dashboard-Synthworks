/* =============================================================================
   SynthWorks — utils.js
   Framework-free helpers shared by every page: DOM, formatting, dates, arrays,
   storage, export and a few small functional utilities.
   Zero dependencies. Zero side effects on import.
   ========================================================================== */

/* =============================================================================
   DOM
   ========================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Creates an element. Attributes are applied intelligently:
 *   class/className, dataset object, style object, on* handlers, html, text.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {(Node|string)[]|Node|string} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;

    if (key === 'class' || key === 'className') node.className = value;
    else if (key === 'html')  node.innerHTML = value;
    else if (key === 'text')  node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    }
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replaces a container's children in one paint. */
export function render(container, ...nodes) {
  if (!container) return container;
  const frag = document.createDocumentFragment();
  nodes.flat().forEach((n) => {
    if (n == null || n === false) return;
    frag.append(n instanceof Node ? n : document.createTextNode(String(n)));
  });
  container.replaceChildren(frag);
  return container;
}

/** Escapes a string for safe interpolation into innerHTML. */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Delegated event listener — survives re-renders of the inner list. */
export function delegate(root, eventName, selector, handler) {
  if (!root) return () => {};
  const listener = (event) => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) handler(event, match);
  };
  root.addEventListener(eventName, listener);
  return () => root.removeEventListener(eventName, listener);
}

/** Re-draws Lucide icons inside `root` (safe to call as often as you like). */
export function icons(root = document) {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({
    attrs: { 'stroke-width': 1.9 },
    nameAttr: 'data-lucide',
    ...(root !== document ? { root } : {}),
  });
}

/** Traps Tab focus inside a container (modals, drawers). Returns a cleanup fn. */
export function trapFocus(container) {
  if (!container) return () => {};
  const SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const onKey = (event) => {
    if (event.key !== 'Tab') return;
    const items = $$(SELECTOR, container).filter((n) => n.offsetParent !== null);
    if (!items.length) return;

    const first = items[0];
    const last  = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

/* =============================================================================
   FUNCTIONAL
   ========================================================================== */

export function debounce(fn, wait = 260) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function throttle(fn, limit = 100) {
  let waiting = false;
  let trailing = null;
  return (...args) => {
    if (waiting) { trailing = args; return; }
    fn(...args);
    waiting = true;
    setTimeout(() => {
      waiting = false;
      if (trailing) { fn(...trailing); trailing = null; }
    }, limit);
  };
}

/** requestAnimationFrame-throttled wrapper — ideal for scroll/mousemove. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...lastArgs); });
  };
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export const uid = (prefix = 'id') =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Deep-ish clone that handles the plain data we deal with. */
export const clone = (value) =>
  (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

/* =============================================================================
   ARRAYS
   ========================================================================== */

export function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

export function sumBy(items, keyFn) {
  const pick = typeof keyFn === 'function' ? keyFn : (item) => item[keyFn];
  return items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}

export function sortBy(items, keyFn, direction = 'asc') {
  const pick = typeof keyFn === 'function' ? keyFn : (item) => item[keyFn];
  const dir = direction === 'desc' ? -1 : 1;

  return [...items].sort((a, b) => {
    const va = pick(a);
    const vb = pick(b);

    // Nulls always sink to the bottom regardless of direction.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;

    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

export const unique = (items) => [...new Set(items)];

export const byId = (items, id) => items.find((item) => item.id === id) || null;

/** Index an array by id for O(1) lookups. */
export const indexById = (items) => new Map(items.map((item) => [item.id, item]));

export function paginate(items, page, perPage) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = clamp(page, 1, pages);
  const start = (safePage - 1) * perPage;
  return { rows: items.slice(start, start + perPage), page: safePage, pages, total: items.length };
}

/* =============================================================================
   NUMBERS & CURRENCY
   ========================================================================== */

let currencyCode   = 'USD';
let currencySymbol = '$';

/** Called once by store.js after workspace settings load. */
export function setCurrency(code, symbol) {
  currencyCode = code || 'USD';
  currencySymbol = symbol || '$';
}

export const getCurrency = () => ({ code: currencyCode, symbol: currencySymbol });

export function money(amount, { compact = false, decimals = null } = {}) {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      notation: compact && Math.abs(value) >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits: decimals ?? (compact && Math.abs(value) >= 10000 ? 1 : 2),
      minimumFractionDigits: decimals ?? (compact && Math.abs(value) >= 10000 ? 0 : 2),
    }).format(value);
  } catch {
    return `${currencySymbol}${value.toFixed(2)}`;
  }
}

export function num(value, { compact = false, decimals = 0 } = {}) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat(undefined, {
    notation: compact && Math.abs(n) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: decimals,
  }).format(n);
}

export const percent = (value, decimals = 0) => `${(Number(value) || 0).toFixed(decimals)}%`;

/** Percentage change from `previous` to `current`, guarding divide-by-zero. */
export function pctChange(current, previous) {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (b === 0) return a === 0 ? 0 : 100;
  return ((a - b) / Math.abs(b)) * 100;
}

export function fileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = b / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/* =============================================================================
   DATES
   All helpers accept a Date, an ISO string, or a yyyy-mm-dd date string.
   ========================================================================== */

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  // A bare yyyy-mm-dd is parsed as UTC by the spec, which shifts the day for
  // anyone west of Greenwich. Parse it as local instead.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fmtDate(value, style = 'medium') {
  const date = toDate(value);
  if (!date) return '—';
  const presets = {
    short:  { month: 'short', day: 'numeric' },
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    long:   { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' },
    month:  { month: 'short', year: 'numeric' },
    day:    { weekday: 'long', month: 'long', day: 'numeric' },
  };
  return new Intl.DateTimeFormat(undefined, presets[style] || presets.medium).format(date);
}

export function fmtTime(value, withSeconds = false) {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  }).format(date);
}

export function fmtDateTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return `${fmtDate(date)} · ${fmtTime(date)}`;
}

/** "3 minutes ago", "in 2 days". */
export function timeAgo(value) {
  const date = toDate(value);
  if (!date) return '';

  const seconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const steps = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
    [Infinity, 'year', 31557600],
  ];

  for (const [limit, unit, divisor] of steps) {
    if (abs < limit) return rtf.format(Math.round(seconds / divisor), unit);
  }
  return fmtDate(date);
}

/** yyyy-mm-dd in LOCAL time — what <input type="date"> expects. */
export function isoDate(value = new Date()) {
  const date = toDate(value) || new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** yyyy-mm-ddThh:mm in LOCAL time — for <input type="datetime-local">. */
export function isoDateTime(value = new Date()) {
  const date = toDate(value) || new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const startOfDay = (value = new Date()) => {
  const d = toDate(value) || new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
export const endOfDay = (value = new Date()) => {
  const d = startOfDay(value);
  d.setDate(d.getDate() + 1);
  d.setMilliseconds(-1);
  return d;
};
export function startOfWeek(value = new Date(), weekStartsOn = 1) {
  const d = startOfDay(value);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
export const startOfMonth = (value = new Date()) => {
  const d = toDate(value) || new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
export const endOfMonth = (value = new Date()) => {
  const d = toDate(value) || new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
};
export const startOfYear = (value = new Date()) => {
  const d = toDate(value) || new Date();
  return new Date(d.getFullYear(), 0, 1);
};

export function addDays(value, days) {
  const d = new Date((toDate(value) || new Date()).getTime());
  d.setDate(d.getDate() + days);
  return d;
}
export function addMonths(value, months) {
  const d = new Date((toDate(value) || new Date()).getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Whole days between two dates (positive = `to` is in the future). */
export function daysBetween(from, to = new Date()) {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.round((a - b) / 86400000);
}

export const isSameDay = (a, b) => {
  const x = toDate(a); const y = toDate(b);
  return Boolean(x && y &&
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate());
};

export const isToday = (value) => isSameDay(value, new Date());
export const isPast  = (value) => { const d = toDate(value); return Boolean(d) && d < startOfDay(); };

/** Human deadline label + a severity class for styling. */
export function dueLabel(value) {
  const date = toDate(value);
  if (!date) return { text: 'No due date', tone: '' };

  const days = daysBetween(date);
  if (days < 0)  return { text: `${Math.abs(days)}d overdue`, tone: 'is-overdue' };
  if (days === 0) return { text: 'Due today',  tone: 'is-soon' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'is-soon' };
  if (days <= 7)  return { text: `Due in ${days}d`, tone: 'is-soon' };
  return { text: fmtDate(date, 'short'), tone: '' };
}

/** Last N month buckets, oldest first — the x-axis of most of our charts. */
export function monthRange(count = 12, from = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = addMonths(startOfMonth(from), -i);
    out.push({ date: d, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: fmtDate(d, 'month') });
  }
  return out;
}

export function dayRange(count = 7, from = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = addDays(startOfDay(from), -i);
    out.push({ date: d, key: isoDate(d), label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d) });
  }
  return out;
}

/* =============================================================================
   STRINGS
   ========================================================================== */

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const titleCase = (value = '') =>
  String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const truncate = (value = '', max = 60) =>
  String(value).length > max ? `${String(value).slice(0, max - 1)}…` : String(value);

export const slugify = (value = '') =>
  String(value).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

/** Deterministic brand-family colour derived from any string (avatars, tags). */
export function colorFor(seed = '') {
  const palette = ['#7C3AED', '#A855F7', '#D946EF', '#EC4899', '#3B82F6',
                   '#06B6D4', '#10B981', '#22C55E', '#F59E0B', '#F97316'];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

/** Case-insensitive "does any of these fields contain the query" test. */
export function matches(record, query, fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => {
    const value = typeof field === 'function' ? field(record) : record[field];
    return value != null && String(value).toLowerCase().includes(q);
  });
}

export const emailValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());

/** 0–4 password strength score. */
export function passwordScore(password = '') {
  let score = 0;
  if (password.length >= 8)  score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^\w\s]/.test(password))  score += 1;
  return clamp(score, 0, 4);
}

/* =============================================================================
   LOCAL STORAGE  (never throws — private mode / disabled storage is fine)
   ========================================================================== */

const NS = 'synthworks:';

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(NS))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },
};

/* =============================================================================
   EXPORT  (CSV / PDF / clipboard)
   ========================================================================== */

/** Triggers a browser download for a Blob. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports rows to CSV.
 * @param {Object[]} rows
 * @param {{key: string, label: string, map?: Function}[]} columns
 * @param {string} filename
 */
export function exportCSV(rows, columns, filename = 'export.csv') {
  const escapeCell = (value) => {
    if (value == null) return '';
    const text = String(value);
    // Quote anything containing a delimiter, quote or newline; double inner quotes.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(c.map ? c.map(row) : row[c.key])).join(',')
  );

  // The BOM makes Excel open UTF-8 correctly.
  const csv = `﻿${[header, ...body].join('\r\n')}`;
  download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

/**
 * Exports rows to PDF via the browser's own print-to-PDF, styled to match the
 * app. No third-party PDF library, no bundle weight, and it always reflects
 * exactly what the user sees.
 */
export function exportPDF({ title, subtitle, columns, rows, summary = [] }) {
  const win = window.open('', '_blank', 'width=1024,height=768');
  if (!win) {
    throw new Error('Your browser blocked the export window. Allow pop-ups for this site.');
  }

  const head = columns.map((c) => `<th${c.numeric ? ' class="n"' : ''}>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${
    columns.map((c) => {
      const value = c.map ? c.map(row) : row[c.key];
      return `<td${c.numeric ? ' class="n"' : ''}>${escapeHtml(value ?? '')}</td>`;
    }).join('')
  }</tr>`).join('');

  const cards = summary.map((s) => `
    <div class="s">
      <span>${escapeHtml(s.label)}</span>
      <b>${escapeHtml(s.value)}</b>
    </div>`).join('');

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end;
           padding-bottom: 14px; border-bottom: 2px solid #7C3AED; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
          background: linear-gradient(135deg,#7C3AED,#A855F7); color: #fff; font-weight: 700; font-size: 15px; }
  h1 { font-size: 17px; margin: 0; letter-spacing: -.02em; }
  .sub { font-size: 11px; color: #6B7280; margin-top: 2px; }
  .meta { font-size: 10px; color: #9CA3AF; text-align: right; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
  .s { flex: 1 1 150px; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: 9px; background: #FAFAFC; }
  .s span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #6B7280; }
  .s b { font-size: 16px; letter-spacing: -.02em; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .07em;
       color: #6B7280; padding: 8px 9px; border-bottom: 1.5px solid #E5E7EB; }
  td { padding: 8px 9px; border-bottom: 1px solid #F1F3F7; }
  tr:nth-child(even) td { background: #FAFAFC; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot { font-size: 9px; color: #9CA3AF; }
  @media print { .noprint { display: none; } }
</style></head>
<body>
  <header>
    <div class="brand">
      <div class="mark">S</div>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">${escapeHtml(subtitle || '')}</div>
      </div>
    </div>
    <div class="meta">SynthWorks<br>${new Date().toLocaleString()}<br>${rows.length} records</div>
  </header>
  ${cards ? `<div class="cards">${cards}</div>` : ''}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`);

  win.document.close();
  // Give the new document a tick to lay out before opening the print dialog.
  win.onload = () => { win.focus(); win.print(); };
  setTimeout(() => { try { win.focus(); win.print(); } catch { /* already printed */ } }, 400);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure origins.
    const area = el('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/* =============================================================================
   MISC
   ========================================================================== */

/** Serialises a <form> into a plain object, coercing numbers and checkboxes. */
export function formData(form) {
  const out = {};
  new FormData(form).forEach((value, key) => {
    if (key in out) {
      out[key] = [].concat(out[key], value);
    } else {
      out[key] = value;
    }
  });

  // FormData omits unchecked boxes entirely — restore them as `false`.
  $$('input[type="checkbox"][name]', form).forEach((input) => {
    if (!input.multiple) out[input.name] = input.checked;
  });

  return out;
}

/** Reads ?key=value from the current URL. */
export const queryParam = (key) => new URLSearchParams(location.search).get(key);

/** Current page filename, e.g. "projects.html". */
export const currentPage = () =>
  location.pathname.split('/').pop() || 'index.html';

/** Prefers-reduced-motion check used to skip decorative work. */
export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tiny pub/sub used for cross-module events. */
export function emitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    off(event, handler) { listeners.get(event)?.delete(handler); },
    emit(event, payload) {
      listeners.get(event)?.forEach((handler) => {
        try { handler(payload); } catch (err) { console.error(`[emitter:${event}]`, err); }
      });
      listeners.get('*')?.forEach((handler) => handler({ event, payload }));
    },
  };
}
