/* The per-idea workspace: collapsible sidebar + Dashboard / Tasks / Timeline. */

import {
  h, frag, plural, todayISO, addDays, daysBetween, startOfWeek,
  fmtDate, fmtDateLong, fmtRelativeDay,
} from '../util.js';
import { icon } from '../icons.js';
import { ringCard, openMenu, toast, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { LONGFORM, STATUS_META } from '../store.js';
import { goHome, goIdea } from '../router.js';
import { openIdeaForm } from './ideaForm.js';
import { renderBoard, openTaskDetail, openTaskForm } from './tasks.js';
import { renderTimeline } from './timeline.js';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'tasks',     label: 'Tasks',     icon: 'columns' },
  { key: 'timeline',  label: 'Timeline',  icon: 'gantt' },
];

export function renderIdea(mount, { ideaId, tab, rerender }) {
  const idea = store.getIdea(ideaId);
  if (!idea) {
    mount.replaceChildren(h('div.page.page-narrow',
      h('div.empty',
        h('div.empty-art', icon('search')),
        h('h2', { text: 'That idea is not here any more' }),
        h('button.btn.btn-primary', { type: 'button', onClick: goHome }, icon('arrowLeft'), 'Back to all ideas'))));
    return;
  }

  const settings = store.getSettings();
  const side = sidebar(idea, tab, settings, rerender);
  const main = h('div.work-main');

  main.appendChild(workHead(idea, tab, rerender));

  if (tab === 'tasks') renderBoard(main, { idea, rerender });
  else if (tab === 'timeline') renderTimeline(main, { idea, rerender });
  else renderIdeaDashboard(main, { idea, rerender });

  mount.replaceChildren(h('div.workspace', side, main));
}

/* --- Chrome ------------------------------------------------------------- */

