/* =============================================================================
   SynthWorks — calendar.js
   Shared month calendar.

   The grid merges three sources into one view:
     • calendar_events  — meetings, reminders, holidays the team creates
     • projects         — their deadlines, rendered as read-only markers
     • milestones       — project checkpoints, likewise

   Only calendar_events are editable here; deadlines link back to their project.
   ========================================================================== */

import { requireAuth, auth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initReveal, animatePage, animateItems,
} from './animations.js';
import { emptyState, dueRow, avatar } from './ui.js';
import { formModal, openDrawer } from './modal.js';
import { toast, confirmDialog } from './notifications.js';
import {
  $, $$, el, render, icons, escapeHtml, fmtDate, fmtTime, isoDate, isoDateTime,
  isSameDay, isToday, startOfMonth, endOfMonth, addMonths, addDays, toDate,
  titleCase, debounce, queryParam,
} from './utils.js';

const TYPE_OPTIONS = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'holiday', label: 'Time off' },
];

const TYPE_COLOR = {
  meeting: '#A855F7', deadline: '#EF4444', milestone: '#FACC15',
  reminder: '#38BDF8', holiday: '#22C55E',
};

let cursor = startOfMonth(new Date());   // the month being shown
let selected = new Date();               // the day the agenda is showing
let typeFilter = 'all';

/* =============================================================================
   EVENT SOURCES
   ========================================================================== */

/** Every dated item, normalised into one shape the grid can render. */
function allEvents() {
  const items = [];

  store.calendar_events.all.forEach((event) => {
    items.push({
      id: event.id,
      source: 'event',
      type: event.type,
      title: event.title,
      date: toDate(event.starts_at),
      endDate: event.ends_at ? toDate(event.ends_at) : null,
      allDay: event.all_day,
      color: event.color || TYPE_COLOR[event.type],
      location: event.location,
      description: event.description,
      projectId: event.project_id,
      clientId: event.client_id,
      attendees: event.attendees || [],
      raw: event,
    });
  });

  // Project deadlines — read-only markers.
  store.projects.all.forEach((project) => {
    if (!project.deadline || project.status === 'cancelled') return;
    items.push({
      id: `project-${project.id}`,
      source: 'project',
      type: 'deadline',
      title: `${project.name} due`,
      date: toDate(project.deadline),
      allDay: true,
      color: project.color || TYPE_COLOR.deadline,
      projectId: project.id,
      raw: project,
    });
  });

  // Milestones.
  store.milestones.all.forEach((milestone) => {
    if (!milestone.due_date) return;
    const project = store.projects.get(milestone.project_id);
    items.push({
      id: `milestone-${milestone.id}`,
      source: 'milestone',
      type: 'milestone',
      title: milestone.title,
      date: toDate(milestone.due_date),
      allDay: true,
      color: TYPE_COLOR.milestone,
      projectId: milestone.project_id,
      description: project ? `${project.name} milestone` : '',
      done: milestone.is_complete,
      raw: milestone,
    });
  });

  return items
    .filter((item) => item.date)
    .filter((item) => typeFilter === 'all' || item.type === typeFilter)
    .sort((a, b) => a.date - b.date);
}

const eventsOn = (day) => allEvents().filter((item) => isSameDay(item.date, day));

/* =============================================================================
   FORM
   ========================================================================== */

/**
 * Opens the event dialog.
 * @param {Object} [event]
 * @param {{date?: Date}} [defaults]
 */
