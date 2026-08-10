/* Timeline tab: an editable Gantt chart with AI-assisted scheduling. */

import {
  h, frag, clamp, plural, todayISO, addDays, daysBetween, fromISO,
  isWeekend, startOfWeek, fmtDate, fmtDateLong,
} from '../util.js';
import { icon } from '../icons.js';
import { toast, confirmDialog, openModal, field } from '../ui.js';
import * as store from '../store.js';
import { STATUS_META } from '../store.js';
import { generateTimeline } from '../ai.js';
import { openTaskDetail } from './tasks.js';

const ROW_H = 42;
const DAY_W = 34;      // px per day in day view
const WEEK_W = 62;     // px per week in week view

let zoom = 'day';      // survives re-renders within a session

export function renderTimeline(main, { idea, rerender }) {
  const page = h('div.stack');
  page.appendChild(aiPanelWrap(idea, rerender));
  page.appendChild(tools(idea, rerender));
  page.appendChild(chart(idea, rerender));
  main.appendChild(page);
}

/* --- AI panel ----------------------------------------------------------- */

function aiPanelWrap(idea, rerender) {
  const wrap = h('div', { style: { padding: '0 var(--gutter)' } });
  wrap.appendChild(aiPanel(idea, rerender));
  return wrap;
}

function aiPanel(idea, rerender) {
  const schedulable = idea.tasks.filter((t) => !t.archived);
  const unscheduled = schedulable.filter((t) => !(t.start && t.days));
  const hasKey = !!store.getSettings().apiKey;

  const button = h('button.btn.btn-primary', { type: 'button' },
    icon('sparkles'), schedulable.length === unscheduled.length ? 'Generate timeline' : 'Regenerate timeline');

  const setBusy = (isBusy) => {
    button.disabled = isBusy;
    button.replaceChildren(...(isBusy
      ? [h('span.spinner'), document.createTextNode('Planning…')]
      : [icon('sparkles'), document.createTextNode('Generate timeline')]));
  };

  button.addEventListener('click', () => openPlanner(idea, rerender, setBusy));

  return h('div.ai-panel',
    h('div.ai-icon', icon('sparkles')),
    h('div.grow',
      h('h3', { text: 'Draft a realistic timeline' }),
      h('p.small.muted', {
        text: schedulable.length
          ? `Reads your project brief and ${plural(schedulable.length, 'task')}, sorts them into phases, ` +
            `estimates how long each one really takes and lays them out around your weekends.` +
            (hasKey ? ' Claude is connected, so it will do the judgement call.' : '')
          : 'Add some tasks on the Tasks tab first, then come back and this will lay them out for you.',
      })),
    schedulable.length ? button : null);
}

