/* Shared UI pieces: rings, modals, confirm dialogs, toasts, popup menus. */

import { h, frag, clear, clamp } from './util.js';
import { icon } from './icons.js';

/* --- Circular progress ------------------------------------------------- */

/**
 * @param {object} opts
 * @param {number} opts.value    big number in the middle
 * @param {number} opts.percent  0-100 fill
 * @param {string} opts.label    heading beside the ring
 * @param {string} opts.note     supporting line
 * @param {string} opts.unit     tiny caps label under the number
 * @param {string} opts.color    CSS colour for the arc
 */
export function ringCard({ value, percent = 0, label, note, unit, color, small = false }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const pct = clamp(Number(percent) || 0, 0, 100);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}: ${value}${unit ? ' ' + unit : ''} (${Math.round(pct)}%)`);
  svg.innerHTML =
    `<circle class="track" cx="50" cy="50" r="${R}" fill="none" stroke-width="9"/>` +
    `<circle class="bar" cx="50" cy="50" r="${R}" fill="none" stroke-width="9"
       stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/>`;

  const wrap = h('div.ring', svg,
    h('div.ring-center',
      h('div.ring-value', { text: String(value) }),
      unit ? h('div.ring-unit', { text: unit }) : null));

  if (color) wrap.style.setProperty('--ring-color', color);

  // Animate in on the next frame so the dash transition actually runs.
  requestAnimationFrame(() => {
    svg.querySelector('.bar').setAttribute('stroke-dashoffset', String(C - (C * pct) / 100));
  });

  return h('div.ring-card' + (small ? '.ring-sm' : ''), wrap,
    h('div.ring-meta',
      h('div.ring-label', { text: label }),
      note ? h('div.ring-note', { text: note }) : null));
}

/* --- Modal ------------------------------------------------------------- */

const modalRoot = () => document.getElementById('modal-root');
let openModals = 0;

/**
 * openModal({ title, body, footer, size, onClose }) → { close, el }
 * `body` and `footer` are nodes (or functions returning nodes given `close`).
 */
export function openModal({ title, body, footer, wide = false, onClose } = {}) {
  const scrim = h('div.modal-scrim', { role: 'dialog', 'aria-modal': 'true' });
  const modal = h('div.modal');
  if (wide) modal.style.width = 'min(900px, 100%)';

  const close = (result) => {
    if (!scrim.isConnected) return;
    scrim.remove();
    openModals = Math.max(0, openModals - 1);
    if (!openModals) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  };

  const head = h('div.modal-head',
    h('h2', { text: title || '' }),
    h('button.btn.btn-ghost.btn-icon.btn-sm', {
      type: 'button', 'aria-label': 'Close', onClick: () => close(),
    }, icon('x')));
  head.querySelector('h2').style.flex = '1';

  const bodyNode = typeof body === 'function' ? body(close) : body;
  const footNode = typeof footer === 'function' ? footer(close) : footer;

  modal.append(head, h('div.modal-body', bodyNode));
  if (footNode) modal.appendChild(h('div.modal-foot', footNode));
  scrim.appendChild(modal);

  scrim.addEventListener('pointerdown', (event) => {
    if (event.target === scrim) close();
  });
  document.addEventListener('keydown', onKey);

  modalRoot().appendChild(scrim);
  openModals++;
  document.body.style.overflow = 'hidden';

  const first = modal.querySelector('input, textarea, select, button.btn-primary');
  // Don't steal focus into a keyboard-popping input on touch devices.
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus();

  return { close, el: modal };
}

export function confirmDialog({
  title = 'Are you sure?', message = '', confirmLabel = 'Confirm',
  cancelLabel = 'Cancel', danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const handle = openModal({
      title,
      body: h('p.muted', { text: message, style: { fontSize: '14.5px', lineHeight: '1.6' } }),
      footer: (close) => frag(
        h('button.btn', { type: 'button', text: cancelLabel, onClick: () => { done(false); close(); } }),
        h('button.btn' + (danger ? '.btn-danger' : '.btn-primary'), {
          type: 'button', text: confirmLabel,
          onClick: () => { done(true); close(); },
        })),
      onClose: () => done(false),
    });
    handle.el.style.maxWidth = '440px';
  });
}

/* --- Toast ------------------------------------------------------------- */

export function toast(message, { action, onAction, duration = 3200 } = {}) {
  const root = document.getElementById('toast-root');
  const node = h('div.toast', h('span', { text: message }));

  if (action) {
    node.appendChild(h('button', {
      type: 'button', text: action,
      onClick: () => { onAction?.(); dismiss(); },
    }));
  }

  const dismiss = () => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  };

  root.appendChild(node);
  setTimeout(dismiss, duration);
  return dismiss;
}

/* --- Popup menu -------------------------------------------------------- */

/** items: [{ label, icon, danger, onSelect } | 'divider'] */
export function openMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = h('div.menu', { role: 'menu' });

  for (const item of items) {
    if (item === 'divider') { menu.appendChild(h('hr')); continue; }
    menu.appendChild(h('button' + (item.danger ? '.is-danger' : ''), {
      type: 'button', role: 'menuitem',
      onClick: () => { closeMenu(); item.onSelect?.(); },
    }, item.icon ? icon(item.icon) : null, h('span', { text: item.label })));
  }

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onAway, true);
    document.removeEventListener('keydown', onEsc, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
  };
  const onAway = (event) => { if (!menu.contains(event.target)) closeMenu(); };
  const onEsc = (event) => { if (event.key === 'Escape') closeMenu(); };

  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const left = clamp(rect.right - box.width, 8, innerWidth - box.width - 8);
  const below = rect.bottom + 6;
  const top = below + box.height > innerHeight - 8 ? Math.max(8, rect.top - box.height - 6) : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  setTimeout(() => {
    document.addEventListener('pointerdown', onAway, true);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
  }, 0);

  return closeMenu;
}

/* --- Small builders ---------------------------------------------------- */

export function field(label, control, hint) {
  const id = control.id || (control.id = 'f_' + Math.random().toString(36).slice(2, 8));
  return h('div.field',
    h('label', { htmlFor: id, text: label }),
    control,
    hint ? h('div.hint', { text: hint }) : null);
}

export function emptyState({ title, message, art = 'chest', action }) {
  return h('div.empty',
    h('div.empty-art', icon(art)),
    h('h2', { text: title }),
    message ? h('p', { text: message }) : null,
    action || null);
}

export function iconButton(name, { label, className = 'btn.btn-ghost.btn-icon.btn-sm', onClick, title } = {}) {
  return h('button.' + className.replace(/^\./, ''), {
    type: 'button', 'aria-label': label, title: title || label, onClick,
  }, icon(name));
}

export function noteBanner(title, message) {
  return h('div.note-banner', icon('alert'),
    h('div', h('div.n-title', { text: title }), h('div', { text: message })));
}

export { clear };
