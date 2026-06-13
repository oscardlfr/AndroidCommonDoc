#!/usr/bin/env node
// subagent-start-context-bundle.js — SubagentStart hook
//
// When a teammate (peer) starts, checks for a context bundle at:
//   .planning/wave-<slug>/context-bundles/<role>.md
//
// If the bundle exists and its wave_slug frontmatter matches the current
// wave (derived from git branch, NOT env var — env does not persist between
// Bash calls), emits additionalContext so the peer starts with pre-loaded
// knowledge.
//
// Identity resolution: teammates have non-empty agent_type. The role used
// for bundle lookup is agent_type (canonical NAME per OQ3 D8 constraint).
//
// Slug resolution: git branch feature/<slug> → slug. Env var CLAUDE_WAVE_SLUG
// is NOT used — it does not persist between Bash calls in the Claude harness.
//
// Absent or stale bundle → exit 0 silently (fail-open, never blocks spawn).
// Parse errors → exit 0 silently (fail-open).
//
// Wired in .claude/settings.json under SubagentStart matcher.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const STDIN_TIMEOUT_MS = 5000;

function resolveWaveSlug(projectRoot) {
  // Branch-name resolution only: env var does not persist between Bash calls.
  // feature/<slug> → slug extracted from suffix after last '/'.
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      const branch = (result.stdout || '').trim();
      if (branch && branch !== 'HEAD') {
        if (branch.startsWith('feature/')) {
          return branch.slice('feature/'.length);
        }
        // Non-feature branch: return as-is (wave slug may equal branch name)
        if (branch !== 'develop' && branch !== 'master' && branch !== 'main') {
          return branch;
        }
      }
    }
  } catch {
    // git not available or failed — fail-open
  }
  return null;
}

function extractWaveSlugFromFrontmatter(content) {
  // Extract wave_slug from YAML frontmatter block between --- markers.
  // Accepts both `wave_slug: "value"` and `wave_slug: value` forms.
  const match = /^---\n[\s\S]*?wave_slug:\s*["']?([^"'\n]+)["']?\s*\n[\s\S]*?---/m.exec(content);
  if (!match) return null;
  return match[1].trim();
}

let input = '';
const t = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);

    // Only fire for SubagentStart events
    if (data.hook_event_name !== 'SubagentStart') process.exit(0);

    // Only for teammates (non-empty agent_type = peer)
    const agentType = (data.agent_type || '').trim();
    if (!agentType) process.exit(0); // main orchestrator — skip

    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Resolve wave slug from git branch
    const waveSlug = resolveWaveSlug(projectRoot);
    if (!waveSlug) process.exit(0); // no active wave — skip silently

    // Bundle path: .planning/wave-<slug>/context-bundles/<role>.md
    const bundlePath = path.join(
      projectRoot,
      '.planning',
      `wave-${waveSlug}`,
      'context-bundles',
      `${agentType}.md`
    );

    if (!fs.existsSync(bundlePath)) process.exit(0); // absent — skip silently

    let bundleContent;
    try {
      bundleContent = fs.readFileSync(bundlePath, 'utf8');
    } catch {
      process.exit(0); // unreadable — fail-open
    }

    // Validate wave_slug freshness: bundle frontmatter must match current slug
    const bundleSlug = extractWaveSlugFromFrontmatter(bundleContent);
    if (!bundleSlug || bundleSlug !== waveSlug) {
      // Stale or unmatched bundle — skip silently (do not inject stale context)
      process.stderr.write(
        `[subagent-start-context-bundle] stale bundle for "${agentType}": ` +
        `bundle wave_slug="${bundleSlug}" vs current="${waveSlug}" — skipping\n`
      );
      process.exit(0);
    }

    // Bundle is fresh — emit additionalContext
    process.stdout.write(JSON.stringify({
      additionalContext: bundleContent,
    }));
    process.exit(0);

  } catch {
    // Fail-open on any parse error
    process.exit(0);
  }
});
