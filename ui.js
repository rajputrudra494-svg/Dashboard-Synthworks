/* =============================================================================
   SynthWorks — ui.js
   Shared presentational builders.

   Anything that more than one page draws — a stat tile, a status badge, an
   avatar, an empty state, a skeleton, an activity row — is built here exactly
   once and imported everywhere. This is the file that keeps the page modules
   free of duplicated markup.
   ========================================================================== */

import {
  el, escapeHtml, initials, colorFor, money, num, timeAgo, fmtDate, titleCase, dueLabel,
} from './utils.js';

/* =============================================================================
   BADGES
   ========================================================================== */

const STATUS_TONE = {
  // clients
  lead: 'is-info', active: 'is-success', paused: 'is-warning', archived: 'is-muted',
  // projects
  planning: 'is-info', on_hold: 'is-warning', review: 'is-brand',
  completed: 'is-success', cancelled: 'is-danger',
  // tasks
  todo: 'is-muted', doing: 'is-info', done: 'is-success',
  // finance
  paid: 'is-success', pending: 'is-warning', overdue: 'is-danger',
};

/** @returns {string} HTML for a status pill. */
export function statusBadge(status) {
  const tone = STATUS_TONE[status] || 'is-muted';
  return `<span class="badge ${tone}">${escapeHtml(titleCase(status || 'unknown'))}</span>`;
}

/** @returns {string} HTML for a priority indicator. */
export function priorityTag(priority = 'medium') {
  return `<span class="prio prio--${escapeHtml(priority)}"><i></i>${escapeHtml(titleCase(priority))}</span>`;
}

/* =============================================================================
   AVATARS
   ========================================================================== */

/**
 * @param {{full_name?:string, name?:string, avatar_url?:string, id?:string, is_online?:boolean}} person
 * @param {{size?:'xs'|'sm'|''|'lg'|'xl', presence?:boolean}} [opts]
 */
export function avatar(person = {}, { size = '', presence = false } = {}) {
  const name = person.full_name || person.name || '—';
  const cls = size ? ` avatar--${size}` : '';
  const bg = colorFor(person.id || name);

  const inner = person.avatar_url
    ? `<img src="${escapeHtml(person.avatar_url)}" alt="" loading="lazy">`
    : escapeHtml(initials(name));

  const dot = presence
    ? `<span class="presence${person.is_online ? ' is-online' : ''}" title="${person.is_online ? 'Online' : 'Offline'}"></span>`
    : '';

  return `<span class="avatar${cls}" style="background:${bg}" title="${escapeHtml(name)}">${inner}${dot}</span>`;
}

/** Overlapping avatar stack with a "+N" overflow chip. */
export function avatarStack(people = [], max = 4) {
  if (!people.length) return '<span class="fs-xs faint">Unassigned</span>';

  const shown = people.slice(0, max)
    .map((person) => avatar(person, { size: 'sm' }))
    .join('');
  const rest = people.length - max;

  return `<span class="avatar-stack">${shown}${rest > 0 ? `<span class="more">+${rest}</span>` : ''}</span>`;
}

/* =============================================================================
   STAT TILE
   ========================================================================== */

/**
 * @param {Object} config
 * @param {string} config.label
 * @param {number} config.value
 * @param {string} [config.icon]
 * @param {'brand'|'success'|'warning'|'danger'|'info'} [config.tone='brand']
 * @param {'money'|'number'|'percent'} [config.format='number']
 * @param {number} [config.change]      percentage change vs the previous period
 * @param {string} [config.hint]        small text beside the trend
 * @param {string} [config.href]        makes the whole tile a link
 * @param {number[]} [config.spark]     inline sparkline series
 * @returns {HTMLElement}
 */
