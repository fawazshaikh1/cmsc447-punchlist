import { useContext, useState } from 'react';

import { ProjectRole } from '../../domain/projects';
import { describeRevisions, revisionNameFor } from '../../domain/revisions';
import { Icon } from '../components/Icon';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';
import './revisions.css';

/**
 * A drawing's place in its set's history, on its row in the Drawings list
 * (SCRUM-90, FR-10.5): "Rev 2", "Superseded", and — for an admin, on the
 * current set only — Upload revision.
 *
 * A revision is stored like any drawing, under its own file name or, when
 * that is taken, "Set (rev 2).pdf"; then marked as replacing this one. It is
 * opened straight away, so its title blocks are read and its open items can
 * carry forward (CarryForwardBanner).
 *
 * @param {object} props
 * @param {import('../../domain/library').LibraryDrawing} props.drawing
 * @param {import('../../domain/library').LibraryDrawing[]} props.drawings Every drawing in the list.
 * @param {import('../../domain/revisions').RevisionLink[]} props.links
 * @param {(added: import('../../domain/library').LibraryDrawing) => void} props.onUploaded
 */
export function RevisionControls({ drawing, drawings, links, onUploaded }) {
  const { library, revisions } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!library || !revisions || !project) return null;
  const facts = describeRevisions(drawings, links).get(drawing.id);
  const mayRevise = project.role === ProjectRole.ADMIN && facts?.isCurrent;

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const name = revisionNameFor(file.name, drawings.map((each) => each.name));
      const added = await library.add(project.id, name, file);
      await revisions.link(project.id, added.id, drawing.id);
      onUploaded(added);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="revision-controls">
      {facts && facts.revision > 1 && (
        <span className="revision-badge" title={facts.replaces ? `Replaces ${facts.replaces.name}` : undefined}>
          Rev {facts.revision}
        </span>
      )}
      {facts && !facts.isCurrent && (
        <span className="revision-badge is-superseded" title={`Superseded by ${facts.replacedBy?.name}`}>
          Superseded
        </span>
      )}
      {mayRevise && (
        <label className="icon-button revision-upload" title={busy ? 'Uploading the revision…' : `Upload a revision of ${drawing.name}`}>
          <Icon name="upload" size={18} />
          <span className="revision-upload-label">Upload revision</span>
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(event) => {
              const [file] = event.target.files ?? [];
              event.target.value = '';
              void upload(file);
            }}
          />
        </label>
      )}
      {error && <span className="error small revision-error">{error}</span>}
    </span>
  );
}
