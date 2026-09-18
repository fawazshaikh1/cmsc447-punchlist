/**
 * Installs the extensionless-import resolver. Used via
 * `node --import ./scripts/register-resolver.mjs ...`.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./extensionless-resolver.mjs', pathToFileURL(`${import.meta.dirname}/`));
