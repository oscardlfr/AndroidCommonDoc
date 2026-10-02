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

// A runtime command whose authority is minted by a hook (a requester, target, lifecycle or entrypoint grant) only
// gets that grant when it is the canonical standalone form. Chained after `date;`, behind a heredoc or with another
// quoting, it reaches the CLI without a grant and fails with an opaque AUTHORITY_INVALID, so a recognizable invocation
// that is not that standalone form is denied with the recovery instead. One definition, shared by every gate.
const RUNTIME_COMMAND_START = '(?:^|[;&|`(\\n]|\\$\\()\\s*';
const RUNTIME_NODE_TOKEN = '[\'"]?(?:[^\\s\'";&|]*/)?node(?:\\.exe)?[\'"]?\\s+';
const RUNTIME_PATH_PREFIX = '(?:[^\\s\'";&|]*/)?';

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runtimeInvocationPattern(scriptPattern, subcommands) {
  return new RegExp(RUNTIME_COMMAND_START + RUNTIME_NODE_TOKEN + '[\'"]?' + scriptPattern + '[\'"]?\\s+'
    + subcommands, 'm');
}

/**
 * @param {string} command raw Bash command
 * @param {{parseDirect?: function(string): (string[]|null), launchers?: boolean,
 *          canonicalClis?: Array<{path: string, subcommands: string[]}>}} [options]
 *   parseDirect returns the tokens of a command that is exactly one canonical direct command, else null.
 *   launchers (default true) also recognizes the installed toolkit launcher `runtime-consult` operations.
 * @returns {null|{family: string, operation: string}} null when the command is canonical, or has no recognized invocation
 */
function chainedRuntimeInvocation(command, options = {}) {
  if (typeof command !== 'string' || command.length === 0) return null;
  if (typeof options.parseDirect === 'function' && options.parseDirect(command)) return null;
  const text = command.replace(/\\/g, '/');
  const patterns = [];
  if (options.launchers !== false) {
    patterns.push(['consult-launcher', runtimeInvocationPattern(
      RUNTIME_PATH_PREFIX + '\\.claude/runtime/l0-toolkit-launcher\\.cjs[\'"]?\\s+[\'"]?run[\'"]?\\s+[\'"]?runtime-consult[\'"]?[^;&|\\n]*?\\s[\'"]?--[\'"]?',
      '[\'"]?(consult|record-delivery|await-result|accept-result)[\'"]?(?![\\w-])')]);
  }
  for (const cli of options.canonicalClis || []) {
    if (!cli || typeof cli.path !== 'string' || !Array.isArray(cli.subcommands) || cli.subcommands.length === 0) continue;
    patterns.push(['canonical-cli', runtimeInvocationPattern(
      escapeRegExp(cli.path.replace(/\\/g, '/')),
      '[\'"]?(' + cli.subcommands.map(escapeRegExp).join('|') + ')[\'"]?(?![\\w-])')]);
  }
  for (const [family, pattern] of patterns) {
    const match = pattern.exec(text);
    if (match) return { family, operation: match[1] };
  }
  return null;
}

/** The recovery a gate shows for a chained runtime command; callers prefix their own tag. */
function standaloneRuntimeCommandMessage(operation) {
  const base = 'run ' + operation + ' as ONE standalone command (no heredoc, pipe, &&, ;, $(...)). '
    + 'Nothing may come before or after it, and every token must be single-quoted';
  return operation === 'publish-result'
    ? base + ': write the result with the Write tool, compute base64url in a separate Bash call, then pass the literal value to --content.'
    : base + '; run date, stat and every other command in its own call.';
}

module.exports = {
  ARCH_SENDER_PREFIXES,
  MEDIATED_RECIPIENT_ROLES,
  isValidSlug,
  isProtectedSlug,
  slugFromBranch,
  getWaveSlug,
  loadYaml,
  chainedRuntimeInvocation,
  standaloneRuntimeCommandMessage,
};
