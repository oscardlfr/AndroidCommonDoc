#!/usr/bin/env node
// agent-spawn-validator.js — PreToolUse hook for Task / Agent
//
// Validates `subagent_type` against `.claude/registry/agents.manifest.yaml`
// before allowing the spawn. Two checks:
//   1. subagent_type must exist in the manifest's `agents` map
//   2. The corresponding template at setup/agent-templates/<name>.md must
//      have frontmatter SHA-256 matching the manifest's baseline (no drift)
//
// Exempt: agents with `skip: true` in the manifest (e.g.,
//         feature-domain-specialist scaffold). They pass through.
//
// Spawns without `subagent_type` (Anthropic's user-default `general-purpose`
// agent) are not validated — Anthropic owns that path.
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
  if (!subagentType) process.exit(0);

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const manifestPath = path.join(
    projectRoot,
    '.claude',
    'registry',
    'agents.manifest.yaml',
  );
  if (!fs.existsSync(manifestPath)) process.exit(0);

  let yaml;
  try {
    yaml = require(
      path.join(projectRoot, 'mcp-server', 'node_modules', 'yaml'),
    );
  } catch {
    process.exit(0);
  }

  let manifest;
  try {
    manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!manifest || !manifest.agents) process.exit(0);

  const agent = manifest.agents[subagentType];
  if (!agent) {
    const knownAgents = Object.keys(manifest.agents).slice(0, 10).join(', ');
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          '[agent-spawn-validator] subagent_type "' +
          subagentType +
          '" not found in .claude/registry/agents.manifest.yaml. ' +
          'Known agents: ' +
          knownAgents +
          ', ... Pass an exact match, omit subagent_type for the default agent, or add the agent to the manifest first.',
      }),
    );
    process.exit(2);
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
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
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
      }),
    );
    process.exit(2);
  }

  // Check 3 — TeamCreate-peer enforcement
  // If the manifest classifies this agent as a TeamCreate-peer, require that the
  // spawn includes team_name and name parameters. Guards against accidental
  // subagent spawns of agents intended to live as session peers (BL-W32-07).
  const spawnMethod = agent?.dispatch?.spawn_method;  // optional chaining mandatory (dispatch may be absent)
  if (spawnMethod === 'TeamCreate-peer') {
    const teamName = data.tool_input?.team_name;
    const agentName = data.tool_input?.name;
    if (!teamName || !agentName) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[agent-spawn-validator] Agent "' + subagentType + '" has spawn_method=TeamCreate-peer in manifest but was called without team_name and/or name. Use: Agent(subagent_type="' + subagentType + '", team_name="session-{slug}", name="' + subagentType + '")'
      }));
      process.exit(2);
    }

    // Stale-suffix guard (BL-W47 identity-tolerance, L6e)
    // Three cases when agentName differs from subagentType (canonical):
    //   A. Intentional overflow: agentName = canonical + -\d+ suffix AND canonical is in manifest
    //      => ALLOW (rotation pattern; overflow peer)
    //   B. Accidental same-name: trivially caught by the equality guard above
    //   C. Free name: agentName matches no canonical pattern => WARN
    if (agentName !== subagentType) {
      const suffixMatch = /^(.+)-(\d+)$/.exec(agentName);
      if (suffixMatch) {
        const canonicalBase = suffixMatch[1];
        if (!manifest.agents || !manifest.agents[canonicalBase]) {
          // Case C: suffix present but canonical base not in manifest => WARN
          process.stderr.write(
            '[agent-spawn-validator] WARN: spawning "' + agentName + '" with suffix but canonical "' +
            canonicalBase + '" is not in manifest. This may be a misconfigured name. ' +
            'Prefer canonical names per identity-tolerance OQ3.\n'
          );
        }
        // Case A: known canonical with numeric suffix => silently allow (fall through)
      } else {
        // Case C: free name (no suffix) => WARN, allow
        process.stderr.write(
          '[agent-spawn-validator] WARN: name="' + agentName + '" does not match subagent_type="' +
          subagentType + '" and has no recognized suffix. Canonical name preferred for gate coverage.\n'
        );
      }
    }
  }

  process.exit(0);
});

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
