/* Three doors into the app:
     · setup  — no connection saved yet: point it at your Supabase project
     · cloud  — sign in / create an account, inventory syncs to every device
     · local  — device-only fallback, the original on-device password
*/

import { h, frag } from '../util.js';
import { icon } from '../icons.js';
import { field, toast, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { writeConnection } from '../supabase.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Accepts a hosted project URL, and a self-hosted Supabase on any host. */
function validProjectUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !!parsed.host;
  } catch { return false; }
}

export function renderAuth(mount, ctx) {
  const { connection } = ctx;
  if (connection.mode === 'unset') mount.replaceChildren(setupCard(ctx));
  else if (connection.mode === 'local') mount.replaceChildren(store.hasAccount() ? localSignIn(ctx) : localSignUp(ctx));
  else mount.replaceChildren(cloudCard(ctx));
}

function shell(title, subtitle, body, footer) {
  return h('div.auth-wrap',
    h('div.auth-card',
      h('div.auth-logo', icon('chest')),
      h('h1.auth-title', { text: title }),
      h('p.auth-sub', { text: subtitle }),
      body,
      footer || null));
}

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  button.replaceChildren(...(isBusy
    ? [h('span.spinner'), document.createTextNode('Working…')]
    : [document.createTextNode(label)]));
}

/* --- 1. Connection setup ------------------------------------------------ */

function setupCard({ onConnectionChange }) {
  const url = h('input.input', {
    placeholder: 'https://yourproject.supabase.co', autocapitalize: 'off', spellcheck: false,
  });
  const key = h('input.input', {
    placeholder: 'eyJhbGciOi…', autocapitalize: 'off', spellcheck: false,
  });
  const error = h('div.error-text');
  const submit = h('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Connect' });

  const form = h('form.auth-form', {
    onSubmit(event) {
      event.preventDefault();
      error.textContent = '';
      const cleanUrl = url.value.trim().replace(/\/+$/, '');
      if (!validProjectUrl(cleanUrl)) {
        error.textContent = 'That should be a full address, like https://yourproject.supabase.co';
        url.focus();
        return;
      }
      if (key.value.trim().length < 40) {
        error.textContent = 'That anon key looks too short — copy the whole thing.';
        key.focus();
        return;
      }
      writeConnection({ url: cleanUrl, anonKey: key.value.trim(), mode: 'cloud' });
      onConnectionChange();
    },
  },
    field('Project URL', url),
    field('Anon public key', key),
    error,
    submit,
    h('p.hint', {
      text: 'Both live in Supabase under Project Settings → API. They are safe to store and to commit: ' +
            'the anon key can only reach rows belonging to whoever is signed in.',
    }));

  const footer = h('div.auth-foot',
    h('button.linkish', {
      type: 'button',
      text: 'Skip — use this device only',
      async onClick() {
        const yes = await confirmDialog({
          title: 'Use this device only?',
          message: 'Your ideas will live in this browser and nowhere else, so your phone and your ' +
                   'laptop will each keep their own separate inventory. You can connect a project later in Settings.',
          confirmLabel: 'Use this device only',
        });
        if (!yes) return;
        writeConnection({ url: '', anonKey: '', mode: 'local' });
        onConnectionChange();
      },
    }));

  return shell('Idea Inventory',
    'Point the app at your Supabase project once, and every device you sign in on shares the same inventory.',
    form, footer);
}

/* --- 2. Cloud account ---------------------------------------------------- */

