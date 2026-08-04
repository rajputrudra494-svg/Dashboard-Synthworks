/* =============================================================================
   SynthWorks — store.js
   The shared data layer.

   One in-memory cache per table, one realtime websocket for the whole app, and
   a tiny event bus so any page can re-render the instant a colleague changes
   something. Pages never talk to Supabase directly for CRUD — they go through
   a Collection, which keeps the cache, the database and every open browser in
   agreement.

       import { store } from './store.js';
       await store.load('clients', 'projects');
       store.on('clients:change', render);
       await store.clients.create({ name: 'Northwind' });
   ========================================================================== */

import { sb, friendlyError } from './supabase.js';
import { auth } from './auth.js';
import {
  emitter, sumBy, isoDate, startOfDay, startOfWeek, startOfMonth, startOfYear,
  toDate, setCurrency, storage,
} from './utils.js';

const bus = emitter();

/* =============================================================================
   COLLECTION
   ========================================================================== */

class Collection {
  /**
   * @param {string} table
   * @param {{select?: string, orderBy?: string, ascending?: boolean, limit?: number}} [opts]
   */
  constructor(table, { select = '*', orderBy = 'created_at', ascending = false, limit = 2000 } = {}) {
    this.table = table;
    this.select = select;
    this.orderBy = orderBy;
    this.ascending = ascending;
    this.limit = limit;

    this.rows = [];
    this.index = new Map();
    this.loaded = false;
    this.error = null;
    this._inflight = null;
  }

  /** All cached rows, in sort order. */
  get all() { return this.rows; }
  get count() { return this.rows.length; }

  get(id) { return this.index.get(id) || null; }

  /** Loads the table into cache. Concurrent callers share one request. */
  async load(force = false) {
    if (this.loaded && !force) return this.rows;
    if (this._inflight) return this._inflight;

    this._inflight = (async () => {
      try {
        const { data, error } = await sb
          .from(this.table)
          .select(this.select)
          .order(this.orderBy, { ascending: this.ascending })
          .limit(this.limit);

        if (error) throw error;

        this.rows = data || [];
        this._reindex();
        this.loaded = true;
        this.error = null;
      } catch (err) {
        this.error = err;
        console.error(`[store] failed to load ${this.table}`, err);
        throw new Error(friendlyError(err));
      } finally {
        this._inflight = null;
      }

      bus.emit(`${this.table}:change`, { type: 'load', rows: this.rows });
      bus.emit('change', { table: this.table, type: 'load' });
      return this.rows;
    })();

    return this._inflight;
  }

  async create(payload) {
    const body = { ...payload };
    // Stamp authorship where the table supports it.
    if (auth.userId && 'created_by' in body === false) body.created_by = auth.userId;

    const { data, error } = await sb.from(this.table).insert(body).select(this.select).single();
    if (error) throw new Error(friendlyError(error));

    // Apply optimistically; the realtime echo will be de-duplicated.
    this._upsert(data);
    bus.emit(`${this.table}:change`, { type: 'insert', row: data, local: true });
    bus.emit('change', { table: this.table, type: 'insert', row: data, local: true });
    return data;
  }

  async update(id, patch) {
    const { data, error } = await sb
      .from(this.table).update(patch).eq('id', id).select(this.select).single();
    if (error) throw new Error(friendlyError(error));

    this._upsert(data);
    bus.emit(`${this.table}:change`, { type: 'update', row: data, local: true });
    bus.emit('change', { table: this.table, type: 'update', row: data, local: true });
    return data;
  }

  async remove(id) {
    const row = this.get(id);
    const { error } = await sb.from(this.table).delete().eq('id', id);
    if (error) throw new Error(friendlyError(error));

    this._delete(id);
    bus.emit(`${this.table}:change`, { type: 'delete', row, local: true });
    bus.emit('change', { table: this.table, type: 'delete', row, local: true });
    return true;
  }