export function statCard({
  label, value, icon = 'activity', tone = 'brand', format = 'number',
  change = null, hint = '', href = null, spark = null, id = null,
}) {
  const toneClass = tone === 'brand' ? '' : ` is-${tone}`;

  const prefix = format === 'money' ? (money(0).replace(/[\d.,\s]/g, '') || '$') : '';
  const suffix = format === 'percent' ? '%' : '';
  const decimals = format === 'money' ? 0 : 0;

  const trend = change == null ? '' : (() => {
    const dir = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
    const glyph = dir === 'up' ? 'trending-up' : dir === 'down' ? 'trending-down' : 'minus';
    return `<span class="trend ${dir}"><i data-lucide="${glyph}"></i>${Math.abs(change).toFixed(1)}%</span>`;
  })();

  const node = el(href ? 'a' : 'div', {
    class: `card card--hover stat${href ? '' : ''}`,
    ...(href ? { href } : {}),
    ...(id ? { id } : {}),
  });

  node.innerHTML = `
    <div class="stat-top">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-icon${toneClass}"><i data-lucide="${escapeHtml(icon)}"></i></span>
    </div>
    <div class="stat-value" data-count="${Number(value) || 0}"
         data-count-prefix="${escapeHtml(prefix)}"
         data-count-suffix="${escapeHtml(suffix)}"
         data-count-decimals="${decimals}"
         data-count-compact="${format === 'money'}">${prefix}0${suffix}</div>
    ${(trend || hint) ? `<div class="stat-meta">${trend}<span class="faint">${escapeHtml(hint)}</span></div>` : ''}
    ${spark ? `<div class="stat-spark"><canvas id="spark-${escapeHtml(id || label.replace(/\W/g, ''))}"></canvas></div>` : ''}`;

  return node;
}

/* =============================================================================
   EMPTY STATE
   ========================================================================== */

/**
 * @param {{icon?:string, title:string, body?:string, action?:{label:string, onClick?:Function, href?:string, icon?:string}}} config
 */
export function emptyState({ icon = 'inbox', title, body = '', action = null }) {
  const node = el('div', { class: 'empty' });

  node.innerHTML = `
    <span class="empty-art"><i data-lucide="${escapeHtml(icon)}"></i></span>
    <h3>${escapeHtml(title)}</h3>
    ${body ? `<p>${escapeHtml(body)}</p>` : ''}`;

  if (action) {
    const button = el(action.href ? 'a' : 'button', {
      class: 'btn btn--primary mt-2',
      ...(action.href ? { href: action.href } : { type: 'button' }),
      html: `${action.icon ? `<i data-lucide="${escapeHtml(action.icon)}"></i>` : ''}${escapeHtml(action.label)}`,
    });
    if (action.onClick) button.addEventListener('click', action.onClick);
    node.append(button);
  }

  return node;
}

/* =============================================================================
   SKELETONS
   ========================================================================== */

/** @param {'stats'|'table'|'chart'|'list'|'cards'} kind */
export function skeleton(kind, count = 4) {
  const node = el('div');

  switch (kind) {
    case 'stats':
      node.className = 'stat-grid';
      node.innerHTML = Array.from({ length: count }, () => `
        <div class="sk-card">
          <div class="flex between mb-4"><div class="sk sk-line" style="width:40%"></div><div class="sk sk-circle"></div></div>
          <div class="sk" style="height:30px;width:64%;margin-bottom:10px"></div>
          <div class="sk sk-line" style="width:34%"></div>
        </div>`).join('');
      break;

    case 'chart':
      node.className = 'card card-pad';
      node.innerHTML = '<div class="sk sk-title"></div><div class="sk sk-chart"></div>';
      break;

    case 'table':
      node.className = 'card card-pad';
      node.innerHTML = `<div class="sk sk-title"></div>${
        Array.from({ length: count }, () => `
          <div class="flex items-center gap-3" style="padding:12px 0">
            <div class="sk sk-circle"></div>
            <div class="grow"><div class="sk sk-line" style="width:52%"></div><div class="sk sk-line" style="width:28%;margin:0"></div></div>
            <div class="sk sk-line" style="width:74px;margin:0"></div>
          </div>`).join('')}`;
      break;

    case 'cards':
      node.className = 'grid-auto';
      node.innerHTML = Array.from({ length: count }, () => `
        <div class="sk-card"><div class="sk sk-title"></div><div class="sk sk-line"></div>
        <div class="sk sk-line"></div><div class="sk sk-block mt-4"></div></div>`).join('');
      break;

    default:
      node.innerHTML = Array.from({ length: count }, () => `
        <div class="flex items-center gap-3" style="padding:11px 0">
          <div class="sk sk-circle"></div>
          <div class="grow"><div class="sk sk-line" style="width:60%"></div><div class="sk sk-line" style="width:30%;margin:0"></div></div>
        </div>`).join('');
  }

  return node;
}

