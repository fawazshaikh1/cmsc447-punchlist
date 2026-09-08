import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * CONTRACT — supplies identifiers for newly created domain objects.
 *
 * Injected rather than calling `crypto.randomUUID()` inline so that unit tests
 * can assert on exact ids with a counting fake, instead of matching a regex or
 * snapshotting random output.
 *
 * ---------------------------------------------------------------------------
 * WHY IDS ARE GENERATED ON THE CLIENT, NOT BY POSTGRES
 * ---------------------------------------------------------------------------
 * A deliberate choice for an offline-first application. A pin dropped in a
 * basement with no signal needs a stable identity IMMEDIATELY — to render, to
 * be selected, to be edited, to be queued in the Sprint 3 outbox — long before
 * a server ever sees it.
 *
 * Letting the database assign the id would make offline creation impossible
 * without a temporary-id remapping scheme, which is a well-known source of sync
 * bugs (every reference to the temporary id has to be rewritten when the real
 * one arrives, and anything that missed the rewrite silently points at nothing).
 * UUIDs sidestep the whole problem.
 */
export class IdGenerator {
  static REQUIRED = ['next'];

  constructor() {
    enforceContract(this, new.target, IdGenerator);
  }

  /** @returns {string} A new unique identifier. */
  next() {
    return abstractMethod('IdGenerator', 'next');
  }
}
