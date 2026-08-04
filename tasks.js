/* =============================================================================
   SynthWorks — tasks.js
   The shared kanban board.

   Four columns, HTML5 drag-and-drop on the desktop and a keyboard/menu path
   everywhere else. Moving a card writes `status` + `position` straight to
   Postgres, which broadcasts to every other browser and re-runs the project
   progress trigger.
   ========================================================================== */

import { requireAuth, auth } from './auth.js';
import { store } from './store.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, animatePage,
  animateItems, stagger, confetti,
} from './animations.js';
import { statCard, avatar, priorityTag } from './ui.js';
import { formModal, openDrawer } from './modal.js';
import { toast, confirmDialog } from './notifications.js';
import {
  $, $$, el, render, icons, escapeHtml, fmtDate, timeAgo, dueLabel, isoDate,
  debounce, matches, titleCase, queryParam,
} from './utils.js';

/* Column definitions — order here is the order on screen. */
const COLUMNS = [
  { id: 'todo',   label: 'Todo',      color: '#64748B', icon: 'circle' },
  { id: 'doing',  label: 'In progress', color: '#38BDF8', icon: 'circle-dot' },
  { id: 'review', label: 'Review',    color: '#A855F7', icon: 'eye' },
  { id: 'done',   label: 'Completed', color: '#22C55E', icon: 'circle-check-big' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const filters = { query: '', project: 'all', assignee: 'all', priority: 'all' };

/** The card currently being dragged (module-level so both handlers see it). */
let dragging = null;

/* =============================================================================
   FILTERING
   ========================================================================== */

function visibleTasks() {
  return store.tasks.all.filter((task) => {
    if (filters.query && !matches(task, filters.query, [
      'title', 'description', (row) => (row.labels || []).join(' '),
      (row) => store.projects.get(row.project_id)?.name || '',
    ])) return false;

    if (filters.project !== 'all' && task.project_id !== filters.project) return false;

    if (filters.assignee === 'me' && task.assignee_id !== auth.userId) return false;
    if (filters.assignee === 'none' && task.assignee_id) return false;
    if (!['all', 'me', 'none'].includes(filters.assignee) && task.assignee_id !== filters.assignee) return false;

    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;

    return true;
  });
}

/* =============================================================================
   FORM
   ========================================================================== */

/**
 * Opens the task dialog.
 * @param {Object} [task]
 * @param {{status?: string, projectId?: string}} [defaults]
 */
export async function openTaskForm(task = null, defaults = {}) {
  if (!store.tasks.loaded) await store.load('tasks', 'projects', 'profiles');

  const isEdit = Boolean(task?.id);

  return formModal({
    title: isEdit ? 'Edit task' : 'New task',
    subtitle: isEdit ? task.title : 'Add work to the shared board.',
    icon: 'circle-check-big',
    submitLabel: isEdit ? 'Save changes' : 'Create task',

    fields: [
      { name: 'title', label: 'Task', required: true, span: 2, placeholder: 'Design the pricing page' },
      { name: 'description', label: 'Description', type: 'textarea', rows: 3, span: 2 },
      { name: 'project_id', label: 'Project', type: 'select', allowEmpty: true, emptyLabel: '— No project —',
        options: store.projects.all
          .filter((project) => project.status !== 'cancelled')
          .map((project) => ({ value: project.id, label: project.name })) },
      { name: 'assignee_id', label: 'Assignee', type: 'select', allowEmpty: true, emptyLabel: '— Unassigned —',
        options: store.profiles.all.map((person) => ({ value: person.id, label: person.full_name })) },
      { name: 'status', label: 'Column', type: 'select', required: true,
        options: COLUMNS.map((column) => ({ value: column.id, label: column.label })) },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITY_OPTIONS },
      { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'labels', label: 'Labels', type: 'tags', span: 2, placeholder: 'design, urgent, client-feedback…' },
    ],

    values: {
      status: defaults.status || 'todo',
      priority: 'medium',
      project_id: defaults.projectId || '',
      assignee_id: auth.userId || '',
      ...task,
      labels: task?.labels || [],
    },

    async onSubmit(values) {
      const payload = {
        title: values.title,
        description: values.description,
        project_id: values.project_id || null,
        assignee_id: values.assignee_id || null,
        status: values.status,
        priority: values.priority,
        due_date: values.due_date,
        labels: values.labels || [],
      };

      if (isEdit) {
        const wasDone = task.status === 'done';
        const updated = await store.tasks.update(task.id, payload);
        if (payload.status === 'done' && !wasDone) celebrateTask(updated);
        else toast.success('Task updated', updated.title);
        return updated;
      }

      // New cards go to the top of their column.
      payload.position = nextPosition(payload.status, 'top');
      const created = await store.tasks.create(payload);
      toast.success('Task created', created.title);
      return created;
    },
  });
}

function celebrateTask(task) {
  confetti({ count: 70, duration: 2200 });
  toast.success('Task complete', task.title);
}

/* =============================================================================
   POSITIONING
   Cards keep a numeric `position` inside their column. New cards get a slot
   above or below the current extremes; a drop recalculates the midpoint, so
   only the moved row is written.
   ========================================================================== */

function columnTasks(status) {
  return store.tasks.all
    .filter((task) => task.status === status)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function nextPosition(status, where = 'bottom') {
  const list = columnTasks(status);
  if (!list.length) return 1000;
  return where === 'top'
    ? (list[0].position ?? 0) - 100
    : (list.at(-1).position ?? 0) + 100;
}

/** Position value that lands a card between `before` and `after`. */
function positionBetween(before, after) {
  if (!before && !after) return 1000;
  if (!before) return (after.position ?? 0) - 100;
  if (!after) return (before.position ?? 0) + 100;
  return ((before.position ?? 0) + (after.position ?? 0)) / 2;
}

/* =============================================================================
   MOVING A CARD
   ========================================================================== */

async function moveTask(taskId, status, position) {
  const task = store.tasks.get(taskId);
  if (!task) return;
  if (task.status === status && task.position === position) return;

  const wasDone = task.status === 'done';

  // Optimistic: paint immediately, reconcile when the server answers.
  const previous = { status: task.status, position: task.position };
  task.status = status;
  task.position = position;
  renderBoard();

  try {
    await store.tasks.update(taskId, { status, position });
    if (status === 'done' && !wasDone) celebrateTask(task);
  } catch (err) {
    Object.assign(task, previous);
    renderBoard();
    toast.error('Could not move the task', err.message);
  }
}

/* =============================================================================
   DRAG AND DROP
   ========================================================================== */

function initDragAndDrop(board) {
  board.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.task-card');
    if (!card) return;

    dragging = card;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.dataset.id);
  });

  board.addEventListener('dragend', () => {
    dragging?.classList.remove('is-dragging');
    dragging = null;
    $$('.kanban-col').forEach((column) => column.classList.remove('is-over'));
    $$('.kanban-ghost').forEach((ghost) => ghost.remove());
  });

  board.addEventListener('dragover', (event) => {
    const list = event.target.closest('.kanban-list');
    if (!list || !dragging) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    list.closest('.kanban-col').classList.add('is-over');

    // Show a placeholder exactly where the card would land.
    const after = cardAfterPoint(list, event.clientY);
    let ghost = list.querySelector('.kanban-ghost');
    if (!ghost) {
      ghost = el('div', { class: 'kanban-ghost' });
    }
    if (after) list.insertBefore(ghost, after);
    else list.append(ghost);
  });

  board.addEventListener('dragleave', (event) => {
    const column = event.target.closest('.kanban-col');
    if (column && !column.contains(event.relatedTarget)) {
      column.classList.remove('is-over');
      column.querySelector('.kanban-ghost')?.remove();
    }
  });

  board.addEventListener('drop', async (event) => {
    const list = event.target.closest('.kanban-list');
    if (!list || !dragging) return;
    event.preventDefault();

    const status = list.dataset.status;
    const taskId = dragging.dataset.id;

    // Work out the neighbours around the drop point.
    const ghost = list.querySelector('.kanban-ghost');
    const siblings = [...list.querySelectorAll('.task-card')]
      .filter((card) => card !== dragging)
      .map((card) => store.tasks.get(card.dataset.id))
      .filter(Boolean);

    let index = siblings.length;
    if (ghost) {
      const nodes = [...list.children];
      index = nodes.indexOf(ghost);
      // Discount the dragged card if it was already above the ghost.
      const draggedIndex = nodes.indexOf(dragging);
      if (draggedIndex > -1 && draggedIndex < index) index -= 1;
    }

    ghost?.remove();
    list.closest('.kanban-col').classList.remove('is-over');

    const position = positionBetween(siblings[index - 1], siblings[index]);
    await moveTask(taskId, status, position);
  });
}

