/* =============================================================================
   SynthWorks — settings.js
   Profile, workspace, appearance, notifications, security and data export.

   Two scopes live on this page and it matters which is which:
     • Workspace settings are SHARED — saving them changes the app for everyone
       and broadcasts over realtime.
     • Preferences are YOURS — kept in localStorage and mirrored to a per-user
       row in `settings` so they follow you to another device.
   ========================================================================== */

import { requireAuth, auth, updateProfile, uploadAvatar, updatePassword } from './auth.js';
import { store } from './store.js';
import { CONFIG } from './supabase.js';
import { initShell, theme } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initReveal, animatePage,
} from './animations.js';
import { toast, confirmDialog, desktop, celebrate } from './notifications.js';
import {
  $, $$, icons, escapeHtml, storage, initials, passwordScore, money, num,
  fmtDate, timeAgo, exportCSV, download, isoDate, titleCase, debounce,
} from './utils.js';

/* Defaults for every per-user preference this page can toggle. */
const DEFAULT_PREFS = {
  themeChoice: 'dark',
  reduceMotion: false,
  compactSidebar: false,
  liveToasts: true,
  taskAssigned: true,
  deadlines: true,
  desktopNotifications: false,
};

let prefs = { ...DEFAULT_PREFS };

/* =============================================================================
   PROFILE
   ========================================================================== */

function paintAvatar() {
  const node = $('#avatarPreview');
  if (!node) return;

  const profile = auth.profile;
  node.innerHTML = profile?.avatar_url
    ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">`
    : escapeHtml(initials(auth.displayName));
}

function fillProfileForm() {
  const profile = auth.profile;
  if (!profile) return;

  $('#fullName').value = profile.full_name || '';
  $('#jobTitle').value = profile.job_title || '';
  $('#profileEmail').value = profile.email || '';
  $('#profilePhone').value = profile.phone || '';
  $('#profileBio').value = profile.bio || '';
  paintAvatar();
}

function initProfile() {
  fillProfileForm();

  $('#profileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = $('#saveProfile');
    const fullName = $('#fullName').value.trim();

    if (fullName.length < 2) {
      toast.warning('Name too short', 'Please enter your full name.');
      return;
    }

    button.classList.add('is-loading');
    try {
      await updateProfile({
        full_name: fullName,
        job_title: $('#jobTitle').value.trim() || null,
        phone: $('#profilePhone').value.trim() || null,
        bio: $('#profileBio').value.trim() || null,
      });
      toast.success('Profile saved', 'Your colleagues will see the update immediately.');
    } catch (err) {
      toast.error('Could not save profile', err.message);
    } finally {
      button.classList.remove('is-loading');
    }
  });

  // Reset restores the saved values rather than clearing the form.
  $('#profileForm')?.addEventListener('reset', (event) => {
    event.preventDefault();
    fillProfileForm();
    toast.info('Changes discarded');
  });

  $('#avatarInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const progress = toast.info('Uploading photo…', file.name, { duration: 0 });
    try {
      await uploadAvatar(file);
      paintAvatar();
      progress.dismiss();
      toast.success('Photo updated');
    } catch (err) {
      progress.dismiss();
      toast.error('Upload failed', err.message);
    } finally {
      event.target.value = '';
    }
  });

  $('#removeAvatar')?.addEventListener('click', async () => {
    if (!auth.profile?.avatar_url) { toast.info('No photo to remove'); return; }

    const ok = await confirmDialog({
      title: 'Remove your photo?',
      message: 'Your initials will be shown instead.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;

    try {
      await updateProfile({ avatar_url: null });
      paintAvatar();
      toast.success('Photo removed');
    } catch (err) {
      toast.error('Could not remove photo', err.message);
    }
  });
}

/* =============================================================================
   WORKSPACE  (shared)
   ========================================================================== */

function fillWorkspaceForm() {
  const workspace = store.workspace();
  $('#companyName').value = workspace.company_name || 'SynthWorks';
  $('#tagline').value = workspace.tagline || '';
  $('#currency').value = workspace.currency || 'USD';
  $('#weekStart').value = String(workspace.week_start ?? 1);
}

/** Currency symbols we can resolve without a network lookup. */
function symbolFor(code) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value || '$';
  } catch {
    return '$';
  }
}

