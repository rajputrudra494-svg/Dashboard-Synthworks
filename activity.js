/* =============================================================================
   SynthWorks — activity.js
   The workspace audit log.

   Rows here are written by a Postgres trigger (log_activity in schema.sql), not
   by the client — so the feed records what actually happened in the database,
   including changes made from the SQL editor or another tool. RLS gives the log
   no UPDATE or DELETE policy, which makes it append-only.
   ========================================================================== */

import { requireAuth, auth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, initReveal,
  animatePage, animateItems, stagger,
} from './animations.js';
import { donutChart, renderLegend } from './charts.js';
import { statCard, emptyState, activityRow, avatar } from './ui.js';
import { toast } from './notifications.js';
import {
  $, $$, render, icons, escapeHtml, timeAgo, fmtDate, isoDate, titleCase,
  debounce, matches, groupBy, sortBy, addDays, startOfDay, exportCSV, num,
} from './utils.js';

const PAGE_SIZE = 25;

const filters = { query: '', actor: 'all', entity: 'all', action: 'all' };
let shown = PAGE_SIZE;

/* =============================================================================
   FILTERING
   ========================================================================== */

function filteredRows() {
  return store.activities.all.filter((row) => {
    if (filters.actor !== 'all' && row.actor_id !== filters.actor) return false;
    if (filters.entity !== 'all' && row.entity_type !== filters.entity) return false;
    if (filters.action !== 'all' && row.action !== filters.action) return false;
    if (filters.query && !matches(row, filters.query, ['actor_name', 'entity_label', 'entity_type', 'action'])) return false;
    return true;
  });
}

/* =============================================================================
   FEED
   ========================================================================== */

function renderFeed() {
  const host = $('#activityFeed');
  if (!host) return;

  const rows = filteredRows();
  const page = rows.slice(0, shown);

  const countNode = $('#activityCount');
  if (countNode) {
    countNode.textContent = rows.length === store.activities.count
      ? `${num(rows.length)} entries`
      : `${num(rows.length)} of ${num(store.activities.count)}`;
  }

  if (!rows.length) {
    render(host, emptyState({
      icon: 'history',
      title: filters.query || filters.actor !== 'all' ? 'No matching activity' : 'The log is empty',
      body: filters.query || filters.actor !== 'all'
        ? 'Try a different search or clear the filters.'
        : 'As soon as anyone creates, edits or deletes something, it appears here instantly.',
    }));
    icons(host);
    $('#activityPager').hidden = true;
    return;
  }

  // Group by calendar day so the feed reads like a diary.
  const byDay = groupBy(page, (row) => isoDate(row.created_at));

  host.innerHTML = Object.entries(byDay).map(([day, entries]) => {
    const date = new Date(day);
    const label = isoDate(date) === isoDate()
      ? 'Today'
      : isoDate(date) === isoDate(addDays(new Date(), -1))
        ? 'Yesterday'
        : fmtDate(date, 'long');

    return `
      <section class="mb-6">
        <div class="flex items-center gap-3 mb-3">
          <h3 class="fs-sm">${escapeHtml(label)}</h3>
          <span class="grow" style="height:1px;background:var(--border)"></span>
          <span class="fs-xs faint">${entries.length} change${entries.length === 1 ? '' : 's'}</span>
        </div>
        <div class="feed">
          ${entries.map((row) => activityRow(row)).join('')}
        </div>
      </section>`;
  }).join('');

  icons(host);

  const pager = $('#activityPager');
  pager.hidden = rows.length <= shown;
  $('#pagerLabel').textContent = `Showing ${Math.min(shown, rows.length)} of ${num(rows.length)}`;

  animateItems($$('.feed-item', host).slice(0, 12));
}

/* =============================================================================
   SUMMARY TILES
   ========================================================================== */

