/* Tasks tab: Kanban board, drag + drop, task detail with comments, archive. */

import { h, frag, clamp, plural, todayISO, fmtRelativeDay, fmtTimestamp, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { openModal, field, toast, confirmDialog, openMenu } from '../ui.js';
import * as store from '../store.js';
import { TASK_STATUS, STATUS_META } from '../store.js';

/* ==========================================================================
   Board
   ========================================================================== */

export function renderBoard(main, { idea, rerender }) {
  const settings = store.getSettings();
  const showArchive = !!settings.showArchive;
  const archived = store.archivedTasks(idea);

  main.appendChild(h('div.board-tools',
    h('div.grow'),
    h('button.btn.btn-sm' + (showArchive ? '.btn-soft' : ''), {
      type: 'button',
      'aria-pressed': String(showArchive),
      onClick: () => { store.setSetting('showArchive', !showArchive); rerender(); },
    }, icon('archive'), showArchive ? 'Hide archive' : `Show archive (${archived.length})`)));

  const board = h('div.board' + (showArchive ? '.with-archive' : ''));
  for (const status of TASK_STATUS) board.appendChild(column({ idea, status, rerender }));
  if (showArchive) board.appendChild(archiveColumn({ idea, archived, rerender }));

  main.appendChild(board);
  wireDragAndDrop(board, { idea, rerender });
}

function column({ idea, status, rerender }) {
  const meta = STATUS_META[status];
  const tasks = store.tasksInColumn(idea, status);

  const body = h('div.column-body', { dataset: { drop: status } });
  for (const task of tasks) body.appendChild(taskCard({ idea, task, status, rerender }));
  if (!tasks.length) body.appendChild(h('div.tiny.dim.center', { text: 'Nothing here', style: { padding: '14px 0' } }));

  const col = h('div.column', { dataset: { status } },
    h('div.column-head',
      h('span.swatch', { style: { background: meta.color } }),
      h('h3', { text: meta.label }),
      h('span.count', { text: String(tasks.length) })),
    body,
    h('div.column-foot',
      h('button.placeholder-add', {
        type: 'button',
        onClick: () => openTaskForm({ idea, status, onSaved: rerender }),
      }, icon('plus'), `Add ${status === 'pending' ? 'a task' : 'here'}`)));

  col.style.setProperty('--col', meta.color);
  return col;
}

function taskCard({ idea, task, status, rerender }) {
  const pinned = status === 'pending' && task.priority;
  const late = task.due && task.due < todayISO() && task.status !== 'done';
  const soon = task.due && !late && task.due <= todayISO();

  const card = h('div.tcard' + (pinned ? '.is-priority' : '') + (task.status === 'done' ? '.is-done' : ''), {
    dataset: { taskId: task.id, pinned: pinned ? '1' : '' },
    role: 'button', tabIndex: 0,
    onClick: () => openTaskDetail({ idea, task, onSaved: rerender }),
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openTaskDetail({ idea, task, onSaved: rerender });
      }
    },
  },
    h('div.tcard-title', { text: task.title }));

  const meta = h('div.tcard-meta');
  if (task.priority) meta.appendChild(h('span.chip.chip-primary', icon('flag'), 'Priority'));
  if (task.due) {
    meta.appendChild(h('span.meta-pill' + (late ? '.is-late' : soon ? '.is-soon' : ''),
      icon('calendar'), h('span', { text: fmtRelativeDay(task.due) })));
  }
  if (task.start && task.days) {
    meta.appendChild(h('span.meta-pill', icon('clock'),
      h('span', { text: `${fmtDate(task.start)} · ${plural(task.days, 'day')}` })));
  }
  if (task.notes.length) {
    meta.appendChild(h('span.meta-pill', icon('message'), h('span', { text: String(task.notes.length) })));
  }
  if (meta.childElementCount) card.appendChild(meta);

  if (pinned) card.title = 'Priority task — pinned to the top of Pending';
  return card;
}

