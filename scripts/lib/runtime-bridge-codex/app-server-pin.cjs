'use strict';

function createAppServerPin({
  fs,
  os,
  path,
  crypto,
  isTestCapability,
  windowsPrivateDirectoryAcl,
  windowsAclSnapshotsEqual,
  // Finding B: supplied by app-server-pinned-image.cjs so the validated bytes,
  // not the mutable pathname, are what ends up being executed.
  materializePinnedCopy,
  cleanupPinnedCopies,
}) {
  // PLAN.md ~L921's own frozen production argv -- kept as one named constant so
  // the real value and every test-override fallback below stay byte-identical
  // to each other, never two independently-typed literals that could drift.
  const DEFAULT_APP_SERVER_SPAWN_ARGS = Object.freeze(['app-server', '--listen', 'stdio://', '--strict-config']);
  // Security identity is compared in BigInt, never as a double.
  //
  // fs.Stats reports dev/ino/mode/uid/nlink as doubles unless bigint stats are
  // requested. Windows NTFS file IDs are 64-bit and routinely exceed
  // Number.MAX_SAFE_INTEGER, so two genuinely different files become
  // indistinguishable once their identities round. Measured on a real Windows
  // runner: ino 28710447629357696 satisfies `ino + 1 === ino`, and across 500
  // freshly created files five pairs had distinct 64-bit ids that compared equal
  // as doubles. A swap into a nearby inode would have been accepted as the same
  // file by every identity check in this module.
  //
  // Same pattern already used by runtime-consultation/root-lifecycle/
  // root-lifecycle.cjs and runtime-bridge-codex/role-owner-registry.cjs.
  const STAT_BIGINT = Object.freeze({ bigint: true });

  // The ONE sanctioned BigInt->Number crossing: a byte length that has to index
  // a Buffer. Returns null rather than a lossy double when the value is not
  // exactly representable, so a caller can refuse instead of silently
  // truncating. Identity, ownership, mode and timestamps never cross.
  const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);
  function safeSize(value) {
    if (typeof value !== 'bigint' || value < 0n || value > MAX_SAFE_BIG) return null;
    return Number(value);
  }

  // Every field that witnesses a change to the file under an open descriptor,
  // for the re-checks where this comparison is the ONLY integrity guard.
  // One list rather than a set chosen per site, because three hand-picked
  // subsets is how a field goes missing from one of them: each site here
  // previously compared a different set, and none included ctimeNs.
  //
  // ctimeNs strengthens detection but is not unforgeable everywhere: POSIX has
  // no call that sets it directly, while Windows ChangeTime IS settable given
  // FILE_WRITE_ATTRIBUTES -- so it narrows what detection catches on Windows
  // rather than closing a gap in the same-uid boundary. atimeNs is excluded
  // because reading changes it, which would make every check fail. Exact
  // guarantee per platform: docs/agents/runtime-messaging-trust-boundaries.md.
  //
  // Not used where a DIGEST already binds the same bytes (see
  // enforceCodexPinFreeze's post-read check). Both rules, and why they are
  // rules: docs/agents/runtime-messaging-trust-boundaries.md.
  const IDENTITY_FIELDS = Object.freeze([
    'dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'ctimeNs', 'mtimeNs',
  ]);
  const identityUnchanged = (a, b) => IDENTITY_FIELDS.every((f) => a[f] === b[f]);

  const HOST_CODEX_CONFIG_MAX_BYTES = 128 * 1024;
  const CODEX_PIN_FREEZE_MAX_BYTES = 64 * 1024;
  const CODEX_PIN_FREEZE_SCHEMA = 'androidcommondoc/codex-executable-freeze/v1';
  const CODEX_PIN_FREEZE_KEYS = Object.freeze([
    'cli_version', 'executable_realpath', 'executable_sha256', 'file_type',
    'mode_octal', 'nlink', 'schema', 'uid',
  ]);
  const SHA256_RE = /^[0-9a-f]{64}$/;

  /**
   * F-19: the Codex executable is frozen by DIGEST, not by version text.
   *
   * The expected digest comes from a freeze record written by the conductor
   * BEFORE the run -- never recomputed from the same file we are about to
   * validate, which would make the check a tautology that any substituted
   * binary passes. `RUNTIME_BRIDGE_CODEX_PIN_MODE=genuine-pinned` turns
   * enforcement on and `RUNTIME_BRIDGE_CODEX_PIN_FREEZE` names the record;
   * both are conductor-supplied context on the existing env seam this module
   * already uses, so no facade export changes.
   *
   * Scope, stated honestly: this detects substitution of the pinned binary. It
   * does not defend against an adversary who already controls this process's
   * environment -- such an adversary can choose the freeze. The freeze file is
   * still integrity-checked (regular file, no symlink, nlink 1, owner-confined,
   * not group/world writable) so it cannot be quietly swapped underneath us.
   *
   * @returns {{ok:true,enforced:false}|{ok:true,enforced:true,freeze:object}|{ok:false,reason:string}}
   */
  function readCodexPinFreeze() {
    if (process.env.RUNTIME_BRIDGE_CODEX_PIN_MODE !== 'genuine-pinned') return { ok: true, enforced: false };
    const freezePath = process.env.RUNTIME_BRIDGE_CODEX_PIN_FREEZE;
    if (typeof freezePath !== 'string' || freezePath.length === 0 || !path.isAbsolute(freezePath)) {
      return { ok: false, reason: 'CODEX_PIN_FREEZE_ABSENT' };
    }
    let st;
    try {
      st = fs.lstatSync(freezePath, STAT_BIGINT);
    } catch (err) {
      return { ok: false, reason: 'CODEX_PIN_FREEZE_ABSENT' };
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    const currentUidBig = currentUid === null ? null : BigInt(currentUid);
    // The containing directory, validated the same way readProtectedHostCodexPin
    // validates its own. Validating only the FILE leaves a writable parent: an
    // attacker who can create entries there can put a stable, correctly-shaped
    // replacement in place before the first lstat, and while the realpath and
    // digest binding still refuse a substituted executable, an attacker-chosen
    // record can force the pinned launch to fail. This was disclosed as a
    // deliberate deviation when the TOCTOU finding was closed, and then raised
    // again on its own merits; it is cheaper to honour than to keep defending.
    const freezeDir = path.dirname(freezePath);
    let dirStat;
    try {
      dirStat = fs.lstatSync(freezeDir, STAT_BIGINT);
    } catch (err) {
      return { ok: false, reason: 'CODEX_PIN_FREEZE_DIR_INSECURE' };
    }
    if (
      !dirStat.isDirectory() || dirStat.isSymbolicLink()
      || (currentUidBig !== null && dirStat.uid !== currentUidBig)
      || (process.platform !== 'win32' && (dirStat.mode & 0o022n) !== 0n)
    ) return { ok: false, reason: 'CODEX_PIN_FREEZE_DIR_INSECURE' };
    let initialFreezeDirAcl;
    if (process.platform === 'win32') {
      initialFreezeDirAcl = windowsPrivateDirectoryAcl(freezeDir, { mode: 'validate' });
      if (!initialFreezeDirAcl || initialFreezeDirAcl.ok !== true) {
        return { ok: false, reason: 'CODEX_PIN_FREEZE_DIR_INSECURE' };
      }
    }
    const insecure = (candidate) => !candidate.isFile() || candidate.nlink !== 1n
      || candidate.size <= 0n || candidate.size > BigInt(CODEX_PIN_FREEZE_MAX_BYTES)
      || (currentUidBig !== null && candidate.uid !== currentUidBig)
      || (process.platform !== 'win32' && (candidate.mode & 0o022n) !== 0n);
    if (st.isSymbolicLink() || insecure(st)) return { ok: false, reason: 'CODEX_PIN_FREEZE_INSECURE' };

    // The lstat above observed the PATHNAME; everything from here on must be
    // decided on the open DESCRIPTOR, or the file can be swapped between the
    // check and the read. O_NOFOLLOW refuses a symlink planted at the pathname
    // in that window; the fstat identity comparison catches a rename/replace of
    // the underlying file; and re-checking both the descriptor and the pathname
    // after the read catches a substitution that happened while we were reading.
    let fd;
    let raw;
    try {
      fd = fs.openSync(freezePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    } catch (err) {
      return { ok: false, reason: 'CODEX_PIN_FREEZE_INSECURE' };
    }
    try {
      const opened = fs.fstatSync(fd, STAT_BIGINT);
      // Same file the pathname named a moment ago, and still secure in its own right.
      if (opened.dev !== st.dev || opened.ino !== st.ino || insecure(opened)) {
        return { ok: false, reason: 'CODEX_PIN_FREEZE_INSECURE' };
      }
      // Size crosses from BigInt to Number exactly once, and only after
      // insecure() has already bounded it below CODEX_PIN_FREEZE_MAX_BYTES.
      // Everything that decides IDENTITY stays BigInt; only this length, which
      // must index a Buffer, becomes a double.
      const size = safeSize(opened.size);
      if (size === null) return { ok: false, reason: 'CODEX_PIN_FREEZE_MALFORMED' };
      // Bounded read THROUGH the descriptor. A short read is a truncation or a
      // concurrent rewrite, never something to parse optimistically.
      const buffer = Buffer.allocUnsafe(size);
      let filled = 0;
      while (filled < size) {
        const got = fs.readSync(fd, buffer, filled, size - filled, filled);
        if (got <= 0) break;
        filled += got;
      }
      if (filled !== size) return { ok: false, reason: 'CODEX_PIN_FREEZE_MALFORMED' };
      // Nothing may have changed underneath us while we read.
      const after = fs.fstatSync(fd, STAT_BIGINT);
      if (!identityUnchanged(after, opened)) return { ok: false, reason: 'CODEX_PIN_FREEZE_INSECURE' };
      // And the pathname must still resolve to that same file, so a swap that
      // left our descriptor untouched is caught too.
      //
      // dev+ino deliberately, not IDENTITY_FIELDS: this asks "does the NAME
      // still point at our file", and dev+ino is exactly what file identity
      // means. Whether that file changed was already settled by the descriptor
      // comparison above, against the full list. A hard link planted here in
      // the same window raises nlink on the descriptor too, so it is caught
      // there rather than missed. This is a different question, not a
      // narrower version of the same one.
      let pathNow;
      try { pathNow = fs.lstatSync(freezePath, STAT_BIGINT); } catch (err) { return { ok: false, reason: 'CODEX_PIN_FREEZE_INSECURE' }; }
      if (pathNow.isSymbolicLink() || pathNow.dev !== opened.dev || pathNow.ino !== opened.ino) {
        return { ok: false, reason: 'CODEX_PIN_FREEZE_INSECURE' };
      }
      // The descriptor identity above proves OUR file did not move. It says
      // nothing about the directory's permissions having been loosened while we
      // read, which is what would let the next read be attacked -- so the
      // before/after ACL snapshots are compared as well, exactly as
      // readProtectedHostCodexPin compares its own.
      if (process.platform === 'win32') {
        const finalFreezeDirAcl = windowsPrivateDirectoryAcl(freezeDir, { mode: 'validate' });
        if (!finalFreezeDirAcl || finalFreezeDirAcl.ok !== true
            || !windowsAclSnapshotsEqual(initialFreezeDirAcl, finalFreezeDirAcl)) {
          return { ok: false, reason: 'CODEX_PIN_FREEZE_DIR_CHANGED_DURING_READ' };
        }
      }
      raw = buffer;
    } finally {
      try { fs.closeSync(fd); } catch { /* descriptor already gone */ }
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch (err) {
      return { ok: false, reason: 'CODEX_PIN_FREEZE_MALFORMED' };
    }
    if (
      !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify([...CODEX_PIN_FREEZE_KEYS])
      || parsed.schema !== CODEX_PIN_FREEZE_SCHEMA
      || typeof parsed.executable_realpath !== 'string' || !path.isAbsolute(parsed.executable_realpath)
      || typeof parsed.executable_sha256 !== 'string' || !SHA256_RE.test(parsed.executable_sha256)
      || typeof parsed.cli_version !== 'string'
      || !Number.isInteger(parsed.nlink) || parsed.nlink !== 1
      || parsed.file_type !== 'file'
      || typeof parsed.mode_octal !== 'string' || !/^[0-7]{3,4}$/.test(parsed.mode_octal)
      || !(parsed.uid === null || Number.isInteger(parsed.uid))
    ) return { ok: false, reason: 'CODEX_PIN_FREEZE_MALFORMED' };
    return { ok: true, enforced: true, freeze: parsed };
  }

  /**
   * Re-resolves and re-hashes the selected executable immediately before the
   * spawn decision and compares BOTH path and digest against the freeze. The
   * version string is recorded for humans only and can never grant acceptance:
   * an identical version with a different digest is exactly the case this
   * rejects, and it was observed on this host in one session.
   */
  function enforceCodexPinFreeze(pinnedPath, freeze, stat) {
    let executablePath;
    let resolved;
    try {
      resolved = fs.realpathSync(pinnedPath);
    } catch (err) {
      return { ok: false, reason: 'CODEX_PIN_PATH_UNRESOLVABLE' };
    }
    // Named REALPATH_MISMATCH deliberately: the bridge reserves the
    // "drift"-suffixed path vocabulary for a different, deliberately absent
    // cross-call mechanism (see C3-ISO-D20), which asserts that token is absent
    // from this package by plain substring -- so even a comment must avoid it.
    if (resolved !== freeze.executable_realpath) return { ok: false, reason: 'CODEX_PIN_REALPATH_MISMATCH' };
    let fd;
    let digest;
    try {
      fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd, STAT_BIGINT);
      if (!opened.isFile() || opened.nlink !== 1n) return { ok: false, reason: 'CODEX_PIN_TARGET_INSECURE' };
      if (opened.dev !== stat.dev || opened.ino !== stat.ino) return { ok: false, reason: 'CODEX_PIN_TARGET_REBOUND' };
      const openedSize = safeSize(opened.size);
      if (openedSize === null) return { ok: false, reason: 'CODEX_PIN_TARGET_INSECURE' };
      const hash = crypto.createHash('sha256');
      const buffer = Buffer.alloc(1 << 20);
      let offset = 0;
      for (;;) {
        const read = fs.readSync(fd, buffer, 0, buffer.length, offset);
        if (read <= 0) break;
        hash.update(buffer.subarray(0, read));
        offset += read;
      }
      // dev/ino/size, NOT IDENTITY_FIELDS -- deliberate, not inherited. These
      // bytes are digest-bound twice (against the freeze below, then a re-hash
      // of the materialized copy, which refuses CODEX_PIN_COPY_UNVERIFIED), so a
      // wider stat check catches nothing the digest chain does not -- while this
      // being the longest read here makes it the likeliest to trip over an
      // antivirus touching ctime. Rationale in full:
      // docs/agents/runtime-messaging-trust-boundaries.md.
      const after = fs.fstatSync(fd, STAT_BIGINT);
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
        return { ok: false, reason: 'CODEX_PIN_TARGET_CHANGED_DURING_READ' };
      }
      if (offset !== openedSize) return { ok: false, reason: 'CODEX_PIN_SHORT_READ' };
      digest = hash.digest('hex');
      // Bind execution to these exact bytes while the validated descriptor is
      // still open. Doing it here, not after the close, is the whole point: a
      // second open of the mutable pathname would be a fresh, unvalidated read.
      if (digest !== freeze.executable_sha256) return { ok: false, reason: 'CODEX_PIN_DIGEST_DRIFT' };
      const copied = materializePinnedCopy(fd, openedSize, digest);
      if (!copied.ok) return copied;
      executablePath = copied.path;
    } catch (err) {
      return { ok: false, reason: 'CODEX_PIN_TARGET_UNREADABLE' };
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (err) { /* validation already decided above */ }
      }
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (freeze.uid !== null && currentUid !== null && freeze.uid !== currentUid) {
      return { ok: false, reason: 'CODEX_PIN_OWNER_DRIFT' };
    }
    if (process.platform !== 'win32' && BigInt(parseInt(freeze.mode_octal, 8)) !== (stat.mode & 0o7777n)) {
      return { ok: false, reason: 'CODEX_PIN_MODE_DRIFT' };
    }
    return { ok: true, executablePath };
  }

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
      dirStat = fs.lstatSync(configDir, STAT_BIGINT);
      initial = fs.lstatSync(configPath, STAT_BIGINT);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, configured: false };
      return { ok: false, reason: 'CODEX_CONFIG_STAT_FAILED' };
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    const currentUidBig = currentUid === null ? null : BigInt(currentUid);
    if (
      !dirStat.isDirectory() || dirStat.isSymbolicLink()
      || (currentUidBig !== null && dirStat.uid !== currentUidBig)
      || (process.platform !== 'win32' && (dirStat.mode & 0o022n) !== 0n)
    ) return { ok: false, reason: 'CODEX_CONFIG_DIR_INSECURE' };
    let initialWindowsAcl;
    if (process.platform === 'win32') {
      initialWindowsAcl = windowsPrivateDirectoryAcl(configDir, { mode: 'validate' });
      if (!initialWindowsAcl || initialWindowsAcl.ok !== true) return { ok: false, reason: 'CODEX_CONFIG_DIR_INSECURE' };
    }
    if (
      !initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1n
      || initial.size <= 0n || initial.size > BigInt(HOST_CODEX_CONFIG_MAX_BYTES)
      || (currentUidBig !== null && initial.uid !== currentUidBig)
      || (process.platform !== 'win32' && (initial.mode & 0o077n) !== 0n)
    ) return { ok: false, reason: 'CODEX_CONFIG_FILE_INSECURE' };

    let fd;
    let bytes;
    try {
      fd = fs.openSync(configPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd, STAT_BIGINT);
      if (
        !opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino
        || opened.size !== initial.size || opened.nlink !== initial.nlink
      ) return { ok: false, reason: 'CODEX_CONFIG_REBOUND' };
      const openedSize = safeSize(opened.size);
      if (openedSize === null) return { ok: false, reason: 'CODEX_CONFIG_FILE_INSECURE' };
      bytes = Buffer.alloc(openedSize);
      let offset = 0;
      while (offset < bytes.length) {
        const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      if (offset !== bytes.length) return { ok: false, reason: 'CODEX_CONFIG_SHORT_READ' };
      const afterFd = fs.fstatSync(fd, STAT_BIGINT);
      const afterPath = fs.lstatSync(configPath, STAT_BIGINT);
      if (
        !identityUnchanged(afterFd, opened)
        || afterPath.isSymbolicLink() || !identityUnchanged(afterPath, opened)
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
      st = fs.lstatSync(pinnedPath, STAT_BIGINT);
    } catch (err) {
      return { ok: false, reason: 'CODEX_CLI_PATH_NOT_FOUND' };
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    const currentUidBig = currentUid === null ? null : BigInt(currentUid);
    if (!st.isFile() || st.isSymbolicLink()) {
      return { ok: false, reason: 'CODEX_CLI_PATH_NOT_A_FILE' };
    }
    if (
      st.nlink !== 1n || (currentUidBig !== null && st.uid !== currentUidBig)
      || (process.platform !== 'win32' && ((st.mode & 0o022n) !== 0n || (st.mode & 0o100n) === 0n))
    ) return { ok: false, reason: 'CODEX_CLI_PATH_INSECURE' };
    if (process.platform === 'win32') {
      const acl = windowsPrivateDirectoryAcl(path.dirname(pinnedPath), { mode: 'validate' });
      if (!acl || acl.ok !== true) return { ok: false, reason: 'CODEX_CLI_PATH_INSECURE' };
    }
    // F-19. Non-pinned profiles keep exactly the contract above: readCodexPinFreeze()
    // returns enforced:false and nothing here changes for them.
    const frozen = readCodexPinFreeze();
    if (!frozen.ok) return frozen;
    if (frozen.enforced) {
      const enforced = enforceCodexPinFreeze(pinnedPath, frozen.freeze, st);
      if (!enforced.ok) return enforced;
      // Execute the verified copy, never the mutable pathname. Callers spawn
      // this with shell:false exactly as before, and the owned-child BORN check
      // then proves the child really is running THIS image.
      return { ok: true, command: enforced.executablePath, args: DEFAULT_APP_SERVER_SPAWN_ARGS.slice() };
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

  return Object.freeze({
    readProtectedHostCodexPin,
    validatePinnedCodexExecutable,
    resolveAppServerSpawnCommand,
    // Internal to this factory's own surface -- the public facade ABI is
    // unchanged; teardown calls this so a validated copy never outlives its run.
    cleanupPinnedCodexCopies: cleanupPinnedCopies,
  });
}

module.exports = Object.freeze({ createAppServerPin });