export async function openEventForm(event = null, defaults = {}) {
  if (!store.calendar_events.loaded) {
    await store.load('calendar_events', 'projects', 'clients', 'profiles');
  }

  const isEdit = Boolean(event?.id);
  const startDefault = defaults.date
    ? new Date(new Date(defaults.date).setHours(10, 0, 0, 0))
    : new Date(Date.now() + 3600000);

  return formModal({
    title: isEdit ? 'Edit event' : 'New event',
    subtitle: isEdit ? event.title : 'Everyone on the team will see this on the calendar.',
    icon: 'calendar-plus',
    submitLabel: isEdit ? 'Save changes' : 'Add to calendar',

    fields: [
      { name: 'title', label: 'Title', required: true, span: 2, placeholder: 'Kick-off call with Northwind' },
      { name: 'type', label: 'Type', type: 'select', required: true, options: TYPE_OPTIONS },
      { name: 'location', label: 'Location / link', placeholder: 'Meet, Zoom, studio…' },
      { name: 'starts_at', label: 'Starts', type: 'datetime-local', required: true },
      { name: 'ends_at', label: 'Ends', type: 'datetime-local' },
      { name: 'all_day', label: 'All-day event', type: 'switch', span: 2 },
      { name: 'project_id', label: 'Project', type: 'select', allowEmpty: true, emptyLabel: '— None —',
        options: store.projects.all.map((project) => ({ value: project.id, label: project.name })) },
      { name: 'client_id', label: 'Client', type: 'select', allowEmpty: true, emptyLabel: '— None —',
        options: store.clients.all.map((client) => ({ value: client.id, label: client.name })) },
      { name: 'attendees', label: 'Attendees', type: 'members', span: 2, options: store.profiles.all },
      { name: 'color', label: 'Colour', type: 'color', span: 2 },
      { name: 'description', label: 'Notes / agenda', type: 'textarea', rows: 3, span: 2 },
    ],

    values: {
      type: 'meeting',
      color: TYPE_COLOR.meeting,
      attendees: [auth.userId].filter(Boolean),
      ...event,
      starts_at: event?.starts_at ? isoDateTime(event.starts_at) : isoDateTime(startDefault),
      ends_at: event?.ends_at ? isoDateTime(event.ends_at) : '',
    },

    async onSubmit(values) {
      const payload = {
        title: values.title,
        description: values.description,
        type: values.type,
        starts_at: new Date(values.starts_at).toISOString(),
        ends_at: values.ends_at ? new Date(values.ends_at).toISOString() : null,
        all_day: Boolean(values.all_day),
        location: values.location,
        color: values.color || TYPE_COLOR[values.type],
        project_id: values.project_id || null,
        client_id: values.client_id || null,
        attendees: values.attendees || [],
      };

      const saved = isEdit
        ? await store.calendar_events.update(event.id, payload)
        : await store.calendar_events.create(payload);

      toast.success(isEdit ? 'Event updated' : 'Event added', saved.title);

      if (!isEdit) {
        store.pushNotification({
          title: `New ${payload.type}`,
          body: `${saved.title} — ${fmtDate(saved.starts_at)}`,
          type: 'info',
          link: 'calendar.html',
        });
      }

      // Jump the view to the event's month so the user sees the result.
      cursor = startOfMonth(toDate(saved.starts_at));
      selected = toDate(saved.starts_at);
      return saved;
    },
  });
}

async function deleteEvent(event) {
  const ok = await confirmDialog({
    title: 'Delete this event?',
    message: `"${event.title}" will be removed from everyone's calendar.`,
    confirmLabel: 'Delete event',
    danger: true,
  });
  if (!ok) return;

  try {
    await store.calendar_events.remove(event.id);
    toast.success('Event deleted', event.title);
  } catch (err) {
    toast.error('Could not delete', err.message);
  }
}

/* =============================================================================
   EVENT DETAIL
   ========================================================================== */

