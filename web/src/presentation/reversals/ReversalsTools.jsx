import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';

import { ProjectRole } from '../../domain/projects';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';
import { IssueHistoryDialog } from './IssueHistoryDialog';
import { RecentlyDeletedDialog } from './RecentlyDeletedDialog';
import './reversals.css';

/**
 * The Tasks tab's admin tools for putting accidents right (spec 8.2, 8.3):
 * Recently deleted and Issue history. Rendered through TasksView's
 * `renderAdminTools` slot; shown to a project's admins only, as the server
 * allows only them, and only in server mode, where there is a trash and an
 * issue log to read.
 *
 * @param {object} props
 * @param {(documentName: string, pageIndex: number) => string} props.sheetLabelFor
 * @param {() => void} props.onChanged Re-reads the Tasks tab after a restore or a void.
 */
export function ReversalsTools({ sheetLabelFor, onChanged }) {
  const { trash, issues } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  const [open, setOpen] = useState(null);

  if (!project || project.role !== ProjectRole.ADMIN || (!trash && !issues)) return null;
  const close = () => setOpen(null);

  return (
    <>
      {trash && (
        <button type="button" className="btn" onClick={() => setOpen('trash')} title="Markups deleted in the last 30 days">
          Recently deleted
        </button>
      )}
      {issues && (
        <button type="button" className="btn" onClick={() => setOpen('issues')} title="Every PDF issued in this project">
          Issue history
        </button>
      )}
      {open === 'trash' &&
        createPortal(
          <RecentlyDeletedDialog projectId={project.id} sheetLabelFor={sheetLabelFor} onChanged={onChanged} onClose={close} />,
          document.body,
        )}
      {open === 'issues' &&
        createPortal(<IssueHistoryDialog projectId={project.id} onChanged={onChanged} onClose={close} />, document.body)}
    </>
  );
}
