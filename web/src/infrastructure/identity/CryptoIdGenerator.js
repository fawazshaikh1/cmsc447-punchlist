import { IdGenerator } from '../../domain/ports/IdGenerator';

/**
 * UUIDv4 generator using the Web Crypto API. TIER 3.
 *
 * `crypto.randomUUID()` produces values that drop straight into a Postgres
 * `uuid` column with no conversion on the Go side.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FALLBACK IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * `crypto.randomUUID` is only exposed in SECURE CONTEXTS — HTTPS or localhost.
 * Testing on an iPad over the LAN means loading a bare `http://192.168.x.x`
 * origin, which is NOT a secure context. Without this fallback, every single
 * pin drop would throw on exactly the device this feature is being built for,
 * and it would work perfectly on the laptop it was written on.
 *
 * The fallback is not cryptographically strong. It does not need to be: these
 * ids are opaque handles, never secrets and never security boundaries.
 */
export class CryptoIdGenerator extends IdGenerator {
  /** @returns {string} */
  next() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return fallbackUuidV4();
  }
}

function fallbackUuidV4() {
  const bytes = new Uint8Array(16);

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
