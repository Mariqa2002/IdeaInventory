/* Boot: connection, auth gate, theme, header, routing, sync scheduling. */

import { h, frag, clamp, fmtTimestamp } from './util.js';
import { icon } from './icons.js';
import { openModal, field, toast, confirmDialog, openMenu } from './ui.js';
import * as store from './store.js';
import { Supabase, readConnection, writeConnection } from './supabase.js';
import { SyncEngine } from './sync.js';
import { SUPABASE_DEFAULTS, SYNC_INTERVAL_MS } from './config.js';
import { parseRoute, startRouter, onRoute, goHome } from './router.js';
import { renderAuth } from './views/auth.js';
import { renderHome } from './views/home.js';
import { renderIdea } from './views/idea.js';

const app = document.getElementById('app');

store.load();
applyTheme();

let connection = readConnection(SUPABASE_DEFAULTS);
const client = new Supabase(connection);
const sync = new SyncEngine(client);

const isCloud = () => connection.mode === 'cloud' && client.configured;
const signedIn = () => (isCloud() ? client.signedIn : connection.mode === 'local' && store.hasLocalSession());

/* --- Render ------------------------------------------------------------- */

function render() {
  const route = parseRoute();

  if (!signedIn()) {
    renderAuth(app, {
      client,
      connection,
      onConnectionChange: () => location.reload(),
      onSignedIn: ({ adopted }) => {
        if (isCloud()) {
          const pending = store.pendingCount();
          if (adopted && pending) toast(`Uploading ${pending} item${pending === 1 ? '' : 's'} from this device…`);
          scheduleSync(0);   // pull this account's ideas onto this device now
        }
        render();
      },
    });
    return;
  }

  // A reload lands here with a session already in hand — make sure the local
  // cache is bound to that account before anything reads it.
  if (isCloud() && client.user) {
    const adopted = store.claimOwner(client.user.id);
    if (adopted) scheduleSync(0);
  }

  const shell = h('div');
  shell.appendChild(header(route));

  const main = h('main');
  shell.appendChild(main);

  if (route.name === 'idea') renderIdea(main, { ideaId: route.ideaId, tab: route.tab, rerender: render });
  else renderHome(main, { rerender: render });

  app.replaceChildren(shell);
}

/* --- Header -------------------------------------------------------------- */

function header(route) {
  const idea = route.name === 'idea' ? store.getIdea(route.ideaId) : null;

  const brand = h('button.brand', { type: 'button', onClick: goHome, 'aria-label': 'Idea Inventory home' },
    h('span.mark', icon('chest')),
    h('span.brand-name', { text: 'Idea Inventory' }));

  const crumb = idea
    ? h('div.header-crumb',
        h('span.sep', { text: '/' }),
        h('span.cur', { text: idea.title }))
    : null;

  const settings = store.getSettings();
  const isDark = settings.theme === 'dark';

  const themeButton = h('button.btn.btn-ghost.btn-icon.btn-sm', {
    type: 'button',
    'aria-label': isDark ? 'Switch to light mode' : 'Switch to dark mode',
    title: isDark ? 'Light mode' : 'Dark mode',
    onClick: () => {
      store.setSetting('theme', isDark ? 'light' : 'dark');
      applyTheme();
      render();
    },
  }, icon(isDark ? 'sun' : 'moon'));

  const menuButton = h('button.btn.btn-ghost.btn-icon.btn-sm', {
    type: 'button', 'aria-label': 'Account and settings',
    onClick: () => openMenu(menuButton, [
      { label: 'Settings', icon: 'settings', onSelect: openSettings },
      isCloud() ? { label: 'Sync now', icon: 'refresh', onSelect: () => sync.sync() } : null,
      { label: 'Export a backup', icon: 'download', onSelect: exportBackup },
      { label: 'Import ideas', icon: 'upload', onSelect: importBackup },
      'divider',
      { label: 'Log out', icon: 'logout', danger: true, onSelect: logOut },
    ].filter(Boolean)),
  }, icon('more'));

  return h('header.app-header', brand, crumb, h('div.grow'), syncPill(), themeButton, menuButton);
}

/* --- Sync status --------------------------------------------------------- */

