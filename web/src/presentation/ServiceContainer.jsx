import { createContext, useContext, useMemo } from 'react';

import { CommandHistory } from '../domain/commands';
import { StaticIdentityProvider } from '../domain/identity/StaticIdentityProvider';
import {
  ActiveSeals,
  CompositeEditPolicy,
  SealedByExportPolicy,
} from '../domain/policy';
import { AnnotationService } from '../domain/services/AnnotationService';
import { EditorService } from '../domain/services/EditorService';
import { ExportService } from '../domain/services/ExportService';
import { PdfJsDocumentSource } from '../infrastructure/pdf/PdfJsDocumentSource';
import { IndexedDbMediaStore } from '../infrastructure/media/IndexedDbMediaStore';
import { CanvasImageProcessor } from '../infrastructure/media/CanvasImageProcessor';
import { MediaUrlCache } from './media/MediaUrlCache';
import { PdfLibSheetExporter, FlattenedSheetExporter } from '../infrastructure/export';
import { LocalStorageAnnotationRepository } from '../infrastructure/persistence/LocalStorageAnnotationRepository';
import { LocalStorageChangeLogRepository } from '../infrastructure/persistence/LocalStorageChangeLogRepository';
import { LocalStorageExportHistoryRepository } from '../infrastructure/persistence/LocalStorageExportHistoryRepository';
import { HttpAnnotationRepository } from '../infrastructure/persistence/HttpAnnotationRepository';
import { HttpChangeLogRepository } from '../infrastructure/persistence/HttpChangeLogRepository';
import { HttpExportHistoryRepository } from '../infrastructure/persistence/HttpExportHistoryRepository';
import { CryptoIdGenerator } from '../infrastructure/identity/CryptoIdGenerator';

/**
 * ===========================================================================
 * THE COMPOSITION ROOT
 * ===========================================================================
 * This is the ONE AND ONLY file that knows which concrete implementation backs
 * each contract. Every other file in the application depends on the abstract
 * base classes in `domain/`, so this is the single place to edit when an
 * implementation changes.
 *
 *   Persistence moves to the Go API by CONFIGURATION, not by a code change:
 *   start the app with `VITE_API_BASE=/api` and markups, change history and
 *   export history are read from and written to the server (SCRUM-41).
 *   Without it they stay in this browser, so working on the frontend does
 *   not require Go and Postgres to be running.
 *
 *   Adding sign-in in Sprint 2 is exactly this diff:
 *       - new StaticIdentityProvider()
 *       + new SessionIdentityProvider('/api')
 *
 *   Switching roles on, once people have them, is exactly this — one more
 *   entry in the policy array below:
 *       + new RoleEditPolicy(),
 *
 *   Testing a component against fakes is exactly this:
 *       <ServiceContainer repository={new InMemoryAnnotationRepository()}>
 *
 * Nothing else changes in any of those cases. That is the whole return on
 * routing every write through one service and every question through a port.
 *
 * >>> If you ever find yourself importing from `infrastructure/` anywhere other
 * >>> than this file, the dependency rule has been broken and the one-line swap
 * >>> above has quietly stopped being one line. That import is the thing to
 * >>> catch in code review.
 */
const ServiceContext = createContext(null);

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {import('../domain/ports/AnnotationRepository').AnnotationRepository} [props.repository]
 *        Override for tests. Defaults to local storage so pins survive reload.
 * @param {import('../domain/ports/DocumentSource').DocumentSource} [props.documentSource]
 *        Override for tests. Defaults to the pdf.js adapter.
 * @param {import('../domain/ports/SheetExporter').SheetExporter} [props.exporter]
 *        Override for tests. Defaults to the pdf-lib adapter.
 * @param {import('../domain/ports/ExportHistoryRepository').ExportHistoryRepository} [props.exportHistory]
 *        Override for tests. Defaults to local storage so seals survive reload.
 * @param {import('../domain/ports/ChangeLogRepository').ChangeLogRepository} [props.changeLog]
 *        Override for tests. Defaults to local storage.
 * @param {import('../domain/ports/MediaStore').MediaStore} [props.mediaStore]
 *        Override for tests. Defaults to IndexedDB, which unlike
 *        localStorage can hold a photograph without a size penalty.
 * @param {import('../domain/ports/IdentityProvider').IdentityProvider} [props.identity]
 *        Override for tests — pass a `StaticIdentityProvider(actor)` to work as
 *        a named user before sign-in exists. Defaults to anonymous.
 */
