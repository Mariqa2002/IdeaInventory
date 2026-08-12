/* ==========================================================================
   Sync engine.

   The rules, in one place:

   1. PUSH FIRST, THEN PULL. Local edits reach the server before anything comes
      back, so a pull can never overwrite work that has not been sent yet.
   2. THE SERVER OWNS THE CLOCK. `updated_at` is stamped by a database trigger,
      and each table remembers the newest `updated_at` it has seen. Asking for
      "everything after that" then cannot miss a change because one device's
      clock runs slow.
   3. LAST WRITE WINS, and a dirty local record is never overwritten by a pull —
      it is still on its way up, and it will win when it lands.
   4. DELETE BEATS EDIT. Deletes travel as tombstones (`deleted_at`), and a
      pushed edit does not clear one, so deleting an idea on the phone does not
      come back to life because the laptop had it open.

   Everything is per-record, so two devices editing different ideas — or
   different tasks in the same idea — never tread on each other.
   ========================================================================== */

import { ApiError, isSessionDead } from './supabase.js';
import * as store from './store.js';
import { syncApi, ideaToRow, taskToRow, noteToRow } from './store.js';

const CHUNK = 200;
const TABLES = ['ideas', 'tasks', 'notes'];

/**
 * Turns a failure into something a person can act on.
 *
 * "Sync issue" on its own is useless — worse on a phone, where there is no
 * tooltip to hover. Each of these is a real thing that goes wrong with a
 * Supabase project, paired with the one action that fixes it.
 */
function diagnose(err, step) {
  const status = err instanceof ApiError ? err.status : 0;
  const code = err instanceof ApiError ? err.code : '';
  const detail = [
    step,
    status ? `HTTP ${status}` : err.name,
    code,
    err.message,
  ].filter(Boolean).join(' · ');
  let cause = err.message || 'Something went wrong.';
  let fix = '';

  if (isSessionDead(err)) {
    cause = 'This device is no longer signed in to your project.';
    fix = 'Sign in again with your email and password. Nothing on this device is lost.';
  } else if (status === 404) {
    cause = 'The project answered, but the tables this app needs are not there.';
    fix = 'Open the Supabase dashboard → SQL Editor and run supabase/schema.sql once.';
  } else if (code === '42501' || status === 403) {
    cause = 'The database refused the write under its row level security rules.';
    fix = 'Re-run supabase/schema.sql — it recreates the policies that let you read and write your own rows.';
  } else if (code.startsWith('PGRST')) {
    cause = 'The database rejected the shape of the data this device sent.';
    fix = 'This is a bug in the app rather than in your project — the detail below identifies it.';
  } else if (status === 503 || status === 504 || status === 540) {
    cause = 'Your Supabase project is not responding — free projects pause after a spell of inactivity.';
    fix = 'Open the Supabase dashboard and resume the project, then sync again.';
  } else if (status >= 500) {
    cause = 'Supabase returned a server error.';
    fix = 'Usually temporary. Try again in a minute.';
  }
  return { cause, fix, detail, status, code };
}

export class SyncEngine {
  constructor(client) {
    this.client = client;
    this.listeners = new Set();
    this.running = null;
    this.queued = false;
    this.step = '';
    this.status = { state: 'idle', lastSyncAt: null, pending: 0, message: '', changed: 0, problem: null };
  }

  onStatus(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(patch) {
    this.status = { ...this.status, ...patch, pending: store.pendingCount() };
    for (const fn of this.listeners) fn(this.status);
  }

  get active() { return this.client.configured && this.client.signedIn; }

  /**
   * One push+pull pass. Overlapping calls collapse: a request made while a
   * sync is running queues exactly one more run afterwards.
   */
  async sync({ silent = false } = {}) {
    if (!this.active) {
      this._emit({ state: 'signedOut', message: '' });
      return false;
    }
    if (this.running) {
      this.queued = true;
      return this.running;
    }

    this.running = (async () => {
      if (!silent) this._emit({ state: 'syncing', message: '', changed: 0 });
      try {
        await this._push();
        const changed = await this._pull();
        if (changed) syncApi.commit(); else syncApi.save();
        // `changed` tells the app that rows arrived from another device and
        // whatever is on screen is now out of date.
        this._emit({ state: 'idle', lastSyncAt: Date.now(), message: '', changed, problem: null });
        return true;
      } catch (err) {
        const offline = err instanceof ApiError && err.offline;
        const dead = isSessionDead(err);
        const problem = offline ? null : diagnose(err, this.step);
        syncApi.save();
        this._emit({
          state: offline ? 'offline' : dead ? 'signedOut' : 'error',
          message: offline ? 'No connection — your changes are saved on this device.' : problem.cause,
          changed: 0,
          problem,
        });
        if (!offline) console.warn('[Idea Inventory] sync failed', problem, err);
        return false;
      } finally {
        this.step = '';
        this.running = null;
        if (this.queued) { this.queued = false; setTimeout(() => this.sync({ silent: true }), 0); }
      }
    })();

    return this.running;
  }

  /* --- Push ------------------------------------------------------------- */

  async _push() {
    const userId = this.client.user.id;
    const { ideas, tasks, notes } = syncApi.collectDirty();

    await this._pushRecords('ideas', ideas,
      (idea) => ideaToRow(idea, userId),
      (idea) => idea);

    await this._pushRecords('tasks', tasks,
      ({ task, ideaId }) => taskToRow(task, ideaId, userId),
      ({ task }) => task);

    await this._pushRecords('notes', notes,
      ({ note, taskId }) => noteToRow(note, taskId, userId),
      ({ note }) => note);

    await this._pushTombstones(userId);
  }

  async _pushRecords(table, entries, toRow, toRecord) {
    if (entries.length) this.step = `sending ${table}`;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      // Remember how many times each record had been edited before it went up,
      // so an edit made mid-flight is not marked as already saved.
      const stamps = slice.map((entry) => {
        const record = toRecord(entry);
        return { record, touch: record._touch };
      });
      await this.client.upsert(table, slice.map(toRow));
      syncApi.markClean(stamps);
    }
  }

  async _pushTombstones(userId) {
    for (const table of TABLES) {
      const pending = syncApi.tombstones(table);
      if (!pending.length) continue;
      this.step = `sending deleted ${table}`;
      const deletedAt = new Date().toISOString();
      for (let i = 0; i < pending.length; i += CHUNK) {
        const slice = pending.slice(i, i + CHUNK);
        await this.client.upsert(table, slice.map(({ id }) => ({
          id, user_id: userId, deleted_at: deletedAt,
        })));
        syncApi.clearTombstones(table, slice.map(({ id }) => id));
      }
    }
  }

  /* --- Pull ------------------------------------------------------------- */

  async _pull() {
    const apply = {
      ideas: (row) => syncApi.applyIdea(row),
      tasks: (row) => syncApi.applyTask(row),
      notes: (row) => syncApi.applyNote(row),
    };

    let changed = 0;
    for (const table of TABLES) {
      this.step = `reading ${table}`;
      let since = syncApi.cursors()[table];
      for (;;) {
        const rows = await this.client.select(table, { since, limit: 1000 });
        if (!rows?.length) break;
        for (const row of rows) if (apply[table](row)) changed++;
        since = rows[rows.length - 1].updated_at;
        syncApi.setCursor(table, since);
        if (rows.length < 1000) break;
      }
    }
    return changed;
  }

  /** Forgets where we had got to — the next sync re-reads the whole account. */
  resetCursors() {
    for (const table of TABLES) syncApi.setCursor(table, null);
    syncApi.commit();
  }
}
