/* =============================================================================
   SynthWorks — dashboard.js
   Page controller for dashboard.html.

   Pulls every collection the overview needs, renders 14 KPI tiles, six charts,
   the project timeline, upcoming work, meetings and the activity feed — then
   re-renders whatever changes as realtime events arrive.
   ========================================================================== */

import { requireAuth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, hideLoader, mountLoader, initCounters, initReveal, animatePage, stagger,
} from './animations.js';
import { areaChart, barChart, donutChart, renderLegend, PALETTE } from './charts.js';
import { statCard, emptyState, skeleton, activityRow, dueRow } from './ui.js';
import {
  $, $$, render, icons, money, num, percent, fmtDate, fmtTime, escapeHtml, pctChange,
  daysBetween, addMonths, startOfMonth, endOfMonth, toDate, titleCase, debounce,
} from './utils.js';
import { toast } from './notifications.js';

/* Re-render is debounced so a burst of realtime events repaints once. */
const repaint = debounce(() => renderEverything(), 220);

let revenueMonths = 12;

/* =============================================================================
   KPI TILES
   ========================================================================== */

function renderRevenueStats() {
  const host = $('#revenueStats');
  if (!host) return;

  const buckets = store.revenueBuckets();
  const summary = store.financeSummary();

  // Month-over-month comparison for the trend chips.
  const now = new Date();
  const lastMonth = addMonths(now, -1);
  const thisMonthIncome = buckets.month;
  const lastMonthIncome = store
    .financeSummary(store.transactionsBetween(startOfMonth(lastMonth), endOfMonth(lastMonth)))
    .income;

  const tiles = [
    {
      label: 'Total revenue', value: buckets.total, icon: 'circle-dollar-sign',
      format: 'money', tone: 'success', hint: 'all time',
    },
    {
      label: 'Monthly revenue', value: buckets.month, icon: 'calendar-range',
      format: 'money', tone: 'brand',
      change: pctChange(thisMonthIncome, lastMonthIncome), hint: 'vs last month',
    },
    {
      label: 'Weekly revenue', value: buckets.week, icon: 'calendar-days',
      format: 'money', tone: 'info', hint: 'this week',
    },
    {
      label: "Today's revenue", value: buckets.today, icon: 'sun',
      format: 'money', tone: 'warning', hint: fmtDate(new Date(), 'short'),
    },
    {
      label: 'Expenses', value: summary.expense, icon: 'trending-down',
      format: 'money', tone: 'danger', hint: 'all time',
    },
    {
      label: 'Net income', value: summary.profit, icon: 'piggy-bank',
      format: 'money', tone: summary.profit >= 0 ? 'success' : 'danger',
      hint: `${percent(summary.margin, 1)} margin`,
    },
    {
      label: 'Invoices', value: summary.invoices, icon: 'file-text',
      format: 'number', tone: 'brand',
      hint: summary.pending > 0 ? `${money(summary.pending, { compact: true })} pending` : 'all settled',
      href: 'finance.html',
    },
  ];

  render(host, tiles.map(statCard));
  stagger(host);
  icons(host);
  initCounters(host);
}

