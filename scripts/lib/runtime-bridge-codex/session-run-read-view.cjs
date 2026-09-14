'use strict';

// The session-run isolation-root config.toml starting content, its post-hoc strict-config validator, and the host-private read-view credential registry.

function createSessionRunReadView({
  fs,
  path,
}) {
/**
 * M6 CORRECTION PASS (P1-2): a REAL, minimal, honest strictConfigValidator
 * for session-run's own supervisor-root IsolationProvider instance --
 * genuinely reads the materialized config.toml back and confirms the two
 * security-relevant sections finalizeRunRoot itself always writes are
 * present. The real `codex --strict-config` binary-level parse this literal
 * flag name refers to has no separate, synchronous, local entrypoint
 * anywhere in this codebase (the actual codex binary only validates it at
 * spawn time, via the SAME --strict-config argv flag
 * DEFAULT_APP_SERVER_SPAWN_ARGS already passes) -- this is a real, if
 * narrower, structural check, never a rubber-stamp no-op.
 * @param {string} configPath
 * @returns {{ok:boolean}}
 */
/**
 * The child's config.toml as first materialized, before finalizeRunRoot credits the role
 * permission profile into it. Top-level keys must precede the first table header or TOML makes
 * them members of that table and --strict-config rejects the file.
 *
 * `project_doc_max_bytes = 0` is load-bearing, not a tidy-up. Codex loads AGENTS.md for the
 * `local` environment while starting a thread, and that step prepares an fs sandbox; on Windows
 * without elevation its restricted-token sandbox cannot express the split filesystem reads the
 * credited role profile asks for (workspace reads denied, one accredited read-view granted), so
 * it refuses to run at all -- "failed to load AGENTS.md instructions for environment `local`:
 * failed to prepare fs sandbox: ... refusing to run unsandboxed" -- and thread/start fails.
 * Reproduced against codex-cli 0.153.4 with the shipped profile and with every widened variant of
 * it; only removing the project-document load clears it. That is a NARROWING: this worker is
 * forbidden every tool and every file read, its readable scope is exactly the accredited
 * read-view, and project documentation was never part of that scope. The permission profile
 * itself -- denied workspace reads, the credited read-view, network disabled -- is unchanged.
 */
const INITIAL_ISOLATION_CONFIG_TOML = 'project_doc_max_bytes = 0\n\n[shell_environment_policy]\ninherit = "none"\n';

function strictConfigValidatorForSessionRun(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    return { ok: false };
  }
  if (!text.includes('[shell_environment_policy]') || !text.includes('inherit = "none"')) return { ok: false };
  if (!text.includes('network.enabled = false')) return { ok: false };
  // Checked as a top-level key: below the first table header it would belong to that table, and
  // the child would silently go back to loading project documentation -- the step whose Windows
  // fs sandbox the credited role profile cannot survive.
  const projectDocIdx = text.indexOf('project_doc_max_bytes = 0');
  const firstTableIdx = text.indexOf('[');
  if (projectDocIdx === -1) return { ok: false };
  if (firstTableIdx !== -1 && projectDocIdx > firstTableIdx) return { ok: false };
  return { ok: true };
}

/**
 * Host-private registry for the fixed per-role read-view roots credited into
 * generated Codex permission profiles.  Capabilities are object identities in
 * a WeakMap, not serializable tokens.  The root is registered once, before
 * `finalizeRunRoot`, and every resolution rechecks the exact run+role pair and
 * the root's directory identity.  Per-turn `current/` contents are built and
 * verified separately below without widening the credited workspace root.
 */
function createSessionRunReadViewAuthority() {
  const scopes = new WeakMap();
  function resolve(capability, opts) {
    const scope = capability && typeof capability === 'object' ? scopes.get(capability) : null;
    if (!scope) return { ok: false, reason: 'CAPABILITY_REJECTED' };
    if (!opts || opts.expectedRunId !== scope.runId || opts.expectedRole !== scope.role) {
      return { ok: false, reason: 'CAPABILITY_SCOPE_MISMATCH' };
    }
    let st;
    try { st = fs.lstatSync(scope.readViewRoot); }
    catch (err) { return { ok: false, reason: 'READ_VIEW_ROOT_UNAVAILABLE' }; }
    if (!st.isDirectory() || st.isSymbolicLink() || st.dev !== scope.dev || st.ino !== scope.ino) {
      return { ok: false, reason: 'READ_VIEW_ROOT_REBOUND' };
    }
    return { ok: true, workspaceRoots: [scope.readViewRoot] };
  }
  function authority(capability, opts) { return resolve(capability, opts); }
  authority.resolve = resolve;
  authority.register = (capability, scope) => {
    if (!capability || typeof capability !== 'object' || scopes.has(capability)) {
      return { ok: false, reason: 'READ_VIEW_CAPABILITY_INVALID' };
    }
    if (
      !scope || typeof scope !== 'object'
      || typeof scope.runId !== 'string' || typeof scope.role !== 'string'
      || typeof scope.readViewRoot !== 'string' || !path.isAbsolute(scope.readViewRoot)
    ) return { ok: false, reason: 'READ_VIEW_SCOPE_INVALID' };
    let st;
    try { st = fs.lstatSync(scope.readViewRoot); }
    catch (err) { return { ok: false, reason: 'READ_VIEW_ROOT_UNAVAILABLE' }; }
    if (!st.isDirectory() || st.isSymbolicLink()) return { ok: false, reason: 'READ_VIEW_ROOT_INVALID' };
    scopes.set(capability, Object.freeze({
      runId: scope.runId, role: scope.role, readViewRoot: scope.readViewRoot,
      dev: st.dev, ino: st.ino,
    }));
    return { ok: true };
  };
  return authority;
}

  return Object.freeze({
    INITIAL_ISOLATION_CONFIG_TOML,
    createSessionRunReadViewAuthority,
    strictConfigValidatorForSessionRun,
  });
}

module.exports = Object.freeze({ createSessionRunReadView });
