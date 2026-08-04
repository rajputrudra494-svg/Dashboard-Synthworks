/* =============================================================================
   SynthWorks — team.js
   The team directory: presence, workload, current projects and last activity.

   Presence comes from the heartbeat in auth.js writing profiles.is_online /
   last_seen_at, which realtime then pushes to every open browser — so the green
   dots here are live, not a guess.
   ========================================================================== */

import { requireAuth, auth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, initReveal,
  animatePage, animateItems, stagger,
} from './animations.js';
import { barChart } from './charts.js';
import { createTable } from './table.js';
import { statCard, emptyState, avatar, avatarStack, progressBar } from './ui.js';
import { openDrawer, openModal } from './modal.js';
import { toast } from './notifications.js';
import {
  $, $$, el, render, icons, escapeHtml, timeAgo, fmtDate, titleCase, debounce,
  sortBy, copyText, queryParam,
} from './utils.js';

let table = null;
let view = 'grid';

/* =============================================================================
   DERIVED DATA
   ========================================================================== */

/** Everything the UI needs about one person, computed once per render. */
function memberStats(profile) {
  const tasks = store.tasks.all.filter((task) => task.assignee_id === profile.id);
  const open = tasks.filter((task) => task.status !== 'done');
  const done = tasks.filter((task) => task.status === 'done');

  const projects = store.project_members.all
    .filter((member) => member.profile_id === profile.id)
    .map((member) => store.projects.get(member.project_id))
    .filter(Boolean);

  const activeProjects = projects.filter((project) => project.status === 'active');

  const overdue = open.filter((task) =>
    task.due_date && new Date(task.due_date) < new Date(new Date().setHours(0, 0, 0, 0))).length;

  const lastActivity = store.activities.all.find((row) => row.actor_id === profile.id);

  return {
    tasks: tasks.length,
    open: open.length,
    done: done.length,
    overdue,
    completion: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
    projects,
    activeProjects: activeProjects.length,
    lastActivity,
  };
}

/** Online means the heartbeat fired within the last three minutes. */
function isOnline(profile) {
  if (!profile.is_online) return false;
  const seen = new Date(profile.last_seen_at).getTime();
  return Date.now() - seen < 3 * 60 * 1000;
}

/* =============================================================================
   SUMMARY TILES
   ========================================================================== */

