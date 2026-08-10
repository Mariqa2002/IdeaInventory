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

/* --- Connection settings ------------------------------------------------ */

export function readConnection(defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved?.url && saved?.anonKey) return { url: trimUrl(saved.url), anonKey: saved.anonKey.trim(), mode: saved.mode || 'cloud' };
    if (saved?.mode === 'local') return { url: '', anonKey: '', mode: 'local' };
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

  /** A valid access token, refreshing first if this one is nearly out. */
  async accessToken() {
    if (!this.session) throw new ApiError('Not signed in.', { status: 401 });
    if (this.session.expires_at - Date.now() > 60000) return this.session.access_token;
    if (!this._refreshing) {
      this._refreshing = this._auth('/auth/v1/token?grant_type=refresh_token', {
        refresh_token: this.session.refresh_token,
      })
        .then((data) => { this._store(data); return this.session.access_token; })
        .finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
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
    throw new ApiError(message, { status: response.status, code: payload.code || payload.error || '' });
  }

  if (expectEmpty || response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