function initWorkspace() {
  fillWorkspaceForm();

  $('#workspaceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = $('#saveWorkspace');
    const companyName = $('#companyName').value.trim();

    if (!companyName) { toast.warning('Company name is required'); return; }

    button.classList.add('is-loading');
    try {
      const currency = $('#currency').value;
      await store.saveWorkspace({
        company_name: companyName,
        tagline: $('#tagline').value.trim() || null,
        currency,
        currency_symbol: symbolFor(currency),
        week_start: Number($('#weekStart').value),
      });

      toast.success('Workspace updated', 'Everyone sees the change right away.');
      store.pushNotification({
        title: 'Workspace settings changed',
        body: `${auth.displayName} updated the workspace configuration.`,
        type: 'info',
        link: 'settings.html',
      });
    } catch (err) {
      toast.error('Could not save', err.message);
    } finally {
      button.classList.remove('is-loading');
    }
  });

  // Another person editing the workspace refreshes this form live.
  store.on('workspace:change', fillWorkspaceForm);
}

/* =============================================================================
   APPEARANCE
   ========================================================================== */

function paintThemeCards() {
  $$('#themeCards [data-theme-choice]').forEach((card) => {
    const active = card.dataset.themeChoice === prefs.themeChoice;
    card.classList.toggle('is-on', active);
    card.setAttribute('aria-checked', String(active));
  });
}

function applyThemeChoice(choice) {
  prefs.themeChoice = choice;

  if (choice === 'system') {
    // Clearing the stored value is what re-enables OS following in shell.js.
    storage.remove('theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    theme.set(prefersLight ? 'light' : 'dark');
    storage.remove('theme');
  } else {
    theme.set(choice);
  }

  paintThemeCards();
  savePrefs();
}

function initAppearance() {
  paintThemeCards();

  $('#themeCards')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-theme-choice]');
    if (!card) return;
    applyThemeChoice(card.dataset.themeChoice);
    toast.success('Theme updated', titleCase(card.dataset.themeChoice));
  });

  const motion = $('#prefReduceMotion');
  if (motion) {
    motion.checked = prefs.reduceMotion;
    motion.addEventListener('change', () => {
      prefs.reduceMotion = motion.checked;
      document.documentElement.classList.toggle('calm-motion', motion.checked);
      savePrefs();
      toast.info(motion.checked ? 'Motion reduced' : 'Motion restored',
                 'Reload the page to apply it everywhere.');
    });
  }

  const compact = $('#prefCompactSidebar');
  if (compact) {
    compact.checked = prefs.compactSidebar;
    compact.addEventListener('change', () => {
      prefs.compactSidebar = compact.checked;
      storage.set('sidebarCollapsed', compact.checked);
      $('.app')?.classList.toggle('is-collapsed', compact.checked);
      window.dispatchEvent(new Event('resize'));
      savePrefs();
    });
  }
}

/* =============================================================================
   NOTIFICATIONS
   ========================================================================== */

function initNotifications() {
  const bindings = [
    ['#prefLiveToasts', 'liveToasts'],
    ['#prefTaskAssigned', 'taskAssigned'],
    ['#prefDeadlines', 'deadlines'],
  ];

  bindings.forEach(([selector, key]) => {
    const input = $(selector);
    if (!input) return;
    input.checked = prefs[key];
    input.addEventListener('change', () => {
      prefs[key] = input.checked;
      savePrefs();
    });
  });

  const desktopToggle = $('#prefDesktop');
  if (desktopToggle) {
    desktopToggle.checked = prefs.desktopNotifications && desktop.permission === 'granted';

    desktopToggle.addEventListener('change', async () => {
      if (!desktopToggle.checked) {
        prefs.desktopNotifications = false;
        savePrefs();
        return;
      }

      if (!desktop.supported) {
        desktopToggle.checked = false;
        toast.error('Not supported', 'This browser cannot show desktop notifications.');
        return;
      }

      const permission = await desktop.request();
      if (permission !== 'granted') {
        desktopToggle.checked = false;
        toast.warning('Permission denied',
          'Allow notifications for this site in your browser settings.');
        return;
      }

      prefs.desktopNotifications = true;
      savePrefs();
      toast.success('Desktop notifications on');
    });
  }

  $('#testNotification')?.addEventListener('click', () => {
    toast.brand('Test notification', 'This is what a live update looks like.');
    if (prefs.desktopNotifications && desktop.permission === 'granted') {
      desktop.show('SynthWorks', 'Desktop notifications are working.');
    }
  });
}

/* =============================================================================
   SECURITY
   ========================================================================== */