function renderStats() {
  const host = $('#teamStats');
  if (!host) return;

  const people = store.profiles.all;
  const online = people.filter(isOnline).length;
  const totalOpen = store.tasks.all.filter((task) => task.status !== 'done').length;
  const unassigned = store.tasks.all.filter((task) => task.status !== 'done' && !task.assignee_id).length;

  render(host, [
    statCard({ label: 'Team members', value: people.length, icon: 'users', tone: 'brand',
               hint: 'in this workspace' }),
    statCard({ label: 'Online now', value: online, icon: 'wifi', tone: online ? 'success' : 'info',
               hint: online ? 'active in the last 3 min' : 'nobody right now' }),
    statCard({ label: 'Open tasks', value: totalOpen, icon: 'list-todo', tone: 'warning',
               hint: people.length ? `${Math.round(totalOpen / people.length)} avg per person` : '' }),
    statCard({ label: 'Unassigned', value: unassigned, icon: 'user-x',
               tone: unassigned ? 'danger' : 'success',
               hint: unassigned ? 'need an owner' : 'everything has an owner' }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);

  const pill = $('#onlinePill');
  if (pill) {
    pill.querySelector('span').textContent = `${online} online`;
    pill.classList.toggle('is-live', online > 0);
  }
}

/* =============================================================================
   CHARTS
   ========================================================================== */

function renderWorkload() {
  const people = store.profiles.all;
  if (!people.length) return;

  const rows = people.map((profile) => ({
    name: profile.full_name.split(' ')[0],
    ...memberStats(profile),
  }));

  const ranked = sortBy(rows, 'open', 'desc').slice(0, 10);

  barChart('workloadChart', {
    labels: ranked.map((row) => row.name),
    datasets: [
      { label: 'Open', data: ranked.map((row) => row.open) },
      { label: 'Overdue', data: ranked.map((row) => row.overdue), color: '#EF4444' },
    ],
    stacked: true,
  });
}

function renderLeaderboard() {
  const host = $('#leaderboard');
  if (!host) return;

  const rows = store.profiles.all
    .map((profile) => ({ profile, ...memberStats(profile) }))
    .filter((row) => row.tasks > 0);

  const ranked = sortBy(rows, 'done', 'desc').slice(0, 6);

  if (!ranked.length) {
    render(host, emptyState({
      icon: 'trophy',
      title: 'No completed tasks yet',
      body: 'The leaderboard fills in as the team ships work.',
    }));
    icons(host);
    return;
  }

  const max = ranked[0].done || 1;

  host.innerHTML = ranked.map((row) => `
    <div class="hbar-row">
      <span class="flex items-center gap-2" style="min-width:0">
        ${avatar(row.profile, { size: 'xs' })}
        <span class="truncate">${escapeHtml(row.profile.full_name)}</span>
      </span>
      <span class="hbar-bar"><i style="width:${(row.done / max) * 100}%"></i></span>
      <b>${row.done}</b>
    </div>`).join('');

  icons(host);
}

/* =============================================================================
   MEMBER DETAIL
   ========================================================================== */

function openMemberDetail(profile) {
  if (!profile) return;

  const stats = memberStats(profile);
  const online = isOnline(profile);

  const recentTasks = store.tasks.all
    .filter((task) => task.assignee_id === profile.id && task.status !== 'done')
    .slice(0, 6);

  const recentActivity = store.activities.all
    .filter((row) => row.actor_id === profile.id)
    .slice(0, 8);

  const body = el('div');
  body.innerHTML = `
    <div class="flex items-center gap-4 mb-6">
      ${avatar(profile, { size: 'xl', presence: true })}
      <div class="grow" style="min-width:0">
        <h2 style="font-size:var(--fs-lg)">${escapeHtml(profile.full_name)}</h2>
        <p class="fs-sm muted">${escapeHtml(profile.job_title || 'Team member')}</p>
        <div class="flex wrap gap-2 mt-2">
          <span class="badge ${online ? 'is-success' : 'is-muted'}">${online ? 'Online' : 'Offline'}</span>
          <span class="badge is-brand badge--plain">${escapeHtml(titleCase(profile.role))}</span>
        </div>
      </div>
    </div>

    <div class="stat-grid mb-6" style="gap:var(--sp-2)">
      <div class="card card-pad">
        <span class="stat-label">Open</span>
        <div class="stat-value" style="font-size:var(--fs-lg)">${stats.open}</div>
      </div>
      <div class="card card-pad">
        <span class="stat-label">Completed</span>
        <div class="stat-value c-success" style="font-size:var(--fs-lg)">${stats.done}</div>
      </div>
      <div class="card card-pad">
        <span class="stat-label">Projects</span>
        <div class="stat-value" style="font-size:var(--fs-lg)">${stats.projects.length}</div>
      </div>
    </div>

    <h3 class="fs-sm mb-3">Completion rate</h3>
    <div class="mb-6">${progressBar(stats.completion)}</div>

    <h3 class="fs-sm mb-3">Contact</h3>
    <div class="card card-pad mb-6">
      <div class="cli-row" style="padding:7px 0">
        <span>Email</span>
        <a href="mailto:${escapeHtml(profile.email)}" class="truncate">${escapeHtml(profile.email)}</a>
      </div>
      ${profile.phone ? `
        <div class="cli-row" style="padding:7px 0">
          <span>Phone</span><a href="tel:${escapeHtml(profile.phone)}">${escapeHtml(profile.phone)}</a>
        </div>` : ''}
      <div class="cli-row" style="padding:7px 0">
        <span>Last seen</span><span>${escapeHtml(online ? 'Now' : timeAgo(profile.last_seen_at))}</span>
      </div>
      <div class="cli-row" style="padding:7px 0">
        <span>Joined</span><span>${escapeHtml(fmtDate(profile.created_at))}</span>
      </div>
    </div>

    ${profile.bio ? `
      <h3 class="fs-sm mb-3">About</h3>
      <div class="card card-pad mb-6">
        <p class="fs-sm" style="white-space:pre-wrap">${escapeHtml(profile.bio)}</p>
      </div>` : ''}

    <h3 class="fs-sm mb-3">Projects (${stats.projects.length})</h3>
    ${stats.projects.length ? `
      <div class="card mb-6">
        ${stats.projects.map((project) => `
          <a class="list-row" href="projects.html?id=${escapeHtml(project.id)}">
            <span class="mini-cal-dot" style="background:${escapeHtml(project.color || 'var(--accent)')}"></span>
            <span class="grow truncate fs-sm">${escapeHtml(project.name)}</span>
            <span class="fs-xs muted tabular">${project.progress}%</span>
          </a>`).join('')}
      </div>` : '<p class="fs-sm muted mb-6">Not assigned to any project yet.</p>'}

    <h3 class="fs-sm mb-3">Current tasks</h3>
    ${recentTasks.length ? `
      <div class="card mb-6">
        ${recentTasks.map((task) => `
          <a class="list-row" href="tasks.html?id=${escapeHtml(task.id)}">
            <span class="prio prio--${escapeHtml(task.priority)}"><i></i></span>
            <span class="grow truncate fs-sm">${escapeHtml(task.title)}</span>
            <span class="badge is-muted">${escapeHtml(titleCase(task.status))}</span>
          </a>`).join('')}
      </div>` : '<p class="fs-sm muted mb-6">Nothing open right now.</p>'}

    <h3 class="fs-sm mb-3">Recent activity</h3>
    ${recentActivity.length ? `
      <div class="feed">
        ${recentActivity.map((row) => `
          <div class="feed-item">
            <span class="feed-icon is-${escapeHtml(row.action)}">
              <i data-lucide="${row.action === 'deleted' ? 'trash-2' : row.action === 'completed' ? 'check' : row.action === 'created' ? 'plus' : 'pencil'}"></i>
            </span>
            <div class="feed-text grow">
              <p>${escapeHtml(row.action)} ${escapeHtml(row.entity_type)} <em>${escapeHtml(row.entity_label || '')}</em></p>
              <span class="feed-time">${escapeHtml(timeAgo(row.created_at))}</span>
            </div>
          </div>`).join('')}
      </div>` : '<p class="fs-sm muted">No recorded activity yet.</p>'}`;

  const footer = el('div', { class: 'flex gap-2' });
  footer.innerHTML = `
    <a class="btn btn--secondary" href="mailto:${escapeHtml(profile.email)}">
      <i data-lucide="mail"></i> Email
    </a>
    ${profile.id === auth.userId
      ? '<a class="btn btn--primary" href="settings.html"><i data-lucide="pencil"></i> Edit my profile</a>'
      : `<a class="btn btn--primary" href="tasks.html?assignee=${escapeHtml(profile.id)}">
           <i data-lucide="list-todo"></i> View tasks</a>`}`;

  openDrawer({ title: 'Team member', subtitle: profile.job_title || '', body, footer });
}

/* =============================================================================
   CARD VIEW
   ========================================================================== */

function renderGrid() {
  const host = $('#teamGrid');
  if (!host) return;

  const people = sortBy(store.profiles.all, (profile) => (isOnline(profile) ? 0 : 1));

  if (!people.length) {
    render(host, emptyState({
      icon: 'users',
      title: 'Nobody here yet',
      body: 'Team members appear as soon as they create an account.',
      action: { label: 'Invite a colleague', icon: 'user-plus', onClick: openInvite },
    }));
    icons(host);
    return;
  }

  host.innerHTML = people.map((profile) => {
    const stats = memberStats(profile);
    const online = isOnline(profile);
    const isMe = profile.id === auth.userId;

    return `
      <article class="card card--hover card-pad" data-id="${escapeHtml(profile.id)}"
               tabindex="0" role="button" aria-label="${escapeHtml(profile.full_name)}">
        <div class="flex items-center gap-3 mb-4">
          ${avatar(profile, { size: 'lg', presence: true })}
          <div class="grow" style="min-width:0">
            <b class="truncate" style="display:block">
              ${escapeHtml(profile.full_name)}${isMe ? ' <span class="fs-xs muted">(you)</span>' : ''}
            </b>
            <span class="fs-xs muted truncate" style="display:block">${escapeHtml(profile.job_title || 'Team member')}</span>
          </div>
          <span class="badge ${online ? 'is-success' : 'is-muted'}">${online ? 'Online' : 'Away'}</span>
        </div>

        <div class="cli-rows mb-4">
          <div class="cli-row"><span>Open tasks</span><b>${stats.open}</b></div>
          <div class="cli-row"><span>Completed</span><b class="c-success">${stats.done}</b></div>
          <div class="cli-row"><span>Projects</span><b>${stats.activeProjects} active</b></div>
        </div>

        <div class="mb-4">
          <div class="between fs-xs muted mb-2">
            <span>Completion</span><b class="tabular">${stats.completion}%</b>
          </div>
          <span class="progress ${stats.completion >= 70 ? 'is-success' : stats.completion >= 40 ? '' : 'is-warning'}">
            <i style="width:${stats.completion}%"></i>
          </span>
        </div>

        <div class="between" style="padding-top:var(--sp-3);border-top:1px solid var(--border)">
          <span class="fs-xs faint truncate">
            ${stats.lastActivity
              ? `${escapeHtml(stats.lastActivity.action)} ${escapeHtml(stats.lastActivity.entity_type)} · ${escapeHtml(timeAgo(stats.lastActivity.created_at))}`
              : `Joined ${escapeHtml(timeAgo(profile.created_at))}`}
          </span>
          ${avatarStack(stats.projects.slice(0, 3).map((project) => ({
            id: project.id, full_name: project.name, avatar_url: null,
          })), 3)}
        </div>
      </article>`;
  }).join('');

  icons(host);
  animateItems($$('.card', host).slice(0, 12));
}

/* =============================================================================
   TABLE VIEW
   ========================================================================== */

function buildTable() {
  table = createTable({
    mount: '#teamTable',
    id: 'team',
    rows: () => store.profiles.all,
    searchFields: ['full_name', 'email', 'job_title', 'role'],
    searchPlaceholder: 'Search the team…',
    sort: { key: 'full_name', dir: 'asc' },
    perPage: 15,

    filters: [{
      key: 'role',
      label: 'Role',
      options: [
        { value: 'owner', label: 'Owner' },
        { value: 'admin', label: 'Admin' },
        { value: 'manager', label: 'Manager' },
        { value: 'member', label: 'Member' },
        { value: 'viewer', label: 'Viewer' },
      ],
    }],

    columns: [
      {
        key: 'full_name', label: 'Member',
        render: (row) => `
          <span class="cell-lead">
            ${avatar(row, { presence: true })}
            <span class="ct">
              <b>${escapeHtml(row.full_name)}${row.id === auth.userId ? ' (you)' : ''}</b>
              <span>${escapeHtml(row.email)}</span>
            </span>
          </span>`,
      },
      {
        key: 'job_title', label: 'Title',
        render: (row) => `<span class="fs-sm">${escapeHtml(row.job_title || '—')}</span>`,
      },
      {
        key: 'role', label: 'Role',
        render: (row) => `<span class="badge is-brand badge--plain">${escapeHtml(titleCase(row.role))}</span>`,
      },
      {
        key: 'open', label: 'Open tasks', numeric: true,
        sortValue: (row) => memberStats(row).open,
        render: (row) => {
          const stats = memberStats(row);
          return `<b class="tabular">${stats.open}</b>${
            stats.overdue ? `<span class="fs-xs c-danger"> (${stats.overdue} late)</span>` : ''}`;
        },
      },
      {
        key: 'completion', label: 'Completion', numeric: true,
        sortValue: (row) => memberStats(row).completion,
        render: (row) => progressBar(memberStats(row).completion),
      },
      {
        key: 'last_seen_at', label: 'Last seen', numeric: true,
        render: (row) => `<span class="fs-xs ${isOnline(row) ? 'c-success' : 'muted'} nowrap">${
          isOnline(row) ? 'Online now' : escapeHtml(timeAgo(row.last_seen_at))}</span>`,
      },
    ],

    card: (row) => {
      const stats = memberStats(row);
      return `
        <div class="cli-head">
          ${avatar(row, { presence: true })}
          <div class="grow">
            <b class="truncate" style="display:block">${escapeHtml(row.full_name)}</b>
            <span class="fs-xs muted">${escapeHtml(row.job_title || 'Team member')}</span>
          </div>
          <span class="badge ${isOnline(row) ? 'is-success' : 'is-muted'}">${isOnline(row) ? 'Online' : 'Away'}</span>
        </div>
        <div class="cli-rows">
          <div class="cli-row"><span>Open</span><b>${stats.open}</b></div>
          <div class="cli-row"><span>Completed</span><b>${stats.done}</b></div>
          <div class="cli-row"><span>Last seen</span><span>${escapeHtml(timeAgo(row.last_seen_at))}</span></div>
        </div>`;
    },

    onRowClick: (row) => openMemberDetail(row),

    empty: {
      icon: 'users',
      title: 'Nobody here yet',
      body: 'Team members appear as soon as they create an account.',
    },
  });
}

/* =============================================================================
   INVITE
   Supabase sign-ups are self-service in this workspace, so "invite" means
   sharing the sign-up link rather than provisioning an account from here
   (that would need the service_role key, which must never reach the browser).
   ========================================================================== */

function openInvite() {
  const url = new URL('login.html?mode=signup', location.href).href;

  const body = el('div');
  body.innerHTML = `
    <p class="fs-sm muted mb-4">
      Anyone with this link can create an account and will immediately share this
      workspace. Send it only to colleagues.
    </p>

    <div class="field mb-4">
      <label for="inviteLink">Sign-up link</label>
      <div class="input-group">
        <input class="input" id="inviteLink" readonly value="${escapeHtml(url)}">
      </div>
    </div>

    <div class="card card-pad">
      <b class="fs-sm">Want approval-only sign-ups?</b>
      <p class="fs-xs muted mt-2">
        In Supabase go to <b>Authentication → Providers → Email</b> and turn off
        “Allow new users to sign up”. You can then create accounts yourself from
        <b>Authentication → Users</b>.
      </p>
    </div>`;

  const footer = el('div', { class: 'flex gap-2' });
  footer.innerHTML = `
    <button class="btn btn--secondary" type="button" data-close>Close</button>
    <button class="btn btn--primary" type="button" data-act="copy">
      <i data-lucide="copy"></i> Copy link
    </button>`;

  openModal({ title: 'Invite a colleague', icon: 'user-plus', size: 'slim', body, footer });

  footer.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-act="copy"]')) return;
    const ok = await copyText(url);
    ok ? toast.success('Link copied', 'Paste it to your colleague.')
       : toast.error('Could not copy', 'Select the link and copy it manually.');
  });
}

