import { useContext, useEffect, useState } from 'react';

import { PIN_KIND } from '../../domain/annotations';
import { PunchListRegistry } from '../../domain/punchlist';
import { useConfirmation } from '../components/ConfirmDialog';
import { usePhotoCapture } from '../components/PhotoCaptureDialog';
import { useMediaUrl } from '../media/useMediaUrl';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';
import './itemphotos.css';

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The photos attached to one punch item (SCRUM-88), in the sheet's side
 * panel and the task panel: thumbnails, Add photo, and Remove.
 *
 * Attaching a photo does not edit the item, so anyone on the project may do
 * it — a subcontractor photographing finished work is the usual case — even
 * on an issued item. Whoever added a photo, or an admin or power
 * collaborator, may remove it; the server decides, this only hides the button
 * from people it would refuse. These are the photos printed on the item's
 * page in the issued PDF.
 *
 * Server mode only, like comments; and only for punch items — what the
 * schedule lists — not for clouds or arrows.
 *
 * @param {object} props
 * @param {import('../../domain/annotations').Annotation|null} props.annotation
 * @param {() => void} [props.onChanged] After a photo is added or removed.
 */
export function ItemPhotosSection({ annotation, onChanged }) {
  const { itemPhotos, storePhoto, editor } = useServices();
  const account = useContext(SessionContext)?.account ?? null;
  const { ask: askForPhoto, dialog: photoDialog } = usePhotoCapture();
  const { ask: confirm, dialog: confirmDialog } = useConfirmation();
  const [loaded, setLoaded] = useState({ key: null, list: [] });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const id = annotation?.id ?? null;
  const key = `${id}:${revision}`;
  useEffect(() => {
    if (!itemPhotos || !id) return undefined;
    let live = true;
    itemPhotos.listFor(id).then(
      (list) => live && setLoaded({ key, list }),
      () => live && setLoaded({ key, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [itemPhotos, id, key]);

  if (!itemPhotos || !annotation || !PunchListRegistry.registeredKinds().includes(annotation.getKind())) return null;

  const photos = loaded.key === key ? loaded.list : null;
  const isEditor = editor.canCreate(PIN_KIND).allowed;
  const mayRemove = (photo) => isEditor || (account && String(account.id) === String(photo.addedBy.id));

  const add = async () => {
    setError(null);
    const blob = await askForPhoto({ title: 'Add a photo to this item', hint: 'It goes on the item’s page in the issued PDF.' });
    if (!blob) return;
    setBusy(true);
    try {
      const media = await storePhoto(blob);
      await itemPhotos.add({ annotation, media });
      setRevision((n) => n + 1);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photo) => {
    const sure = await confirm({
      title: 'Remove this photo?',
      body: <p>It comes off the item and will not be in the next issued PDF. This cannot be undone.</p>,
      confirmLabel: 'Remove photo',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!sure) return;
    setError(null);
    try {
      await itemPhotos.remove(photo);
      setRevision((n) => n + 1);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="item-photos" aria-label="Photos">
      {photoDialog}
      {confirmDialog}
      <h3 className="details-title">
        Photos{photos && photos.length > 0 ? ` · ${photos.length}` : ''}
      </h3>
      {photos === null && <p className="muted small">Loading…</p>}
      {photos && photos.length === 0 && <p className="muted small">No photos yet.</p>}
      {photos && photos.length > 0 && (
        <ul className="item-photo-grid">
          {photos.map((photo) => (
            <ItemPhotoThumb key={photo.id} photo={photo} onRemove={mayRemove(photo) ? () => void remove(photo) : null} />
          ))}
        </ul>
      )}
      {error && <p className="error small">{error}</p>}
      <button type="button" className="btn item-photo-add" disabled={busy} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add photo'}
      </button>
    </section>
  );
}

function ItemPhotoThumb({ photo, onRemove }) {
  const { url } = useMediaUrl(photo.media.key);
  const label = photo.caption || 'Photo of the item';
  return (
    <li className="item-photo">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="Open full size">
          <img src={url} alt={label} />
        </a>
      ) : (
        <span className="item-photo-missing">Loading…</span>
      )}
      <span className="item-photo-credit">
        {photo.addedBy.displayName} · {WHEN.format(photo.addedAt)}
      </span>
      {onRemove && (
        <button type="button" className="item-photo-remove" onClick={onRemove} aria-label="Remove this photo" title="Remove this photo">
          ×
        </button>
      )}
    </li>
  );
}
