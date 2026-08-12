/* ==========================================================================
   A small Supabase client, written against the plain HTTP API.

   Supabase is GoTrue (auth) and PostgREST (data) behind one URL, both of them
   ordinary REST, so the app talks to them with `fetch` instead of pulling in
   the official SDK. That keeps the app dependency-free and offline-cacheable:
   no CDN script to fail on a train.

   The client owns the session and refreshes the access token when it is close
   to expiring, handing the fresh one to every data call.
   ========================================================================== */

const SESSION_KEY = 'ideaInventory.session.v2';
const CONFIG_KEY = 'ideaInventory.connection.v1';

/** Thrown for anything the server rejected; `offline` marks a failed request. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = '', offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.offline = offline;
  }
}

/**
 * Is this error "your session is over", as opposed to "something went wrong"?
 *
 * It matters because the two need opposite responses: a dead session has to
 * send the person back to the sign-in screen, while anything else should keep
 * the queued changes and try again later. Getting it wrong strands the app, and
 * it is easy to get wrong: GoTrue answers a stale refresh token with **400**,
 * not 401, so a plain status check reads an ended session as a generic fault
 * and leaves the pill on "Sync issue" for ever.
 */
const SESSION_DEAD_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'session_missing',
  'invalid_grant',
  'bad_jwt',
  'no_authorization',
  'user_not_found',
  'PGRST301',          // PostgREST for "that JWT has expired"
]);

export function isSessionDead(err) {
  if (!(err instanceof ApiError) || err.offline) return false;
  if (SESSION_DEAD_CODES.has(err.code)) return true;
  // Postgres and PostgREST answer with their own codes. A row level security
  // refusal is a 403 about the row, not about who you are — signing the person
  // out over it would be the wrong move entirely.
  if (/^(PGRST|[0-9A-Z]{5}$)/.test(err.code)) return false;
  if (err.status === 401 || err.status === 403) return true;
  return /refresh token|invalid_grant|jwt (is )?expired/i.test(err.message || '');
}

/* --- Connection settings ------------------------------------------------ */

/**
 * A choice made on this device always beats the defaults committed in
 * config.js — otherwise "Change connection" and "use this device only" would
 * be undone by the defaults on the very next load.
 */
export function readConnection(defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved?.mode === 'local') return { url: '', anonKey: '', mode: 'local' };
    if (saved?.mode === 'unset') return { url: '', anonKey: '', mode: 'unset' };
    if (saved?.url && saved?.anonKey) {
      return { url: trimUrl(saved.url), anonKey: saved.anonKey.trim(), mode: 'cloud' };
    }
  } catch {}
  if (defaults?.url && defaults?.anonKey) {
    return { url: trimUrl(defaults.url), anonKey: defaults.anonKey.trim(), mode: 'cloud' };
  }
  return { url: '', anonKey: '', mode: 'unset' };
}

export function writeConnection(connection) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(connection)); } catch {}
}

export function clearConnection() {
  try { localStorage.removeItem(CONFIG_KEY); } catch {}
}

const trimUrl = (url) => String(url).trim().replace(/\/+$/, '');

/* --- Client -------------------------------------------------------------- */

export class Supabase {
  constructor({ url, anonKey }) {
    this.url = trimUrl(url || '');
    this.anonKey = (anonKey || '').trim();
    this.session = loadSession();
    this._refreshing = null;
  }

  get configured() { return !!(this.url && this.anonKey); }
  get signedIn() { return !!this.session?.refresh_token; }
  get user() { return this.session?.user || null; }

  /* --- Auth -------------------------------------------------------------- */

  /**
   * Creates the account. When the project has email confirmation switched on
   * there is no session in the reply — the caller has to tell the person to go
   * and click the link in their inbox.
   */
  async signUp(email, password) {
    const data = await this._auth('/auth/v1/signup', { email, password });
    if (data.access_token) this._store(data);
    return { needsConfirmation: !data.access_token, user: data.user || null };
  }

  /** Sends the confirmation link again (rate limited by Supabase). */
  async resendConfirmation(email) {
    await this._auth('/auth/v1/resend', { type: 'signup', email });
  }

  async signIn(email, password) {
    const data = await this._auth('/auth/v1/token?grant_type=password', { email, password });
    this._store(data);
    return this.session;
  }

