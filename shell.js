/* =============================================================================
   SynthWorks — shell.js
   Renders the application chrome that every signed-in page shares: the
   collapsible sidebar, the sticky top bar, the theme system, the command
   palette, the notification centre, the quick-add menu and the global
   keyboard shortcuts.

   A page only needs:
       <div class="app"><aside class="app-sidebar"></aside>
       <div class="app-main"><header class="app-topbar"></header>
       <main class="page">…your content…</main></div></div>
   …and one call to `initShell('projects')`.
   ========================================================================== */

import { $, $$, el, icons, escapeHtml, initials, storage, timeAgo, debounce, delegate } from './utils.js';
import { auth, wireLogout } from './auth.js';
import { store } from './store.js';
import { toast } from './notifications.js';
import { animateShell } from './animations.js';

/* =============================================================================
   NAVIGATION MODEL
   ========================================================================== */

const NAV = [
  { group: 'Workspace' },
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: 'dashboard.html' },
  { id: 'clients',   label: 'Clients',   icon: 'building-2',       href: 'clients.html' },
  { id: 'projects',  label: 'Projects',  icon: 'folder-kanban',    href: 'projects.html' },
  { id: 'tasks',     label: 'Tasks',     icon: 'circle-check-big', href: 'tasks.html', badge: 'tasks' },
  { id: 'finance',   label: 'Finance',   icon: 'wallet',           href: 'finance.html' },
  { id: 'calendar',  label: 'Calendar',  icon: 'calendar-days',    href: 'calendar.html' },

  { group: 'Insights' },
  { id: 'team',      label: 'Team',      icon: 'users',        href: 'team.html' },
  { id: 'activity',  label: 'Activity',  icon: 'activity',     href: 'activity.html' },
  { id: 'analytics', label: 'Analytics', icon: 'chart-column', href: 'analytics.html' },

  { group: 'Account' },
  { id: 'settings',  label: 'Settings',  icon: 'settings',     href: 'settings.html' },
];

/* =============================================================================
   THEME
   Resolution order: saved choice → system preference → dark.
   Applied to <html data-theme> before first paint by an inline snippet in each
   page's <head>; this module keeps it in sync afterwards.
   ========================================================================== */

export const theme = {
  get current() {
    return document.documentElement.dataset.theme || 'dark';
  },

  set(next, { animate = true } = {}) {
    const root = document.documentElement;

    if (animate) {
      root.classList.add('theme-transition');
      window.clearTimeout(theme._timer);
      theme._timer = window.setTimeout(() => root.classList.remove('theme-transition'), 480);
    }

    root.dataset.theme = next;
    storage.set('theme', next);

    // Keep the browser UI (address bar on mobile) in step.
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#0a0a0f' : '#fbfbfc';

    document.dispatchEvent(new CustomEvent('synthworks:theme', { detail: next }));
    updateThemeButton();
  },

  toggle() {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  },

  init() {
    const saved = storage.get('theme');
    if (saved) { document.documentElement.dataset.theme = saved; }
    else {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      document.documentElement.dataset.theme = prefersLight ? 'light' : 'dark';
    }

    // Follow the OS while the user has not made an explicit choice.
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
      if (storage.get('theme')) return;
      this.set(event.matches ? 'light' : 'dark');
    });
  },
};

function updateThemeButton() {
  const button = $('#themeToggle');
  if (!button) return;
  const dark = theme.current === 'dark';
  button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
  button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  button.dataset.tip = dark ? 'Light mode' : 'Dark mode';
  icons(button);
}

/* =============================================================================
   SIDEBAR
   ========================================================================== */

