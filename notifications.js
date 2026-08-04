/* =============================================================================
   SynthWorks — notifications.js
   Toast notifications + confirm dialogs + the success-checkmark celebration.

   Everything is created on demand; there is no markup to add to a page.
       import { toast, confirmDialog } from './notifications.js';
       toast.success('Client saved');
       if (await confirmDialog({ title: 'Delete?' })) …
   ========================================================================== */

import { el, icons, trapFocus, uid } from './utils.js';

/* =============================================================================
   TOAST STACK
   ========================================================================== */

const MAX_VISIBLE = 5;
let stack = null;

function getStack() {
  if (stack?.isConnected) return stack;
  stack = el('div', {
    class: 'toast-stack',
    role: 'region',
    'aria-label': 'Notifications',
    'aria-live': 'polite',
  });
  document.body.append(stack);
  return stack;
}

const TONE_ICON = {
  success: 'check',
  error:   'x',
  warning: 'triangle-alert',
  info:    'info',
  brand:   'sparkles',
};

/**
 * Shows a toast.
 * @param {Object}  options
 * @param {string}  options.title
 * @param {string}  [options.message]
 * @param {'success'|'error'|'warning'|'info'|'brand'} [options.tone='info']
 * @param {number}  [options.duration=4200]  0 keeps it until dismissed
 * @param {{label:string, onClick:Function}} [options.action]
 * @returns {{ id: string, dismiss: () => void }}
 */
export function notify({ title, message = '', tone = 'info', duration = 4200, action = null } = {}) {
  const host = getStack();
  const id = uid('toast');

  // Keep the stack from taking over the screen.
  while (host.children.length >= MAX_VISIBLE) host.firstElementChild?.remove();

  const node = el('div', {
    class: `toast toast--${tone}`,
    role: tone === 'error' ? 'alert' : 'status',
    dataset: { toastId: id },
  });

  node.innerHTML = `
    <span class="toast-ico"><i data-lucide="${TONE_ICON[tone] || 'info'}"></i></span>
    <div class="toast-body">
      <b></b>
      ${message ? '<p></p>' : ''}
    </div>
    <button class="toast-close" type="button" aria-label="Dismiss notification">
      <i data-lucide="x"></i>
    </button>
    ${duration > 0 ? '<span class="toast-bar"></span>' : ''}
  `;

  // Assign text content (never innerHTML) so user data can never inject markup.
  node.querySelector('.toast-body b').textContent = title;
  if (message) node.querySelector('.toast-body p').textContent = message;

  if (action?.label) {
    const btn = el('button', {
      class: 'btn btn--sm btn--ghost',
      type: 'button',
      text: action.label,
      style: { marginTop: '6px', paddingInline: '0' },
      onClick: () => { action.onClick?.(); dismiss(); },
    });
    node.querySelector('.toast-body').append(btn);
  }

  let timer = null;
  let removed = false;

  function dismiss() {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    // Safety net in case the animation event never fires.
    setTimeout(() => node.remove(), 600);
  }

  node.querySelector('.toast-close').addEventListener('click', dismiss);

  if (duration > 0) {
    const bar = node.querySelector('.toast-bar');
    if (bar) bar.style.animationDuration = `${duration}ms`;
    timer = setTimeout(dismiss, duration);

    // Pause the countdown while the pointer rests on the toast.
    node.addEventListener('mouseenter', () => {
      clearTimeout(timer);
      if (bar) bar.style.animationPlayState = 'paused';
    });
    node.addEventListener('mouseleave', () => {
      if (bar) bar.style.animationPlayState = 'running';
      timer = setTimeout(dismiss, duration / 2);
    });
  }

  host.append(node);
  icons(node);

  return { id, dismiss };
}

/** Shorthand helpers — `toast.success('Saved')` or `toast.success('Saved', 'Details')`. */
export const toast = {
  success: (title, message, opts) => notify({ title, message, tone: 'success', ...opts }),
  error:   (title, message, opts) => notify({ title, message, tone: 'error', duration: 6000, ...opts }),
  warning: (title, message, opts) => notify({ title, message, tone: 'warning', ...opts }),
  info:    (title, message, opts) => notify({ title, message, tone: 'info', ...opts }),
  brand:   (title, message, opts) => notify({ title, message, tone: 'brand', ...opts }),
  /** Realtime change made by a colleague — quieter and shorter. */
  live: (title, message) => notify({ title, message, tone: 'brand', duration: 3000 }),
};

/* =============================================================================
   CONFIRM DIALOG
   Promise-based replacement for window.confirm.
   ========================================================================== */

