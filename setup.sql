-- =============================================================================
--  SynthWorks - COMPLETE DATABASE SETUP
--  File: setup.sql
--
--  ONE file. Run it ONCE. It builds the entire backend:
--
--     PART 1   Schema    - 13 tables, enums, foreign keys, 20+ indexes,
--                          triggers, helper functions and reporting views
--     PART 2   Realtime  - publishes every table so the workspace syncs live
--     PART 3   Security  - Row Level Security policies + role grants
--     PART 4   Storage   - 4 buckets and their access policies
--
--  HOW TO RUN
--     1. Supabase Dashboard -> your project -> SQL Editor -> New query
--     2. Paste this entire file
--     3. Press RUN
--
--  That is the whole database step. Every statement is idempotent, so it is
--  safe to run again later.
--
--  AFTER THIS
--     Supabase -> Settings -> API, then paste into supabase.js:
--       Project URL         ->  SUPABASE_URL
--       anon / public key   ->  SUPABASE_ANON_KEY
--     Never put the service_role key in the browser.
-- =============================================================================

-- ==========================================================================
--  PART 1 + 2 - SCHEMA, TRIGGERS, VIEWS AND REALTIME
-- ==========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
--  EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
--  ENUM TYPES
--  Wrapped in DO blocks so re-running the script does not error.
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type client_status   as enum ('lead', 'active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status  as enum ('planning', 'active', 'on_hold', 'review', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status     as enum ('todo', 'doing', 'review', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority_level  as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type txn_type        as enum ('income', 'expense');
exception when duplicate_object then null; end $$;

do $$ begin
  create type txn_status      as enum ('paid', 'pending', 'overdue', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_type      as enum ('meeting', 'deadline', 'milestone', 'reminder', 'holiday');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role     as enum ('owner', 'admin', 'manager', 'member', 'viewer');
exception when duplicate_object then null; end $$;


-- =============================================================================
--  1. PROFILES
--  One row per authenticated user. Auto-created by a trigger on auth.users.
-- =============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text        not null,
  full_name    text        not null default 'New Member',
  avatar_url   text,
  role         member_role not null default 'member',
  job_title    text,
  phone        text,
  bio          text,
  timezone     text        not null default 'UTC',
  is_online    boolean     not null default false,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists profiles_email_idx      on public.profiles (email);
create index if not exists profiles_last_seen_idx  on public.profiles (last_seen_at desc);


-- =============================================================================
--  2. CLIENTS
-- =============================================================================
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text          not null,
  company     text,
  email       text,
  phone       text,
  website     text,
  address     text,
  avatar_url  text,
  notes       text,
  status      client_status not null default 'active',
  tags        text[]        not null default '{}',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

create index if not exists clients_status_idx     on public.clients (status);
create index if not exists clients_created_at_idx on public.clients (created_at desc);
-- Trigram-free lightweight search index over the most searched columns.
create index if not exists clients_search_idx
  on public.clients using gin (to_tsvector('simple',
     coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '')));


-- =============================================================================
--  3. PROJECTS
-- =============================================================================
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text           not null,
  description  text,
  client_id    uuid references public.clients (id) on delete set null,
  status       project_status not null default 'planning',
  priority     priority_level not null default 'medium',
  progress     smallint       not null default 0 check (progress between 0 and 100),
  budget       numeric(14, 2) not null default 0 check (budget >= 0),
  spent        numeric(14, 2) not null default 0 check (spent >= 0),
  color        text           not null default '#7C3AED',
  tags         text[]         not null default '{}',
  start_date   date,
  deadline     date,
  notes        text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now(),
  completed_at timestamptz
);

create index if not exists projects_client_idx     on public.projects (client_id);
create index if not exists projects_status_idx     on public.projects (status);
create index if not exists projects_deadline_idx   on public.projects (deadline);
create index if not exists projects_created_at_idx on public.projects (created_at desc);


-- =============================================================================
--  4. PROJECT MEMBERS  (many-to-many: projects ↔ profiles)
-- =============================================================================
create table if not exists public.project_members (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'contributor',
  created_at timestamptz not null default now(),
  unique (project_id, profile_id)
);

