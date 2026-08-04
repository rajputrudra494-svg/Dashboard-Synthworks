/* =============================================================================
   SynthWorks — auth.js
   Authentication, session persistence, route protection and the current-user
   profile that every other module reads.
   ========================================================================== */

import { sb, isConfigured, friendlyError, unwrap } from './supabase.js';
import { storage, el, icons } from './utils.js';
import { toast } from './notifications.js';

const LOGIN_PAGE = 'login.html';
const HOME_PAGE  = 'dashboard.html';

/* Cached across the page's lifetime so components can read the user
   synchronously after `requireAuth()` has resolved once. */
let currentSession = null;
let currentProfile = null;
let heartbeatTimer = null;

export const auth = {
  get session() { return currentSession; },
  get user()    { return currentSession?.user || null; },
  get profile() { return currentProfile; },
  get userId()  { return currentSession?.user?.id || null; },
  get displayName() {
    return currentProfile?.full_name
      || currentSession?.user?.user_metadata?.full_name
      || currentSession?.user?.email?.split('@')[0]
      || 'Member';
  },
};

/* =============================================================================
   SETUP GUARD
   If credentials have not been pasted into supabase.js yet, every page shows a
   single clear instruction instead of a wall of console errors.
   ========================================================================== */

/**
 * First-run guidance.
 * @param {'credentials'|'schema'} [reason='credentials']
 *   'credentials' — supabase.js still holds the placeholders.
 *   'schema'      — the project is reachable but setup.sql has not been run.
 */