function openPlanner(idea, rerender, setBusy) {
  const start = h('input.input', { type: 'date', value: idea.startDate || todayISO() });
  const weekends = h('input', { type: 'checkbox', checked: true });
  const onlyNew = h('input', {
    type: 'checkbox',
    checked: idea.tasks.some((t) => t.start && t.days),
  });
  const status = h('div.small.muted');

  openModal({
    title: 'Generate a timeline',
    body: h('div.form-grid',
      field('Project start date', start),
      h('label.check', weekends, h('span', { text: 'Keep weekends free' })),
      h('label.check', onlyNew, h('span', { text: 'Only schedule tasks that have no dates yet' })),
      h('p.hint', {
        text: store.getSettings().apiKey
          ? 'Claude will draft the plan from your project brief. If the request fails, the built-in planner takes over.'
          : 'The built-in planner runs on this device. Add an Anthropic API key in Settings if you would like Claude to draft it instead.',
      }),
      status),

    footer: (close) => frag(
      h('button.btn', { type: 'button', text: 'Cancel', onClick: () => close() }),
      h('button.btn.btn-primary', {
        type: 'button', text: 'Generate',
        async onClick(event) {
          const go = event.currentTarget;
          go.disabled = true;
          go.replaceChildren(h('span.spinner'), document.createTextNode('Planning…'));
          setBusy?.(true);

          const options = {
            startDate: start.value || todayISO(),
            skipWeekends: weekends.checked,
            onlyUnscheduled: onlyNew.checked,
            apiKey: store.getSettings().apiKey,
          };

          try {
            const result = await generateTimeline(idea, options);
            if (!result.plan.length) {
              status.textContent = result.summary || 'Nothing to schedule.';
              go.disabled = false;
              go.textContent = 'Generate';
              setBusy?.(false);
              return;
            }

            const before = idea.tasks.map((t) => ({ id: t.id, start: t.start, days: t.days }));
            store.updateIdea(idea.id, { startDate: options.startDate });
            for (const item of result.plan) {
              store.updateTask(idea.id, item.taskId, { start: item.start, days: item.days });
            }

            close();
            rerender();
            toast(
              `${result.source === 'claude' ? 'Claude' : 'Planner'}: ${result.summary}`,
              {
                action: 'Undo',
                duration: 9000,
                onAction: () => {
                  for (const snap of before) store.updateTask(idea.id, snap.id, { start: snap.start, days: snap.days });
                  rerender();
                  toast('Timeline restored.');
                },
              });
          } catch (err) {
            console.error(err);
            status.textContent = 'Could not build a timeline: ' + err.message;
            go.disabled = false;
            go.textContent = 'Generate';
          } finally {
            setBusy?.(false);
          }
        },
      })),
    onClose: () => setBusy?.(false),
  });
}

/* --- Toolbar ------------------------------------------------------------ */

function tools(idea, rerender) {
  const startInput = h('input.input', {
    type: 'date', value: idea.startDate || '',
    style: { width: 'auto' },
    onChange: () => { store.updateIdea(idea.id, { startDate: startInput.value || null }); rerender(); },
  });

  const span = store.ideaTimeline(idea);

  return h('div.gantt-tools', { style: { paddingTop: '18px' } },
    h('div.segmented', { role: 'group', 'aria-label': 'Zoom' },
      h('button', {
        type: 'button', 'aria-pressed': String(zoom === 'day'), text: 'Days',
        onClick: () => { zoom = 'day'; rerender(); },
      }),
      h('button', {
        type: 'button', 'aria-pressed': String(zoom === 'week'), text: 'Weeks',
        onClick: () => { zoom = 'week'; rerender(); },
      })),

    h('label.row.gap-8.small.muted', h('span', { text: 'Project starts' }), startInput),

    span.end
      ? h('span.chip.chip-info', icon('calendar'),
          `${fmtDate(span.start)} → ${fmtDate(span.end)} · ${plural(daysBetween(span.start, span.end) + 1, 'day')}`)
      : h('span.chip', { text: 'No tasks scheduled yet' }),

    h('div.grow'),

    span.scheduled
      ? h('button.btn.btn-sm', {
          type: 'button',
          async onClick() {
            const yes = await confirmDialog({
              title: 'Clear all dates?',
              message: 'Every task keeps its title, notes and column — only the timeline dates are removed.',
              confirmLabel: 'Clear dates', danger: true,
            });
            if (!yes) return;
            for (const task of idea.tasks) store.updateTask(idea.id, task.id, { start: null, days: null });
            rerender();
            toast('Timeline cleared.');
          },
        }, icon('refresh'), 'Clear dates')
      : null);
}

/* --- Chart -------------------------------------------------------------- */