function syncPill() {
  if (!isCloud()) return null;

  const pill = h('button.sync-pill', {
    type: 'button',
    onClick: () => sync.sync(),
  });

  const paint = (status) => {
    const { state, lastSyncAt, pending, message } = status;
    let name = 'cloudCheck', label = 'Synced', tone = '';

    if (state === 'syncing') { name = 'refresh'; label = 'Syncing…'; tone = 'is-busy'; }
    else if (state === 'offline') { name = 'cloudOff'; label = 'Offline'; tone = 'is-offline'; }
    else if (state === 'error') { name = 'alert'; label = 'Sync issue'; tone = 'is-error'; }
    else if (state === 'signedOut') { name = 'cloudOff'; label = 'Signed out'; tone = 'is-error'; }
    else if (pending) { name = 'cloud'; label = `${pending} waiting`; tone = 'is-pending'; }
    else if (!lastSyncAt) { name = 'cloud'; label = 'Not synced yet'; }

    pill.className = 'sync-pill ' + tone;
    pill.title = message
      || (lastSyncAt ? `Last synced ${fmtTimestamp(lastSyncAt)}. Tap to sync now.` : 'Tap to sync now.');
    pill.replaceChildren(icon(name), h('span.sync-label', { text: label }));
  };

  bindStatus(pill, paint);
  return pill;
}

/**
 * Repaints `node` on every sync status change, and lets the subscription go
 * once the node has been replaced by a later render.
 */
