/* =============================================================================
   SynthWorks — table.js
   A reusable data-table controller.

   Search, sort, filter, paginate, render — for BOTH the desktop <table> and the
   stacked card list that replaces it below 860px. Clients, Finance, Projects
   (list view) and Team all drive the same component, which is why those page
   modules only have to describe their columns.

       const table = createTable({ mount, columns, rows: () => store.clients.all, … });
       store.on('clients:change', table.refresh);
   ========================================================================== */

import { $, $$, icons, escapeHtml, sortBy, matches, paginate, debounce, storage } from './utils.js';
import { emptyState, pagination, sortableTh } from './ui.js';
import { animateItems } from './animations.js';

/**
 * @typedef {Object} Column
 * @property {string}   key        row property (also the sort key)
 * @property {string}   label      column heading
 * @property {boolean}  [sortable]
 * @property {boolean}  [numeric]  right-aligns and sorts numerically
 * @property {boolean}  [hideOnCard] omit from the mobile card body
 * @property {(row:Object)=>string} [render] cell HTML (defaults to the raw value)
 * @property {(row:Object)=>any}    [sortValue] override the sorted value
 */

/**
 * @param {Object} config
 * @param {HTMLElement|string} config.mount
 * @param {Column[]} config.columns
 * @param {() => Object[]} config.rows                 always read fresh from the store
 * @param {string} [config.id]                         persists sort/filter/page prefs
 * @param {(string|Function)[]} [config.searchFields]
 * @param {string} [config.searchPlaceholder]
 * @param {{key:string,label:string,options:{value:string,label:string}[],test?:Function}[]} [config.filters]
 * @param {{key:string,dir:'asc'|'desc'}} [config.sort]
 * @param {number} [config.perPage=12]
 * @param {(row:Object)=>string} [config.card]         mobile card body HTML
 * @param {(row:Object)=>string} [config.actions]      row action buttons HTML
 * @param {(row:Object)=>void} [config.onRowClick]
 * @param {(act:string, id:string, row:Object)=>void} [config.onAction]
 * @param {Object} [config.empty]                      emptyState() config
 * @param {string} [config.toolbarExtra]               extra toolbar HTML (export buttons…)
 * @returns {{ refresh: Function, getRows: Function, getVisible: Function, root: HTMLElement }}
 */
