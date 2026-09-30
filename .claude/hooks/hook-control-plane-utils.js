const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Roles that consult context-provider only through an architect (the mediated chain): specialists and the single-use
// planner. context-provider-consulted.js writes their per-role "an arch-* answered" flag and context-provider-gate.js
// reads it, so both hooks share this one list.
const ARCH_SENDER_PREFIXES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const MEDIATED_RECIPIENT_ROLES = Object.freeze([
  'test-specialist', 'toolkit-specialist', 'ui-specialist',
  'domain-model-specialist', 'data-layer-specialist', 'planner',
]);

const PROTECTED_SLUGS = new Set(['develop', 'master', 'main', 'HEAD']);

function isValidSlug(slug) {
  if (!slug || slug === '.' || slug === '..') return false;
  if (slug.includes('/') || slug.includes('\\')) return false;
  return /^[A-Za-z0-9._-]+$/.test(slug);
}

function isProtectedSlug(slug) {
  return PROTECTED_SLUGS.has(slug);
}

function slugFromBranch(branch) {
  if (!branch || branch === 'HEAD' || isProtectedSlug(branch)) return null;
  const slug = branch.split('/').pop();
  if (!slug || isProtectedSlug(slug) || !isValidSlug(slug)) return null;
  return slug;
}

function getGitBranch(projectRoot, timeout = 5000) {
  const symResult = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd: projectRoot,
    timeout,
    encoding: 'utf8',
  });
  const result = symResult.status === 0
    ? symResult
    : spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectRoot,
        timeout,
        encoding: 'utf8',
      });
  return result.status === 0 ? (result.stdout || '').trim() : '';
}

function slugFromPlanningAlias(projectRoot) {
  const planningDir = path.join(projectRoot, '.planning');
  if (!fs.existsSync(planningDir)) return null;
  const waveDirsWithPlan = fs.readdirSync(planningDir).filter(entry => {
    if (!/^wave-/.test(entry)) return false;
    return fs.existsSync(path.join(planningDir, entry, 'PLAN.md'));
  });
  if (waveDirsWithPlan.length !== 1) return null;
  const slug = waveDirsWithPlan[0].slice('wave-'.length);
  return isValidSlug(slug) ? slug : null;
}

function getWaveSlug(projectRoot, options = {}) {
  const useEnv = options.useEnv !== false;
  const useBranch = options.useBranch !== false;
  const useAlias = options.useAlias !== false;
  const protectedEnvReturnsNull = options.protectedEnvReturnsNull === true;
  const gitTimeoutMs = options.gitTimeoutMs || 5000;

  if (useEnv) {
    const envSlug = (process.env.CLAUDE_WAVE_SLUG || '').trim();
    if (envSlug && isProtectedSlug(envSlug) && protectedEnvReturnsNull) return null;
    if (envSlug && !isProtectedSlug(envSlug) && isValidSlug(envSlug)) return envSlug;
  }

  if (useBranch) {
    try {
      const branchSlug = slugFromBranch(getGitBranch(projectRoot, gitTimeoutMs));
      if (branchSlug) return branchSlug;
    } catch {
      // fall through to alias scan
    }
  }

  if (useAlias) {
    try {
      return slugFromPlanningAlias(projectRoot);
    } catch {
      // fail-open resolver: callers decide whether a missing slug blocks
    }
  }

  return null;
}

function loadYaml(projectRoot) {
  try {
    return require(path.resolve(__dirname, '..', '..', 'mcp-server', 'node_modules', 'yaml'));
  } catch {
    return null;
  }
}

module.exports = {
  ARCH_SENDER_PREFIXES,
  MEDIATED_RECIPIENT_ROLES,
  isValidSlug,
  isProtectedSlug,
  slugFromBranch,
  getWaveSlug,
  loadYaml,
};
