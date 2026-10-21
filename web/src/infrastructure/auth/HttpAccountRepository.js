import { Account } from '../../domain/identity/Account';
import { AccountRepository } from '../../domain/ports/AccountRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Sign-in against the Go API. TIER 3.
 *
 *   GET  /api/auth/me        -> 200 account | 401
 *   POST /api/auth/login     {email, password}                          -> 200 account
 *   POST /api/auth/register  {email, password, displayName, company, title} -> 201 account
 *   POST /api/auth/logout    -> 204
 *
 * The session is an HttpOnly cookie the server sets and the browser sends.
 * Nothing here — or anywhere in the app — ever sees or stores it, which is
 * what keeps a script injected into the page from stealing it.
 */
export class HttpAccountRepository extends AccountRepository {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async current() {
    try {
      return Account.fromJSON(await this.http.getJson('/auth/me'));
    } catch (error) {
      // Not signed in is an answer, not a failure. Anything else — the server
      // being down — is a failure the sign-in screen should explain.
      if (error?.status === 401) return null;
      throw error;
    }
  }

  async signIn(email, password) {
    return Account.fromJSON(await this.http.sendJson('POST', '/auth/login', { email, password }));
  }

  async register({ email, password, displayName, company, title = '' }) {
    return Account.fromJSON(
      await this.http.sendJson('POST', '/auth/register', { email, password, displayName, company, title }),
    );
  }

  async signOut() {
    await this.http.sendJson('POST', '/auth/logout');
  }
}