function archiveColumn({ idea, archived, rerender }) {
  const body = h('div.column-body', { dataset: { drop: 'archive' } });

  if (!archived.length) {
    body.appendChild(h('div.tiny.dim.center', { text: 'Nothing archived yet', style: { padding: '14px 0' } }));
  }

  for (const task of archived) {
    body.appendChild(h('div.tcard.is-done', {
      dataset: { taskId: task.id },
      role: 'button', tabIndex: 0,
      onClick: () => openTaskDetail({ idea, task, onSaved: rerender }),
    },
      h('div.tcard-title', { text: task.title }),
      h('div.tcard-meta',
        h('span.meta-pill', icon('check'),
          h('span', { text: task.completedAt ? fmtTimestamp(task.completedAt) : 'Completed' })),
        h('button.btn.btn-xs', {
          type: 'button',
          onClick: (event) => {
            event.stopPropagation();
            store.updateTask(idea.id, task.id, { archived: false, status: 'done', completedAt: Date.now() });
            toast('Task restored to Completed.');
            rerender();
          },
        }, icon('refresh'), 'Restore'))));
  }

  const col = h('div.column', { dataset: { status: 'archive' } },
    h('div.column-head',
      h('span.swatch', { style: { background: 'var(--text-3)' } }),
      h('h3', { text: 'Archive' }),
      h('span.count', { text: String(archived.length) })),
    body);
  col.style.setProperty('--col', 'var(--text-3)');
  return col;
}

/* ==========================================================================
   Drag and drop — pointer based, so it works with a mouse and with a finger.
   Cards use `touch-action: pan-y`, which lets the page scroll vertically while
   a sideways drag (the one that moves a card between columns) reaches us.
   A long press starts a drag too, for reordering inside a column.
   ========================================================================== */

function wireDragAndDrop(board, { idea, rerender }) {
  let drag = null;
  let autoScroll = null;

  board.addEventListener('pointerdown', onDown);

  function onDown(event) {
    if (event.button != null && event.button > 0) return;
    const card = event.target.closest?.('.tcard');
    if (!card || !board.contains(card)) return;
    if (event.target.closest('button')) return;          // Restore / menu buttons
    if (card.dataset.pinned === '1') return;             // priority tasks stay put
    if (card.closest('.column')?.dataset.status === 'archive') return;

    const rect = card.getBoundingClientRect();
    drag = {
      card,
      taskId: card.dataset.taskId,
      pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      width: rect.width,
      active: false,
      clone: null,
      marker: null,
      moved: false,
      holdTimer: setTimeout(() => { if (drag && !drag.active) begin(event.clientX, event.clientY); }, 350),
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function begin(x, y) {
    drag.active = true;
    clearTimeout(drag.holdTimer);

    const clone = drag.card.cloneNode(true);
    clone.classList.add('is-dragging-clone');
    clone.style.setProperty('--w', drag.width + 'px');
    document.getElementById('drag-layer').appendChild(clone);

    drag.clone = clone;
    drag.marker = h('div.drop-line');
    drag.card.classList.add('is-ghost');
    document.body.classList.add('is-dragging');
    try { drag.card.setPointerCapture(drag.pointerId); } catch {}
    position(x, y);
  }

  function position(x, y) {
    drag.clone.style.left = `${x - drag.offsetX}px`;
    drag.clone.style.top = `${y - drag.offsetY}px`;
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.active) {
      const dist = Math.hypot(dx, dy);
      if (dist < 7) return;
      const sideways = Math.abs(dx) > Math.abs(dy);
      if (event.pointerType !== 'touch' || sideways) begin(event.clientX, event.clientY);
      else { cleanup(); return; }                       // let the column scroll
    }

    event.preventDefault();
    position(event.clientX, event.clientY);
    drag.moved = true;
    showTarget(event.clientX, event.clientY);
    edgeScroll(event.clientX);
  }

  function showTarget(x, y) {
    const under = document.elementFromPoint(x, y);
    const body = under?.closest?.('.column-body');

    board.querySelectorAll('.column.is-over').forEach((c) => c.classList.remove('is-over'));
    drag.marker.remove();
    drag.dropStatus = null;

    if (!body || !board.contains(body)) return;
    const status = body.dataset.drop;
    body.closest('.column').classList.add('is-over');
    drag.dropStatus = status;

    if (status === 'archive') return;

    const cards = [...body.querySelectorAll('.tcard')].filter((c) => c !== drag.card);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { index = i; break; }
    }

    // Priority cards are pinned to the top of Pending; never drop above them.
    const pinnedCount = status === 'pending'
      ? cards.filter((c) => c.dataset.pinned === '1').length
      : 0;
    index = Math.max(index, pinnedCount);

    drag.dropIndex = index;
    if (index >= cards.length) body.appendChild(drag.marker);
    else body.insertBefore(drag.marker, cards[index]);
  }

  function edgeScroll(x) {
    const scroller = board.scrollWidth > board.clientWidth ? board : null;
    cancelAnimationFrame(autoScroll);
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const margin = 64;
    let delta = 0;
    if (x < rect.left + margin) delta = -14;
    else if (x > rect.right - margin) delta = 14;
    if (!delta) return;
    const step = () => {
      scroller.scrollLeft += delta;
      autoScroll = requestAnimationFrame(step);
    };
    autoScroll = requestAnimationFrame(step);
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    const status = drag.dropStatus;
    const index = drag.dropIndex;
    const taskId = drag.taskId;

    cleanup();
    if (!wasActive) return;

    if (status === 'archive') {
      store.updateTask(idea.id, taskId, { status: 'done', archived: true, completedAt: Date.now() });
      toast('Task archived.');
      rerender();
      return;
    }
    if (status) {
      store.moveTask(idea.id, taskId, status, index);
      rerender();
    }
  }

  function onCancel() { cleanup(); }

  function cleanup() {
    if (!drag) return;
    clearTimeout(drag.holdTimer);
    cancelAnimationFrame(autoScroll);
    drag.clone?.remove();
    drag.marker?.remove();
    drag.card.classList.remove('is-ghost');
    try { drag.card.releasePointerCapture(drag.pointerId); } catch {}
    board.querySelectorAll('.column.is-over').forEach((c) => c.classList.remove('is-over'));
    document.body.classList.remove('is-dragging');
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }
}

