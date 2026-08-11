/* ==========================================================================
   Store — the device's copy of the inventory.

   The app is local-first: every read and every write happens here, against
   localStorage, so it stays instant and keeps working with no signal. When
   there is a connection, sync.js pushes what changed and pulls what the other
   devices changed (see that file for the merge rules).

   Two bits of bookkeeping make that possible:
     * `_dirty` / `_touch` on a record — edited here, not yet on the server.
       `_touch` counts edits, so a write that lands mid-push is not marked
       clean by that push.
     * tombstones — a deleted record leaves an id behind until the server has
       been told, otherwise the next pull would quietly resurrect it.

   Shape:
   {
     version, ownerId, account, settings,
     sync: { cursors: {ideas, tasks, notes}, tombstones: {ideas, tasks, notes} },
     ideas: [ Idea ]
   }
   ========================================================================== */

import { uid, clamp, todayISO } from './util.js';

const DATA_KEY = 'ideaInventory.data.v1';
const LOCAL_SESSION_KEY = 'ideaInventory.localSession.v1';

export const TASK_STATUS = ['pending', 'progress', 'hold', 'done'];

export const STATUS_META = {
  pending:  { label: 'Pending',     color: 'var(--col-pending)' },
  progress: { label: 'In Progress', color: 'var(--col-progress)' },
  hold:     { label: 'On Hold',     color: 'var(--col-hold)' },
  done:     { label: 'Completed',   color: 'var(--col-done)' },
};

export const LONGFORM = [
  { key: 'why',   question: 'Why am I making this project?',      placeholder: 'The itch, the frustration, the spark…' },
  { key: 'who',   question: 'Who is this project for?',           placeholder: 'Be specific — "me at 7am", a team, a niche…' },
  { key: 'value', question: 'What is going to make it valuable?', placeholder: 'What makes it worth someone\'s time or money?' },
];

function blankState() {
  return {
    version: 2,
    ownerId: null,          // Supabase user id, or 'local' for device-only use
    account: null,          // device-only mode credentials
    settings: {
      theme: 'light',
      ideaView: 'grid',
      sidebarCollapsed: false,
      showArchive: false,
      archiveMinutes: 3,
      apiKey: '',
    },
    sync: {
      cursors: { ideas: null, tasks: null, notes: null },
      tombstones: { ideas: [], tasks: [], notes: [] },
    },
    ideas: [],
  };
}

/* --- Persistence ------------------------------------------------------- */

let state = blankState();
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) state = migrate(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved data, starting fresh.', err);
    state = blankState();
  }
  sweepArchive(true);
  return state;
}

function migrate(saved) {
  const next = blankState();
  next.ownerId = saved.ownerId || null;
  next.account = saved.account || null;
  next.settings = { ...next.settings, ...(saved.settings || {}) };
  next.sync = {
    cursors: { ...next.sync.cursors, ...(saved.sync?.cursors || {}) },
    tombstones: { ...next.sync.tombstones, ...(saved.sync?.tombstones || {}) },
  };
  next.ideas = (saved.ideas || []).map(normaliseIdea);
  return next;
}

function normaliseIdea(idea) {
  return {
    id: idea.id || uid('idea'),
    title: idea.title || 'Untitled idea',
    description: idea.description || '',
    why: idea.why || '',
    who: idea.who || '',
    value: idea.value || '',
    priority: Number.isFinite(idea.priority) ? idea.priority : null,
    status: idea.status === 'completed' ? 'completed' : 'active',
    createdAt: idea.createdAt || Date.now(),
    completedAt: idea.completedAt || null,
    startDate: idea.startDate || null,
    tasks: (idea.tasks || []).map(normaliseTask),
    _dirty: idea._dirty !== false,
    _touch: idea._touch || 0,
  };
}

function normaliseTask(task) {
  return {
    id: task.id || uid('task'),
    title: task.title || 'Untitled task',
    status: TASK_STATUS.includes(task.status) ? task.status : 'pending',
    priority: !!task.priority,
    due: task.due || null,
    start: task.start || null,
    days: Number.isFinite(task.days) ? task.days : null,
    notes: (task.notes || []).map((n) => ({
      id: n.id || uid('note'),
      text: n.text || '',
      createdAt: n.createdAt || Date.now(),
      _dirty: n._dirty !== false,
      _touch: n._touch || 0,
    })),
    createdAt: task.createdAt || Date.now(),
    completedAt: task.completedAt || null,
    archived: !!task.archived,
    order: Number.isFinite(task.order) ? task.order : 0,
    _dirty: task._dirty !== false,
    _touch: task._touch || 0,
  };
}