create index if not exists project_members_project_idx on public.project_members (project_id);
create index if not exists project_members_profile_idx on public.project_members (profile_id);


-- =============================================================================
--  5. MILESTONES
-- =============================================================================
create table if not exists public.milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid    not null references public.projects (id) on delete cascade,
  title        text    not null,
  description  text,
  due_date     date,
  is_complete  boolean not null default false,
  position     integer not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists milestones_project_idx on public.milestones (project_id, position);


-- =============================================================================
--  6. TASKS
-- =============================================================================
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text           not null,
  description  text,
  project_id   uuid references public.projects (id) on delete cascade,
  assignee_id  uuid references public.profiles (id) on delete set null,
  status       task_status    not null default 'todo',
  priority     priority_level not null default 'medium',
  labels       text[]         not null default '{}',
  due_date     date,
  position     integer        not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_project_idx  on public.tasks (project_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_status_idx   on public.tasks (status, position);
create index if not exists tasks_due_idx      on public.tasks (due_date);


-- =============================================================================
--  7. TASK COMMENTS
-- =============================================================================
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);


-- =============================================================================
--  8. FINANCE TRANSACTIONS
--  Invoices are income transactions that carry an invoice_no.
-- =============================================================================
create table if not exists public.finance_transactions (
  id           uuid primary key default gen_random_uuid(),
  type         txn_type       not null,
  category     text           not null default 'general',
  title        text           not null,
  description  text,
  amount       numeric(14, 2) not null check (amount >= 0),
  status       txn_status     not null default 'paid',
  invoice_no   text,
  client_id    uuid references public.clients (id)  on delete set null,
  project_id   uuid references public.projects (id) on delete set null,
  occurred_on  date           not null default current_date,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now()
);

create index if not exists finance_type_idx     on public.finance_transactions (type);
create index if not exists finance_date_idx     on public.finance_transactions (occurred_on desc);
create index if not exists finance_client_idx   on public.finance_transactions (client_id);
create index if not exists finance_project_idx  on public.finance_transactions (project_id);
create index if not exists finance_invoice_idx  on public.finance_transactions (invoice_no)
  where invoice_no is not null;


-- =============================================================================
--  9. ACTIVITIES  (global audit / activity feed)
-- =============================================================================
create table if not exists public.activities (
  id           bigserial primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_name   text not null default 'Someone',
  action       text not null,                 -- created | updated | deleted | completed
  entity_type  text not null,                 -- client | project | task | transaction | event
  entity_id    text,
  entity_label text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists activities_created_idx on public.activities (created_at desc);
create index if not exists activities_entity_idx  on public.activities (entity_type, entity_id);


-- =============================================================================
--  10. NOTIFICATIONS
--  recipient_id NULL  →  workspace-wide broadcast.
--  read_by holds the ids of everyone who has already dismissed it.
-- =============================================================================
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  title        text not null,
  body         text,
  type         text not null default 'info',  -- info | success | warning | danger
  link         text,
  read_by      uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_id);
create index if not exists notifications_created_idx   on public.notifications (created_at desc);


-- =============================================================================
--  11. CALENDAR EVENTS
-- =============================================================================
create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  description text,
  type        event_type  not null default 'meeting',
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean     not null default false,
  location    text,
  color       text        not null default '#7C3AED',
  project_id  uuid references public.projects (id) on delete cascade,
  client_id   uuid references public.clients (id)  on delete set null,
  attendees   uuid[]      not null default '{}',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists calendar_starts_idx  on public.calendar_events (starts_at);
create index if not exists calendar_project_idx on public.calendar_events (project_id);


