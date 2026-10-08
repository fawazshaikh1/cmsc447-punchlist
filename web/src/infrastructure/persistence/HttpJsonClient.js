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
   * @param {string} path Starts with '/', relative to the base.
   * @param {RequestInit} [init]
   * @param {number[]} [tolerate] Statuses treated as success.
   * @returns {Promise<Response>}
   */
  async request(path, init = {}, tolerate = []) {
    let response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw new Error(
        `Cannot reach the Punch List server at ${this.baseUrl || '/'}. Is the backend running?`,
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
            `(${response.status} ${response.statusText}). Is the backend running?`.replace(' )', ')'),
        );
      }
      throw new Error(
        `${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${response.statusText}`.trim(),
      );
    }
    return response;
  }
}