export function save() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Saving failed — storage may be full or blocked.', err);
  }
}

/** Persist + notify every subscriber. */
export function commit() {
  save();
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() { return state; }
export function getSettings() { return state.settings; }

export function setSetting(key, value) {
  state.settings[key] = value;
  commit();
}

/* --- Change tracking ---------------------------------------------------- */

/** Marks a record as needing to go to the server. */
function touch(record) {
  record._dirty = true;
  record._touch = (record._touch || 0) + 1;
  return record;
}

function tombstone(table, id) {
  const list = state.sync.tombstones[table];
  if (!list.some((entry) => entry.id === id)) list.push({ id, at: Date.now() });
}

/** Everything on this device is unknown to the server — used on first sign-in. */
export function markEverythingDirty() {
  for (const idea of state.ideas) {
    touch(idea);
    for (const task of idea.tasks) {
      touch(task);
      for (const note of task.notes) touch(note);
    }
  }
  commit();
}

export function pendingCount() {
  let count = 0;
  for (const idea of state.ideas) {
    if (idea._dirty) count++;
    for (const task of idea.tasks) {
      if (task._dirty) count++;
      for (const note of task.notes) if (note._dirty) count++;
    }
  }
  for (const table of Object.keys(state.sync.tombstones)) count += state.sync.tombstones[table].length;
  return count;
}

/* --- Ownership ---------------------------------------------------------- */

export function getOwnerId() { return state.ownerId; }

/**
 * Binds the local cache to an account. Signing in as somebody else wipes the
 * cache first, so two people sharing a browser never see each other's ideas.
 */
export function claimOwner(ownerId) {
  if (state.ownerId === ownerId) return false;

  // Data captured before signing up (or while using the device-only mode)
  // belongs to whoever signs in first — it gets uploaded rather than dropped.
  const unclaimed = state.ownerId == null || state.ownerId === 'local';
  const adopting = unclaimed && state.ideas.length > 0;

  if (!unclaimed) {
    const settings = state.settings;
    state = blankState();
    state.settings = settings;
  }

  state.ownerId = ownerId;
  state.sync.cursors = { ideas: null, tasks: null, notes: null };
  commit();
  if (adopting) markEverythingDirty();
  return adopting;
}

/* --- Device-only account ------------------------------------------------ */

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(password, salt) {
  if (globalThis.crypto?.subtle) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return { algo: 'pbkdf2', hash: [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('') };
  }
  let a = 0x811c9dc5, b = 0x01000193;
  const input = `${salt}::${password}::${salt}`;
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b + input.charCodeAt(i) * (i + 7), 2654435761) >>> 0;
  }
  return { algo: 'weak', hash: (a.toString(16) + b.toString(16)).padStart(16, '0') };
}

export function hasAccount() { return !!state.account; }
export function getAccount() { return state.account; }

export async function createAccount(email, password) {
  const salt = randomSalt();
  const { algo, hash } = await derive(password, salt);
  state.account = { email: email.trim(), salt, hash, algo, createdAt: Date.now() };
  state.ownerId = 'local';
  commit();
  startLocalSession();
}

export async function verifyPassword(email, password) {
  const account = state.account;
  if (!account) return false;
  if (account.email.toLowerCase() !== email.trim().toLowerCase()) return false;
  const { hash } = await derive(password, account.salt);
  return hash === account.hash;
}

export async function changePassword(current, next) {
  if (!(await verifyPassword(state.account.email, current))) return false;
  const salt = randomSalt();
  const { algo, hash } = await derive(next, salt);
  state.account = { ...state.account, salt, hash, algo };
  commit();
  return true;
}

export function startLocalSession() {
  try { localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ email: state.account?.email, since: Date.now() })); } catch {}
}

export function endLocalSession() {
  try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch {}
}

/** Device-only sessions have no expiry — signed in until you log out. */
export function hasLocalSession() {
  if (!state.account) return false;
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    return raw ? JSON.parse(raw).email === state.account.email : false;
  } catch { return false; }
}

