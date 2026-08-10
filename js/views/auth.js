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

const LAST_EMAIL_KEY = 'ideaInventory.lastEmail';

const rememberedEmail = () => {
  try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch { return ''; }
};
const rememberEmail = (email) => {
  try { localStorage.setItem(LAST_EMAIL_KEY, email); } catch {}
};

function cloudCard(ctx) {
  const { client, onSignedIn, onConnectionChange } = ctx;

  // A device that has never signed in is almost certainly here to create the
  // account, so that is what it opens on. Once an email has been used here,
  // signing in becomes the default.
  let mode = rememberedEmail() ? 'signin' : 'signup';
  let banner = null;          // { tone, text, detail, action: { label, run } }
  let typedEmail = rememberedEmail();

  const wrap = h('div');
  paint();
  return wrap;

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    banner = null;
    paint();
  }

  function paint() {
    const signingUp = mode === 'signup';

    const email = h('input.input', {
      type: 'email', autocomplete: 'username', placeholder: 'you@example.com',
      value: typedEmail, required: true,
      onInput: () => { typedEmail = email.value; },
    });
    const pass = h('input.input', {
      type: 'password',
      autocomplete: signingUp ? 'new-password' : 'current-password',
      placeholder: signingUp ? 'At least 6 characters' : 'Your password',
      required: true,
    });
    const submit = h('button.btn.btn-primary.btn-block', {
      type: 'submit', text: signingUp ? 'Create my account' : 'Unlock',
    });

    const switcher = h('div.auth-switch',
      h('div.segmented', { role: 'group', 'aria-label': 'Create an account or sign in' },
        h('button', {
          type: 'button', text: 'Create account',
          'aria-pressed': String(signingUp),
          onClick: () => setMode('signup'),
        }),
        h('button', {
          type: 'button', text: 'Sign in',
          'aria-pressed': String(!signingUp),
          onClick: () => setMode('signin'),
        })));

    const form = h('form.auth-form', {
      async onSubmit(event) {
        event.preventDefault();
        banner = null;

        if (!EMAIL_RE.test(email.value.trim())) {
          return show({ tone: 'error', text: 'That email address does not look right.' });
        }
        if (pass.value.length < 6) {
          return show({ tone: 'error', text: 'Passwords need at least 6 characters.' });
        }

        const address = email.value.trim();
        busy(submit, true);
        try {
          if (signingUp) {
            const { needsConfirmation } = await client.signUp(address, pass.value);
            rememberEmail(address);
            if (needsConfirmation) {
              // The account exists but cannot sign in yet. Move to the sign-in
              // form (a full repaint, so the handler matches the button).
              mode = 'signin';
              banner = {
                tone: 'ok',
                text: `Account created. Supabase has emailed a confirmation link to ${address} — ` +
                      'click it, then come back and sign in.',
                action: { label: 'Send the email again', run: () => resend(address) },
              };
              paint();
              return;
            }
          } else {
            await client.signIn(address, pass.value);
            rememberEmail(address);
          }
          const adopted = store.claimOwner(client.user.id);
          onSignedIn({ adopted });
        } catch (err) {
          busy(submit, false, signingUp ? 'Create my account' : 'Unlock');
          show(explainAuthError(err, { signingUp, email: address, setMode, resend }));
        }
      },
    },
      switcher,
      field('Email', email),
      field('Password', pass),
      bannerNode(),
      submit);

    const footer = h('div.auth-foot',
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

    function show(next) {
      banner = next;
      const fresh = bannerNode();
      form.replaceChild(fresh, form.querySelector('.auth-note, .auth-note-empty'));
    }
  }

  function bannerNode() {
    if (!banner) return h('span.auth-note-empty');
    const node = h('div.auth-note.is-' + banner.tone,
      h('div', { text: banner.text }),
      banner.detail ? h('div.detail', { text: banner.detail }) : null);
    if (banner.action) {
      node.appendChild(h('div',
        h('button.btn.btn-xs', {
          type: 'button', text: banner.action.label,
          onClick: (event) => banner.action.run(event.currentTarget),
        })));
    }
    return node;
  }

  async function resend(address, button) {
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    try {
      await client.resendConfirmation(address);
      banner = { tone: 'ok', text: `Another confirmation link is on its way to ${address}.` };
    } catch (err) {
      banner = {
        tone: 'warn',
        text: err.code === 'over_email_send_rate_limit'
          ? 'Supabase limits how often it will send that email. Wait a minute and try again.'
          : 'Could not send it again.',
        detail: err.message,
      };
    }
    paint();
  }
}

/**
 * Turns a Supabase auth failure into something actionable. `error_code` is the
 * reliable signal; the wording of `msg` has changed between versions.
 */
function explainAuthError(err, { signingUp, email, setMode, resend }) {
  if (err.offline) {
    return {
      tone: 'error',
      text: 'No connection. Signing in for the first time on a device needs one — after that the app works offline.',
    };
  }

  const code = err.code || '';
  const message = (err.message || '').toLowerCase();

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return {
      tone: 'warn',
      text: 'This account still needs to be confirmed. Click the link in the email Supabase sent you, then sign in.',
      action: { label: 'Send the email again', run: (button) => resend(email, button) },
    };
  }

  if (code === 'invalid_credentials' || code === 'invalid_grant' || message.includes('invalid login')) {
    return {
      tone: 'error',
      text: 'That email and password did not match an account.',
      detail: 'If you have not created your account yet, switch to "Create account" above.',
      action: { label: 'Create an account instead', run: () => setMode('signup') },
    };
  }

  if (code === 'user_already_exists' || message.includes('already registered')) {
    return {
      tone: 'warn',
      text: 'There is already an account with that email.',
      action: { label: 'Sign in instead', run: () => setMode('signin') },
    };
  }

  if (code === 'weak_password' || message.includes('password should be')) {
    return { tone: 'error', text: 'That password is too weak for your project settings.', detail: err.message };
  }

  if (code === 'signup_disabled' || message.includes('signups not allowed')) {
    return {
      tone: 'error',
      text: 'This Supabase project has new sign-ups switched off.',
      detail: 'Turn them back on under Authentication → Sign In / Providers → Email.',
    };
  }

  if (code === 'over_email_send_rate_limit' || message.includes('rate limit')) {
    return { tone: 'warn', text: 'Too many attempts for now — wait a minute and try again.', detail: err.message };
  }

  if (err.status === 404) {
    return {
      tone: 'error',
      text: 'That project URL did not answer as a Supabase project.',
      detail: 'Check it under Project Settings → API, then use "Change connection" below.',
    };
  }

  if (err.status === 401) {
    return {
      tone: 'error',
      text: 'The project rejected the anon key.',
      detail: 'Copy the "anon public" key again from Project Settings → API, then use "Change connection" below.',
    };
  }

  return {
    tone: 'error',
    text: signingUp ? 'Could not create the account.' : 'Could not sign in.',
    detail: `${err.message}${code ? ` (${code})` : ''}`,
  };
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
