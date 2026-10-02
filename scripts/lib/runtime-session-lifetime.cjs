'use strict';

// Sliding-session lifetimes, in one place. A session generation and the bindings hanging from it expire after ONE HOUR OF
// INACTIVITY (idle timeout) and never live longer than TWELVE HOURS from their creation (absolute timeout). Only a hook
// renews the idle expiry, after the actor's identity proof has passed (see runtime-session-renewal.cjs); the absolute limit
// is derived from `created_at`, so no record needs a new field.

const SESSION_IDLE_TTL_SECONDS = 3600;
const SESSION_ABSOLUTE_TTL_SECONDS = 12 * 3600;
const SESSION_RENEW_BELOW_SECONDS = 3000;

/** The instant (ms) at which a record created at `createdAtIso` reaches its absolute lifetime. */
function absoluteLimitMs(createdAtIso) {
  return Date.parse(createdAtIso) + SESSION_ABSOLUTE_TTL_SECONDS * 1000;
}

module.exports = Object.freeze({
  SESSION_IDLE_TTL_SECONDS, SESSION_ABSOLUTE_TTL_SECONDS, SESSION_RENEW_BELOW_SECONDS, absoluteLimitMs,
});
