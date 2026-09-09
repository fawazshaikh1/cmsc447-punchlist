import { Component } from 'react';

/**
 * Catches a render error and shows a fallback instead of unmounting the tree.
 *
 * ===========================================================================
 * WHY THIS EXISTS — the cloud crash
 * ===========================================================================
 * Selecting the cloud tool and touching the sheet produced a WHITE SCREEN. The
 * cause was a zero-size cloud generating NaN geometry, which reached
 * `new PdfPoint(NaN, NaN)`. That constructor throws — correctly, because a
 * non-finite coordinate is exactly the bug the guard exists to catch.
 *
 * But it threw DURING A RENDER, and React's contract for an uncaught render
 * error is to unmount the entire tree. So a single bad markup destroyed the
 * whole editing session, including every other markup the user had drawn and
 * not yet exported.
 *
 * The NaN is fixed at its source. This is the second line of defence: the same
 * class of bug should cost one missing marker, not the user's work. Any future
 * markup type, any malformed row restored from storage, any arithmetic edge
 * case in a renderer we have not thought of — all of them now degrade instead
 * of destroying.
 *
 * ---------------------------------------------------------------------------
 * WHY A CLASS COMPONENT
 * ---------------------------------------------------------------------------
 * Error boundaries are the one thing React hooks still cannot do; there is no
 * `useErrorBoundary`. `getDerivedStateFromError` and `componentDidCatch` are
 * only available on a class, so this file is deliberately the exception to the
 * function-component convention used everywhere else.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.fallback] Rendered instead, on error.
 * @param {string} [props.label] Included in the console message.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logged rather than swallowed: a caught error is still a bug, and a silent
    // fallback with nothing in the console is far harder to diagnose than the
    // white screen it replaced.
    console.error(`[${this.props.label ?? 'ErrorBoundary'}] render failed:`, error, info);
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      // A function fallback receives the error, so a top-level handler can show
      // what actually went wrong. A plain node is enough for a marker, where
      // the message would have nowhere useful to go.
      return typeof fallback === 'function' ? fallback(this.state.error) : (fallback ?? null);
    }
    return this.props.children;
  }
}

/**
 * Full-page fallback for a failure outside any individual marker.
 *
 * Shows the real message and offers a reload. Deliberately NOT a blank
 * apology — during a punch walk the useful information is what broke and
 * whether the work is recoverable. Markups are already persisted, so a reload
 * loses nothing but the undo history, and saying so stops a user assuming the
 * worst.
 */
export function AppErrorFallback({ error }) {
  return (
    <div className="empty-state">
      <h1>Something went wrong</h1>
      <p className="error">{error?.message ?? String(error)}</p>
      <p className="muted">
        Your markups are saved. Reloading restores them — only the undo history
        for this session is lost.
      </p>
      <button type="button" className="tool" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