-- =============================================================================
--  12. SETTINGS  (single shared workspace row + per-user preference rows)
-- =============================================================================
create table if not exists public.settings (
  key        text primary key,               -- 'workspace' or a user uuid
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Seed the shared workspace settings row.
insert into public.settings (key, value)
values ('workspace', jsonb_build_object(
  'company_name', 'SynthWorks',
  'currency',     'USD',
  'currency_symbol', '$',
  'timezone',     'UTC',
  'week_start',   1,
  'logo_url',     null,
  'tagline',      'Design & Engineering Studio'
))
on conflict (key) do nothing;


-- =============================================================================
--  13. ATTACHMENTS  (metadata for files living in Supabase Storage)
-- =============================================================================
create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  bucket      text not null default 'project-files',
  path        text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint not null default 0,
  entity_type text not null,                 -- project | client | task
  entity_id   uuid not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists attachments_entity_idx on public.attachments (entity_type, entity_id);


-- =============================================================================
--  FUNCTIONS & TRIGGERS
-- =============================================================================

-- ── Keep updated_at fresh on every UPDATE ────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'clients', 'projects', 'milestones', 'tasks', 'task_comments',
    'finance_transactions', 'calendar_events', 'settings'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
         for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;


-- ── Auto-create a profile whenever someone signs up ──────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, job_title)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(nullif(new.raw_user_meta_data ->> 'job_title', ''), 'Team Member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── Stamp completed_at when a task moves to / away from "done" ───────────────
create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_completed_at on public.tasks;
create trigger trg_task_completed_at
  before insert or update on public.tasks
  for each row execute function public.sync_task_completed_at();


-- ── Recalculate a project's progress from its tasks ─────────────────────────
--  Projects with zero tasks keep whatever progress was set manually.
create or replace function public.recalc_project_progress(p_project uuid)
returns void
language plpgsql
as $$
declare
  total   integer;
  done    integer;
  pct     smallint;
begin
  if p_project is null then return; end if;

  select count(*), count(*) filter (where status = 'done')
    into total, done
    from public.tasks where project_id = p_project;

  if total = 0 then return; end if;

  pct := round((done::numeric / total::numeric) * 100);

  update public.projects
     set progress     = pct,
         status       = case when pct = 100 and status <> 'cancelled' then 'completed'::project_status
                             when pct < 100 and status = 'completed'   then 'active'::project_status
                             else status end,
         completed_at = case when pct = 100 then coalesce(completed_at, now()) else null end
   where id = p_project
     and (progress is distinct from pct or (pct = 100) <> (status = 'completed'));
end;
$$;

create or replace function public.on_task_change_recalc()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_project_progress(old.project_id);
    return old;
  end if;

  perform public.recalc_project_progress(new.project_id);
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    perform public.recalc_project_progress(old.project_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_recalc_project on public.tasks;
create trigger trg_task_recalc_project
  after insert or update or delete on public.tasks
  for each row execute function public.on_task_change_recalc();


-- ── Keep projects.spent in sync with expense transactions ───────────────────
create or replace function public.recalc_project_spent(p_project uuid)
returns void
language plpgsql
as $$
begin
  if p_project is null then return; end if;
  update public.projects p
     set spent = coalesce((
       select sum(amount) from public.finance_transactions
        where project_id = p_project and type = 'expense' and status <> 'cancelled'
     ), 0)
   where p.id = p_project;
end;
$$;

create or replace function public.on_txn_change_recalc()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_project_spent(old.project_id);
    return old;
  end if;
  perform public.recalc_project_spent(new.project_id);
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    perform public.recalc_project_spent(old.project_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_txn_recalc_spent on public.finance_transactions;
create trigger trg_txn_recalc_spent
  after insert or update or delete on public.finance_transactions
  for each row execute function public.on_txn_change_recalc();


-- ── Universal activity logger ───────────────────────────────────────────────
--  Writes a human-readable line into public.activities for every write on the
--  tables listed below. The feed is what powers the realtime Activity page.
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_name    text;
  v_action  text;
  v_label   text;
  v_entity  text := tg_argv[0];
  v_id      text;
begin
  select full_name into v_name from public.profiles where id = v_actor;
  v_name := coalesce(v_name, 'Someone');

  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
  else
    v_action := 'updated';
  end if;

  -- Pull a friendly label out of whichever column the table uses.
  if tg_op = 'DELETE' then
    v_id := old.id::text;
    v_label := case v_entity
                 when 'transaction' then old.title
                 when 'client'      then old.name
                 when 'project'     then old.name
                 when 'task'        then old.title
                 when 'event'       then old.title
                 else 'record' end;
  else
    v_id := new.id::text;
    v_label := case v_entity
                 when 'transaction' then new.title
                 when 'client'      then new.name
                 when 'project'     then new.name
                 when 'task'        then new.title
                 when 'event'       then new.title
                 else 'record' end;
  end if;

  -- Completion is more interesting than a generic "updated".
  if tg_op = 'UPDATE' and v_entity = 'task'
     and old.status is distinct from new.status and new.status = 'done' then
    v_action := 'completed';
  end if;

  if tg_op = 'UPDATE' and v_entity = 'project'
     and old.status is distinct from new.status and new.status = 'completed' then
    v_action := 'completed';
  end if;

  insert into public.activities (actor_id, actor_name, action, entity_type, entity_id, entity_label)
  values (v_actor, v_name, v_action, v_entity, v_id, coalesce(v_label, 'record'));

  return coalesce(new, old);
end;
$$;

do $$
declare
  pair text[];
  pairs text[][] := array[
    array['clients', 'client'],
    array['projects', 'project'],
    array['tasks', 'task'],
    array['finance_transactions', 'transaction'],
    array['calendar_events', 'event']
  ];
begin
  foreach pair slice 1 in array pairs loop
    execute format('drop trigger if exists trg_log_%1$s on public.%1$s;', pair[1]);
    execute format(
      'create trigger trg_log_%1$s after insert or update or delete on public.%1$s
         for each row execute function public.log_activity(%2$L);', pair[1], pair[2]);
  end loop;
end $$;


-- ── Trim the activity feed so it never grows unbounded ──────────────────────
create or replace function public.prune_activities()
returns trigger
language plpgsql
as $$
begin
  delete from public.activities
   where id < (select max(id) - 5000 from public.activities);
  return null;
end;
$$;

drop trigger if exists trg_prune_activities on public.activities;
create trigger trg_prune_activities
  after insert on public.activities
  for each statement execute function public.prune_activities();


-- =============================================================================
--  AGGREGATE VIEWS  (used by the dashboard / analytics pages)
-- =============================================================================

-- Per-client rollup: project count + lifetime revenue.
create or replace view public.client_stats as
select
  c.id                                                  as client_id,
  count(distinct p.id)                                  as project_count,
  count(distinct p.id) filter (where p.status = 'active') as active_projects,
  coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'paid'), 0) as total_revenue
from public.clients c
left join public.projects p             on p.client_id = c.id
left join public.finance_transactions t on t.client_id = c.id
group by c.id;

-- Monthly income / expense series for the last 24 months.
create or replace view public.monthly_finance as
select
  date_trunc('month', occurred_on)::date as month,
  sum(amount) filter (where type = 'income'  and status = 'paid') as income,
  sum(amount) filter (where type = 'expense' and status <> 'cancelled') as expense
from public.finance_transactions
where occurred_on >= (current_date - interval '24 months')
group by 1
order by 1;


-- =============================================================================
--  REALTIME
--  Add every table to the supabase_realtime publication so the whole
--  workspace stays in sync without a refresh.
--  REPLICA IDENTITY FULL makes DELETE payloads carry the old row, which the
--  client needs in order to remove the right item from the UI.
-- =============================================================================
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'clients', 'projects', 'project_members', 'milestones',
    'tasks', 'task_comments', 'finance_transactions', 'activities',
    'notifications', 'calendar_events', 'settings', 'attachments'
  ];
begin
  -- Create the publication if this project has never had realtime enabled.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array tables loop
    execute format('alter table public.%I replica identity full;', t);
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;


-- ==========================================================================
--  PART 3 - ROW LEVEL SECURITY
-- ==========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
--  Enable RLS everywhere. With RLS on and no policy, access is denied by
--  default — so the policies below are the complete access surface.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'clients', 'projects', 'project_members', 'milestones',
    'tasks', 'task_comments', 'finance_transactions', 'activities',
    'notifications', 'calendar_events', 'settings', 'attachments'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    -- Drop any previously-created policies so this file is re-runnable.
    execute format('drop policy if exists "read_all_%1$s"    on public.%1$s;', t);
    execute format('drop policy if exists "insert_all_%1$s"  on public.%1$s;', t);
    execute format('drop policy if exists "update_all_%1$s"  on public.%1$s;', t);
    execute format('drop policy if exists "delete_all_%1$s"  on public.%1$s;', t);
  end loop;
end $$;


-- =============================================================================
--  SHARED WORKSPACE TABLES
--  Full CRUD for any signed-in colleague.
-- =============================================================================
do $$
declare
  t text;
  shared text[] := array[
    'clients', 'projects', 'project_members', 'milestones',
    'tasks', 'task_comments', 'finance_transactions',
    'calendar_events', 'attachments'
  ];
begin
  foreach t in array shared loop
    execute format($f$
      create policy "read_all_%1$s" on public.%1$s
        for select to authenticated using (true);
    $f$, t);

    execute format($f$
      create policy "insert_all_%1$s" on public.%1$s
        for insert to authenticated with check (true);
    $f$, t);

    execute format($f$
      create policy "update_all_%1$s" on public.%1$s
        for update to authenticated using (true) with check (true);
    $f$, t);

    execute format($f$
      create policy "delete_all_%1$s" on public.%1$s
        for delete to authenticated using (true);
    $f$, t);
  end loop;
end $$;


-- =============================================================================
--  PROFILES
--  Everyone can see the team directory. You may only write your own row.
-- =============================================================================
create policy "read_all_profiles" on public.profiles
  for select to authenticated
  using (true);

-- The signup trigger inserts profiles with SECURITY DEFINER, but we still allow
-- a self-insert so a user whose profile row is somehow missing can heal it.
create policy "insert_all_profiles" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "update_all_profiles" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Deleting a profile happens via auth.users cascade, not from the client.
create policy "delete_all_profiles" on public.profiles
  for delete to authenticated
  using (id = auth.uid());


-- =============================================================================
--  ACTIVITIES  —  append-only audit log
--  Readable by all, insertable by all (the triggers run as the caller),
--  never updatable, never deletable from the client.
-- =============================================================================
create policy "read_all_activities" on public.activities
  for select to authenticated
  using (true);

create policy "insert_all_activities" on public.activities
  for insert to authenticated
  with check (true);

-- Intentionally no UPDATE / DELETE policy: the log is immutable.
-- (The prune trigger runs server-side and bypasses RLS as table owner.)


-- =============================================================================
--  NOTIFICATIONS
--  A notification is visible when it is addressed to you or broadcast to the
--  whole workspace. You may only modify rows you can see, which is what makes
--  "mark as read" work without letting you touch someone else's inbox.
-- =============================================================================
create policy "read_all_notifications" on public.notifications
  for select to authenticated
  using (recipient_id is null or recipient_id = auth.uid());

create policy "insert_all_notifications" on public.notifications
  for insert to authenticated
  with check (true);

create policy "update_all_notifications" on public.notifications
  for update to authenticated
  using (recipient_id is null or recipient_id = auth.uid())
  with check (recipient_id is null or recipient_id = auth.uid());

create policy "delete_all_notifications" on public.notifications
  for delete to authenticated
  using (recipient_id = auth.uid());


-- =============================================================================
--  SETTINGS
--  key = 'workspace'  →  shared company configuration, everyone may edit.
--  key = '<user uuid>' →  that person's private preferences.
-- =============================================================================
create policy "read_all_settings" on public.settings
  for select to authenticated
  using (key = 'workspace' or key = auth.uid()::text);

create policy "insert_all_settings" on public.settings
  for insert to authenticated
  with check (key = 'workspace' or key = auth.uid()::text);

create policy "update_all_settings" on public.settings
  for update to authenticated
  using (key = 'workspace' or key = auth.uid()::text)
  with check (key = 'workspace' or key = auth.uid()::text);

create policy "delete_all_settings" on public.settings
  for delete to authenticated
  using (key = auth.uid()::text);


-- =============================================================================
--  GRANTS
--  RLS filters rows; grants decide whether the role may touch the table at all.
-- =============================================================================
grant usage on schema public to authenticated;
grant all on all tables    in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant all on all functions in schema public to authenticated;

-- Anonymous visitors get nothing. Every page behind /dashboard requires a
-- session, and auth.js redirects to login.html when there isn't one.
revoke all on all tables in schema public from anon;

-- Views inherit the RLS of their underlying tables (security_invoker),
-- so client_stats / monthly_finance are safe to expose.
alter view public.client_stats    set (security_invoker = on);
alter view public.monthly_finance set (security_invoker = on);
grant select on public.client_stats, public.monthly_finance to authenticated;


-- ==========================================================================
--  PART 4 - STORAGE BUCKETS AND POLICIES
-- ==========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
--  1. CREATE BUCKETS
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',      'avatars',      true,   2 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  ('client-logos', 'client-logos', true,   2 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  ('company',      'company',      true,   2 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('project-files', 'project-files', false, 25 * 1024 * 1024, null)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ─────────────────────────────────────────────────────────────────────────────
--  2. RESET POLICIES  (so this file can be re-run safely)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "public_read_media"        on storage.objects;
drop policy if exists "auth_upload_media"        on storage.objects;
drop policy if exists "auth_update_media"        on storage.objects;
drop policy if exists "auth_delete_media"        on storage.objects;
drop policy if exists "auth_read_project_files"  on storage.objects;
drop policy if exists "auth_write_project_files" on storage.objects;
drop policy if exists "auth_update_project_files" on storage.objects;
drop policy if exists "auth_delete_project_files" on storage.objects;
drop policy if exists "avatars_own_folder_write" on storage.objects;


-- ─────────────────────────────────────────────────────────────────────────────
--  3. PUBLIC IMAGE BUCKETS  (avatars, client-logos, company)
--     Anyone may read (so <img> tags resolve).
--     Only signed-in colleagues may write.
-- ─────────────────────────────────────────────────────────────────────────────
create policy "public_read_media" on storage.objects
  for select
  using (bucket_id in ('avatars', 'client-logos', 'company'));

create policy "auth_upload_media" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('avatars', 'client-logos', 'company'));