/** The first card whose midpoint is below `y` — i.e. the drop's next sibling. */
function cardAfterPoint(list, y) {
  const cards = [...list.querySelectorAll('.task-card:not(.is-dragging)')];
  return cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  }) || null;
}

/* =============================================================================
   CARD + BOARD RENDERING
   ========================================================================== */

function taskCard(task) {
  const project = store.projects.get(task.project_id);
  const assignee = store.profiles.get(task.assignee_id);
  const due = task.due_date ? dueLabel(task.due_date) : null;
  const comments = store.task_comments.all.filter((comment) => comment.task_id === task.id).length;

  return `
    <article class="task-card${task.status === 'done' ? ' is-done' : ''}"
             draggable="true" data-id="${escapeHtml(task.id)}"
             data-priority="${escapeHtml(task.priority)}"
             tabindex="0" role="button"
             aria-label="${escapeHtml(task.title)} — ${escapeHtml(titleCase(task.status))}">
      <div class="tc-top">
        <span class="tc-title grow">${escapeHtml(task.title)}</span>
        <button class="icon-btn" type="button" data-act="menu" data-id="${escapeHtml(task.id)}"
                style="width:26px;height:26px" aria-label="Task actions">
          <i data-lucide="ellipsis" style="width:14px;height:14px"></i>
        </button>
      </div>

      ${project ? `
        <div class="tc-project">
          <i style="background:${escapeHtml(project.color || 'var(--accent)')}"></i>
          ${escapeHtml(project.name)}
        </div>` : ''}

      ${task.labels?.length ? `
        <div class="tc-labels">
          ${task.labels.slice(0, 3).map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('')}
        </div>` : ''}

      <div class="tc-foot">
        <span class="flex items-center gap-2">
          ${assignee
            ? avatar(assignee, { size: 'xs' })
            : '<span class="avatar avatar--xs" style="background:var(--track);color:var(--text-faint)">?</span>'}
          ${comments ? `<span class="flex items-center gap-1"><i data-lucide="message-circle" style="width:12px;height:12px"></i>${comments}</span>` : ''}
        </span>
        <span class="flex items-center gap-2">
          ${priorityTag(task.priority)}
          ${due ? `<span class="tc-due ${due.tone}"><i data-lucide="clock" style="width:12px;height:12px"></i>${escapeHtml(due.text)}</span>` : ''}
        </span>
      </div>
    </article>`;
}

