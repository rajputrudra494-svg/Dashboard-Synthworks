/* =============================================================================
   SynthWorks — projects.js
   Project management: card board, table and timeline views, full CRUD, member
   assignment, milestones, file attachments and a detail drawer.

   Progress is recalculated server-side from the task board (see the
   recalc_project_progress trigger in setup.sql), so the percentage
   shown here is always the truth rather than a manually maintained number.
   ========================================================================== */

import { requireAuth, auth } from './auth.js';
import { store } from './store.js';
import { sb, friendlyError, signedUrl } from './supabase.js';
import { initShell } from './shell.js';
import {
  initAnimations, mountLoader, hideLoader, initCounters, initReveal,
  animatePage, animateItems, stagger, confetti,
} from './animations.js';
import { createTable, flashRow } from './table.js';
import {
  statCard, emptyState, statusBadge, priorityTag, avatar, avatarStack,
  rowActions, progressBar, progressRing,
} from './ui.js';
import { formModal, openDrawer } from './modal.js';
import { toast, confirmDialog, celebrate } from './notifications.js';
import {
  $, $$, el, render, icons, escapeHtml, money, fmtDate, timeAgo, exportCSV,
  titleCase, debounce, daysBetween, toDate, isoDate, fileSize, queryParam,
} from './utils.js';

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'review', label: 'In review' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

let table = null;
let view = 'board';
let statusFilter = 'all';

/* =============================================================================
   FORM
   ========================================================================== */

/**
 * Opens the project dialog.
 * @param {Object} [project]
 * @param {{clientId?: string}} [defaults]
 */
export async function openProjectForm(project = null, defaults = {}) {
  if (!store.projects.loaded) await store.load('projects', 'clients', 'profiles', 'project_members');

  const isEdit = Boolean(project?.id);
  const currentMembers = isEdit
    ? store.project_members.all.filter((m) => m.project_id === project.id).map((m) => m.profile_id)
    : [auth.userId].filter(Boolean);

  const fields = [
    { name: 'name', label: 'Project name', required: true, span: 2, placeholder: 'Brand refresh 2026' },
    { name: 'description', label: 'Description', type: 'textarea', rows: 3, span: 2,
      placeholder: 'What are we delivering, and for whom?' },
    { name: 'client_id', label: 'Client', type: 'select', allowEmpty: true, emptyLabel: '— Internal —',
      options: store.clients.all.map((client) => ({ value: client.id, label: client.name })) },
    { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS, required: true },
    { name: 'budget', label: 'Budget', type: 'money', min: 0, placeholder: '0.00' },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'deadline', label: 'Deadline', type: 'date' },
    { name: 'progress', label: 'Progress', type: 'range', min: 0, max: 100, step: 5, span: 2,
      hint: 'Set manually now — once the project has tasks, the board keeps this in sync automatically.' },
    { name: 'members', label: 'Team', type: 'members', span: 2,
      options: store.profiles.all },
    { name: 'color', label: 'Colour', type: 'color', span: 2 },
    { name: 'tags', label: 'Tags', type: 'tags', span: 2, placeholder: 'design, web, retainer…' },
    { name: 'notes', label: 'Internal notes', type: 'textarea', rows: 3, span: 2 },
  ];

  return formModal({
    title: isEdit ? 'Edit project' : 'New project',
    subtitle: isEdit ? project.name : 'Everyone on the team will see this immediately.',
    icon: 'folder-kanban',
    size: 'wide',
    submitLabel: isEdit ? 'Save changes' : 'Create project',
    fields,
    values: {
      status: 'planning',
      priority: 'medium',
      progress: 0,
      color: '#7C3AED',
      client_id: defaults.clientId || '',
      ...project,
      tags: project?.tags || [],
      members: currentMembers,
      start_date: project?.start_date || isoDate(),
    },

    async onSubmit(values) {
      const payload = {
        name: values.name,
        description: values.description,
        client_id: values.client_id || null,
        status: values.status,
        priority: values.priority,
        budget: values.budget ?? 0,
        progress: Math.max(0, Math.min(100, values.progress ?? 0)),
        start_date: values.start_date,
        deadline: values.deadline,
        color: values.color,
        tags: values.tags || [],
        notes: values.notes,
      };

      // Completing a project stamps the timestamp the reports rely on.
      if (payload.status === 'completed') payload.completed_at = new Date().toISOString();

      const wasCompleted = project?.status === 'completed';
      const saved = isEdit
        ? await store.projects.update(project.id, payload)
        : await store.projects.create(payload);

      await syncMembers(saved.id, values.members || []);

      if (payload.status === 'completed' && !wasCompleted) {
        confetti({ count: 140 });
        await celebrate('Project complete!', `${saved.name} is done. Nice work.`);
        store.pushNotification({
          title: 'Project completed',
          body: `${saved.name} was marked complete.`,
          type: 'success',
          link: 'projects.html',
        });
      } else {
        toast.success(isEdit ? 'Project updated' : 'Project created', saved.name);
      }

      return saved;
    },
  });
}

