'use strict';

const PUSH_REQUEST_ROLES = Object.freeze(new Set([
  'quality-gater', 'arch-platform', 'arch-testing', 'arch-integration',
]));

/**
 * Actor policy is deliberately separate from proof authority.
 * Disk evidence and the installed pre-push hook authorize refs; this function
 * only describes which observed runtime actor may request or perform the host
 * action.  `runtimeBound` is honest capability metadata, never inferred from a
 * caller-supplied role string.
 */
function authorizePushActor({ agentType = '', operation = 'perform', runtimeBound = false } = {}) {
  const role = String(agentType || '').trim();
  if (operation === 'request') {
    if (!role) return { ok: true, assurance: 'host-main' };
    if (PUSH_REQUEST_ROLES.has(role)) {
      return { ok: true, assurance: runtimeBound ? 'runtime-capability' : 'advisory-role' };
    }
    return { ok: false, reason: 'ROLE_NOT_AUTHORIZED_TO_REQUEST_PUSH' };
  }
  if (operation !== 'perform') return { ok: false, reason: 'UNKNOWN_PUSH_OPERATION' };
  if (role) return { ok: false, reason: 'PEER_PUSH_PERFORM_DENIED' };
  return { ok: true, assurance: runtimeBound ? 'runtime-capability' : 'host-main' };
}

module.exports = { authorizePushActor, PUSH_REQUEST_ROLES };