  /** Inserts many rows in one round-trip (used by project member pickers). */
  async insertMany(rows) {
    if (!rows.length) return [];
    const { data, error } = await sb.from(this.table).insert(rows).select(this.select);
    if (error) throw new Error(friendlyError(error));
    (data || []).forEach((row) => this._upsert(row));
    bus.emit(`${this.table}:change`, { type: 'insert', rows: data, local: true });
    return data;
  }

  async removeWhere(column, value) {
    const { error } = await sb.from(this.table).delete().eq(column, value);
    if (error) throw new Error(friendlyError(error));
    this.rows = this.rows.filter((row) => row[column] !== value);
    this._reindex();
    bus.emit(`${this.table}:change`, { type: 'delete', local: true });
    return true;
  }

  /* ── Cache maintenance ─────────────────────────────────────────────────── */

  _reindex() {
    this.index = new Map(this.rows.map((row) => [row.id, row]));
  }

  _sort() {
    const key = this.orderBy;
    const dir = this.ascending ? 1 : -1;
    this.rows.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va > vb ? 1 : -1) * dir;
    });
  }

  _upsert(row) {
    if (!row?.id) return;
    const existing = this.index.get(row.id);
    if (existing) {
      Object.assign(existing, row);
    } else {
      this.rows.push(row);
      this.index.set(row.id, row);
    }
    this._sort();
  }

  _delete(id) {
    if (!this.index.has(id)) return;
    this.index.delete(id);
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  /** Applies a realtime payload originating from another client (or this one). */
  _applyRealtime(payload) {
    const { eventType, new: fresh, old } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const known = this.index.get(fresh.id);
      // Identical row we already have → the echo of our own write. Skip the
      // re-render but still let listeners know the server confirmed it.
      const unchanged = known && known.updated_at && known.updated_at === fresh.updated_at;
      this._upsert(fresh);
      if (unchanged) return null;
      return { type: eventType.toLowerCase(), row: fresh };
    }

    if (eventType === 'DELETE') {
      const row = this.index.get(old?.id) || old;
      if (!this.index.has(old?.id)) return null;
      this._delete(old.id);
      return { type: 'delete', row };
    }

    return null;
  }
}

/* =============================================================================
   COLLECTIONS
   The `select` strings pull the joins each page needs so we never N+1.
   ========================================================================== */

const collections = {
  profiles: new Collection('profiles', { orderBy: 'full_name', ascending: true }),
  clients:  new Collection('clients'),
  projects: new Collection('projects'),
  project_members: new Collection('project_members', { orderBy: 'created_at', ascending: true }),
  milestones: new Collection('milestones', { orderBy: 'position', ascending: true }),
  tasks: new Collection('tasks', { orderBy: 'position', ascending: true, limit: 4000 }),
  task_comments: new Collection('task_comments', { orderBy: 'created_at', ascending: true }),
  finance_transactions: new Collection('finance_transactions', { orderBy: 'occurred_on', limit: 4000 }),
  activities: new Collection('activities', { orderBy: 'created_at', limit: 300 }),
  notifications: new Collection('notifications', { orderBy: 'created_at', limit: 100 }),
  calendar_events: new Collection('calendar_events', { orderBy: 'starts_at', ascending: true }),
  attachments: new Collection('attachments', { orderBy: 'created_at' }),
};

/* =============================================================================
   REALTIME
   A single channel carries every table. Supabase multiplexes the filters
   server-side, so one socket is both cheaper and less racy than one per table.
   ========================================================================== */

let channel = null;
let realtimeState = 'idle';

function setRealtimeState(state) {
  realtimeState = state;
  bus.emit('realtime', state);
  document.querySelectorAll('.realtime-pill').forEach((pill) => {
    pill.classList.toggle('is-live', state === 'live');
    pill.classList.toggle('is-down', state === 'down');
    const label = pill.querySelector('span');
    if (label) label.textContent = state === 'live' ? 'Live' : state === 'down' ? 'Offline' : 'Connecting';
  });
}