function bindStatus(node, paint) {
  let attached = false;
  paint(sync.status);
  const off = sync.onStatus((status) => {
    if (node.isConnected) attached = true;
    else if (attached) { off(); return; }
    paint(status);
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = store.getSettings().theme === 'dark' ? 'dark' : 'light';
}

/* --- Settings ------------------------------------------------------------ */

function openSettings() {
  const settings = store.getSettings();

  const theme = h('select.select',
    h('option', { value: 'light', text: 'Light' }),
    h('option', { value: 'dark', text: 'Dark' }));
  theme.value = settings.theme;
  theme.addEventListener('change', () => {
    store.setSetting('theme', theme.value);
    applyTheme();
    render();
  });

  const archiveMinutes = h('input.input', {
    type: 'number', min: '1', max: '1440', value: String(settings.archiveMinutes),
    onChange: () => store.setSetting('archiveMinutes', clamp(Number(archiveMinutes.value) || 3, 1, 1440)),
  });

  const apiKey = h('input.input', {
    type: 'password', placeholder: 'sk-ant-…', value: settings.apiKey || '',
    autocomplete: 'off', spellcheck: false,
    onChange: () => store.setSetting('apiKey', apiKey.value.trim()),
  });

  const body = h('div.form-grid', syncSection(), h('hr.divider'),
    field('Appearance', theme, 'Light is the default. Dark keeps the same maroon palette, dimmed.'),
    field('Move completed tasks to the archive after (minutes)', archiveMinutes,
      'The Completed column empties itself into the archive on this delay.'),
    h('hr.divider'),
    field('Anthropic API key (optional)', apiKey,
      'Only used to let Claude draft your Gantt timelines. It is stored on this device and sent straight to api.anthropic.com. ' +
      'Leave it empty to use the built-in offline planner.'),
    isCloud() ? null : h('hr.divider'),
    isCloud() ? null : localPasswordSection());

  openModal({
    title: 'Settings',
    body,
    footer: (close) => frag(
      h('button.btn.btn-danger', {
        type: 'button', text: 'Erase this device',
        async onClick() {
          const yes = await confirmDialog({
            title: 'Erase this device\'s copy?',
            message: isCloud()
              ? 'Clears the ideas cached in this browser and signs you out. Anything already synced stays safe on the server ' +
                'and comes back when you sign in again — but anything still waiting to sync will be lost.'
              : 'Every idea, task, note and timeline on this device is deleted, along with your password. There is no undo.',
            confirmLabel: 'Erase', danger: true,
          });
          if (!yes) return;
          if (isCloud()) await client.signOut();
          store.wipeEverything();
          location.reload();
        },
      }),
      h('div.grow'),
      h('button.btn.btn-primary', { type: 'button', text: 'Done', onClick: () => close() })),
    onClose: render,
  });
}

function syncSection() {
  if (!isCloud()) {
    return h('div.field',
      h('div.label', { text: 'Sync' }),
      h('div.row.gap-8', icon('cloudOff'), h('span.small.muted', { text: 'Device-only — these ideas stay in this browser.' })),
      h('div',
        h('button.btn.btn-sm.btn-soft', {
          type: 'button',
          onClick: () => {
            writeConnection({ url: '', anonKey: '', mode: 'unset' });
            location.reload();
          },
        }, icon('cloud'), 'Connect a Supabase project')),
      h('div.hint', { text: 'Your ideas here will be uploaded the first time you sign in.' }));
  }

  const status = h('div.small.muted');
  const paint = (s) => {
    status.textContent = s.state === 'syncing' ? 'Syncing…'
      : s.state === 'offline' ? 'Offline — changes are queued on this device.'
      : s.state === 'error' ? `Last attempt failed: ${s.message}`
      : s.lastSyncAt ? `Last synced ${fmtTimestamp(s.lastSyncAt)}` + (s.pending ? ` · ${s.pending} waiting` : '')
      : 'Not synced yet.';
  };
  bindStatus(status, paint);

  return h('div.field',
    h('div.label', { text: 'Sync' }),
    h('div.row.gap-8', icon('mail'), h('span', { text: client.user?.email || 'Signed in' })),
    h('div.row.gap-8', icon('cloud'), h('span.small.dim', { text: connection.url })),
    status,
    h('div.row.gap-8.wrap',
      h('button.btn.btn-sm', { type: 'button', onClick: () => sync.sync() }, icon('refresh'), 'Sync now'),
      h('button.btn.btn-sm', {
        type: 'button',
        title: 'Re-reads the whole account from the server',
        onClick: () => { sync.resetCursors(); sync.sync(); toast('Re-reading everything from the server…'); },
      }, icon('download'), 'Pull everything again'),
      h('button.btn.btn-sm', { type: 'button', onClick: logOut }, icon('logout'), 'Log out')));
}

function localPasswordSection() {
  const currentPass = h('input.input', { type: 'password', autocomplete: 'current-password' });
  const newPass = h('input.input', { type: 'password', autocomplete: 'new-password' });
  const passStatus = h('div.small');

  return h('div.field',
    h('div.label', { text: 'Change password' }),
    h('div.form-2col',
      field('Current password', currentPass),
      field('New password', newPass)),
    passStatus,
    h('div',
      h('button.btn.btn-sm', {
        type: 'button', text: 'Update password',
        async onClick() {
          passStatus.className = 'small error-text';
          if (newPass.value.length < 6) { passStatus.textContent = 'New password needs at least 6 characters.'; return; }
          const ok = await store.changePassword(currentPass.value, newPass.value);
          if (ok) {
            passStatus.className = 'small';
            passStatus.style.color = 'var(--ok)';
            passStatus.textContent = 'Password updated.';
            currentPass.value = newPass.value = '';
          } else {
            passStatus.textContent = 'That current password is not right.';
          }
        },
      })));
}

async function logOut() {
  const pending = store.pendingCount();
  if (isCloud() && pending) {
    const yes = await confirmDialog({
      title: 'Log out with unsynced changes?',
      message: `${pending} change${pending === 1 ? '' : 's'} on this device ${pending === 1 ? 'has' : 'have'} not reached the server yet. ` +
               'Sync first so nothing is lost.',
      confirmLabel: 'Log out anyway', danger: true,
    });
    if (!yes) return;
  }
  if (isCloud()) await client.signOut();
  else store.endLocalSession();
  toast('Logged out.');
  render();
}

/* --- Backup -------------------------------------------------------------- */

function exportBackup() {
  const blob = new Blob([store.exportData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `idea-inventory-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded.');
}

function importBackup() {
  const picker = h('input', { type: 'file', accept: 'application/json,.json' });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const added = store.importIdeas(await file.text());
      toast(added ? `Imported ${added} idea${added === 1 ? '' : 's'}.` : 'Nothing new to import.');
      render();
      scheduleSync(0);
    } catch (err) {
      console.error(err);
      toast('That file could not be read as an Idea Inventory backup.');
    }
  });
  picker.click();
}

/* --- Sync scheduling ------------------------------------------------------ */

let syncTimer = null;

function scheduleSync(delay = 1500) {
  if (!isCloud() || !client.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync.sync({ silent: true }), delay);
}

// A local edit means something to push. Sync's own writes leave nothing
// pending, so this cannot feed itself in a loop.
store.subscribe(() => { if (store.pendingCount()) scheduleSync(); });

/**
 * Rows arriving from another device mean the screen is stale. Redraw — but
 * never mid-drag, or the card would vanish from under the finger holding it.
 */
let redrawTimer = null;
function renderSoon() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    if (document.body.classList.contains('is-dragging')) { renderSoon(); return; }
    render();
  }, 120);
}

sync.onStatus((status) => {
  if (status.state === 'signedOut' && isCloud() && !client.signedIn) render();
  else if (status.changed) renderSoon();
});

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  sync.sync({ silent: true });
}, SYNC_INTERVAL_MS);

window.addEventListener('online', () => sync.sync({ silent: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (store.sweepArchive()) render();
  sync.sync({ silent: true });
});

// Completed tasks fall into the archive on their own.
setInterval(() => {
  if (!signedIn()) return;
  if (store.sweepArchive()) render();
}, 60000);

// Another tab on this device changed something.
window.addEventListener('storage', (event) => {
  if (event.key && event.key.startsWith('ideaInventory.')) {
    store.load();
    applyTheme();
    render();
  }
});

/* --- Go -------------------------------------------------------------------- */

onRoute(render);
startRouter();

if (signedIn()) sync.sync({ silent: true });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable.', err));
  });
}
