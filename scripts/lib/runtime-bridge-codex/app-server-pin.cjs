'use strict';

function createAppServerPin({
  fs,
  os,
  path,
  isTestCapability,
  windowsPrivateDirectoryAcl,
  windowsAclSnapshotsEqual,
}) {
  // PLAN.md ~L921's own frozen production argv -- kept as one named constant so
  // the real value and every test-override fallback below stay byte-identical
  // to each other, never two independently-typed literals that could drift.
  const DEFAULT_APP_SERVER_SPAWN_ARGS = Object.freeze(['app-server', '--listen', 'stdio://', '--strict-config']);
  const HOST_CODEX_CONFIG_MAX_BYTES = 128 * 1024;

  /**
   * Reads the host-owned Codex pin from the same protected config surface used
   * by the frozen capability verifier.  A present config file is authoritative:
   * malformed/duplicate/insecure content fails closed and is never laundered
   * through an ambient environment fallback.  The bounded fd read plus the
   * before/after path identity check prevents a config-path swap while parsing.
   *
   * @returns {{ok:true,configured:false}|{ok:true,configured:true,path:string}|{ok:false,reason:string}}
   */
  function readProtectedHostCodexPin() {
    const testHome = process.env.RUNTIME_BRIDGE_CODEX_TEST_CODEX_HOME;
    const homeDir = isTestCapability() && typeof testHome === 'string' && testHome.length > 0
      ? testHome
      : os.homedir();
    const configDir = path.join(homeDir, '.codex');
    const configPath = path.join(configDir, 'config.toml');
    let dirStat;
    let initial;
    try {
      dirStat = fs.lstatSync(configDir);
      initial = fs.lstatSync(configPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, configured: false };
      return { ok: false, reason: 'CODEX_CONFIG_STAT_FAILED' };
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (
      !dirStat.isDirectory() || dirStat.isSymbolicLink()
      || (currentUid !== null && dirStat.uid !== currentUid)
      || (process.platform !== 'win32' && (dirStat.mode & 0o022) !== 0)
    ) return { ok: false, reason: 'CODEX_CONFIG_DIR_INSECURE' };
    let initialWindowsAcl;
    if (process.platform === 'win32') {
      initialWindowsAcl = windowsPrivateDirectoryAcl(configDir, { mode: 'validate' });
      if (!initialWindowsAcl || initialWindowsAcl.ok !== true) return { ok: false, reason: 'CODEX_CONFIG_DIR_INSECURE' };
    }
    if (
      !initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1
      || initial.size <= 0 || initial.size > HOST_CODEX_CONFIG_MAX_BYTES
      || (currentUid !== null && initial.uid !== currentUid)
      || (process.platform !== 'win32' && (initial.mode & 0o077) !== 0)
    ) return { ok: false, reason: 'CODEX_CONFIG_FILE_INSECURE' };

    let fd;
    let bytes;
    try {
      fd = fs.openSync(configPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (
        !opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino
        || opened.size !== initial.size || opened.nlink !== initial.nlink
      ) return { ok: false, reason: 'CODEX_CONFIG_REBOUND' };
      bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      if (offset !== bytes.length) return { ok: false, reason: 'CODEX_CONFIG_SHORT_READ' };
      const afterFd = fs.fstatSync(fd);
      const afterPath = fs.lstatSync(configPath);
      if (
        afterFd.dev !== opened.dev || afterFd.ino !== opened.ino || afterFd.size !== opened.size
        || afterPath.isSymbolicLink() || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino
        || afterPath.size !== opened.size || afterPath.nlink !== opened.nlink
      ) return { ok: false, reason: 'CODEX_CONFIG_CHANGED_DURING_READ' };
      if (process.platform === 'win32') {
        const finalWindowsAcl = windowsPrivateDirectoryAcl(configDir, { mode: 'validate' });
        if (!finalWindowsAcl || finalWindowsAcl.ok !== true || !windowsAclSnapshotsEqual(initialWindowsAcl, finalWindowsAcl)) {
          return { ok: false, reason: 'CODEX_CONFIG_DIR_CHANGED_DURING_READ' };
        }
      }
    } catch (err) {
      return { ok: false, reason: 'CODEX_CONFIG_READ_FAILED' };
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (err) { /* read-only admission already fails above */ }
      }
    }

    const assignments = [];
    for (const line of bytes.toString('utf8').split(/\r?\n/)) {
      if (!/^\s*CODEX_CLI_PATH\s*=/.test(line)) continue;
      // TOML basic strings retain the existing conservative no-backslash rule;
      // literal strings are the native way to spell Windows paths without
      // interpreting `\` as an escape character.
      const match = line.match(/^\s*CODEX_CLI_PATH\s*=\s*(?:"([^"\\\r\n]+)"|'([^'\r\n]+)')\s*(?:#.*)?$/);
      if (!match) return { ok: false, reason: 'CODEX_CONFIG_PIN_MALFORMED' };
      assignments.push(match[1] !== undefined ? match[1] : match[2]);
    }
    if (assignments.length === 0) return { ok: false, reason: 'CODEX_CONFIG_PIN_ABSENT' };
    if (assignments.length !== 1) return { ok: false, reason: 'CODEX_CONFIG_PIN_AMBIGUOUS' };
    return { ok: true, configured: true, path: assignments[0] };
  }

  function validatePinnedCodexExecutable(pinnedPath) {
    if (typeof pinnedPath !== 'string' || pinnedPath.length === 0) {
      return { ok: false, reason: 'CODEX_CLI_PATH_UNSET' };
    }
    if (!path.isAbsolute(pinnedPath)) {
      return { ok: false, reason: 'CODEX_CLI_PATH_NOT_ABSOLUTE' };
    }
    let st;
    try {
      st = fs.lstatSync(pinnedPath);
    } catch (err) {
      return { ok: false, reason: 'CODEX_CLI_PATH_NOT_FOUND' };
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!st.isFile() || st.isSymbolicLink()) {
      return { ok: false, reason: 'CODEX_CLI_PATH_NOT_A_FILE' };
    }
    if (
      st.nlink !== 1 || (currentUid !== null && st.uid !== currentUid)
      || (process.platform !== 'win32' && ((st.mode & 0o022) !== 0 || (st.mode & 0o100) === 0))
    ) return { ok: false, reason: 'CODEX_CLI_PATH_INSECURE' };
    if (process.platform === 'win32') {
      const acl = windowsPrivateDirectoryAcl(path.dirname(pinnedPath), { mode: 'validate' });
      if (!acl || acl.ok !== true) return { ok: false, reason: 'CODEX_CLI_PATH_INSECURE' };
    }
    return { ok: true, command: pinnedPath, args: DEFAULT_APP_SERVER_SPAWN_ARGS.slice() };
  }

  /**
   * M6 CORRECTION PASS (P0-3): unconditionally exported (reachable outside
   * isTestCapability(), unlike every other seam in this file) -- production
   * needs a REAL way to locate the codex binary, and that production branch
   * must itself be directly testable. Outside test mode, resolves the pinned,
   * protected `~/.codex/config.toml` CODEX_CLI_PATH assignment used by the
   * frozen capability verifier.  When that host config does not exist, an
   * explicit process.env.CODEX_CLI_PATH remains a compatibility source; a
   * present-but-invalid config never falls through to it.  Both sources are
   * validated as absolute, owner-controlled, non-symlinked executable files
   * and returned EXACTLY as configured (never realpath-transformed).  No branch
   * silently falls back to the bare PATH-relying `'codex'` literal. Under test
   * capability, this production branch is bypassed entirely (see below) --
   * RUNTIME_BRIDGE_CODEX_FAKE_APP_SERVER_SPAWN has zero effect on it either
   * way, genuinely independent test-only seams. Every other spawn option (cwd,
   * env, stdio) stays exactly as production computes it.
   * @returns {{command:string,args:string[]}|{ok:false,reason:string}}
   */
  function resolveAppServerSpawnCommand() {
    const real = { command: 'codex', args: DEFAULT_APP_SERVER_SPAWN_ARGS.slice() };
    if (!isTestCapability()) {
      const configPin = readProtectedHostCodexPin();
      if (!configPin.ok) return configPin;
      const pinnedPath = configPin.configured ? configPin.path : process.env.CODEX_CLI_PATH;
      return validatePinnedCodexExecutable(pinnedPath);
    }
    const raw = process.env.RUNTIME_BRIDGE_CODEX_FAKE_APP_SERVER_SPAWN;
    if (typeof raw !== 'string' || raw.length === 0) return real;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return real;
    }
    if (
      !parsed || typeof parsed.command !== 'string' || parsed.command.length === 0
      || !Array.isArray(parsed.args) || !parsed.args.every((a) => typeof a === 'string')
    ) {
      return real;
    }
    return { command: parsed.command, args: parsed.args };
  }

  return Object.freeze({ readProtectedHostCodexPin, validatePinnedCodexExecutable, resolveAppServerSpawnCommand });
}

module.exports = Object.freeze({ createAppServerPin });