/* ==========================================================================
   Add a task
   ========================================================================== */

export function openTaskForm({ idea, status = 'pending', onSaved }) {
  const title = h('input.input', { placeholder: 'What needs doing?', required: true, maxLength: 160 });
  const priority = h('input', { type: 'checkbox' });
  const due = h('input.input', { type: 'date' });
  const start = h('input.input', { type: 'date' });
  const days = h('input.input', { type: 'number', min: '1', max: '365', placeholder: 'e.g. 3' });
  const note = h('textarea.textarea', { placeholder: 'Anything you want to remember about it (optional)', rows: 2 });
  const error = h('div.error-text');

  const body = h('div.form-grid',
    field('Task', title),
    h('label.check', priority, h('span', { text: 'Priority task' })),
    h('div.form-2col',
      field('Completion date (optional)', due),
      field('Start date (optional)', start)),
    field('Estimated days (optional)', days, 'Used to draw the bar on the timeline.'),
    field('First note (optional)', note),
    error);

  openModal({
    title: `Add a task to ${STATUS_META[status].label}`,
    body,
    footer: (close) => frag(
      h('button.btn', { type: 'button', text: 'Cancel', onClick: () => close() }),
      h('button.btn.btn-primary', {
        type: 'button', text: 'Add task',
        onClick: () => {
          if (!title.value.trim()) { error.textContent = 'Give the task a name.'; title.focus(); return; }
          const task = store.addTask(idea.id, {
            title: title.value.trim(),
            status,
            priority: priority.checked,
            due: due.value || null,
            start: start.value || null,
            days: days.value ? clamp(Number(days.value), 1, 365) : (start.value ? 1 : null),
          });
          if (note.value.trim()) store.addNote(idea.id, task.id, note.value);
          close();
          toast('Task added.');
          onSaved?.(task);
        },
      })),
  });
}

/* ==========================================================================
   Task detail — status, schedule, comments
   ========================================================================== */

