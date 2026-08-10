/* Hash routing — works from any static host, and from a home-screen PWA. */

const listeners = new Set();

export function parseRoute(hash = location.hash) {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);

  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'idea' && parts[1]) {
    const tab = ['dashboard', 'tasks', 'timeline'].includes(parts[2]) ? parts[2] : 'dashboard';
    return { name: 'idea', ideaId: parts[1], tab };
  }
  return { name: 'home' };
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === target) { emit(); return; }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) emit();
}

export function goHome() { navigate('/'); }
export function goIdea(id, tab = 'dashboard') { navigate(`/idea/${id}/${tab}`); }

function emit() {
  const route = parseRoute();
  for (const fn of listeners) fn(route);
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startRouter() {
  window.addEventListener('hashchange', emit);
  emit();
}