/* =============================================================================
   ACTIVITY FEED
   ========================================================================== */

const ACTION_ICON = {
  created: 'plus', updated: 'pencil', deleted: 'trash-2', completed: 'check',
};

const ENTITY_ICON = {
  client: 'building-2', project: 'folder-kanban', task: 'circle-check-big',
  transaction: 'receipt', event: 'calendar',
};

const ACTION_VERB = {
  created: 'added', updated: 'updated', deleted: 'deleted', completed: 'completed',
};

/** @returns {string} HTML for one activity row. */
export function activityRow(row, { showEntity = true } = {}) {
  const icon = ACTION_ICON[row.action] || ENTITY_ICON[row.entity_type] || 'activity';
  const verb = ACTION_VERB[row.action] || row.action;

  return `
    <div class="feed-item">
      <span class="feed-icon is-${escapeHtml(row.action)}"><i data-lucide="${icon}"></i></span>
      <div class="feed-text grow">
        <p><b>${escapeHtml(row.actor_name || 'Someone')}</b> ${escapeHtml(verb)}
           ${showEntity ? `${escapeHtml(row.entity_type)} ` : ''}<em>${escapeHtml(row.entity_label || 'a record')}</em></p>
        <span class="feed-time" title="${escapeHtml(row.created_at)}">${escapeHtml(timeAgo(row.created_at))}</span>
      </div>
    </div>`;
}

/* =============================================================================
   UPCOMING / DEADLINE ROWS
   ========================================================================== */

const KIND_ICON = {
  project: 'folder-kanban', task: 'circle-check-big', meeting: 'video',
  deadline: 'flag', milestone: 'flag-triangle-right', reminder: 'bell', holiday: 'palmtree',
};

/** @returns {string} HTML for a dated row with a calendar chip on the left. */
export function dueRow({ date, title, meta, kind = 'task', href = '#' }) {
  const d = new Date(date);
  const label = dueLabel(d);

  return `
    <a class="due-row" href="${escapeHtml(href)}">
      <span class="due-date">
        <b>${d.getDate()}</b>
        <span>${d.toLocaleDateString(undefined, { month: 'short' })}</span>
      </span>
      <span class="grow" style="min-width:0">
        <b class="truncate" style="display:block;font-size:var(--fs-sm)">${escapeHtml(title)}</b>
        <span class="fs-xs muted flex items-center gap-1">
          <i data-lucide="${KIND_ICON[kind] || 'calendar'}" style="width:12px;height:12px"></i>
          ${escapeHtml(meta || titleCase(kind))}
        </span>
      </span>
      <span class="fs-xs ${label.tone === 'is-overdue' ? 'c-danger' : label.tone === 'is-soon' ? 'c-warning' : 'faint'} nowrap">
        ${escapeHtml(label.text)}
      </span>
    </a>`;
}

/* =============================================================================
   PROGRESS
   ========================================================================== */

export function progressBar(percent, { tone = '', showLabel = true } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const auto = tone || (pct >= 100 ? 'is-success' : pct < 30 ? '' : '');

  return `
    <span class="cell-progress">
      <span class="progress ${auto}"><i style="width:${pct}%"></i></span>
      ${showLabel ? `<b>${pct}%</b>` : ''}
    </span>`;
}

/** SVG ring. `size` is the outer diameter in px. */
export function progressRing(percent, size = 74) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;

  return `
    <span class="ring" style="--pct:${pct};--circ:${circ}">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--primary)"/>
            <stop offset="100%" stop-color="var(--accent)"/>
          </linearGradient>
        </defs>
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}"></circle>
        <circle class="ring-value" cx="${size / 2}" cy="${size / 2}" r="${r}"></circle>
      </svg>
      <b>${pct}%</b>
    </span>`;
}

