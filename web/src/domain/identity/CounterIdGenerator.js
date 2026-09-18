import { IdGenerator } from '../ports/IdGenerator';

/**
 * Ids from an incrementing counter, prefixed and timestamped.
 *
 * ===========================================================================
 * NOT FOR ANNOTATIONS. FOR RECORDS NOBODY LINKS TO.
 * ===========================================================================
 * Annotation ids must survive being merged with another device's work in
 * Sprint 3, which is why they come from `CryptoIdGenerator` and are UUIDs. A
 * counter would collide the moment two tablets synced.
 *
 * Change-log entries are different: nothing ever references one by id, they are
 * always read as a list scoped to a sheet, and the ordering that matters comes
 * from the timestamp. So a counter is genuinely sufficient, and it makes this
 * class usable in tests and as a default without dragging a browser API into
 * the domain tier.
 *
 * The timestamp component means ids from two sessions do not overlap, which
 * keeps a merged log readable even though nothing depends on it.
 */
export class CounterIdGenerator extends IdGenerator {
  /** @param {string} [prefix] Marks what kind of record the id belongs to. */
  constructor(prefix = 'chg') {
    super();
    this.prefix = prefix;
    this.count = 0;
  }

  next() {
    this.count += 1;
    return `${this.prefix}_${Date.now().toString(36)}_${this.count}`;
  }
}