export function wipeEverything() {
  try {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {}
  state = blankState();
}

/* --- Ideas ------------------------------------------------------------- */

export function getIdeas() { return state.ideas; }

export function getIdea(id) { return state.ideas.find((i) => i.id === id) || null; }

export function sortedIdeas() {
  return [...state.ideas].sort((a, b) => {
    const pa = a.priority ?? Infinity, pb = b.priority ?? Infinity;
    if (pa !== pb) return pa - pb;
    return b.createdAt - a.createdAt;
  });
}

export function addIdea(data) {
  const idea = normaliseIdea({ ...data, id: uid('idea'), createdAt: Date.now(), tasks: [] });
  state.ideas.push(touch(idea));
  reprioritise(idea.id, data.priority);
  commit();
  return idea;
}

export function updateIdea(id, patch) {
  const idea = getIdea(id);
  if (!idea) return null;
  const priorityChanged = 'priority' in patch && patch.priority !== idea.priority;
  const wanted = patch.priority;
  Object.assign(idea, patch);
  touch(idea);
  if (priorityChanged) reprioritise(id, wanted);
  commit();
  return idea;
}

export function setIdeaStatus(id, status) {
  const idea = getIdea(id);
  if (!idea) return;
  idea.status = status;
  idea.completedAt = status === 'completed' ? Date.now() : null;
  touch(idea);
  commit();
}

export function removeIdea(id) {
  const idea = getIdea(id);
  if (!idea) return;
  for (const task of idea.tasks) {
    for (const note of task.notes) tombstone('notes', note.id);
    tombstone('tasks', task.id);
  }
  tombstone('ideas', id);
  state.ideas = state.ideas.filter((i) => i.id !== id);
  compactPriorities();
  commit();
}

/**
 * Smart priority. Claiming #2 when a #2 already exists pushes that idea (and
 * everything below it) down one slot; numbers always stay a gapless 1..n run.
 */
function reprioritise(id, wanted) {
  const target = getIdea(id);
  if (!target) return;

  if (wanted == null || wanted === '' || !Number.isFinite(Number(wanted))) {
    target.priority = null;
    compactPriorities();
    return;
  }

  const others = state.ideas
    .filter((i) => i.id !== id && i.priority != null)
    .sort((a, b) => a.priority - b.priority);

  const slots = others.length + 1;
  const place = clamp(Math.round(Number(wanted)), 1, slots);

  let cursor = 0;
  for (let slot = 1; slot <= slots; slot++) {
    if (slot === place) {
      if (target.priority !== slot) touch(target);
      target.priority = slot;
    } else {
      const other = others[cursor++];
      if (other.priority !== slot) { other.priority = slot; touch(other); }
    }
  }
}

function compactPriorities() {
  state.ideas
    .filter((i) => i.priority != null)
    .sort((a, b) => a.priority - b.priority)
    .forEach((idea, index) => {
      if (idea.priority !== index + 1) { idea.priority = index + 1; touch(idea); }
    });
}

export function nextPriority() {
  return state.ideas.filter((i) => i.priority != null).length + 1;
}

/* --- Tasks ------------------------------------------------------------- */

function findTask(taskId) {
  for (const idea of state.ideas) {
    const task = idea.tasks.find((t) => t.id === taskId);
    if (task) return { idea, task };
  }
  return null;
}

export function addTask(ideaId, data) {
  const idea = getIdea(ideaId);
  if (!idea) return null;
  const siblings = idea.tasks.filter((t) => t.status === (data.status || 'pending'));
  const task = normaliseTask({
    ...data,
    id: uid('task'),
    createdAt: Date.now(),
    order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
  });
  idea.tasks.push(touch(task));
  commit();
  return task;
}

export function updateTask(ideaId, taskId, patch) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  if (patch.status && patch.status !== task.status) {
    patch.completedAt = patch.status === 'done' ? Date.now() : null;
    if (patch.status !== 'done') patch.archived = false;
  }
  Object.assign(task, patch);
  touch(task);
  commit();
  return task;
}

export function removeTask(ideaId, taskId) {
  const idea = getIdea(ideaId);
  if (!idea) return;
  const task = idea.tasks.find((t) => t.id === taskId);
  if (!task) return;
  for (const note of task.notes) tombstone('notes', note.id);
  tombstone('tasks', taskId);
  idea.tasks = idea.tasks.filter((t) => t.id !== taskId);
  commit();
}

export function addNote(ideaId, taskId, text) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task || !text.trim()) return null;
  const note = touch({ id: uid('note'), text: text.trim(), createdAt: Date.now() });
  task.notes.push(note);
  commit();
  return note;
}

export function removeNote(ideaId, taskId, noteId) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task) return;
  tombstone('notes', noteId);
  task.notes = task.notes.filter((n) => n.id !== noteId);
  commit();
}

/** Board order within a column: priority tasks pinned first, then `order`. */
export function tasksInColumn(idea, status, { includeArchived = false } = {}) {
  return idea.tasks
    .filter((t) => t.status === status && (includeArchived || !t.archived))
    .sort((a, b) => {
      if (status === 'pending' && a.priority !== b.priority) return a.priority ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      return a.createdAt - b.createdAt;
    });
}

