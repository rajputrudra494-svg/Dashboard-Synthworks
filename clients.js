/* =============================================================================
   SynthWorks — clients.js
   Client CRM: table + card views, create / edit / delete, photo upload,
   per-client revenue rollups and a detail drawer. Fully realtime.

   `openClientForm()` is exported so the top bar's Quick Add can reuse it from
   any page in the app.
   ========================================================================== */

import { requireAuth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, initReveal,
  animatePage, animateItems, stagger,
} from './animations.js';
import { createTable, flashRow } from './table.js';
import { statCard, emptyState, statusBadge, avatar, rowActions, moneyCell } from './ui.js';
import { formModal, openDrawer } from './modal.js';
import { toast, confirmDialog } from './notifications.js';
import {
  $, $$, el, render, icons, escapeHtml, money, fmtDate, exportCSV, titleCase, debounce,
} from './utils.js';

const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

let table = null;
let view = 'table';

/* =============================================================================
   FORM  (create + edit)
   ========================================================================== */

/**
 * Opens the client dialog.
 * @param {Object} [client]  omit to create a new one
 * @returns {Promise<Object|null>}
 */
export async function openClientForm(client = null) {
  // Quick Add can fire from a page that never loaded this collection.
  if (!store.clients.loaded) await store.load('clients');

  const isEdit = Boolean(client?.id);

  const fields = [
    { name: 'name', label: 'Client name', required: true, placeholder: 'Northwind Studios', span: 2 },
    { name: 'company', label: 'Company', placeholder: 'Northwind Ltd.' },
    { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, required: true },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'hello@northwind.com' },
    { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+1 555 0123' },
    { name: 'website', label: 'Website', type: 'url', placeholder: 'https://northwind.com' },
    { name: 'avatar_url', label: 'Logo URL', type: 'url', placeholder: 'https://…/logo.png',
      hint: 'Paste a link, or upload a file from the client detail panel.' },
    { name: 'address', label: 'Address', type: 'textarea', rows: 2, span: 2, placeholder: 'Street, city, country' },
    { name: 'tags', label: 'Tags', type: 'tags', span: 2, placeholder: 'retainer, enterprise…' },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, span: 2,
      placeholder: 'Anything the team should know about this account.' },
  ];

  return formModal({
    title: isEdit ? 'Edit client' : 'New client',
    subtitle: isEdit ? client.name : 'Add an account to the shared workspace.',
    icon: 'building-2',
    submitLabel: isEdit ? 'Save changes' : 'Create client',
    fields,
    values: {
      status: 'active',
      ...client,
      tags: client?.tags || [],
    },
    async onSubmit(values) {
      const payload = {
        name: values.name,
        company: values.company,
        email: values.email,
        phone: values.phone,
        website: values.website,
        address: values.address,
        avatar_url: values.avatar_url,
        notes: values.notes,
        status: values.status,
        tags: values.tags || [],
      };

      if (isEdit) {
        const updated = await store.clients.update(client.id, payload);
        toast.success('Client updated', updated.name);
        return updated;
      }

      const created = await store.clients.create(payload);
      toast.success('Client added', `${created.name} is now in the workspace.`);
      store.pushNotification({
        title: 'New client',
        body: `${created.name} was added to the workspace.`,
        type: 'success',
        link: 'clients.html',
      });
      return created;
    },
  });
}

/* =============================================================================
   DELETE
   ========================================================================== */

async function deleteClient(client) {
  const linked = store.projects.all.filter((project) => project.client_id === client.id);

  const ok = await confirmDialog({
    title: `Delete ${client.name}?`,
    message: linked.length
      ? `${linked.length} project${linked.length === 1 ? '' : 's'} will be unlinked from this client but kept. This cannot be undone.`
      : 'This removes the client from the shared workspace for everyone. This cannot be undone.',
    confirmLabel: 'Delete client',
    danger: true,
  });
  if (!ok) return;

  try {
    await store.clients.remove(client.id);
    toast.success('Client deleted', client.name);
  } catch (err) {
    toast.error('Could not delete', err.message);
  }
}

/* =============================================================================
   DETAIL DRAWER
   ========================================================================== */