export function subscribeRealtime() {
  if (!sb || channel) return;

  setRealtimeState('connecting');
  channel = sb.channel('synthworks-workspace');

  Object.keys(collections).forEach((table) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const collection = collections[table];
      // Ignore traffic for tables this page never loaded — nothing is listening.
      if (!collection.loaded) return;

      const change = collection._applyRealtime(payload);
      if (!change) return;

      bus.emit(`${table}:change`, { ...change, remote: true });
      bus.emit('change', { table, ...change, remote: true });
    });
  });

  // The settings row is shared config — a change there re-themes the app.
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload) => {
    if (payload.new?.key === 'workspace') {
      workspace = { ...workspace, ...payload.new.value };
      applyWorkspace();
      bus.emit('workspace:change', workspace);
    }
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED')  setRealtimeState('live');
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeState('down');
    if (status === 'CLOSED') setRealtimeState('idle');
  });

  // Reconnect and re-sync after the laptop wakes or the network returns.
  window.addEventListener('online', () => refreshAll());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && realtimeState !== 'live') refreshAll();
  });
}

export function unsubscribeRealtime() {
  if (!channel) return;
  sb.removeChannel(channel);
  channel = null;
  setRealtimeState('idle');
}

/** Re-fetches every table that has been loaded on this page. */
async function refreshAll() {
  const loaded = Object.values(collections).filter((c) => c.loaded);
  await Promise.allSettled(loaded.map((c) => c.load(true)));
  bus.emit('refresh');
}

/* =============================================================================
   WORKSPACE SETTINGS
   ========================================================================== */

export let workspace = {
  company_name: 'SynthWorks',
  currency: 'USD',
  currency_symbol: '$',
  tagline: 'Design & Engineering Studio',
  timezone: 'UTC',
  week_start: 1,
  logo_url: null,
};

function applyWorkspace() {
  setCurrency(workspace.currency, workspace.currency_symbol);
  document.querySelectorAll('[data-company-name]').forEach((node) => {
    node.textContent = workspace.company_name;
  });
  document.title = document.title.replace(/^[^·]+·/, `${workspace.company_name} ·`);
}

export async function loadWorkspace() {
  if (!sb) return workspace;
  try {
    const { data } = await sb.from('settings').select('value').eq('key', 'workspace').maybeSingle();
    if (data?.value) workspace = { ...workspace, ...data.value };
  } catch (err) {
    console.warn('[store] workspace settings unavailable', err);
  }
  applyWorkspace();
  return workspace;
}

export async function saveWorkspace(patch) {
  const value = { ...workspace, ...patch };
  const { error } = await sb.from('settings').upsert({
    key: 'workspace',
    value,
    updated_by: auth.userId,
  }, { onConflict: 'key' });

  if (error) throw new Error(friendlyError(error));
  workspace = value;
  applyWorkspace();
  bus.emit('workspace:change', workspace);
  return workspace;
}

/** Per-user preferences, stored server-side so they follow you between devices. */
export async function loadPreferences() {
  if (!sb || !auth.userId) return {};
  const { data } = await sb.from('settings').select('value').eq('key', auth.userId).maybeSingle();
  const prefs = data?.value || {};
  storage.set('prefs', prefs);
  return prefs;
}

export async function savePreferences(patch) {
  const value = { ...storage.get('prefs', {}), ...patch };
  storage.set('prefs', value);
  if (!sb || !auth.userId) return value;
  await sb.from('settings').upsert({ key: auth.userId, value, updated_by: auth.userId }, { onConflict: 'key' });
  return value;
}

/* =============================================================================
   NOTIFICATIONS
   ========================================================================== */

/** Broadcasts a notification to the whole workspace (recipient_id = null). */
export async function pushNotification({ title, body, type = 'info', link = null, recipientId = null }) {
  if (!sb) return null;
  try {
    const { data } = await sb.from('notifications').insert({
      title, body, type, link,
      recipient_id: recipientId,
      actor_id: auth.userId,
    }).select().single();
    return data;
  } catch (err) {
    console.warn('[store] notification failed', err);
    return null;
  }
}

