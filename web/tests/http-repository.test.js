import { expect, it, vi } from 'vitest';
import { HttpAnnotationRepository } from '../src/infrastructure/persistence/HttpAnnotationRepository';
import { Pin } from '../src/domain/annotations/Pin';
import { PdfPoint } from '../src/domain/geometry/PdfPoint';

it('sends cookie credentials, CSRF header and annotation DTO to the existing API', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const repo = new HttpAnnotationRepository('/api', fetch);
  const pin = new Pin('pin/1', 'sheet', new PdfPoint(4, 5), 'Repair', 'open', new Date());
  await repo.save(pin);
  expect(fetch).toHaveBeenCalledWith('/api/annotations/pin%2F1', expect.objectContaining({
    method: 'PUT', credentials: 'same-origin', body: JSON.stringify(pin.toJSON()),
    headers: { 'Content-Type': 'application/json', 'X-Punchlist-Request': '1' },
  }));
});
it.each([401, 403])('surfaces %s rather than silently accepting a rejected save', async (status) => {
  const repo = new HttpAnnotationRepository('/api', vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(repo.clearSheet('sheet')).rejects.toThrow(String(status));
});
it('tolerates an already-deleted annotation, but not other failures', async () => {
  const repo = new HttpAnnotationRepository('/api', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  await expect(repo.delete('missing')).resolves.toBeUndefined();
  await expect(repo.listBySheet('missing')).rejects.toThrow('404');
});
