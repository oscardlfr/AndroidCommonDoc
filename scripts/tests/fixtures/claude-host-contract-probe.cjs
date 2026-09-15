'use strict';

// Read-only host-contract probe observer. This fixture records/parses native
// hook payloads; it does not import product runtime, registry, grant, or
// identity writers and its fake mode is never host qualification evidence.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

function digestString(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function digestObject(value) {
  return digestString(JSON.stringify(sortKeysDeep(value)));
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function canonicalInputFor(event, root) {
  if (event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Agent') return null;
  const role = event.tool_input && event.tool_input.subagent_type;
  const name = event.tool_input && event.tool_input.name;
  if (typeof role !== 'string' || role.length === 0) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  const manifestPath = path.join(root, 'probe-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!exactKeys(manifest, ['actions', 'schema'])
      || manifest.schema !== 'runtime/claude-host-contract-probe-manifest/v1'
      || manifest.actions === null || typeof manifest.actions !== 'object' || Array.isArray(manifest.actions)) return null;
  const input = manifest.actions[name];
  if (!exactKeys(input, ['description', 'subagent_type', 'name', 'prompt', 'run_in_background'])) return null;
  if (input.subagent_type !== role
      || typeof input.description !== 'string'
      || typeof input.name !== 'string'
      || typeof input.prompt !== 'string'
      || typeof input.run_in_background !== 'boolean') return null;
  return {
    description: input.description,
    subagent_type: input.subagent_type,
    name: input.name,
    prompt: input.prompt,
    run_in_background: input.run_in_background,
  };
}

function main() {
  const rootArg = argValue('--root');
  const evidenceMode = argValue('--evidence-mode');
  if (!rootArg || !['fake-fixture', 'genuine-pinned'].includes(evidenceMode)) {
    process.stderr.write('expected --root and --evidence-mode fake-fixture|genuine-pinned\n');
    return 64;
  }
  const root = fs.realpathSync(rootArg);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return 65;
  const raw = fs.readFileSync(0, 'utf8');
  const event = JSON.parse(raw);
  const allowedEvents = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']);
  if (!event || !allowedEvents.has(event.hook_event_name) || typeof event.session_id !== 'string' || event.session_id.length === 0) return 66;

  const canonicalInput = canonicalInputFor(event, root);
  const observerRoot = path.join(root, 'observer');
  fs.mkdirSync(observerRoot, { recursive: true });
  const observerRealParent = fs.realpathSync(observerRoot);
  if (observerRealParent !== root && !observerRealParent.startsWith(`${root}${path.sep}`)) return 67;
  const row = {
    schema: 'runtime/claude-host-contract-probe-event/v1',
    evidence_mode: evidenceMode,
    producer: 'claude-host-contract-probe',
    hook_event_name: event.hook_event_name,
    session_digest: digestString(event.session_id),
    tool_use_digest: typeof event.tool_use_id === 'string' ? digestString(event.tool_use_id) : null,
    prompt_id_digest: typeof event.prompt_id === 'string' ? digestString(event.prompt_id) : null,
    agent_id_digest: typeof event.agent_id === 'string' ? digestString(event.agent_id) : null,
    agent_type: typeof event.agent_type === 'string' ? event.agent_type : null,
    tool_name: typeof event.tool_name === 'string' ? event.tool_name : null,
    tool_input_digest: event.tool_input === undefined ? null : digestObject(event.tool_input),
    updated_input_digest: canonicalInput === null ? null : digestObject(canonicalInput),
    raw_event: event,
    observed_at: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(observerRoot, 'events.jsonl'), `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });

  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent') {
    const allowed = canonicalInput !== null;
    const hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: allowed ? 'allow' : 'deny',
      permissionDecisionReason: allowed ? 'probe-manifest-canonical-input' : 'probe-manifest-role-not-found',
    };
    if (allowed) hookSpecificOutput.updatedInput = canonicalInput;
    process.stdout.write(JSON.stringify({ hookSpecificOutput }));
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