  async signOut() {
    const token = this.session?.access_token;
    this.session = null;
    saveSession(null);
    if (!token) return;
    // Best effort — the tokens are already gone from this device either way.
    try {
      await fetch(`${this.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: this.anonKey, authorization: `Bearer ${token}` },
      });
    } catch {}
  }

  /**
   * Picks up a session another tab on this device wrote.
   *
   * Supabase rotates the refresh token on every use and revokes the old one,
   * so two tabs holding the same session are a trap: whichever refreshes
   * second sends a token that has already been spent, and GoTrue kills the
   * whole chain — both tabs, permanently. The session lives in localStorage,
   * which every tab can see, so the fix is simply to look before refreshing.
   *
   * Returns true when the in-memory session changed.
   */
  adoptStoredSession() {
    const stored = loadSession();
    if (!stored) {
      if (!this.session) return false;
      this.session = null;                    // another tab signed out
      return true;
    }
    if (this.session?.refresh_token === stored.refresh_token) return false;
    this.session = stored;
    return true;
  }

  /** A valid access token, refreshing first if this one is nearly out. */
  async accessToken() {
    this.adoptStoredSession();
    if (!this.session) throw new ApiError('Not signed in.', { status: 401, code: 'session_missing' });
    if (this.session.expires_at - Date.now() > 60000) return this.session.access_token;
    if (!this._refreshing) {
      this._refreshing = this._refresh().finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
  }

  /**
   * Refreshes under a lock shared by every tab on this device, so only one of
   * them ever spends the token and the others simply read the result. Browsers
   * without the Web Locks API fall back to going straight in — the recovery
   * below covers them.
   */
  _refresh() {
    const run = () => this._refreshLocked();
    return navigator.locks?.request
      ? navigator.locks.request('ideaInventory.token', run)
      : run();
  }

  async _refreshLocked() {
    // Whoever held the lock before us may have done the work already.
    this.adoptStoredSession();
    if (!this.session) throw new ApiError('Not signed in.', { status: 401, code: 'session_missing' });
    if (this.session.expires_at - Date.now() > 60000) return this.session.access_token;

    const sent = this.session.refresh_token;
    try {
      const data = await this._auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: sent });
      this._store(data);
      return this.session.access_token;
    } catch (err) {
      // Without the lock two tabs can still collide. "Already used" means some
      // other tab holds a good token and is about to write it, so give it a
      // moment to land before writing the session off.
      if (isSessionDead(err)) {
        const rescued = await waitForNewerSession(sent);
        if (rescued) {
          this.session = rescued;
          return rescued.access_token;
        }
        // Genuinely over. Drop the dead session so the app asks for a sign-in
        // rather than retrying a token that can never work again. The ideas on
        // this device are untouched and go up when they sign back in.
        this.session = null;
        saveSession(null);
      }
      throw err;
    }
  }

  async _auth(path, body) {
    const response = await request(`${this.url}${path}`, {
      method: 'POST',
      headers: { apikey: this.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response;
  }

  _store(data) {
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      user: data.user ? { id: data.user.id, email: data.user.email } : this.session?.user || null,
    };
    saveSession(this.session);
  }

  /* --- Data -------------------------------------------------------------- */

  /** Every row of `table` for this user touched after `since` (an ISO string). */
  async select(table, { since, limit = 1000 } = {}) {
    const token = await this.accessToken();
    const params = new URLSearchParams();
    params.set('select', '*');
    params.set('user_id', `eq.${this.user.id}`);
    if (since) params.set('updated_at', `gt.${since}`);
    params.set('order', 'updated_at.asc');
    params.set('limit', String(limit));

    return request(`${this.url}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: this.anonKey,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });
  }

  /** Insert-or-update by primary key. Columns left out of a row are untouched. */
  async upsert(table, rows) {
    if (!rows.length) return;
    const token = await this.accessToken();
    await request(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }, true);
  }
}

/* --- Plumbing ------------------------------------------------------------- */

async function request(url, options, expectEmpty = false) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new ApiError('Could not reach the server.', { offline: true });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let payload = {};
    try { payload = JSON.parse(text); } catch {}
    const message = payload.error_description || payload.msg || payload.message
      || payload.error || text.slice(0, 200) || `Request failed (${response.status})`;
    // Supabase moved from `error` to `error_code`; `code` is sometimes just the
    // HTTP status, so it is the last resort.
    const code = payload.error_code
      || (typeof payload.error === 'string' ? payload.error : '')
      || (typeof payload.code === 'string' ? payload.code : '');
    // The browser only logs "Failed to load resource: 400" by itself, which
    // says nothing about why. Put the reason where anyone inspecting will see it.
    console.warn('[Idea Inventory] request rejected', response.status, code || '(no code)', message, url);
    throw new ApiError(message, { status: response.status, code });
  }

  if (expectEmpty || response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Watches localStorage for a different refresh token than the one that just
 * failed — i.e. another tab winning the race and saving its reply.
 */
async function waitForNewerSession(sent, ms = 2000) {
  const until = Date.now() + ms;
  for (;;) {
    const stored = loadSession();
    // Any token other than the one that just failed is a token somebody else
    // successfully obtained — take it however long it has left to live.
    if (stored && stored.refresh_token !== sent && stored.expires_at > Date.now()) return stored;
    if (Date.now() >= until) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return saved?.refresh_token ? saved : null;
  } catch { return null; }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}