function renderBoard() {
  const board = $('#kanban');
  if (!board) return;

  const tasks = visibleTasks();
  const countNode = $('#taskCount');
  if (countNode) {
    countNode.textContent = tasks.length === store.tasks.count
      ? `${tasks.length} tasks`
      : `${tasks.length} of ${store.tasks.count}`;
  }

  board.innerHTML = COLUMNS.map((column) => {
    const columnRows = tasks
      .filter((task) => task.status === column.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    return `
      <section class="kanban-col" data-column="${column.id}" aria-labelledby="col-${column.id}">
        <header class="kanban-head">
          <span class="dot" style="background:${column.color}"></span>
          <h3 id="col-${column.id}">${escapeHtml(column.label)}</h3>
          <span class="count">${columnRows.length}</span>
          <button class="icon-btn" type="button" data-add="${column.id}"
                  aria-label="Add a task to ${escapeHtml(column.label)}">
            <i data-lucide="plus"></i>
          </button>
        </header>

        <div class="kanban-list" data-status="${column.id}" role="list">
          ${columnRows.length
            ? columnRows.map(taskCard).join('')
            : `<div class="empty" style="padding:var(--sp-6) var(--sp-3)">
                 <p class="fs-xs faint">Drop a card here</p>
               </div>`}
        </div>
      </section>`;
  }).join('');

  icons(board);
}

/* =============================================================================
   CARD MENU + DETAIL
   ========================================================================== */

/** Contextual action sheet for a card — reuses the drawer rather than a bespoke popover. */
function openTaskMenu(task) {
  const body = el('div', { class: 'col gap-1' });

  const moveButtons = COLUMNS
    .filter((column) => column.id !== task.status)
    .map((column) => `
      <button class="pop-item" type="button" data-move="${column.id}">
        <i data-lucide="${column.icon}"></i> Move to ${escapeHtml(column.label)}
      </button>`).join('');

  body.innerHTML = `
    ${moveButtons}
    <div class="pop-sep"></div>
    <button class="pop-item" type="button" data-menu="open"><i data-lucide="panel-right"></i> Open details</button>
    <button class="pop-item" type="button" data-menu="edit"><i data-lucide="pencil"></i> Edit task</button>
    <button class="pop-item" type="button" data-menu="duplicate"><i data-lucide="copy"></i> Duplicate</button>
    <div class="pop-sep"></div>
    <button class="pop-item is-danger" type="button" data-menu="delete"><i data-lucide="trash-2"></i> Delete task</button>`;

  const sheet = openDrawer({ title: task.title, subtitle: 'Task actions', body });

  body.addEventListener('click', async (event) => {
    const move = event.target.closest('[data-move]')?.dataset.move;
    const action = event.target.closest('[data-menu]')?.dataset.menu;
    if (!move && !action) return;
    sheet.close();

    if (move) { await moveTask(task.id, move, nextPosition(move, 'top')); return; }
    if (action === 'open') openTaskDetail(task);
    if (action === 'edit') openTaskForm(task);
    if (action === 'duplicate') duplicateTask(task);
    if (action === 'delete') deleteTask(task);
  });
}

async function duplicateTask(task) {
  try {
    const copy = await store.tasks.create({
      title: `${task.title} (copy)`,
      description: task.description,
      project_id: task.project_id,
      assignee_id: task.assignee_id,
      status: task.status,
      priority: task.priority,
      labels: task.labels,
      due_date: task.due_date,
      position: nextPosition(task.status, 'top'),
    });
    toast.success('Task duplicated', copy.title);
  } catch (err) {
    toast.error('Could not duplicate', err.message);
  }
}

async function deleteTask(task) {
  const ok = await confirmDialog({
    title: 'Delete this task?',
    message: `"${task.title}" will be removed from the board for everyone.`,
    confirmLabel: 'Delete task',
    danger: true,
  });
  if (!ok) return;

  try {
    await store.tasks.remove(task.id);
    toast.success('Task deleted', task.title);
  } catch (err) {
    toast.error('Could not delete', err.message);
  }
}

/* ── Detail drawer with comments ─────────────────────────────────────────── */

function openTaskDetail(task) {
  const body = el('div');

  const drawer = openDrawer({
    title: task.title,
    subtitle: store.projects.get(task.project_id)?.name || 'No project',
    body,
    footer: (() => {
      const foot = el('div', { class: 'flex gap-2' });
      foot.innerHTML = `
        <button class="btn btn--secondary" type="button" data-detail="edit"><i data-lucide="pencil"></i> Edit</button>
        <button class="btn btn--danger" type="button" data-detail="delete"><i data-lucide="trash-2"></i> Delete</button>`;
      foot.addEventListener('click', (event) => {
        const action = event.target.closest('[data-detail]')?.dataset.detail;
        if (!action) return;
        drawer.close();
        if (action === 'edit') openTaskForm(task);
        if (action === 'delete') deleteTask(task);
      });
      return foot;
    })(),
  });

  function paint() {
    const fresh = store.tasks.get(task.id) || task;
    const assignee = store.profiles.get(fresh.assignee_id);
    const comments = store.task_comments.all
      .filter((comment) => comment.task_id === fresh.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const due = fresh.due_date ? dueLabel(fresh.due_date) : null;

    body.innerHTML = `
      <div class="flex wrap gap-2 mb-4">
        <span class="badge is-brand">${escapeHtml(titleCase(fresh.status))}</span>
        ${priorityTag(fresh.priority)}
        ${due ? `<span class="badge ${due.tone === 'is-overdue' ? 'is-danger' : due.tone === 'is-soon' ? 'is-warning' : 'is-muted'}">${escapeHtml(due.text)}</span>` : ''}
      </div>

      ${fresh.description ? `
        <div class="card card-pad mb-6">
          <p class="fs-sm" style="white-space:pre-wrap">${escapeHtml(fresh.description)}</p>
        </div>` : '<p class="fs-sm muted mb-6">No description.</p>'}

      <div class="card card-pad mb-6">
        <div class="cli-row" style="padding:6px 0">
          <span>Assignee</span>
          <span class="flex items-center gap-2">
            ${assignee ? `${avatar(assignee, { size: 'xs' })} ${escapeHtml(assignee.full_name)}` : 'Unassigned'}
          </span>
        </div>
        <div class="cli-row" style="padding:6px 0">
          <span>Due date</span>
          <span>${fresh.due_date ? escapeHtml(fmtDate(fresh.due_date)) : '—'}</span>
        </div>
        <div class="cli-row" style="padding:6px 0">
          <span>Created</span>
          <span>${escapeHtml(timeAgo(fresh.created_at))}</span>
        </div>
        ${fresh.completed_at ? `
          <div class="cli-row" style="padding:6px 0">
            <span>Completed</span><span class="c-success">${escapeHtml(timeAgo(fresh.completed_at))}</span>
          </div>` : ''}
      </div>

      ${fresh.labels?.length ? `
        <h3 class="fs-sm mb-3">Labels</h3>
        <div class="flex wrap gap-2 mb-6">
          ${fresh.labels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('')}
        </div>` : ''}

      <h3 class="fs-sm mb-3">Comments (${comments.length})</h3>
      <div class="col gap-3 mb-4" data-role="comments">
        ${comments.length ? comments.map((comment) => {
          const author = store.profiles.get(comment.author_id);
          return `
            <div class="flex gap-3">
              ${avatar(author || { full_name: 'Someone' }, { size: 'sm' })}
              <div class="grow" style="min-width:0">
                <div class="flex items-center gap-2">
                  <b class="fs-sm">${escapeHtml(author?.full_name || 'Someone')}</b>
                  <span class="fs-xs faint">${escapeHtml(timeAgo(comment.created_at))}</span>
                  ${comment.author_id === auth.userId
                    ? `<button class="icon-btn is-danger" type="button" data-del-comment="${escapeHtml(comment.id)}"
                               style="width:24px;height:24px;margin-left:auto" aria-label="Delete comment">
                         <i data-lucide="x" style="width:12px;height:12px"></i></button>` : ''}
                </div>
                <p class="fs-sm" style="white-space:pre-wrap">${escapeHtml(comment.body)}</p>
              </div>
            </div>`;
        }).join('') : '<p class="fs-sm muted">No comments yet.</p>'}
      </div>

      <form class="flex gap-2" data-role="comment-form">
        <input class="input" name="body" placeholder="Write a comment…" aria-label="Write a comment" required>
        <button class="btn btn--primary btn--icon" type="submit" aria-label="Post comment">
          <i data-lucide="send"></i>
        </button>
      </form>`;

    icons(body);
  }

  body.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-role="comment-form"]');
    if (!form) return;
    event.preventDefault();

    const input = form.querySelector('[name="body"]');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    try {
      await store.task_comments.create({ task_id: task.id, author_id: auth.userId, body: text });
      paint();
    } catch (err) {
      toast.error('Could not post comment', err.message);
    }
  });

  body.addEventListener('click', async (event) => {
    const id = event.target.closest('[data-del-comment]')?.dataset.delComment;
    if (!id) return;
    await store.task_comments.remove(id);
    paint();
  });

  // Live comment updates while the drawer is open.
  const off = store.on('task_comments:change', paint);
  drawer.root.addEventListener('transitionend', () => {
    if (!drawer.root.classList.contains('is-open')) off();
  });

  paint();
}