export function createTable({
  mount,
  columns,
  rows,
  id = 'table',
  searchFields = [],
  searchPlaceholder = 'Search…',
  filters = [],
  sort = { key: 'created_at', dir: 'desc' },
  perPage = 12,
  card = null,
  actions = null,
  onRowClick = null,
  onAction = null,
  empty = { icon: 'inbox', title: 'Nothing here yet' },
  toolbarExtra = '',
} = {}) {
  const host = typeof mount === 'string' ? $(mount) : mount;
  if (!host) throw new Error('[table] mount element not found');

  /* ── State (sort + page size survive a reload) ───────────────────────── */
  const saved = storage.get(`table:${id}`, {});
  const state = {
    query: '',
    sort: saved.sort || { ...sort },
    filters: Object.fromEntries(filters.map((filter) => [filter.key, 'all'])),
    page: 1,
    perPage: saved.perPage || perPage,
  };

  const persist = () => storage.set(`table:${id}`, { sort: state.sort, perPage: state.perPage });

  /* ── Shell (built once; only the body re-renders) ─────────────────────── */
  host.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="search-mini">
          <i data-lucide="search"></i>
          <input type="search" class="input" placeholder="${escapeHtml(searchPlaceholder)}"
                 aria-label="${escapeHtml(searchPlaceholder)}" data-role="search">
        </div>
        ${filters.map((filter) => `
          <select class="input" data-filter="${escapeHtml(filter.key)}"
                  aria-label="${escapeHtml(filter.label)}" style="width:auto;min-width:132px">
            <option value="all">${escapeHtml(filter.label)}: All</option>
            ${filter.options.map((option) => `
              <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}
          </select>`).join('')}
        <span class="toolbar-spacer"></span>
        <span class="result-count" data-role="count"></span>
        ${toolbarExtra}
      </div>

      <div class="table-scroll">
        <table class="data">
          <thead><tr data-role="head"></tr></thead>
          <tbody data-role="body"></tbody>
        </table>
      </div>

      <div class="card-list" data-role="cards"></div>
      <div data-role="pager"></div>
    </div>`;

  const root = host.querySelector('.table-wrap');
  const headRow = $('[data-role="head"]', root);
  const body = $('[data-role="body"]', root);
  const cards = $('[data-role="cards"]', root);
  const pager = $('[data-role="pager"]', root);
  const countNode = $('[data-role="count"]', root);
  const searchInput = $('[data-role="search"]', root);

  /* ── Derivation ──────────────────────────────────────────────────────── */

  function visibleRows() {
    let list = rows() || [];

    // Search.
    if (state.query && searchFields.length) {
      list = list.filter((row) => matches(row, state.query, searchFields));
    }

    // Filters.
    filters.forEach((filter) => {
      const value = state.filters[filter.key];
      if (!value || value === 'all') return;
      list = filter.test
        ? list.filter((row) => filter.test(row, value))
        : list.filter((row) => String(row[filter.key]) === value);
    });

    // Sort.
    if (state.sort.key) {
      const column = columns.find((col) => col.key === state.sort.key);
      const accessor = column?.sortValue || ((row) => row[state.sort.key]);
      list = sortBy(list, accessor, state.sort.dir);
    }

    return list;
  }

  /* ── Rendering ───────────────────────────────────────────────────────── */

  function renderHead() {
    headRow.innerHTML = columns.map((column) => (
      column.sortable === false
        ? `<th class="${column.numeric ? 'num' : ''}">${escapeHtml(column.label)}</th>`
        : sortableTh(column.label, column.key, state.sort, { numeric: column.numeric })
    )).join('') + (actions ? '<th class="num"><span class="sr-only">Actions</span></th>' : '');
  }

  function renderBody(list) {
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="${columns.length + (actions ? 1 : 0)}"></td></tr>`;
      body.querySelector('td').append(buildEmpty());
      cards.replaceChildren(buildEmpty());
      pager.innerHTML = '';
      return;
    }

    const page = paginate(list, state.page, state.perPage);
    state.page = page.page;

    // Desktop rows.
    body.innerHTML = page.rows.map((row, index) => `
      <tr class="row-in${onRowClick ? ' is-clickable' : ''}" data-id="${escapeHtml(row.id)}" style="--i:${index}">
        ${columns.map((column) => `
          <td class="${column.numeric ? 'num' : ''}">${
            column.render ? column.render(row) : escapeHtml(row[column.key] ?? '—')
          }</td>`).join('')}
        ${actions ? `<td class="num">${actions(row)}</td>` : ''}
      </tr>`).join('');

    // Mobile cards.
    cards.innerHTML = page.rows.map((row) => `
      <article class="card-list-item" data-id="${escapeHtml(row.id)}">
        ${card ? card(row) : defaultCard(row)}
        ${actions ? `<div class="cli-foot">${actions(row)}</div>` : ''}
      </article>`).join('');

    pager.innerHTML = pagination({
      page: page.page, pages: page.pages, total: page.total, perPage: state.perPage,
    });

    icons(root);
    animateItems($$('.card-list-item', cards).slice(0, 8));
  }

  function defaultCard(row) {
    const [lead, ...rest] = columns;
    return `
      <div class="cli-head">${lead.render ? lead.render(row) : escapeHtml(row[lead.key] ?? '')}</div>
      <div class="cli-rows">
        ${rest.filter((column) => !column.hideOnCard).map((column) => `
          <div class="cli-row">
            <span>${escapeHtml(column.label)}</span>
            <span>${column.render ? column.render(row) : escapeHtml(row[column.key] ?? '—')}</span>
          </div>`).join('')}
      </div>`;
  }

  function buildEmpty() {
    const hasQuery = state.query || Object.values(state.filters).some((value) => value !== 'all');
    return emptyState(hasQuery
      ? {
          icon: 'search-x',
          title: 'No matches',
          body: 'Try a different search term or clear the filters.',
          action: { label: 'Clear filters', icon: 'x', onClick: reset },
        }
      : empty);
  }

  function reset() {
    state.query = '';
    state.page = 1;
    filters.forEach((filter) => { state.filters[filter.key] = 'all'; });
    searchInput.value = '';
    $$('[data-filter]', root).forEach((select) => { select.value = 'all'; });
    refresh();
  }

  function refresh() {
    const list = visibleRows();
    const total = (rows() || []).length;

    countNode.textContent = list.length === total
      ? `${total} ${total === 1 ? 'record' : 'records'}`
      : `${list.length} of ${total}`;

    renderHead();
    renderBody(list);
    icons(root);
  }

  /* ── Events ──────────────────────────────────────────────────────────── */

  searchInput.addEventListener('input', debounce((event) => {
    state.query = event.target.value;
    state.page = 1;
    refresh();
  }, 200));

  $$('[data-filter]', root).forEach((select) => {
    select.addEventListener('change', (event) => {
      state.filters[event.target.dataset.filter] = event.target.value;
      state.page = 1;
      refresh();
    });
  });

  // Sorting — click or keyboard on the header cell.
  const toggleSort = (key) => {
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' };
    state.page = 1;
    persist();
    refresh();
  };

  headRow.addEventListener('click', (event) => {
    const th = event.target.closest('[data-sort]');
    if (th) toggleSort(th.dataset.sort);
  });
  headRow.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const th = event.target.closest('[data-sort]');
    if (!th) return;
    event.preventDefault();
    toggleSort(th.dataset.sort);
  });

  // Pagination.
  pager.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page);
    refresh();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Row actions + row clicks.
  root.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-act]');
    if (actionBtn) {
      event.stopPropagation();
      const rowId = actionBtn.dataset.id;
      onAction?.(actionBtn.dataset.act, rowId, (rows() || []).find((row) => row.id === rowId));
      return;
    }

    if (!onRowClick) return;
    const container = event.target.closest('tr[data-id], .card-list-item[data-id]');
    if (!container) return;
    onRowClick((rows() || []).find((row) => row.id === container.dataset.id));
  });

  icons(root);
  refresh();

  return {
    refresh,
    reset,
    root,
    getVisible: visibleRows,
    getState: () => ({ ...state }),
  };
}

/**
 * Flashes a row to draw the eye to a realtime change made by someone else.
 * @param {HTMLElement} root
 * @param {string} rowId
 */
export function flashRow(root, rowId) {
  const node = $(`tr[data-id="${CSS.escape(rowId)}"], .card-list-item[data-id="${CSS.escape(rowId)}"]`, root);
  if (!node) return;
  node.classList.remove('is-flash');
  void node.offsetWidth;           // restart the animation
  node.classList.add('is-flash');
  setTimeout(() => node.classList.remove('is-flash'), 1600);
}

export default createTable;