function renderSidebar(activeId) {
  const aside = $('.app-sidebar');
  if (!aside) return;

  const workspace = store.workspace();
  const collapsed = storage.get('sidebarCollapsed', false);
  if (collapsed) $('.app')?.classList.add('is-collapsed');

  const items = NAV.map((item) => {
    if (item.group) return `<div class="nav-label">${escapeHtml(item.group)}</div>`;
    const active = item.id === activeId;
    return `
      <a class="nav-item${active ? ' is-active' : ''}"
         href="${item.href}"
         data-label="${escapeHtml(item.label)}"
         data-nav="${item.id}"
         ${active ? 'aria-current="page"' : ''}>
        <i data-lucide="${item.icon}"></i>
        <span>${escapeHtml(item.label)}</span>
        ${item.badge ? `<span class="nav-badge" data-badge="${item.badge}" hidden>0</span>` : ''}
      </a>`;
  }).join('');

  aside.innerHTML = `
    <a class="sidebar-brand" href="dashboard.html" aria-label="SynthWorks home">
      <span class="brand-mark">${workspace.logo_url
        ? `<img src="${escapeHtml(workspace.logo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
        : 'S'}</span>
      <span class="brand-text">
        <b data-company-name>${escapeHtml(workspace.company_name)}</b>
        <span>Workspace</span>
      </span>
    </a>

    <nav class="sidebar-nav" aria-label="Primary">
      ${items}
      <div class="nav-label">Session</div>
      <button class="nav-item nav-item--logout" type="button" data-action="logout" data-label="Log out">
        <i data-lucide="log-out"></i>
        <span>Log out</span>
      </button>
    </nav>

    <div class="sidebar-foot">
      <div class="sidebar-upsell">
        <b>Storage</b>
        <p><span id="storageUsed">0</span> of 5 GB used</p>
        <div class="storage-meter"><i id="storageBar" style="width:0%"></i></div>
      </div>
      <button class="sidebar-collapse" type="button" id="collapseBtn" aria-label="Collapse sidebar">
        <i data-lucide="chevrons-left"></i>
        <span>Collapse</span>
      </button>
    </div>`;

  icons(aside);

  $('#collapseBtn')?.addEventListener('click', () => {
    const app = $('.app');
    const next = app.classList.toggle('is-collapsed');
    storage.set('sidebarCollapsed', next);
    // Charts need to know their box changed.
    window.dispatchEvent(new Event('resize'));
  });
}

/** Off-canvas drawer behaviour for tablet / mobile. */
function initDrawer() {
  const app = $('.app');
  if (!app) return;

  const scrim = el('div', { class: 'sidebar-scrim', 'aria-hidden': 'true' });
  document.body.append(scrim);

  const setOpen = (open) => {
    app.classList.toggle('is-drawer-open', open);
    scrim.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    $('.topbar-toggle')?.setAttribute('aria-expanded', String(open));
  };

  $('.topbar-toggle')?.addEventListener('click', () => setOpen(!app.classList.contains('is-drawer-open')));
  scrim.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.classList.contains('is-drawer-open')) setOpen(false);
  });

  // Any navigation closes the drawer.
  $('.app-sidebar')?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  // Leaving the drawer breakpoint must clear the state.
  window.matchMedia('(min-width: 1025px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

/* =============================================================================
   TOP BAR
   ========================================================================== */

function renderTopbar(title) {
  const header = $('.app-topbar');
  if (!header) return;

  const profile = auth.profile;
  const name = auth.displayName;

  header.innerHTML = `
    <button class="topbar-toggle icon-btn" type="button" aria-label="Open navigation" aria-expanded="false">
      <i data-lucide="menu"></i>
    </button>

    <div class="topbar-search">
      <i data-lucide="search"></i>
      <input type="search" id="globalSearch" placeholder="Search clients, projects, tasks…"
             aria-label="Search the workspace" autocomplete="off">
      <kbd>Ctrl K</kbd>
    </div>

    <button class="icon-btn topbar-search-btn" type="button" id="searchBtn" aria-label="Search">
      <i data-lucide="search"></i>
    </button>

    <div class="topbar-actions">
      <div class="topbar-clock" aria-hidden="true">
        <time id="clockTime">--:--</time>
        <span id="clockDate"></span>
      </div>

      <div class="pop" id="quickAddPop">
        <button class="btn btn--primary btn--sm" type="button" id="quickAddBtn"
                aria-haspopup="true" aria-expanded="false">
          <i data-lucide="plus"></i><span class="only-desktop">Quick add</span>
        </button>
        <div class="pop-panel" role="menu" aria-label="Quick add">
          <button class="pop-item" role="menuitem" data-quick="client"><i data-lucide="building-2"></i> New client</button>
          <button class="pop-item" role="menuitem" data-quick="project"><i data-lucide="folder-plus"></i> New project</button>
          <button class="pop-item" role="menuitem" data-quick="task"><i data-lucide="circle-plus"></i> New task</button>
          <button class="pop-item" role="menuitem" data-quick="transaction"><i data-lucide="receipt"></i> New transaction</button>
          <button class="pop-item" role="menuitem" data-quick="event"><i data-lucide="calendar-plus"></i> New event</button>
        </div>
      </div>

      <div class="pop" id="notifPop">
        <button class="icon-btn" type="button" id="notifBtn" data-tip="Notifications"
                aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
          <i data-lucide="bell"></i>
          <span class="dot" id="notifDot" hidden></span>
        </button>
        <div class="pop-panel pop-panel--wide" role="dialog" aria-label="Notifications">
          <div class="pop-head">
            <b>Notifications</b>
            <button class="btn btn--sm btn--ghost" type="button" id="markAllRead">Mark all read</button>
          </div>
          <div class="notif-list" id="notifList"></div>
        </div>
      </div>

      <button class="icon-btn theme-toggle" type="button" id="themeToggle" data-tip="Theme"></button>

      <div class="pop" id="profilePop">
        <button class="profile-chip" type="button" id="profileBtn" aria-haspopup="true" aria-expanded="false">
          <span class="avatar avatar--sm" id="topAvatar">${avatarInner(profile, name)}</span>
          <span class="meta only-desktop">
            <b>${escapeHtml(name)}</b>
            <span>${escapeHtml(profile?.job_title || 'Team member')}</span>
          </span>
          <i data-lucide="chevron-down" class="only-desktop" style="width:14px;height:14px;color:var(--text-faint)"></i>
        </button>
        <div class="pop-panel" role="menu" aria-label="Account">
          <div class="pop-user">
            <span class="avatar">${avatarInner(profile, name)}</span>
            <div class="grow" style="min-width:0">
              <b class="truncate">${escapeHtml(name)}</b>
              <span class="truncate" style="display:block">${escapeHtml(profile?.email || '')}</span>
            </div>
          </div>
          <a class="pop-item" role="menuitem" href="settings.html"><i data-lucide="user"></i> Profile</a>
          <a class="pop-item" role="menuitem" href="settings.html#preferences"><i data-lucide="sliders-horizontal"></i> Preferences</a>
          <a class="pop-item" role="menuitem" href="activity.html"><i data-lucide="history"></i> My activity</a>
          <div class="pop-sep"></div>
          <button class="pop-item is-danger" role="menuitem" type="button" data-action="logout">
            <i data-lucide="log-out"></i> Log out
          </button>
        </div>
      </div>
    </div>`;

  if (title) document.title = `${store.workspace().company_name} · ${title}`;

  icons(header);
  updateThemeButton();
  initClock();
  initPopovers();
  initQuickAdd();
  renderNotifications();
}

function avatarInner(profile, name) {
  return profile?.avatar_url
    ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">`
    : escapeHtml(initials(name));
}

