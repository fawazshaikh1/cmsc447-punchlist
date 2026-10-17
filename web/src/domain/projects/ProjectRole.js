/**
 * The three roles a person can have on a project.
 *
 * Per project, never global: the stakeholder (2026-09-11) was specific that
 * someone can administer one project and only add photos on another. The ids
 * are the ones the server stores (the `member_role` enum in schema.sql) and the
 * ones `RoleEditPolicy` keys its table on, so they are defined once, here.
 */
export const ProjectRole = Object.freeze({
  ADMIN: 'admin',
  POWER_COLLABORATOR: 'power_collaborator',
  COLLABORATOR: 'collaborator',
});

/** Most to least access — the order people are listed and offered in. */
export const PROJECT_ROLES = Object.freeze([
  ProjectRole.ADMIN,
  ProjectRole.POWER_COLLABORATOR,
  ProjectRole.COLLABORATOR,
]);

/**
 * How each role is named and explained to a person choosing one. Wording, not
 * rules: what each role may actually do is RoleEditPolicy's table and, on the
 * server, access.go.
 */
export const ROLE_DESCRIPTIONS = Object.freeze({
  [ProjectRole.ADMIN]: Object.freeze({
    label: 'Admin',
    summary: 'Everything, plus adding people and choosing their roles.',
  }),
  [ProjectRole.POWER_COLLABORATOR]: Object.freeze({
    label: 'Power collaborator',
    summary: 'Adds, edits, moves and deletes markups, and issues PDFs.',
  }),
  [ProjectRole.COLLABORATOR]: Object.freeze({
    label: 'Collaborator',
    summary: 'Views the sheets and adds photos. Cannot change existing items.',
  }),
});

/** @param {string} role @returns {boolean} */
export function isProjectRole(role) {
  return PROJECT_ROLES.includes(role);
}