function chart(idea, rerender) {
  const tasks = idea.tasks.filter((t) => !t.archived);
  const wrap = h('div.gantt-wrap');

  if (!tasks.length) {
    wrap.appendChild(h('div.empty',
      h('div.empty-art', icon('gantt')),
      h('h2', { text: 'No tasks to schedule' }),
      h('p', { text: 'Add tasks on the Tasks tab and they will show up here, ready to be dragged around a calendar.' })));
    return wrap;
  }

  const today = todayISO();
  const scheduled = tasks.filter((t) => t.start && t.days);

  let first = idea.startDate || today;
  let last = addDays(today, 21);
  for (const task of scheduled) {
    if (task.start < first) first = task.start;
    const end = addDays(task.start, task.days - 1);
    if (end > last) last = end;
  }
  if (today < first) first = today;

  const rangeStart = startOfWeek(addDays(first, -3));
  let rangeEnd = addDays(last, 7);
  if (daysBetween(rangeStart, rangeEnd) < 27) rangeEnd = addDays(rangeStart, 27);
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1;

  const perDay = zoom === 'day' ? DAY_W : WEEK_W / 7;
  const canvasWidth = totalDays * perDay;

  /* Header ---------------------------------------------------------------- */
  const months = h('div.g-head-months');
  const cells = h('div.g-head-cells');

  if (zoom === 'day') {
    let cursor = 0;
    while (cursor < totalDays) {
      const iso = addDays(rangeStart, cursor);
      const date = fromISO(iso);
      const remainingInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() - date.getDate() + 1;
      const width = Math.min(remainingInMonth, totalDays - cursor);
      months.appendChild(h('div.g-month', {
        style: { width: width * perDay + 'px' },
        text: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      }));
      cursor += width;
    }
    for (let i = 0; i < totalDays; i++) {
      const iso = addDays(rangeStart, i);
      cells.appendChild(h('div.g-cell' + (isWeekend(iso) ? '.is-weekend' : '') + (iso === today ? '.is-today' : ''), {
        style: { width: perDay + 'px' },
        text: String(fromISO(iso).getDate()),
        title: fmtDateLong(iso),
      }));
    }
  } else {
    const weeks = Math.ceil(totalDays / 7);
    let cursor = 0;
    while (cursor < weeks) {
      const iso = addDays(rangeStart, cursor * 7);
      const date = fromISO(iso);
      let count = 0;
      while (cursor + count < weeks) {
        const probe = fromISO(addDays(rangeStart, (cursor + count) * 7));
        if (probe.getMonth() !== date.getMonth()) break;
        count++;
      }
      months.appendChild(h('div.g-month', {
        style: { width: count * WEEK_W + 'px' },
        text: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      }));
      cursor += count;
    }
    for (let i = 0; i < weeks; i++) {
      const iso = addDays(rangeStart, i * 7);
      const isThisWeek = startOfWeek(today) === iso;
      cells.appendChild(h('div.g-cell' + (isThisWeek ? '.is-today' : ''), {
        style: { width: WEEK_W + 'px' },
        text: fmtDate(iso, { day: 'numeric', month: 'short' }),
        title: `Week of ${fmtDateLong(iso)}`,
      }));
    }
  }

  /* Rows ------------------------------------------------------------------ */
  const names = h('div.gantt-names', h('div.g-name-head', { text: 'Task' }));
  const rows = h('div.g-rows');

  const grid = h('div.g-grid');
  if (zoom === 'day') {
    for (let i = 0; i <= totalDays; i++) {
      grid.appendChild(h('div.v', { style: { left: i * perDay + 'px' } }));
      if (i < totalDays && isWeekend(addDays(rangeStart, i))) {
        grid.appendChild(h('div.weekend', { style: { left: i * perDay + 'px', width: perDay + 'px' } }));
      }
    }
  } else {
    for (let i = 0; i <= Math.ceil(totalDays / 7); i++) {
      grid.appendChild(h('div.v', { style: { left: i * WEEK_W + 'px' } }));
    }
  }
  rows.appendChild(grid);

  const ordered = [...tasks].sort((a, b) => {
    if (!!a.start !== !!b.start) return a.start ? -1 : 1;
    if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.createdAt - b.createdAt;
  });

  for (const task of ordered) {
    names.appendChild(h('div.g-name', {
      role: 'button', tabIndex: 0, title: task.title,
      onClick: () => openTaskDetail({ idea, task, onSaved: rerender }),
    },
      h('span.dot', { style: { background: STATUS_META[task.status].color } }),
      h('span.txt', { text: task.title })));

    const row = h('div.g-row');

    if (task.start && task.days) {
      row.appendChild(bar({ idea, task, rangeStart, perDay, rerender }));
    } else {
      row.appendChild(h('div.g-unscheduled',
        h('span', { text: 'Not scheduled' }),
        h('button.btn.btn-xs', {
          type: 'button',
          onClick: () => {
            store.updateTask(idea.id, task.id, { start: idea.startDate || todayISO(), days: 3 });
            rerender();
          },
        }, icon('plus'), 'Place on timeline')));
    }
    rows.appendChild(row);
  }

  const todayOffset = daysBetween(rangeStart, today) * perDay;
  const todayLine = todayOffset >= 0 && todayOffset <= canvasWidth
    ? h('div.g-today', { style: { left: todayOffset + 'px' }, title: 'Today' })
    : null;

  const canvas = h('div.gantt-canvas', { style: { width: canvasWidth + 'px' } },
    h('div.g-head', months, cells),
    h('div', { style: { position: 'relative' } }, rows, todayLine));

  const scroller = h('div.gantt-scroll', canvas);
  wrap.appendChild(h('div.gantt', names, scroller));
  wrap.appendChild(h('p.tiny.dim', { style: { marginTop: '10px' } },
    'Drag a bar to move it, drag its right edge to change how long it takes, or tap a task name to edit the details.'));

  // Scroll so that today is in view.
  requestAnimationFrame(() => { scroller.scrollLeft = Math.max(0, todayOffset - 160); });

  return wrap;
}