export function showSetupNotice(reason = 'credentials') {
  if (document.querySelector('#setupNotice')) return;

  const notice = el('div', {
    id: 'setupNotice',
    class: 'modal-root is-open',
    role: 'dialog',
    'aria-modal': 'true',
  });

  const schemaOnly = reason === 'schema';

  notice.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span class="stat-icon is-warning"><i data-lucide="${schemaOnly ? 'database' : 'plug-zap'}"></i></span>
        <div>
          <h3>${schemaOnly ? 'One step left: create the tables' : 'Connect your Supabase project'}</h3>
          <p>${schemaOnly
            ? 'Your project is connected and your key works — the database is just empty.'
            : 'SynthWorks needs a backend before it can sign you in. Three steps.'}</p>
        </div>
      </div>

      <div class="modal-body">
        ${schemaOnly ? `
          <div class="setup-ok">
            <i data-lucide="check-circle-2"></i>
            <span>Connected to your project. Authentication is responding.</span>
          </div>` : ''}

        <ol class="setup-steps">
          ${schemaOnly ? '' : `
          <li>
            <b>Create a project</b>
            <span>Free tier is fine — <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com/dashboard</a></span>
          </li>`}
          <li>
            <b>Run the database setup</b>
            <span>Open <b>SQL Editor → New query</b> in Supabase, paste the whole script,
                  press <b>RUN</b>. It builds all 13 tables, every policy, trigger and
                  storage bucket in one go.</span>
            <button class="btn btn--sm btn--primary mt-2" type="button" data-setup="copy-sql">
              <i data-lucide="clipboard-copy"></i> Copy setup.sql
            </button>
          </li>
          ${schemaOnly ? `
          <li>
            <b>Reload this page</b>
            <span>That's it — the workspace will come up empty and ready to use.</span>
          </li>` : `
          <li>
            <b>Paste your two keys</b>
            <span>In Supabase go to <b>Settings → API</b>, then put these into
                  <code>supabase.js</code>:</span>
            <ul class="setup-keys">
              <li><code>Project URL</code> → <code>SUPABASE_URL</code></li>
              <li><code>anon / public</code> key → <code>SUPABASE_ANON_KEY</code></li>
            </ul>
            <span class="hint">Never paste the <code>service_role</code> key — it bypasses all security.</span>
          </li>`}
        </ol>
      </div>

      <div class="modal-foot">
        <a class="btn btn--secondary" href="https://supabase.com/dashboard" target="_blank" rel="noopener">
          Open SQL Editor <i data-lucide="external-link"></i>
        </a>
        <button class="btn btn--primary" type="button" data-setup="reload">
          <i data-lucide="refresh-cw"></i> Reload
        </button>
      </div>
    </div>`;

  document.body.append(notice);
  // Render icons across the whole document, not just the dialog: boot() exits
  // before initShell() runs in this state, so the page behind would otherwise
  // be left with unrendered <i data-lucide> placeholders.
  icons();
  document.querySelector('#pageLoader')?.remove();

  // Hand the user the SQL directly rather than making them go find a file.
  notice.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-setup]')?.dataset.setup;
    if (!action) return;

    if (action === 'reload') { location.reload(); return; }

    if (action === 'copy-sql') {
      const button = event.target.closest('[data-setup]');
      const original = button.innerHTML;
      try {
        const sql = await (await fetch('setup.sql')).text();
        const { copyText } = await import('./utils.js');
        const ok = await copyText(sql);
        button.innerHTML = ok
          ? '<i data-lucide="check"></i> Copied — now paste it into Supabase'
          : '<i data-lucide="x"></i> Copy failed — open setup.sql manually';
      } catch {
        button.innerHTML = '<i data-lucide="x"></i> Could not read setup.sql';
      }
      icons(button);
      setTimeout(() => { button.innerHTML = original; icons(button); }, 4000);
    }
  });
}

/* =============================================================================
   SCHEMA CHECK
   ========================================================================== */

let schemaOk = null;

/**
 * One cheap probe to confirm setup.sql has been run.
 * PostgREST answers PGRST205 ("Could not find the table") when the schema is
 * missing, which is otherwise indistinguishable from a permissions problem.
 * @returns {Promise<boolean>}
 */
export async function schemaExists() {
  if (schemaOk !== null) return schemaOk;
  if (!sb) return false;

  const { error } = await sb.from('settings').select('key').limit(1);
  // A row-level-security refusal still proves the table is there.
  schemaOk = !error || error.code !== 'PGRST205';
  return schemaOk;
}

/* =============================================================================
   SESSION
   ========================================================================== */

/** Reads the current session from Supabase (network-free after the first call). */
export async function getSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  currentSession = data.session || null;
  return currentSession;
}

/** Loads (and caches) the signed-in user's profile row. */
export async function loadProfile(force = false) {
  if (!sb || !currentSession) return null;
  if (currentProfile && !force) return currentProfile;

  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentSession.user.id)
    .maybeSingle();

  if (error) {
    console.error('[auth] profile load failed', error);
    return null;
  }

  // The signup trigger normally creates this row. If it is missing (e.g. the
  // user existed before the trigger was installed), heal it here.
  if (!data) {
    const meta = currentSession.user.user_metadata || {};
    const { data: created } = await sb
      .from('profiles')
      .insert({
        id: currentSession.user.id,
        email: currentSession.user.email,
        full_name: meta.full_name || currentSession.user.email.split('@')[0],
        job_title: meta.job_title || 'Team Member',
      })
      .select()
      .single();
    currentProfile = created || null;
  } else {
    currentProfile = data;
  }

  return currentProfile;
}

/**
 * Route guard for every page behind the login wall.
 * Redirects to login.html when there is no session.
 * @returns {Promise<{session: Object, profile: Object}|null>}
 */
export async function requireAuth() {
  if (!isConfigured || !sb) {
    showSetupNotice('credentials');
    return null;
  }

  // Credentials are in place — make sure the schema actually exists before we
  // send the user round a redirect loop or a wall of failed queries.
  if (!await schemaExists()) {
    showSetupNotice('schema');
    return null;
  }

  const session = await getSession();
  if (!session) {
    // Remember where they were headed so login can bounce them back.
    const target = location.pathname.split('/').pop();
    if (target && target !== LOGIN_PAGE && target !== 'index.html') {
      storage.set('redirect', target + location.search);
    }
    location.replace(LOGIN_PAGE);
    return null;
  }

  const profile = await loadProfile();
  startPresence();
  watchAuthChanges();

  return { session, profile };
}

/** Used by login.html — bounces already-signed-in users to the dashboard. */
export async function redirectIfAuthed() {
  if (!isConfigured || !sb) { showSetupNotice('credentials'); return false; }

  // Signing up would succeed in Auth but leave the user staring at a broken
  // dashboard, so block it until the tables exist.
  if (!await schemaExists()) { showSetupNotice('schema'); return false; }

  const session = await getSession();
  if (!session) return false;

  const back = storage.get('redirect');
  storage.remove('redirect');
  location.replace(back || HOME_PAGE);
  return true;
}

/** Reacts to sign-out / token refresh happening in another tab. */
let authWatcherAttached = false;
function watchAuthChanges() {
  if (authWatcherAttached || !sb) return;
  authWatcherAttached = true;

  sb.auth.onAuthStateChange((event, session) => {
    currentSession = session;

    if (event === 'SIGNED_OUT') {
      stopPresence();
      currentProfile = null;
      if (!location.pathname.endsWith(LOGIN_PAGE)) location.replace(LOGIN_PAGE);
    }

    if (event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
      loadProfile(true);
    }
  });
}

/* =============================================================================
   SIGN IN / UP / OUT
   ========================================================================== */

/**
 * @param {string} email
 * @param {string} password
 * @param {boolean} remember  false → session is cleared when the tab closes
 */
export async function signIn(email, password, remember = true) {
  if (!sb) throw new Error('Supabase is not configured.');

  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(friendlyError(error));

  currentSession = data.session;
  storage.set('remember', Boolean(remember));
  storage.set('lastEmail', remember ? email.trim().toLowerCase() : null);

  // "Remember me" off → drop the persisted token when the tab goes away, so the
  // next visit on a shared machine starts signed out.
  if (!remember) {
    window.addEventListener('pagehide', () => {
      try { localStorage.removeItem('synthworks.auth'); } catch { /* ignore */ }
    });
  }

  await loadProfile(true);
  return data;
}

/**
 * @param {{fullName: string, email: string, password: string, jobTitle?: string}} details
 */
export async function signUp({ fullName, email, password, jobTitle = 'Team Member' }) {
  if (!sb) throw new Error('Supabase is not configured.');

  const { data, error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { full_name: fullName.trim(), job_title: jobTitle },
      emailRedirectTo: new URL(LOGIN_PAGE, location.href).href,
    },
  });
  if (error) throw new Error(friendlyError(error));

  // With "Confirm email" enabled in Supabase there is no session yet.
  const needsConfirmation = !data.session;
  if (data.session) {
    currentSession = data.session;
    await loadProfile(true);
  }

  return { ...data, needsConfirmation };
}

export async function resetPassword(email) {
  if (!sb) throw new Error('Supabase is not configured.');

  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: new URL(`${LOGIN_PAGE}?mode=recover`, location.href).href,
  });
  if (error) throw new Error(friendlyError(error));
  return true;
}

/** Used on the ?mode=recover screen after clicking the emailed link. */
export async function updatePassword(newPassword) {
  if (!sb) throw new Error('Supabase is not configured.');
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyError(error));
  return true;
}

export async function signOut() {
  if (!sb) return;
  await setOnline(false);
  stopPresence();
  storage.remove('redirect');
  await sb.auth.signOut();
  currentSession = null;
  currentProfile = null;
  location.replace(LOGIN_PAGE);
}

/* =============================================================================
   PROFILE UPDATES
   ========================================================================== */

export async function updateProfile(patch) {
  if (!sb || !currentSession) throw new Error('Not signed in.');

  const data = unwrap(await sb
    .from('profiles')
    .update(patch)
    .eq('id', currentSession.user.id)
    .select()
    .single());

  currentProfile = data;
  document.dispatchEvent(new CustomEvent('synthworks:profile', { detail: data }));
  return data;
}

/** Uploads an avatar to the public `avatars` bucket and saves the URL. */
export async function uploadAvatar(file) {
  if (!sb || !currentSession) throw new Error('Not signed in.');
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Images must be 2 MB or smaller.');

  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${currentSession.user.id}/${Date.now()}.${ext}`;

  const { error } = await sb.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw new Error(friendlyError(error));

  const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
  await updateProfile({ avatar_url: publicUrl });
  return publicUrl;
}

