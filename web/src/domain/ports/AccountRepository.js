import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — signing in, signing out, and creating an account.
 *
 * Separate from IdentityProvider on purpose. That port answers "who is doing
 * this?" synchronously, in the middle of a write; this one does the slow,
 * fallible business of establishing it. Keeping them apart is what lets
 * `current()` stay synchronous — see IdentityProvider.
 *
 * Errors are thrown with a message written for the person at the form ("Wrong
 * email or password."), so the sign-in screen can show them as they are.
 */
export class AccountRepository {
  static REQUIRED = ['current', 'signIn', 'register', 'signOut'];

  constructor() {
    enforceContract(this, new.target, AccountRepository);
  }

  /**
   * The account this browser is signed in as, or null.
   * @returns {Promise<import('../identity/Account').Account|null>}
   */
  async current() {
    return abstractMethod('AccountRepository', 'current');
  }

  /**
   * @param {string} email
   * @param {string} password
   * @returns {Promise<import('../identity/Account').Account>}
   */
  async signIn(email, password) {
    return abstractMethod('AccountRepository', 'signIn', email, password);
  }

  /**
   * Creates the account and signs in as it.
   * @param {{email: string, password: string, displayName: string, company: string, title?: string}} details
   * @returns {Promise<import('../identity/Account').Account>}
   */
  async register(details) {
    return abstractMethod('AccountRepository', 'register', details);
  }

  /** @returns {Promise<void>} */
  async signOut() {
    return abstractMethod('AccountRepository', 'signOut');
  }
}
