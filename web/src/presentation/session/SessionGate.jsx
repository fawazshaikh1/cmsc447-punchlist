import { Icon } from '../components/Icon';
import { ProjectPicker } from './ProjectPicker';
import { SessionProvider } from './SessionProvider';
import { SessionScreen } from './SessionScreen';
import { SignInScreen } from './SignInScreen';
import { SessionStatus, useSession } from './useSession';
import './session.css';

/**
 * Shows the app only to someone signed in, with a project open.
 *
 * In browser mode there is nothing to sign in to and the app is shown
 * straight away, exactly as before accounts existed.
 *
 * The app is keyed by the project, so opening a different project starts it
 * afresh — no drawing, selection or undo history carries over from one
 * project into another, where it would be acting on the wrong project's
 * sheets.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children The app.
 */
export function SessionGate({ children }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}

function Gate({ children }) {
  const session = useSession();

  switch (session.status) {
    case SessionStatus.BROWSER:
      return children;
    case SessionStatus.READY:
      return <Keyed key={session.project.id}>{children}</Keyed>;
    case SessionStatus.SIGNED_OUT:
      return <SignInScreen />;
    case SessionStatus.CHOOSING_PROJECT:
      return <ProjectPicker />;
    case SessionStatus.UNREACHABLE:
      return (
        <SessionScreen>
          <h1>Cannot reach the Punch List server</h1>
          <p className="error" role="alert">
            <Icon name="alert" size={18} /> {session.error}
          </p>
          <button type="button" className="btn primary" onClick={() => void session.retry()}>
            Try again
          </button>
        </SessionScreen>
      );
    default:
      return (
        <SessionScreen>
          <p className="muted" role="status">Checking whether you are signed in…</p>
        </SessionScreen>
      );
  }
}

/** A fragment with a key — what remounts the app when the project changes. */
function Keyed({ children }) {
  return children;
}