/* =============================================================================
   PRESENCE
   A lightweight heartbeat keeps profiles.is_online / last_seen_at fresh so the
   Team page can show who is around. Realtime broadcasts the change to everyone.
   ========================================================================== */

const HEARTBEAT_MS = 45_000;

async function setOnline(online) {
  if (!sb || !currentSession) return;
  try {
    await sb.from('profiles')
      .update({ is_online: online, last_seen_at: new Date().toISOString() })
      .eq('id', currentSession.user.id);
  } catch { /* presence is best-effort — never block the UI on it */ }
}

export function startPresence() {
  if (heartbeatTimer || !currentSession) return;

  setOnline(true);
  heartbeatTimer = setInterval(() => {
    if (document.visibilityState === 'visible') setOnline(true);
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onLeave);
}

function onVisibility() {
  setOnline(document.visibilityState === 'visible');
}

function onLeave() {
  // sendBeacon-style best effort; the row also ages out via last_seen_at.
  setOnline(false);
}

export function stopPresence() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onLeave);
}

/* =============================================================================
   WIRING HELPERS
   ========================================================================== */

/** Attaches sign-out to any element carrying [data-action="logout"]. */
export function wireLogout(root = document) {
  root.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-action="logout"]');
    if (!trigger) return;
    event.preventDefault();

    const { confirmDialog } = await import('./notifications.js');
    const ok = await confirmDialog({
      title: 'Sign out of SynthWorks?',
      message: 'You will need your email and password to get back in.',
      confirmLabel: 'Sign out',
      icon: 'log-out',
    });
    if (ok) {
      toast.info('Signing out…');
      signOut();
    }
  });
}

export default auth;
