'use strict';

// Extracted verbatim from runtime-bridge-codex.cjs: the generated-schema-
// backed protocol validators, the fixed server-request response tables, and
// the incoming-frame classifier createAppServerConnection dispatches
// through. `generated` is a tracked, checked-in generated file (never a
// facade) and is required directly, exactly as the facade itself already
// did. Only `hasExactKeys` is an injected capability (owned by
// runtime-role-lifecycle.cjs, reached today via the facade's own `rll`
// destructure) -- this module never requires a facade, directly or
// transitively.

// WP3 (second capability-pin remint + C2 design addendum): every validator
// below is a thin wrapper over the tracked generated schema-validator bundle
// (scripts/lib/schema/c2-schema-bundle.json + scripts/tools/
// generate-c2-schema-validators.cjs + scripts/lib/generated/
// c2-schema-validators.generated.cjs -- PLAN.md "C2 Schema Validator
// Bundle", R14 design authority).
const generated = require('../generated/c2-schema-validators.generated.cjs');

function createAppServerProtocolSchema({ hasExactKeys }) {
  /** `FileChange` (json-run2 `definitions.FileChange`): `oneOf` add/delete (both `{content:string,type}`) or update (`{type,unified_diff:string,move_path?}`). */
  function isValidFileChange(fc) {
    return generated.definitions.FileChange(fc);
  }
  /** `ParsedCommand` (json-run2 `definitions.ParsedCommand`): `oneOf` read/list_files/search/unknown, each requiring at least `cmd,type`. */
  function isValidParsedCommand(pc) {
    return generated.definitions.ParsedCommand(pc);
  }
  /** `CommandAction` (json-run2 `definitions.CommandAction`): structurally identical shape to ParsedCommand, `command`/`type`-keyed instead of `cmd`/`type`. */
  function isValidCommandAction(ca) {
    return generated.definitions.CommandAction(ca);
  }
  /** `ToolRequestUserInputQuestion` (json-run2 `definitions.ToolRequestUserInputQuestion`): required `header,id,question` all strings; `isOther`/`isSecret` optional booleans, `options` optional array|null. */
  function isValidToolRequestUserInputQuestion(q) {
    return generated.definitions.ToolRequestUserInputQuestion(q);
  }
  function isValidChatgptAuthTokensRefreshParams(p) {
    return generated.roots['base::ChatgptAuthTokensRefreshParams'](p);
  }
  function isValidApplyPatchApprovalParams(p) {
    return generated.roots['base::ApplyPatchApprovalParams'](p);
  }
  function isValidAttestationGenerateParams(p) {
    return generated.roots['base::AttestationGenerateParams'](p); // Record<string, never> -- must be exactly {}.
  }
  function isValidExecCommandApprovalParams(p) {
    return generated.roots['base::ExecCommandApprovalParams'](p);
  }
  function isValidCommandExecutionRequestApprovalParams(p) {
    return generated.roots['base::CommandExecutionRequestApprovalParams'](p);
  }
  function isValidFileChangeRequestApprovalParams(p) {
    return generated.roots['base::FileChangeRequestApprovalParams'](p);
  }
  function isValidPermissionsRequestApprovalParams(p) {
    return generated.roots['base::PermissionsRequestApprovalParams'](p);
  }
  function isValidDynamicToolCallParams(p) {
    return generated.roots['base::DynamicToolCallParams'](p); // `arguments` is JsonValue -- any already-parsed JSON value is legal.
  }
  function isValidToolRequestUserInputParams(p) {
    return generated.roots['base::ToolRequestUserInputParams'](p);
  }
  function isValidMcpServerElicitationRequestParams(p) {
    return generated.roots['base::McpServerElicitationRequestParams'](p);
  }

  const SERVER_REQUEST_PARAMS_VALIDATORS = Object.freeze({
    applyPatchApproval: isValidApplyPatchApprovalParams,
    'attestation/generate': isValidAttestationGenerateParams,
    execCommandApproval: isValidExecCommandApprovalParams,
    'item/commandExecution/requestApproval': isValidCommandExecutionRequestApprovalParams,
    'item/fileChange/requestApproval': isValidFileChangeRequestApprovalParams,
    'item/permissions/requestApproval': isValidPermissionsRequestApprovalParams,
    'item/tool/call': isValidDynamicToolCallParams,
    'item/tool/requestUserInput': isValidToolRequestUserInputParams,
    'mcpServer/elicitation/request': isValidMcpServerElicitationRequestParams,
  });

  // Fixed, frozen server-request response rows (PLAN.md ~L961-972, SR-02..
  // SR-10). SR-01 (account/chatgptAuthTokens/refresh) is handled separately
  // by the connection core via the caller-supplied refreshProvider -- it is
  // the sole row that may continue the connection rather than STOP.
  const SERVER_REQUEST_FIXED_ROWS = Object.freeze({
    applyPatchApproval: Object.freeze({ result: Object.freeze({ decision: 'denied' }) }),
    'attestation/generate': Object.freeze({ error: Object.freeze({ code: -32601, message: 'non-interactive bridge issues no attestation' }) }),
    execCommandApproval: Object.freeze({ result: Object.freeze({ decision: 'denied' }) }),
    'item/commandExecution/requestApproval': Object.freeze({ result: Object.freeze({ decision: 'decline' }) }),
    'item/fileChange/requestApproval': Object.freeze({ result: Object.freeze({ decision: 'decline' }) }),
    'item/permissions/requestApproval': Object.freeze({ result: Object.freeze({ permissions: {} }) }),
    'item/tool/call': Object.freeze({ result: Object.freeze({ contentItems: [], success: false }) }),
    'item/tool/requestUserInput': Object.freeze({ result: Object.freeze({ answers: {} }) }),
    'mcpServer/elicitation/request': Object.freeze({ result: Object.freeze({ action: 'decline' }) }),
  });

  const SERVER_REQUEST_UNKNOWN_METHOD_ERROR = Object.freeze({ code: -32601, message: 'unknown method' });
  // PLAN.md specifies "error+STOP" for a failed refresh but does not freeze
  // an exact code/message for that row (unlike SR-03's literal -32601) --
  // documented interpretive choice, not a PLAN-literal mapping.
  const SERVER_REQUEST_REFRESH_FAILED_ERROR = Object.freeze({ code: -32000, message: 'account-refresh-unavailable' });
  // R8 (item 8): a distinct error for a server-request whose params fail
  // method-specific validation -- reuses JSON-RPC's own numeric "Invalid
  // params" convention (-32602) purely as a familiar code, not a claim that
  // this transport IS JSON-RPC 2.0 (PLAN.md ~L903 is explicit it is not).
  const SERVER_REQUEST_INVALID_PARAMS_ERROR = Object.freeze({ code: -32602, message: 'invalid params' });

  const DEFAULT_RPC_TIMEOUT_MS = 10000; // PLAN.md ~L932's literal control-plane response window default.
  // R14 (turn-id replay fence, PLAN.md "Turn Lifecycle State Machine"): a
  // bounded, per-thread-lifetime cap on retired turn ids this connection will
  // remember for replay detection. FROZEN, host-owned -- no project/operator
  // configuration surface exists for this value in production.
  const MAX_RETIRED_TURN_IDS_PER_THREAD = 4096;

  // R7: real generated enums (prep/phase-a/codex-schema/ts-run1/{AuthMode,
  // PlanType,v2/TurnStatus,v2/TurnItemsView,MessagePhase}.ts) -- validated
  // against membership, not merely "is a string", so a value outside the
  // live schema's own universe is distinguished from one that is merely the
  // wrong (but real) enum member.
  const AUTH_MODE_VALUES = Object.freeze(['apikey', 'chatgpt', 'chatgptAuthTokens', 'headers', 'agentIdentity', 'personalAccessToken', 'bedrockApiKey']);
  const PLAN_TYPE_VALUES = Object.freeze(['free', 'go', 'plus', 'pro', 'prolite', 'team', 'self_serve_business_usage_based', 'business', 'enterprise_cbp_usage_based', 'enterprise', 'edu', 'unknown']);

  /**
   * R9 (Codex NO-GO on R8's ThreadItem validation): faithful per-variant
   * validation against the REAL pinned JSON Schema `definitions.ThreadItem`'s
   * 17-way `oneOf`.
   */
  function isSchemaValidThreadItem(it) {
    return generated.definitions.ThreadItem(it);
  }

  /** `MemoryCitationEntry` (json-run2 `definitions.MemoryCitationEntry`): required `lineEnd,lineStart,note,path`, the two line numbers non-negative integers. */
  function isValidMemoryCitationEntry(e) {
    return generated.definitions.MemoryCitationEntry(e);
  }

  /** `MemoryCitation` (json-run2 `definitions.MemoryCitation`): required `entries,threadIds`. */
  function isValidMemoryCitation(mc) {
    return generated.definitions.MemoryCitation(mc);
  }

  /** Full closed-shape validation of one `agentMessage` ThreadItem. Guards `type==='agentMessage'` itself before delegating shape validation to the generated bundle. */
  function isValidAgentMessageItem(it) {
    return !!it && typeof it === 'object' && it.type === 'agentMessage' && generated.definitions.ThreadItem(it);
  }

  /**
   * A `Turn` (json-run2 `definitions.Turn`): required `id,items,status`
   * exactly -- `itemsView` carries `default: "full"` and is genuinely
   * OPTIONAL.
   */
  function isSchemaValidTurn(t) {
    return generated.definitions.Turn(t);
  }

  /**
   * `SubAgentSource` (json-run2 `definitions.SubAgentSource`): a `oneOf` of
   * the closed 3-member string enum, OR exactly
   * `{thread_spawn: {depth: integer, parent_thread_id: string, ...optionals}}`,
   * OR exactly `{other: string}`.
   */
  function isValidSubAgentSource(v) {
    return generated.definitions.SubAgentSource(v);
  }

  /**
   * `SessionSource` (json-run2 `definitions.SessionSource`): a `oneOf` of the
   * closed 5-member string enum, OR exactly `{custom: string}`, OR exactly
   * `{subAgent: SubAgentSource}`.
   */
  function isValidSessionSource(v) {
    return generated.definitions.SessionSource(v);
  }

  /**
   * R7: closed classification of one already-JSON-parsed, non-jsonrpc-tainted
   * frame object (the frame feeder already rejected malformed/non-object/
   * jsonrpc-tainted lines before this ever runs). Distinguishes a genuine
   * `{id,result}` XOR `{id,error}` response (B3) from an ambiguous/extra-key
   * wrapper, validates `id`/`method`/`params` shape for both responses and
   * server-requests (B4/D1), and closes notifications to exactly
   * `{method,params}`. Anything that doesn't cleanly classify is `invalid`
   * -- treated by the caller exactly like a malformed wire frame (STOP),
   * never silently reinterpreted as whichever shape looks closest.
   *
   * R14 (Codex NO-GO 2026-07-18, P1): the four frame-level wrapper roots
   * (`base::JSONRPCResponse`/`JSONRPCError`/`JSONRPCRequest`/
   * `JSONRPCNotification`) are the FIRST choke point for each of the four
   * classes.
   */
  function classifyIncomingFrame(frame) {
    const hasId = Object.prototype.hasOwnProperty.call(frame, 'id');
    const hasMethod = Object.prototype.hasOwnProperty.call(frame, 'method');
    const hasResult = Object.prototype.hasOwnProperty.call(frame, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(frame, 'error');
    const idOk = (v) => typeof v === 'string' ? v.length > 0 : (typeof v === 'number' && Number.isInteger(v));
    if (hasId && !hasMethod) {
      if (hasResult === hasError) return { kind: 'invalid', reason: 'response-wrapper-ambiguous' }; // neither or both -- never guess; also which schema applies is still undetermined here.
      if (hasResult) {
        if (!generated.roots['base::JSONRPCResponse'](frame)) return { kind: 'invalid', reason: 'response-schema-invalid' };
      } else {
        if (!generated.roots['base::JSONRPCError'](frame)) return { kind: 'invalid', reason: 'response-error-schema-invalid' };
      }
      if (!idOk(frame.id)) return { kind: 'invalid', reason: 'response-id-not-string-or-integer' };
      const expectedKeys = (hasResult ? ['id', 'result'] : ['id', 'error']).sort();
      if (!hasExactKeys(frame, expectedKeys)) return { kind: 'invalid', reason: 'response-wrapper-extra-keys' };
      return { kind: 'response', id: frame.id, ok: hasResult, result: frame.result, error: frame.error };
    }
    if (hasId && hasMethod) {
      if (!generated.roots['base::JSONRPCRequest'](frame)) return { kind: 'invalid', reason: 'server-request-schema-invalid' };
      if (!idOk(frame.id)) return { kind: 'invalid', reason: 'server-request-id-not-string-or-integer' };
      if (typeof frame.method !== 'string' || frame.method.length === 0) return { kind: 'invalid', reason: 'server-request-method-invalid' };
      if (!hasExactKeys(frame, ['id', 'method', 'params'].sort())) return { kind: 'invalid', reason: 'server-request-extra-keys' };
      if (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)) return { kind: 'invalid', reason: 'server-request-params-not-object' };
      return { kind: 'server-request', frame };
    }
    if (!hasId && hasMethod) {
      if (!generated.roots['base::JSONRPCNotification'](frame)) return { kind: 'invalid', reason: 'notification-schema-invalid' };
      // Real server notifications carry legitimate extra fields (e.g. emittedAtMs) -- never exact-key-close this branch.
      if (typeof frame.method !== 'string' || frame.method.length === 0) return { kind: 'invalid', reason: 'notification-method-invalid' };
      if (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)) return { kind: 'invalid', reason: 'notification-params-not-object' };
      return { kind: 'notification', method: frame.method, params: frame.params };
    }
    return { kind: 'invalid', reason: 'frame-neither-request-response-notification' };
  }

  // Sequence 0006 correction: every remaining facade-local `generated.roots[...]`
  // use, closed to one specifically-named function each -- never a reopened
  // `generated` escape hatch. `isValidThreadStartOrResumeResponse` closes the
  // two-member `reasonPrefix` enum (thread-start | thread-resume) that used to
  // select `generated.roots[rootKey]` by an arbitrary string key.
  function isValidThreadReadParams(params) {
    return generated.roots['v2::ThreadReadParams'](params);
  }
  function isValidThreadReadResponse(response) {
    return generated.roots['v2::ThreadReadResponse'](response);
  }
  function isValidTurnStartedNotification(params) {
    return generated.roots['v2::TurnStartedNotification'](params);
  }
  function isValidTurnCompletedNotification(params) {
    return generated.roots['v2::TurnCompletedNotification'](params);
  }
  function isValidInitializeResponse(r) {
    return generated.roots['v1::InitializeResponse'](r);
  }
  function isValidAccountUpdatedNotification(params) {
    return generated.roots['v2::AccountUpdatedNotification'](params);
  }
  function isValidLoginAccountResponse(r) {
    return generated.roots['v2::LoginAccountResponse'](r);
  }
  function isValidThreadStartResponse(r) {
    return generated.roots['v2::ThreadStartResponse'](r);
  }
  function isValidThreadResumeResponse(r) {
    return generated.roots['v2::ThreadResumeResponse'](r);
  }
  /** Closes the `reasonPrefix`-keyed `rootKey` selection (thread-start | thread-resume) to these two named validators -- never an arbitrary schema-name lookup. */
  function isValidThreadStartOrResumeResponse(isResume, r) {
    return isResume ? isValidThreadResumeResponse(r) : isValidThreadStartResponse(r);
  }
  function isValidTurnStartResponse(r) {
    return generated.roots['v2::TurnStartResponse'](r);
  }
  function isValidTurnInterruptResponse(r) {
    return generated.roots['v2::TurnInterruptResponse'](r);
  }
  function isValidThreadArchiveResponse(r) {
    return generated.roots['v2::ThreadArchiveResponse'](r);
  }

  return Object.freeze({
    isValidFileChange, isValidParsedCommand, isValidCommandAction, isValidToolRequestUserInputQuestion,
    isValidChatgptAuthTokensRefreshParams, isValidApplyPatchApprovalParams, isValidAttestationGenerateParams,
    isValidExecCommandApprovalParams, isValidCommandExecutionRequestApprovalParams,
    isValidFileChangeRequestApprovalParams, isValidPermissionsRequestApprovalParams,
    isValidDynamicToolCallParams, isValidToolRequestUserInputParams, isValidMcpServerElicitationRequestParams,
    SERVER_REQUEST_PARAMS_VALIDATORS, SERVER_REQUEST_FIXED_ROWS, SERVER_REQUEST_UNKNOWN_METHOD_ERROR,
    SERVER_REQUEST_REFRESH_FAILED_ERROR, SERVER_REQUEST_INVALID_PARAMS_ERROR,
    DEFAULT_RPC_TIMEOUT_MS, MAX_RETIRED_TURN_IDS_PER_THREAD, AUTH_MODE_VALUES, PLAN_TYPE_VALUES,
    isSchemaValidThreadItem, isValidMemoryCitationEntry, isValidMemoryCitation, isValidAgentMessageItem,
    isSchemaValidTurn, isValidSubAgentSource, isValidSessionSource, classifyIncomingFrame,
    isValidThreadReadParams, isValidThreadReadResponse, isValidTurnStartedNotification,
    isValidTurnCompletedNotification, isValidInitializeResponse, isValidAccountUpdatedNotification,
    isValidLoginAccountResponse, isValidThreadStartOrResumeResponse, isValidTurnStartResponse,
    isValidTurnInterruptResponse, isValidThreadArchiveResponse,
  });
}

module.exports = Object.freeze({ createAppServerProtocolSchema });
