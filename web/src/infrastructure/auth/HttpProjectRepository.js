import { AnnotationRegistry } from '../../domain/annotations/AnnotationRegistry';
import { Member } from '../../domain/projects/Member';
import { Project } from '../../domain/projects/Project';
import { ProjectRepository } from '../../domain/ports/ProjectRepository';
import { HttpJsonClient } from '../persistence/HttpJsonClient';

/**
 * Projects and their members, from the Go API. TIER 3.
 *
 *   GET    /api/projects                              -> 200 [{id, name, role}]
 *   POST   /api/projects                {name}        -> 201 {id, name, role}
 *   GET    /api/projects/{id}/members                 -> 200 [member]
 *   PUT    /api/projects/{id}/members   {email, role} -> 200 member
 *   DELETE /api/projects/{id}/members/{userId}        -> 204
 *   GET    /api/projects/{id}/items                   -> 200 [annotation]
 */
export class HttpProjectRepository extends ProjectRepository {
  /**
   * @param {string} baseUrl e.g. '/api'
   * @param {typeof fetch} [fetchFn] Injectable so tests need no network.
   */
  constructor(baseUrl, fetchFn) {
    super();
    this.http = new HttpJsonClient(baseUrl, fetchFn);
  }

  async list() {
    const rows = await this.http.getJson('/projects');
    return rows.map((dto) => Project.fromJSON(dto));
  }

  async create(name) {
    return Project.fromJSON(await this.http.sendJson('POST', '/projects', { name }));
  }

  async members(projectId) {
    const rows = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/members`);
    return rows.map((dto) => Member.fromJSON(dto));
  }

  async setMember(projectId, email, role) {
    return Member.fromJSON(
      await this.http.sendJson('PUT', `/projects/${HttpJsonClient.segment(projectId)}/members`, { email, role }),
    );
  }

  async removeMember(projectId, userId) {
    await this.http.sendJson(
      'DELETE',
      `/projects/${HttpJsonClient.segment(projectId)}/members/${HttpJsonClient.segment(userId)}`,
    );
  }

  async items(projectId) {
    const rows = await this.http.getJson(`/projects/${HttpJsonClient.segment(projectId)}/items`);
    // A kind this build does not know is skipped, as everywhere else.
    return rows.map((dto) => AnnotationRegistry.tryFromJSON(dto)).filter((annotation) => annotation !== null);
  }
}