function initSecurity() {
  const password = $('#newPassword');
  const meter = $('#pwStrength');

  password?.addEventListener('input', () => {
    if (meter) meter.dataset.level = String(password.value ? passwordScore(password.value) : 0);
  });

  // Eye toggle (the same behaviour as the login page).
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle-password]');
    if (!button) return;

    const input = $(`#${button.dataset.togglePassword}`);
    if (!input) return;

    const revealed = input.type === 'text';
    input.type = revealed ? 'password' : 'text';
    button.innerHTML = `<i data-lucide="${revealed ? 'eye' : 'eye-off'}"></i>`;
    icons(button);
  });

  $('#passwordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const errorBox = $('#passwordError');
    const button = $('#savePassword');
    const value = password.value;
    const confirm = $('#confirmPassword').value;

    const fail = (message) => {
      errorBox.hidden = false;
      errorBox.innerHTML = '<i data-lucide="alert-circle"></i> <span></span>';
      errorBox.querySelector('span').textContent = message;
      icons(errorBox);
    };

    errorBox.hidden = true;

    if (value.length < 8) { fail('Passwords must be at least 8 characters.'); return; }
    if (value !== confirm) { fail('Those passwords do not match.'); return; }
    if (passwordScore(value) < 2) { fail('That password is too weak — mix in numbers or symbols.'); return; }

    button.classList.add('is-loading');
    try {
      await updatePassword(value);
      $('#passwordForm').reset();
      if (meter) meter.dataset.level = '0';
      await celebrate('Password updated', 'Your account is secured with the new password.');
    } catch (err) {
      fail(err.message);
    } finally {
      button.classList.remove('is-loading');
    }
  });
}

/* =============================================================================
   DATA EXPORT
   ========================================================================== */

const EXPORTS = {
  clients: () => ({
    rows: store.clients.all,
    columns: [
      { key: 'name', label: 'Client' },
      { key: 'company', label: 'Company' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
      { key: 'address', label: 'Address' },
      { key: 'created_at', label: 'Added', map: (row) => fmtDate(row.created_at) },
    ],
  }),

  projects: () => ({
    rows: store.projects.all,
    columns: [
      { key: 'name', label: 'Project' },
      { key: 'client', label: 'Client', map: (row) => store.clients.get(row.client_id)?.name || 'Internal' },
      { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
      { key: 'priority', label: 'Priority', map: (row) => titleCase(row.priority) },
      { key: 'progress', label: 'Progress %' },
      { key: 'budget', label: 'Budget', map: (row) => Number(row.budget).toFixed(2) },
      { key: 'deadline', label: 'Deadline', map: (row) => (row.deadline ? fmtDate(row.deadline) : '') },
    ],
  }),

  tasks: () => ({
    rows: store.tasks.all,
    columns: [
      { key: 'title', label: 'Task' },
      { key: 'project', label: 'Project', map: (row) => store.projects.get(row.project_id)?.name || '' },
      { key: 'assignee', label: 'Assignee', map: (row) => store.profiles.get(row.assignee_id)?.full_name || '' },
      { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
      { key: 'priority', label: 'Priority', map: (row) => titleCase(row.priority) },
      { key: 'due_date', label: 'Due', map: (row) => (row.due_date ? fmtDate(row.due_date) : '') },
      { key: 'labels', label: 'Labels', map: (row) => (row.labels || []).join('; ') },
    ],
  }),

  finance: () => ({
    rows: store.finance_transactions.all,
    columns: [
      { key: 'occurred_on', label: 'Date', map: (row) => fmtDate(row.occurred_on) },
      { key: 'title', label: 'Description' },
      { key: 'type', label: 'Type', map: (row) => titleCase(row.type) },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
      { key: 'invoice_no', label: 'Invoice' },
      { key: 'amount', label: 'Amount', map: (row) => Number(row.amount).toFixed(2) },
    ],
  }),
};

function initDataExport() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-export]');
    if (!button) return;

    const kind = button.dataset.export;

    if (kind === 'all') {
      const snapshot = {
        exported_at: new Date().toISOString(),
        workspace: store.workspace(),
        clients: store.clients.all,
        projects: store.projects.all,
        tasks: store.tasks.all,
        finance_transactions: store.finance_transactions.all,
        calendar_events: store.calendar_events.all,
        profiles: store.profiles.all.map(({ id, full_name, email, job_title, role }) =>
          ({ id, full_name, email, job_title, role })),
      };

      download(
        new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
        `synthworks-snapshot-${isoDate()}.json`,
      );
      toast.success('Snapshot downloaded', 'A full JSON copy of the workspace.');
      return;
    }

    const config = EXPORTS[kind]?.();
    if (!config) return;

    if (!config.rows.length) {
      toast.warning('Nothing to export', `There are no ${kind} yet.`);
      return;
    }

    exportCSV(config.rows, config.columns, `synthworks-${kind}-${isoDate()}.csv`);
    toast.success('Export ready', `${config.rows.length} ${kind} written to CSV.`);
  });
}

