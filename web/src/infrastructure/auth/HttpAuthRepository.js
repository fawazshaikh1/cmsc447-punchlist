import { AuthRepository } from '../../domain/ports/AuthRepository';

/** Uses an HttpOnly session cookie; no passwords or tokens go into localStorage. */
export class HttpAuthRepository extends AuthRepository {
  constructor(baseUrl = '/api', fetchFn = globalThis.fetch.bind(globalThis)) {
    super(); this.baseUrl = baseUrl; this.fetchFn = fetchFn;
  }
  register({ email, password, name, company, title }) {
    return this.request('/auth/register', { email, password, name, company, title });
  }
  login({ email, password }) { return this.request('/auth/login', { email, password }); }
  logout() { return this.request('/auth/logout', {}); }
  async currentUser() {
    try { return await this.request('/auth/me'); }
    catch (error) { if (error.status === 401) return null; throw error; }
  }
  async request(path, body) {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Punchlist-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `Authentication request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
}