/* --- A draggable, resizable bar ---------------------------------------- */

function bar({ idea, task, rangeStart, perDay, rerender }) {
  const left = daysBetween(rangeStart, task.start) * perDay;
  const width = Math.max(perDay * task.days, 16);

  const statusClass = task.status === 'done' ? '.is-done'
    : task.status === 'hold' ? '.is-hold'
    : task.status === 'progress' ? '.is-progress' : '';

  const node = h('div.g-bar' + statusClass, {
    style: { left: left + 'px', width: (width - 3) + 'px' },
    title: `${task.title}\n${fmtDateLong(task.start)} → ${fmtDateLong(addDays(task.start, task.days - 1))} (${plural(task.days, 'day')})`,
  },
    h('span', { text: task.title }),
    h('span.handle', { 'aria-hidden': 'true' }));

  let drag = null;

  node.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button > 0) return;
    const resizing = event.target.classList.contains('handle');
    drag = {
      resizing, pointerId: event.pointerId,
      startX: event.clientX, origStart: task.start, origDays: task.days,
      moved: false, days: task.days, start: task.start,
    };
    node.setPointerCapture(event.pointerId);
    node.classList.add('is-dragging');
    event.preventDefault();
    event.stopPropagation();
  });

  node.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaDays = Math.round((event.clientX - drag.startX) / perDay);
    if (deltaDays === 0 && !drag.moved) return;
    drag.moved = true;

    if (drag.resizing) {
      drag.days = clamp(drag.origDays + deltaDays, 1, 365);
      node.style.width = (perDay * drag.days - 3) + 'px';
    } else {
      drag.start = addDays(drag.origStart, deltaDays);
      node.style.left = (daysBetween(rangeStart, drag.start) * perDay) + 'px';
    }
  });

  const finish = (event) => {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    node.classList.remove('is-dragging');
    const { moved, resizing, start, days } = drag;
    drag = null;
    if (!moved) { openTaskDetail({ idea, task, onSaved: rerender }); return; }
    store.updateTask(idea.id, task.id, resizing ? { days } : { start });
    rerender();
  };

  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', () => { drag = null; node.classList.remove('is-dragging'); rerender(); });

  return node;
}