function cloudCard(ctx) {
  const { client, onSignedIn, onConnectionChange } = ctx;
  let mode = 'signin';

  const wrap = h('div');
  paint();
  return wrap;

  function paint() {
    const signingUp = mode === 'signup';

    const email = h('input.input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true });
    const pass = h('input.input', {
      type: 'password',
      autocomplete: signingUp ? 'new-password' : 'current-password',
      placeholder: signingUp ? 'At least 6 characters' : 'Your password',
      required: true,
    });
    const error = h('div.error-text');
    const notice = h('div.small');
    const submit = h('button.btn.btn-primary.btn-block', {
      type: 'submit', text: signingUp ? 'Create account' : 'Unlock',
    });

    const form = h('form.auth-form', {
      async onSubmit(event) {
        event.preventDefault();
        error.textContent = '';
        notice.textContent = '';

        if (!EMAIL_RE.test(email.value.trim())) { error.textContent = 'That email address does not look right.'; return; }
        if (pass.value.length < 6) { error.textContent = 'Passwords need at least 6 characters.'; return; }

        busy(submit, true);
        try {
          if (signingUp) {
            const { needsConfirmation } = await client.signUp(email.value.trim(), pass.value);
            if (needsConfirmation) {
              notice.className = 'small';
              notice.style.color = 'var(--ok)';
              notice.textContent = 'Account created. Check your inbox for the confirmation link, then come back and unlock.';
              mode = 'signin';
              busy(submit, false, 'Unlock');
              return;
            }
          } else {
            await client.signIn(email.value.trim(), pass.value);
          }
          const adopted = store.claimOwner(client.user.id);
          onSignedIn({ adopted });
        } catch (err) {
          busy(submit, false, signingUp ? 'Create account' : 'Unlock');
          error.textContent = friendlyAuthError(err, signingUp);
        }
      },
    },
      field('Email', email),
      field('Password', pass),
      error,
      notice,
      submit);

    const footer = h('div.auth-foot.stack.gap-8',
      h('div',
        h('span.small.dim', { text: signingUp ? 'Already have an account? ' : 'First time on this device? ' }),
        h('button.linkish', {
          type: 'button',
          text: signingUp ? 'Sign in instead' : 'Create an account',
          onClick: () => { mode = signingUp ? 'signin' : 'signup'; paint(); },
        })),
      h('button.linkish', {
        type: 'button', text: 'Change connection',
        async onClick() {
          const yes = await confirmDialog({
            title: 'Change the connection?',
            message: 'You will be asked for a project URL and key again. Ideas already saved on the server stay there.',
            confirmLabel: 'Change it',
          });
          if (!yes) return;
          writeConnection({ url: '', anonKey: '', mode: 'unset' });
          onConnectionChange();
        },
      }));

    wrap.replaceChildren(shell(
      signingUp ? 'Create your inventory' : 'Welcome back',
      signingUp
        ? 'One account, every device — your phone, your iPad and your laptop all see the same ideas.'
        : 'Unlock your treasure chest of ideas.',
      form, footer));
  }
}

function friendlyAuthError(err, signingUp) {
  if (err.offline) {
    return 'No connection. Signing in for the first time on a device needs one — after that the app works offline.';
  }
  const message = (err.message || '').toLowerCase();
  if (message.includes('invalid login')) return 'That email and password combination did not match.';
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'There is already an account with that email — sign in instead.';
  }
  if (message.includes('email not confirmed')) return 'Confirm your email first — check your inbox for the link.';
  if (message.includes('password')) return err.message;
  return (signingUp ? 'Could not create the account: ' : 'Could not sign in: ') + err.message;
}

/* --- 3. Device-only ------------------------------------------------------ */

function localSignUp({ onSignedIn }) {
  const email = h('input.input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true });
  const pass = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 6 characters', required: true });
  const confirm = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it once more', required: true });
  const error = h('div.error-text');
  const submit = h('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Create my inventory' });

  const form = h('form.auth-form', {
    async onSubmit(event) {
      event.preventDefault();
      error.textContent = '';
      if (!EMAIL_RE.test(email.value.trim())) { error.textContent = 'That email address does not look right.'; return; }
      if (pass.value.length < 6) { error.textContent = 'Use a password of at least 6 characters.'; return; }
      if (pass.value !== confirm.value) { error.textContent = 'The two passwords do not match.'; return; }

      busy(submit, true);
      try {
        await store.createAccount(email.value, pass.value);
        toast('Welcome to your Idea Inventory.');
        onSignedIn({ adopted: false });
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
    h('p.hint.center', { text: 'Device-only mode: these ideas stay in this browser and do not sync anywhere.' }));

  return shell('Idea Inventory', 'Set the email and password you will use to unlock your ideas.', form);
}

function localSignIn({ onSignedIn }) {
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
      if (await store.verifyPassword(email.value, pass.value)) {
        store.startLocalSession();
        onSignedIn({ adopted: false });
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
          message: 'In device-only mode there is no password recovery, because nothing is stored on a server. ' +
                   'Resetting clears the saved password AND every idea, task and timeline on this device.',
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
