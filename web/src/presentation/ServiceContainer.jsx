import { createContext, useContext, useMemo } from 'react';

import { AnnotationService } from '../domain/services/AnnotationService';
import { EditorService } from '../domain/services/EditorService';
import { ExportService } from '../domain/services/ExportService';
import { PdfJsDocumentSource } from '../infrastructure/pdf/PdfJsDocumentSource';
import { PdfLibSheetExporter, FlattenedSheetExporter } from '../infrastructure/export';
import { LocalStorageAnnotationRepository } from '../infrastructure/persistence/LocalStorageAnnotationRepository';
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
 *   Moving persistence to the Go API in Sprint 2 is exactly this diff:
 *       - new LocalStorageAnnotationRepository()
 *       + new HttpAnnotationRepository('/api')
 *
 *   Testing a component against a fake repository is exactly this:
 *       <ServiceContainer repository={new InMemoryAnnotationRepository()}>
 *
 * Nothing else changes in either case.
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
 */
export function ServiceContainer({ children, repository, documentSource, exporter }) {
  // useMemo, not a plain expression: these are stateful singletons. pdf.js holds
  // a Web Worker and the repository holds a cache, so rebuilding them on every
  // render would leak workers and drop in-flight state.
  //
  // Note that the AnnotationService constructor validates what it is handed
  // against the contracts — a mis-wiring throws HERE, at startup, with a message
  // naming the expected type, rather than three screens deep as
  // "undefined is not a function".
  const services = useMemo(() => {
    const repo = repository ?? new LocalStorageAnnotationRepository();
    const annotations = new AnnotationService(repo, new CryptoIdGenerator());

    return {
      annotations,
      // Every write goes through this one object, so every change is a
      // reversible Command and undo is correct by construction. See
      // EditorService for why AnnotationService no longer persists anything.
      editor: new EditorService(repo),
      documents: documentSource ?? new PdfJsDocumentSource(),
      // Export runs in the browser today. When a 153-page set proves too large
      // to hold in memory, this becomes an HttpSheetExporter posting to a Go
      // job queue — a new adapter and this one line, because ExportService
      // depends on the SheetExporter contract rather than on pdf-lib.
      // TWO export services, differing only in which SheetExporter they hold.
      // The contract made this a one-line addition: ExportService, the hook and
      // the UI are all unchanged, because none of them knows how a markup
      // reaches the page.
      exports: new ExportService(annotations, exporter ?? new PdfLibSheetExporter()),
      exportsFlattened: new ExportService(annotations, new FlattenedSheetExporter()),
    };
  }, [repository, documentSource, exporter]);

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