/** Reconciles project_members with the picker's selection. */
async function syncMembers(projectId, memberIds) {
  const existing = store.project_members.all.filter((m) => m.project_id === projectId);
  const existingIds = existing.map((m) => m.profile_id);

  const toAdd = memberIds.filter((id) => !existingIds.includes(id));
  const toRemove = existing.filter((m) => !memberIds.includes(m.profile_id));

  if (toAdd.length) {
    await store.project_members.insertMany(
      toAdd.map((profileId) => ({ project_id: projectId, profile_id: profileId })),
    );
  }
  await Promise.all(toRemove.map((m) => store.project_members.remove(m.id)));
}

/* =============================================================================
   DELETE
   ========================================================================== */

async function deleteProject(project) {
  const tasks = store.tasks.all.filter((task) => task.project_id === project.id);

  const ok = await confirmDialog({
    title: `Delete ${project.name}?`,
    message: tasks.length
      ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} and every milestone on this project will be deleted too. This cannot be undone.`
      : 'This removes the project for everyone on the team. This cannot be undone.',
    confirmLabel: 'Delete project',
    danger: true,
  });
  if (!ok) return;

  try {
    await store.projects.remove(project.id);
    toast.success('Project deleted', project.name);
  } catch (err) {
    toast.error('Could not delete', err.message);
  }
}

/* =============================================================================
   MILESTONES
   ========================================================================== */

async function addMilestone(projectId, refresh) {
  await formModal({
    title: 'New milestone',
    icon: 'flag-triangle-right',
    size: 'slim',
    submitLabel: 'Add milestone',
    fields: [
      { name: 'title', label: 'Milestone', required: true, placeholder: 'Design sign-off' },
      { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'description', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    values: { due_date: isoDate() },
    async onSubmit(values) {
      const position = store.milestones.all.filter((m) => m.project_id === projectId).length;
      await store.milestones.create({ ...values, project_id: projectId, position });
      toast.success('Milestone added', values.title);
      refresh?.();
    },
  });
}

async function toggleMilestone(milestone, refresh) {
  try {
    await store.milestones.update(milestone.id, { is_complete: !milestone.is_complete });
    if (!milestone.is_complete) confetti({ count: 40, duration: 1800 });
    refresh?.();
  } catch (err) {
    toast.error('Could not update milestone', err.message);
  }
}

/* =============================================================================
   FILE ATTACHMENTS  (private `project-files` bucket)
   ========================================================================== */

async function uploadProjectFile(projectId, file, onDone) {
  if (file.size > 25 * 1024 * 1024) {
    toast.error('File too large', 'Project files must be 25 MB or smaller.');
    return;
  }

  const path = `${projectId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
  const progress = toast.info('Uploading…', file.name, { duration: 0 });

  try {
    const { error } = await sb.storage.from('project-files').upload(path, file, { upsert: false });
    if (error) throw new Error(friendlyError(error));

    await store.attachments.create({
      bucket: 'project-files',
      path,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      entity_type: 'project',
      entity_id: projectId,
      uploaded_by: auth.userId,
    });

    progress.dismiss();
    toast.success('File uploaded', file.name);
    onDone?.();
  } catch (err) {
    progress.dismiss();
    toast.error('Upload failed', err.message);
  }
}

async function downloadAttachment(attachment) {
  const url = await signedUrl(attachment.bucket, attachment.path, 120);
  if (!url) { toast.error('Could not open file', 'The link could not be generated.'); return; }
  window.open(url, '_blank', 'noopener');
}

async function deleteAttachment(attachment, refresh) {
  const ok = await confirmDialog({
    title: `Delete ${attachment.file_name}?`,
    message: 'The file will be removed from storage for everyone.',
    confirmLabel: 'Delete file',
    danger: true,
  });
  if (!ok) return;

  try {
    await store.attachments.remove(attachment.id);
    toast.success('File deleted', attachment.file_name);
    refresh?.();
  } catch (err) {
    toast.error('Could not delete file', err.message);
  }
}

/* =============================================================================
   DETAIL DRAWER
   ========================================================================== */

function openProjectDetail(project) {
  if (!project) return;

  const body = el('div');
  const drawer = openDrawer({
    title: project.name,
    subtitle: store.clients.get(project.client_id)?.name || 'Internal project',
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
        if (action === 'edit') openProjectForm(project);
        if (action === 'delete') deleteProject(project);
      });
      return foot;
    })(),
  });

  function paint() {
    const fresh = store.projects.get(project.id) || project;
    const members = store.projectMembers(fresh.id);
    const tasks = store.tasks.all.filter((task) => task.project_id === fresh.id);
    const milestones = store.milestones.all
      .filter((m) => m.project_id === fresh.id)
      .sort((a, b) => a.position - b.position);
    const files = store.attachments.all
      .filter((file) => file.entity_type === 'project' && file.entity_id === fresh.id);
    const spend = store.finance_transactions.all
      .filter((txn) => txn.project_id === fresh.id && txn.type === 'expense')
      .reduce((total, txn) => total + Number(txn.amount || 0), 0);

    const days = fresh.deadline ? daysBetween(fresh.deadline) : null;

    body.innerHTML = `
      <div class="flex items-center gap-4 mb-6">
        ${progressRing(fresh.progress, 84)}
        <div class="grow" style="min-width:0">
          <div class="flex wrap gap-2 mb-2">
            ${statusBadge(fresh.status)}
            ${priorityTag(fresh.priority)}
          </div>
          <p class="fs-sm muted">${escapeHtml(fresh.description || 'No description yet.')}</p>
        </div>
      </div>

      <div class="stat-grid mb-6" style="gap:var(--sp-2)">
        <div class="card card-pad">
          <span class="stat-label">Budget</span>
          <div class="stat-value" style="font-size:var(--fs-md)">${escapeHtml(money(fresh.budget, { compact: true }))}</div>
        </div>
        <div class="card card-pad">
          <span class="stat-label">Spent</span>
          <div class="stat-value ${spend > fresh.budget && fresh.budget > 0 ? 'c-danger' : ''}" style="font-size:var(--fs-md)">
            ${escapeHtml(money(spend, { compact: true }))}
          </div>
        </div>
        <div class="card card-pad">
          <span class="stat-label">Deadline</span>
          <div class="stat-value ${days != null && days < 0 ? 'c-danger' : ''}" style="font-size:var(--fs-md)">
            ${fresh.deadline ? escapeHtml(fmtDate(fresh.deadline, 'short')) : '—'}
          </div>
          ${days != null ? `<span class="fs-xs muted">${days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}</span>` : ''}
        </div>
      </div>

      <h3 class="fs-sm mb-3">Team</h3>
      <div class="flex wrap gap-2 mb-6">
        ${members.length
          ? members.map((member) => `
              <span class="member-opt is-on">
                ${avatar(member, { size: 'xs' })} ${escapeHtml(member.full_name)}
              </span>`).join('')
          : '<span class="fs-sm muted">Nobody assigned yet.</span>'}
      </div>

      <div class="between mb-3">
        <h3 class="fs-sm">Milestones (${milestones.filter((m) => m.is_complete).length}/${milestones.length})</h3>
        <button class="btn btn--sm btn--ghost" type="button" data-act="add-milestone">
          <i data-lucide="plus"></i> Add
        </button>
      </div>
      <div class="card mb-6">
        ${milestones.length ? milestones.map((milestone) => `
          <div class="list-row">
            <label class="check">
              <input type="checkbox" data-milestone="${escapeHtml(milestone.id)}" ${milestone.is_complete ? 'checked' : ''}>
              <span class="box"><svg viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="currentColor"/></svg></span>
            </label>
            <span class="grow" style="min-width:0">
              <b class="fs-sm ${milestone.is_complete ? 'muted' : ''}"
                 style="display:block;${milestone.is_complete ? 'text-decoration:line-through' : ''}">
                ${escapeHtml(milestone.title)}
              </b>
              ${milestone.due_date ? `<span class="fs-xs muted">${escapeHtml(fmtDate(milestone.due_date, 'short'))}</span>` : ''}
            </span>
            <button class="icon-btn is-danger" type="button" data-act="del-milestone"
                    data-id="${escapeHtml(milestone.id)}" aria-label="Delete milestone">
              <i data-lucide="x"></i>
            </button>
          </div>`).join('')
          : '<div class="card-pad fs-sm muted">No milestones yet.</div>'}
      </div>

      <h3 class="fs-sm mb-3">Tasks (${tasks.filter((t) => t.status === 'done').length}/${tasks.length})</h3>
      <div class="card mb-6">
        ${tasks.length ? tasks.slice(0, 8).map((task) => `
          <a class="list-row" href="tasks.html?id=${escapeHtml(task.id)}">
            <span class="prio prio--${escapeHtml(task.priority)}"><i></i></span>
            <span class="grow truncate fs-sm">${escapeHtml(task.title)}</span>
            ${statusBadge(task.status)}
          </a>`).join('')
          : '<div class="card-pad fs-sm muted">No tasks on this project yet.</div>'}
      </div>

      <div class="between mb-3">
        <h3 class="fs-sm">Files (${files.length})</h3>
      </div>
      <label class="dropzone mb-3">
        <input type="file" data-role="file-input" aria-label="Upload a project file">
        <i data-lucide="upload-cloud"></i>
        <b>Drop a file or click to upload</b>
        <span>Up to 25 MB · stored privately</span>
      </label>
      <div class="col gap-2 mb-6">
        ${files.map((file) => `
          <div class="file-row">
            <span class="file-ico"><i data-lucide="file"></i></span>
            <span class="grow" style="min-width:0">
              <b class="truncate" style="display:block">${escapeHtml(file.file_name)}</b>
              <span>${escapeHtml(fileSize(file.size_bytes))} · ${escapeHtml(timeAgo(file.created_at))}</span>
            </span>
            <button class="icon-btn" type="button" data-act="dl-file" data-id="${escapeHtml(file.id)}"
                    aria-label="Download ${escapeHtml(file.file_name)}"><i data-lucide="download"></i></button>
            <button class="icon-btn is-danger" type="button" data-act="del-file" data-id="${escapeHtml(file.id)}"
                    aria-label="Delete ${escapeHtml(file.file_name)}"><i data-lucide="trash-2"></i></button>
          </div>`).join('')}
      </div>

      ${fresh.notes ? `
        <h3 class="fs-sm mb-3">Notes</h3>
        <div class="card card-pad">
          <p class="fs-sm" style="white-space:pre-wrap">${escapeHtml(fresh.notes)}</p>
        </div>` : ''}`;

    icons(body);
  }

  // One delegated handler for every control inside the drawer.
  body.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-act]')?.dataset.act;
    const id = event.target.closest('[data-act]')?.dataset.id;

    if (action === 'add-milestone') addMilestone(project.id, paint);
    if (action === 'del-milestone') {
      await store.milestones.remove(id);
      paint();
    }
    if (action === 'dl-file') downloadAttachment(store.attachments.get(id));
    if (action === 'del-file') deleteAttachment(store.attachments.get(id), paint);
  });

  body.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-milestone]');
    if (checkbox) {
      toggleMilestone(store.milestones.get(checkbox.dataset.milestone), paint);
      return;
    }

    const fileInput = event.target.closest('[data-role="file-input"]');
    if (fileInput?.files?.[0]) {
      uploadProjectFile(project.id, fileInput.files[0], paint);
      fileInput.value = '';
    }
  });

  paint();
}

