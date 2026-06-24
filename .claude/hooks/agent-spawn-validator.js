#!/usr/bin/env node
// agent-spawn-validator.js — PreToolUse hook for Task / Agent
//
// Validates `subagent_type` against `.claude/registry/agents.manifest.yaml`.
// The manifest is a DRIFT REGISTRY for L0 agents, NOT a closed roster
// (BL-W48 team-model migration). Behavior:
//   1. subagent_type NOT in the manifest -> ALLOW (harness-native types like
//      Explore/Plan/general-purpose, or any other valid runtime agent). Multi-
//      agent capability must not be gated by L0 membership.
//   2. subagent_type or name matching a stale suffixed persistent control-plane
//      role (name-2/name-N) -> BLOCK with cleanup guidance for
//      $HOME/.claude/teams/ session dirs. Specialist overflow names such as
//      ui-specialist-2 remain valid additional capacity and are not blocked here.
//   3. subagent_type IN the manifest -> the template at
//      setup/agent-templates/<name>.md must have frontmatter SHA-256 matching
//      the manifest baseline (drift check); mismatch -> block.
//   (Former Check 3 — TeamCreate-peer team_name enforcement — REMOVED; team_name
//    is deprecated/ignored under the single implicit team.)
//
// Exempt: agents with `skip: true` in the manifest. They pass through.
// Spawns without `subagent_type` (default general-purpose) are not validated.
//
// Hash algorithm mirrors mcp-server/src/registry/template-generator.ts:
//   - `splitFrontmatterAndBody` extracts the YAML block between `---` markers
//     (BOM stripped, CRLF → LF, no markers in the block)
//   - `computeFrontmatterSha256` normalizes (CRLF → LF, trimEnd, append "\n")
//     then SHA-256 hex-digests the result
//
// Wired in .claude/settings.json under PreToolUse → Task|Agent matcher.
//
// Exit codes:
//   0 = allow (no violation, no manifest, no baseline, no template, parse error)
//   2 = block (with `decision: block` + `reason` JSON on stdout)
//
// Fail open on any error — never block due to validator bug.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadYaml } = require('./hook-control-plane-utils');

const STALE_SUFFIX_CATEGORIES = new Set([
  'architect',
  'context',
  'doc-owner',
  'orchestrator',
]);

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name || '';
  if (toolName !== 'Task' && toolName !== 'Agent') process.exit(0);

  const subagentType = data.tool_input?.subagent_type;
  const subagentName = data.tool_input?.name;
  if (!subagentType) process.exit(0);

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const manifestPath = path.join(
    projectRoot,
    '.claude',
    'registry',
    'agents.manifest.yaml',
  );
  if (!fs.existsSync(manifestPath)) process.exit(0);

  const yaml = loadYaml(projectRoot);
  if (!yaml) process.exit(0);

  let manifest;
  try {
    manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!manifest || !manifest.agents) process.exit(0);

  const staleSuffix = getStaleSuffixViolation(
    subagentType,
    subagentName,
    manifest.agents,
  );
  if (staleSuffix) {
    block(
      '[agent-spawn-validator] Stale suffixed core role spawn blocked: "' +
        staleSuffix.value +
        '".\n' +
        'Field: ' +
        staleSuffix.field +
        '\n' +
        'Canonical role: ' +
        staleSuffix.base +
        '\n' +
        'Fix: clean stale session directories under $HOME/.claude/teams/ for the previous session, then respawn the canonical Agent(name="' +
        staleSuffix.base +
        '", subagent_type="' +
        staleSuffix.base +
        '").'
    );
    return;
  }

  const agent = manifest.agents[subagentType];
  if (!agent) {
    // BL-W48 team-model migration: the manifest is a DRIFT registry for L0
    // agents, NOT a closed roster. A subagent_type absent from it is a
    // harness-native type (Explore / Plan / general-purpose) or any other valid
    // agent the runtime offers — multi-agent capability must NOT be gated by L0
    // membership (this gate previously blocked Explore/Plan). Pass through; the
    // runtime itself validates the type. L0 agents still get drift-checked below.
    process.exit(0);
  }

  if (agent.skip === true) process.exit(0);

  const baseline = agent.template_frontmatter_sha256;
  if (!baseline) process.exit(0);

  const templatePath = path.join(
    projectRoot,
    'setup',
    'agent-templates',
    subagentType + '.md',
  );
  if (!fs.existsSync(templatePath)) process.exit(0);

  let templateText;
  try {
    templateText = fs.readFileSync(templatePath, 'utf8');
  } catch {
    process.exit(0);
  }

  const yamlBlock = extractFrontmatter(templateText);
  if (yamlBlock == null) process.exit(0);

  const normalized = yamlBlock.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
  const computed = crypto
    .createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex');

  if (computed !== baseline) {
    block(
      '[agent-spawn-validator] Template setup/agent-templates/' +
        subagentType +
        '.md frontmatter SHA-256 has drifted from the manifest baseline.\n' +
        'Baseline: ' +
        baseline +
        '\n' +
        'Computed: ' +
        computed +
        '\n' +
        'Fix: run `node mcp-server/build/cli/generate-template.js ' +
        subagentType +
        ' --update-manifest-hash` and `bash scripts/sh/rehash-registry.sh --project-root .`, then commit.',
    );
    return;
  }

  // BL-W48: TeamCreate/team_name enforcement remains removed. The H2
  // stale-suffix guard runs before manifest drift validation above; after drift
  // checks pass, single-use Agent spawns are allowed without team_name/name.
  process.exit(0);
});

function block(reason) {
  const json = JSON.stringify({ decision: 'block', reason });
  if (process.stdout.write(json)) {
    process.exit(2);
  } else {
    process.stdout.once('drain', () => process.exit(2));
  }
}

function getStaleSuffixViolation(subagentType, subagentName, agents) {
  const subagentTypeViolation = getStaleSuffixCandidate(
    'subagent_type',
    subagentType,
    subagentType,
    agents,
  );
  if (subagentTypeViolation) return subagentTypeViolation;

  return getStaleSuffixCandidate('name', subagentName, subagentType, agents);
}

function getStaleSuffixCandidate(field, value, subagentType, agents) {
  if (!value) return null;
  const match = /^(.+)-([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const suffixNumber = Number(match[2]);
  if (!Number.isInteger(suffixNumber) || suffixNumber < 2) return null;
  const base = match[1];
  if (field === 'name' && subagentType !== base) return null;
  const agent = agents[base];
  if (!agent) return null;
  if (!STALE_SUFFIX_CATEGORIES.has(agent.category)) return null;
  return { base, suffix: match[2], field, value };
}

// Extract the YAML block between the first two `---` markers, mirroring
// splitFrontmatterAndBody from template-generator.ts. Returns null when the
// input has no recognizable frontmatter.
function extractFrontmatter(raw) {
  if (!raw) return null;
  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return null;

  const closingIdx = text.indexOf('\n---\n', 3);
  if (closingIdx !== -1) return text.slice(4, closingIdx);

  if (text.endsWith('\n---')) return text.slice(4, text.length - 4);

  return null;
}
