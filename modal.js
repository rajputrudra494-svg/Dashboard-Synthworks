/* =============================================================================
   SynthWorks — modal.js
   A modal + side-drawer system and, on top of it, a declarative form builder.

   Every create/edit dialog in the app (clients, projects, tasks, transactions,
   events) is described as a field array and rendered by `formModal()`. That is
   what keeps the CRUD pages short and their markup identical.
   ========================================================================== */

import { $, $$, el, icons, trapFocus, escapeHtml, initials, colorFor } from './utils.js';

/* =============================================================================
   BASE MODAL
   ========================================================================== */

let openCount = 0;

/**
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {string} [options.icon]           Lucide icon name
 * @param {Node|string} options.body
 * @param {Node|string} [options.footer]
 * @param {'slim'|'default'|'wide'} [options.size='default']
 * @param {boolean} [options.dismissible=true]
 * @param {Function} [options.onClose]
 * @returns {{ root: HTMLElement, body: HTMLElement, close: Function }}
 */
export function openModal({
  title,
  subtitle = '',
  icon = '',
  body,
  footer = null,
  size = 'default',
  dismissible = true,
  onClose = null,
} = {}) {
  const sizeClass = size === 'wide' ? 'modal--wide' : size === 'slim' ? 'modal--slim' : '';
  const titleId = `modal-title-${openCount += 1}`;

  const root = el('div', {
    class: 'modal-root',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  });

  root.innerHTML = `
    <div class="modal ${sizeClass}">
      <div class="modal-head">
        ${icon ? `<span class="stat-icon"><i data-lucide="${escapeHtml(icon)}"></i></span>` : ''}
        <div class="grow">
          <h3 id="${titleId}"></h3>
          ${subtitle ? '<p></p>' : ''}
        </div>
        ${dismissible ? `<button class="icon-btn" type="button" data-close aria-label="Close dialog">
          <i data-lucide="x"></i></button>` : ''}
      </div>
      <div class="modal-body"></div>
    </div>`;

  root.querySelector('h3').textContent = title;
  if (subtitle) root.querySelector('.modal-head p').textContent = subtitle;

  const bodyNode = root.querySelector('.modal-body');
  if (body instanceof Node) bodyNode.append(body);
  else if (typeof body === 'string') bodyNode.innerHTML = body;

  if (footer) {
    const foot = el('div', { class: 'modal-foot' });
    if (footer instanceof Node) foot.append(footer);
    else foot.innerHTML = footer;
    root.querySelector('.modal').append(foot);
  }

  document.body.append(root);
  icons(root);

  const releaseFocus = trapFocus(root);
  const previouslyFocused = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    root.classList.remove('is-open');
    releaseFocus();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = previousOverflow;
    setTimeout(() => {
      root.remove();
      previouslyFocused?.focus?.();
      onClose?.(result);
    }, 300);
  }

  function onKey(event) {
    if (event.key === 'Escape' && dismissible) { event.preventDefault(); close(); }
  }

  root.addEventListener('click', (event) => {
    if (dismissible && event.target === root) close();
    if (event.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  requestAnimationFrame(() => {
    root.classList.add('is-open');
    // Focus the first real control, not the close button.
    const first = $$('input, select, textarea, button:not([data-close])', root)
      .find((node) => node.offsetParent !== null);
    first?.focus();
  });

  return { root, body: bodyNode, close };
}

/* =============================================================================
   SIDE DRAWER  (detail views)
   ========================================================================== */

export function openDrawer({ title, subtitle = '', body, footer = null, onClose = null } = {}) {
  const root = el('div', { class: 'drawer-root', role: 'dialog', 'aria-modal': 'true' });

  root.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <div class="grow">
          <h3></h3>
          ${subtitle ? '<p class="muted fs-sm"></p>' : ''}
        </div>
        <button class="icon-btn" type="button" data-close aria-label="Close panel">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="drawer-body"></div>
    </div>`;

  root.querySelector('h3').textContent = title;
  if (subtitle) root.querySelector('.drawer-head p').textContent = subtitle;

  const bodyNode = root.querySelector('.drawer-body');
  if (body instanceof Node) bodyNode.append(body);
  else if (typeof body === 'string') bodyNode.innerHTML = body;

  if (footer) {
    const foot = el('div', { class: 'drawer-foot' });
    if (footer instanceof Node) foot.append(footer); else foot.innerHTML = footer;
    root.querySelector('.drawer').append(foot);
  }

  document.body.append(root);
  icons(root);

  const releaseFocus = trapFocus(root);
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    root.classList.remove('is-open');
    releaseFocus();
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { root.remove(); onClose?.(); }, 400);
  }
  function onKey(event) { if (event.key === 'Escape') close(); }

  root.addEventListener('click', (event) => {
    if (event.target === root || event.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => root.classList.add('is-open'));

  return { root, body: bodyNode, close };
}

/* =============================================================================
   FIELD RENDERERS
   ========================================================================== */

function fieldId(name) { return `f-${name}-${Math.random().toString(36).slice(2, 7)}`; }

function renderField(field, value) {
  const id = fieldId(field.name);
  const wrap = el('div', {
    class: 'field',
    style: field.span === 2 ? { gridColumn: '1 / -1' } : {},
    dataset: { field: field.name },
  });

  const required = field.required ? '<span class="req" aria-hidden="true">*</span>' : '';
  const label = field.type === 'switch'
    ? ''
    : `<label for="${id}">${escapeHtml(field.label)}${required}</label>`;

  const attrs = [
    `id="${id}"`,
    `name="${escapeHtml(field.name)}"`,
    field.required ? 'required' : '',
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
    field.min != null ? `min="${field.min}"` : '',
    field.max != null ? `max="${field.max}"` : '',
    field.step != null ? `step="${field.step}"` : '',
    field.maxlength ? `maxlength="${field.maxlength}"` : '',
  ].filter(Boolean).join(' ');

  const safeValue = value == null ? '' : escapeHtml(value);

  switch (field.type) {
    case 'textarea':
      wrap.innerHTML = `${label}<textarea ${attrs} rows="${field.rows || 4}">${safeValue}</textarea>`;
      break;

    case 'select': {
      const options = (field.options || []).map((opt) => {
        const optValue = typeof opt === 'object' ? opt.value : opt;
        const optLabel = typeof opt === 'object' ? opt.label : opt;
        const selected = String(optValue) === String(value ?? '') ? ' selected' : '';
        return `<option value="${escapeHtml(optValue)}"${selected}>${escapeHtml(optLabel)}</option>`;
      }).join('');
      const blank = field.allowEmpty
        ? `<option value=""${value ? '' : ' selected'}>${escapeHtml(field.emptyLabel || '— None —')}</option>`
        : '';
      wrap.innerHTML = `${label}<select ${attrs}>${blank}${options}</select>`;
      break;
    }

    case 'money':
      wrap.innerHTML = `${label}
        <div class="input-group">
          <span class="affix affix--left">${escapeHtml(field.symbol || '$')}</span>
          <input type="number" step="0.01" min="0" ${attrs} value="${safeValue}">
        </div>`;
      break;

    case 'switch':
      wrap.innerHTML = `
        <label class="switch">
          <input type="checkbox" id="${id}" name="${escapeHtml(field.name)}"${value ? ' checked' : ''}>
          <span class="track"></span>
          <span class="fs-sm w-600">${escapeHtml(field.label)}</span>
        </label>
        ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}`;
      return wrap;

    case 'range':
      wrap.innerHTML = `${label}
        <div class="flex items-center gap-3">
          <input type="range" ${attrs} value="${safeValue || 0}" style="flex:1;min-height:auto;padding:0">
          <output class="mono fs-sm w-600" style="min-width:44px;text-align:right">${safeValue || 0}%</output>
        </div>`;
      wrap.querySelector('input').addEventListener('input', (event) => {
        wrap.querySelector('output').textContent = `${event.target.value}%`;
      });
      break;

    case 'color': {
      const swatches = field.options || ['#7C3AED', '#A855F7', '#D946EF', '#EC4899', '#3B82F6', '#06B6D4', '#22C55E', '#F59E0B', '#EF4444'];
      wrap.innerHTML = `${label}
        <div class="flex wrap gap-2" role="radiogroup" aria-label="${escapeHtml(field.label)}">
          ${swatches.map((color) => `
            <button type="button" class="swatch${color === value ? ' is-on' : ''}"
                    role="radio" aria-checked="${color === value}" data-color="${color}"
                    style="width:30px;height:30px;border-radius:9px;background:${color};
                           border:2px solid ${color === value ? 'var(--text)' : 'transparent'};
                           transition:transform .16s var(--ease-spring)"></button>`).join('')}
        </div>
        <input type="hidden" name="${escapeHtml(field.name)}" value="${safeValue || swatches[0]}">`;

      wrap.addEventListener('click', (event) => {
        const swatch = event.target.closest('.swatch');
        if (!swatch) return;
        $$('.swatch', wrap).forEach((node) => {
          node.style.borderColor = 'transparent';
          node.setAttribute('aria-checked', 'false');
        });
        swatch.style.borderColor = 'var(--text)';
        swatch.setAttribute('aria-checked', 'true');
        wrap.querySelector('input[type="hidden"]').value = swatch.dataset.color;
      });
      break;
    }

    case 'members': {
      const selected = new Set(Array.isArray(value) ? value : []);
      wrap.innerHTML = `${label}
        <div class="member-picker">
          ${(field.options || []).map((member) => `
            <button type="button" class="member-opt${selected.has(member.id) ? ' is-on' : ''}"
                    data-id="${escapeHtml(member.id)}" aria-pressed="${selected.has(member.id)}">
              <span class="avatar avatar--xs" style="background:${colorFor(member.id)}">
                ${member.avatar_url
                  ? `<img src="${escapeHtml(member.avatar_url)}" alt="">`
                  : escapeHtml(initials(member.full_name))}
              </span>
              ${escapeHtml(member.full_name)}
            </button>`).join('')}
        </div>
        <input type="hidden" name="${escapeHtml(field.name)}" value="${[...selected].join(',')}">`;

      wrap.addEventListener('click', (event) => {
        const option = event.target.closest('.member-opt');
        if (!option) return;
        const on = option.classList.toggle('is-on');
        option.setAttribute('aria-pressed', String(on));
        on ? selected.add(option.dataset.id) : selected.delete(option.dataset.id);
        wrap.querySelector('input[type="hidden"]').value = [...selected].join(',');
      });
      break;
    }

    case 'tags': {
      const tags = new Set(Array.isArray(value) ? value : (value ? String(value).split(',') : []));
      wrap.innerHTML = `${label}
        <div class="multiselect">
          <span class="tag-host flex wrap gap-1"></span>
          <input type="text" placeholder="${escapeHtml(field.placeholder || 'Type and press Enter')}"
                 aria-label="${escapeHtml(field.label)}">
        </div>
        <input type="hidden" name="${escapeHtml(field.name)}" value="${[...tags].join(',')}">`;

      const host = wrap.querySelector('.tag-host');
      const hidden = wrap.querySelector('input[type="hidden"]');
      const input = wrap.querySelector('.multiselect input[type="text"]');

      const paint = () => {
        host.innerHTML = [...tags].map((tag) => `
          <span class="chip">${escapeHtml(tag)}
            <button type="button" data-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">
              <i data-lucide="x" style="width:11px;height:11px"></i>
            </button>
          </span>`).join('');
        hidden.value = [...tags].join(',');
        icons(host);
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          const tag = input.value.trim().replace(/,$/, '');
          if (tag && !tags.has(tag)) { tags.add(tag); paint(); }
          input.value = '';
        }
        if (event.key === 'Backspace' && !input.value && tags.size) {
          tags.delete([...tags].pop());
          paint();
        }
      });
      host.addEventListener('click', (event) => {
        const button = event.target.closest('[data-tag]');
        if (!button) return;
        tags.delete(button.dataset.tag);
        paint();
      });
      wrap.querySelector('.multiselect').addEventListener('click', () => input.focus());
      paint();
      break;
    }

    default:
      wrap.innerHTML = `${label}<input type="${field.type || 'text'}" ${attrs} value="${safeValue}">`;
  }

  if (field.hint && field.type !== 'switch') {
    wrap.append(el('span', { class: 'hint', text: field.hint }));
  }

  return wrap;
}

/* =============================================================================
   FORM MODAL
   ========================================================================== */

/**
 * Renders a form inside a modal and resolves with the submitted values.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {string} [options.icon]
 * @param {Array}  options.fields         see renderField() for the field spec
 * @param {Object} [options.values]       initial values keyed by field name
 * @param {string} [options.submitLabel='Save']
 * @param {'slim'|'default'|'wide'} [options.size='default']
 * @param {(values: Object) => Promise<any>} options.onSubmit
 *        Throw inside onSubmit to keep the dialog open and show the message.
 * @returns {Promise<any|null>} onSubmit's return value, or null if cancelled
 */
export function formModal({
  title,
  subtitle = '',
  icon = '',
  fields = [],
  values = {},
  submitLabel = 'Save',
  size = 'default',
  onSubmit,
} = {}) {
  return new Promise((resolve) => {
    const form = el('form', { class: 'form-grid', novalidate: true });

    // Two-column grid on anything but the slim size.
    const grid = el('div', {
      class: 'field-row',
      style: size === 'slim' ? { gridTemplateColumns: '1fr' } : {},
    });

    fields.forEach((field) => {
      if (field.when && !field.when(values)) return;
      grid.append(renderField(field, values[field.name] ?? field.value ?? ''));
    });
    form.append(grid);

    const errorBox = el('div', { class: 'field-error', style: { display: 'none' } });
    form.append(errorBox);

    const footer = el('div', { class: 'flex gap-2' });
    footer.innerHTML = `
      <button class="btn btn--secondary" type="button" data-close>Cancel</button>
      <button class="btn btn--primary" type="submit">${escapeHtml(submitLabel)}</button>`;

    let settled = false;
    const modal = openModal({
      title, subtitle, icon, size,
      body: form,
      footer,
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
    });

    // The submit button lives in the footer, outside <form> — wire it manually.
    modal.root.querySelector('[type="submit"]').addEventListener('click', () => {
      form.requestSubmit();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      // Native validation first — free, accessible, localised.
      $$('.field', form).forEach((node) => node.classList.remove('has-error'));
      if (!form.checkValidity()) {
        const invalid = form.querySelector(':invalid');
        invalid?.closest('.field')?.classList.add('has-error');
        invalid?.focus();
        errorBox.style.display = 'flex';
        errorBox.innerHTML = '<i data-lucide="alert-circle"></i> Please fill in the required fields.';
        icons(errorBox);
        return;
      }

      const submitBtn = modal.root.querySelector('[type="submit"]');
      submitBtn.classList.add('is-loading');
      errorBox.style.display = 'none';

      try {
        const result = await onSubmit(readForm(form, fields));
        settled = true;
        modal.close();
        resolve(result ?? true);
      } catch (err) {
        submitBtn.classList.remove('is-loading');
        errorBox.style.display = 'flex';
        errorBox.innerHTML = `<i data-lucide="alert-circle"></i> <span></span>`;
        errorBox.querySelector('span').textContent = err.message || 'Could not save.';
        icons(errorBox);
      }
    });
  });
}

/** Reads a form into typed values using the field spec. */
export function readForm(form, fields) {
  const raw = Object.fromEntries(new FormData(form).entries());
  const out = {};

  fields.forEach((field) => {
    const value = raw[field.name];

    switch (field.type) {
      case 'switch':
        out[field.name] = form.querySelector(`[name="${field.name}"]`)?.checked || false;
        break;

      case 'number':
      case 'money':
      case 'range':
        out[field.name] = value === '' || value == null ? (field.required ? 0 : null) : Number(value);
        break;

      case 'members':
      case 'tags':
        out[field.name] = value ? String(value).split(',').filter(Boolean) : [];
        break;

      default:
        out[field.name] = value === '' ? null : value;
    }
  });

  return out;
}

export default openModal;