function openClientDetail(client) {
  if (!client) return;

  const rollup = store.clientRollup(client.id);
  const projects = store.projects.all.filter((project) => project.client_id === client.id);
  const transactions = store.finance_transactions.all
    .filter((txn) => txn.client_id === client.id)
    .slice(0, 6);

  const body = el('div');
  body.innerHTML = `
    <div class="flex items-center gap-4 mb-6">
      ${avatar({ name: client.name, avatar_url: client.avatar_url, id: client.id }, { size: 'xl' })}
      <div class="grow" style="min-width:0">
        <h2 style="font-size:var(--fs-lg)">${escapeHtml(client.name)}</h2>
        <p class="fs-sm muted">${escapeHtml(client.company || 'No company')}</p>
        <div class="flex gap-2 mt-2">${statusBadge(client.status)}</div>
      </div>
    </div>

    <div class="stat-grid mb-6" style="gap:var(--sp-2)">
      <div class="card card-pad">
        <span class="stat-label">Projects</span>
        <div class="stat-value" style="font-size:var(--fs-lg)">${rollup.projects}</div>
      </div>
      <div class="card card-pad">
        <span class="stat-label">Active</span>
        <div class="stat-value" style="font-size:var(--fs-lg)">${rollup.active}</div>
      </div>
      <div class="card card-pad">
        <span class="stat-label">Revenue</span>
        <div class="stat-value c-success" style="font-size:var(--fs-lg)">${escapeHtml(money(rollup.revenue, { compact: true }))}</div>
      </div>
    </div>

    <h3 class="fs-sm mb-3">Contact</h3>
    <div class="card card-pad mb-6">
      ${detailRow('mail', 'Email', client.email, client.email ? `mailto:${client.email}` : null)}
      ${detailRow('phone', 'Phone', client.phone, client.phone ? `tel:${client.phone}` : null)}
      ${detailRow('globe', 'Website', client.website, client.website)}
      ${detailRow('map-pin', 'Address', client.address)}
      ${detailRow('calendar', 'Client since', fmtDate(client.created_at))}
    </div>

    ${client.tags?.length ? `
      <h3 class="fs-sm mb-3">Tags</h3>
      <div class="flex wrap gap-2 mb-6">
        ${client.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
      </div>` : ''}

    ${client.notes ? `
      <h3 class="fs-sm mb-3">Notes</h3>
      <div class="card card-pad mb-6">
        <p class="fs-sm" style="white-space:pre-wrap">${escapeHtml(client.notes)}</p>
      </div>` : ''}

    <h3 class="fs-sm mb-3">Projects (${projects.length})</h3>
    <div class="card mb-6" ${projects.length ? '' : 'hidden'}>
      ${projects.map((project) => `
        <a class="list-row" href="projects.html?id=${escapeHtml(project.id)}">
          <span class="mini-cal-dot" style="background:${escapeHtml(project.color || 'var(--accent)')}"></span>
          <span class="grow" style="min-width:0">
            <b class="truncate fs-sm" style="display:block">${escapeHtml(project.name)}</b>
            <span class="fs-xs muted">${escapeHtml(money(project.budget, { compact: true }))} budget</span>
          </span>
          <span class="fs-xs muted tabular">${project.progress}%</span>
          ${statusBadge(project.status)}
        </a>`).join('')}
    </div>
    ${projects.length ? '' : '<p class="fs-sm muted mb-6">No projects linked yet.</p>'}

    <h3 class="fs-sm mb-3">Recent transactions</h3>
    ${transactions.length ? `
      <div class="card">
        ${transactions.map((txn) => `
          <div class="list-row">
            <span class="grow" style="min-width:0">
              <b class="truncate fs-sm" style="display:block">${escapeHtml(txn.title)}</b>
              <span class="fs-xs muted">${escapeHtml(fmtDate(txn.occurred_on))}</span>
            </span>
            ${moneyCell(txn.amount, txn.type)}
          </div>`).join('')}
      </div>` : '<p class="fs-sm muted">No transactions recorded.</p>'}
  `;

  const footer = el('div', { class: 'flex gap-2' });
  footer.innerHTML = `
    <button class="btn btn--secondary" type="button" data-detail="edit">
      <i data-lucide="pencil"></i> Edit
    </button>
    <button class="btn btn--danger" type="button" data-detail="delete">
      <i data-lucide="trash-2"></i> Delete
    </button>`;

  const drawer = openDrawer({
    title: 'Client details',
    subtitle: client.company || client.email || '',
    body,
    footer,
  });

  footer.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-detail]')?.dataset.detail;
    if (!action) return;
    drawer.close();
    if (action === 'edit') openClientForm(client);
    if (action === 'delete') deleteClient(client);
  });
}

function detailRow(icon, label, value, href = null) {
  if (!value) return '';
  const content = href
    ? `<a href="${escapeHtml(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${escapeHtml(value)}</a>`
    : escapeHtml(value);

  return `
    <div class="cli-row" style="padding:7px 0">
      <span class="flex items-center gap-2">
        <i data-lucide="${escapeHtml(icon)}" style="width:14px;height:14px;color:var(--text-faint)"></i>
        ${escapeHtml(label)}
      </span>
      <span class="fs-sm truncate">${content}</span>
    </div>`;
}

