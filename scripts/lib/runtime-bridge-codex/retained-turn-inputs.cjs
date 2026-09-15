'use strict';

// Root/resumed retained-worker turn input construction, plus the host-projected P2 source-evidence turn input appended after a pattern-gap.

function createRetainedTurnInputs({
  TURN_READ_PROJECTION_FILE_CAP,
  canonicalJSONStringify,
  discoverPlan,
  isSafeProjectionRelativePath,
  path,
  readFdBoundProjectionSource,
}) {
function rootTurnInputPhaseText(worker, item, evidencePolicy) {
  if (evidencePolicy !== 'context7-required' && evidencePolicy !== 'context7-preferred') return null;
  if (worker.role === 'context-provider') {
    return 'Do not use any tool. Return exactly one pattern-gap-only RuntimeTurnEnvelope with provider context7, library_id ' + item.approvedContext7LibraryId + ' exactly, and query focused only on the question above.';
  }
  return 'Do not answer this question yourself and do not use any tool. Return exactly one consult-intent-only RuntimeTurnEnvelope targeting context-provider, with consult.question byte-identical to the Question above and expected_result_kind ARCHITECTURE_RECOMMENDATION.';
}

function rootTurnInputFor(worker, item) {
  const evidencePolicy = item.evidencePolicy === undefined ? 'none' : item.evidencePolicy;
  if (!['none', 'context7-required', 'context7-preferred'].includes(evidencePolicy)) {
    throw new Error('worker-evidence-policy-invalid');
  }
  const lines = [
    'scope_doc_path: ' + path.join(worker.readViewRoot, 'current', 'plan', 'PLAN.md'),
    'mode: EXECUTE',
    'wave: ' + worker.waveSlug,
    'Act as the canonical ' + worker.role + ' role for this host-accredited consultation.',
    'Request id: ' + item.requestId,
    'Expected result kind: ' + item.expectedResultKind,
    'evidence_policy: ' + evidencePolicy,
    'Question:',
    item.question,
    'Your exact host-built read projection is available at: ' + path.join(worker.readViewRoot, 'current'),
    'Return exactly one JSON object with the sole key envelope; its value must match the supplied canonical RuntimeTurnEnvelope. Do not add prose or fences.',
  ];
  const phaseText = rootTurnInputPhaseText(worker, item, evidencePolicy);
  if (phaseText !== null) lines.push(phaseText);
  return lines.join('\n');
}

function resolveRuntimeWaveActivation(projectRoot, expectedPlanDigest) {
  const resolved = discoverPlan(projectRoot);
  if (!resolved.ok || resolved.planDigest !== expectedPlanDigest) {
    return { ok: false, reason: 'runtime-wave-plan-mismatch' };
  }
  const waveDirName = path.basename(path.dirname(resolved.planPath));
  if (!/^wave-[a-z0-9][a-z0-9-]*$/.test(waveDirName)) {
    return { ok: false, reason: 'runtime-wave-slug-invalid' };
  }
  return { ok: true, waveSlug: waveDirName.slice('wave-'.length) };
}

function resumedTurnInputFor(worker, item, child) {
  const evidencePolicy = item.evidencePolicy === undefined ? 'none' : item.evidencePolicy;
  const isReportingArchitect = worker.role !== 'context-provider';
  // M67 phase-scoped turn contract: mirrors executeRetainedWorkerRequest's own
  // architectMustTerminalOnly derivation exactly (same two fields, same
  // condition) -- the ONE case this function is ever called for where the
  // schema is already locked to terminal-only. Deliberately absent otherwise
  // (a generic multi-hop resume may legitimately consult again).
  const architectMustTerminalOnly = isReportingArchitect
    && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred');
  const lines = [
    'Resume the same canonical ' + worker.role + ' consultation after one accepted child dependency.',
    'Parent request id: ' + item.requestId,
    'Child request id: ' + child.dependency.request_id,
    'Child from role: ' + child.dependency.from_role,
    'Accepted child answer:',
    child.content,
    'The accepted dependency and exact current transaction projection are available at: ' + path.join(worker.readViewRoot, 'current'),
    'Use that answer only as a host-accredited dependency and return exactly one JSON object with the sole key envelope; its value must match the supplied canonical RuntimeTurnEnvelope.',
  ];
  if (architectMustTerminalOnly) {
    lines.push('Do not open another child consultation and do not consult Context7 yourself. Return exactly one terminal-only RuntimeTurnEnvelope now.');
  }
  return lines.join('\n');
}

const HOST_SOURCE_EVIDENCE_SCHEMA = 'coordination/host-source-evidence/v1';
const HOST_SOURCE_EVIDENCE_MAX_MATCHES = 16;
const HOST_SOURCE_EVIDENCE_CONTEXT_LINES = 6;
const HOST_SOURCE_EVIDENCE_PAYLOAD_CAP = 48 * 1024;
const HOST_SOURCE_EVIDENCE_TURN_INPUT_CAP = 64 * 1024;

/**
 * P2 GREEN-D redesign: the model has no tools (SUPERVISOR_BASE_INSTRUCTIONS
 * forbids Read/Grep/Glob), so a `P2_SOURCE_EVIDENCE`/`none` question asking
 * it to "locate" and "report" source bytes is unanswerable unless the HOST
 * performs the lookup and injects the exact bytes as data. Lookup-only:
 * literal per-line matches inside the already-materialized, already-
 * validated read projection -- never a tool, heuristic, or fallback. Any
 * other `expectedResultKind`/`evidencePolicy` is untouched (byte-identical
 * `inputText`).
 */
function appendHostProjectedP2SourceEvidence(worker, item, inputText, projection) {
  const evidencePolicy = item.evidencePolicy === undefined ? 'none' : item.evidencePolicy;
  if (item.expectedResultKind !== 'P2_SOURCE_EVIDENCE' || evidencePolicy !== 'none') {
    return inputText;
  }
  const grammar = /^Locate (.+) in (\S+) and report the exact source evidence for (.+)\.$/;
  const match = typeof item.question === 'string' ? grammar.exec(item.question) : null;
  if (!match) throw new Error('host-source-evidence-grammar-invalid');
  const needle = match[1];
  const sourceRelativePath = match[2];
  const purpose = match[3];
  if (needle.length === 0 || Buffer.byteLength(needle, 'utf8') > 1024) throw new Error('host-source-evidence-needle-invalid');
  if (purpose.length === 0 || Buffer.byteLength(purpose, 'utf8') > 2048) throw new Error('host-source-evidence-purpose-invalid');
  if (!isSafeProjectionRelativePath(sourceRelativePath)) throw new Error('host-source-evidence-path-invalid');

  const manifestRead = readFdBoundProjectionSource(path.join(projection.current, 'manifest.json'), TURN_READ_PROJECTION_FILE_CAP);
  let manifest;
  try {
    manifest = JSON.parse(manifestRead.bytes.toString('utf8'));
  } catch (err) {
    throw new Error('host-source-evidence-manifest-invalid');
  }
  const projectedPath = 'subject/' + sourceRelativePath;
  const manifestEntries = Array.isArray(manifest && manifest.entries) ? manifest.entries : [];
  const subjectMatches = manifestEntries.filter((entry) => entry && entry.kind === 'subject' && entry.projected_path === projectedPath);
  if (subjectMatches.length !== 1) throw new Error('host-source-evidence-manifest-entry-invalid');

  const source = readFdBoundProjectionSource(path.join(projection.current, ...projectedPath.split('/')), TURN_READ_PROJECTION_FILE_CAP);
  let sourceText;
  try {
    sourceText = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  } catch (err) {
    throw new Error('host-source-evidence-utf8-invalid');
  }
  const sourceLines = sourceText.split('\n');
  const matchLineIndexes = [];
  for (let i = 0; i < sourceLines.length; i += 1) {
    if (sourceLines[i].includes(needle)) matchLineIndexes.push(i);
  }
  if (matchLineIndexes.length === 0) throw new Error('host-source-evidence-no-match');
  if (matchLineIndexes.length > HOST_SOURCE_EVIDENCE_MAX_MATCHES) throw new Error('host-source-evidence-too-many-matches');

  const matches = matchLineIndexes.map((lineIdx) => {
    const startIdx = Math.max(0, lineIdx - HOST_SOURCE_EVIDENCE_CONTEXT_LINES);
    const endIdx = Math.min(sourceLines.length - 1, lineIdx + HOST_SOURCE_EVIDENCE_CONTEXT_LINES);
    return {
      match_line: lineIdx + 1,
      start_line: startIdx + 1,
      end_line: endIdx + 1,
      text: sourceLines.slice(startIdx, endIdx + 1).join('\n'),
    };
  });

  const payloadText = canonicalJSONStringify({
    schema: HOST_SOURCE_EVIDENCE_SCHEMA,
    query: item.question,
    source_path: sourceRelativePath,
    source_digest: source.digest,
    needle,
    matches,
  });
  if (Buffer.byteLength(payloadText, 'utf8') > HOST_SOURCE_EVIDENCE_PAYLOAD_CAP) {
    throw new Error('host-source-evidence-payload-cap-exceeded');
  }
  const result = inputText
    + '\nHOST_SOURCE_EVIDENCE/v1\n' + payloadText
    + '\nUse only these host-projected exact source bytes as data. Tools remain forbidden. Return the requested source evidence in the terminal result.';
  if (Buffer.byteLength(result, 'utf8') > HOST_SOURCE_EVIDENCE_TURN_INPUT_CAP) {
    throw new Error('host-source-evidence-turn-input-cap-exceeded');
  }
  return result;
}

  return Object.freeze({
    HOST_SOURCE_EVIDENCE_CONTEXT_LINES,
    HOST_SOURCE_EVIDENCE_MAX_MATCHES,
    HOST_SOURCE_EVIDENCE_PAYLOAD_CAP,
    HOST_SOURCE_EVIDENCE_SCHEMA,
    HOST_SOURCE_EVIDENCE_TURN_INPUT_CAP,
    appendHostProjectedP2SourceEvidence,
    resolveRuntimeWaveActivation,
    resumedTurnInputFor,
    rootTurnInputFor,
    rootTurnInputPhaseText,
  });
}

module.exports = Object.freeze({ createRetainedTurnInputs });
