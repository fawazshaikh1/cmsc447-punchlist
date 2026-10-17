import { useId, useState } from 'react';

import { ROLE_DESCRIPTIONS } from '../../domain/projects';
import { Icon } from '../components/Icon';
import { SessionScreen } from './SessionScreen';
import { useSession } from './useSession';

/**
 * Choose which project to work in, or start one (SCRUM-43).
 *
 * A person sees only the projects they are on, each with their role there —
 * the same person can be admin of one and collaborator on another. Starting a
 * project makes you its admin, and grants nothing anywhere else.
 */
export function ProjectPicker() {
  const session = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const id = useId();

  const attempt = async (key, work) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  const create = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) void attempt('create', () => session.createProject(trimmed));
  };

  const { account, projects } = session;

  return (
    <SessionScreen wide>
      <div className="session-heading">
        <h1>Your projects</h1>
        <button type="button" className="btn ghost" onClick={() => void attempt('signOut', session.signOut)}>
          Sign out
        </button>
      </div>
      <p className="muted">
        Signed in as <strong className="session-strong">{account.toString()}</strong> · {account.email}
      </p>

      {session.notice && (
        <p className="notice notice-locked" role="status">
          {session.notice}
        </p>
      )}

      {projects.length === 0 ? (
        <p className="session-empty">
          You are not on any project yet. Ask a project admin to add you using the email{' '}
          <strong className="session-strong">{account.email}</strong>, or start your own below.
        </p>
      ) : (
        <ul className="project-list" aria-label="Projects">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="project-option"
                disabled={busy !== null}
                onClick={() => void attempt(project.id, () => session.chooseProject(project))}
              >
                <Icon name="layers" size={20} />
                <span className="project-option-name">{project.name}</span>
                <span className={`role-badge role-${project.role}`}>{ROLE_DESCRIPTIONS[project.role].label}</span>
                {busy === project.id && <span className="muted small">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="session-form project-create" onSubmit={create}>
        <label className="field" htmlFor={`${id}-name`}>
          Start a new project
          <span className="field-inline">
            <input
              id={`${id}-name`}
              placeholder="e.g. Engineering Building, Level 2"
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="btn primary" disabled={!name.trim() || busy !== null}>
              {busy === 'create' ? 'Creating…' : 'Create'}
            </button>
          </span>
        </label>
        <p className="muted small">You will be its admin, and can add your team from inside it.</p>
      </form>

      {error && (
        <p className="error" role="alert">
          <Icon name="alert" size={18} /> {error}
        </p>
      )}
    </SessionScreen>
  );
}