/* =============================================================================
   SUMMARY TILES
   ========================================================================== */

function renderStats() {
  const host = $('#projectStats');
  if (!host) return;

  const stats = store.projectStats();
  const spent = store.projects.all.reduce((total, p) => total + Number(p.spent || 0), 0);

  render(host, [
    statCard({ label: 'Total projects', value: stats.total, icon: 'folder-kanban', tone: 'brand',
               hint: `${stats.planning} in planning` }),
    statCard({ label: 'Running', value: stats.active, icon: 'play', tone: 'info',
               hint: `${stats.avgProgress}% avg progress` }),
    statCard({ label: 'Completed', value: stats.completed, icon: 'check-check', tone: 'success',
               hint: stats.total ? `${Math.round((stats.completed / stats.total) * 100)}% of all work` : '' }),
    statCard({ label: 'Overdue', value: stats.overdue, icon: 'alarm-clock',
               tone: stats.overdue ? 'danger' : 'success',
               hint: stats.overdue ? 'need attention' : 'all on schedule' }),
    statCard({ label: 'Committed budget', value: stats.budget, icon: 'wallet', tone: 'brand',
               format: 'money', hint: `${money(spent, { compact: true })} spent` }),
  ]);

  stagger(host);
  icons(host);
  initCounters(host);
}

