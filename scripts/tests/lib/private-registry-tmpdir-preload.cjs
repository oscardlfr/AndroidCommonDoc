'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A. registryBaseDir() (scripts/lib/runtime-role-lifecycle.cjs) is
// `path.join(os.tmpdir(), 'android-common-doc-runtime', computePrincipalId())`
// -- computePrincipalId() is `'uid-' + process.getuid()` on POSIX, so this is
// the SAME canonical, per-OS-user location a REAL Claude Code session on this
// machine uses for its own real registry data. Every node:test file that
// requires runtime-role-lifecycle.cjs (directly or via runtime-bridge-codex.cjs,
// which itself requires and delegates to it -- confirmed by direct read,
// runtime-bridge-codex.cjs:61,7291) WITHOUT overriding TMPDIR first therefore
// creates and deletes real subdirectories of that SAME canonical uid-<n> tree
// -- confirmed as the root cause of the harness-hygiene finding that
// invalidated a prior "cero limpieza del registro canonico" claim.
//
// This file is a Node PRELOAD, not a test helper library: it MUST be the
// first thing a consuming test file requires (before rll/rbc/rc), because
// os.tmpdir() reads process.env.TMPDIR fresh on every call (never cached at
// require time) -- setting the override before the FIRST registryBaseDir()
// call anywhere in the process is what matters, and requiring this file
// before any other project require is the simplest way to guarantee that
// ordering regardless of which test file's own internal call graph reaches
// registryBaseDir() first.
//
// Fail-closed guard (mission item 6/7): this module throws synchronously --
// never returns a "did it work" boolean a caller could ignore -- if the
// private root fails its own shape/mode/ownership checks, or os.tmpdir()
// does not adopt the override (see the static-proof section below for why
// this alone is sufficient to guarantee registryBaseDir() containment too,
// without eagerly loading any project module). A consuming test file that
// requires this preload and does nothing else already gets the guarantee;
// there is no second opt-in step to forget.
//
// Cleanup (mission item 3): registers a single process 'exit' handler that
// removes ONLY this private root -- never computes or touches
// registryRepoDir() within the canonical uid-<n> tree, which is exactly the
// operation that caused the prior pollution.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REAL_SYSTEM_TMPDIR = os.tmpdir();
const WINDOWS_COMMON_APP_DATA = process.platform === 'win32'
  ? fs.realpathSync(process.env.ProgramData || 'C:\\ProgramData')
  : null;

const SHARED_PRIVATE_ROOT_ENV = 'ANDROID_COMMON_DOC_TEST_PRIVATE_REGISTRY_ROOT';
const inheritedPrivateRoot = process.env[SHARED_PRIVATE_ROOT_ENV];
const ownsPrivateRoot = !(typeof inheritedPrivateRoot === 'string' && path.isAbsolute(inheritedPrivateRoot));
// Narrow, explicit opt-out of the mode check ONLY (never symlink/type/owner
// below) for a test that deliberately inherits an insecure root to prove a
// DIFFERENT, production-level rejection downstream -- e.g.
// runtime-consultation-cli.test.js's R2-C RED 12, which needs its child's
// os.tmpdir() to genuinely BE the insecure directory it constructed, and
// asserts on production's own RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:
// tmpdir-not-secure signature, never on this preload's generic FATAL abort.
// Only takes effect on an INHERITED root; a root this process itself creates
// is still always force-chmod'd 0700 below regardless.
const ALLOW_INSECURE_INHERITED_ROOT_ENV = 'ANDROID_COMMON_DOC_TEST_ALLOW_INSECURE_PRIVATE_REGISTRY_ROOT';
const allowInsecureInheritedRoot = !ownsPrivateRoot && process.env[ALLOW_INSECURE_INHERITED_ROOT_ENV] === '1';
// Both branches must publish the SAME spelling of the same directory. macOS
// hands os.tmpdir() back as /var/folders/... whose realpath is
// /private/var/folders/..., so an owner that skipped realpath would export one
// spelling while every inheriting descendant (which does realpath) exported the
// other -- and the containment comparisons below, which are plain string
// prefix/equality checks, would then fail against a directory that is in fact
// correctly contained.
const privateRoot = ownsPrivateRoot
  ? fs.realpathSync(fs.mkdtempSync(path.join(WINDOWS_COMMON_APP_DATA || REAL_SYSTEM_TMPDIR, 'acd-private-registry-')))
  : fs.realpathSync(inheritedPrivateRoot);
if (ownsPrivateRoot) fs.chmodSync(privateRoot, 0o700);
process.env[SHARED_PRIVATE_ROOT_ENV] = privateRoot;

// Node follows the host-specific temp variable precedence.  Windows consults
// TEMP/TMP while POSIX consults TMPDIR, so set all three to keep every child
// registry inside the same harness-owned isolation boundary.
process.env.TEMP = privateRoot;
process.env.TMP = privateRoot;
process.env.TMPDIR = privateRoot;

