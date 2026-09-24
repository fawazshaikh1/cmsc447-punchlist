import { enforceContract, abstractMethod } from '../support/contracts';

/** Account/session boundary. Project roles come from the server, never signup. */
export class AuthRepository {
  static REQUIRED = ['register', 'login', 'logout', 'currentUser'];
  constructor() { enforceContract(this, new.target, AuthRepository); }
  register() { return abstractMethod('AuthRepository', 'register'); }
  login() { return abstractMethod('AuthRepository', 'login'); }
  logout() { return abstractMethod('AuthRepository', 'logout'); }
  currentUser() { return abstractMethod('AuthRepository', 'currentUser'); }
}