function renderStats() {
  const host = $('#activityStats');
  if (!host) return;

  const rows = store.activities.all;
  const today = rows.filter((row) => isoDate(row.created_at) === isoDate()).length;
  const week = rows.filter((row) => new Date(row.created_at) >= addDays(startOfDay(), -7)).length;
  const mine = rows.filter((row) => row.actor_id === auth.userId).length;
  const contributors = new Set(rows.map((row) => row.actor_id).filter(Boolean)).size;

  render(host, [
    statCard({ label: 'Today', value: today, icon: 'zap', tone: 'brand', hint: 'changes so far' }),
    statCard({ label: 'This week', value: week, icon: 'calendar-range', tone: 'info', hint: 'last 7 days' }),
    statCard({ label: 'Your changes', value: mine, icon: 'user', tone: 'success', hint: 'all time' }),
    statCard({ label: 'Contributors', value: contributors, icon: 'users', tone: 'warning', hint: 'people in the log' }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   HEATMAP  (12 weeks × 7 days, GitHub-style)
   ========================================================================== */

function renderHeatmap() {
  const host = $('#heatmap');
  if (!host) return;

  const DAYS = 84;
  const counts = new Map();

  store.activities.all.forEach((row) => {
    const key = isoDate(row.created_at);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  // Start on the most recent Sunday-aligned boundary so rows line up as weeks.
  const end = startOfDay();
  const start = addDays(end, -(DAYS - 1));
  const offset = start.getDay();
  const gridStart = addDays(start, -offset);

  const cells = [];
  let total = 0;

  for (let i = 0; i < DAYS + offset; i += 1) {
    const day = addDays(gridStart, i);
    const count = counts.get(isoDate(day)) || 0;
    if (day <= end) total += count;

    const level = count === 0 ? 0 : count < 3 ? 1 : count < 7 ? 2 : count < 15 ? 3 : 4;
    const future = day > end;

    cells.push(`
      <span class="heat-cell" data-level="${future ? 0 : level}"
            style="${future ? 'opacity:.25' : ''}"
            title="${escapeHtml(fmtDate(day))} — ${count} change${count === 1 ? '' : 's'}"></span>`);
  }

  host.innerHTML = cells.join('');

  const totalNode = $('#heatTotal');
  if (totalNode) totalNode.textContent = `${num(total)} changes in 12 weeks`;
}

/* =============================================================================
   MOST ACTIVE + TYPE BREAKDOWN
   ========================================================================== */

function renderMostActive() {
  const host = $('#mostActive');
  if (!host) return;

  const grouped = groupBy(
    store.activities.all.filter((row) => row.actor_id),
    'actor_id',
  );

  const ranked = sortBy(
    Object.entries(grouped).map(([actorId, rows]) => ({
      actorId,
      profile: store.profiles.get(actorId),
      name: rows[0].actor_name,
      count: rows.length,
    })),
    'count', 'desc',
  ).slice(0, 6);

  if (!ranked.length) {
    host.innerHTML = '<p class="fs-sm muted">No activity recorded yet.</p>';
    return;
  }

  const max = ranked[0].count;

  host.innerHTML = ranked.map((entry) => `
    <div class="hbar-row">
      <span class="flex items-center gap-2" style="min-width:0">
        ${avatar(entry.profile || { full_name: entry.name, id: entry.actorId }, { size: 'xs' })}
        <span class="truncate">${escapeHtml(entry.profile?.full_name || entry.name)}</span>
      </span>
      <span class="hbar-bar"><i style="width:${(entry.count / max) * 100}%"></i></span>
      <b>${entry.count}</b>
    </div>`).join('');

  icons(host);
}

function renderEntityChart() {
  const grouped = groupBy(store.activities.all, 'entity_type');
  const entries = sortBy(
    Object.entries(grouped).map(([type, rows]) => ({ type, count: rows.length })),
    'count', 'desc',
  );

  if (!entries.length) {
    $('#entityLegend').innerHTML = '<p class="fs-xs muted">Nothing logged yet.</p>';
    return;
  }

  const chart = donutChart('entityChart', {
    labels: entries.map((entry) => titleCase(entry.type)),
    data: entries.map((entry) => entry.count),
    cutout: '68%',
  });

  renderLegend('entityLegend', chart, { values: entries.map((entry) => String(entry.count)) });
}

/* =============================================================================
   CONTROLS
   ========================================================================== */

function populateActorFilter() {
  const select = $('#filterActor');
  if (!select) return;

  const current = select.value;
  const actors = new Map();
  store.activities.all.forEach((row) => {
    if (row.actor_id) actors.set(row.actor_id, row.actor_name);
  });

  select.innerHTML = `<option value="all">Everyone</option>${
    [...actors.entries()].map(([id, name]) =>
      `<option value="${escapeHtml(id)}">${escapeHtml(store.profiles.get(id)?.full_name || name)}</option>`).join('')}`;
  select.value = current || 'all';
}

function wireControls() {
  $('#activitySearch')?.addEventListener('input', debounce((event) => {
    filters.query = event.target.value;
    shown = PAGE_SIZE;
    renderFeed();
  }, 200));

  [['#filterActor', 'actor'], ['#filterEntity', 'entity'], ['#filterAction', 'action']]
    .forEach(([selector, key]) => {
      $(selector)?.addEventListener('change', (event) => {
        filters[key] = event.target.value;
        shown = PAGE_SIZE;
        renderFeed();
      });
    });

  $('#loadMore')?.addEventListener('click', () => {
    shown += PAGE_SIZE;
    renderFeed();
  });

  $('#exportActivity')?.addEventListener('click', () => {
    const rows = filteredRows();
    if (!rows.length) { toast.warning('Nothing to export'); return; }

    exportCSV(rows, [
      { key: 'created_at', label: 'When', map: (row) => new Date(row.created_at).toLocaleString() },
      { key: 'actor_name', label: 'Person' },
      { key: 'action', label: 'Action', map: (row) => titleCase(row.action) },
      { key: 'entity_type', label: 'Type', map: (row) => titleCase(row.entity_type) },
      { key: 'entity_label', label: 'Item' },
      { key: 'entity_id', label: 'Record ID' },
    ], `synthworks-activity-${isoDate()}.csv`);

    toast.success('Export ready', `${rows.length} log entries written to CSV.`);
  });
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderStats();
  populateActorFilter();
  renderFeed();
  renderHeatmap();
  renderMostActive();
  renderEntityChart();
}, 250);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('activity', { title: 'Activity' });

  try {
    await store.load('activities', 'profiles', 'notifications');
  } catch (err) {
    hideLoader();
    toast.error('Could not load the activity log', err.message);
    return;
  }

  populateActorFilter();
  renderStats();
  renderFeed();
  renderHeatmap();
  renderMostActive();
  renderEntityChart();
  wireControls();

  // Realtime: new entries slide in at the top without losing scroll position.
  store.on('activities:change', (change) => {
    if (change.type === 'insert' && change.remote) {
      // Keep the newest visible even if the user has paged down.
      shown = Math.max(shown, PAGE_SIZE);
    }
    repaint();
  });
  store.on('profiles:change', repaint);

  // Timestamps are relative, so refresh their wording periodically.
  setInterval(() => {
    $$('.feed-time').forEach((node) => {
      const iso = node.getAttribute('title');
      if (iso) node.textContent = timeAgo(iso);
    });
  }, 60_000);

  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