export async function markNotificationRead(id) {
  const row = collections.notifications.get(id);
  if (!row || !auth.userId) return;
  if ((row.read_by || []).includes(auth.userId)) return;

  const readBy = [...(row.read_by || []), auth.userId];
  await collections.notifications.update(id, { read_by: readBy });
}

export async function markAllNotificationsRead() {
  const unread = collections.notifications.all.filter((n) => !isRead(n));
  await Promise.allSettled(unread.map((n) => markNotificationRead(n.id)));
}

export const isRead = (notification) =>
  Boolean(auth.userId) && (notification.read_by || []).includes(auth.userId);

export const unreadCount = () =>
  collections.notifications.all.filter((n) => !isRead(n)).length;

/* =============================================================================
   DERIVED METRICS
   Shared by the dashboard, finance and analytics pages so the numbers can
   never disagree with each other.
   ========================================================================== */

const paidIncome  = (rows) => rows.filter((t) => t.type === 'income'  && t.status === 'paid');
const realExpense = (rows) => rows.filter((t) => t.type === 'expense' && t.status !== 'cancelled');

/** @param {Date|string} [from] @param {Date|string} [to] */
export function transactionsBetween(from, to) {
  const start = from ? startOfDay(from).getTime() : -Infinity;
  const end = to ? new Date(toDate(to)).setHours(23, 59, 59, 999) : Infinity;
  return collections.finance_transactions.all.filter((t) => {
    const time = toDate(t.occurred_on)?.getTime();
    return time != null && time >= start && time <= end;
  });
}

export function financeSummary(rows = collections.finance_transactions.all) {
  const income = sumBy(paidIncome(rows), 'amount');
  const expense = sumBy(realExpense(rows), 'amount');
  const pending = sumBy(rows.filter((t) => t.type === 'income' && t.status === 'pending'), 'amount');
  const overdue = sumBy(rows.filter((t) => t.type === 'income' && t.status === 'overdue'), 'amount');

  return {
    income,
    expense,
    profit: income - expense,
    margin: income > 0 ? ((income - expense) / income) * 100 : 0,
    pending,
    overdue,
    invoices: rows.filter((t) => t.type === 'income' && t.invoice_no).length,
    count: rows.length,
  };
}

/** Revenue for today / this week / this month / this year / all time. */
export function revenueBuckets() {
  const now = new Date();
  const weekStart = startOfWeek(now, workspace.week_start ?? 1);
  return {
    today:   financeSummary(transactionsBetween(startOfDay(now), now)).income,
    week:    financeSummary(transactionsBetween(weekStart, now)).income,
    month:   financeSummary(transactionsBetween(startOfMonth(now), now)).income,
    year:    financeSummary(transactionsBetween(startOfYear(now), now)).income,
    total:   financeSummary().income,
  };
}

export function projectStats() {
  const rows = collections.projects.all;
  return {
    total: rows.length,
    active: rows.filter((p) => p.status === 'active').length,
    completed: rows.filter((p) => p.status === 'completed').length,
    planning: rows.filter((p) => p.status === 'planning').length,
    onHold: rows.filter((p) => p.status === 'on_hold').length,
    review: rows.filter((p) => p.status === 'review').length,
    overdue: rows.filter((p) =>
      p.deadline && p.status !== 'completed' && p.status !== 'cancelled' &&
      toDate(p.deadline) < startOfDay()).length,
    avgProgress: rows.length ? Math.round(sumBy(rows, 'progress') / rows.length) : 0,
    budget: sumBy(rows, 'budget'),
  };
}

export function taskStats() {
  const rows = collections.tasks.all;
  const done = rows.filter((t) => t.status === 'done');
  return {
    total: rows.length,
    todo: rows.filter((t) => t.status === 'todo').length,
    doing: rows.filter((t) => t.status === 'doing').length,
    review: rows.filter((t) => t.status === 'review').length,
    done: done.length,
    pending: rows.length - done.length,
    overdue: rows.filter((t) =>
      t.status !== 'done' && t.due_date && toDate(t.due_date) < startOfDay()).length,
    completionRate: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
  };
}