function openEventDetail(item) {
  // Deadlines and milestones belong to their project — send the user there.
  if (item.source !== 'event') {
    location.href = `projects.html?id=${item.projectId}`;
    return;
  }

  const event = item.raw;
  const project = store.projects.get(event.project_id);
  const client = store.clients.get(event.client_id);
  const attendees = (event.attendees || []).map((id) => store.profiles.get(id)).filter(Boolean);

  const body = el('div');
  body.innerHTML = `
    <div class="flex items-center gap-3 mb-6">
      <span class="stat-icon" style="background:${escapeHtml(event.color)}22;color:${escapeHtml(event.color)}">
        <i data-lucide="calendar"></i>
      </span>
      <div class="grow">
        <span class="badge is-brand">${escapeHtml(titleCase(event.type))}</span>
      </div>
    </div>

    <div class="card card-pad mb-6">
      <div class="cli-row" style="padding:7px 0">
        <span>Starts</span>
        <span>${escapeHtml(event.all_day ? fmtDate(event.starts_at, 'long') : `${fmtDate(event.starts_at)} · ${fmtTime(event.starts_at)}`)}</span>
      </div>
      ${event.ends_at ? `
        <div class="cli-row" style="padding:7px 0">
          <span>Ends</span>
          <span>${escapeHtml(event.all_day ? fmtDate(event.ends_at, 'long') : `${fmtDate(event.ends_at)} · ${fmtTime(event.ends_at)}`)}</span>
        </div>` : ''}
      ${event.location ? `
        <div class="cli-row" style="padding:7px 0">
          <span>Location</span>
          <span class="truncate">${
            /^https?:/.test(event.location)
              ? `<a href="${escapeHtml(event.location)}" target="_blank" rel="noopener">Open link</a>`
              : escapeHtml(event.location)}</span>
        </div>` : ''}
      ${project ? `
        <div class="cli-row" style="padding:7px 0">
          <span>Project</span>
          <a href="projects.html?id=${escapeHtml(project.id)}">${escapeHtml(project.name)}</a>
        </div>` : ''}
      ${client ? `
        <div class="cli-row" style="padding:7px 0">
          <span>Client</span>
          <a href="clients.html?id=${escapeHtml(client.id)}">${escapeHtml(client.name)}</a>
        </div>` : ''}
    </div>

    ${attendees.length ? `
      <h3 class="fs-sm mb-3">Attendees (${attendees.length})</h3>
      <div class="flex wrap gap-2 mb-6">
        ${attendees.map((person) => `
          <span class="member-opt is-on">${avatar(person, { size: 'xs' })} ${escapeHtml(person.full_name)}</span>
        `).join('')}
      </div>` : ''}

    ${event.description ? `
      <h3 class="fs-sm mb-3">Notes</h3>
      <div class="card card-pad">
        <p class="fs-sm" style="white-space:pre-wrap">${escapeHtml(event.description)}</p>
      </div>` : ''}`;

  const footer = el('div', { class: 'flex gap-2' });
  footer.innerHTML = `
    <button class="btn btn--secondary" type="button" data-detail="edit"><i data-lucide="pencil"></i> Edit</button>
    <button class="btn btn--danger" type="button" data-detail="delete"><i data-lucide="trash-2"></i> Delete</button>`;

  const drawer = openDrawer({
    title: event.title,
    subtitle: fmtDate(event.starts_at, 'long'),
    body,
    footer,
  });

  footer.addEventListener('click', (clickEvent) => {
    const action = clickEvent.target.closest('[data-detail]')?.dataset.detail;
    if (!action) return;
    drawer.close();
    if (action === 'edit') openEventForm(event);
    if (action === 'delete') deleteEvent(event);
  });
}

/* =============================================================================
   MONTH GRID
   ========================================================================== */