export function archivedTasks(idea) {
  return idea.tasks.filter((t) => t.archived).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

export function moveTask(ideaId, taskId, toStatus, toIndex) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task) return;

  if (task.status !== toStatus) {
    task.status = toStatus;
    task.completedAt = toStatus === 'done' ? Date.now() : null;
  }
  task.archived = false;
  touch(task);

  const column = tasksInColumn(idea, toStatus).filter((t) => t.id !== taskId);
  const pinned = column.filter((t) => toStatus === 'pending' && t.priority).length;
  const index = clamp(toIndex ?? column.length, task.priority && toStatus === 'pending' ? 0 : pinned, column.length);
  column.splice(index, 0, task);
  column.forEach((t, i) => { if (t.order !== i) { t.order = i; touch(t); } });
  commit();
}

/**
 * Completed tasks slide into the archive once they have been done for longer
 * than `settings.archiveMinutes` (30 by default). Runs on load and on a timer.
 */
export function sweepArchive(quiet = false) {
  const cutoff = Date.now() - (state.settings.archiveMinutes ?? 30) * 60000;
  let moved = 0;
  for (const idea of state.ideas) {
    for (const task of idea.tasks) {
      if (task.status === 'done' && !task.archived && task.completedAt && task.completedAt <= cutoff) {
        task.archived = true;
        touch(task);
        moved++;
      }
    }
  }
  if (moved && !quiet) commit();
  else if (moved) save();
  return moved;
}

/* --- Derived numbers --------------------------------------------------- */

export function ideaStats(idea) {
  const live = idea.tasks;
  const done = live.filter((t) => t.status === 'done').length;
  const total = live.length;
  return {
    total,
    done,
    open: total - done,
    pct: total ? Math.round((done / total) * 100) : 0,
    inProgress: live.filter((t) => t.status === 'progress').length,
    onHold: live.filter((t) => t.status === 'hold').length,
  };
}

