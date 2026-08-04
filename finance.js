/* =============================================================================
   SynthWorks — finance.js
   Income, expenses, profit, invoice health and exports.

   Every figure on this page is derived from the same store selectors the
   dashboard uses, so the two screens can never disagree.
   ========================================================================== */

import { requireAuth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, initReveal,
  animatePage, stagger,
} from './animations.js';
import { areaChart, barChart, donutChart, renderLegend } from './charts.js';
import { createTable, flashRow } from './table.js';
import { statCard, statusBadge, rowActions, moneyCell } from './ui.js';
import { formModal } from './modal.js';
import { toast, confirmDialog } from './notifications.js';
import {
  $, $$, render, icons, escapeHtml, money, num, percent, fmtDate, isoDate,
  exportCSV, exportPDF, titleCase, debounce, addDays, sumBy, groupBy, sortBy,
  toDate, pctChange, queryParam,
} from './utils.js';

const TYPE_OPTIONS = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

const STATUS_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

const INCOME_CATEGORIES = ['Project fee', 'Retainer', 'Consulting', 'Licensing', 'Maintenance', 'Other'];
const EXPENSE_CATEGORIES = ['Salaries', 'Contractors', 'Software', 'Hardware', 'Marketing',
                            'Office', 'Travel', 'Taxes', 'Other'];

let table = null;
let cashflowType = 'area';
const range = { from: null, to: null, preset: '30' };

/* =============================================================================
   RANGE
   ========================================================================== */

function rangedTransactions() {
  if (range.preset === 'all') return store.finance_transactions.all;
  return store.transactionsBetween(range.from, range.to);
}

function setPreset(preset) {
  range.preset = preset;

  if (preset === 'all') {
    range.from = null;
    range.to = null;
  } else {
    range.to = new Date();
    range.from = addDays(range.to, -Number(preset));
    $('#dateFrom').value = isoDate(range.from);
    $('#dateTo').value = isoDate(range.to);
  }

  $$('#rangePreset button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.preset === preset);
  });

  updateRangeLabel();
  repaint();
}

function updateRangeLabel() {
  const label = $('#rangeLabel');
  if (!label) return;
  label.textContent = range.preset === 'all'
    ? `All time · ${num(store.finance_transactions.count)} transactions`
    : `${fmtDate(range.from)} → ${fmtDate(range.to)}`;
}

/* =============================================================================
   FORM
   ========================================================================== */

/**
 * Opens the transaction dialog.
 * @param {Object} [txn]
 */
export async function openTransactionForm(txn = null) {
  if (!store.finance_transactions.loaded) {
    await store.load('finance_transactions', 'clients', 'projects');
  }

  const isEdit = Boolean(txn?.id);
  const type = txn?.type || 'income';

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return formModal({
    title: isEdit ? 'Edit transaction' : 'New transaction',
    subtitle: isEdit ? txn.title : 'Record income or an expense.',
    icon: 'receipt',
    submitLabel: isEdit ? 'Save changes' : 'Add transaction',

    fields: [
      { name: 'type', label: 'Type', type: 'select', required: true, options: TYPE_OPTIONS },
      { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS_OPTIONS },
      { name: 'title', label: 'Description', required: true, span: 2, placeholder: 'Website redesign — phase 2' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0 },
      { name: 'occurred_on', label: 'Date', type: 'date', required: true },
      { name: 'category', label: 'Category', type: 'select', required: true,
        options: [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])].map((value) => ({ value, label: value })),
        hint: `Suggested for ${type}: ${categories.slice(0, 3).join(', ')}` },
      { name: 'invoice_no', label: 'Invoice number', placeholder: 'INV-2026-014',
        hint: 'Income with an invoice number is counted in the invoice totals.' },
      { name: 'client_id', label: 'Client', type: 'select', allowEmpty: true, emptyLabel: '— None —',
        options: store.clients.all.map((client) => ({ value: client.id, label: client.name })) },
      { name: 'project_id', label: 'Project', type: 'select', allowEmpty: true, emptyLabel: '— None —',
        options: store.projects.all.map((project) => ({ value: project.id, label: project.name })) },
      { name: 'description', label: 'Notes', type: 'textarea', rows: 2, span: 2 },
    ],

    values: {
      type: 'income',
      status: 'paid',
      category: 'Project fee',
      occurred_on: isoDate(),
      ...txn,
    },

    async onSubmit(values) {
      const payload = {
        type: values.type,
        status: values.status,
        title: values.title,
        amount: Math.abs(values.amount ?? 0),
        category: values.category,
        invoice_no: values.invoice_no || null,
        client_id: values.client_id || null,
        project_id: values.project_id || null,
        occurred_on: values.occurred_on,
        description: values.description,
      };

      const saved = isEdit
        ? await store.finance_transactions.update(txn.id, payload)
        : await store.finance_transactions.create(payload);

      toast.success(
        isEdit ? 'Transaction updated' : `${titleCase(payload.type)} recorded`,
        `${money(payload.amount)} · ${payload.title}`,
      );
      return saved;
    },
  });
}

