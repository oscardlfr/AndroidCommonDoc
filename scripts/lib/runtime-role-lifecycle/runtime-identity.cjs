'use strict';

// Extracted verbatim from runtime-role-lifecycle.cjs (formerly lines 815-1021):
// principal/repo/worktree/coordination identity and PLAN/profile discovery.
// Narrow factory inputs only -- never requires the facade or either sibling
// facade, directly or transitively.

const fs = require('fs');
const os = require('os');
const path = require('path');

function createRuntimeIdentityModule({
  sha256String, sha256File, gitRevParse, realpathOrSelf, isTestCapability, CANONICAL_ROLES,
  defaultTemplateRoot,
}) {
  /** POSIX uid, or a hashed OS username fallback (Windows has no process.getuid). */
  function computePrincipalId() {
    if (typeof process.getuid === 'function') return 'uid-' + process.getuid();
    return 'user-' + sha256String(os.userInfo().username);
  }

  // Registry path helpers resolve the repo identity once per record, so a
  // single hook event over an accumulated registry used to spawn hundreds of
  // `git rev-parse` processes and exceed the host hook timeout. Identities are
  // memoized per process, keyed by the on-disk identity of `<root>/.git`, so a
  // repository recreated at the same path is never answered from a stale entry.
  const identityCache = new Map();
  function cachedGitIdentity(kind, projectRoot, compute) {
    let key = null;
    try {
      const st = fs.statSync(path.join(projectRoot, '.git'));
      key = [kind, projectRoot, st.dev, st.ino, st.mtimeMs].join('\0');
    } catch { return compute(); }
    if (!identityCache.has(key)) identityCache.set(key, compute());
    return identityCache.get(key);
  }

  function computeRepoId(projectRoot) {
    return cachedGitIdentity('repo', projectRoot, () => {
      const commonDir = gitRevParse(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      return sha256String(realpathOrSelf(commonDir));
    });
  }

  function computeWorktreeId(projectRoot) {
    return cachedGitIdentity('worktree', projectRoot, () => {
      const toplevel = gitRevParse(projectRoot, ['rev-parse', '--show-toplevel']);
      return sha256String(realpathOrSelf(toplevel));
    });
  }

  /**
   * Resolves the DEEPEST EXISTING ANCESTOR of `fullPath` via a real
   * `fs.realpathSync` (following every symlink up to and including that
   * ancestor), then re-joins whatever trailing segments do not exist yet
   * UNRESOLVED. Point 2.1 (R4), round 2: a single `realpathOrSelf` on only
   * the git worktree toplevel was stable against an external alias of the
   * ENTIRE projectRoot prefix (e.g. macOS's `/tmp` -> `/private/tmp`), but
   * NOT against an INTERNAL symlink at any deeper, project-owned ancestor --
   * e.g. `.planning` itself resolving to some other real sibling directory.
   * Reproduced: `.planning` a valid symlink, `coordination_root_id` computed
   * once before `coordination/` exists (falls back to the raw, `.planning`
   * still-unresolved path since the FULL path doesn't exist yet) and once
   * after (the full path NOW exists, so `fs.realpathSync` resolves EVERY
   * component including `.planning`'s symlink) produced two DIFFERENT
   * hashes for the SAME logical root. Resolving the deepest EXISTING
   * ancestor at every call, whatever depth that happens to be, converges to
   * the SAME answer once the full path exists (a plain multi-segment
   * `fs.realpathSync` resolves every intermediate symlink identically to
   * this function resolving them one ancestor at a time), and never regresses
   * once an ancestor starts existing (each existing ancestor's OWN identity
   * is assumed stable for the life of a session -- nothing in this codebase
   * renames/re-symlinks `.planning` or the worktree toplevel mid-session).
   * Structurally cannot exhaust to the filesystem root in practice: the git
   * worktree toplevel is the outermost caller-relevant ancestor and always
   * exists (git itself requires it).
   */
  function deepestExistingAncestorRealpath(fullPath) {
    const trailing = [];
    let current = fullPath;
    for (;;) {
      try {
        const real = fs.realpathSync(current);
        return trailing.length === 0 ? real : path.join(real, ...trailing);
      } catch (err) {
        const parent = path.dirname(current);
        if (parent === current) return fullPath; // filesystem root reached -- fail safe, never throw.
        trailing.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  /**
   * The one fixed, deterministic, STABLE coordination-root path for
   * `projectRoot` -- never caller-suppliable at this layer (PLAN.md ~L536).
   * See `deepestExistingAncestorRealpath` for the exact stability argument
   * (point 2.1, R4 round 2): stable IDENTICALLY before and after root-init,
   * AND before and after any project-internal ancestor (e.g. `.planning`)
   * turning out to be a symlink, not merely an external alias of the whole
   * `projectRoot` prefix.
   */
  function coordinationRootPathFor(projectRoot) {
    const toplevel = gitRevParse(projectRoot, ['rev-parse', '--show-toplevel']);
    return deepestExistingAncestorRealpath(path.join(toplevel, '.planning', 'coordination'));
  }

  /**
   * `coordination_root_id` (PLAN.md ~L289: `sha256(realpath(coordination_root))`,
   * never a raw path). `realpathOrSelf` here is now a defensive, effectively
   * idempotent second pass over an ALREADY-stable path (see
   * `coordinationRootPathFor`) -- retained so a caller supplying some OTHER,
   * not-yet-fully-resolved path still gets a best-effort stable hash.
   */
  function computeCoordinationRootIdFromPath(coordRootPath) {
    return sha256String(realpathOrSelf(coordRootPath));
  }

  function computeCoordinationRootId(projectRoot) {
    return computeCoordinationRootIdFromPath(coordinationRootPathFor(projectRoot));
  }

  /**
   * Discovers the single active wave's PLAN.md under `<projectRoot>/.planning/wave-`
   * NAME`/` and returns its raw-byte SHA-256 (byte-identical algorithm to the
   * sibling runtime-consultation.cjs's own plan_digest -- same PLAN.md, same
   * definition, one value). Mirrors write-verdict.sh's own "single wave-dir PLAN.md
   * alias" fallback: exactly one match is required; zero or multiple is ambiguous
   * (returns null -- callers fail closed, never guess).
   * @param {string} projectRoot
   * @returns {{ok:true,planPath:string,planDigest:string}|{ok:false}}
   */
  function resolveWavePlan(projectRoot, waveSlug, expectedDigest = null) {
    if (!/^[A-Za-z0-9._-]+$/.test(waveSlug || '') || waveSlug === '.' || waveSlug === '..' ||
        (expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest))) return { ok: false };
    let canonicalRoot;
    try { canonicalRoot = fs.realpathSync(projectRoot); } catch { return { ok: false }; }
    const candidate = path.join(canonicalRoot, '.planning', 'wave-' + waveSlug, 'PLAN.md');
    const prefix = canonicalRoot.endsWith(path.sep) ? canonicalRoot : canonicalRoot + path.sep;
    if (!candidate.startsWith(prefix)) return { ok: false };
    let cursor = canonicalRoot;
    for (const part of path.relative(canonicalRoot, candidate).split(path.sep)) {
      cursor = path.join(cursor, part);
      let stat;
      try { stat = fs.lstatSync(cursor); } catch { return { ok: false }; }
      if (stat.isSymbolicLink() || (cursor !== candidate && !stat.isDirectory()) ||
          (cursor === candidate && !stat.isFile())) return { ok: false };
    }
    let planDigest;
    try {
      if (fs.realpathSync(candidate) !== candidate) return { ok: false };
      planDigest = sha256File(candidate);
    } catch { return { ok: false }; }
    if (expectedDigest !== null && planDigest !== expectedDigest) return { ok: false };
    return { ok: true, planPath: candidate, planDigest, waveSlug };
  }

  function discoverPlan(projectRoot, expected = null) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const keys = Object.keys(expected).sort();
      if (JSON.stringify(keys) !== JSON.stringify(['expectedDigest', 'waveSlug'])) return { ok: false };
      return resolveWavePlan(projectRoot, expected.waveSlug, expected.expectedDigest);
    }
    const expectedDigest = expected;
    if (expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest)) return { ok: false };
    const planningDir = path.join(projectRoot, '.planning');
    let entries;
    try {
      entries = fs.readdirSync(planningDir, { withFileTypes: true });
    } catch (err) {
      return { ok: false };
    }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('wave-')) continue;
      const candidate = path.join(planningDir, entry.name, 'PLAN.md');
      if (fs.existsSync(candidate)) {
        if (expectedDigest === null) matches.push(candidate);
        else {
          try { if (sha256File(candidate) === expectedDigest) matches.push(candidate); } catch { return { ok: false }; }
        }
      }
    }
    if (matches.length !== 1) return { ok: false };
    let planDigest;
    try {
      planDigest = sha256File(matches[0]);
    } catch (err) {
      return { ok: false };
    }
    return { ok: true, planPath: matches[0], planDigest };
  }

  /**
   * M6 CORRECTION PASS (P1-1): the base directory `setup/agent-templates/` and
   * `.claude/agents/` are resolved relative to -- always the real repo root
   * EXCEPT under a test-capability-gated `RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT`
   * override (mirroring this file's own established
   * RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES seam), which lets
   * resolveCanonicalRoleProfile's own tests point BOTH mirror paths at
   * test-owned tmp fixtures -- never at the real trees. Additive only: no
   * existing caller/test sets this new env var, so every pre-existing call
   * resolves to the EXACT SAME real-repo-root path as before.
   */
  function templateRootBase() {
    if (isTestCapability()) {
      const raw = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_TEMPLATE_ROOT;
      if (typeof raw === 'string' && raw.length > 0) return raw;
    }
    return defaultTemplateRoot;
  }

  function roleProfileDigestFor(role) {
    return sha256File(path.join(templateRootBase(), 'setup', 'agent-templates', role + '.md'));
  }

  /**
   * M6 CORRECTION PASS (P1-1): hardening WRAPPER around roleProfileDigestFor
   * (kept unchanged above, still the canonical single source of truth for
   * "what is role X's current template digest" -- this function calls it
   * directly rather than reimplementing a second, divergent digest
   * computation). Adds three checks roleProfileDigestFor itself never
   * performed: (1) a noncanonical role is rejected BEFORE any filesystem
   * access; (2) setup/agent-templates/<role>.md and .claude/agents/<role>.md
   * must byte-match (mirror parity) -- reject on mismatch or either file
   * missing; (3) when `opts.expectedDigest` is supplied, the current digest is
   * bound and compared against it, not merely recomputed and trusted fresh.
   * @param {string} role
   * @param {{expectedDigest?:string}} [opts]
   * @returns {{ok:true,digest:string}|{ok:false,reason:string}}
   */
  function resolveCanonicalRoleProfile(role, opts) {
    if (typeof role !== 'string' || !CANONICAL_ROLES.includes(role)) {
      return { ok: false, reason: 'role-not-canonical' };
    }
    const base = templateRootBase();
    const setupPath = path.join(base, 'setup', 'agent-templates', role + '.md');
    const claudePath = path.join(base, '.claude', 'agents', role + '.md');

    let setupBytes;
    try {
      setupBytes = fs.readFileSync(setupPath);
    } catch (err) {
      return { ok: false, reason: 'setup-template-unreadable' };
    }
    let claudeBytes;
    try {
      claudeBytes = fs.readFileSync(claudePath);
    } catch (err) {
      return { ok: false, reason: 'claude-mirror-unreadable' };
    }
    if (!setupBytes.equals(claudeBytes)) {
      return { ok: false, reason: 'template-mirror-mismatch' };
    }

    const digest = roleProfileDigestFor(role);
    if (opts && typeof opts.expectedDigest === 'string' && opts.expectedDigest !== digest) {
      return { ok: false, reason: 'template-digest-drift' };
    }
    return { ok: true, digest, bytes: setupBytes.toString('utf8') };
  }

  return Object.freeze({
    computePrincipalId, computeRepoId, computeWorktreeId,
    deepestExistingAncestorRealpath, coordinationRootPathFor,
    computeCoordinationRootIdFromPath, computeCoordinationRootId,
    discoverPlan, resolveWavePlan, templateRootBase, roleProfileDigestFor, resolveCanonicalRoleProfile,
  });
}

module.exports = { createRuntimeIdentityModule };