/**
 * @param {Object}  options
 * @param {string}  options.title
 * @param {string}  [options.message]
 * @param {string}  [options.confirmLabel='Confirm']
 * @param {string}  [options.cancelLabel='Cancel']
 * @param {boolean} [options.danger=false]
 * @param {string}  [options.icon]
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  icon = danger ? 'trash-2' : 'help-circle',
} = {}) {
  return new Promise((resolve) => {
    const root = el('div', {
      class: 'modal-root',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'confirm-title',
    });

    root.innerHTML = `
      <div class="modal modal--slim">
        <div class="modal-body" style="text-align:center;padding-top:var(--sp-8)">
          <span class="stat-icon ${danger ? 'is-danger' : ''}"
                style="width:52px;height:52px;margin:0 auto var(--sp-4)">
            <i data-lucide="${icon}" style="width:24px;height:24px"></i>
          </span>
          <h3 id="confirm-title" style="font-size:var(--fs-lg)"></h3>
          <p class="muted fs-sm mt-2" style="max-width:38ch;margin-inline:auto"></p>
        </div>
        <div class="modal-foot" style="justify-content:center">
          <button class="btn btn--secondary" data-act="cancel" type="button"></button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok" type="button"></button>
        </div>
      </div>
    `;

    root.querySelector('h3').textContent = title;
    const messageNode = root.querySelector('p');
    if (message) messageNode.textContent = message; else messageNode.remove();
    root.querySelector('[data-act="cancel"]').textContent = cancelLabel;
    root.querySelector('[data-act="ok"]').textContent = confirmLabel;

    document.body.append(root);
    icons(root);

    const releaseFocus = trapFocus(root);
    const previouslyFocused = document.activeElement;

    function close(result) {
      root.classList.remove('is-open');
      releaseFocus();
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        root.remove();
        previouslyFocused?.focus?.();
      }, 300);
      resolve(result);
    }

    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
      if (event.key === 'Enter' && document.activeElement?.dataset.act !== 'cancel') {
        event.preventDefault(); close(true);
      }
    }

    root.addEventListener('click', (event) => {
      if (event.target === root) close(false);                       // backdrop
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true);
      if (act === 'cancel') close(false);
    });
    document.addEventListener('keydown', onKey);

    // Next frame so the opening transition actually runs.
    requestAnimationFrame(() => {
      root.classList.add('is-open');
      root.querySelector('[data-act="ok"]').focus();
    });
  });
}

/* =============================================================================
   SUCCESS CELEBRATION
   A drawn checkmark over a dimmed backdrop. Used after a project completes,
   an invoice is paid, etc.
   ========================================================================== */

/**
 * @param {string} title
 * @param {string} [message]
 * @param {number} [holdMs=1700]
 * @returns {Promise<void>} resolves once it has closed
 */
export function celebrate(title, message = '', holdMs = 1700) {
  return new Promise((resolve) => {
    const root = el('div', { class: 'modal-root', role: 'status', 'aria-live': 'polite' });

    root.innerHTML = `
      <div class="modal modal--slim" style="text-align:center">
        <div class="modal-body" style="padding-block:var(--sp-10)">
          <div class="success-mark">
            <svg viewBox="0 0 60 60" aria-hidden="true">
              <circle class="sm-circle" cx="30" cy="30" r="26.5"></circle>
              <path class="sm-check" d="M18 31.5 L26.5 40 L42 23"></path>
            </svg>
          </div>
          <h3 class="mt-4" style="font-size:var(--fs-lg)"></h3>
          <p class="muted fs-sm mt-2"></p>
        </div>
      </div>
    `;
    root.querySelector('h3').textContent = title;
    const messageNode = root.querySelector('p');
    if (message) messageNode.textContent = message; else messageNode.remove();

    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('is-open'));

    const close = () => {
      root.classList.remove('is-open');
      setTimeout(() => { root.remove(); resolve(); }, 320);
    };

    const timer = setTimeout(close, holdMs);
    root.addEventListener('click', () => { clearTimeout(timer); close(); });
  });
}

/* =============================================================================
   BROWSER NOTIFICATIONS  (optional, opt-in from Settings)
   ========================================================================== */

export const desktop = {
  get supported() { return 'Notification' in window; },
  get permission() { return this.supported ? Notification.permission : 'denied'; },

  async request() {
    if (!this.supported) return 'denied';
    if (Notification.permission !== 'default') return Notification.permission;
    return Notification.requestPermission();
  },

  show(title, body, { icon, onClick } = {}) {
    if (!this.supported || Notification.permission !== 'granted') return null;
    if (document.visibilityState === 'visible') return null;   // don't nag on-screen users

    const n = new Notification(title, { body, icon, badge: icon, tag: 'synthworks' });
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
    return n;
  },
};

export default toast;
