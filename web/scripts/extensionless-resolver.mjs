/**
 * Lets Node import the app's source the way Vite does.
 *
 * The codebase writes `import { PdfPoint } from '../geometry/PdfPoint'` with no
 * file extension, which every bundler resolves and which plain Node, following
 * the ESM spec, does not. Rather than rewriting ~80 files' imports to suit a
 * verification script — changing shipped code to please a test is the wrong way
 * round — this hook adds the extension only when resolution would otherwise
 * fail.
 *
 * It never overrides a specifier that already resolves, so it cannot change how
 * anything real is loaded.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('.') || specifier.startsWith('/');
    if (!relative || /\.[a-z]+$/i.test(specifier)) throw error;

    for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
      try {
        return await next(candidate, context);
      } catch {
        // Try the next shape.
      }
    }
    throw error;
  }
}