// Every descendant Node process must install the same process-local registry
// capability before it loads production modules. Merely inheriting TEMP/TMPDIR
// is insufficient because registryBaseDir() deliberately trusts the Symbol
// below, not an externally forgeable environment path. NODE_OPTIONS is the
// one Node-owned propagation boundary shared by execFile/spawn/fork helpers.
// Use a forward-slash absolute path so Windows option parsing is not exposed
// to backslash escaping; quote it so worktrees containing spaces also work.
const selfPreloadPath = __filename.split(path.sep).join('/').replace(/"/g, '\\"');
const selfRequireOption = '--require="' + selfPreloadPath + '"';
const inheritedNodeOptions = typeof process.env.NODE_OPTIONS === 'string'
  ? process.env.NODE_OPTIONS.trim()
  : '';
if (!inheritedNodeOptions.includes(selfRequireOption)) {
  process.env.NODE_OPTIONS = inheritedNodeOptions.length > 0
    ? inheritedNodeOptions + ' ' + selfRequireOption
    : selfRequireOption;
}

// A process-local test preload seam keeps registry authority private even in
// tests that deliberately clear NODE_ENV while exercising production branches.
// Windows needs this root outside HOME because HOME is itself a mandatory
// sensitive root and production isolation roots must never nest beneath it.
const TEST_PRIVATE_REGISTRY_BASE_SYMBOL = Symbol.for('android-common-doc.runtime-private-registry-base');
globalThis[TEST_PRIVATE_REGISTRY_BASE_SYMBOL] = path.join(privateRoot, 'registry');

function fatal(message) {
  process.stderr.write('[private-registry-tmpdir-preload] FATAL: ' + message + '\n');
  try { fs.rmSync(privateRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
}

if (os.tmpdir() !== privateRoot) {
  fatal('os.tmpdir() did not adopt the private TMPDIR override -- registry containment cannot be guaranteed on this platform/Node version.');
}

const rootStat = fs.lstatSync(privateRoot);
if (rootStat.isSymbolicLink()) fatal('private root is a symlink -- refusing to trust it as an isolation boundary.');
if (!rootStat.isDirectory()) fatal('private root is not a directory.');
if (process.platform !== 'win32' && (rootStat.mode & 0o777) !== 0o700 && !allowInsecureInheritedRoot) {
  fatal('private root has the wrong mode: ' + (rootStat.mode & 0o777).toString(8));
}
if (typeof process.getuid === 'function' && rootStat.uid !== process.getuid()) fatal('private root has the wrong owner.');

// Deliberately does NOT eagerly require runtime-role-lifecycle.cjs (or
// anything else under scripts/lib/) here to "live re-derive" registryBaseDir()
// -- an earlier version of this guard did exactly that, and it broke
// runtime-consultation-cli.test.js's own R33 golden-vector tests (5 failures,
// e.g. "rc.rootProfileDigestV3 is not a function"), confirmed empirically by
// toggling this require on/off with the rest of the file unchanged (48/48
// pass without it, 5 failures with it). Root cause: runtime-consultation.cjs
// exports a LARGER, test-capability-gated key set only when specific env vars
// are already set at ITS OWN require time (confirmed by that same file's own
// "R33-GATE" test title: "exports EXACTLY the 59-key base set unless
// NODE_ENV=test AND a non-empty capability are both present, in which case it
// exports EXACTLY 67"). This preload is REQUIRED before a consuming test file
// sets up ITS OWN such env vars (that is the whole point -- it must run
// before anything else), so an eager require here loads (and Node
// permanently CACHES) that module under the WRONG, not-yet-configured
// environment -- the test file's own later `require(...)` of the SAME
// resolved path then silently receives the same wrongly-initialized cached
// instance instead of a fresh one.
//
// The guard below is therefore a pure STATIC proof instead of a dynamic
// re-derivation: registryBaseDir()'s own definition, confirmed by direct
// read (scripts/lib/runtime-role-lifecycle.cjs), is EXACTLY
// `path.join(os.tmpdir(), 'android-common-doc-runtime', computePrincipalId())`
// -- a pure function of os.tmpdir() and nothing else (no env-var gating, no
// other conditional logic). Proving os.tmpdir() itself now returns the
// private root (already done above) is therefore mathematically equivalent
// to proving registryBaseDir() resolves under it, without ever loading the
// module. If that formula ever changes to depend on anything else, this
// static proof -- and this comment -- must be revisited together.
// The 'android-common-doc-runtime' + principal-id suffix is registryBaseDir()'s
// OWN literal + computePrincipalId() -- not reproduced here (that would be
// the same eager-require hazard by another name); this is only the fixed
// PARENT every principal's own registryBaseDir() nests under, which is
// enough to prove containment via a prefix check.
const EXPECTED_REGISTRY_BASE_DIR_PARENT = globalThis[TEST_PRIVATE_REGISTRY_BASE_SYMBOL];
if (!EXPECTED_REGISTRY_BASE_DIR_PARENT.startsWith(privateRoot + path.sep)) {
  fatal('internal error deriving the expected registryBaseDir() parent.');
}

process.on('exit', () => {
  if (ownsPrivateRoot) {
    try { fs.rmSync(privateRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

module.exports = Object.freeze({
  privateRoot,
  realSystemTmpdir: REAL_SYSTEM_TMPDIR,
  expectedRegistryBaseDirParent: EXPECTED_REGISTRY_BASE_DIR_PARENT,
});