export function clientStats() {
  const rows = collections.clients.all;
  return {
    total: rows.length,
    active: rows.filter((c) => c.status === 'active').length,
    leads: rows.filter((c) => c.status === 'lead').length,
    archived: rows.filter((c) => c.status === 'archived').length,
  };
}

/** Projects + revenue attributed to one client. */
export function clientRollup(clientId) {
  const projects = collections.projects.all.filter((p) => p.client_id === clientId);
  const revenue = sumBy(
    paidIncome(collections.finance_transactions.all).filter((t) => t.client_id === clientId),
    'amount',
  );
  return {
    projects: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    revenue,
  };
}

/** Members assigned to a project, resolved to full profile rows. */
export function projectMembers(projectId) {
  return collections.project_members.all
    .filter((m) => m.project_id === projectId)
    .map((m) => collections.profiles.get(m.profile_id))
    .filter(Boolean);
}

/** Deadlines + meetings in the next `days`, sorted soonest-first. */
export function upcoming(days = 14) {
  const now = startOfDay();
  const until = new Date(now.getTime() + days * 86400000);
  const items = [];

  collections.projects.all.forEach((p) => {
    if (!p.deadline || p.status === 'completed' || p.status === 'cancelled') return;
    const date = toDate(p.deadline);
    if (date >= now && date <= until) {
      items.push({ kind: 'project', date, title: p.name, meta: `${p.progress}% complete`, id: p.id, href: 'projects.html' });
    }
  });

  collections.tasks.all.forEach((t) => {
    if (!t.due_date || t.status === 'done') return;
    const date = toDate(t.due_date);
    if (date >= now && date <= until) {
      items.push({ kind: 'task', date, title: t.title, meta: t.priority, id: t.id, href: 'tasks.html' });
    }
  });

  collections.calendar_events.all.forEach((e) => {
    const date = toDate(e.starts_at);
    if (date >= now && date <= until) {
      items.push({ kind: e.type, date, title: e.title, meta: e.location || '', id: e.id, href: 'calendar.html' });
    }
  });

  return items.sort((a, b) => a.date - b.date);
}

/** Monthly income/expense series for the charts. */
export function monthlySeries(months = 12) {
  const buckets = new Map();
  const now = new Date();

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, {
      date: d, income: 0, expense: 0,
    });
  }

  collections.finance_transactions.all.forEach((t) => {
    const d = toDate(t.occurred_on);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (!bucket) return;
    if (t.type === 'income' && t.status === 'paid') bucket.income += Number(t.amount) || 0;
    if (t.type === 'expense' && t.status !== 'cancelled') bucket.expense += Number(t.amount) || 0;
  });

  return [...buckets.values()];
}

/** Daily series over the last `days` for sparklines / weekly charts. */
export function dailySeries(days = 7, { field = 'income' } = {}) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.set(isoDate(d), { date: startOfDay(d), value: 0 });
  }

  collections.finance_transactions.all.forEach((t) => {
    const key = isoDate(t.occurred_on);
    const bucket = buckets.get(key);
    if (!bucket) return;
    const matchesField = field === 'income'
      ? t.type === 'income' && t.status === 'paid'
      : t.type === 'expense' && t.status !== 'cancelled';
    if (matchesField) bucket.value += Number(t.amount) || 0;
  });

  return [...buckets.values()];
}

/** Tasks completed per day over the last `days`. */
export function taskCompletionSeries(days = 14) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.set(isoDate(d), { date: startOfDay(d), completed: 0, created: 0 });
  }

  collections.tasks.all.forEach((t) => {
    const createdKey = isoDate(t.created_at);
    if (buckets.has(createdKey)) buckets.get(createdKey).created += 1;
    if (t.completed_at) {
      const doneKey = isoDate(t.completed_at);
      if (buckets.has(doneKey)) buckets.get(doneKey).completed += 1;
    }
  });

  return [...buckets.values()];
}

