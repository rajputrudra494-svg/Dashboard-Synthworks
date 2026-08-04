# SynthWorks — Internal Company Dashboard

A production-grade internal operating system for an agency: clients, projects,
tasks, finance, calendar, team and an immutable activity log — all in **one
shared workspace that updates for everyone in realtime**.

Built with **handwritten HTML, CSS and ES modules** on top of **Supabase**.
No React, no Vue, no Bootstrap, no Tailwind, no build step, no folders.

---

## Table of contents

1. [What you need to give me](#what-you-need-to-give-me)
2. [Quick start](#quick-start)
3. [What you get](#what-you-get)
4. [Project structure](#project-structure)
5. [Supabase setup](#supabase-setup)
6. [Running locally](#running-locally)
7. [Environment variables](#environment-variables)
8. [Deploying to Vercel](#deploying-to-vercel)
9. [Architecture](#architecture)
10. [Security model](#security-model)
11. [Keyboard shortcuts](#keyboard-shortcuts)
12. [Troubleshooting](#troubleshooting)
13. [Future improvements](#future-improvements)

---

## What you need to give me

Exactly **two values**. Both come from one screen:

> Supabase Dashboard → your project → **Settings → API**

| # | What to copy | Looks like | Goes into |
| - | --- | --- | --- |
| 1 | **Project URL** | `https://abcdefghijklmnop.supabase.co` | `SUPABASE_URL` |
| 2 | **Project API keys → `anon` `public`** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | `SUPABASE_ANON_KEY` |

Both go into **`supabase.js`**, lines 24–25:

```js
const SUPABASE_URL      = 'https://abcdefghijklmnop.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

Save, reload the page, done. There is nothing else to configure.

### ⚠️ Do NOT use the `service_role` key

On that same Supabase page you will also see a **`service_role`** key marked
*secret*. It **bypasses every security policy**. Anyone who opens your site
could read and delete your entire database with it.

- ✅ `anon` / `public` key — safe in the browser. It is *designed* to be public;
  Row Level Security is what actually protects your data.
- ❌ `service_role` key — server-side only. Never in this app, never in a repo,
  never pasted into a chat.

---

## Quick start

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. **SQL Editor → New query** → paste the whole of **`setup.sql`** → **RUN**.
   That single file builds every table, index, trigger, policy and storage bucket.
3. **Settings → API** → paste your two values into `supabase.js` (see above).
4. Serve the folder over HTTP (see [Running locally](#running-locally)).
5. Open `login.html`, create an account, and you're in.

If you skip step 3, every page shows a setup dialog with these instructions and
a **Copy setup.sql** button — nothing silently breaks.

---

## What you get

| Module | Highlights |
| --- | --- |
| **Dashboard** | 14 live KPI tiles, 6 charts, project timeline, upcoming work, activity feed |
| **Clients** | CRM with table + card views, photos, tags, per-client revenue rollups, detail drawer |
| **Projects** | Board / table / gantt views, budgets, milestones, members, private file uploads |
| **Tasks** | 4-column kanban with drag-and-drop, comments, labels, keyboard reordering |
| **Finance** | Income, expenses, margin, invoice health, date filtering, CSV **and** PDF export |
| **Calendar** | Month grid merging events, project deadlines and milestones; agenda side panel |
| **Team** | Live presence, workload chart, completion leaderboard, member profiles |
| **Activity** | Append-only audit log written by database triggers, with a 12-week heatmap |
| **Analytics** | Growth rates, year-over-year, throughput, radar, exportable PDF report |
| **Settings** | Workspace config, profile, avatar upload, theme, notifications, password, exports |

Plus, everywhere: command palette (`Ctrl`/`Cmd` + `K`), global search, quick add,
toasts, dark **and** light themes, and a layout verified to have **zero
horizontal overflow from 320 px to 4K**.

### Design direction: minimal

Flat surfaces, hairline borders, one accent colour used sparingly, and motion
only where it carries meaning — something arriving, a value changing, a click
landing, a milestone completing.

Removed deliberately: the animated aurora background, floating glow blobs, the
particle canvas, the cursor glow, the mouse spotlight, 3D card tilt, magnetic
buttons, animated gradient borders, the scrolling marquee and every
`backdrop-filter`. Together they were the most expensive thing on the page — a
full-screen canvas plus two `pointermove` handlers running every frame, and 32
blur surfaces to composite — and the least useful. The result is a UI that
loads faster, scrolls smoothly on a phone, and puts the data first.

---

## Project structure

Every file sits in one flat folder — no `assets/`, no subdirectories.

```
index.html        Public landing page          theme.css         design tokens
login.html        Sign in / up / reset         base.css          reset, typography
dashboard.html    Overview                     layout.css        shell, topbar, modals
clients.html      CRM                          sidebar.css       navigation
projects.html     Project management           cards.css         cards, kanban, feed
tasks.html        Kanban board                 tables.css        tables + mobile cards
finance.html      Money                        forms.css         inputs, auth, settings
calendar.html     Scheduling                   charts.css        charts, calendar, gantt
team.html         People                       animations.css    keyframes, toasts
activity.html     Audit log                    landing.css       index.html only
analytics.html    Trends                       responsive.css    8 breakpoints (last)
settings.html     Configuration

setup.sql         ← the entire database, one file, run once
supabase.js       ← YOUR TWO KEYS GO HERE

theme-init.js     synchronous, prevents theme flash
utils.js          DOM, dates, money, storage, CSV/PDF export
store.js          data layer + realtime + derived metrics
auth.js           sessions, route guards, presence, setup notice
shell.js          sidebar, top bar, palette, theme, shortcuts
ui.js             shared render helpers (stat tiles, badges, avatars)
table.js          reusable search/sort/filter/paginate table
modal.js          modals, drawers, declarative form builder
charts.js         theme-aware Chart.js presets
notifications.js  toasts, confirm dialogs, celebrations
animations.js     loader, aurora, particles, counters, confetti
<page>.js         one controller per page

favicon.svg  logo-mark.svg  vercel.json  .env.example  .gitignore  README.md
```

> **Why the extra shared modules?** `store.js`, `shell.js`, `ui.js`, `table.js`,
> `modal.js` and `charts.js` exist specifically to satisfy the *"no duplicate
> code"* requirement. Without them the sidebar, the data tables and every
> create/edit form would be copy-pasted twelve times.

---

## Supabase setup

### 1. Create the project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name it `synthworks`, set a strong database password, save it somewhere safe.
3. Pick the region closest to your team — realtime latency depends on it.
4. Wait ~2 minutes for provisioning.

### 2. Database — one file, one run

**SQL Editor → New query** → paste all of `setup.sql` → **RUN**.

It is idempotent, so running it again later is safe. It creates:

| Part | Contents |
| --- | --- |
| 1 | 13 tables, 8 enums, foreign keys, 29 indexes, 10 functions, 8 triggers, 2 views |
| 2 | Realtime publication + `REPLICA IDENTITY FULL` on every table |
| 3 | Row Level Security policies and role grants |
| 4 | 4 storage buckets and their access policies |

**The triggers are what make this feel alive:**

- `handle_new_user` — creates a `profiles` row automatically on sign-up.
- `log_activity` — writes a human-readable audit line for every insert, update
  and delete. This is why the Activity page records changes even if you edit a
  row directly in the Supabase table editor.
- `recalc_project_progress` — recomputes a project's `progress` from its task
  board and flips it to *completed* at 100%.
- `recalc_project_spent` — keeps `projects.spent` in sync with expenses.
- `sync_task_completed_at` — stamps/clears `completed_at` as cards move.
- `prune_activities` — caps the log at 5,000 rows so it never grows unbounded.

**Verify:**

```sql
select count(*) from information_schema.tables where table_schema = 'public';
-- expect 15 (13 tables + 2 views)

select tablename from pg_publication_tables where pubname = 'supabase_realtime';
-- expect all 13 tables
```

### 3. Authentication

**Authentication → Providers → Email**

| Setting | Value | Why |
| --- | --- | --- |
| Enable Email provider | ✅ On | The app uses email + password |
| Confirm email | Your call | **Off** = instant access, good for a small internal team. **On** = users click a link first; the app handles both. |
| Allow new users to sign up | ✅ On to start | Turn **off** later so only admins add colleagues (Authentication → Users) |
| Minimum password length | 8 | Matches the client-side validation |

**Authentication → URL Configuration**

- **Site URL** — `http://localhost:5173` while developing, your real domain in production.
- **Redirect URLs** — add every origin you will use:
  ```
  http://localhost:5173/**
  http://127.0.0.1:5173/**
  https://your-app.vercel.app/**
  ```
  Password-reset and confirmation links will not work without these.

### 4. Storage

`setup.sql` creates all four buckets:

| Bucket | Public | Limit | Used by |
| --- | --- | --- | --- |
| `avatars` | ✅ | 2 MB | Profile photos |
| `client-logos` | ✅ | 2 MB | Client logos |
| `company` | ✅ | 2 MB | Workspace branding |
| `project-files` | 🔒 | 25 MB | Deliverables, briefs, contracts |

"Public" means the object URL is readable without a token — that is what makes
`<img src>` work. Writing always requires a session. `project-files` stays
private and is served through short-lived signed URLs.

### 5. Realtime

Already handled by `setup.sql`. To confirm: **Database → Replication →
`supabase_realtime`** should list all 13 tables.

The app opens **one** websocket for the whole workspace rather than one per
table. The green **Live** pill in each page header shows the connection state.

**Test it:** open the dashboard in two browsers signed in as two different
people. Create a client in one — it appears in the other within a second, with a
toast, no refresh.

---

## Running locally

The app uses ES modules, so it **must** be served over HTTP. Opening
`index.html` directly from the filesystem will fail with a CORS error.

```bash
npx serve . -l 5173
```

```bash
python -m http.server 5173
```

```bash
php -S localhost:5173
```

Then open <http://localhost:5173>.

---

## Environment variables

The app is deliberately buildless, so a `.env` file cannot be read by the
browser. Two supported approaches:

### Option A — paste directly (simplest)

Edit `supabase.js`. Done. Fine for a private repo.

### Option B — inject at build time (public repos / CI)

`supabase.js` prefers `window.__SYNTHWORKS_ENV__` over its own constants. Set
the two variables in your host's dashboard, then generate a tiny file at build:

```bash
node -e "require('fs').writeFileSync('env.js',
  'window.__SYNTHWORKS_ENV__=' + JSON.stringify({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  }) + ';')"
```

Then add to every HTML page, **above** the module script:

```html
<script src="env.js"></script>
```

`env.js` is already in `.gitignore`. See `.env.example` for the annotated list.

---

## Deploying to Vercel

1. Push to GitHub.
2. [vercel.com/new](https://vercel.com/new) → import the repository.
3. Framework preset: **Other**. Build command: **empty**. Output directory: `.`
4. If using Option B, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` under
   **Settings → Environment Variables**.
5. **Deploy.**

Or via CLI:

```bash
npx vercel --prod
```

`vercel.json` is included with caching and security headers already configured.

**Afterwards:** add your production domain to Supabase → **Authentication → URL
Configuration**, or password resets will silently fail.

The same steps work on Netlify, Cloudflare Pages, GitHub Pages or any static host.

---

## Architecture

### Data flow

```
  Postgres  ──trigger──▶  activities
     │
     │ realtime (one websocket, all 13 tables)
     ▼
  store.js  ──▶  in-memory cache per table
     │              └──▶ derived metrics (revenue, stats, series)
     │
     ├──▶ store.on('clients:change', …)
     ▼
  page controller  ──▶  ui.js / table.js / charts.js  ──▶  DOM
```

Pages never call Supabase directly for CRUD. They go through a `Collection`,
which updates the cache, writes to Postgres and emits an event. The realtime
echo of your own write is de-duplicated by comparing `updated_at`, so you never
get a double render.

### Key decisions

**One websocket, not thirteen.** Cheaper, and no cross-table race.

**Optimistic kanban moves.** Dragging repaints immediately and reverts if the
write fails — the board never feels laggy.

**Server-side progress.** A trigger derives `projects.progress` from the task
board, so the number on screen is always real.

**Print-to-PDF instead of a PDF library.** `exportPDF()` opens a styled document
and calls `print()`. Zero bundle weight, always matches what the user sees.

**Declarative forms.** Every create/edit dialog is a field array passed to
`formModal()`. Twelve CRUD surfaces, one form renderer.

**Theme via CSS variables only.** No component hardcodes a colour. Switching
themes retints live Chart.js instances rather than rebuilding them.

### Performance

- Realtime bursts are debounced (~200 ms) so a bulk import repaints once.
- Charts are registered and resized, never recreated, on theme or layout change.
- Particles, cursor glow and tilt are skipped on coarse pointers, low core
  counts, `prefers-reduced-motion` and `prefers-reduced-data`.
- The particle canvas pauses when the tab is hidden.
- Quick Add imports page modules on demand (`await import(…)`).
- Scroll reveals and counters have guaranteed fallbacks, so content is never
  left invisible or stuck at zero if an observer callback is deferred.

### Accessibility

Semantic landmarks, skip links, `aria-*` on every control, focus trapping in
modals and drawers, visible focus rings, `aria-sort` on sortable headers,
arrow-key card movement on the kanban (a real alternative to dragging), 44 px
touch targets on coarse pointers, and full `prefers-contrast` /
`prefers-reduced-motion` support.

---

## Security model

SynthWorks is an internal tool: **every authenticated colleague shares one
workspace**. That is deliberate and enforced in the database.

| Table | Read | Write |
| --- | --- | --- |
| clients, projects, tasks, comments, members, milestones, transactions, events, attachments | all authenticated | all authenticated |
| `profiles` | all authenticated | **your own row only** |
| `activities` | all authenticated | insert only — **no UPDATE or DELETE policy exists** |
| `notifications` | yours + broadcasts | you can only mark your own as read |
| `settings` | `workspace` row + your own | same |

Anonymous access is revoked entirely. Every page behind the login wall calls
`requireAuth()`, which redirects to `login.html` and remembers where you were
headed.

**The anon key is public by design.** It identifies the project, not the user.
RLS is what protects the data — which is why `setup.sql` must be run in full and
RLS never disabled.

---

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl` / `Cmd` + `K` | Command palette + global search |
| `/` | Same, from anywhere |
| `Shift` + `D` | Toggle light / dark |
| `G` then `D` `C` `P` `T` `F` `L` `M` `A` `S` | Go to Dashboard, Clients, Projects, Tasks, Finance, Calendar, Team, Analytics, Settings |
| `←` / `→` | Move a focused kanban card between columns |
| `Enter` | Open the focused card / calendar day |
| `Esc` | Close any modal, drawer or palette |

---

## Troubleshooting

**A setup dialog appears on every page.**
Credentials have not been pasted into `supabase.js`. The dialog *is* the
instruction — and it has a **Copy setup.sql** button for the database step.

**`Failed to load module script` / CORS errors.**
You opened the file directly. Serve over HTTP.

**Sign-up works but no profile is created.**
The `on_auth_user_created` trigger did not install. Re-run `setup.sql`. The app
also self-heals: `loadProfile()` inserts the missing row on next sign-in.

**Changes do not appear in the other browser.**
Check the **Live** pill. If it says *Offline*, confirm all 13 tables are in the
publication (**Database → Replication**) and re-run `setup.sql`.

**Deletes do not sync.**
`REPLICA IDENTITY FULL` is missing. Re-run `setup.sql`.

**`new row violates row-level security policy`.**
`setup.sql` was not run in full, or you are trying to edit someone else's
profile row — which is intentionally blocked.

**Password reset emails never arrive.**
Add your origin to **Authentication → URL Configuration → Redirect URLs**. Also
check spam; Supabase's built-in SMTP is rate-limited, so configure custom SMTP
for real use.

**File upload fails with a 403.**
`setup.sql` was not run, or the file exceeds the bucket limit (2 MB images,
25 MB project files).

**Charts are blank.**
Chart.js failed to load from CDN, or the canvas has no height. Check the console.

**Deployed site shows `ERR_TOO_MANY_REDIRECTS`.**
Something in your host config is rewriting `.html` URLs. On Vercel this is
`cleanUrls: true` fighting the `/login` → `/login.html` redirect: clean URLs
send `/login.html` → `/login`, and the redirect sends it straight back. The
shipped `vercel.json` has `cleanUrls` off for exactly this reason — do not
re-enable it without also deleting the redirects.

**A fix you deployed did not reach the browser.**
Filenames here are not content-hashed, so a long-lived `immutable` cache pins
visitors to whatever version they first loaded, forever. The shipped
`vercel.json` uses `max-age=0, must-revalidate`, which costs one cheap 304 per
file and always serves the current build. If you change that, hash your
filenames first.

**Deployed site loads but sign-in does nothing.**
Add your production domain to Supabase → **Authentication → URL Configuration**
(both **Site URL** and **Redirect URLs**, e.g. `https://your-app.vercel.app/**`).
Without it, Supabase refuses the redirect and the flow stalls silently.

---

## Future improvements

- **Role enforcement.** `profiles.role` exists but is not yet used in policies.
  Restricting deletes to `admin`/`owner` is a one-policy change per table.
- **Time tracking** — a `time_entries` table plus a timer on task cards.
- **Recurring invoices** and overdue reminders via a scheduled Edge Function.
- **Email notifications** through Edge Functions + Resend, driven by the
  existing `notifications` table.
- **Task dependencies** and a critical-path view on the gantt.
- **Client portal** — a read-only, tokenised view of one client's projects.
- **Full-text search** using `pg_trgm` once the workspace outgrows client-side
  filtering.
- **Offline support** with a service worker and an IndexedDB write queue.
- **Cursor presence** via Realtime broadcast, so you see a colleague's pointer.
- **Automated tests** — Playwright for critical flows, pgTAP for the RLS policies.

---

## License

Internal project. Use it however your team needs.

**Built by hand — no framework, no build step, no compromises.**