function renderGrid() {
  const grid = $('#calGrid');
  if (!grid) return;

  const weekStart = store.workspace().week_start ?? 1;

  const title = $('#calTitle');
  if (title) {
    title.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
  }

  // Day-of-week headings, rotated to the workspace's week start.
  const dowNames = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(2024, 0, 7 + ((index + weekStart) % 7));   // 2024-01-07 was a Sunday
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day);
  });

  // Leading blanks so the 1st lands under the right column.
  const first = startOfMonth(cursor);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const gridStart = addDays(first, -lead);

  // Always 6 rows so the grid height never jumps between months.
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const events = allEvents();

  grid.innerHTML = `
    ${dowNames.map((name) => `<div class="cal-dow" role="columnheader">${escapeHtml(name)}</div>`).join('')}
    ${cells.map((day) => {
      const dayEvents = events.filter((item) => isSameDay(item.date, day));
      const outside = day.getMonth() !== cursor.getMonth();
      const weekend = [0, 6].includes(day.getDay());

      const classes = [
        'cal-day',
        outside ? 'is-outside' : '',
        weekend ? 'is-weekend' : '',
        isToday(day) ? 'is-today' : '',
        isSameDay(day, selected) ? 'is-selected' : '',
      ].filter(Boolean).join(' ');

      return `
        <div class="${classes}" role="gridcell" tabindex="0"
             data-date="${isoDate(day)}"
             aria-label="${escapeHtml(fmtDate(day, 'long'))}${dayEvents.length ? `, ${dayEvents.length} events` : ''}">
          <span class="cal-num">${day.getDate()}</span>

          ${dayEvents.slice(0, 3).map((item) => `
            <span class="cal-event is-${escapeHtml(item.type)}" data-event="${escapeHtml(item.id)}"
                  style="border-left-color:${escapeHtml(item.color)}"
                  title="${escapeHtml(item.title)}">
              ${escapeHtml(item.allDay ? '' : `${fmtTime(item.date)} `)}${escapeHtml(item.title)}
            </span>`).join('')}

          ${dayEvents.length > 3 ? `<span class="cal-more">+${dayEvents.length - 3} more</span>` : ''}

          <span class="cal-dots only-mobile">
            ${dayEvents.slice(0, 4).map((item) =>
              `<i class="mini-cal-dot" style="background:${escapeHtml(item.color)}"></i>`).join('')}
          </span>
        </div>`;
    }).join('')}`;

  icons(grid);
}

/* =============================================================================
   AGENDA + SIDE PANELS
   ========================================================================== */

function renderAgenda() {
  const host = $('#agendaList');
  if (!host) return;

  const title = $('#agendaTitle');
  const sub = $('#agendaSub');
  if (title) title.textContent = isToday(selected) ? 'Today' : fmtDate(selected, 'day');
  if (sub) sub.textContent = fmtDate(selected);

  const items = eventsOn(selected);

  if (!items.length) {
    render(host, emptyState({
      icon: 'calendar-x',
      title: 'Nothing scheduled',
      body: 'This day is clear.',
      action: { label: 'Add event', icon: 'plus', onClick: () => openEventForm(null, { date: selected }) },
    }));
    icons(host);
    return;
  }

  host.innerHTML = items.map((item) => `
    <button class="agenda-item full" type="button" data-event="${escapeHtml(item.id)}"
            style="text-align:left;background:none;border:0;padding-block:var(--sp-3)">
      <span class="agenda-time">${escapeHtml(item.allDay ? 'All day' : fmtTime(item.date))}</span>
      <span class="agenda-bar" style="background:${escapeHtml(item.color)}"></span>
      <span class="grow" style="min-width:0">
        <b class="truncate" style="display:block">${escapeHtml(item.title)}</b>
        <span class="truncate" style="display:block">
          ${escapeHtml(titleCase(item.type))}
          ${item.location ? ` · ${escapeHtml(item.location)}` : ''}
          ${item.source !== 'event' ? ' · from project' : ''}
        </span>
      </span>
      ${item.done ? '<i data-lucide="check" style="color:var(--success)"></i>' : ''}
    </button>`).join('');

  icons(host);
  animateItems($$('.agenda-item', host));
}

function renderUpcoming() {
  const host = $('#upcomingList');
  if (!host) return;

  const now = new Date();
  const until = addDays(now, 14);

  const items = allEvents()
    .filter((item) => item.date >= new Date(now.getTime() - 3600000) && item.date <= until)
    .slice(0, 8);

  if (!items.length) {
    render(host, emptyState({ icon: 'calendar-check', title: 'All clear', body: 'Nothing in the next two weeks.' }));
    icons(host);
    return;
  }

  host.innerHTML = items.map((item) => dueRow({
    date: item.date,
    title: item.title,
    meta: item.allDay ? titleCase(item.type) : `${fmtTime(item.date)} · ${titleCase(item.type)}`,
    kind: item.type,
    href: '#',
  })).join('');

  icons(host);
}