export function openTaskDetail({ idea, task, onSaved }) {
  const refresh = () => onSaved?.(task);

  /* Title ---------------------------------------------------------------- */
  const title = h('input.input', {
    value: task.title,
    onChange: () => {
      const next = title.value.trim();
      if (!next) { title.value = task.title; return; }
      store.updateTask(idea.id, task.id, { title: next });
      refresh();
    },
  });

  /* Status --------------------------------------------------------------- */
  const statusPicker = h('div.status-picker');
  const paintStatus = () => {
    statusPicker.replaceChildren(...TASK_STATUS.map((status) => {
      const button = h('button.status-opt', {
        type: 'button',
        'aria-pressed': String(task.status === status && !task.archived),
        onClick: () => {
          store.moveTask(idea.id, task.id, status);
          paintStatus();
          paintArchive();
          refresh();
        },
      }, h('span.swatch'), h('span', { text: STATUS_META[status].label }));
      button.style.setProperty('--col', STATUS_META[status].color);
      return button;
    }));
  };
  paintStatus();

  /* Priority + dates ------------------------------------------------------ */
  const priority = h('input', {
    type: 'checkbox', checked: task.priority,
    onChange: () => {
      store.updateTask(idea.id, task.id, { priority: priority.checked });
      if (priority.checked && task.status === 'pending') store.moveTask(idea.id, task.id, 'pending', 0);
      refresh();
    },
  });

  const due = h('input.input', {
    type: 'date', value: task.due || '',
    onChange: () => { store.updateTask(idea.id, task.id, { due: due.value || null }); refresh(); },
  });

  const start = h('input.input', {
    type: 'date', value: task.start || '',
    onChange: () => {
      const days = task.days || 1;
      store.updateTask(idea.id, task.id, { start: start.value || null, days: start.value ? days : task.days });
      duration.value = task.days || '';
      refresh();
    },
  });

  const duration = h('input.input', {
    type: 'number', min: '1', max: '365', value: task.days || '',
    onChange: () => {
      store.updateTask(idea.id, task.id, { days: duration.value ? clamp(Number(duration.value), 1, 365) : null });
      refresh();
    },
  });

  /* Comments -------------------------------------------------------------- */
  const commentList = h('div.stack.gap-8');
  const commentBox = h('textarea.textarea', { placeholder: 'Add a note or comment…', rows: 2 });

  const paintComments = () => {
    commentList.replaceChildren();
    if (!task.notes.length) {
      commentList.appendChild(h('div.tiny.dim', { text: 'No notes yet.' }));
      return;
    }
    for (const note of [...task.notes].sort((a, b) => b.createdAt - a.createdAt)) {
      commentList.appendChild(h('div.comment',
        h('div.comment-body', { text: note.text }),
        h('div.comment-foot',
          h('span', { text: fmtTimestamp(note.createdAt) }),
          h('div.grow'),
          h('button.btn.btn-xs.btn-ghost', {
            type: 'button',
            onClick: () => { store.removeNote(idea.id, task.id, note.id); paintComments(); refresh(); },
          }, icon('trash'), 'Delete'))));
    }
  };
  paintComments();

  const addComment = () => {
    if (!commentBox.value.trim()) return;
    store.addNote(idea.id, task.id, commentBox.value);
    commentBox.value = '';
    paintComments();
    refresh();
  };

  /* Archive row ----------------------------------------------------------- */
  const archiveRow = h('div.row.gap-8.wrap');
  const paintArchive = () => {
    archiveRow.replaceChildren();
    if (task.archived) {
      archiveRow.append(
        h('span.chip', icon('archive'), 'Archived'),
        h('button.btn.btn-sm', {
          type: 'button',
          onClick: () => {
            store.updateTask(idea.id, task.id, { archived: false, status: 'done', completedAt: Date.now() });
            paintArchive(); refresh();
          },
        }, icon('refresh'), 'Restore to board'));
    } else if (task.status === 'done') {
      archiveRow.append(
        h('span.tiny.dim', { text: `Archives automatically ${store.getSettings().archiveMinutes} minutes after completion.` }),
        h('button.btn.btn-sm', {
          type: 'button',
          onClick: () => {
            store.updateTask(idea.id, task.id, { archived: true });
            paintArchive(); refresh();
          },
        }, icon('archive'), 'Archive now'));
    }
  };
  paintArchive();

  const body = h('div.form-grid',
    field('Task', title),

    h('div.field',
      h('div.label', { text: 'Status' }),
      statusPicker,
      archiveRow),

    h('label.check', priority, h('span', { text: 'Priority task (pinned to the top of Pending)' })),

    h('div.form-2col',
      field('Completion date', due),
      field('Start date', start)),
    field('Estimated days', duration, 'Drives the bar on the Gantt chart.'),

    h('div.field',
      h('div.label', { text: `Notes & comments (${task.notes.length})` }),
      commentBox,
      h('div.row.gap-8',
        h('button.btn.btn-sm.btn-soft', { type: 'button', onClick: addComment }, icon('plus'), 'Add note')),
      h('div', { style: { height: '6px' } }),
      commentList),

    h('div.tiny.dim', { text: `Added ${fmtTimestamp(task.createdAt)}` +
      (task.completedAt ? ` · Completed ${fmtTimestamp(task.completedAt)}` : '') }));

  openModal({
    title: 'Task',
    body,
    footer: (close) => frag(
      h('button.btn.btn-danger', {
        type: 'button',
        async onClick() {
          const yes = await confirmDialog({
            title: 'Delete this task?',
            message: `"${task.title}" and its notes will be removed.`,
            confirmLabel: 'Delete', danger: true,
          });
          if (!yes) return;
          store.removeTask(idea.id, task.id);
          close();
          toast('Task deleted.');
          onSaved?.();
        },
      }, icon('trash'), 'Delete'),
      h('div.grow'),
      h('button.btn.btn-primary', { type: 'button', text: 'Done', onClick: () => close() })),
    onClose: () => onSaved?.(),
  });
}