async function deleteTransaction(txn) {
  const ok = await confirmDialog({
    title: 'Delete this transaction?',
    message: `${money(txn.amount)} — "${txn.title}". This affects every report and cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;

  try {
    await store.finance_transactions.remove(txn.id);
    toast.success('Transaction deleted');
  } catch (err) {
    toast.error('Could not delete', err.message);
  }
}

/** One-click "mark this invoice paid" from the table. */
async function markPaid(txn) {
  try {
    await store.finance_transactions.update(txn.id, { status: 'paid' });
    toast.success('Marked as paid', `${money(txn.amount)} · ${txn.title}`);
  } catch (err) {
    toast.error('Could not update', err.message);
  }
}

/* =============================================================================
   KPI TILES
   ========================================================================== */

function renderStats() {
  const host = $('#financeStats');
  if (!host) return;

  const rows = rangedTransactions();
  const summary = store.financeSummary(rows);

  // Compare against the immediately preceding window of the same length.
  let change = null;
  if (range.preset !== 'all' && range.from && range.to) {
    const days = Number(range.preset);
    const prev = store.financeSummary(
      store.transactionsBetween(addDays(range.from, -days), addDays(range.from, -1)),
    );
    change = pctChange(summary.income, prev.income);
  }

  render(host, [
    statCard({ label: 'Income', value: summary.income, icon: 'trending-up', tone: 'success',
               format: 'money', change, hint: change == null ? 'in range' : 'vs previous period' }),
    statCard({ label: 'Expenses', value: summary.expense, icon: 'trending-down', tone: 'danger',
               format: 'money', hint: 'in range' }),
    statCard({ label: summary.profit >= 0 ? 'Profit' : 'Loss', value: Math.abs(summary.profit),
               icon: summary.profit >= 0 ? 'piggy-bank' : 'alert-triangle',
               tone: summary.profit >= 0 ? 'success' : 'danger', format: 'money',
               hint: `${percent(summary.margin, 1)} margin` }),
    statCard({ label: 'Invoices', value: summary.invoices, icon: 'file-text', tone: 'brand',
               hint: `${money(summary.pending, { compact: true })} pending` }),
    statCard({ label: 'Overdue', value: summary.overdue, icon: 'alarm-clock',
               tone: summary.overdue > 0 ? 'danger' : 'success', format: 'money',
               hint: summary.overdue > 0 ? 'chase these' : 'nothing overdue' }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   CHARTS
   ========================================================================== */

function renderCashflow() {
  const rows = rangedTransactions();

  // Bucket by day for short ranges, by month for long ones.
  const days = range.preset === 'all' ? 9999 : Number(range.preset);
  const byMonth = days > 92;

  const buckets = new Map();
  rows.forEach((txn) => {
    const date = toDate(txn.occurred_on);
    if (!date) return;
    const key = byMonth
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : isoDate(date);

    if (!buckets.has(key)) buckets.set(key, { date, income: 0, expense: 0 });
    const bucket = buckets.get(key);
    if (txn.type === 'income' && txn.status === 'paid') bucket.income += Number(txn.amount) || 0;
    if (txn.type === 'expense' && txn.status !== 'cancelled') bucket.expense += Number(txn.amount) || 0;
  });

  const series = [...buckets.values()].sort((a, b) => a.date - b.date);
  const labels = series.map((point) => fmtDate(point.date, byMonth ? 'month' : 'short'));

  const datasets = [
    { label: 'Income', data: series.map((p) => p.income), color: '#22C55E' },
    { label: 'Expenses', data: series.map((p) => p.expense), color: '#EF4444' },
  ];

  const chart = cashflowType === 'area'
    ? areaChart('cashflowChart', { labels, datasets })
    : barChart('cashflowChart', { labels, datasets, currency: true });

  renderLegend('cashflowLegend', chart, {
    values: [
      money(sumBy(series, 'income'), { compact: true }),
      money(sumBy(series, 'expense'), { compact: true }),
    ],
  });
}

function renderCategoryChart() {
  const expenses = rangedTransactions()
    .filter((txn) => txn.type === 'expense' && txn.status !== 'cancelled');

  const grouped = groupBy(expenses, 'category');
  const entries = sortBy(
    Object.entries(grouped).map(([category, rows]) => ({ category, total: sumBy(rows, 'amount') })),
    'total', 'desc',
  ).slice(0, 8);

  const total = sumBy(entries, 'total');
  const totalNode = $('#categoryTotal');
  if (totalNode) totalNode.textContent = money(total, { compact: true });

  if (!entries.length) {
    $('#categoryLegend').innerHTML = '<p class="fs-xs muted">No expenses in this range.</p>';
    return;
  }

  const chart = donutChart('categoryChart', {
    labels: entries.map((entry) => entry.category),
    data: entries.map((entry) => entry.total),
    currency: true,
  });

  renderLegend('categoryLegend', chart, {
    values: entries.map((entry) => money(entry.total, { compact: true })),
  });
}

function renderDailyChart() {
  const series = store.dailySeries(30);

  barChart('dailyChart', {
    labels: series.map((point) => fmtDate(point.date, 'short')),
    datasets: [{ label: 'Income', data: series.map((p) => p.value), color: '#22C55E' }],
    currency: true,
  });

  const totalNode = $('#dailyTotal');
  if (totalNode) totalNode.textContent = money(sumBy(series, 'value'), { compact: true });
}

function renderYearlyChart() {
  const thisYear = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, index) => index);

  const totalsFor = (year) => months.map((month) =>
    store.finance_transactions.all
      .filter((txn) => {
        const date = toDate(txn.occurred_on);
        return date && date.getFullYear() === year && date.getMonth() === month
          && txn.type === 'income' && txn.status === 'paid';
      })
      .reduce((total, txn) => total + Number(txn.amount || 0), 0));

  const current = totalsFor(thisYear);
  const previous = totalsFor(thisYear - 1);

  const chart = barChart('yearlyChart', {
    labels: months.map((month) => new Intl.DateTimeFormat(undefined, { month: 'short' })
      .format(new Date(thisYear, month, 1))),
    datasets: [
      { label: String(thisYear - 1), data: previous, color: 'rgba(124,58,237,.35)' },
      { label: String(thisYear), data: current },
    ],
    currency: true,
  });

  const total = (list) => list.reduce((sum, value) => sum + value, 0);

  renderLegend('yearlyLegend', chart, {
    values: [
      money(total(previous), { compact: true }),
      money(total(current), { compact: true }),
    ],
  });
}

/* =============================================================================
   INVOICE HEALTH + TOP CLIENTS
   ========================================================================== */

function renderInvoiceHealth() {
  const host = $('#invoiceHealth');
  if (!host) return;

  const invoices = rangedTransactions().filter((txn) => txn.type === 'income');
  const groups = ['paid', 'pending', 'overdue', 'cancelled'].map((status) => ({
    status,
    rows: invoices.filter((txn) => txn.status === status),
  }));

  const grandTotal = sumBy(invoices, 'amount') || 1;

  host.innerHTML = groups.map((group) => {
    const total = sumBy(group.rows, 'amount');
    const share = (total / grandTotal) * 100;
    const tone = { paid: 'is-success', pending: 'is-warning', overdue: 'is-danger', cancelled: '' }[group.status];

    return `
      <div class="mb-4">
        <div class="between fs-xs mb-2">
          <span class="flex items-center gap-2">
            ${statusBadge(group.status)}
            <span class="muted">${group.rows.length} invoice${group.rows.length === 1 ? '' : 's'}</span>
          </span>
          <b class="tabular">${escapeHtml(money(total, { compact: true }))}</b>
        </div>
        <span class="progress ${tone}"><i style="width:${Math.max(share, 1)}%"></i></span>
      </div>`;
  }).join('');

  icons(host);
}

function renderTopClients() {
  const host = $('#topClients');
  if (!host) return;

  const rows = rangedTransactions().filter((txn) => txn.type === 'income' && txn.status === 'paid');

  const totals = store.clients.all
    .map((client) => ({
      client,
      total: sumBy(rows.filter((txn) => txn.client_id === client.id), 'amount'),
    }))
    .filter((entry) => entry.total > 0);

  const ranked = sortBy(totals, 'total', 'desc').slice(0, 6);

  if (!ranked.length) {
    host.innerHTML = '<p class="fs-sm muted">No client revenue in this range yet.</p>';
    return;
  }

  const max = ranked[0].total;

  host.innerHTML = ranked.map((entry) => `
    <div class="hbar-row">
      <span title="${escapeHtml(entry.client.name)}">${escapeHtml(entry.client.name)}</span>
      <span class="hbar-bar"><i style="width:${(entry.total / max) * 100}%"></i></span>
      <b>${escapeHtml(money(entry.total, { compact: true }))}</b>
    </div>`).join('');
}

/* =============================================================================
   TABLE
   ========================================================================== */

function buildTable() {
  table = createTable({
    mount: '#financeTable',
    id: 'finance',
    rows: rangedTransactions,
    searchFields: [
      'title', 'category', 'invoice_no', 'description',
      (row) => store.clients.get(row.client_id)?.name || '',
      (row) => store.projects.get(row.project_id)?.name || '',
    ],
    searchPlaceholder: 'Search transactions, invoices, categories…',
    sort: { key: 'occurred_on', dir: 'desc' },
    perPage: 15,

    filters: [
      { key: 'type', label: 'Type', options: TYPE_OPTIONS },
      { key: 'status', label: 'Status', options: STATUS_OPTIONS },
      {
        key: 'category', label: 'Category',
        options: [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])]
          .map((value) => ({ value, label: value })),
      },
    ],

    columns: [
      {
        key: 'title', label: 'Transaction',
        render: (row) => `
          <span class="cell-lead">
            <span class="stat-icon ${row.type === 'income' ? 'is-success' : 'is-danger'}"
                  style="width:32px;height:32px">
              <i data-lucide="${row.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'}"
                 style="width:15px;height:15px"></i>
            </span>
            <span class="ct">
              <b>${escapeHtml(row.title)}</b>
              <span>${escapeHtml(row.category)}${row.invoice_no ? ` · ${escapeHtml(row.invoice_no)}` : ''}</span>
            </span>
          </span>`,
      },
      {
        key: 'client_id', label: 'Client',
        sortValue: (row) => store.clients.get(row.client_id)?.name || '',
        render: (row) => {
          const client = store.clients.get(row.client_id);
          const project = store.projects.get(row.project_id);
          return `<span class="ct">
                    <span class="fs-sm">${escapeHtml(client?.name || '—')}</span><br>
                    <span class="fs-xs muted">${escapeHtml(project?.name || '')}</span>
                  </span>`;
        },
      },
      { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      {
        key: 'occurred_on', label: 'Date', numeric: true,
        render: (row) => `<span class="fs-xs muted nowrap">${escapeHtml(fmtDate(row.occurred_on, 'short'))}</span>`,
      },
      {
        key: 'amount', label: 'Amount', numeric: true,
        render: (row) => moneyCell(row.amount, row.type),
      },
    ],

    card: (row) => `
      <div class="cli-head">
        <span class="stat-icon ${row.type === 'income' ? 'is-success' : 'is-danger'}">
          <i data-lucide="${row.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'}"></i>
        </span>
        <div class="grow">
          <b class="truncate" style="display:block">${escapeHtml(row.title)}</b>
          <span class="fs-xs muted">${escapeHtml(row.category)}</span>
        </div>
        ${moneyCell(row.amount, row.type)}
      </div>
      <div class="cli-rows">
        <div class="cli-row"><span>Client</span><span>${escapeHtml(store.clients.get(row.client_id)?.name || '—')}</span></div>
        <div class="cli-row"><span>Date</span><span>${escapeHtml(fmtDate(row.occurred_on, 'short'))}</span></div>
        <div class="cli-row"><span>Status</span><span>${statusBadge(row.status)}</span></div>
      </div>`,

    actions: (row) => rowActions(row.id, {
      extra: row.type === 'income' && row.status !== 'paid'
        ? [{ act: 'paid', icon: 'check-check', tip: 'Mark as paid' }]
        : [],
    }),

    onAction: (action, id, row) => {
      if (action === 'paid') markPaid(row);
      if (action === 'edit') openTransactionForm(row);
      if (action === 'delete') deleteTransaction(row);
    },

    empty: {
      icon: 'receipt',
      title: 'No transactions yet',
      body: 'Record your first invoice or expense to start building the picture.',
      action: { label: 'Add transaction', icon: 'plus', onClick: () => openTransactionForm() },
    },
  });
}

/* =============================================================================
   EXPORTS
   ========================================================================== */

const EXPORT_COLUMNS = [
  { key: 'occurred_on', label: 'Date', map: (row) => fmtDate(row.occurred_on) },
  { key: 'title', label: 'Description' },
  { key: 'type', label: 'Type', map: (row) => titleCase(row.type) },
  { key: 'category', label: 'Category' },
  { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
  { key: 'invoice_no', label: 'Invoice' },
  { key: 'client', label: 'Client', map: (row) => store.clients.get(row.client_id)?.name || '' },
  { key: 'project', label: 'Project', map: (row) => store.projects.get(row.project_id)?.name || '' },
  { key: 'amount', label: 'Amount', numeric: true, map: (row) => Number(row.amount).toFixed(2) },
];

function currentExportRows() {
  return table ? table.getVisible() : rangedTransactions();
}

function doExportCSV() {
  const rows = currentExportRows();
  if (!rows.length) { toast.warning('Nothing to export', 'No transactions match the filters.'); return; }

  exportCSV(rows, EXPORT_COLUMNS, `synthworks-finance-${isoDate()}.csv`);
  toast.success('CSV ready', `${rows.length} transactions exported.`);
}

function doExportPDF() {
  const rows = currentExportRows();
  if (!rows.length) { toast.warning('Nothing to export', 'No transactions match the filters.'); return; }

  const summary = store.financeSummary(rows);

  try {
    exportPDF({
      title: 'Finance report',
      subtitle: range.preset === 'all'
        ? 'All time'
        : `${fmtDate(range.from)} — ${fmtDate(range.to)}`,
      columns: EXPORT_COLUMNS,
      rows,
      summary: [
        { label: 'Income', value: money(summary.income) },
        { label: 'Expenses', value: money(summary.expense) },
        { label: summary.profit >= 0 ? 'Profit' : 'Loss', value: money(Math.abs(summary.profit)) },
        { label: 'Margin', value: percent(summary.margin, 1) },
        { label: 'Invoices', value: String(summary.invoices) },
      ],
    });
    toast.success('PDF ready', 'Choose "Save as PDF" in the print dialog.');
  } catch (err) {
    toast.error('Could not open the export', err.message);
  }
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderStats();
  renderCashflow();
  renderCategoryChart();
  renderDailyChart();
  renderYearlyChart();
  renderInvoiceHealth();
  renderTopClients();
  table?.refresh();
  updateRangeLabel();
}, 200);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('finance', { title: 'Finance' });

  try {
    await store.load('finance_transactions', 'clients', 'projects', 'profiles', 'notifications');
  } catch (err) {
    hideLoader();
    toast.error('Could not load finance data', err.message);
    return;
  }

  // Default range: last 30 days.
  range.to = new Date();
  range.from = addDays(range.to, -30);
  $('#dateFrom').value = isoDate(range.from);
  $('#dateTo').value = isoDate(range.to);
  updateRangeLabel();

  renderStats();
  buildTable();
  renderCashflow();
  renderCategoryChart();
  renderDailyChart();
  renderYearlyChart();
  renderInvoiceHealth();
  renderTopClients();

  /* ── Controls ──────────────────────────────────────────────────────── */
  $('#rangePreset')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset]');
    if (button) setPreset(button.dataset.preset);
  });

  $('#applyRange')?.addEventListener('click', () => {
    const from = $('#dateFrom').value;
    const to = $('#dateTo').value;
    if (!from || !to) { toast.warning('Pick both dates'); return; }
    if (toDate(from) > toDate(to)) { toast.warning('Invalid range', 'The start date must come first.'); return; }

    range.from = toDate(from);
    range.to = toDate(to);
    range.preset = 'custom';
    $$('#rangePreset button').forEach((button) => button.classList.remove('is-active'));
    updateRangeLabel();
    repaint();
    toast.info('Range applied', `${fmtDate(range.from)} → ${fmtDate(range.to)}`);
  });

  $('#cashflowType')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chart]');
    if (!button) return;
    $$('#cashflowType button').forEach((node) => node.classList.remove('is-active'));
    button.classList.add('is-active');
    cashflowType = button.dataset.chart;
    renderCashflow();
  });

  $('#addTransaction')?.addEventListener('click', () => openTransactionForm());
  $('#exportCsv')?.addEventListener('click', doExportCSV);
  $('#exportPdf')?.addEventListener('click', doExportPDF);

  // Deep link: finance.html?id=…
  const deepLink = queryParam('id');
  if (deepLink) {
    const txn = store.finance_transactions.get(deepLink);
    if (txn) setTimeout(() => openTransactionForm(txn), 400);
  }

  /* ── Realtime ──────────────────────────────────────────────────────── */
  store.on('finance_transactions:change', (change) => {
    repaint();
    if (change.remote && change.row?.id && table) {
      setTimeout(() => flashRow(table.root, change.row.id), 260);
    }
  });
  store.on('clients:change', repaint);
  store.on('projects:change', repaint);

  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