export function ServiceContainer({
  children,
  repository,
  documentSource,
  exporter,
  exportHistory,
  changeLog,
  identity,
  mediaStore,
}) {
  // useMemo, not a plain expression: these are stateful singletons. pdf.js holds
  // a Web Worker, the repository holds a cache and ActiveSeals holds
  // subscribers, so rebuilding them on every render would leak workers and drop
  // in-flight state.
  //
  // Note that the service constructors validate what they are handed against
  // the contracts — a mis-wiring throws HERE, at startup, with a message naming
  // the expected type, rather than three screens deep as "undefined is not a
  // function".
  const services = useMemo(() => {
    // WHERE MARKUPS AND THEIR HISTORY LIVE. The Go API when the app is
    // started with VITE_API_BASE (e.g. `/api`, proxied to the Go server by
    // vite.config.js); this browser's local storage otherwise. All three
    // switch together — markups on the server with their history left on one
    // tablet would split the audit trail from the thing it describes.
    const api = import.meta.env?.VITE_API_BASE;
    const repo =
      repository ?? (api ? new HttpAnnotationRepository(api) : new LocalStorageAnnotationRepository());
    const exports_ =
      exportHistory ?? (api ? new HttpExportHistoryRepository(api) : new LocalStorageExportHistoryRepository());
    const log =
      changeLog ?? (api ? new HttpChangeLogRepository(api) : new LocalStorageChangeLogRepository());
    const ids = new CryptoIdGenerator();
    const annotations = new AnnotationService(repo, ids);

    // WHO IS WORKING. Anonymous today, because nobody signs in — see Actor for
    // why that is a real object rather than null. Every write already asks this
    // and every record already stores the answer, so Sprint 2 changes this one
    // line and real names start appearing in logs that have been running since
    // the beginning.
    const who = identity ?? new StaticIdentityProvider();

    // WHERE PHOTOGRAPHS LIVE. A separate store from annotations because the two
    // have nothing in common operationally — see MediaStore. Sprint 2 swaps
    // this one line for `new S3MediaStore('/api')`.
    const media = mediaStore ?? new IndexedDbMediaStore();
    const imageProcessor = new CanvasImageProcessor();

    // Object URLs, created once per photo and revoked together. Held here
    // rather than per component so the same photo on the sheet and in the
    // panel shares one URL rather than pinning the Blob twice.
    const mediaUrls = new MediaUrlCache(media);

    // Which markups on the open sheet have already been issued. Loaded from the
    // export history when a sheet opens, and added to when an export completes.
    // Lives here rather than in a hook because the policy below closes over it
    // and both must be the same object for the life of the session.
    const activeSeals = new ActiveSeals();

    // -----------------------------------------------------------------------
    // THE PERMISSION MODEL, IN FULL
    // -----------------------------------------------------------------------
    // Every write in the application passes this. Order matters only for which
    // reason a blocked user is shown first — the composite requires unanimous
    // consent regardless — so the most explanatory policy goes first.
    //
    // RoleEditPolicy is written and takes no arguments: it reads the actor off
    // the request, which EditorService has been supplying from `who` since the
    // day it was written. It stays commented out because Actor.ANONYMOUS has no
    // role, so enabling it before sign-in exists would correctly refuse
    // everything.
    const policy = new CompositeEditPolicy([
      new SealedByExportPolicy(() => activeSeals.ids),
      // new RoleEditPolicy(),
    ]);

    return {
      annotations,
      // Every write goes through this one object, so every change is checked,
      // validated, reversible and recorded. All four follow from there being
      // exactly one write path. See EditorService.
      editor: new EditorService(repo, {
        history: new CommandHistory(),
        policy,
        identity: who,
        changeLog: log,
        ids,
      }),
      documents: documentSource ?? new PdfJsDocumentSource(),
      identity: who,
      // Both read directly by the editor hook. Exposed because they are domain
      // ports — the presentation layer depending on them is the dependency rule
      // working, not a leak.
      exportHistory: exports_,
      changeLog: log,
      activeSeals,
      media,
      mediaUrls,
      /**
       * Downscales an image and stores it, returning what an annotation
       * carries. Exposed as one call so no caller can store the ORIGINAL by
       * doing the two steps separately — which would defeat every reason
       * the downscale exists (NFR-4).
       *
       * @param {Blob} blob
       * @returns {Promise<import('../domain/media/MediaRef').MediaRef>}
       */
      storePhoto: (blob) => imageProcessor.storeAsRef(blob, media),
      // Export runs in the browser today. When a 153-page set proves too large
      // to hold in memory, this becomes an HttpSheetExporter posting to a Go
      // job queue — a new adapter and this one line, because ExportService
      // depends on the SheetExporter contract rather than on pdf-lib.
      //
      // TWO export services, differing only in which SheetExporter they hold.
      // Neither knows how a markup reaches the page, or whether that way of
      // reaching it is permanent — each exporter answers `seals()` for itself.
      exports: new ExportService(
        annotations,
        exporter ?? new PdfLibSheetExporter({ media }),
        exports_,
        ids,
        { identity: who },
      ),
      exportsFlattened: new ExportService(
        annotations,
        new FlattenedSheetExporter({ media }),
        exports_,
        ids,
        { identity: who },
      ),
    };
  }, [repository, documentSource, exporter, exportHistory, changeLog, identity, mediaStore]);

  return <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>;
}

/**
 * Accessor for the wired services.
 * @throws {Error} if used outside the provider — a wiring mistake, not a state.
 */
export function useServices() {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error('useServices() must be called inside a <ServiceContainer>.');
  }
  return services;
}
