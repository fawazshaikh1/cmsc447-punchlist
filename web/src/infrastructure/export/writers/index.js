/**
 * Loads every PDF writer so each registers itself with PdfWriterRegistry.
 *
 * Same import-side-effect pattern as the other three registries. Importing this
 * barrel is what makes export work; PdfLibSheetExporter imports it for exactly
 * that reason.
 *
 * >>> ADDING A MARKUP TYPE: add its writer import below. If you forget, export
 * >>> THROWS on the first annotation of that kind rather than silently omitting
 * >>> it — see PdfWriterRegistry.write for why that choice was made.
 */
import './pinWriter';
import './rectangleWriter';
import './cloudWriter';
import './arrowWriter';
import './inkWriter';
import './textWriter';
import './photoWriter';
