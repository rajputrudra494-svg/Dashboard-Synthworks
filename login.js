/* =============================================================================
   SynthWorks — login.js
   Page controller for login.html.

   Drives five panels from one card: sign in, sign up, forgot password, set a
   new password (arriving from the emailed link) and the "check your inbox"
   confirmation.
   ========================================================================== */

import { sb, isConfigured } from './supabase.js';
import {
  signIn, signUp, resetPassword, updatePassword, redirectIfAuthed, showSetupNotice,
} from './auth.js';
import { $, $$, icons, storage, emailValid, passwordScore, queryParam } from './utils.js';
import { toast } from './notifications.js';
import { initAnimations, initCounters, confetti } from './animations.js';

const HOME = 'dashboard.html';

/* =============================================================================
   PANEL SWITCHING
   ========================================================================== */

function showPanel(name) {
  $$('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });

  // The tab strip only makes sense for the two primary panels.
  const tabs = $('.auth-tabs');
  if (tabs) tabs.hidden = !['login', 'signup'].includes(name);

  $$('.auth-tabs button').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  // Focus the first field so keyboard users land in the right place.
  requestAnimationFrame(() => {
    const panel = $(`[data-panel="${name}"]`);
    panel?.querySelector('input:not([type="checkbox"])')?.focus();
    icons(panel || document);
  });

  history.replaceState(null, '', name === 'login' ? location.pathname : `?mode=${name}`);
}

/* =============================================================================
   FORM HELPERS
   ========================================================================== */

function showError(id, message) {
  const box = $(`#${id}`);
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '<i data-lucide="alert-circle"></i> <span></span>';
  box.querySelector('span').textContent = message;
  icons(box);
}

function clearError(id) {
  const box = $(`#${id}`);
  if (box) box.hidden = true;
}

function busy(buttonId, state) {
  $(`#${buttonId}`)?.classList.toggle('is-loading', state);
}

/** Eye toggles on every password field. */
function initPasswordToggles() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle-password]');
    if (!button) return;

    const input = $(`#${button.dataset.togglePassword}`);
    if (!input) return;

    const revealed = input.type === 'text';
    input.type = revealed ? 'password' : 'text';
    button.innerHTML = `<i data-lucide="${revealed ? 'eye' : 'eye-off'}"></i>`;
    button.setAttribute('aria-label', revealed ? 'Show password' : 'Hide password');
    icons(button);
    input.focus();
  });
}

/** Live strength meter on the sign-up password. */
function initStrengthMeter() {
  const input = $('#signupPassword');
  const meter = $('#strengthMeter');
  const hint = $('#strengthHint');
  if (!input || !meter) return;

  const LABELS = [
    'Use 8+ characters with a mix of letters, numbers and symbols.',
    'Weak — add more characters.',
    'Fair — mix in numbers or symbols.',
    'Good — nearly there.',
    'Strong password.',
  ];

  input.addEventListener('input', () => {
    const score = input.value ? passwordScore(input.value) : 0;
    meter.dataset.level = String(score);
    hint.textContent = LABELS[score];
    hint.style.color = score >= 3 ? 'var(--success)' : score >= 2 ? 'var(--warning)' : '';
  });
}

/* =============================================================================
   SUBMIT HANDLERS
   ========================================================================== */

function initLoginForm() {
  const form = $('#loginForm');
  if (!form) return;

  // Pre-fill the remembered email so returning users only type a password.
  const lastEmail = storage.get('lastEmail');
  if (lastEmail) {
    $('#loginEmail').value = lastEmail;
    requestAnimationFrame(() => $('#loginPassword').focus());
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError('loginError');

    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const remember = $('#remember').checked;

    if (!emailValid(email)) { showError('loginError', 'Enter a valid email address.'); return; }
    if (!password) { showError('loginError', 'Enter your password.'); return; }

    busy('loginSubmit', true);
    try {
      await signIn(email, password, remember);
      toast.success('Welcome back', 'Loading your workspace…');

      const back = storage.get('redirect');
      storage.remove('redirect');
      setTimeout(() => location.replace(back || HOME), 420);
    } catch (err) {
      busy('loginSubmit', false);
      showError('loginError', err.message);
      form.classList.add('shake-once');
      setTimeout(() => form.classList.remove('shake-once'), 420);
    }
  });
}