/* =============================================================================
   BOARD VIEW
   ========================================================================== */

function filteredProjects() {
  const rows = store.projects.all;
  return statusFilter === 'all' ? rows : rows.filter((project) => project.status === statusFilter);
}

function renderBoard() {
  const host = $('#projectBoard');
  if (!host) return;

  const projects = filteredProjects();

  if (!projects.length) {
    render(host, emptyState({
      icon: 'folder-plus',
      title: statusFilter === 'all' ? 'No projects yet' : `No ${statusFilter} projects`,
      body: statusFilter === 'all'
        ? 'Create the first project and the whole studio sees it appear live.'
        : 'Try a different status filter.',
      action: statusFilter === 'all'
        ? { label: 'New project', icon: 'plus', onClick: () => openProjectForm() }
        : { label: 'Show all', icon: 'list', onClick: () => setStatus('all') },
    }));
    icons(host);
    return;
  }

  host.innerHTML = projects.map((project) => {
    const client = store.clients.get(project.client_id);
    const members = store.projectMembers(project.id);
    const tasks = store.tasks.all.filter((task) => task.project_id === project.id);
    const done = tasks.filter((task) => task.status === 'done').length;
    const days = project.deadline ? daysBetween(project.deadline) : null;

    const deadlineTone = days == null ? 'muted'
      : days < 0 ? 'c-danger'
      : days <= 7 ? 'c-warning' : 'muted';

    return `
      <article class="card card--hover card-pad" data-id="${escapeHtml(project.id)}"
               tabindex="0" role="button" aria-label="${escapeHtml(project.name)}">
        <div class="flex items-start gap-3 mb-4">
          <span class="stat-icon" style="background:${escapeHtml(project.color)}22;color:${escapeHtml(project.color)}">
            <i data-lucide="folder-kanban"></i>
          </span>
          <div class="grow" style="min-width:0">
            <b class="truncate" style="display:block">${escapeHtml(project.name)}</b>
            <span class="fs-xs muted truncate" style="display:block">${escapeHtml(client?.name || 'Internal')}</span>
          </div>
          ${statusBadge(project.status)}
        </div>

        <p class="fs-xs muted clamp-2 mb-4" style="min-height:2.6em">
          ${escapeHtml(project.description || 'No description.')}
        </p>

        <div class="mb-4">
          <div class="between fs-xs muted mb-2">
            <span>Progress</span>
            <b class="tabular">${project.progress}%</b>
          </div>
          <span class="progress ${project.progress >= 100 ? 'is-success' : ''}">
            <i style="width:${project.progress}%"></i>
          </span>
        </div>

        <div class="cli-rows mb-4">
          <div class="cli-row">
            <span>Budget</span>
            <b>${escapeHtml(money(project.budget, { compact: true }))}</b>
          </div>
          <div class="cli-row">
            <span>Tasks</span>
            <b>${done}/${tasks.length}</b>
          </div>
          <div class="cli-row">
            <span>Deadline</span>
            <b class="${deadlineTone}">
              ${project.deadline ? escapeHtml(fmtDate(project.deadline, 'short')) : '—'}
              ${days != null && days < 0 ? ' (late)' : ''}
            </b>
          </div>
        </div>

        <div class="between" style="padding-top:var(--sp-3);border-top:1px solid var(--border)">
          ${avatarStack(members, 3)}
          <div class="flex items-center gap-2">
            ${priorityTag(project.priority)}
            ${rowActions(project.id)}
          </div>
        </div>
      </article>`;
  }).join('');

  icons(host);
  animateItems($$('.card', host).slice(0, 12));
}

