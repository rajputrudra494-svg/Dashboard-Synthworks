/* =============================================================================
   SynthWorks — supabase.js
   Creates and exports the single Supabase client used by the whole app.

   ╔═══════════════════════════════════════════════════════════════════════════╗
   ║  CREDENTIALS                                                              ║
   ║                                                                           ║
   ║  Supabase Dashboard → your project → Settings → API                       ║
   ║    • "Project URL"                        →  SUPABASE_URL                 ║
   ║    • "Project API keys" → anon / public   →  SUPABASE_ANON_KEY            ║
   ║                                                                           ║
   ║  The anon key is designed to be public — it is safe in front-end code     ║
   ║  BECAUSE Row Level Security (setup.sql) is what actually guards your      ║
   ║  data. Never put the `service_role` key in this file: it bypasses every   ║
   ║  policy and would expose the whole database to anyone viewing source.     ║
   ╚═══════════════════════════════════════════════════════════════════════════╝
   ========================================================================== */

const SUPABASE_URL      = 'https://mbbenaoazadbocgmgwby.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iYmVuYW9hemFkYm9jZ21nd2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NTk0NjQsImV4cCI6MjEwMTIzNTQ2NH0.Z0st2mdOJQm6ClCQvLfLfTmvI59ysp-NltqGgMDaNXo';

/* -----------------------------------------------------------------------------
   Deploying to Vercel / Netlify?
   You can keep this file untouched and inject the values at build time instead
   by defining window.__SYNTHWORKS_ENV__ before this module loads (see README →
   "Environment variables"). Anything found there wins over the constants above.
   -------------------------------------------------------------------------- */
const injected = (typeof window !== 'undefined' && window.__SYNTHWORKS_ENV__) || {};

export const CONFIG = {
  url:     injected.SUPABASE_URL     || SUPABASE_URL,
  anonKey: injected.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY,
};

/** True once real credentials have been supplied. */
export const isConfigured =
  Boolean(CONFIG.url) &&
  Boolean(CONFIG.anonKey) &&
  !CONFIG.url.startsWith('YOUR_') &&
  !CONFIG.anonKey.startsWith('YOUR_');

/* -----------------------------------------------------------------------------
   Client
   The supabase-js UMD bundle is loaded from a <script> tag in every HTML page,
   which puts the factory on window.supabase. We create exactly one client and
   share it across every module so there is a single auth session and a single
   realtime websocket.
   -------------------------------------------------------------------------- */
function createClient() {
  if (!window.supabase?.createClient) {
    console.error(
      '[SynthWorks] supabase-js did not load. Check the <script> tag in your HTML ' +
      'and your network connection.'
    );
    return null;
  }

  if (!isConfigured) {
    console.warn(
      '%c[SynthWorks] Supabase is not configured yet.',
      'color:#facc15;font-weight:700',
      '\nOpen supabase.js and paste your Project URL + anon key.',
    );
    // Returning null lets every caller fail loudly but predictably; auth.js
    // turns this into a friendly on-screen setup notice.
    return null;
  }

  return window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
    auth: {
      // Session survives refreshes and browser restarts ("Remember me" is
      // implemented on top of this in auth.js).
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'synthworks.auth',
      flowType: 'pkce',
    },
    realtime: {
      params: {
        // Ceiling on broadcast throughput — plenty for an internal workspace
        // and keeps the socket from flooding on bulk imports.
        eventsPerSecond: 20,
      },
    },
    global: {
      headers: { 'x-application-name': 'synthworks-dashboard' },
    },
    db: { schema: 'public' },
  });
}

/** The shared Supabase client. `null` until credentials are filled in. */
export const sb = createClient();

/* -----------------------------------------------------------------------------
   Small helpers every data module reuses.
   -------------------------------------------------------------------------- */

/**
 * Unwraps a Supabase response, throwing on error so callers can use try/catch
 * instead of checking `.error` at every call site.
 * @template T
 * @param {{ data: T, error: any }} res
 * @returns {T}
 */
export function unwrap(res) {
  if (res.error) {
    const err = new Error(res.error.message || 'Request failed');
    err.code = res.error.code;
    err.details = res.error.details;
    err.hint = res.error.hint;
    throw err;
  }
  return res.data;
}

/**
 * Turns a Supabase/Postgres error into something worth showing a human.
 * @param {any} error
 * @returns {string}
 */
export function friendlyError(error) {
  if (!error) return 'Something went wrong.';
  const msg = String(error.message || error);

  const map = {
    '23505': 'That record already exists.',
    '23503': 'This item is still linked to something else — remove the link first.',
    '23514': 'One of the values is out of range.',
    '42501': 'You do not have permission to do that.',
    'PGRST301': 'Your session expired. Please sign in again.',
    // The project is reachable and the key is valid, but the schema was never
    // created — by far the most common first-run mistake.
    'PGRST205': 'The database tables do not exist yet. Run setup.sql in the Supabase SQL Editor.',
  };
  if (error.code && map[error.code]) return map[error.code];

  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network unavailable. Check your connection.';
  if (/Invalid login credentials/i.test(msg))    return 'That email and password combination is incorrect.';
  if (/Email not confirmed/i.test(msg))          return 'Please confirm your email address first.';
  if (/User already registered/i.test(msg))      return 'An account with that email already exists.';
  if (/rate limit/i.test(msg))                   return 'Too many attempts. Please wait a moment.';
  if (/JWT expired/i.test(msg))                  return 'Your session expired. Please sign in again.';

  return msg;
}

/** Public URL for an object in a public bucket. */
export function publicUrl(bucket, path) {
  if (!sb || !path) return null;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Time-limited URL for an object in a private bucket (default 1 hour). */
export async function signedUrl(bucket, path, expiresIn = 3600) {
  if (!sb || !path) return null;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

export default sb;