/* =============================================================================
   SIDE PANELS
   ========================================================================== */

function renderWorkspaceStats() {
  const host = $('#workspaceStats');
  if (!host) return;

  const finance = store.financeSummary();

  const rows = [
    ['Team members', num(store.profiles.count)],
    ['Clients', num(store.clients.count)],
    ['Projects', num(store.projects.count)],
    ['Tasks', num(store.tasks.count)],
    ['Transactions', num(store.finance_transactions.count)],
    ['Lifetime revenue', money(finance.income, { compact: true })],
  ];

  host.innerHTML = rows.map(([label, value]) => `
    <div class="cli-row">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
    </div>`).join('');
}

function renderConnectionInfo() {
  const host = $('#connectionInfo');
  if (!host) return;

  const state = store.realtimeState;
  const tone = state === 'live' ? 'is-success' : state === 'down' ? 'is-danger' : 'is-warning';
  // Show only the project ref, never the key.
  const projectRef = (() => {
    try { return new URL(CONFIG.url).hostname.split('.')[0]; }
    catch { return '—'; }
  })();

  host.innerHTML = `
    <div class="cli-row">
      <span>Realtime</span>
      <span class="badge ${tone}">${escapeHtml(titleCase(state))}</span>
    </div>
    <div class="cli-row">
      <span>Supabase project</span>
      <b class="mono fs-xs truncate">${escapeHtml(projectRef)}</b>
    </div>
    <div class="cli-row">
      <span>Signed in as</span>
      <b class="truncate">${escapeHtml(auth.profile?.email || '—')}</b>
    </div>
    <div class="cli-row">
      <span>Member since</span>
      <b>${escapeHtml(auth.profile ? fmtDate(auth.profile.created_at, 'short') : '—')}</b>
    </div>
    <div class="cli-row">
      <span>Last activity</span>
      <b>${escapeHtml(auth.profile ? timeAgo(auth.profile.last_seen_at) : '—')}</b>
    </div>`;
}

/* =============================================================================
   IN-PAGE NAVIGATION
   ========================================================================== */

function initSectionNav() {
  const links = $$('.settings-nav .nav-item');
  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if (!sections.length) return;

  // Smooth scroll that accounts for the sticky top bar.
  $('.settings-nav')?.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;

    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;

    event.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', link.getAttribute('href'));
  });

  // Highlight whichever section is in view.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => {
        link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
      });
    });
  }, { rootMargin: '-96px 0px -60% 0px' });

  sections.forEach((section) => observer.observe(section));

  // Honour a hash in the URL on load (settings.html#preferences).
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 96 });
      });
    }
  }
}

/* =============================================================================
   PREFERENCE PERSISTENCE
   ========================================================================== */

const savePrefs = debounce(async () => {
  try {
    await store.savePreferences(prefs);
  } catch (err) {
    console.warn('[settings] preference sync failed', err);
  }
}, 500);

async function loadPrefs() {
  const remote = await store.loadPreferences();
  prefs = { ...DEFAULT_PREFS, ...storage.get('prefs', {}), ...remote };

  // The stored theme wins over the preference record so a device-local switch
  // from the top bar is not undone the next time settings loads.
  const savedTheme = storage.get('theme');
  prefs.themeChoice = savedTheme || 'system';
  prefs.compactSidebar = storage.get('sidebarCollapsed', prefs.compactSidebar);

  if (prefs.reduceMotion) document.documentElement.classList.add('calm-motion');
}

/* =============================================================================
   BOOT
   ========================================================================== */

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('settings', { title: 'Settings' });

  try {
    await store.load(
      'profiles', 'clients', 'projects', 'tasks',
      'finance_transactions', 'calendar_events', 'notifications',
    );
  } catch (err) {
    hideLoader();
    toast.error('Could not load settings', err.message);
    return;
  }

  await loadPrefs();

  initProfile();
  initWorkspace();
  initAppearance();
  initNotifications();
  initSecurity();
  initDataExport();
  initSectionNav();

  renderWorkspaceStats();
  renderConnectionInfo();

  store.on('change', debounce(renderWorkspaceStats, 400));
  store.on('realtime', renderConnectionInfo);
  document.addEventListener('synthworks:profile', () => {
    fillProfileForm();
    renderConnectionInfo();
  });

  icons();
  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