/* =============================================================================
   TIMELINE VIEW
   ========================================================================== */

function renderTimeline() {
  const host = $('#projectTimeline');
  if (!host) return;

  const projects = filteredProjects()
    .filter((project) => project.deadline)
    .sort((a, b) => toDate(a.deadline) - toDate(b.deadline));

  if (!projects.length) {
    render(host, emptyState({
      icon: 'gantt-chart',
      title: 'Nothing to plot',
      body: 'Projects need a deadline before they can appear on the timeline.',
    }));
    icons(host);
    return;
  }

  // Fit the whole set into the horizontal axis.
  const dates = projects.flatMap((project) => [
    toDate(project.start_date || project.created_at), toDate(project.deadline),
  ]).filter(Boolean);

  const min = new Date(Math.min(...dates, Date.now()));
  const max = new Date(Math.max(...dates, Date.now()));
  const span = Math.max(1, (max - min) / 86400000);

  const pos = (date) => ((toDate(date) - min) / 86400000 / span) * 100;

  host.innerHTML = `
    <div class="between mb-4">
      <div>
        <h3>Timeline</h3>
        <p class="fs-xs muted">${escapeHtml(fmtDate(min, 'short'))} → ${escapeHtml(fmtDate(max, 'short'))}</p>
      </div>
      <span class="fs-xs muted">${projects.length} scheduled</span>
    </div>

    <div class="gantt">
      ${projects.map((project) => {
        const left = pos(project.start_date || project.created_at);
        const right = pos(project.deadline);
        const width = Math.max(right - left, 3);
        const late = daysBetween(project.deadline) < 0 && project.status !== 'completed';
        const state = project.status === 'completed' ? 'is-done' : late ? 'is-late' : '';
        const client = store.clients.get(project.client_id);

        return `
          <div class="gantt-row" data-id="${escapeHtml(project.id)}">
            <div class="gantt-label">
              <b>${escapeHtml(project.name)}</b>
              <span>${escapeHtml(client?.name || 'Internal')}</span>
            </div>
            <div class="gantt-track">
              <div class="gantt-today" style="left:${pos(new Date())}%"></div>
              <div class="gantt-bar ${state}" data-pct="${project.progress}%"
                   style="left:${left}%;width:${width}%;${state ? '' : `background:${escapeHtml(project.color)}`}"
                   title="${escapeHtml(project.name)} · ${escapeHtml(fmtDate(project.deadline))}"></div>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  icons(host);
}

