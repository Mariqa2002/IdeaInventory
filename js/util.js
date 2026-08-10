/* Tiny DOM + date helpers. No dependencies anywhere in this app. */

/**
 * Hyperscript. `h('div.card', { onClick }, 'text', childNode)`
 * Tag supports `tag.class.class#id` shorthand.
 */
export function h(tag, props, ...children) {
  let cls = [];
  let id = null;
  const name = String(tag).replace(/[.#][^.#]+/g, (m) => {
    if (m[0] === '.') cls.push(m.slice(1));
    else id = m.slice(1);
    return '';
  }) || 'div';

  const node = document.createElement(name);
  if (id) node.id = id;

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') cls.push(value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      try { node[key] = value; } catch { node.setAttribute(key, value); }
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  if (cls.length) node.setAttribute('class', cls.join(' '));

  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function uid(prefix = 'id') {
  const rand = crypto?.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

/* --- Dates ------------------------------------------------------------- *
 * Dates are stored as plain `YYYY-MM-DD` strings and handled in local time
 * so a task never drifts a day because of a timezone offset.              */

export const DAY_MS = 86400000;

export function todayISO() { return toISO(new Date()); }

export function toISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromISO(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const d = fromISO(iso) || new Date();
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a, b) {
  const da = fromISO(a), db = fromISO(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / DAY_MS);
}

export function isWeekend(iso) {
  const d = fromISO(iso);
  if (!d) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function startOfWeek(iso) {
  const d = fromISO(iso) || new Date();
  const shift = (d.getDay() + 6) % 7; // Monday-based
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

export function fmtDate(iso, opts) {
  const d = fromISO(iso);
  if (!d) return '';
  return d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' });
}

export function fmtDateLong(iso) {
  return fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtRelativeDay(iso) {
  const delta = daysBetween(todayISO(), iso);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta < 0) return `${Math.abs(delta)}d overdue`;
  if (delta <= 6) return `In ${delta}d`;
  return fmtDate(iso);
}

export function fmtTimestamp(ms) {
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || one + 's')}`;
}
