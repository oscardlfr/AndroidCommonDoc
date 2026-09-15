'use strict';

const impl = process.env.RUNTIME_ROLE_LIFECYCLE_IMPL;
const deniedRole = process.env.RUNTIME_ROLE_ACTOR_BINDING_FAILURE_ROLE;
if (typeof impl !== 'string' || impl.length === 0 || typeof deniedRole !== 'string' || deniedRole.length === 0) {
  throw new Error('runtime-role-actor-binding-failure-preload requires an implementation path and denied role');
}

const lifecycle = require(impl);
const original = lifecycle.createRoleActorBinding;
lifecycle.createRoleActorBinding = function createRoleActorBindingWithTestFailure(projectRoot, role, ...rest) {
  if (role === deniedRole) return { ok: false, reason: 'test-injected-role-actor-binding-failure' };
  return original.call(this, projectRoot, role, ...rest);
};