/* =============================================================================
   TABLE HELPERS
   ========================================================================== */

/** Primary table cell: avatar + name + subtitle. */
export function leadCell(person, subtitle, { size = '' } = {}) {
  return `
    <span class="cell-lead">
      ${avatar(person, { size })}
      <span class="ct">
        <b>${escapeHtml(person.full_name || person.name || '—')}</b>
        <span>${escapeHtml(subtitle || '')}</span>
      </span>
    </span>`;
}

/** Edit / delete buttons for a table row. */
export function rowActions(id, { edit = true, remove = true, extra = [] } = {}) {
  const buttons = [
    ...extra.map((action) => `
      <button class="icon-btn" type="button" data-act="${escapeHtml(action.act)}" data-id="${escapeHtml(id)}"
              data-tip="${escapeHtml(action.tip)}" aria-label="${escapeHtml(action.tip)}">
        <i data-lucide="${escapeHtml(action.icon)}"></i>
      </button>`),
    edit ? `
      <button class="icon-btn" type="button" data-act="edit" data-id="${escapeHtml(id)}"
              data-tip="Edit" aria-label="Edit">
        <i data-lucide="pencil"></i>
      </button>` : '',
    remove ? `
      <button class="icon-btn is-danger" type="button" data-act="delete" data-id="${escapeHtml(id)}"
              data-tip="Delete" aria-label="Delete">
        <i data-lucide="trash-2"></i>
      </button>` : '',
  ].filter(Boolean).join('');

  return `<span class="row-actions">${buttons}</span>`;
}

/* =============================================================================
   PAGINATION
   ========================================================================== */

/**
 * @param {{page:number, pages:number, total:number, perPage:number}} state
 * @returns {string}
 */
export function pagination({ page, pages, total, perPage }) {
  if (total === 0) return '';

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  // Windowed page numbers with ellipses, so 200 pages stay one line.
  const numbers = [];
  const push = (n) => numbers.push(`
    <button class="page-btn${n === page ? ' is-active' : ''}" type="button" data-page="${n}"
            ${n === page ? 'aria-current="page"' : ''}>${n}</button>`);

  if (pages <= 7) {
    for (let i = 1; i <= pages; i += 1) push(i);
  } else {
    push(1);
    if (page > 3) numbers.push('<span class="page-ellipsis">…</span>');
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i += 1) push(i);
    if (page < pages - 2) numbers.push('<span class="page-ellipsis">…</span>');
    push(pages);
  }

  return `
    <div class="pagination">
      <span class="result-count">${from}–${to} of ${num(total)}</span>
      <div class="pages">
        <button class="page-btn" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}
                aria-label="Previous page"><i data-lucide="chevron-left"></i></button>
        ${numbers.join('')}
        <button class="page-btn" type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}
                aria-label="Next page"><i data-lucide="chevron-right"></i></button>
      </div>
    </div>`;
}

/* =============================================================================
   MISC
   ========================================================================== */

/** Coloured money cell — green for income, red for expense. */
export function moneyCell(amount, type) {
  const cls = type === 'income' ? 'in' : type === 'expense' ? 'out' : '';
  const sign = type === 'expense' ? '−' : type === 'income' ? '+' : '';
  return `<span class="cell-money ${cls}">${sign}${escapeHtml(money(Math.abs(amount)))}</span>`;
}

/** Small dated label, e.g. "12 Mar 2026". */
export const dateCell = (value) =>
  `<span class="fs-xs muted nowrap">${escapeHtml(fmtDate(value))}</span>`;

/** Tag chips from a text[] column. */
export const tagChips = (tags = []) =>
  (tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('');

/** Sortable <th>. */
export function sortableTh(label, key, sortState, { numeric = false } = {}) {
  const active = sortState.key === key;
  const order = active ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `
    <th class="sortable${numeric ? ' num' : ''}" data-sort="${escapeHtml(key)}"
        aria-sort="${order}" tabindex="0" role="columnheader">
      ${escapeHtml(label)}
      <span class="sort-ico"><i data-lucide="${active ? 'arrow-up' : 'chevrons-up-down'}"></i></span>
    </th>`;
}
