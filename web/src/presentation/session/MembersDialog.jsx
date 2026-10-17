import { useEffect, useId, useRef, useState } from 'react';

import { PROJECT_ROLES, ProjectRole, ROLE_DESCRIPTIONS } from '../../domain/projects';
import { useServices } from '../ServiceContainer';
import { Icon } from '../components/Icon';
import { useAutoFocus } from '../components/useAutoFocus';
import { useBackdropDismiss } from '../components/useBackdropDismiss';
import { useSession } from './useSession';

/**
 * Who is on the open project, and — for its admins — adding people and
 * choosing their roles (SCRUM-43).
 *
 * Everyone on a project can see who else is on it: assigning an item to a
 * person needs to know who there is. Only an admin sees the controls, and the
 * server refuses the changes from anyone else regardless.
 *
 * A person is added by the email they registered with. There is no invitation
 * for an address with no account yet, on purpose: with no email verification,
 * a waiting invitation would go to whoever registered that address first.
 *
 * @param {object} props
 * @param {() => void} props.onClose
 */
export function MembersDialog({ onClose }) {
  const { projects } = useServices();
  const session = useSession();
  const { project, account } = session;
  const manage = project.canManagePeople;

  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ProjectRole.COLLABORATOR);
  const ids = useId();
  const firstField = useRef(null);
  const backdrop = useBackdropDismiss(onClose);
  useAutoFocus(firstField);

  useEffect(() => {
    // A slow answer must not land after the dialog closed or moved on.
    let cancelled = false;
    projects.members(project.id).then(
      (list) => {
        if (!cancelled) setMembers(list);
      },
      (cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projects, project.id]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /**
   * Runs a change, then reloads the list. A change to your OWN role also
   * re-reads the project, so the editor's permissions follow at once.
   */
  const change = async (work, touchesMe) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setMembers(await projects.members(project.id));
      if (touchesMe) await session.refreshProject();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    const added = await change(
      () => projects.setMember(project.id, trimmed, role),
      trimmed.toLowerCase() === account.email,
    );
    if (added) setEmail('');
  };

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-heading">
          <h2 id={`${ids}-title`}>People on {project.name}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="modal-hint">
          {manage
            ? 'Add people by the email they signed up with, and choose what each of them can do on this project.'
            : 'Only a project admin can add people or change roles.'}
        </p>

        {members === null && !error && <p className="muted small">Loading…</p>}

        {members && (
          <ul className="member-list" aria-label="Members">
            {members.map((member) => {
              const me = member.userId === account.id;
              return (
                <li key={member.userId} className="member-row">
                  <span className="member-who">
                    <strong>
                      {member.toString()}
                      {me && <span className="muted"> (you)</span>}
                    </strong>
                    <span className="muted small">
                      {member.email}
                      {member.title ? ` · ${member.title}` : ''}
                    </span>
                  </span>
                  {manage ? (
                    <span className="member-controls">
                      <select
                        aria-label={`Role for ${member.displayName}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void change(() => projects.setMember(project.id, member.email, event.target.value), me)
                        }
                      >
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_DESCRIPTIONS[r].label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        onClick={() => void change(() => projects.removeMember(project.id, member.userId), me)}
                        aria-label={`Remove ${member.displayName} from the project`}
                        title="Remove from the project"
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </span>
                  ) : (
                    <span className={`role-badge role-${member.role}`}>{ROLE_DESCRIPTIONS[member.role].label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="error" role="alert">
            <Icon name="alert" size={18} /> {error}
          </p>
        )}

        {manage && (
          <form className="session-form member-add" onSubmit={add}>
            <div className="member-add-row">
              <label className="field" htmlFor={`${ids}-email`}>
                Email
                <input
                  ref={firstField}
                  id={`${ids}-email`}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field" htmlFor={`${ids}-role`}>
                Role
                <select id={`${ids}-role`} value={role} onChange={(event) => setRole(event.target.value)}>
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_DESCRIPTIONS[r].label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn primary" disabled={busy || !email.trim()}>
                Add
              </button>
            </div>
            <p className="muted small">{ROLE_DESCRIPTIONS[role].summary}</p>
          </form>
        )}
      </div>
    </div>
  );
}
