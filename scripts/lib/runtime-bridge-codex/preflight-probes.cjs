'use strict';

function createPreflightProbes({
  fs,
  os,
  path,
  crypto,
  spawnSync,
  RC,
  isTestCapability,
  resolveAppServerSpawnCommand,
  windowsPrivateDirectoryAcl,
  windowsAclSnapshotsEqual,
}) {
  const generated = require('../generated/c2-schema-validators.generated.cjs');

  // ── R2 preflight: probeAppServerLiveCapability() ───────────────────────────
  // Sequence 81/82 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822): architect-
  // approved design (sequence81-toolkit-specialist-dispatch.json), RED-first
  // TDD (sequence82-red-receipt.json, scripts/tests/runtime-bridge-credential-
  // isolation.test.js "probeAppServerLiveCapability (R2 preflight)").
  // Synchronous and command-state-neutral, with bounded child-process and
  // owner-confined temporary-directory side effects explicitly acknowledged:
  // no process.exit, no process.stdout.write/
  // process.stderr.write/console.*, no role-owner claim, no --listen/stdio
  // app-server child spawn. Proves the pinned binary's JSON-schema-generation
  // capability (rc3) and the host auth source's readiness/non-leak/non-
  // mutation (rc4) against the LIVE host only -- never a frozen historical
  // hash or version string (see resolveAppServerSpawnCommand's own docblock
  // above; the explicit rejection of the .planning/prep/gc-verify.cjs
  // EXPECT-literal pattern is by design, not an oversight). Reused unmodified:
  // resolveAppServerSpawnCommand() (produces the one binaryPath both sub-
  // checks probe), isTestCapability(), RC.CAPABILITY_SCHEMA_DRIFT/
  // RC.AUTH_ISOLATION (module-scope, above), the module-scope `generated`
  // binding (./generated/c2-schema-validators.generated.cjs, required once,
  // below). Uncalled by any command path this round -- R14 wiring into
  // cmdConformance's own verdict/exit-code computation is explicitly a LATER
  // sequence's scope; this function is reachable only via its direct export,
  // exactly like resolveAppServerSpawnCommand's own precedent immediately
  // above.
  //
  // probeAuthReadiness()'s real path reimplements the ALGORITHM of
  // .planning/wave-portable-runtime-messaging-adapters/prep/gc-verify.cjs's
  // own authProbe (that file's lines 296-344) as NEW local helpers physically
  // inside this file -- gc-verify.cjs itself is NEVER required from here.
  // probeSchemaCapability()'s real path likewise mirrors gc-verify.cjs's own
  // liveSchemaFp() (that file's lines 211-235) for the live spawn/mkdtemp/
  // timeout shape only, never its content-hash comparison.
  const R2_SCHEMA_PROBE_TMP_PREFIX = 'rbc-r2-schema-probe-';
  const HOST_CODEX_AUTH_MAX_BYTES = 4 * 1024 * 1024;
  const R2_AUTH_STAT_IDENTITY_KEYS = Object.freeze(['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeMs']);

  /**
   * @returns {{ok:true}|{ok:false,rc:number,reason:string}}
   */
  function probeAppServerLiveCapability() {
    let spawnCommand;
    try {
      spawnCommand = resolveAppServerSpawnCommand();
    } catch (err) {
      spawnCommand = null;
    }
    if (
      !spawnCommand || spawnCommand.ok === false
      || typeof spawnCommand.command !== 'string' || spawnCommand.command.length === 0
    ) {
      return { ok: false, rc: RC.CAPABILITY_SCHEMA_DRIFT, reason: 'app-server-spawn-command-unresolved' };
    }
    const binaryPath = spawnCommand.command;

    const schemaResult = probeSchemaCapability(binaryPath);
    if (!schemaResult || schemaResult.ok !== true) {
      return {
        ok: false, rc: RC.CAPABILITY_SCHEMA_DRIFT,
        reason: (schemaResult && typeof schemaResult.reason === 'string') ? schemaResult.reason : 'app-server-version-probe-failed',
      };
    }

    const authResult = probeAuthReadiness(binaryPath);
    if (!authResult || authResult.ok !== true) {
      return {
        ok: false, rc: RC.AUTH_ISOLATION,
        reason: (authResult && typeof authResult.reason === 'string') ? authResult.reason : 'auth-source-unsafe-or-absent',
      };
    }

    return { ok: true };
  }

  /**
   * rc3 sub-check (PRIVATE, not exported): proves the pinned binary is
   * genuinely executable and its JSON-schema-generation capability is
   * structurally usable -- never by comparing against a frozen historical
   * hash or version-string literal. Test-injectable via
   * RUNTIME_BRIDGE_CODEX_FAKE_SCHEMA_PROBE under isTestCapability(), mirroring
   * resolveAppServerSpawnCommand's own defensive JSON.parse/shape-validate/
   * fallback pattern exactly: malformed, absent, or wrongly-shaped input
   * silently falls through to the real path, never throws.
   * @returns {{ok:true}|{ok:false,reason:string}}
   */
  function probeSchemaCapability(binaryPath) {
    if (isTestCapability()) {
      const raw = process.env.RUNTIME_BRIDGE_CODEX_FAKE_SCHEMA_PROBE;
      if (typeof raw === 'string' && raw.length > 0) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          parsed = undefined;
        }
        if (
          parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean'
          && (parsed.ok || typeof parsed.reason === 'string')
        ) {
          return parsed;
        }
      }
    }
    // Real path: never throws (defense-in-depth catch-all below; every inner
    // step is itself already non-throwing by construction).
    try {
      if (!r2ProbeBinaryVersionLive(binaryPath)) {
        return { ok: false, reason: 'app-server-version-probe-failed' };
      }
      const generation = r2ProbeSchemaGenerationLive(binaryPath);
      if (generation.ok === false) {
        return { ok: false, reason: generation.reason };
      }
      if (generation.structurallyValid === false) {
        return { ok: false, reason: 'app-server-generated-schema-structurally-invalid' };
      }
      return { ok: true };
    } catch (err) {
      // Structurally unreachable given the inner helpers' own non-throwing
      // design -- kept as a last-resort safety net so this function can never
      // propagate an exception, mirroring the file-wide "pure, no-throw"
      // R2 preflight contract.
      return { ok: false, reason: 'app-server-version-probe-failed' };
    }
  }

  /** Fixed ~15s `--version` liveness probe, matching gc-verify.cjs's own --version probe timeout (that file's lines 350, 369). Non-zero exit, spawn error, or timeout are indistinguishable by design -- the exact stdout text proves nothing this design cares about. */
  function r2ProbeBinaryVersionLive(binaryPath) {
    const r = spawnSync(binaryPath, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return !!(r && !r.error && !r.signal && r.status === 0);
  }

  /**
   * Spawns the pinned binary's own `app-server generate-json-schema --out
   * <dir>` against a fresh owner-confined temp directory (~30s bound,
   * matching gc-verify.cjs's own generate-json-schema timeout, that file's
   * line 214), always removing the temp directory before returning. Then
   * proves, structurally only (never by content hash), that every
   * generated.definitions key this client actually consumes from the
   * generated schema-validator bundle (generated.definitions /
   * generated.roots, the SAME module-scope binding every isValidXxx()
   * wrapper above already uses) is embedded inside some generated.roots
   * on-disk JSON file's own `definitions` object. A temp-root cleanup
   * failure is FAIL-CLOSED and takes precedence over any success or failure
   * this probe already computed -- the return value is therefore never
   * decided until cleanup truth is known (no return from inside the try or
   * finally before that point).
   * @returns {{ok:true,structurallyValid:boolean}|{ok:false,reason:string}}
   */
  function r2ProbeSchemaGenerationLive(binaryPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), R2_SCHEMA_PROBE_TMP_PREFIX));
    let result;
    try {
      const r = spawnSync(binaryPath, ['app-server', 'generate-json-schema', '--out', tmpDir], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
      });
      const spawnedOk = !!(r && !r.error && !r.signal && r.status === 0);
      result = spawnedOk
        ? { ok: true, structurallyValid: r2SchemaKeysStructurallyPresent(tmpDir) }
        : { ok: false, reason: 'app-server-schema-generation-failed' };
    } finally {
      let cleanupOk = true;
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { cleanupOk = false; }
      if (!cleanupOk) result = { ok: false, reason: 'app-server-schema-cleanup-failed' };
    }
    return result;
  }

  /**
   * Maps a `generated.roots` key ("<ns>::<Name>", ns one of v1/v2/base) to
   * its on-disk filename under a `codex app-server generate-json-schema
   * --out <dir>` directory, per the convention confirmed directly from
   * scripts/tools/generate-c2-schema-validators.cjs's own INBOUND_ROOTS/
   * OUTBOUND_ROOTS tables: a versioned root (ns v1/v2) lives at
   * "<ns>/<Name>.json"; an unversioned ("base") root lives flat at
   * "<Name>.json". Root keys only -- `generated.definitions` keys have no
   * on-disk filename of their own and are never passed here.
   */
  function r2SchemaFileRelPathFor(key) {
    const sep = key.indexOf('::');
    if (sep === -1) return key + '.json';
    const ns = key.slice(0, sep);
    const name = key.slice(sep + 2);
    return ns === 'base' ? name + '.json' : ns + '/' + name + '.json';
  }

  function r2SchemaKeysStructurallyPresent(tmpDir) {
    const rootKeys = Object.keys(generated.roots || {});
    const embeddedDefinitionKeys = new Set();
    for (const key of rootKeys) {
      const root = r2ParseRootJsonObject(path.join(tmpDir, r2SchemaFileRelPathFor(key)));
      if (!root) return false;
      for (const definitionKey of Object.keys(root.definitions || {})) embeddedDefinitionKeys.add(definitionKey);
    }
    const definitionKeys = Object.keys(generated.definitions || {});
    return definitionKeys.every((key) => embeddedDefinitionKeys.has(key));
  }

  /**
   * Parses a single generated.roots on-disk JSON file exactly once, returning
   * the parsed root object or null on ANY failure -- missing file, malformed
   * JSON, or a non-object/array root -- never a standalone per-definition
   * file lookup and never a frozen-hash comparison.
   */
  function r2ParseRootJsonObject(filePath) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  }

  /**
   * rc4 sub-check (PRIVATE, not exported): proves the host auth source is
   * present, usable, non-leaking, and provably unchanged by the probe
   * itself. Test-injectable via RUNTIME_BRIDGE_CODEX_FAKE_AUTH_PROBE under
   * isTestCapability(), same double-gate/defensive-parse/fallback pattern as
   * probeSchemaCapability above. Real path reimplements gc-verify.cjs's own
   * authProbe algorithm (that file's lines 296-344) as new local helpers
   * physically inside this file; gc-verify.cjs itself is NEVER required.
   * Hard constraint: no returned reason string, and no returned object as a
   * whole, may ever contain an actual token/account-id value -- only the
   * fixed diagnostic strings below.
   * @returns {{ok:true}|{ok:false,reason:string}}
   */
  function probeAuthReadiness(binaryPath) {
    if (isTestCapability()) {
      const raw = process.env.RUNTIME_BRIDGE_CODEX_FAKE_AUTH_PROBE;
      if (typeof raw === 'string' && raw.length > 0) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          parsed = undefined;
        }
        if (
          parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean'
          && (parsed.ok || typeof parsed.reason === 'string')
        ) {
          return parsed;
        }
      }
    }

    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    let before = { ok: false };
    let after = { ok: false };
    try {
      before = r2ReadOwnedAuthFileSecurely(authPath);
      if (!before.ok) return { ok: false, reason: 'auth-source-unsafe-or-absent' };

      let authJson;
      try {
        authJson = JSON.parse(before.buffer.toString('utf8'));
      } catch (err) {
        return { ok: false, reason: 'auth-token-or-account-absent' };
      }
      const accessToken = authJson && authJson.tokens && authJson.tokens.access_token;
      const accountId = authJson && authJson.tokens && authJson.tokens.account_id;
      const accessTokenOk = typeof accessToken === 'string' && accessToken.length >= 8;
      const accountIdOk = typeof accountId === 'string' && accountId.length > 0;
      if (!accessTokenOk || !accountIdOk) {
        return { ok: false, reason: 'auth-token-or-account-absent' };
      }

      const recognizedSecretValues = r2RecognizedAuthSecrets(authJson);

      const loginStatus = spawnSync(binaryPath, ['login', 'status'], {
        encoding: 'utf8', timeout: 15000, env: r2RestrictedAuthProbeEnv(path.dirname(authPath)),
        windowsHide: true,
      });
      if (!loginStatus || loginStatus.error || loginStatus.signal || loginStatus.status !== 0) {
        return { ok: false, reason: 'codex-login-status-nonzero' };
      }

      const probeOutput = String(loginStatus.stdout || '') + String(loginStatus.stderr || '');
      if (recognizedSecretValues.some((secret) => probeOutput.includes(secret))) {
        return { ok: false, reason: 'auth-secret-leak-detected' };
      }

      if (!r2AccessTokenExpiryMarginOk(accessToken)) {
        return { ok: false, reason: 'auth-token-expiry-margin-insufficient' };
      }

      after = r2ReadOwnedAuthFileSecurely(authPath);
      if (
        !after.ok
        || before.buffer.length !== after.buffer.length
        || !r2SameStatIdentity(before.stat, after.stat)
        || !crypto.timingSafeEqual(before.buffer, after.buffer)
      ) {
        return { ok: false, reason: 'auth-source-mutated-during-probe' };
      }

      return { ok: true };
    } catch (err) {
      // Structurally unreachable given every inner step's own non-throwing
      // design -- last-resort safety net only, never propagates.
      return { ok: false, reason: 'auth-source-unsafe-or-absent' };
    } finally {
      if (before && before.buffer) before.buffer.fill(0);
      if (after && after.buffer) after.buffer.fill(0);
    }
  }

  /**
   * fd-bound secure read of a single target file, structurally mirroring
   * THIS FILE's own readProtectedHostCodexPin() idiom above (lstat pre-
   * checks, O_NOFOLLOW open, fstat-compare before/after open, full read,
   * re-lstat/re-fstat after) for a DIFFERENT target (~/.codex/auth.json, not
   * config.toml) and a looser single-file-only shape (no CODEX_CLI_PATH
   * assignment parsing). Never calls readProtectedHostCodexPin() itself,
   * which is config.toml/CODEX_CLI_PATH-specific. Every failure branch
   * BEFORE the function-scope `bytes` read buffer is allocated returns the
   * SAME bare `{ok:false}` deliberately -- the caller (probeAuthReadiness)
   * collapses every one of them (and every post-allocation failure below) to
   * the single fixed external diagnostic reason 'auth-source-unsafe-or-
   * absent', never a granular internal code that could leak filesystem
   * detail externally. Every failure AFTER allocation instead returns
   * `{ok:false,buffer:bytes}` -- a shape private to this internal result
   * only -- and the finally below fills that SAME buffer with zero before
   * the caller ever observes the return value, so secret bytes never remain
   * resident on a failure path. A genuine success transfers `bytes`
   * ownership to the caller UNCHANGED (never pre-zeroed here) via a
   * function-scope success-transfer flag, so probeAuthReadiness's own
   * pre-existing finally (which already zeroes `before.buffer`/`after.buffer`
   * unconditionally once truthy) remains the single place a successful
   * buffer's secret bytes are ultimately zeroed.
   * @returns {{ok:true,buffer:Buffer,stat:object}|{ok:false,buffer?:Buffer}}
   */
  function r2ReadOwnedAuthFileSecurely(filePath) {
    let initialWindowsAcl;
    if (process.platform === 'win32') {
      initialWindowsAcl = windowsPrivateDirectoryAcl(path.dirname(filePath), { mode: 'validate' });
      if (!initialWindowsAcl || initialWindowsAcl.ok !== true) return { ok: false };
    }
    let initial;
    try {
      initial = fs.lstatSync(filePath);
    } catch (err) {
      return { ok: false };
    }
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (
      !initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1
      || initial.size <= 0 || initial.size > HOST_CODEX_AUTH_MAX_BYTES
      || (currentUid !== null && initial.uid !== currentUid)
      || (process.platform !== 'win32' && (initial.mode & 0o077) !== 0)
    ) return { ok: false };

    let fd;
    let bytes;
    let transferred = false;
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (
        !opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino
        || opened.size !== initial.size || opened.nlink !== initial.nlink
      ) return { ok: false };
      bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      if (offset !== bytes.length) return { ok: false, buffer: bytes };
      const afterFd = fs.fstatSync(fd);
      const afterPath = fs.lstatSync(filePath);
      if (
        afterFd.dev !== opened.dev || afterFd.ino !== opened.ino || afterFd.size !== opened.size
        || afterPath.isSymbolicLink() || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino
        || afterPath.size !== opened.size || afterPath.nlink !== opened.nlink
      ) return { ok: false, buffer: bytes };
      if (process.platform === 'win32') {
        const finalWindowsAcl = windowsPrivateDirectoryAcl(path.dirname(filePath), { mode: 'validate' });
        if (!finalWindowsAcl || finalWindowsAcl.ok !== true || !windowsAclSnapshotsEqual(initialWindowsAcl, finalWindowsAcl)) {
          return { ok: false, buffer: bytes };
        }
      }
      transferred = true;
      return { ok: true, buffer: bytes, stat: afterFd };
    } catch (err) {
      return bytes ? { ok: false, buffer: bytes } : { ok: false };
    } finally {
      if (!transferred && bytes) bytes.fill(0);
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (err) { /* read-only admission already resolved above */ }
      }
    }
  }

  /** Exactly gc-verify.cjs's own recognizedSecrets() (that file's lines 253-264): OPENAI_API_KEY, tokens.id_token, tokens.access_token, tokens.refresh_token (each only if a string of length >= 8), plus tokens.account_id unconditionally if a non-empty string. */
  function r2RecognizedAuthSecrets(authJson) {
    const candidates = [
      authJson && authJson.OPENAI_API_KEY,
      authJson && authJson.tokens && authJson.tokens.id_token,
      authJson && authJson.tokens && authJson.tokens.access_token,
      authJson && authJson.tokens && authJson.tokens.refresh_token,
    ];
    const values = candidates.filter((value) => typeof value === 'string' && value.length >= 8);
    const accountId = authJson && authJson.tokens && authJson.tokens.account_id;
    if (typeof accountId === 'string' && accountId.length > 0) values.push(accountId);
    return values;
  }

  /** Environment restricted to EXACTLY PATH/HOME/TMPDIR/LANG/CODEX_HOME, matching gc-verify.cjs's own authProbe environment construction (that file's lines 312-318) exactly -- never the ambient process.env wholesale. */
  function r2RestrictedAuthProbeEnv(codexHomeDir) {
    return {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: os.homedir(),
      TMPDIR: os.tmpdir(),
      LANG: process.env.LANG || 'C.UTF-8',
      CODEX_HOME: codexHomeDir,
    };
  }

  /** Decodes the access token's JWT-style 2nd dot-segment (base64url, padded, JSON `exp` claim), exactly per gc-verify.cjs lines 326-331. A missing, unparseable, or insufficient margin all collapse to `false` -- never throws. */
  function r2AccessTokenExpiryMarginOk(accessToken) {
    const seg = String(accessToken || '').split('.')[1];
    if (!seg) return false;
    try {
      const padded = seg + '='.repeat((4 - (seg.length % 4)) % 4);
      const claims = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      if (typeof claims.exp !== 'number') return false;
      return claims.exp >= Math.floor(Date.now() / 1000) + 300;
    } catch (err) {
      return false;
    }
  }

  /** Identity comparison across the same 7 fields as gc-verify.cjs's own sameStat() (that file's lines 266-269). */
  function r2SameStatIdentity(a, b) {
    return !!a && !!b && R2_AUTH_STAT_IDENTITY_KEYS.every((key) => a[key] === b[key]);
  }

  return Object.freeze({
    probeAppServerLiveCapability, probeSchemaCapability, r2ProbeBinaryVersionLive, r2ProbeSchemaGenerationLive,
    r2SchemaFileRelPathFor, r2SchemaKeysStructurallyPresent, r2ParseRootJsonObject, probeAuthReadiness,
    r2ReadOwnedAuthFileSecurely, r2RecognizedAuthSecrets, r2RestrictedAuthProbeEnv, r2AccessTokenExpiryMarginOk,
    r2SameStatIdentity,
  });
}

module.exports = Object.freeze({ createPreflightProbes });
