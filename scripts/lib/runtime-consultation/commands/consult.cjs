'use strict';

// `consult` command controller: the single requester entry point for a context-provider consultation.
// It derives plan, intent and subject bundle from the authenticated wave, then delegates to the existing
// publish-request and dispatch cores. Identity and role still come only from the consumed requester grant.

const CONSULT_TARGET_ROLE = 'context-provider';
const CONSULT_RESULT_KIND = 'CONTEXT_ANSWER';
const CONSULT_EXPIRY_SECONDS = 1800;
const MAX_QUESTION_BYTES = 8192;

function createConsultCommand({
  CliError,
  cmdPublishRequest,
  computeWorktreeId,
  dispatchCanonical,
  fs,
  getRuntimeRoleLifecycle,
  isoPlusSeconds,
  nowIso,
  path,
  requireFlags,
  resolveAbsolute,
}) {
  /** The project root is the hook/launcher-owned environment, never a caller flag; it must own the coordination root. */
  function resolveProjectRoot(coordRoot) {
    const declared = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let projectRoot;
    try {
      projectRoot = fs.realpathSync(declared);
    } catch (err) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'consult project root is unresolved');
    }
    if (computeWorktreeId(coordRoot) !== computeWorktreeId(projectRoot)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'consult coordination root belongs to a foreign worktree');
    }
    return projectRoot;
  }

  function discoverWavePlan(projectRoot) {
    let found;
    try {
      found = getRuntimeRoleLifecycle().discoverPlan(projectRoot);
    } catch (err) {
      found = { ok: false };
    }
    if (!found || found.ok !== true || typeof found.planPath !== 'string') {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'consult requires exactly one discoverable wave PLAN');
    }
    return found.planPath;
  }

  /** Idempotent empty subject bundle, matching the manifest shape `publish-request` decodes. */
  function writeSubjectBundle(coordRoot) {
    const bundlePath = path.join(path.dirname(coordRoot), 'coordination-subject-bundle-manifest.json');
    const bytes = JSON.stringify({ schema: 'coordination/subject-bundle-manifest/v1', entries: [] });
    let existing = null;
    try { existing = fs.readFileSync(bundlePath, 'utf8'); } catch (err) { existing = null; }
    if (existing !== bytes) fs.writeFileSync(bundlePath, bytes, { mode: 0o600 });
    return bundlePath;
  }

  function cmdConsult(flags, grantContext) {
    requireFlags(flags, ['coordination-root', 'question']);
    if (Buffer.byteLength(flags.question, 'utf8') > MAX_QUESTION_BYTES || flags.question.trim().length === 0) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', 'consult question must be 1..' + MAX_QUESTION_BYTES + ' bytes');
    }
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const projectRoot = resolveProjectRoot(coordRoot);
    const planPath = discoverWavePlan(projectRoot);
    const intent = {
      target_role: CONSULT_TARGET_ROLE,
      question: flags.question,
      expected_result_kind: CONSULT_RESULT_KIND,
      expiry: isoPlusSeconds(nowIso(), CONSULT_EXPIRY_SECONDS),
    };
    const published = cmdPublishRequest({
      'coordination-root': coordRoot,
      plan: planPath,
      'subject-bundle': writeSubjectBundle(coordRoot),
      intent: Buffer.from(JSON.stringify(intent), 'utf8').toString('base64url'),
    }, grantContext);
    const dispatched = dispatchCanonical({
      'coordination-root': coordRoot,
      request: published.artifact_ref,
    }, { rootSourceDispatch: false });
    return {
      request_id: published.request_id,
      artifact_ref: published.artifact_ref,
      activation_action: dispatched.activation_action || null,
    };
  }

  return Object.freeze({ cmdConsult });
}

module.exports = { createConsultCommand };