/** Cumulative client count per month — the "client growth" chart. */
export function clientGrowthSeries(months = 12) {
  const series = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i -= 1) {
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    series.push({
      date: new Date(now.getFullYear(), now.getMonth() - i, 1),
      total: collections.clients.all.filter((c) => toDate(c.created_at) <= end).length,
      added: collections.clients.all.filter((c) => {
        const d = toDate(c.created_at);
        return d && d.getFullYear() === end.getFullYear() && d.getMonth() === end.getMonth();
      }).length,
    });
  }
  return series;
}

/* =============================================================================
   GLOBAL SEARCH
   ========================================================================== */

/**
 * Searches every loaded collection.
 * @param {string} query
 * @param {number} [limit=8] per category
 */
export function search(query, limit = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 1) return [];

  const hit = (text) => text && String(text).toLowerCase().includes(q);
  const results = [];

  collections.clients.all.forEach((c) => {
    if (hit(c.name) || hit(c.company) || hit(c.email)) {
      results.push({ kind: 'client', id: c.id, title: c.name, sub: c.company || c.email || '—', icon: 'building-2', href: `clients.html?id=${c.id}` });
    }
  });

  collections.projects.all.forEach((p) => {
    if (hit(p.name) || hit(p.description)) {
      const client = collections.clients.get(p.client_id);
      results.push({ kind: 'project', id: p.id, title: p.name, sub: client?.name || 'Internal', icon: 'folder-kanban', href: `projects.html?id=${p.id}` });
    }
  });

  collections.tasks.all.forEach((t) => {
    if (hit(t.title) || hit(t.description)) {
      const project = collections.projects.get(t.project_id);
      results.push({ kind: 'task', id: t.id, title: t.title, sub: project?.name || 'No project', icon: 'circle-check-big', href: `tasks.html?id=${t.id}` });
    }
  });

  collections.finance_transactions.all.forEach((t) => {
    if (hit(t.title) || hit(t.invoice_no) || hit(t.category)) {
      results.push({ kind: 'finance', id: t.id, title: t.title, sub: `${t.type} · ${t.category}`, icon: 'receipt', href: `finance.html?id=${t.id}` });
    }
  });

  collections.profiles.all.forEach((p) => {
    if (hit(p.full_name) || hit(p.email) || hit(p.job_title)) {
      results.push({ kind: 'team', id: p.id, title: p.full_name, sub: p.job_title || p.email, icon: 'user', href: `team.html?id=${p.id}` });
    }
  });

  // Cap each category so one type cannot crowd out the rest.
  const perKind = {};
  return results.filter((r) => {
    perKind[r.kind] = (perKind[r.kind] || 0) + 1;
    return perKind[r.kind] <= limit;
  });
}

/* =============================================================================
   PUBLIC API
   ========================================================================== */

export const store = {
  ...collections,

  on: bus.on,
  off: bus.off,
  emit: bus.emit,

  get realtimeState() { return realtimeState; },

  /**
   * Loads one or more tables (in parallel) and opens the realtime socket.
   * @param  {...string} tables
   */
  async load(...tables) {
    const names = tables.flat();
    const jobs = names.map((name) => {
      const collection = collections[name];
      if (!collection) throw new Error(`[store] unknown table "${name}"`);
      return collection.load();
    });

    await Promise.all([loadWorkspace(), ...jobs]);
    subscribeRealtime();
    return collections;
  },

  /** Force-refreshes the given tables (or every loaded one). */
  async refresh(...tables) {
    const names = tables.flat();
    if (!names.length) return refreshAll();
    return Promise.all(names.map((name) => collections[name]?.load(true)));
  },

  search,
  workspace: () => workspace,
  saveWorkspace,
  loadPreferences,
  savePreferences,
  pushNotification,
  markNotificationRead,
  markAllNotificationsRead,
  isRead,
  unreadCount,

  financeSummary,
  transactionsBetween,
  revenueBuckets,
  projectStats,
  taskStats,
  clientStats,
  clientRollup,
  projectMembers,
  upcoming,
  monthlySeries,
  dailySeries,
  taskCompletionSeries,
  clientGrowthSeries,
};

export default store;
