import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ROLE_DESCRIPTIONS } from '../../domain/projects';
import { Icon } from '../components/Icon';
import { MembersDialog } from './MembersDialog';
import { SessionStatus, useSession } from './useSession';

/**
 * Who you are and which project is open, at the end of the top bar — with the
 * way to see the project's people, switch project, or sign out.
 *
 * The menu and the people dialog are PORTALLED to the end of the page. The top
 * bar is its own stacking context, beneath the side panel and the tool rail,
 * so anything drawn inside it — however high its z-index — would open
 * underneath them.
 *
 * Renders nothing in browser mode, where there is nobody to be.
 */
export function SessionMenu() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState(null);
  const menuId = useId();
  const root = useRef(null);
  const popover = useRef(null);
  /** Where the menu opens: under the button, right-aligned with it. */
  const [anchor, setAnchor] = useState(null);

  // Close when a tap lands anywhere else, or on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const inside = root.current?.contains(event.target) || popover.current?.contains(event.target);
      if (!inside) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Placed against the button at the moment it opens; a resize would leave
    // it floating away from the button, so a resize closes it instead.
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (session.status !== SessionStatus.READY) return null;

  const { account, project } = session;
  const roleLabel = ROLE_DESCRIPTIONS[project.role].label;

  const act = (work) => async () => {
    setOpen(false);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="session-menu" ref={root}>
      <button
        type="button"
        className="btn session-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setAnchor({ top: box.bottom + 8, right: window.innerWidth - box.right });
          setOpen((o) => !o);
        }}
        title={`${account.toString()} — ${roleLabel} on ${project.name}`}
      >
        <span className="avatar" aria-hidden="true">
          {initials(account.displayName)}
        </span>
        <span className="session-menu-text">
          <span className="session-menu-project">{project.name}</span>
          <span className="session-menu-role">{roleLabel}</span>
        </span>
      </button>

      {open && anchor && createPortal(
        <div
          className="session-menu-popover"
          id={menuId}
          role="menu"
          ref={popover}
          style={{ top: anchor.top, right: Math.max(anchor.right, 8) }}
        >
          <p className="session-menu-who">
            <strong>{account.toString()}</strong>
            <span className="muted small">{account.email}</span>
          </p>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setShowMembers(true); }}>
            People on this project
          </button>
          <button type="button" role="menuitem" onClick={act(session.switchProject)}>
            Switch project
          </button>
          <button type="button" role="menuitem" onClick={act(session.signOut)}>
            Sign out
          </button>
        </div>,
        document.body,
      )}

      {error && anchor && createPortal(
        <p
          className="error session-menu-error"
          role="alert"
          style={{ top: anchor.top, right: Math.max(anchor.right, 8) }}
          onClick={() => setError(null)}
        >
          <Icon name="alert" size={16} /> {error}
        </p>,
        document.body,
      )}

      {showMembers && createPortal(<MembersDialog onClose={() => setShowMembers(false)} />, document.body)}
    </div>
  );
}

/** "Jo Rivera" -> "JR". */
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
