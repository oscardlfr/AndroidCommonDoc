---
name: readme-audit
description: "Audit README.md and AGENTS.md against the current state of the repo. Surfaces stale counts, missing table entries, phantom references, project tree drift, guide hub gaps, and prose number claims. Use before closing a milestone or when documentation feels stale."
allowed-tools: [Bash, Read, Edit, Write]
disable-model-invocation: false
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage

```
/readme-audit
/readme-audit --fix
```

## Parameters

- `--fix` — Apply corrections directly after surfacing them. Without this flag, outputs a findings report only.

## Behavior

### What it checks (10 categories)

1. **Skill table completeness** — every skill dir on disk has a row in AGENTS.md; no phantom entries
2. **MCP tool table completeness** — every tool `.ts` file has a row in AGENTS.md; no phantoms
3. **Agent table completeness** — every agent `.md` has a row in README.md; no phantoms
4. **Script table completeness** — every script on disk has a row in README; lib/ files aren't mixed with standalone scripts
5. **Guide hub completeness** — every guide in `docs/guides/` is linked from `guides-hub.md`
6. **Hub link validation** — every markdown link in a hub doc points to a file that exists
7. **Prose number claims** — counts in description paragraphs, section headers, and tree comments match reality
8. **Project tree accuracy** — directories that exist appear in the tree; counts in comments are correct
9. **Consumer/sync split accuracy** — "What Gets Synced" table matches what the sync engine actually sends
10. **Content accuracy** — feature descriptions, flag lists, and default values match the actual script `--help`

### How it works

Runs `scripts/sh/readme-audit.sh --project-root <path>` which:
1. Scans the filesystem for ground truth (skill dirs, tool files, agent files, scripts, guides, hub links)
2. Parses README.md and AGENTS.md to extract claims (tables, counts, tree entries, prose numbers)
3. Diffs ground truth against claims
4. Reports findings by severity: HIGH (blocks pre-commit), MEDIUM (should fix), LOW (cosmetic)

### With --fix

1. Run the audit to collect findings
2. For each fixable finding:
   - **Stale count in header**: update the number
   - **Missing table row**: add the row with description from SKILL.md or file
   - **Phantom table row**: remove it
   - **Missing tree entry**: add directory line
   - **Missing hub link**: add the link row
3. Confirm: "README/AGENTS.md updated — N changes applied."

### Without --fix

Print the findings table. End with: "Run `/readme-audit --fix` to apply corrections."

## When to Run

- Before closing any milestone
- Before tagging a release
- After adding skills, agents, tools, scripts, or guides
- When the README feels stale

The pre-commit hook `readme-pre-commit.sh` validates counts automatically on every commit and blocks if stale.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set}"
bash "$COMMON_DOC/scripts/sh/readme-audit.sh" --project-root "$(pwd)"
```

### Manual (any platform)
The agent reads the audit report, identifies all findings, and applies fixes directly via Edit tool.

## Cross-References

- Script: `scripts/sh/readme-audit.sh`
- Pre-commit hook: `.claude/hooks/readme-pre-commit.sh`
- Registry: `skills/registry.json`
- Skills: `skills/*/SKILL.md`
- Agents: `.claude/agents/*.md`
- MCP tools: `mcp-server/src/tools/*.ts`