function renderMonthStats() {
  const host = $('#monthStats');
  if (!host) return;

  const from = startOfMonth(cursor);
  const to = endOfMonth(cursor);
  const inMonth = allEvents().filter((item) => item.date >= from && item.date <= to);

  const counts = TYPE_OPTIONS.map((option) => ({
    label: option.label,
    color: TYPE_COLOR[option.value],
    count: inMonth.filter((item) => item.type === option.value).length,
  }));

  host.innerHTML = `
    <div class="cli-row">
      <span>Total events</span>
      <b>${inMonth.length}</b>
    </div>
    ${counts.map((entry) => `
      <div class="cli-row">
        <span class="flex items-center gap-2">
          <i class="mini-cal-dot" style="background:${entry.color}"></i>${escapeHtml(entry.label)}
        </span>
        <b>${entry.count}</b>
      </div>`).join('')}`;
}

/* =============================================================================
   NAVIGATION
   ========================================================================== */

function goMonth(delta) {
  cursor = startOfMonth(addMonths(cursor, delta));
  repaint();
}

function selectDay(date) {
  selected = date;
  // Selecting a day outside the visible month follows it.
  if (date.getMonth() !== cursor.getMonth()) cursor = startOfMonth(date);
  repaint();
}

function initKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;

    const map = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    };

    if (event.target.closest('.cal-day') && map[event.key] != null) {
      event.preventDefault();
      selectDay(addDays(selected, map[event.key]));
      requestAnimationFrame(() => {
        $(`.cal-day[data-date="${isoDate(selected)}"]`)?.focus();
      });
      return;
    }

    if (event.key === 'PageUp') { event.preventDefault(); goMonth(-1); }
    if (event.key === 'PageDown') { event.preventDefault(); goMonth(1); }
  });
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderGrid();
  renderAgenda();
  renderUpcoming();
  renderMonthStats();
}, 140);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('calendar', { title: 'Calendar' });

  try {
    await store.load(
      'calendar_events', 'projects', 'clients', 'profiles', 'milestones', 'notifications',
    );
  } catch (err) {
    hideLoader();
    toast.error('Could not load the calendar', err.message);
    return;
  }

  renderGrid();
  renderAgenda();
  renderUpcoming();
  renderMonthStats();
  initKeyboard();

  /* ── Controls ──────────────────────────────────────────────────────── */
  $('#prevMonth')?.addEventListener('click', () => goMonth(-1));
  $('#nextMonth')?.addEventListener('click', () => goMonth(1));
  $('#todayBtn')?.addEventListener('click', () => {
    cursor = startOfMonth(new Date());
    selected = new Date();
    repaint();
  });

  $('#addEvent')?.addEventListener('click', () => openEventForm(null, { date: selected }));
  $('#addForDay')?.addEventListener('click', () => openEventForm(null, { date: selected }));

  $('#typeFilter')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (!button) return;
    $$('#typeFilter button').forEach((node) => node.classList.remove('is-active'));
    button.classList.add('is-active');
    typeFilter = button.dataset.type;
    repaint();
  });

  // Grid interactions: chip opens the event, cell selects the day.
  $('#calGrid')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-event]');
    if (chip) {
      event.stopPropagation();
      const item = allEvents().find((entry) => entry.id === chip.dataset.event);
      if (item) openEventDetail(item);
      return;
    }

    const cell = event.target.closest('.cal-day');
    if (cell) selectDay(toDate(cell.dataset.date));
  });

  $('#calGrid')?.addEventListener('dblclick', (event) => {
    const cell = event.target.closest('.cal-day');
    if (cell) openEventForm(null, { date: toDate(cell.dataset.date) });
  });

  $('#calGrid')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const cell = event.target.closest('.cal-day');
    if (cell) { event.preventDefault(); openEventForm(null, { date: toDate(cell.dataset.date) }); }
  });

  $('#agendaList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-event]');
    if (!button) return;
    const item = allEvents().find((entry) => entry.id === button.dataset.event);
    if (item) openEventDetail(item);
  });

  // Deep link: calendar.html?date=2026-08-14
  const dateParam = queryParam('date');
  if (dateParam) {
    selected = toDate(dateParam) || new Date();
    cursor = startOfMonth(selected);
    repaint();
  }

  /* ── Realtime ──────────────────────────────────────────────────────── */
  ['calendar_events', 'projects', 'milestones'].forEach((collection) => {
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
