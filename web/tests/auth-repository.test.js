import { expect, it, vi } from 'vitest';
import { HttpAuthRepository } from '../src/infrastructure/auth/HttpAuthRepository';

it('registers profile fields without accepting a role from the signup form', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'u' }, { status: 201 }));
  const repo = new HttpAuthRepository('/api', fetch);
  await repo.register({ email: 'u@example.com', password: 'long test password', name: 'U', company: 'Co', title: 'Engineer', role: 'admin' });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/auth/register');
  expect(options.credentials).toBe('same-origin');
  expect(options.headers['X-Punchlist-Request']).toBe('1');
  expect(JSON.parse(options.body)).not.toHaveProperty('role');
});
it('returns a profile on login and handles empty logout responses', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 'u' })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  const repo = new HttpAuthRepository('/api', fetch);
  await expect(repo.login({ email: 'u@example.com', password: 'long test password' })).resolves.toEqual({ id: 'u' });
  await expect(repo.logout()).resolves.toBeNull();
});
it('treats an expired session as logged out', async () => {
  const repo = new HttpAuthRepository('/api', vi.fn().mockResolvedValue(Response.json({ error: 'authentication required' }, { status: 401 })));
  await expect(repo.currentUser()).resolves.toBeNull();
});
it('does not hide a server failure as a logged-out session', async () => {
  const repo = new HttpAuthRepository('/api', vi.fn().mockResolvedValue(new Response('server error', { status: 500 })));
  await expect(repo.currentUser()).rejects.toMatchObject({ status: 500 });
});
it('passes credential rejection to the login form', async () => {
  const repo = new HttpAuthRepository('/api', vi.fn().mockResolvedValue(Response.json({ error: 'invalid email or password' }, { status: 401 })));
  await expect(repo.login({ email: 'x', password: 'wrong' })).rejects.toThrow('invalid email or password');
});