function sidebar(idea, tab, settings, rerender) {
  const nav = h('nav.side' + (settings.sidebarCollapsed ? '.is-collapsed' : ''),
    { 'aria-label': 'Idea sections' });

  nav.appendChild(h('div.side-head',
    h('div.eyebrow', { text: 'Idea' }),
    h('div.strong', {
      text: idea.title,
      style: { fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis' },
    })));

  for (const item of TABS) {
    nav.appendChild(h('button.side-link', {
      type: 'button',
      'aria-current': tab === item.key ? 'page' : null,
      title: item.label,
      onClick: () => goIdea(idea.id, item.key),
    }, icon(item.icon), h('span.side-label', { text: item.label })));
  }

  nav.appendChild(h('div.side-foot',
    h('button.side-link', {
      type: 'button', title: 'All ideas', onClick: goHome,
    }, icon('arrowLeft'), h('span.side-label', { text: 'All ideas' })),
    h('button.side-toggle', {
      type: 'button',
      'aria-label': settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
      onClick: () => { store.setSetting('sidebarCollapsed', !settings.sidebarCollapsed); rerender(); },
    }, icon('panelLeft'), h('span.side-label', { text: 'Collapse' }))));

  return nav;
}

function workHead(idea, tab, rerender) {
  const isDone = idea.status === 'completed';

  const menuButton = h('button.btn.btn-icon', {
    type: 'button', 'aria-label': 'Idea options',
    onClick: () => openMenu(menuButton, [
      { label: 'Edit idea', icon: 'edit', onSelect: () => openIdeaForm({ idea, onSaved: rerender }) },
      {
        label: isDone ? 'Mark as active' : 'Mark idea completed',
        icon: isDone ? 'refresh' : 'checkCircle',
        onSelect: () => { store.setIdeaStatus(idea.id, isDone ? 'active' : 'completed'); rerender(); },
      },
      'divider',
      {
        label: 'Delete idea', icon: 'trash', danger: true,
        async onSelect() {
          const yes = await confirmDialog({
            title: `Delete "${idea.title}"?`,
            message: 'Its tasks, notes and timeline go with it. This cannot be undone.',
            confirmLabel: 'Delete', danger: true,
          });
          if (!yes) return;
          store.removeIdea(idea.id);
          toast('Idea deleted.');
          goHome();
        },
      },
    ]),
  }, icon('more'));

  const primary = tab === 'tasks'
    ? h('button.btn.btn-primary', {
        type: 'button', onClick: () => openTaskForm({ idea, status: 'pending', onSaved: rerender }),
      }, icon('plus'), 'Add a task')
    : null;

  return h('header.work-head',
    h('div.grow',
      h('div.row.gap-8.wrap',
        h('h1.work-title', { text: idea.title }),
        idea.priority != null ? h('span.prio-badge', { text: '#' + idea.priority }) : null,
        isDone ? h('span.chip.chip-ok', icon('check'), 'Completed') : null),
      idea.description ? h('p.work-desc', { text: idea.description }) : null),
    h('div.work-actions', primary, menuButton));
}

/* --- Dashboard tab ------------------------------------------------------ */

function renderIdeaDashboard(main, { idea, rerender }) {
  const stats = store.ideaStats(idea);
  const timeline = store.ideaTimeline(idea);
  const today = todayISO();

  const page = h('div.page');

  /* Rings ---------------------------------------------------------------- */
  let daysValue = '—', daysPercent = 0, daysNote = 'No timeline yet — schedule tasks on the Timeline tab', daysUnit = '';
  if (timeline.end) {
    const remaining = daysBetween(today, timeline.end) + 1;
    const span = Math.max(1, daysBetween(timeline.start, timeline.end) + 1);
    const elapsed = Math.min(span, Math.max(0, daysBetween(timeline.start, today)));
    daysPercent = (elapsed / span) * 100;
    if (remaining > 0) {
      daysValue = remaining; daysUnit = remaining === 1 ? 'day left' : 'days left';
      daysNote = `Finishes ${fmtDateLong(timeline.end)}`;
    } else {
      daysValue = 0; daysUnit = 'days left';
      daysNote = `Timeline ended ${fmtRelativeDay(timeline.end)}`;
      daysPercent = 100;
    }
  }

  page.appendChild(h('div.ring-grid',
    ringCard({
      value: stats.total, unit: stats.total === 1 ? 'task' : 'tasks',
      percent: stats.total ? (stats.open / stats.total) * 100 : 0,
      label: 'Tasks added',
      note: stats.total ? `${stats.open} still open · ${stats.inProgress} in progress` : 'Add your first task',
    }),
    ringCard({
      value: stats.done, unit: 'done',
      percent: stats.pct, color: 'var(--ok)',
      label: 'Tasks completed',
      note: stats.total ? `${stats.pct}% of this project` : '—',
    }),
    ringCard({
      value: daysValue, unit: daysUnit,
      percent: daysPercent, color: 'var(--warn)',
      label: 'Project runway',
      note: daysNote,
    })));

  /* Reminder about the long-form questions -------------------------------- */
  const missing = LONGFORM.filter(({ key }) => !idea[key]);
  if (missing.length) {
    page.appendChild(h('div.note-banner', { style: { marginBottom: '20px' } },
      icon('alert'),
      h('div.grow',
        h('div.n-title', { text: `${plural(missing.length, 'question')} still unanswered` }),
        h('div', { text: missing.map((m) => m.question).join('  ') })),
      h('button.btn.btn-sm', {
        type: 'button', text: 'Answer now',
        onClick: () => openIdeaForm({ idea, onSaved: rerender }),
      })));
  }

  /* Task panels ----------------------------------------------------------- */
  const live = idea.tasks.filter((t) => !t.archived && t.status !== 'done');
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  const onDay = (task, day) => {
    if (task.due === day) return true;
    if (!task.start) return false;
    const end = addDays(task.start, Math.max(1, task.days || 1) - 1);
    return task.start <= day && day <= end;
  };
  const overlapsWeek = (task) => {
    if (task.due && task.due >= weekStart && task.due <= weekEnd) return true;
    if (!task.start) return false;
    const end = addDays(task.start, Math.max(1, task.days || 1) - 1);
    return task.start <= weekEnd && end >= weekStart;
  };

  const todayTasks = live.filter((t) => onDay(t, today));
  const weekTasks = live.filter((t) => overlapsWeek(t) && !todayTasks.includes(t));
  const unscheduled = live.filter((t) => !t.start && !t.due).sort((a, b) => a.createdAt - b.createdAt);
  const overdue = live.filter((t) => t.due && t.due < today);

  const grid = h('div.panel-grid');

  grid.appendChild(taskPanel({
    title: 'Today', badge: todayTasks.length, tasks: todayTasks, idea, rerender,
    empty: 'Nothing scheduled for today.',
  }));

  grid.appendChild(taskPanel({
    title: 'Coming up this week', badge: weekTasks.length, tasks: weekTasks, idea, rerender,
    empty: 'The rest of the week is clear.',
  }));

  if (overdue.length) {
    grid.appendChild(taskPanel({
      title: 'Overdue', badge: overdue.length, tasks: overdue, idea, rerender, tone: 'danger',
      empty: '',
    }));
  }

  grid.appendChild(taskPanel({
    title: 'No timeline yet', badge: unscheduled.length, tasks: unscheduled, idea, rerender,
    empty: 'Every open task has a date.',
    hint: 'In the order you added them.',
    action: h('button.btn.btn-sm', {
      type: 'button', onClick: () => goIdea(idea.id, 'timeline'),
    }, icon('gantt'), 'Schedule'),
  }));

  page.appendChild(grid);

  /* The three questions ---------------------------------------------------- */
  const qa = h('div.panel', { style: { marginTop: '16px' } },
    h('div.panel-head',
      h('h3', { text: 'Why this project exists' }),
      h('button.btn.btn-sm.btn-ghost', {
        type: 'button', onClick: () => openIdeaForm({ idea, onSaved: rerender }),
      }, icon('edit'), 'Edit')),
    h('div.panel-body.flush',
      h('div.qa-list', ...LONGFORM.map(({ key, question }) => h('div.qa-item',
        h('div.qa-q', { text: question }),
        h('div.qa-a' + (idea[key] ? '' : '.is-missing'), {
          text: idea[key] || 'Not answered yet — this is the bit that keeps the project honest.',
        }))))));

  page.appendChild(qa);
  main.appendChild(page);
}

function taskPanel({ title, badge, tasks, idea, rerender, empty, hint, action, tone }) {
  const head = h('div.panel-head',
    h('div.row.gap-8',
      h('h3', { text: title }),
      h('span.chip' + (tone === 'danger' ? '.chip-danger' : ''), { text: String(badge) })),
    action || null);

  const body = h('div.panel-body.flush');

  if (!tasks.length) {
    body.appendChild(h('div.empty-inline', { text: empty }));
  } else {
    for (const task of tasks) {
      const line = h('div.task-line' + (task.status === 'done' ? '.is-done' : ''), {
        role: 'button', tabIndex: 0,
        onClick: () => openTaskDetail({ idea, task, onSaved: rerender }),
        onKeydown: (event) => {
          if (event.key === 'Enter') openTaskDetail({ idea, task, onSaved: rerender });
        },
      },
        h('span.dot', { style: { background: STATUS_META[task.status].color } }),
        h('span.t-name', { text: task.title }),
        task.priority ? h('span.chip.chip-primary', { text: 'Priority' }) : null,
        task.due ? h('span.meta-pill' + (task.due < todayISO() ? '.is-late' : ''),
          icon('calendar'), h('span', { text: fmtRelativeDay(task.due) })) : null);
      body.appendChild(line);
    }
  }

  if (hint) body.appendChild(h('div.tiny.dim', { text: hint, style: { padding: '10px 16px' } }));
  return h('div.panel', head, body);
}