/* =============================================================================
   SUMMARY TILES
   ========================================================================== */

function renderStats() {
  const host = $('#taskStats');
  if (!host) return;

  const stats = store.taskStats();
  const mine = store.tasks.all.filter((task) => task.assignee_id === auth.userId && task.status !== 'done').length;
  const dueToday = store.tasks.all.filter((task) =>
    task.status !== 'done' && task.due_date && isoDate(task.due_date) === isoDate()).length;

  render(host, [
    statCard({ label: 'Open tasks', value: stats.pending, icon: 'list-todo', tone: 'brand',
               hint: `${stats.total} total` }),
    statCard({ label: 'Assigned to me', value: mine, icon: 'user-check', tone: 'info',
               hint: 'still open' }),
    statCard({ label: 'Due today', value: dueToday, icon: 'calendar-clock',
               tone: dueToday ? 'warning' : 'success', hint: dueToday ? 'finish these' : 'nothing due' }),
    statCard({ label: 'Overdue', value: stats.overdue, icon: 'alarm-clock',
               tone: stats.overdue ? 'danger' : 'success',
               hint: stats.overdue ? 'past their date' : 'all on time' }),
    statCard({ label: 'Completed', value: stats.done, icon: 'circle-check-big', tone: 'success',
               hint: `${stats.completionRate}% completion` }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   FILTER CONTROLS
   ========================================================================== */

function populateFilters() {
  const projectSelect = $('#filterProject');
  if (projectSelect) {
    const current = projectSelect.value;
    projectSelect.innerHTML = `<option value="all">All projects</option>${
      store.projects.all
        .filter((project) => project.status !== 'cancelled')
        .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`)
        .join('')}`;
    projectSelect.value = current || 'all';
  }

  const assigneeSelect = $('#filterAssignee');
  if (assigneeSelect) {
    const current = assigneeSelect.value;
    assigneeSelect.innerHTML = `
      <option value="all">Everyone</option>
      <option value="me">Assigned to me</option>
      <option value="none">Unassigned</option>
      ${store.profiles.all
        .filter((person) => person.id !== auth.userId)
        .map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.full_name)}</option>`)
        .join('')}`;
    assigneeSelect.value = current || 'all';
  }
}

function wireFilters() {
  $('#taskSearch')?.addEventListener('input', debounce((event) => {
    filters.query = event.target.value;
    renderBoard();
  }, 200));

  $('#filterProject')?.addEventListener('change', (event) => {
    filters.project = event.target.value; renderBoard();
  });
  $('#filterAssignee')?.addEventListener('change', (event) => {
    filters.assignee = event.target.value; renderBoard();
  });
  $('#filterPriority')?.addEventListener('change', (event) => {
    filters.priority = event.target.value; renderBoard();
  });

  $('#clearFilters')?.addEventListener('click', () => {
    Object.assign(filters, { query: '', project: 'all', assignee: 'all', priority: 'all' });
    $('#taskSearch').value = '';
    $('#filterProject').value = 'all';
    $('#filterAssignee').value = 'all';
    $('#filterPriority').value = 'all';
    renderBoard();
    toast.info('Filters cleared');
  });
}

/* =============================================================================
   KEYBOARD SUPPORT
   Arrow keys move a focused card between columns — the accessible equivalent
   of dragging, and the only way to reorder on a device without a mouse.
   ========================================================================== */

function initKeyboard(board) {
  board.addEventListener('keydown', async (event) => {
    const card = event.target.closest('.task-card');
    if (!card) return;

    const task = store.tasks.get(card.dataset.id);
    if (!task) return;

    const index = COLUMNS.findIndex((column) => column.id === task.status);

    if (event.key === 'Enter') { event.preventDefault(); openTaskDetail(task); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteTask(task); }

    if (event.key === 'ArrowRight' && index < COLUMNS.length - 1) {
      event.preventDefault();
      const next = COLUMNS[index + 1].id;
      await moveTask(task.id, next, nextPosition(next, 'top'));
      focusCard(task.id);
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      const next = COLUMNS[index - 1].id;
      await moveTask(task.id, next, nextPosition(next, 'top'));
      focusCard(task.id);
    }
  });
}

function focusCard(taskId) {
  requestAnimationFrame(() => {
    $(`.task-card[data-id="${CSS.escape(taskId)}"]`)?.focus();
  });
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderStats();
  populateFilters();
  renderBoard();
}, 180);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('tasks', { title: 'Tasks' });

  try {
    await store.load('tasks', 'projects', 'profiles', 'task_comments', 'notifications');
  } catch (err) {
    hideLoader();
    toast.error('Could not load the board', err.message);
    return;
  }

  populateFilters();
  renderStats();
  renderBoard();
  wireFilters();

  const board = $('#kanban');
  initDragAndDrop(board);
  initKeyboard(board);

  // Card clicks: menu button, or open the detail drawer.
  board.addEventListener('click', (event) => {
    const addBtn = event.target.closest('[data-add]');
    if (addBtn) { openTaskForm(null, { status: addBtn.dataset.add }); return; }

    const menuBtn = event.target.closest('[data-act="menu"]');
    if (menuBtn) {
      event.stopPropagation();
      openTaskMenu(store.tasks.get(menuBtn.dataset.id), menuBtn);
      return;
    }

    const card = event.target.closest('.task-card');
    if (card) openTaskDetail(store.tasks.get(card.dataset.id));
  });

  $('#addTask')?.addEventListener('click', () => openTaskForm());

  // Deep link: tasks.html?id=…
  const deepLink = queryParam('id');
  if (deepLink) {
    const task = store.tasks.get(deepLink);
    if (task) setTimeout(() => openTaskDetail(task), 420);
  }

  store.on('tasks:change', repaint);
  store.on('projects:change', repaint);
  store.on('profiles:change', repaint);

  animatePage('.page > *');
  animateItems($$('.kanban-col'));
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
