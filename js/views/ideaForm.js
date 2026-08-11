/* The "Add an Idea" / "Edit idea" modal. */

import { h, frag } from '../util.js';
import { openModal, field, toast, noteBanner } from '../ui.js';
import * as store from '../store.js';
import { LONGFORM } from '../store.js';

export function openIdeaForm({ idea = null, onSaved } = {}) {
  const isEdit = !!idea;

  const title = h('input.input', {
    placeholder: 'e.g. Recipe app for one-pan dinners',
    value: idea?.title || '', required: true, maxLength: 120,
  });

  const description = h('textarea.textarea', {
    placeholder: 'One or two lines you will still understand in six months.',
    value: idea?.description || '', required: true, rows: 3,
  });

  const longform = LONGFORM.map(({ key, question, placeholder }) => {
    const input = h('textarea.textarea', { placeholder, value: idea?.[key] || '', rows: 3 });
    return { key, question, input };
  });

  // Priority select — the list is always 1..(n+1) so there is never a gap.
  const others = store.getIdeas().filter((i) => i.id !== idea?.id && i.priority != null).length;
  const maxSlot = others + 1;
  const priority = h('select.select',
    h('option', { value: '', text: 'No priority — just capture it' }),
    ...Array.from({ length: maxSlot }, (_, index) => {
      const slot = index + 1;
      const taken = store.getIdeas().find((i) => i.priority === slot && i.id !== idea?.id);
      return h('option', {
        value: String(slot),
        text: `#${slot}${slot === 1 ? ' — top of the pile' : ''}${taken ? `  (pushes "${trim(taken.title)}" down)` : ''}`,
      });
    }));
  priority.value = idea?.priority != null ? String(idea.priority) : '';

  const error = h('div.error-text');

  const body = h('div.form-grid',
    field('Title', title),
    field('Description', description),

    h('div.stack.gap-12',
      noteBanner('Worth filling in',
        'These three answers are what turn an idea into a project. You can skip them now — the app will keep nudging you until they are done.'),
      ...longform.map(({ question, input }) => field(question, input))),

    field('Priority (optional)', priority,
      'Numbers stay in a tidy 1, 2, 3 run. Claiming a number that is taken pushes that idea — and everything below it — down one.'),

    error);

  const modal = openModal({
    title: isEdit ? 'Edit idea' : 'Add an Idea',
    body,
    footer: (close) => frag(
      h('button.btn', { type: 'button', text: 'Cancel', onClick: () => close() }),
      h('button.btn.btn-primary', {
        type: 'button',
        text: isEdit ? 'Save changes' : 'Add to inventory',
        onClick: () => submit(close),
      })),
  });

  function submit(close) {
    error.textContent = '';
    if (!title.value.trim()) { error.textContent = 'Give the idea a title.'; title.focus(); return; }
    if (!description.value.trim()) { error.textContent = 'Add a short description so future-you knows what this was.'; description.focus(); return; }

    const payload = {
      title: title.value.trim(),
      description: description.value.trim(),
      priority: priority.value === '' ? null : Number(priority.value),
    };
    for (const { key, input } of longform) payload[key] = input.value.trim();

    const saved = isEdit ? store.updateIdea(idea.id, payload) : store.addIdea(payload);

    const missing = LONGFORM.filter(({ key }) => !saved[key]).length;
    close();
    toast(isEdit ? 'Idea updated.'
                 : missing ? `Idea added — ${missing} long-form question${missing > 1 ? 's' : ''} still to answer.`
                           : 'Idea added.');
    onSaved?.(saved);
  }

  return modal;
}

function trim(text, max = 22) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