export function ideaTimeline(idea) {
  const scheduled = idea.tasks.filter((t) => t.start && t.days > 0);
  if (!scheduled.length) return { start: idea.startDate || null, end: null, scheduled: 0 };
  let start = scheduled[0].start;
  let end = null;
  for (const task of scheduled) {
    if (task.start < start) start = task.start;
    const finish = addDaysISO(task.start, task.days - 1);
    if (!end || finish > end) end = finish;
  }
  if (idea.startDate && idea.startDate < start) start = idea.startDate;
  return { start, end, scheduled: scheduled.length };
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function exportData() {
  return JSON.stringify({
    version: state.version,
    exportedAt: new Date().toISOString(),
    ideas: state.ideas.map(stripInternals),
  }, null, 2);
}

function stripInternals(idea) {
  const { _dirty, _touch, ...rest } = idea;
  return {
    ...rest,
    tasks: idea.tasks.map(({ _dirty: d, _touch: t, ...task }) => ({
      ...task,
      notes: task.notes.map(({ _dirty: nd, _touch: nt, ...note }) => note),
    })),
  };
}

export function importIdeas(json) {
  const parsed = JSON.parse(json);
  const incoming = Array.isArray(parsed) ? parsed : parsed.ideas;
  if (!Array.isArray(incoming)) throw new Error('No ideas found in that file.');
  const existing = new Set(state.ideas.map((i) => i.id));
  const added = incoming.map(normaliseIdea).filter((i) => !existing.has(i.id));
  for (const idea of added) {
    touch(idea);
    for (const task of idea.tasks) {
      touch(task);
      for (const note of task.notes) touch(note);
    }
  }
  state.ideas.push(...added);
  compactPriorities();
  commit();
  return added.length;
}

/* ==========================================================================
   Sync surface — used only by sync.js
   ========================================================================== */

export const syncApi = {
  cursors: () => state.sync.cursors,
  setCursor(table, value) { state.sync.cursors[table] = value; },

  tombstones: (table) => state.sync.tombstones[table],
  clearTombstones(table, ids) {
    const gone = new Set(ids);
    state.sync.tombstones[table] = state.sync.tombstones[table].filter((entry) => !gone.has(entry.id));
  },

  /** Dirty records, each paired with the `_touch` value seen at push time. */
  collectDirty() {
    const ideas = [], tasks = [], notes = [];
    for (const idea of state.ideas) {
      if (idea._dirty) ideas.push(idea);
      for (const task of idea.tasks) {
        if (task._dirty) tasks.push({ task, ideaId: idea.id });
        for (const note of task.notes) {
          if (note._dirty) notes.push({ note, taskId: task.id });
        }
      }
    }
    return { ideas, tasks, notes };
  },

  /** Only clears the flag when nothing edited the record while it was in flight. */
  markClean(records) {
    for (const { record, touch: seen } of records) {
      if (record._touch === seen) record._dirty = false;
    }
  },

  findTask,
  getIdea,
  save,
  commit,

  /* Merging remote rows in ------------------------------------------------- */

  applyIdea(row) {
    const local = getIdea(row.id);
    if (row.deleted_at) {
      if (local) state.ideas = state.ideas.filter((i) => i.id !== row.id);
      return !!local;
    }
    if (!local) {
      state.ideas.push(normaliseIdea({ ...ideaFromRow(row), tasks: [], _dirty: false }));
      return true;
    }
    if (local._dirty) return false;         // local edits win until they are pushed
    Object.assign(local, ideaFromRow(row), { _dirty: false });
    return true;
  },

  applyTask(row) {
    const found = findTask(row.id);
    if (row.deleted_at) {
      if (found) found.idea.tasks = found.idea.tasks.filter((t) => t.id !== row.id);
      return !!found;
    }
    const idea = getIdea(row.idea_id);
    if (!idea) return false;                // its idea is gone — nothing to hang it on

    if (found && found.idea.id !== idea.id) {
      found.idea.tasks = found.idea.tasks.filter((t) => t.id !== row.id);
      idea.tasks.push(normaliseTask({ ...taskFromRow(row), notes: found.task.notes, _dirty: false }));
      return true;
    }
    if (!found) {
      idea.tasks.push(normaliseTask({ ...taskFromRow(row), notes: [], _dirty: false }));
      return true;
    }
    if (found.task._dirty) return false;
    Object.assign(found.task, taskFromRow(row), { _dirty: false });
    return true;
  },

  applyNote(row) {
    for (const idea of state.ideas) {
      for (const task of idea.tasks) {
        const existing = task.notes.find((n) => n.id === row.id);
        if (existing) {
          if (row.deleted_at) {
            task.notes = task.notes.filter((n) => n.id !== row.id);
            return true;
          }
          if (existing._dirty) return false;
          Object.assign(existing, noteFromRow(row), { _dirty: false });
          return true;
        }
      }
    }
    if (row.deleted_at) return false;
    const target = findTask(row.task_id);
    if (!target) return false;
    target.task.notes.push({ ...noteFromRow(row), _dirty: false, _touch: 0 });
    return true;
  },
};

/* --- Row mapping -------------------------------------------------------- */

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const ms = (value) => (value ? new Date(value).getTime() : null);

export function ideaToRow(idea, userId) {
  return {
    id: idea.id,
    user_id: userId,
    title: idea.title,
    description: idea.description,
    why: idea.why,
    who: idea.who,
    value: idea.value,
    priority: idea.priority,
    status: idea.status,
    start_date: idea.startDate,
    created_at: iso(idea.createdAt),
    completed_at: iso(idea.completedAt),
  };
}

function ideaFromRow(row) {
  return {
    id: row.id,
    title: row.title || 'Untitled idea',
    description: row.description || '',
    why: row.why || '',
    who: row.who || '',
    value: row.value || '',
    priority: Number.isFinite(row.priority) ? row.priority : null,
    status: row.status === 'completed' ? 'completed' : 'active',
    createdAt: ms(row.created_at) || Date.now(),
    completedAt: ms(row.completed_at),
    startDate: row.start_date || null,
  };
}

export function taskToRow(task, ideaId, userId) {
  return {
    id: task.id,
    user_id: userId,
    idea_id: ideaId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.due,
    start: task.start,
    days: task.days,
    position: task.order,
    archived: task.archived,
    created_at: iso(task.createdAt),
    completed_at: iso(task.completedAt),
  };
}

function taskFromRow(row) {
  return {
    id: row.id,
    title: row.title || 'Untitled task',
    status: TASK_STATUS.includes(row.status) ? row.status : 'pending',
    priority: !!row.priority,
    due: row.due || null,
    start: row.start || null,
    days: Number.isFinite(row.days) ? row.days : null,
    order: Number.isFinite(row.position) ? row.position : 0,
    archived: !!row.archived,
    createdAt: ms(row.created_at) || Date.now(),
    completedAt: ms(row.completed_at),
  };
}

export function noteToRow(note, taskId, userId) {
  return {
    id: note.id,
    user_id: userId,
    task_id: taskId,
    body: note.text,
    created_at: iso(note.createdAt),
  };
}

function noteFromRow(row) {
  return {
    id: row.id,
    text: row.body || '',
    createdAt: ms(row.created_at) || Date.now(),
  };
}

export { todayISO };