function renderOpsStats() {
  const host = $('#opsStats');
  if (!host) return;

  const clients = store.clientStats();
  const projects = store.projectStats();
  const tasks = store.taskStats();

  const tiles = [
    {
      label: 'Total clients', value: clients.total, icon: 'building-2',
      tone: 'brand', hint: `${clients.leads} leads`, href: 'clients.html',
    },
    {
      label: 'Active clients', value: clients.active, icon: 'handshake',
      tone: 'success', hint: 'currently engaged', href: 'clients.html',
    },
    {
      label: 'Running projects', value: projects.active, icon: 'folder-kanban',
      tone: 'info', hint: `${projects.avgProgress}% avg progress`, href: 'projects.html',
    },
    {
      label: 'Completed projects', value: projects.completed, icon: 'check-check',
      tone: 'success', hint: `${projects.total} total`, href: 'projects.html',
    },
    {
      label: 'Pending tasks', value: tasks.pending, icon: 'list-todo',
      tone: tasks.overdue > 0 ? 'danger' : 'warning',
      hint: tasks.overdue > 0 ? `${tasks.overdue} overdue` : 'on track', href: 'tasks.html',
    },
    {
      label: 'Completed tasks', value: tasks.done, icon: 'circle-check-big',
      tone: 'success', hint: `${tasks.completionRate}% completion`, href: 'tasks.html',
    },
    {
      label: 'Project budget', value: store.projectStats().budget, icon: 'wallet',
      format: 'money', tone: 'brand', hint: 'committed', href: 'projects.html',
    },
  ];

  render(host, tiles.map(statCard));
  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   CHARTS
   ========================================================================== */

function renderRevenueChart() {
  const series = store.monthlySeries(revenueMonths);
  const labels = series.map((point) => fmtDate(point.date, 'month'));

  const chart = areaChart('revenueChart', {
    labels,
    datasets: [
      { label: 'Revenue', data: series.map((p) => p.income) },
      { label: 'Expenses', data: series.map((p) => p.expense), color: '#EF4444' },
    ],
  });

  renderLegend('revenueLegend', chart, {
    values: [
      money(series.reduce((sum, p) => sum + p.income, 0), { compact: true }),
      money(series.reduce((sum, p) => sum + p.expense, 0), { compact: true }),
    ],
  });
}

function renderStatusChart() {
  const projects = store.projects.all;
  const ORDER = ['planning', 'active', 'review', 'on_hold', 'completed', 'cancelled'];
  const TONE = {
    planning: '#38BDF8', active: '#7C3AED', review: '#A855F7',
    on_hold: '#FACC15', completed: '#22C55E', cancelled: '#EF4444',
  };

  const counts = ORDER.map((status) => projects.filter((p) => p.status === status).length);
  const present = ORDER.map((status, index) => ({ status, count: counts[index] }))
    .filter((entry) => entry.count > 0);

  const totalNode = $('#statusTotal');
  if (totalNode) totalNode.textContent = num(projects.length);

  if (!present.length) {
    const legend = $('#statusLegend');
    if (legend) legend.innerHTML = '<p class="fs-xs muted">No projects yet.</p>';
    return;
  }

  const chart = donutChart('statusChart', {
    labels: present.map((entry) => titleCase(entry.status)),
    data: present.map((entry) => entry.count),
    colors: present.map((entry) => TONE[entry.status]),
  });

  renderLegend('statusLegend', chart, { values: present.map((entry) => String(entry.count)) });
}

function renderTaskChart() {
  const series = store.taskCompletionSeries(14);
  const labels = series.map((point) => fmtDate(point.date, 'short'));

  const chart = barChart('taskChart', {
    labels,
    datasets: [
      { label: 'Created', data: series.map((p) => p.created), color: 'rgba(124,58,237,.35)' },
      { label: 'Completed', data: series.map((p) => p.completed), color: '#22C55E' },
    ],
  });

  renderLegend('taskLegend', chart, {
    values: [
      String(series.reduce((sum, p) => sum + p.created, 0)),
      String(series.reduce((sum, p) => sum + p.completed, 0)),
    ],
  });

  const badge = $('#completionBadge');
  if (badge) badge.textContent = `${store.taskStats().completionRate}% done`;
}

function renderClientChart() {
  const series = store.clientGrowthSeries(12);

  const chart = areaChart('clientChart', {
    labels: series.map((point) => fmtDate(point.date, 'month')),
    datasets: [{ label: 'Clients', data: series.map((p) => p.total), color: '#06B6D4' }],
    currency: false,
  });

  renderLegend('clientLegend', chart, { values: [String(series.at(-1)?.total ?? 0)] });

  // Growth over the window drives the trend chip.
  const first = series[0]?.total || 0;
  const last = series.at(-1)?.total || 0;
  const change = pctChange(last, first);
  const trendNode = $('#clientTrend');
  if (trendNode) {
    const dir = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
    trendNode.className = `trend ${dir}`;
    trendNode.innerHTML = `<i data-lucide="${dir === 'up' ? 'trending-up' : dir === 'down' ? 'trending-down' : 'minus'}"></i> ${Math.abs(change).toFixed(0)}%`;
    icons(trendNode);
  }
}

function renderEarningsCharts() {
  // Weekly — one bar per day.
  const daily = store.dailySeries(7);
  barChart('weeklyChart', {
    labels: daily.map((point) => fmtDate(point.date, 'short')),
    datasets: [{ label: 'Income', data: daily.map((p) => p.value) }],
    currency: true,
  });
  const weekTotal = $('#weekTotal');
  if (weekTotal) weekTotal.textContent = money(daily.reduce((sum, p) => sum + p.value, 0), { compact: true });

  // Monthly — last six months with a dashed average line for context.
  const monthly = store.monthlySeries(6);
  const average = monthly.length
    ? monthly.reduce((sum, p) => sum + p.income, 0) / monthly.length
    : 0;

  areaChart('monthlyChart', {
    labels: monthly.map((point) => fmtDate(point.date, 'month')),
    datasets: [
      { label: 'Income', data: monthly.map((p) => p.income) },
      { label: 'Average', data: monthly.map(() => average), color: '#FACC15', fill: false, dashed: true },
    ],
  });

  const monthTotal = $('#monthTotal');
  if (monthTotal) monthTotal.textContent = money(monthly.at(-1)?.income ?? 0, { compact: true });
}

/* =============================================================================
   PROJECT TIMELINE  (a compact gantt over the next 90 days)
   ========================================================================== */

function renderTimeline() {
  const host = $('#timeline');
  if (!host) return;

  const WINDOW_DAYS = 90;
  const today = new Date();

  const projects = store.projects.all
    .filter((p) => p.status !== 'cancelled' && p.deadline)
    .filter((p) => daysBetween(p.deadline, today) >= -30)
    .sort((a, b) => toDate(a.deadline) - toDate(b.deadline))
    .slice(0, 8);

  if (!projects.length) {
    render(host, emptyState({
      icon: 'calendar-range',
      title: 'No scheduled projects',
      body: 'Projects with a deadline appear here as a live timeline.',
      action: { label: 'Create a project', icon: 'plus', onClick: () => $('[data-quick="project"]')?.click() },
    }));
    icons(host);
    return;
  }

  // Map a date onto a 0–100% position inside the window.
  const position = (date) => {
    const offset = daysBetween(date, today);
    return Math.max(0, Math.min(100, (offset / WINDOW_DAYS) * 100));
  };

  const rows = projects.map((project) => {
    const start = project.start_date ? toDate(project.start_date) : toDate(project.created_at);
    const left = position(start);
    const right = position(project.deadline);
    const width = Math.max(right - left, 4);

    const overdue = daysBetween(project.deadline, today) < 0 && project.status !== 'completed';
    const state = project.status === 'completed' ? 'is-done' : overdue ? 'is-late' : '';
    const client = store.clients.get(project.client_id);

    return `
      <div class="gantt-row">
        <div class="gantt-label">
          <b>${escapeHtml(project.name)}</b>
          <span>${escapeHtml(client?.name || 'Internal')}</span>
        </div>
        <div class="gantt-track">
          <div class="gantt-bar ${state}" data-pct="${project.progress}%"
               style="left:${left}%;width:${width}%;${project.color ? `background:${escapeHtml(project.color)}` : ''}"
               title="${escapeHtml(project.name)} · due ${escapeHtml(fmtDate(project.deadline))}"></div>
        </div>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="gantt-scale">
      <div></div>
      <div>
        <span>Today</span>
        <span>+30d</span>
        <span>+60d</span>
        <span>+90d</span>
      </div>
    </div>
    <div class="gantt">${rows}</div>`;

  icons(host);
}

/* =============================================================================
   SIDE PANELS
   ========================================================================== */

function renderUpcoming() {
  const host = $('#upcomingList');
  if (!host) return;

  const items = store.upcoming(14).slice(0, 5);

  if (!items.length) {
    render(host, emptyState({ icon: 'calendar-check', title: 'Nothing due', body: 'The next two weeks are clear.' }));
    icons(host);
    return;
  }

  host.innerHTML = items.map((item) => dueRow(item)).join('');
  icons(host);
}

function renderMeetings() {
  const host = $('#meetingList');
  if (!host) return;

  const now = new Date();
  const events = store.calendar_events.all
    .filter((event) => toDate(event.starts_at) >= new Date(now.getTime() - 3600000))
    .slice(0, 6);

  if (!events.length) {
    render(host, emptyState({
      icon: 'calendar-plus',
      title: 'No meetings scheduled',
      body: 'Add a meeting, deadline or reminder to see it here.',
      action: { label: 'Schedule', icon: 'plus', onClick: () => $('[data-quick="event"]')?.click() },
    }));
    icons(host);
    return;
  }

  host.innerHTML = events.map((event) => {
    const project = store.projects.get(event.project_id);
    return `
      <a class="agenda-item" href="calendar.html">
        <span class="agenda-time">${escapeHtml(event.all_day ? 'All day' : fmtTime(event.starts_at))}</span>
        <span class="agenda-bar" style="background:${escapeHtml(event.color || 'var(--accent)')}"></span>
        <span class="grow" style="min-width:0">
          <b class="truncate" style="display:block">${escapeHtml(event.title)}</b>
          <span class="truncate" style="display:block">
            ${escapeHtml(fmtDate(event.starts_at, 'short'))}
            ${event.location ? ` · ${escapeHtml(event.location)}` : ''}
            ${project ? ` · ${escapeHtml(project.name)}` : ''}
          </span>
        </span>
        <span class="badge is-brand badge--plain">${escapeHtml(titleCase(event.type))}</span>
      </a>`;
  }).join('');

  icons(host);
}

function renderActivity() {
  const host = $('#activityFeed');
  if (!host) return;

  const rows = store.activities.all.slice(0, 9);

  if (!rows.length) {
    render(host, emptyState({
      icon: 'history',
      title: 'No activity yet',
      body: 'Every create, edit and delete the team makes will appear here instantly.',
    }));
    icons(host);
    return;
  }

  host.innerHTML = rows.map((row) => activityRow(row)).join('');
  icons(host);
}

/* =============================================================================
   HEADER
   ========================================================================== */

function renderGreeting(profile) {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning'
    : hour < 18 ? 'Good afternoon' : 'Good evening';

  const first = (profile?.full_name || 'there').split(' ')[0];

  const greetingNode = $('#greetingText');
  if (greetingNode) greetingNode.textContent = `${greeting}, ${first}`;

  const online = store.profiles.all.filter((person) => person.is_online).length;
  const sub = $('#dashSub');
  if (sub) {
    sub.textContent = online > 1
      ? `${online} teammates are online right now.`
      : 'Everything the team is running right now.';
  }
}

/* =============================================================================
   ORCHESTRATION
   ========================================================================== */

function renderEverything() {
  renderRevenueStats();
  renderOpsStats();
  renderRevenueChart();
  renderStatusChart();
  renderTaskChart();
  renderClientChart();
  renderEarningsCharts();
  renderTimeline();
  renderUpcoming();
  renderMeetings();
  renderActivity();
  renderGreeting(store.profiles.get(document.documentElement.dataset.userId));
}

/**
 * Placeholders while the first fetch is in flight.
 * Skeleton children are appended into the real containers so the render pass
 * can simply replace them — no element swapping, no lost ids.
 */
function paintSkeletons() {
  const statTiles = (count) => Array.from({ length: count }, () => {
    const card = document.createElement('div');
    card.className = 'sk-card';
    card.innerHTML = `
      <div class="between mb-4"><span class="sk sk-line" style="width:40%"></span><span class="sk sk-circle"></span></div>
      <div class="sk" style="height:30px;width:64%;margin-bottom:10px"></div>
      <div class="sk sk-line" style="width:34%"></div>`;
    return card;
  });

  render($('#revenueStats'), statTiles(4));
  render($('#opsStats'), statTiles(4));
  render($('#activityFeed'), skeleton('list', 5));
  render($('#upcomingList'), skeleton('list', 3));
  render($('#meetingList'), skeleton('list', 3));
}

function wireControls() {
  // Revenue chart range switcher.
  $('#revenueRange')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (!button) return;
    $$('#revenueRange button').forEach((node) => node.classList.remove('is-active'));
    button.classList.add('is-active');
    revenueMonths = Number(button.dataset.range);
    renderRevenueChart();
  });

  $('#refreshBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    try {
      await store.refresh();
      renderEverything();
      toast.success('Up to date', 'Pulled the latest from the workspace.');
    } catch (err) {
      toast.error('Could not refresh', err.message);
    } finally {
      button.classList.remove('is-loading');
    }
  });
}

/* =============================================================================
   BOOT
   ========================================================================== */

async function boot() {
  mountLoader();
  initAnimations();

  const session = await requireAuth();
  if (!session) return;                     // requireAuth already redirected

  document.documentElement.dataset.userId = session.session.user.id;

  await initShell('dashboard', { title: 'Dashboard' });
  paintSkeletons();

  try {
    await store.load(
      'profiles', 'clients', 'projects', 'tasks',
      'finance_transactions', 'activities', 'calendar_events', 'notifications',
    );
  } catch (err) {
    hideLoader();
    toast.error('Could not load the workspace', err.message);
    return;
  }

  renderEverything();
  wireControls();

  // Realtime: any change to anything on this page triggers a debounced repaint.
  store.on('change', repaint);
  store.on('refresh', repaint);

  initReveal();
  animatePage('.page > section, .page > .page-head');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
