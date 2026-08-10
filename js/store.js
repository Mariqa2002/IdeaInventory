/* ==========================================================================
   Store — everything lives in localStorage on the device.
   No server, no third-party auth service. Shape:

   {
     version, account: { email, salt, hash, algo, createdAt },
     settings: { theme, ideaView, sidebarCollapsed, showArchive, archiveMinutes, apiKey },
     ideas: [ Idea ]
   }

   Idea = { id, title, description, why, who, value, priority, status,
            createdAt, completedAt, startDate, tasks: [ Task ] }
   Task = { id, title, status, priority, due, start, days, notes: [Note],
            createdAt, completedAt, archived, order }
   ========================================================================== */

import { uid, clamp, todayISO } from './util.js';

const DATA_KEY = 'ideaInventory.data.v1';
const SESSION_KEY = 'ideaInventory.session.v1';

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
    version: 1,
    account: null,
    settings: {
      theme: 'light',
      ideaView: 'grid',
      sidebarCollapsed: false,
      showArchive: false,
      archiveMinutes: 30,
      apiKey: '',
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
  next.version = 1;
  next.account = saved.account || null;
  next.settings = { ...next.settings, ...(saved.settings || {}) };
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
      id: n.id || uid('note'), text: n.text || '', createdAt: n.createdAt || Date.now(),
    })),
    createdAt: task.createdAt || Date.now(),
    completedAt: task.completedAt || null,
    archived: !!task.archived,
    order: Number.isFinite(task.order) ? task.order : 0,
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

/* --- Account + session ------------------------------------------------- */

function randomSalt() {
  const bytes = new Uint8Array(16);
  (crypto.getRandomValues ? crypto : { getRandomValues: (a) => a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256))) })
    .getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PBKDF2-SHA256 where the browser exposes WebCrypto (https / localhost /
 * installed PWA). Falls back to a weaker digest on insecure origins so the
 * app still works when opened straight off the filesystem.
 */
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
  commit();
  startSession();
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

export function startSession() {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ email: state.account?.email, since: Date.now() })); } catch {}
}

export function endSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

/** Sessions have no expiry — the user stays signed in until they log out. */
export function isSignedIn() {
  if (!state.account) return false;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    return JSON.parse(raw).email === state.account.email;
  } catch { return false; }
}

export function wipeEverything() {
  try {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {}
  state = blankState();
}

/* --- Ideas ------------------------------------------------------------- */

export function getIdeas() { return state.ideas; }

export function getIdea(id) { return state.ideas.find((i) => i.id === id) || null; }

/** Ideas ordered by priority (1 first), then newest-captured. */
export function sortedIdeas() {
  return [...state.ideas].sort((a, b) => {
    const pa = a.priority ?? Infinity, pb = b.priority ?? Infinity;
    if (pa !== pb) return pa - pb;
    return b.createdAt - a.createdAt;
  });
}

export function addIdea(data) {
  const idea = normaliseIdea({ ...data, id: uid('idea'), createdAt: Date.now(), tasks: [] });
  state.ideas.push(idea);
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
  if (priorityChanged) reprioritise(id, wanted);
  commit();
  return idea;
}

export function setIdeaStatus(id, status) {
  const idea = getIdea(id);
  if (!idea) return;
  idea.status = status;
  idea.completedAt = status === 'completed' ? Date.now() : null;
  commit();
}

export function removeIdea(id) {
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
    if (slot === place) target.priority = slot;
    else others[cursor++].priority = slot;
  }
}

function compactPriorities() {
  state.ideas
    .filter((i) => i.priority != null)
    .sort((a, b) => a.priority - b.priority)
    .forEach((idea, index) => { idea.priority = index + 1; });
}

/** Next free priority number, used to pre-fill the "Add an idea" form. */
export function nextPriority() {
  return state.ideas.filter((i) => i.priority != null).length + 1;
}

/* --- Tasks ------------------------------------------------------------- */

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
  idea.tasks.push(task);
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
  commit();
  return task;
}

export function removeTask(ideaId, taskId) {
  const idea = getIdea(ideaId);
  if (!idea) return;
  idea.tasks = idea.tasks.filter((t) => t.id !== taskId);
  commit();
}

export function addNote(ideaId, taskId, text) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task || !text.trim()) return null;
  const note = { id: uid('note'), text: text.trim(), createdAt: Date.now() };
  task.notes.push(note);
  commit();
  return note;
}

export function removeNote(ideaId, taskId, noteId) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task) return;
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

/** Move a task into a column at a given index, renumbering that column. */
export function moveTask(ideaId, taskId, toStatus, toIndex) {
  const idea = getIdea(ideaId);
  const task = idea?.tasks.find((t) => t.id === taskId);
  if (!task) return;

  if (task.status !== toStatus) {
    task.status = toStatus;
    task.completedAt = toStatus === 'done' ? Date.now() : null;
    if (toStatus !== 'done') task.archived = false;
  }
  task.archived = false;

  const column = tasksInColumn(idea, toStatus).filter((t) => t.id !== taskId);
  const pinned = column.filter((t) => toStatus === 'pending' && t.priority).length;
  const index = clamp(toIndex ?? column.length, task.priority && toStatus === 'pending' ? 0 : pinned, column.length);
  column.splice(index, 0, task);
  column.forEach((t, i) => { t.order = i; });
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

/** Timeline span implied by the scheduled tasks (plus the idea start date). */
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
  return JSON.stringify({ ...state, account: state.account ? { ...state.account, hash: undefined, salt: undefined } : null }, null, 2);
}

export function importIdeas(json) {
  const parsed = JSON.parse(json);
  const incoming = Array.isArray(parsed) ? parsed : parsed.ideas;
  if (!Array.isArray(incoming)) throw new Error('No ideas found in that file.');
  const existing = new Set(state.ideas.map((i) => i.id));
  const added = incoming.map(normaliseIdea).filter((i) => !existing.has(i.id));
  state.ideas.push(...added);
  compactPriorities();
  commit();
  return added.length;
}

export { todayISO };