/* =============================================================================
   TABLE VIEW
   ========================================================================== */

function buildTable() {
  table = createTable({
    mount: '#projectTable',
    id: 'projects',
    rows: filteredProjects,
    searchFields: ['name', 'description', (row) => store.clients.get(row.client_id)?.name || ''],
    searchPlaceholder: 'Search projects…',
    sort: { key: 'deadline', dir: 'asc' },
    perPage: 12,

    filters: [
      { key: 'priority', label: 'Priority', options: PRIORITY_OPTIONS },
      {
        key: 'client_id',
        label: 'Client',
        options: store.clients.all.map((client) => ({ value: client.id, label: client.name })),
      },
    ],

    columns: [
      {
        key: 'name', label: 'Project',
        render: (row) => `
          <span class="cell-lead">
            <span class="stat-icon" style="width:32px;height:32px;background:${escapeHtml(row.color)}22;color:${escapeHtml(row.color)}">
              <i data-lucide="folder" style="width:15px;height:15px"></i>
            </span>
            <span class="ct">
              <b>${escapeHtml(row.name)}</b>
              <span>${escapeHtml(store.clients.get(row.client_id)?.name || 'Internal')}</span>
            </span>
          </span>`,
      },
      { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      { key: 'priority', label: 'Priority', render: (row) => priorityTag(row.priority) },
      {
        key: 'progress', label: 'Progress', numeric: true,
        render: (row) => progressBar(row.progress),
      },
      {
        key: 'budget', label: 'Budget', numeric: true,
        render: (row) => `<span class="cell-money">${escapeHtml(money(row.budget, { compact: true }))}</span>`,
      },
      {
        key: 'members', label: 'Team', sortable: false,
        sortValue: (row) => store.projectMembers(row.id).length,
        render: (row) => avatarStack(store.projectMembers(row.id), 3),
      },
      {
        key: 'deadline', label: 'Deadline', numeric: true,
        render: (row) => {
          if (!row.deadline) return '<span class="fs-xs faint">—</span>';
          const days = daysBetween(row.deadline);
          const tone = row.status === 'completed' ? 'muted' : days < 0 ? 'c-danger' : days <= 7 ? 'c-warning' : 'muted';
          return `<span class="fs-xs ${tone} nowrap">${escapeHtml(fmtDate(row.deadline, 'short'))}</span>`;
        },
      },
    ],

    card: (row) => `
      <div class="cli-head">
        <span class="stat-icon" style="background:${escapeHtml(row.color)}22;color:${escapeHtml(row.color)}">
          <i data-lucide="folder"></i>
        </span>
        <div class="grow">
          <b class="truncate" style="display:block">${escapeHtml(row.name)}</b>
          <span class="fs-xs muted">${escapeHtml(store.clients.get(row.client_id)?.name || 'Internal')}</span>
        </div>
        ${statusBadge(row.status)}
      </div>
      <div class="mb-3">${progressBar(row.progress)}</div>
      <div class="cli-rows">
        <div class="cli-row"><span>Budget</span><b>${escapeHtml(money(row.budget, { compact: true }))}</b></div>
        <div class="cli-row"><span>Deadline</span><span>${row.deadline ? escapeHtml(fmtDate(row.deadline, 'short')) : '—'}</span></div>
        <div class="cli-row"><span>Team</span><span>${avatarStack(store.projectMembers(row.id), 3)}</span></div>
      </div>`,

    actions: (row) => rowActions(row.id, { extra: [{ act: 'view', icon: 'eye', tip: 'Details' }] }),
    onRowClick: (row) => openProjectDetail(row),
    onAction: (action, id, row) => {
      if (action === 'view') openProjectDetail(row);
      if (action === 'edit') openProjectForm(row);
      if (action === 'delete') deleteProject(row);
    },

    empty: {
      icon: 'folder-plus',
      title: 'No projects yet',
      body: 'Create the first project to get the studio moving.',
      action: { label: 'New project', icon: 'plus', onClick: () => openProjectForm() },
    },
  });
}

/* =============================================================================
   EXPORT
   ========================================================================== */

function exportProjects() {
  const rows = view === 'table' && table ? table.getVisible() : filteredProjects();
  if (!rows.length) { toast.warning('Nothing to export'); return; }

  exportCSV(rows, [
    { key: 'name', label: 'Project' },
    { key: 'client', label: 'Client', map: (row) => store.clients.get(row.client_id)?.name || 'Internal' },
    { key: 'status', label: 'Status', map: (row) => titleCase(row.status) },
    { key: 'priority', label: 'Priority', map: (row) => titleCase(row.priority) },
    { key: 'progress', label: 'Progress %' },
    { key: 'budget', label: 'Budget', map: (row) => Number(row.budget).toFixed(2) },
    { key: 'spent', label: 'Spent', map: (row) => Number(row.spent).toFixed(2) },
    { key: 'start_date', label: 'Start', map: (row) => (row.start_date ? fmtDate(row.start_date) : '') },
    { key: 'deadline', label: 'Deadline', map: (row) => (row.deadline ? fmtDate(row.deadline) : '') },
    { key: 'team', label: 'Team', map: (row) => store.projectMembers(row.id).map((m) => m.full_name).join('; ') },
  ], `synthworks-projects-${new Date().toISOString().slice(0, 10)}.csv`);

  toast.success('Export ready', `${rows.length} projects written to CSV.`);
}

/* =============================================================================
   VIEW STATE
   ========================================================================== */

function setView(next) {
  view = next;
  $('#projectBoard').hidden = next !== 'board';
  $('#projectTable').hidden = next !== 'table';
  $('#projectTimeline').hidden = next !== 'timeline';

  $$('#viewSwitch button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === next);
  });

  if (next === 'board') renderBoard();
  if (next === 'table') table?.refresh();
  if (next === 'timeline') renderTimeline();
}