create policy "auth_update_media" on storage.objects
  for update to authenticated
  using      (bucket_id in ('avatars', 'client-logos', 'company'))
  with check (bucket_id in ('avatars', 'client-logos', 'company'));

create policy "auth_delete_media" on storage.objects
  for delete to authenticated
  using (bucket_id in ('avatars', 'client-logos', 'company'));


-- ─────────────────────────────────────────────────────────────────────────────
--  4. PRIVATE PROJECT FILES
--     Shared workspace: every authenticated colleague has full access.
--     Objects are stored as  project-files/<project_id>/<timestamp>-<name>
-- ─────────────────────────────────────────────────────────────────────────────
create policy "auth_read_project_files" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files');

create policy "auth_write_project_files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files');

create policy "auth_update_project_files" on storage.objects
  for update to authenticated
  using      (bucket_id = 'project-files')
  with check (bucket_id = 'project-files');

create policy "auth_delete_project_files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files');


-- ─────────────────────────────────────────────────────────────────────────────
--  5. HOUSEKEEPING
--     When an attachment row is removed we also drop the underlying object so
--     storage does not fill up with orphans.
--     (Runs as SECURITY DEFINER because storage.objects is owned by supabase.)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_storage_object()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects
   where bucket_id = old.bucket and name = old.path;
  return old;
exception when others then
  -- Never block the metadata delete because of a storage hiccup.
  return old;
end;
$$;

drop trigger if exists trg_attachment_cleanup on public.attachments;
create trigger trg_attachment_cleanup
  after delete on public.attachments
  for each row execute function public.delete_storage_object();


-- ==========================================================================
--  DONE - the database is ready.
--  Next: paste your Project URL + anon key into supabase.js
-- ==========================================================================