function initSignupForm() {
  const form = $('#signupForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError('signupError');

    const fullName = $('#signupName').value.trim();
    const jobTitle = $('#signupRole').value.trim() || 'Team Member';
    const email = $('#signupEmail').value.trim();
    const password = $('#signupPassword').value;

    if (fullName.length < 2) { showError('signupError', 'Please enter your full name.'); return; }
    if (!emailValid(email)) { showError('signupError', 'Enter a valid email address.'); return; }
    if (password.length < 8) { showError('signupError', 'Passwords must be at least 8 characters.'); return; }

    busy('signupSubmit', true);
    try {
      const { needsConfirmation } = await signUp({ fullName, email, password, jobTitle });

      if (needsConfirmation) {
        $('#sentTitle').textContent = 'Confirm your email';
        $('#sentBody').textContent =
          `We sent a confirmation link to ${email}. Click it and you're in.`;
        showPanel('sent');
        icons();
        return;
      }

      confetti({ count: 90 });
      toast.success('Account created', 'Setting up your workspace…');
      setTimeout(() => location.replace(HOME), 900);
    } catch (err) {
      busy('signupSubmit', false);
      showError('signupError', err.message);
    }
  });
}

function initForgotForm() {
  const form = $('#forgotForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError('forgotError');

    const email = $('#forgotEmail').value.trim();
    if (!emailValid(email)) { showError('forgotError', 'Enter a valid email address.'); return; }

    busy('forgotSubmit', true);
    try {
      await resetPassword(email);
      $('#sentTitle').textContent = 'Check your inbox';
      $('#sentBody').textContent =
        `If an account exists for ${email}, a reset link is on its way.`;
      showPanel('sent');
      icons();
    } catch (err) {
      showError('forgotError', err.message);
    } finally {
      busy('forgotSubmit', false);
    }
  });
}

function initRecoverForm() {
  const form = $('#recoverForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError('recoverError');

    const password = $('#recoverPassword').value;
    const confirm = $('#recoverConfirm').value;

    if (password.length < 8) { showError('recoverError', 'Passwords must be at least 8 characters.'); return; }
    if (password !== confirm) { showError('recoverError', 'Those passwords do not match.'); return; }

    busy('recoverSubmit', true);
    try {
      await updatePassword(password);
      toast.success('Password updated', 'Taking you to the dashboard…');
      confetti({ count: 70 });
      setTimeout(() => location.replace(HOME), 900);
    } catch (err) {
      busy('recoverSubmit', false);
      showError('recoverError', err.message);
    }
  });
}

/* =============================================================================
   THEME TOGGLE  (the auth screen has no top bar)
   ========================================================================== */

function initTheme() {
  const button = $('#themeToggle');
  if (!button) return;

  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
    button.dataset.tip = dark ? 'Light mode' : 'Dark mode';
    icons(button);
  };

  button.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.classList.add('theme-transition');
    root.dataset.theme = next;
    storage.set('theme', next);
    setTimeout(() => root.classList.remove('theme-transition'), 480);
    paint();
  });

  paint();
}

/* =============================================================================
   BOOT
   ========================================================================== */

async function boot() {
  icons();
  initTheme();
  initAnimations({ particles: true });
  initCounters();
  initPasswordToggles();
  initStrengthMeter();

  if (!isConfigured || !sb) {
    showSetupNotice();
    return;
  }

  // Supabase appends #access_token=…&type=recovery when the emailed link is
  // followed. detectSessionInUrl consumes it, so check both places.
  const hash = new URLSearchParams(location.hash.slice(1));
  const isRecovery = queryParam('mode') === 'recover' || hash.get('type') === 'recovery';

  if (isRecovery) {
    showPanel('recover');
  } else if (await redirectIfAuthed()) {
    return;                                    // already signed in — leaving
  } else {
    showPanel(queryParam('mode') === 'signup' ? 'signup' : 'login');
  }

  initLoginForm();
  initSignupForm();
  initForgotForm();
  initRecoverForm();

  // Tab strip + inline "create one" / "sign in" / "forgot" links.
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-tab], [data-goto]');
    if (!target) return;
    showPanel(target.dataset.tab || target.dataset.goto);
  });

  // Entrance.
  if (window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.gsap.from('.auth-card > *', {
      y: 18, opacity: 0, duration: 0.55, stagger: 0.06, ease: 'power3.out', clearProps: 'all',
    });
    window.gsap.from('.auth-visual > *', {
      x: -22, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out', clearProps: 'all',
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