function setStatus(next) {
  statusFilter = next;
  $$('#statusFilter button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.status === next);
  });
  repaint();
}

/* =============================================================================
   BOOT
   ========================================================================== */

const repaint = debounce(() => {
  renderStats();
  if (view === 'board') renderBoard();
  if (view === 'table') table?.refresh();
  if (view === 'timeline') renderTimeline();
}, 200);

async function boot() {
  mountLoader();
  initAnimations();

  if (!await requireAuth()) return;
  await initShell('projects', { title: 'Projects' });

  try {
    await store.load(
      'projects', 'clients', 'profiles', 'project_members',
      'tasks', 'milestones', 'attachments', 'finance_transactions', 'notifications',
    );
  } catch (err) {
    hideLoader();
    toast.error('Could not load projects', err.message);
    return;
  }

  renderStats();
  buildTable();
  renderBoard();

  $('#addProject')?.addEventListener('click', () => openProjectForm());
  $('#exportProjects')?.addEventListener('click', exportProjects);

  $('#viewSwitch')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

  $('#statusFilter')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (button) setStatus(button.dataset.status);
  });

  // Board card interactions.
  const board = $('#projectBoard');
  board?.addEventListener('click', (event) => {
    const card = event.target.closest('.card[data-id]');
    if (!card) return;
    const project = store.projects.get(card.dataset.id);
    const actionBtn = event.target.closest('[data-act]');

    if (actionBtn) {
      event.stopPropagation();
      if (actionBtn.dataset.act === 'edit') openProjectForm(project);
      if (actionBtn.dataset.act === 'delete') deleteProject(project);
      return;
    }
    openProjectDetail(project);
  });
  board?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const card = event.target.closest('.card[data-id]');
    if (card) openProjectDetail(store.projects.get(card.dataset.id));
  });

  $('#projectTimeline')?.addEventListener('click', (event) => {
    const row = event.target.closest('.gantt-row[data-id]');
    if (row) openProjectDetail(store.projects.get(row.dataset.id));
  });

  // Deep link: projects.html?id=…
  const deepLink = queryParam('id');
  if (deepLink) {
    const project = store.projects.get(deepLink);
    if (project) setTimeout(() => openProjectDetail(project), 420);
  }

  store.on('projects:change', (change) => {
    repaint();
    if (change.remote && change.row?.id && view === 'table' && table) {
      setTimeout(() => flashRow(table.root, change.row.id), 260);
    }
  });
  ['tasks', 'project_members', 'milestones', 'attachments', 'clients', 'finance_transactions']
    .forEach((collection) => store.on(`${collection}:change`, repaint));

  initReveal();
  animatePage('.page > *');
  hideLoader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
