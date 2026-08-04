/* =============================================================================
   SynthWorks — analytics.js
   Trends, comparisons and rates.

   Where the dashboard answers "what is happening right now", this page answers
   "where is this going" — growth rates, year-over-year deltas, throughput and
   completion. All of it derived from the same store selectors.
   ========================================================================== */

import { requireAuth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, initReveal,
  animatePage, stagger,
} from './animations.js';
import { areaChart, barChart, donutChart, radarChart, renderLegend } from './charts.js';
import { statCard, emptyState, progressBar } from './ui.js';
import { toast } from './notifications.js';
import {
  $, $$, render, icons, escapeHtml, money, num, percent, fmtDate, isoDate,
  pctChange, sumBy, sortBy, toDate, titleCase, debounce, exportPDF,
} from './utils.js';

let months = 12;

/* =============================================================================
   HEADLINE METRICS
   ========================================================================== */

function renderGrowthStats() {
  const host = $('#growthStats');
  if (!host) return;

  const series = store.monthlySeries(months);
  const half = Math.floor(series.length / 2);

  // Compare the second half of the window with the first.
  const recent = series.slice(half);
  const earlier = series.slice(0, half);

  const recentIncome = sumBy(recent, 'income');
  const earlierIncome = sumBy(earlier, 'income');

  const finance = store.financeSummary();
  const projects = store.projectStats();
  const tasks = store.taskStats();
  const clients = store.clientStats();

  const clientSeries = store.clientGrowthSeries(months);
  const clientChange = pctChange(clientSeries.at(-1)?.total ?? 0, clientSeries[0]?.total ?? 0);

  render(host, [
    statCard({
      label: 'Revenue', value: finance.income, icon: 'circle-dollar-sign',
      tone: 'success', format: 'money',
      change: pctChange(recentIncome, earlierIncome), hint: `last ${months} months`,
    }),
    statCard({
      label: 'Profit margin', value: finance.margin, icon: 'percent',
      tone: finance.margin >= 20 ? 'success' : finance.margin >= 0 ? 'warning' : 'danger',
      format: 'percent', hint: `${money(finance.profit, { compact: true })} net`,
    }),
    statCard({
      label: 'Client growth', value: clients.total, icon: 'building-2',
      tone: 'brand', change: clientChange, hint: 'total accounts',
    }),
    statCard({
      label: 'Delivery rate', value: tasks.completionRate, icon: 'circle-check-big',
      tone: tasks.completionRate >= 70 ? 'success' : 'warning',
      format: 'percent', hint: `${tasks.done} of ${tasks.total} tasks`,
    }),
    statCard({
      label: 'Projects shipped', value: projects.completed, icon: 'package-check',
      tone: 'info', hint: `${projects.active} still running`,
    }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   REVENUE TREND
   ========================================================================== */

function renderTrend() {
  const series = store.monthlySeries(months);
  const labels = series.map((point) => fmtDate(point.date, 'month'));

  // Rolling profit gives the trend a third, slower-moving line.
  let running = 0;
  const cumulative = series.map((point) => {
    running += point.income - point.expense;
    return running;
  });

  const chart = areaChart('trendChart', {
    labels,
    datasets: [
      { label: 'Income', data: series.map((p) => p.income), color: '#22C55E' },
      { label: 'Expenses', data: series.map((p) => p.expense), color: '#EF4444' },
      { label: 'Cumulative profit', data: cumulative, color: '#A855F7', fill: false },
    ],
  });

  renderLegend('trendLegend', chart, {
    values: [
      money(sumBy(series, 'income'), { compact: true }),
      money(sumBy(series, 'expense'), { compact: true }),
      money(running, { compact: true }),
    ],
  });

  const totalNode = $('#trendTotal');
  if (totalNode) totalNode.textContent = money(sumBy(series, 'income'), { compact: true });
}

/* =============================================================================
   YEAR OVER YEAR
   ========================================================================== */

function monthlyIncomeFor(year) {
  return Array.from({ length: 12 }, (_, month) =>
    store.finance_transactions.all
      .filter((txn) => {
        const date = toDate(txn.occurred_on);
        return date && date.getFullYear() === year && date.getMonth() === month
          && txn.type === 'income' && txn.status === 'paid';
      })
      .reduce((total, txn) => total + Number(txn.amount || 0), 0));
}

function renderYoY() {
  const thisYear = new Date().getFullYear();
  const current = monthlyIncomeFor(thisYear);
  const previous = monthlyIncomeFor(thisYear - 1);

  const labels = Array.from({ length: 12 }, (_, month) =>
    new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(thisYear, month, 1)));

  const chart = barChart('yoyChart', {
    labels,
    datasets: [
      { label: String(thisYear - 1), data: previous, color: 'rgba(124,58,237,.32)' },
      { label: String(thisYear), data: current },
    ],
    currency: true,
  });

  const sum = (list) => list.reduce((total, value) => total + value, 0);

  renderLegend('yoyLegend', chart, {
    values: [money(sum(previous), { compact: true }), money(sum(current), { compact: true })],
  });
}

/* =============================================================================
   MONTHLY GROWTH RATE
   ========================================================================== */

function renderGrowthRate() {
  const series = store.monthlySeries(months);

  const rates = series.map((point, index) => {
    if (index === 0) return 0;
    return pctChange(point.income, series[index - 1].income);
  });

  // Clamp the display so one outlier month cannot flatten the rest.
  const clamped = rates.map((rate) => Math.max(-100, Math.min(200, rate)));

  barChart('growthChart', {
    labels: series.map((point) => fmtDate(point.date, 'month')),
    datasets: [{
      label: 'Growth',
      data: clamped,
      color: '#7C3AED',
    }],
    currency: false,
  });
}

/* =============================================================================
   DELIVERY THROUGHPUT
   ========================================================================== */

function renderThroughput() {
  const buckets = new Map();
  const now = new Date();

  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${date.getFullYear()}-${date.getMonth()}`, { date, created: 0, completed: 0 });
  }

  store.tasks.all.forEach((task) => {
    const created = toDate(task.created_at);
    if (created) {
      const key = `${created.getFullYear()}-${created.getMonth()}`;
      if (buckets.has(key)) buckets.get(key).created += 1;
    }
    if (task.completed_at) {
      const done = toDate(task.completed_at);
      const key = `${done.getFullYear()}-${done.getMonth()}`;
      if (buckets.has(key)) buckets.get(key).completed += 1;
    }
  });

  const series = [...buckets.values()];

  const chart = barChart('throughputChart', {
    labels: series.map((point) => fmtDate(point.date, 'month')),
    datasets: [
      { label: 'Created', data: series.map((p) => p.created), color: 'rgba(124,58,237,.34)' },
      { label: 'Completed', data: series.map((p) => p.completed), color: '#22C55E' },
    ],
  });

  const created = sumBy(series, 'created');
  const completed = sumBy(series, 'completed');

  renderLegend('throughputLegend', chart, { values: [String(created), String(completed)] });

  const badge = $('#throughputBadge');
  if (badge) {
    const ratio = created ? Math.round((completed / created) * 100) : 0;
    badge.textContent = `${ratio}% cleared`;
    badge.className = `badge ${ratio >= 90 ? 'is-success' : ratio >= 60 ? 'is-warning' : 'is-danger'}`;
  }
}

/* =============================================================================
   WORKLOAD RADAR
   ========================================================================== */

function renderRadar() {
  const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
  const STATUSES = ['todo', 'doing', 'review', 'done'];

  const countBy = (status) => PRIORITIES.map((priority) =>
    store.tasks.all.filter((task) => task.status === status && task.priority === priority).length);

  radarChart('radarChart', {
    labels: PRIORITIES.map(titleCase),
    datasets: STATUSES.slice(0, 3).map((status) => ({
      label: titleCase(status),
      data: countBy(status),
    })),
  });
}

/* =============================================================================
   COMPLETION PANEL
   ========================================================================== */

function renderCompletion() {
  const host = $('#completionPanel');
  if (!host) return;

  const tasks = store.taskStats();
  const projects = store.projectStats();

  const onTime = store.projects.all.filter((project) =>
    project.status === 'completed' && project.deadline && project.completed_at
    && toDate(project.completed_at) <= toDate(project.deadline)).length;

  const completedWithDeadline = store.projects.all.filter((project) =>
    project.status === 'completed' && project.deadline).length;

  const rows = [
    { label: 'Task completion', value: tasks.completionRate,
      hint: `${tasks.done} of ${tasks.total} tasks` },
    { label: 'Average project progress', value: projects.avgProgress,
      hint: `${projects.active} active projects` },
    { label: 'Projects delivered', value: projects.total ? Math.round((projects.completed / projects.total) * 100) : 0,
      hint: `${projects.completed} of ${projects.total}` },
    { label: 'Delivered on time', value: completedWithDeadline ? Math.round((onTime / completedWithDeadline) * 100) : 0,
      hint: completedWithDeadline ? `${onTime} of ${completedWithDeadline} with a deadline` : 'no deadlines set yet' },
  ];

  host.innerHTML = rows.map((row) => `
    <div class="mb-5">
      <div class="between fs-sm mb-2">
        <span>${escapeHtml(row.label)}</span>
        <b class="tabular">${row.value}%</b>
      </div>
      ${progressBar(row.value, {
        tone: row.value >= 70 ? 'is-success' : row.value >= 40 ? '' : 'is-warning',
        showLabel: false,
      })}
      <span class="fs-xs faint">${escapeHtml(row.hint)}</span>
    </div>`).join('');
}

/* =============================================================================
   CLIENT MIX + TOP PROJECTS
   ========================================================================== */

function renderClientMix() {
  const rows = store.finance_transactions.all
    .filter((txn) => txn.type === 'income' && txn.status === 'paid');

  const totals = store.clients.all
    .map((client) => ({
      name: client.name,
      total: sumBy(rows.filter((txn) => txn.client_id === client.id), 'amount'),
    }))
    .filter((entry) => entry.total > 0);

  const ranked = sortBy(totals, 'total', 'desc');
  const top = ranked.slice(0, 6);
  const rest = ranked.slice(6);

  if (rest.length) {
    top.push({ name: `${rest.length} others`, total: sumBy(rest, 'total') });
  }

  const grandTotal = sumBy(ranked, 'total');
  const totalNode = $('#clientMixTotal');
  if (totalNode) totalNode.textContent = money(grandTotal, { compact: true });

  if (!top.length) {
    $('#clientMixLegend').innerHTML = '<p class="fs-xs muted">No client revenue recorded yet.</p>';
    return;
  }

  const chart = donutChart('clientMixChart', {
    labels: top.map((entry) => entry.name),
    data: top.map((entry) => entry.total),
    currency: true,
  });

  renderLegend('clientMixLegend', chart, {
    values: top.map((entry) => money(entry.total, { compact: true })),
  });
}

function renderTopProjects() {
  const host = $('#topProjects');
  if (!host) return;

  const ranked = sortBy(store.projects.all.filter((project) => project.budget > 0), 'budget', 'desc').slice(0, 7);

  if (!ranked.length) {
    render(host, emptyState({
      icon: 'chart-column',
      title: 'No budgets yet',
      body: 'Add a budget to a project and it will rank here.',
    }));
    icons(host);
    return;
  }

  const max = Number(ranked[0].budget) || 1;

  host.innerHTML = ranked.map((project) => `
    <div class="hbar-row">
      <span title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
      <span class="hbar-bar">
        <i style="width:${(Number(project.budget) / max) * 100}%;background:${escapeHtml(project.color || 'var(--grad-brand)')}"></i>
      </span>
      <b>${escapeHtml(money(project.budget, { compact: true }))}</b>
    </div>`).join('');
}

function renderClientGrowth() {
  const series = store.clientGrowthSeries(months);

  areaChart('clientGrowthChart', {
    labels: series.map((point) => fmtDate(point.date, 'month')),
    datasets: [{ label: 'Total clients', data: series.map((p) => p.total), color: '#06B6D4' }],
    currency: false,
  });
}

/* =============================================================================
   REPORT EXPORT
   ========================================================================== */

function exportReport() {
  const finance = store.financeSummary();
  const projects = store.projectStats();
  const tasks = store.taskStats();
  const clients = store.clientStats();
  const series = store.monthlySeries(months);

  try {
    exportPDF({
      title: `${store.workspace().company_name} — Analytics report`,
      subtitle: `Rolling ${months} months · generated ${fmtDate(new Date(), 'long')}`,
      columns: [
        { key: 'month', label: 'Month', map: (row) => fmtDate(row.date, 'month') },
        { key: 'income', label: 'Income', numeric: true, map: (row) => money(row.income) },
        { key: 'expense', label: 'Expenses', numeric: true, map: (row) => money(row.expense) },
        { key: 'profit', label: 'Profit', numeric: true, map: (row) => money(row.income - row.expense) },
        { key: 'margin', label: 'Margin', numeric: true,
          map: (row) => (row.income ? percent(((row.income - row.expense) / row.income) * 100, 1) : '—') },
      ],
      rows: series,
      summary: [
        { label: 'Total revenue', value: money(finance.income) },
        { label: 'Total expenses', value: money(finance.expense) },
        { label: 'Net profit', value: money(finance.profit) },
        { label: 'Margin', value: percent(finance.margin, 1) },
        { label: 'Clients', value: `${clients.total} (${clients.active} active)` },
        { label: 'Projects', value: `${projects.total} (${projects.completed} shipped)` },
        { label: 'Task completion', value: percent(tasks.completionRate) },
      ],
    });
    toast.success('Report ready', 'Choose "Save as PDF" in the print dialog.');
  } catch (err) {
    toast.error('Could not open the report', err.message);
  }
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderGrowthStats();
  renderTrend();
  renderYoY();
  renderGrowthRate();
  renderThroughput();
  renderRadar();
  renderCompletion();
  renderClientMix();
  renderTopProjects();
  renderClientGrowth();
}, 250);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('analytics', { title: 'Analytics' });

  try {
    await store.load(
      'finance_transactions', 'projects', 'clients', 'tasks', 'profiles', 'notifications',
    );
  } catch (err) {
    hideLoader();
    toast.error('Could not load analytics', err.message);
    return;
  }

  repaint.cancel?.();
  renderGrowthStats();
  renderTrend();
  renderYoY();
  renderGrowthRate();
  renderThroughput();
  renderRadar();
  renderCompletion();
  renderClientMix();
  renderTopProjects();
  renderClientGrowth();

  $('#periodSwitch')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-months]');
    if (!button) return;
    $$('#periodSwitch button').forEach((node) => node.classList.remove('is-active'));
    button.classList.add('is-active');
    months = Number(button.dataset.months);
    repaint();
  });

  $('#exportReport')?.addEventListener('click', exportReport);

  ['finance_transactions', 'projects', 'clients', 'tasks'].forEach((collection) => {
    store.on(`${collection}:change`, repaint);
  });

  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
