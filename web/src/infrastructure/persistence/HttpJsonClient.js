import { EditDecision } from '../../domain/policy/EditDecision';
import { EditNotPermittedError } from '../../domain/policy/EditNotPermittedError';

/**
 * The few lines every HTTP repository needs, written once. TIER 3.
 *
 * Builds URLs under one base, sends and reads JSON, and turns the two ways a
 * request fails into errors a person can act on:
 *
 *   the server answered with an error   "POST /exports failed: 500 Internal Server Error"
 *   nothing answered at all             "Cannot reach the Punch List server at /api.
 *                                        Is the backend running?"
 *   a proxy answered for a dead server  "The Punch List server at /api is not
 *   (502/503/504)                        responding (502 Bad Gateway). Is the
 *                                        backend running?"
 *
 * The second matters most. `fetch` rejects with a bare "Failed to fetch" when
 * the Go server is not running, and that sentence reaching the error banner
 * tells nobody what to do about it.
 */
/** Gateway answers that mean "the API behind me is not there". */
const UNREACHABLE = new Set([502, 503, 504]);

/**
 * In development the server is the default, so a teammate who has not started
 * it needs to be told the other way to work. A deployed build never shows
 * this — there is no dev:browser there to suggest.
 */
const DEV_HINT = import.meta.env?.DEV
  ? ' To work without it, run `npm run dev:browser` instead.'
  : '';

export class HttpJsonClient {
  /**
   * @param {string} baseUrl e.g. '/api'. No trailing slash.
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn = globalThis.fetch?.bind(globalThis)) {
    if (typeof baseUrl !== 'string') throw new TypeError('HttpJsonClient needs a base URL string.');
    if (typeof fetchFn !== 'function') throw new TypeError('HttpJsonClient needs a fetch function.');

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }

  /**
   * One path segment, encoded. Sheet ids are `drawing.pdf#0`, and an unencoded
   * `#` would end the URL there — the server would never see the page index.
   *
   * @param {string} value
   */
  static segment(value) {
    return encodeURIComponent(String(value));
  }

  /** @param {string} path @returns {Promise<any>} The parsed JSON body. */
  async getJson(path) {
    const response = await this.request(path);
    return response.json();
  }

  /** @param {string} path @param {unknown} body */
  async postJson(path, body) {
    await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * Any method, with an optional JSON body, answering with the parsed JSON
   * response — or null for an empty one (204).
   *
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async sendJson(method, path, body) {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await this.request(path, init);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * @param {string} path Starts with '/', relative to the base.
   * @param {RequestInit} [init]
   * @param {number[]} [tolerate] Statuses treated as success.
   * @returns {Promise<Response>}
   */
  async request(path, init = {}, tolerate = []) {
    let response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        // Every request says it comes from this app. The server refuses a
        // change without it — another site cannot add a custom header without
        // the server's consent, so this is what stops a malicious page from
        // acting with the signed-in person's cookie (see backend/access.go).
        headers: { ...init.headers, 'X-Punchlist-Request': '1' },
      });
    } catch (cause) {
      throw new Error(
        `Cannot reach the Punch List server at ${this.baseUrl || '/'}. Is the backend running?${DEV_HINT}`,
        { cause },
      );
    }

    if (!response.ok && !tolerate.includes(response.status)) {
      // 502/503/504 come from whatever sits in front of the API — the Vite
      // proxy in development, a load balancer in production — and mean the
      // same thing as fetch failing outright: nothing is answering behind it.
      if (UNREACHABLE.has(response.status)) {
        throw new Error(
          `The Punch List server at ${this.baseUrl || '/'} is not responding ` +
            `(${response.status} ${response.statusText}). Is the backend running?`.replace(' )', ')') +
            DEV_HINT,
        );
      }
      // The server explains refusals in a sentence meant for the person —
      // "Your role on this project does not allow that change." — and that
      // sentence is far more useful in the banner than "403 Forbidden".
      const explained = await serverMessage(response);

      // A refusal is the server's half of the permission model, so it arrives
      // as the same error the client-side policy throws — callers that already
      // handle "not permitted" need nothing new, and the upload of browser
      // data can tell "not allowed" (final) from "server down" (try again).
      if (response.status === 403) {
        const refused = new EditNotPermittedError(
          EditDecision.deny(explained ?? 'The server refused that change.', 'server'),
        );
        refused.status = 403;
        throw refused;
      }

      throw new HttpError(
        explained ??
          `${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${response.statusText}`.trim(),
        response.status,
      );
    }
    return response;
  }
}

/**
 * A request the server answered with an error. `status` lets a caller tell
 * "sign in again" (401) from "not allowed" (403) without parsing the message.
 */
export class HttpError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    // `name` is left as Error's own, so the message reads exactly as an
    // ordinary Error would anywhere it is printed.
    super(message);
    this.status = status;
  }
}

/** The `{"error": "..."}` message from a JSON error response, if there is one. */
async function serverMessage(response) {
  const type = response.headers?.get?.('Content-Type') ?? '';
  if (!type.includes('application/json')) return null;
  try {
    const body = await response.json();
    return typeof body?.error === 'string' && body.error ? body.error : null;
  } catch {
    return null;
  }
}