/* ── Live clock ───────────────────────────────────────────────────────────── */
function initClock() {
  const timeNode = $('#clockTime');
  const dateNode = $('#clockDate');
  if (!timeNode) return;

  const tick = () => {
    const now = new Date();
    timeNode.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    timeNode.dateTime = now.toISOString();
    dateNode.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  tick();
  // Align to the next minute so the clock never looks a second behind.
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, (60 - new Date().getSeconds()) * 1000);
}

/* ── Popovers ─────────────────────────────────────────────────────────────── */
function initPopovers() {
  const closeAll = (except) => {
    $$('.pop.is-open').forEach((pop) => {
      if (pop === except) return;
      pop.classList.remove('is-open');
      pop.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
    });
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('#quickAddBtn, #notifBtn, #profileBtn');

    if (trigger) {
      const pop = trigger.closest('.pop');
      const open = !pop.classList.contains('is-open');
      closeAll(pop);
      pop.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      return;
    }

    if (!event.target.closest('.pop-panel')) closeAll();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
}

/* =============================================================================
   NOTIFICATION CENTRE
   ========================================================================== */

function renderNotifications() {
  const list = $('#notifList');
  const dot = $('#notifDot');
  if (!list) return;

  const rows = store.notifications.all.slice(0, 25);
  const unread = store.unreadCount();

  if (dot) dot.hidden = unread === 0;

  if (!rows.length) {
    list.innerHTML = `
      <div class="empty" style="padding:var(--sp-8) var(--sp-4)">
        <span class="empty-art" style="width:56px;height:56px"><i data-lucide="bell-off"></i></span>
        <p class="fs-sm muted">You're all caught up.</p>
      </div>`;
    icons(list);
    return;
  }

  list.innerHTML = rows.map((row) => {
    const read = store.isRead(row);
    return `
      <div class="notif ${read ? 'is-read' : 'is-unread'}" data-notif="${row.id}"
           ${row.link ? `data-href="${escapeHtml(row.link)}"` : ''} role="button" tabindex="0">
        <span class="notif-dot" style="background:var(--${row.type === 'success' ? 'success' : row.type === 'warning' ? 'warning' : row.type === 'danger' ? 'danger' : 'accent'})"></span>
        <div class="grow" style="min-width:0">
          <b>${escapeHtml(row.title)}</b>
          ${row.body ? `<p>${escapeHtml(row.body)}</p>` : ''}
          <time datetime="${row.created_at}">${timeAgo(row.created_at)}</time>
        </div>
      </div>`;
  }).join('');

  icons(list);
}

function initNotificationActions() {
  $('#markAllRead')?.addEventListener('click', async () => {
    await store.markAllNotificationsRead();
    renderNotifications();
    toast.success('All caught up');
  });

  delegate(document, 'click', '[data-notif]', async (event, node) => {
    await store.markNotificationRead(node.dataset.notif);
    renderNotifications();
    if (node.dataset.href) location.href = node.dataset.href;
  });

  store.on('notifications:change', renderNotifications);
}

/* =============================================================================
   COMMAND PALETTE / GLOBAL SEARCH
   ========================================================================== */

let palette = null;

export function openPalette(initialQuery = '') {
  if (palette) { palette.input.focus(); return; }

  const root = el('div', {
    class: 'modal-root',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Search and commands',
  });

  root.innerHTML = `
    <div class="modal modal--command">
      <div class="command-input">
        <i data-lucide="search"></i>
        <input type="text" id="paletteInput" placeholder="Search or jump to…" autocomplete="off"
               aria-label="Search the workspace" aria-controls="paletteList">
        <kbd>ESC</kbd>
      </div>
      <div class="command-list" id="paletteList" role="listbox"></div>
      <div class="command-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;

  document.body.append(root);
  icons(root);

  const input = $('#paletteInput', root);
  const list = $('#paletteList', root);
  let active = 0;
  let results = [];

  function close() {
    root.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 260);
    palette = null;
  }

  function paint() {
    if (!results.length) {
      list.innerHTML = `
        <div class="empty" style="padding:var(--sp-8) var(--sp-4)">
          <span class="empty-art" style="width:54px;height:54px"><i data-lucide="search-x"></i></span>
          <p class="fs-sm muted">${input.value ? 'No matches found.' : 'Start typing to search.'}</p>
        </div>`;
      icons(list);
      return;
    }

    let lastKind = null;
    list.innerHTML = results.map((item, index) => {
      const header = item.kind !== lastKind
        ? `<div class="command-group-label">${escapeHtml(kindLabel(item.kind))}</div>` : '';
      lastKind = item.kind;
      return `${header}
        <button class="command-item${index === active ? ' is-active' : ''}" role="option"
                aria-selected="${index === active}" data-index="${index}" data-href="${escapeHtml(item.href)}">
          <span class="ci-icon"><i data-lucide="${item.icon}"></i></span>
          <span class="ci-text">
            <b>${escapeHtml(item.title)}</b>
            <span>${escapeHtml(item.sub || '')}</span>
          </span>
          <span class="ci-kind">${escapeHtml(item.kind)}</span>
        </button>`;
    }).join('');
    icons(list);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  const run = debounce(() => {
    const query = input.value.trim();
    results = query ? store.search(query) : defaultCommands();
    active = 0;
    paint();
  }, 130);

  function go(index) {
    const item = results[index];
    if (!item) return;
    close();
    if (item.action) item.action();
    else location.href = item.href;
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(active + 1, results.length - 1); paint(); }
    if (event.key === 'ArrowUp')   { event.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    if (event.key === 'Enter')     { event.preventDefault(); go(active); }
  }

  input.addEventListener('input', run);
  document.addEventListener('keydown', onKey);
  list.addEventListener('click', (event) => {
    const item = event.target.closest('.command-item');
    if (item) go(Number(item.dataset.index));
  });
  root.addEventListener('click', (event) => { if (event.target === root) close(); });

  palette = { root, input, close };

  requestAnimationFrame(() => {
    root.classList.add('is-open');
    input.value = initialQuery;
    input.focus();
    run();
  });
}

function kindLabel(kind) {
  return { client: 'Clients', project: 'Projects', task: 'Tasks', finance: 'Finance',
           team: 'Team', page: 'Go to' }[kind] || kind;
}

/** Shown when the palette is empty — navigation shortcuts. */
function defaultCommands() {
  return NAV.filter((item) => item.href).map((item) => ({
    kind: 'page', title: item.label, sub: `Open ${item.label.toLowerCase()}`,
    icon: item.icon, href: item.href,
  }));
}

/* =============================================================================
   QUICK ADD
   Each entry delegates to the owning page module, imported on demand so the
   dashboard does not pay for the projects form until someone asks for it.
   ========================================================================== */

function initQuickAdd() {
  delegate(document, 'click', '[data-quick]', async (event, node) => {
    const kind = node.dataset.quick;
    $$('.pop.is-open').forEach((pop) => pop.classList.remove('is-open'));

    try {
      switch (kind) {
        case 'client': {
          const mod = await import('./clients.js');
          await mod.openClientForm();
          break;
        }
        case 'project': {
          const mod = await import('./projects.js');
          await mod.openProjectForm();
          break;
        }
        case 'task': {
          const mod = await import('./tasks.js');
          await mod.openTaskForm();
          break;
        }
        case 'transaction': {
          const mod = await import('./finance.js');
          await mod.openTransactionForm();
          break;
        }
        case 'event': {
          const mod = await import('./calendar.js');
          await mod.openEventForm();
          break;
        }
        default: break;
      }
    } catch (err) {
      console.error('[shell] quick add failed', err);
      toast.error('Could not open that form', err.message);
    }
  });
}

/* =============================================================================
   KEYBOARD SHORTCUTS
   ========================================================================== */

function initShortcuts() {
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;

    // Ctrl/Cmd + K — command palette (works even while typing).
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }

    if (typing) return;

    // "/" focuses search, like GitHub and Linear.
    if (event.key === '/') { event.preventDefault(); openPalette(); return; }

    // Shift + D / L toggles the theme.
    if (event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); theme.toggle(); return; }

    // g then <key> — go to page.
    if (event.key.toLowerCase() === 'g') {
      const onSecond = (next) => {
        document.removeEventListener('keydown', onSecond);
        const map = { d: 'dashboard', c: 'clients', p: 'projects', t: 'tasks',
                      f: 'finance', a: 'analytics', m: 'team', s: 'settings', l: 'calendar' };
        const page = map[next.key.toLowerCase()];
        if (page) { next.preventDefault(); location.href = `${page}.html`; }
      };
      document.addEventListener('keydown', onSecond);
      setTimeout(() => document.removeEventListener('keydown', onSecond), 1400);
    }
  });
}

/* =============================================================================
   BADGES + STORAGE METER
   ========================================================================== */

function refreshBadges() {
  const pending = store.tasks.loaded ? store.taskStats().pending : 0;
  const badge = $('[data-badge="tasks"]');
  if (badge) {
    badge.textContent = pending > 99 ? '99+' : String(pending);
    badge.hidden = pending === 0;
    badge.classList.toggle('is-danger', store.tasks.loaded && store.taskStats().overdue > 0);
  }
}

function refreshStorageMeter() {
  if (!store.attachments.loaded) return;
  const used = store.attachments.all.reduce((total, file) => total + (Number(file.size_bytes) || 0), 0);
  const limitBytes = 5 * 1024 * 1024 * 1024;
  const pct = Math.min((used / limitBytes) * 100, 100);

  const label = $('#storageUsed');
  const bar = $('#storageBar');
  if (label) label.textContent = used > 1024 * 1024 * 1024
    ? `${(used / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${Math.round(used / 1024 / 1024)} MB`;
  if (bar) bar.style.width = `${Math.max(pct, 1)}%`;
}

/* =============================================================================
   REALTIME AWARENESS
   A colleague's change shows a quiet toast so people notice the board moved
   under them. Own changes are skipped (`local` flag from store.js).
   ========================================================================== */

const LIVE_LABEL = {
  clients: 'Client', projects: 'Project', tasks: 'Task',
  finance_transactions: 'Transaction', calendar_events: 'Event',
};

function initLiveToasts() {
  let lastKey = '';
  let lastAt = 0;

  store.on('change', ({ table, type, row, remote }) => {
    refreshBadges();

    if (!remote || !LIVE_LABEL[table]) return;

    // Collapse bursts (a bulk import should not fire 40 toasts).
    const key = `${table}:${type}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 2500) return;
    lastKey = key; lastAt = now;

    const name = row?.name || row?.title || 'an item';
    const verb = { insert: 'added', update: 'updated', delete: 'removed' }[type] || 'changed';
    toast.live(`${LIVE_LABEL[table]} ${verb}`, name);
  });

  store.on('activities:change', ({ type, row, remote }) => {
    if (type !== 'insert' || !remote || !row) return;
    if (row.actor_id === auth.userId) return;
    document.dispatchEvent(new CustomEvent('synthworks:activity', { detail: row }));
  });
}

/* =============================================================================
   BOOT
   ========================================================================== */

/**
 * Renders the shell and wires every global behaviour.
 * @param {string} activeId  the NAV id of the current page
 * @param {{title?: string}} [options]
 */
export async function initShell(activeId, { title } = {}) {
  theme.init();
  renderSidebar(activeId);
  renderTopbar(title || NAV.find((item) => item.id === activeId)?.label || 'Dashboard');

  initDrawer();
  initShortcuts();
  initNotificationActions();
  initLiveToasts();
  wireLogout(document);

  $('#themeToggle')?.addEventListener('click', () => theme.toggle());
  $('#searchBtn')?.addEventListener('click', () => openPalette());

  // The topbar field is a launcher for the palette, not a live filter — that
  // keeps one search experience instead of two.
  const searchInput = $('#globalSearch');
  searchInput?.addEventListener('focus', () => { searchInput.blur(); openPalette(); });

  // Keep the chrome in sync with data as it arrives.
  store.on('change', () => { refreshBadges(); refreshStorageMeter(); });
  store.on('workspace:change', () => renderSidebar(activeId));
  document.addEventListener('synthworks:profile', () => renderTopbar(title));

  refreshBadges();
  refreshStorageMeter();
  animateShell();
}

export default initShell;
