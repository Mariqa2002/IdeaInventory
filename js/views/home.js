/* Home: the inventory dashboard — rings, view switch, catalog of ideas. */

import { h, frag, plural, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { ringCard, emptyState, openMenu, toast, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { LONGFORM } from '../store.js';
import { goIdea } from '../router.js';
import { openIdeaForm } from './ideaForm.js';

export function renderHome(mount, { rerender }) {
  const ideas = store.sortedIdeas();
  const settings = store.getSettings();

  const page = h('div.page.page-wide');

  if (!ideas.length) {
    page.appendChild(emptyState({
      title: 'Your treasure chest is empty',
      message: 'Every project starts as a half-formed thought. Put the first one somewhere safe.',
      art: 'chest',
      action: h('button.btn.btn-primary', {
        type: 'button', onClick: () => openIdeaForm({ onSaved: rerender }),
      }, icon('plus'), 'Add an Idea'),
    }));
    mount.replaceChildren(page);
    return;
  }

  page.append(ringRow(ideas), toolbar(ideas, settings, rerender), catalog(ideas, settings, rerender));

  page.appendChild(h('button.btn.btn-primary.btn-icon.fab', {
    type: 'button', 'aria-label': 'Add an Idea',
    onClick: () => openIdeaForm({ onSaved: rerender }),
  }, icon('plus')));

  mount.replaceChildren(page);
}

/* --- Rings -------------------------------------------------------------- */

function ringRow(ideas) {
  const total = ideas.length;
  const done = ideas.filter((i) => i.status === 'completed').length;
  const active = total - done;

  const tasksTotal = ideas.reduce((sum, i) => sum + i.tasks.length, 0);
  const tasksDone = ideas.reduce((sum, i) => sum + i.tasks.filter((t) => t.status === 'done').length, 0);

  return h('div.ring-grid',
    ringCard({
      value: total,
      unit: total === 1 ? 'idea' : 'ideas',
      percent: total ? (active / total) * 100 : 0,
      label: 'Ideas captured',
      note: active ? `${plural(active, 'idea')} still in flight` : 'All wrapped up',
    }),
    ringCard({
      value: done,
      unit: 'done',
      percent: total ? (done / total) * 100 : 0,
      label: 'Ideas completed',
      note: total ? `${Math.round((done / total) * 100)}% of the inventory` : '—',
      color: 'var(--ok)',
    }),
    ringCard({
      value: tasksDone,
      unit: `of ${tasksTotal}`,
      percent: tasksTotal ? (tasksDone / tasksTotal) * 100 : 0,
      label: 'Tasks completed',
      note: tasksTotal ? `${plural(tasksTotal - tasksDone, 'task')} left across every idea`
                       : 'No tasks added yet',
      color: 'var(--info)',
    }));
}

/* --- Toolbar ------------------------------------------------------------ */

function toolbar(ideas, settings, rerender) {
  const setView = (view) => { store.setSetting('ideaView', view); rerender(); };

  const segmented = h('div.segmented', { role: 'group', 'aria-label': 'Catalog layout' },
    h('button', {
      type: 'button', 'aria-pressed': String(settings.ideaView === 'grid'),
      onClick: () => setView('grid'),
    }, icon('grid'), h('span', { text: 'Square view' })),
    h('button', {
      type: 'button', 'aria-pressed': String(settings.ideaView === 'list'),
      onClick: () => setView('list'),
    }, icon('list'), h('span', { text: 'List view' })));

  return h('div.section-head',
    h('div.stack.gap-4',
      h('div.eyebrow', { text: plural(ideas.length, 'idea') + ' in the chest' }),
      h('h2.section-title', { text: 'Ideas' })),
    h('div.row.gap-12.wrap',
      segmented,
      h('button.btn.btn-primary.hide-phone', {
        type: 'button', onClick: () => openIdeaForm({ onSaved: rerender }),
      }, icon('plus'), 'Add an Idea')));
}

/* --- Catalog ------------------------------------------------------------ */

function catalog(ideas, settings, rerender) {
  const list = h('div.catalog.view-' + (settings.ideaView === 'list' ? 'list' : 'grid'));
  for (const idea of ideas) list.appendChild(ideaCard(idea, settings, rerender));
  return list;
}

function ideaCard(idea, settings, rerender) {
  const stats = store.ideaStats(idea);
  const isDone = idea.status === 'completed';
  const missing = LONGFORM.filter(({ key }) => !idea[key]).length;

  const open = () => goIdea(idea.id);

  const menuButton = h('button.btn.btn-ghost.btn-icon.btn-sm', {
    type: 'button', 'aria-label': `Options for ${idea.title}`,
    onClick: (event) => {
      event.stopPropagation();
      openMenu(menuButton, [
        { label: 'Open', icon: 'chevronRight', onSelect: open },
        { label: 'Edit details', icon: 'edit', onSelect: () => openIdeaForm({ idea, onSaved: rerender }) },
        {
          label: isDone ? 'Mark as active' : 'Mark as completed',
          icon: isDone ? 'refresh' : 'checkCircle',
          onSelect: () => { store.setIdeaStatus(idea.id, isDone ? 'active' : 'completed'); rerender(); },
        },
        'divider',
        {
          label: 'Delete idea', icon: 'trash', danger: true,
          async onSelect() {
            const yes = await confirmDialog({
              title: `Delete "${idea.title}"?`,
              message: `This also deletes its ${plural(idea.tasks.length, 'task')} and timeline. It cannot be undone.`,
              confirmLabel: 'Delete', danger: true,
            });
            if (!yes) return;
            store.removeIdea(idea.id);
            toast('Idea deleted.');
            rerender();
          },
        },
      ]);
    },
  }, icon('more'));

  const badges = h('div.idea-foot',
    idea.priority != null ? h('span.prio-badge', { text: '#' + idea.priority, title: `Priority ${idea.priority}` }) : null,
    stats.total
      ? frag(
          h('div.mini-bar', { title: `${stats.done} of ${stats.total} tasks completed` },
            h('span', { style: { width: stats.pct + '%' } })),
          h('span.tiny.dim.nowrap', { text: `${stats.done}/${stats.total}` }))
      : h('span.tiny.dim', { text: 'No tasks yet' }),
    isDone ? h('span.chip.chip-ok', icon('check'), 'Completed') : null,
    missing ? h('span.chip.chip-warn', { title: 'Long-form questions still unanswered' }, icon('alert'), String(missing)) : null);

  const body = h('div.idea-body',
    h('div.idea-title', { text: idea.title }),
    h('div.idea-desc', { text: idea.description || 'No description yet.' }));

  const card = h('div.idea-card' + (isDone ? '.is-complete' : ''), {
    role: 'button', tabIndex: 0,
    'aria-label': `Open ${idea.title}`,
    onClick: open,
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    },
  });

  if (idea.priority === 1) card.style.setProperty('--accent', 'var(--plum-700)');
  else if (idea.priority != null) card.style.setProperty('--accent', 'var(--plum-400)');
  else card.style.setProperty('--accent', 'var(--border-strong)');
  if (isDone) card.style.setProperty('--accent', 'var(--ok)');

  if (settings.ideaView === 'list') {
    card.append(body, badges, menuButton);
  } else {
    card.append(h('div.idea-top', h('div.grow', body), menuButton), badges);
  }
  return card;
}
