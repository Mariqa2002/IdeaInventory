/* Boot: theme, header, routing, settings, background archive sweep. */

import { h, frag, clamp, fmtTimestamp } from './util.js';
import { icon } from './icons.js';
import { openModal, field, toast, confirmDialog, openMenu } from './ui.js';
import * as store from './store.js';
import { parseRoute, startRouter, onRoute, goHome, navigate } from './router.js';
import { renderAuth } from './views/auth.js';
import { renderHome } from './views/home.js';
import { renderIdea } from './views/idea.js';

const app = document.getElementById('app');

store.load();
applyTheme();

/* --- Render ------------------------------------------------------------- */

function render() {
  const route = parseRoute();

  if (!store.isSignedIn()) {
    document.body.classList.add('is-auth');
    renderAuth(app, { onSignedIn: () => { document.body.classList.remove('is-auth'); render(); } });
    return;
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
      { label: 'Export a backup', icon: 'download', onSelect: exportBackup },
      { label: 'Import ideas', icon: 'upload', onSelect: importBackup },
      'divider',
      {
        label: 'Log out', icon: 'logout', danger: true,
        onSelect: () => { store.endSession(); toast('Logged out.'); render(); },
      },
    ]),
  }, icon('more'));

  return h('header.app-header', brand, crumb, h('div.grow'), themeButton, menuButton);
}

function applyTheme() {
  document.documentElement.dataset.theme = store.getSettings().theme === 'dark' ? 'dark' : 'light';
}

/* --- Settings ------------------------------------------------------------ */

function openSettings() {
  const settings = store.getSettings();
  const account = store.getAccount();

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
    onChange: () => store.setSetting('archiveMinutes', clamp(Number(archiveMinutes.value) || 30, 1, 1440)),
  });

  const apiKey = h('input.input', {
    type: 'password', placeholder: 'sk-ant-…', value: settings.apiKey || '',
    autocomplete: 'off', spellcheck: false,
    onChange: () => store.setSetting('apiKey', apiKey.value.trim()),
  });

  const currentPass = h('input.input', { type: 'password', autocomplete: 'current-password' });
  const newPass = h('input.input', { type: 'password', autocomplete: 'new-password' });
  const passStatus = h('div.small');

  const body = h('div.form-grid',
    h('div.field',
      h('div.label', { text: 'Signed in as' }),
      h('div.row.gap-8', icon('mail'), h('span', { text: account.email })),
      h('div.hint', {
        text: `Everything lives in this browser${account.createdAt ? ` — inventory created ${fmtTimestamp(account.createdAt)}` : ''}. ` +
              'Take an export before clearing your browser data.',
      })),

    h('hr.divider'),

    field('Appearance', theme, 'Light is the default. Dark keeps the same maroon palette, dimmed.'),
    field('Move completed tasks to the archive after (minutes)', archiveMinutes,
      'The Completed column empties itself into the archive on this delay.'),

    h('hr.divider'),

    field('Anthropic API key (optional)', apiKey,
      'Only used to let Claude draft your Gantt timelines. It is stored on this device and sent straight to api.anthropic.com. ' +
      'Leave it empty to use the built-in offline planner.'),

    h('hr.divider'),

    h('div.field',
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
        }))));

  openModal({
    title: 'Settings',
    body,
    footer: (close) => frag(
      h('button.btn.btn-danger', {
        type: 'button', text: 'Erase everything',
        async onClick() {
          const yes = await confirmDialog({
            title: 'Erase this inventory?',
            message: 'Every idea, task, note and timeline on this device is deleted, along with your password. There is no undo.',
            confirmLabel: 'Erase everything', danger: true,
          });
          if (!yes) return;
          store.wipeEverything();
          location.reload();
        },
      }),
      h('div.grow'),
      h('button.btn.btn-primary', { type: 'button', text: 'Done', onClick: () => close() })),
    onClose: render,
  });
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
    } catch (err) {
      console.error(err);
      toast('That file could not be read as an Idea Inventory backup.');
    }
  });
  picker.click();
}

/* --- Background jobs ------------------------------------------------------ */

// Completed tasks fall into the archive on their own.
setInterval(() => {
  if (!store.isSignedIn()) return;
  if (store.sweepArchive()) render();
}, 60000);

// Another tab (or the same app on a second window) changed something.
window.addEventListener('storage', (event) => {
  if (event.key && event.key.startsWith('ideaInventory.')) {
    store.load();
    applyTheme();
    render();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.isSignedIn() && store.sweepArchive()) render();
});

/* --- Go -------------------------------------------------------------------- */

onRoute(render);
startRouter();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable.', err));
  });
}