/* =============================================================================
   VIEW SWITCH + BOOT
   ========================================================================== */

function setView(next) {
  view = next;
  $('#teamGrid').hidden = next !== 'grid';
  $('#teamTable').hidden = next !== 'table';
  $$('#viewSwitch button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === next);
  });
  if (next === 'grid') renderGrid();
  if (next === 'table') table?.refresh();
}

const repaint = debounce(() => {
  renderStats();
  renderWorkload();
  renderLeaderboard();
  if (view === 'grid') renderGrid(); else table?.refresh();
}, 220);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('team', { title: 'Team' });

  try {
    await store.load(
      'profiles', 'tasks', 'projects', 'project_members', 'activities', 'notifications',
    );
  } catch (err) {
    hideLoader();
    toast.error('Could not load the team', err.message);
    return;
  }

  renderStats();
  renderWorkload();
  renderLeaderboard();
  renderGrid();
  buildTable();

  $('#inviteBtn')?.addEventListener('click', openInvite);

  $('#viewSwitch')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

  $('#teamGrid')?.addEventListener('click', (event) => {
    const card = event.target.closest('.card[data-id]');
    if (card) openMemberDetail(store.profiles.get(card.dataset.id));
  });
  $('#teamGrid')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const card = event.target.closest('.card[data-id]');
    if (card) openMemberDetail(store.profiles.get(card.dataset.id));
  });

  // Deep link: team.html?id=…
  const deepLink = queryParam('id');
  if (deepLink) {
    const profile = store.profiles.get(deepLink);
    if (profile) setTimeout(() => openMemberDetail(profile), 400);
  }

  ['profiles', 'tasks', 'projects', 'project_members', 'activities'].forEach((collection) => {
    store.on(`${collection}:change`, repaint);
  });

  // Presence ages out on a timer even when nothing changes server-side.
  setInterval(repaint, 60_000);

  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