/* =============================================================================
   SUMMARY TILES
   ========================================================================== */

function renderStats() {
  const host = $('#clientStats');
  if (!host) return;

  const stats = store.clientStats();
  const revenue = store.clients.all.reduce(
    (total, client) => total + store.clientRollup(client.id).revenue, 0,
  );

  // Clients added in the last 30 days, for the trend chip.
  const cutoff = Date.now() - 30 * 86400000;
  const recent = store.clients.all.filter((client) => new Date(client.created_at).getTime() > cutoff).length;

  render(host, [
    statCard({ label: 'Total clients', value: stats.total, icon: 'building-2', tone: 'brand',
               hint: `${recent} added in 30 days` }),
    statCard({ label: 'Active', value: stats.active, icon: 'handshake', tone: 'success',
               hint: 'currently engaged' }),
    statCard({ label: 'Leads', value: stats.leads, icon: 'sparkles', tone: 'info',
               hint: 'not yet converted' }),
    statCard({ label: 'Lifetime revenue', value: revenue, icon: 'circle-dollar-sign',
               tone: 'success', format: 'money', hint: 'paid invoices' }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   CARD VIEW
   ========================================================================== */

function renderGrid() {
  const host = $('#clientGrid');
  if (!host) return;

  const clients = store.clients.all;

  if (!clients.length) {
    render(host, emptyState({
      icon: 'building-2',
      title: 'No clients yet',
      body: 'Add the first account and the whole team will see it instantly.',
      action: { label: 'Add client', icon: 'plus', onClick: () => openClientForm() },
    }));
    icons(host);
    return;
  }

  host.innerHTML = clients.map((client) => {
    const rollup = store.clientRollup(client.id);
    return `
      <article class="card card--hover card-pad" data-id="${escapeHtml(client.id)}" tabindex="0" role="button">
        <div class="flex items-center gap-3 mb-4">
          ${avatar({ name: client.name, avatar_url: client.avatar_url, id: client.id }, { size: 'lg' })}
          <div class="grow" style="min-width:0">
            <b class="truncate" style="display:block">${escapeHtml(client.name)}</b>
            <span class="fs-xs muted truncate" style="display:block">${escapeHtml(client.company || client.email || '—')}</span>
          </div>
          ${statusBadge(client.status)}
        </div>

        <div class="cli-rows">
          <div class="cli-row"><span>Projects</span><b>${rollup.projects}</b></div>
          <div class="cli-row"><span>Revenue</span><b class="c-success">${escapeHtml(money(rollup.revenue, { compact: true }))}</b></div>
          <div class="cli-row"><span>Since</span><span>${escapeHtml(fmtDate(client.created_at, 'short'))}</span></div>
        </div>

        ${client.tags?.length ? `
          <div class="flex wrap gap-1 mt-4">
            ${client.tags.slice(0, 3).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
          </div>` : ''}

        <div class="cli-foot">${rowActions(client.id)}</div>
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
    mount: '#clientTable',
    id: 'clients',
    rows: () => store.clients.all,
    searchFields: ['name', 'company', 'email', 'phone', (row) => (row.tags || []).join(' ')],
    searchPlaceholder: 'Search clients, companies, emails…',
    sort: { key: 'created_at', dir: 'desc' },
    perPage: 12,

    filters: [{
      key: 'status',
      label: 'Status',
      options: STATUS_OPTIONS,
    }],

    columns: [
      {
        key: 'name', label: 'Client',
        render: (row) => `
          <span class="cell-lead">
            ${avatar({ name: row.name, avatar_url: row.avatar_url, id: row.id })}
            <span class="ct">
              <b>${escapeHtml(row.name)}</b>
              <span>${escapeHtml(row.company || '—')}</span>
            </span>
          </span>`,
      },
      {
        key: 'email', label: 'Contact',
        render: (row) => `
          <span class="ct">
            <span class="fs-sm">${escapeHtml(row.email || '—')}</span><br>
            <span class="fs-xs muted">${escapeHtml(row.phone || '')}</span>
          </span>`,
      },
      {
        key: 'projects', label: 'Projects', numeric: true,
        sortValue: (row) => store.clientRollup(row.id).projects,
        render: (row) => {
          const rollup = store.clientRollup(row.id);
          return `<b class="tabular">${rollup.projects}</b>
                  <span class="fs-xs muted"> (${rollup.active} active)</span>`;
        },
      },
      {
        key: 'revenue', label: 'Revenue', numeric: true,
        sortValue: (row) => store.clientRollup(row.id).revenue,
        render: (row) => `<span class="cell-money in">${escapeHtml(money(store.clientRollup(row.id).revenue, { compact: true }))}</span>`,
      },
      { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      {
        key: 'created_at', label: 'Added', numeric: true,
        render: (row) => `<span class="fs-xs muted nowrap">${escapeHtml(fmtDate(row.created_at, 'short'))}</span>`,
      },
    ],

    card: (row) => {
      const rollup = store.clientRollup(row.id);
      return `
        <div class="cli-head">
          ${avatar({ name: row.name, avatar_url: row.avatar_url, id: row.id })}
          <div class="grow">
            <b class="truncate" style="display:block">${escapeHtml(row.name)}</b>
            <span class="fs-xs muted truncate" style="display:block">${escapeHtml(row.company || row.email || '—')}</span>
          </div>
          ${statusBadge(row.status)}
        </div>
        <div class="cli-rows">
          <div class="cli-row"><span>Projects</span><b>${rollup.projects}</b></div>
          <div class="cli-row"><span>Revenue</span><b class="c-success">${escapeHtml(money(rollup.revenue, { compact: true }))}</b></div>
          <div class="cli-row"><span>Added</span><span>${escapeHtml(fmtDate(row.created_at, 'short'))}</span></div>
        </div>`;
    },

    actions: (row) => rowActions(row.id, {
      extra: [{ act: 'view', icon: 'eye', tip: 'Details' }],
    }),

    onRowClick: (row) => openClientDetail(row),

    onAction: (action, id, row) => {
      if (action === 'view') openClientDetail(row);
      if (action === 'edit') openClientForm(row);
      if (action === 'delete') deleteClient(row);
    },

    empty: {
      icon: 'building-2',
      title: 'No clients yet',
      body: 'Add your first account. Everyone on the team will see it appear in realtime.',
      action: { label: 'Add client', icon: 'plus', onClick: () => openClientForm() },
    },
  });
}

/* =============================================================================
   EXPORT
   ========================================================================== */

function exportClients() {
  const rows = table ? table.getVisible() : store.clients.all;
  if (!rows.length) { toast.warning('Nothing to export', 'No clients match the current filters.'); return; }

  exportCSV(rows, [
    { key: 'name', label: 'Client' },
    { key: 'company', label: 'Company' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
    { key: 'projects', label: 'Projects', map: (row) => store.clientRollup(row.id).projects },
    { key: 'revenue', label: 'Revenue', map: (row) => store.clientRollup(row.id).revenue.toFixed(2) },
    { key: 'address', label: 'Address' },
    { key: 'tags', label: 'Tags', map: (row) => (row.tags || []).join('; ') },
    { key: 'created_at', label: 'Added', map: (row) => fmtDate(row.created_at) },
  ], `synthworks-clients-${new Date().toISOString().slice(0, 10)}.csv`);

  toast.success('Export ready', `${rows.length} clients written to CSV.`);
}

/* =============================================================================
   VIEW SWITCH
   ========================================================================== */

function setView(next) {
  view = next;
  $('#clientTable').hidden = next !== 'table';
  $('#clientGrid').hidden = next !== 'grid';

  $$('#viewSwitch button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === next);
  });

  if (next === 'grid') renderGrid();
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderStats();
  table?.refresh();
  if (view === 'grid') renderGrid();
}, 200);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('clients', { title: 'Clients' });

  try {
    await store.load('clients', 'projects', 'finance_transactions', 'profiles', 'notifications');
  } catch (err) {
    hideLoader();
    toast.error('Could not load clients', err.message);
    return;
  }

  renderStats();
  buildTable();

  $('#addClient')?.addEventListener('click', () => openClientForm());
  $('#exportClients')?.addEventListener('click', exportClients);

  $('#viewSwitch')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

  // Card-view interactions (the table view has its own delegation).
  $('#clientGrid')?.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-act]');
    const card = event.target.closest('.card[data-id]');
    if (!card) return;
    const client = store.clients.get(card.dataset.id);

    if (actionBtn) {
      event.stopPropagation();
      if (actionBtn.dataset.act === 'edit') openClientForm(client);
      if (actionBtn.dataset.act === 'delete') deleteClient(client);
      return;
    }
    openClientDetail(client);
  });

  $('#clientGrid')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const card = event.target.closest('.card[data-id]');
    if (card) openClientDetail(store.clients.get(card.dataset.id));
  });

  // Realtime: repaint, and flash rows a colleague just touched.
  store.on('clients:change', (change) => {
    repaint();
    if (change.remote && change.row?.id && table) {
      setTimeout(() => flashRow(table.root, change.row.id), 260);
    }
  });
  store.on('projects:change', repaint);
  store.on('finance_transactions:change', repaint);

  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
