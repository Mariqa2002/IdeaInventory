/* Sign-up (first run) and sign-in. Credentials never leave the device. */

import { h, frag } from '../util.js';
import { icon } from '../icons.js';
import { field, toast, confirmDialog } from '../ui.js';
import * as store from '../store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function renderAuth(mount, { onSignedIn }) {
  mount.replaceChildren(store.hasAccount() ? signInCard(onSignedIn) : signUpCard(onSignedIn));
}

function shell(title, subtitle, form, footer) {
  return h('div.auth-wrap',
    h('div.auth-card',
      h('div.auth-logo', icon('chest')),
      h('h1.auth-title', { text: title }),
      h('p.auth-sub', { text: subtitle }),
      form,
      footer || null));
}

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  button.replaceChildren(...(isBusy ? [h('span.spinner'), document.createTextNode('Working…')]
                                    : [document.createTextNode(label)]));
}

/* --- First run --------------------------------------------------------- */

function signUpCard(onSignedIn) {
  const email = h('input.input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true });
  const pass = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 6 characters', required: true });
  const confirm = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it once more', required: true });
  const error = h('div.error-text');
  const submit = h('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Create my inventory' });

  const form = h('form.auth-form', {
    async onSubmit(event) {
      event.preventDefault();
      error.textContent = '';

      if (!EMAIL_RE.test(email.value.trim())) { error.textContent = 'That email address does not look right.'; email.focus(); return; }
      if (pass.value.length < 6) { error.textContent = 'Use a password of at least 6 characters.'; pass.focus(); return; }
      if (pass.value !== confirm.value) { error.textContent = 'The two passwords do not match.'; confirm.focus(); return; }

      busy(submit, true);
      try {
        await store.createAccount(email.value, pass.value);
        toast('Welcome to your Idea Inventory.');
        onSignedIn();
      } catch (err) {
        console.error(err);
        error.textContent = 'Could not save your account on this device.';
        busy(submit, false, 'Create my inventory');
      }
    },
  },
    field('Email', email),
    field('Password', pass),
    field('Confirm password', confirm),
    error,
    submit,
    h('p.hint.center', {
      text: 'Your email and password are stored on this device only — there is no account server to sign up with.',
    }));

  return shell('Idea Inventory', 'Set the email and password you will use to unlock your ideas.', form);
}

/* --- Returning ---------------------------------------------------------- */

function signInCard(onSignedIn) {
  const account = store.getAccount();
  const email = h('input.input', { type: 'email', autocomplete: 'username', value: account.email, required: true });
  const pass = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', required: true });
  const error = h('div.error-text');
  const submit = h('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Unlock' });

  const form = h('form.auth-form', {
    async onSubmit(event) {
      event.preventDefault();
      error.textContent = '';
      busy(submit, true);
      const ok = await store.verifyPassword(email.value, pass.value);
      if (ok) {
        store.startSession();
        onSignedIn();
      } else {
        busy(submit, false, 'Unlock');
        error.textContent = 'That email and password combination did not match.';
        pass.select();
      }
    },
  },
    field('Email', email),
    field('Password', pass),
    error,
    submit);

  const footer = h('div.auth-foot',
    h('button.linkish', {
      type: 'button',
      text: 'Forgotten your password?',
      async onClick() {
        const yes = await confirmDialog({
          title: 'Reset this device?',
          message: 'There is no password recovery, because nothing is stored on a server. ' +
                   'Resetting clears the saved password AND every idea, task and timeline on this device. ' +
                   'Export a backup first if you can still get in elsewhere.',
          confirmLabel: 'Erase and start over',
          danger: true,
        });
        if (!yes) return;
        store.wipeEverything();
        location.reload();
      },
    }));

  return shell('Welcome back', 'Unlock your treasure chest of ideas.', form, footer);
}

export { EMAIL_RE };
