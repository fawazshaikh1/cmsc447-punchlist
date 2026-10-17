import { useId, useState } from 'react';

import { Icon } from '../components/Icon';
import { SessionScreen } from './SessionScreen';
import { useSession } from './useSession';

/** Mirrors minPasswordRunes in backend/auth.go, so the form can say so before the server does. */
const MIN_PASSWORD = 15;

/**
 * Sign in, or create an account (SCRUM-44).
 *
 * Registration asks for what the stakeholder described — email, name, company
 * and title — and signs straight in. It grants no project: a new account sees
 * an empty project list until an admin adds them, or starts a project of
 * their own.
 *
 * Every field carries an `autocomplete` hint, so a password manager on an iPad
 * fills it in and offers to save the new password — the difference between a
 * 15-character passphrase being usable on site and not.
 */
export function SignInScreen() {
  const session = useSession();
  const [mode, setMode] = useState('signIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '', company: '', title: '' });
  const ids = useId();

  const creating = mode === 'register';
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setAttempted(false);
  };

  const tooShort = creating && [...form.password].length < MIN_PASSWORD;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    // The hint under the field already says why; the server would only say
    // it again.
    if (tooShort) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) await session.register(form);
      else await session.signIn(form.email, form.password);
      // On success this screen is replaced; nothing more to do.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const shortPassword = tooShort && (attempted || form.password.length > 0);

  return (
    <SessionScreen>
      <h1>{creating ? 'Create your account' : 'Sign in'}</h1>
      <p className="muted">
        {creating
          ? 'Your name and company appear beside every change you make, so the team knows who to ask.'
          : 'Markups are saved to your team’s projects on the server.'}
      </p>

      {session.notice && !error && (
        <p className="notice notice-locked" role="status">
          {session.notice}
        </p>
      )}

      <div className="session-tabs" role="tablist" aria-label="Sign in or create an account">
        <button
          type="button"
          role="tab"
          aria-selected={!creating}
          className={creating ? 'session-tab' : 'session-tab active'}
          onClick={() => switchMode('signIn')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={creating}
          className={creating ? 'session-tab active' : 'session-tab'}
          onClick={() => switchMode('register')}
        >
          Create account
        </button>
      </div>

      <form className="session-form" onSubmit={submit} noValidate>
        <label className="field" htmlFor={`${ids}-email`}>
          Email
          <input
            id={`${ids}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={form.email}
            onChange={set('email')}
          />
        </label>

        {creating && (
          <>
            <label className="field" htmlFor={`${ids}-name`}>
              Your name
              <input id={`${ids}-name`} autoComplete="name" required value={form.displayName} onChange={set('displayName')} />
            </label>
            <label className="field" htmlFor={`${ids}-company`}>
              Company
              <input
                id={`${ids}-company`}
                autoComplete="organization"
                required
                value={form.company}
                onChange={set('company')}
              />
            </label>
            <label className="field" htmlFor={`${ids}-title`}>
              Job title (optional)
              <input
                id={`${ids}-title`}
                autoComplete="organization-title"
                value={form.title}
                onChange={set('title')}
              />
            </label>
          </>
        )}

        <label className={shortPassword ? 'field field-invalid' : 'field'} htmlFor={`${ids}-password`}>
          Password
          <input
            id={`${ids}-password`}
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            required
            value={form.password}
            onChange={set('password')}
            aria-describedby={creating ? `${ids}-password-hint` : undefined}
          />
          {creating && (
            <span id={`${ids}-password-hint`} className={shortPassword ? 'field-error' : 'muted small'}>
              At least {MIN_PASSWORD} characters. A short phrase is easier to type on a tablet than a
              jumble of symbols, and harder to guess.
            </span>
          )}
        </label>

        {error && (
          <p className="error" role="alert">
            <Icon name="alert" size={18} /> {error}
          </p>
        )}

        <button type="submit" className="btn primary session-submit" disabled={busy}>
          {busy ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </SessionScreen>
  );
}
