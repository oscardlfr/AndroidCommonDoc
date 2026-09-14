'use strict';

// Extracted verbatim from runtime-bridge-codex.cjs's createAppServerConnection:
// the once-only turn-completion delivery pipeline. Operates only on its
// explicit parameters plus the injected `terminalStop`/validator capabilities
// -- never reads or mutates the connection's own phase/currentTurn state
// directly, so it is instantiated once per connection (a narrow, per-instance
// factory, not a module singleton) alongside the state it delivers into.
// Never requires the facade or either sibling facade, directly or
// transitively.

function createAppServerTurnCompletion({ terminalStop, isValidAgentMessageItem, unwrapAndValidateCodexStructuredRuntimeTurnEnvelope, crypto }) {
  /**
   * Runs the itemsView/agentMessage/envelope validation and invokes
   * `entry.handler` exactly once. Called only from the connection's own
   * `tryDeliverCurrentTurn` (the single delivery transition), so every path
   * that can trigger delivery -- turn/start's own response, a live turn/
   * completed notification, registerHandler, or a resolved refresh deferral
   * -- shares the identical validation logic.
   */
  function invokeTurnCompletionResult(entry, res) {
    try { entry.handler(res); } catch (err) { terminalStop('turn-completion-handler-exception:' + String((err && err.message) || err)); } // E4: a throwing handler fails closed, never crashes the process.
  }

  function invokeTurnCompletionHandler(entry, turn, outputPurpose) {
    const deliver = (res) => invokeTurnCompletionResult(entry, res);
    if (turn.status !== 'completed') { deliver({ ok: false, reason: 'turn-not-completed:' + turn.status }); return; }
    // C7/PLAN.md ~L936 literal: "itemsView absent/full" -- BOTH tolerated;
    // only a present-and-non-full value (summary/notLoaded/anything else)
    // is rejected.
    if (turn.itemsView !== undefined && turn.itemsView !== 'full') { deliver({ ok: false, reason: 'turn-completed-items-view-not-full:' + turn.itemsView }); return; }
    const items = Array.isArray(turn.items) ? turn.items : [];
    const claimedAgentMessages = items.filter((it) => it && it.type === 'agentMessage');
    for (const it of claimedAgentMessages) {
      if (!isValidAgentMessageItem(it)) { deliver({ ok: false, reason: 'turn-completed-agent-message-item-invalid-shape' }); return; } // C8: fail closed, never silently skip a malformed agentMessage-claiming item.
    }
    const finalAnswers = claimedAgentMessages.filter((it) => it.phase === 'final_answer');
    let chosen;
    if (finalAnswers.length === 1) {
      chosen = finalAnswers[0];
    } else if (finalAnswers.length === 0) {
      const compat = claimedAgentMessages.filter((it) => it.phase === null || it.phase === undefined);
      if (claimedAgentMessages.length === 1 && compat.length === 1) chosen = compat[0];
    }
    if (!chosen) { deliver({ ok: false, reason: 'turn-completed-no-unambiguous-final-answer' }); return; }
    if (chosen.text.length === 0) { deliver({ ok: false, reason: 'turn-completed-content-not-bare-json' }); return; }
    // `JSON.parse` throws on any leading prose/fence or trailing bytes after
    // the first complete value -- sufficient on its own for PLAN.md ~L934's
    // "no fence, prose, or trailing bytes" requirement.
    let parsed;
    try {
      parsed = JSON.parse(chosen.text);
    } catch (err) {
      deliver({ ok: false, reason: 'turn-completed-content-not-bare-json' });
      return;
    }
    const result = unwrapAndValidateCodexStructuredRuntimeTurnEnvelope(
      parsed, entry.expectedResultKind, entry.allowedChildRoles, outputPurpose,
      entry.executionContext,
    );
    if (!result.ok) { deliver({ ok: false, reason: 'turn-completed-envelope-invalid:' + result.reason }); return; }
    deliver({ ok: true, envelope: result.envelope });
  }

  function boundedTurnErrorSuffix(error) {
    if (!error || typeof error !== 'object') return '';
    const parts = [];
    if (typeof error.codexErrorInfo === 'string') parts.push('codexErrorInfo=' + error.codexErrorInfo);
    if (typeof error.message === 'string' && error.message.length > 0) {
      // Never emit the raw message: it is an arbitrary, schema-typed string
      // from the backend and may contain secret/credential material, request
      // fragments, or control characters. Length + a truncated digest lets
      // two occurrences be correlated as same-or-different without ever
      // exposing content. additionalDetails is never read here either.
      const digest = crypto.createHash('sha256').update(error.message, 'utf8').digest('hex').slice(0, 16);
      parts.push('messageLength=' + error.message.length + ';messageSha256=' + digest);
    }
    return parts.length ? ':' + parts.join(';') : '';
  }

  return Object.freeze({ invokeTurnCompletionResult, invokeTurnCompletionHandler, boundedTurnErrorSuffix });
}

module.exports = Object.freeze({ createAppServerTurnCompletion });
