import { Icon } from '../components/Icon';

/**
 * The centred card every signed-out screen sits in.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {boolean} [props.wide]
 */
export function SessionScreen({ children, wide = false }) {
  return (
    <main className="session-screen">
      <div className={wide ? 'session-card session-card-wide' : 'session-card'}>
        <div className="brand session-brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="pin" size={18} />
          </span>
          <span className="brand-name">Punch List</span>
        </div>
        {children}
      </div>
    </main>
  );
}
