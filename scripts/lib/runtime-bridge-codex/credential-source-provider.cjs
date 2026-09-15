'use strict';

function createCredentialSourceProviderFactory({
  fs,
  os,
  path,
  readOwnedStableBuffer,
  hasDuplicateJsonKeyAnyDepth,
  readCredentialSourceFd,
  CREDENTIAL_SOURCE_MAX_BYTES,
  CREDENTIAL_REFRESH_MARGIN_MS,
}) {
  /**
   * Group A / C4 slice (2026-08-10, user-authorized -- see
   * group-a-c4-slice-authorization-2026-08-10.md): the fixed, host-owned
   * production credential source -- exclusively ~/.codex/auth.json, resolved
   * via os.homedir() (which itself honors a caller/environment-supplied HOME
   * on POSIX, exactly how the hermetic tests exercise it via a subprocess HOME
   * override). No path argument, no dedicated override env var, no
   * production-facing configurability. Computed lazily (never module-load
   * time, never cached) so each read reflects the CURRENT HOME.
   * @returns {string}
   */
  function codexAuthPathForProduction() {
    return path.join(os.homedir(), '.codex', 'auth.json');
  }

  /**
   * Group A / C4 slice (2026-08-10): parses a JWT's second (payload) segment
   * as base64url JSON and extracts its `exp` claim (seconds since epoch) --
   * never validates a signature (this library holds no key material to
   * validate against; the JWT's issuing authority, Codex's own login flow, is
   * trusted the same way its access/refresh token bytes already are). Rejects
   * anything that is not genuinely a 3-dot-segment structure with a
   * base64url-JSON-decodable payload carrying a finite numeric `exp`.
   * @param {string} jwtToken
   * @returns {{ok:true,expSeconds:number}|{ok:false}}
   */
  function parseJwtExpClaim(jwtToken) {
    if (typeof jwtToken !== 'string' || jwtToken.length === 0) return { ok: false };
    const segments = jwtToken.split('.');
    if (segments.length !== 3 || segments.some((s) => s.length === 0)) return { ok: false };
    let payloadText;
    try {
      const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      payloadText = Buffer.from(padded, 'base64').toString('utf8');
    } catch (err) {
      return { ok: false };
    }
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch (err) {
      return { ok: false };
    }
    if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { ok: false };
    }
    return { ok: true, expSeconds: payload.exp };
  }

  /**
   * Production factory (PLAN.md ~L1128) -- the ONLY unconditionally-exported
   * constructor, no path-override parameter. Group A / C4 slice (2026-08-10,
   * user-authorized): previously an unconditional stub always returning
   * `{ok:false,reason:'CREDENTIAL_SOURCE_NOT_CONFIGURED'}` regardless of disk
   * state ("real backing is a C4 concern"); this authorization covers exactly
   * that C4 slice. `.read()` now genuinely reads the fixed, host-owned
   * ~/.codex/auth.json through the SAME fd-bound, TOCTOU-protected mechanics
   * readCredentialSourceFd already established (readOwnedStableBuffer, above)
   * -- never a naive path-based read, never a parallel weaker one. Extracts
   * ONLY `tokens.access_token`/`tokens.account_id` in memory; `chatgptPlanType`
   * stays null (no accredited source for it exists yet). `expiresAt` is
   * DERIVED from `tokens.access_token`'s own JWT `exp` claim -- the exact token
   * this provider returns and the same source `prep/gc-verify.cjs` validates.
   * `id_token` is deliberately not used as a liveness proxy because its expiry
   * may differ from the access token. The access token is rejected fail-closed
   * unless at least a 300-second margin remains
   * (CREDENTIAL_REFRESH_MARGIN_MS). Every failure mode remains distinct;
   * nothing is fabricated or guessed.
   * @param {{clock?: function(): number}} [opts]
   * @returns {{read: function(): ({ok:true,credentials:{accessToken:string,chatgptAccountId:string,chatgptPlanType:null},expiresAt:string,sourceIdentity:string}|{ok:false,reason:string})}}
   */
  function createCredentialSourceProvider(opts) {
    // Group A / C4 slice (2026-08-10): this factory previously always
    // returned {ok:false,reason:'CREDENTIAL_SOURCE_NOT_CONFIGURED'}
    // unconditionally, regardless of disk state -- see the docblock above for
    // the full rationale; `.read()` below now genuinely reads the fixed,
    // host-owned ~/.codex/auth.json instead.
    const options = opts || {};
    const clock = typeof options.clock === 'function' ? options.clock : Date.now;
    return {
      read() {
        const credentialPath = codexAuthPathForProduction();
        const lowLevel = readOwnedStableBuffer(credentialPath, CREDENTIAL_SOURCE_MAX_BYTES);
        if (!lowLevel.ok) return lowLevel;
        const { text, initialLstat } = lowLevel;

        if (hasDuplicateJsonKeyAnyDepth(text)) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_DUPLICATE_KEY' };
        }
        let parsedAuth;
        try {
          parsedAuth = JSON.parse(text);
        } catch (err) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_JSON' };
        }
        if (parsedAuth === null || typeof parsedAuth !== 'object' || Array.isArray(parsedAuth)) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_SHAPE' };
        }
        const tokens = parsedAuth.tokens;
        if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_SHAPE' };
        }
        if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_SHAPE' };
        }
        if (typeof tokens.account_id !== 'string' || tokens.account_id.length === 0) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_SHAPE' };
        }

        const jwtResult = parseJwtExpClaim(tokens.access_token);
        if (!jwtResult.ok) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_JWT_MALFORMED' };
        }
        const expiresAtMs = jwtResult.expSeconds * 1000;
        if (!Number.isFinite(expiresAtMs) || (expiresAtMs - clock()) < CREDENTIAL_REFRESH_MARGIN_MS) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_JWT_EXPIRED' };
        }

        // THIRD HARD NO-GO RESPONSE Block D precedent, reapplied here: a
        // final re-lstat AFTER all CPU-bound parsing/validation above,
        // compared against the fd-bound reader's own pre-open snapshot --
        // bounds the ENTIRE operation (including this function's own
        // shape/JWT parsing, which readOwnedStableBuffer's own post-read
        // re-fstat cannot see), never trusting a single snapshot taken once.
        let finalLstat;
        try {
          finalLstat = fs.lstatSync(credentialPath, { bigint: true });
        } catch (err) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' };
        }
        if (finalLstat.isSymbolicLink() || finalLstat.dev !== initialLstat.dev || finalLstat.ino !== initialLstat.ino) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' };
        }

        return {
          ok: true,
          credentials: {
            accessToken: tokens.access_token,
            chatgptAccountId: tokens.account_id,
            chatgptPlanType: null,
          },
          expiresAt: new Date(expiresAtMs).toISOString(),
          sourceIdentity: credentialPath,
        };
      },
    };
  }

  /**
   * Test-only factory (PLAN.md ~L1128) -- exported ONLY when isTestCapability()
   * is true (`undefined` in production, not merely inert: see the conditional
   * module.exports assembly at the bottom of this file). Exists precisely to
   * make the shared fd-bound mechanics in `readCredentialSourceFd` hermetically
   * testable via a caller-supplied path, without ever touching a real
   * credential store.
   * @param {{credentialPath: string, clock?: function(): number}} opts
   * @returns {{read: function(): ({ok:true,credentials:object,otherCredentialFields:object,expiresAt:string,sourceIdentity:string}|{ok:false,reason:string})}}
   */
  function createCredentialSourceProviderForFdTests(opts) {
    const options = opts || {};
    if (typeof options.credentialPath !== 'string' || options.credentialPath.length === 0) {
      throw new TypeError('createCredentialSourceProviderForFdTests requires a non-empty credentialPath');
    }
    const clock = typeof options.clock === 'function' ? options.clock : Date.now;
    return {
      read() {
        void clock;
        return readCredentialSourceFd(options.credentialPath);
      },
    };
  }

  return Object.freeze({ createCredentialSourceProvider, createCredentialSourceProviderForFdTests });
}

module.exports = Object.freeze({ createCredentialSourceProviderFactory });
