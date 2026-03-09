---
name: readme-audit
description: "Audit README.md against the current state of the repo. Surfaces stale counts (skills, rules, tools, agents), missing sections, and outdated descriptions. Use before closing a milestone or when the README feels stale."
allowed-tools: [Bash, Read, Edit, Write]
disable-model-invocation: false
---

## Usage

```
/readme-audit
/readme-audit --fix
```

## Parameters

- `--fix` — Apply corrections directly after surfacing them. Without this flag, outputs a diff-style report only.

## Behavior

### 1. Gather ground truth from repo

Collect the real counts by running:

```bash
# Skills (directories in skills/, excluding registry/params/schema)
ls skills/ | grep -v "registry\|params\|schema" | wc -l

# Registry entries
python3 -c "import json; d=json.load(open('skills/registry.json')); \
  entries = d.get('skills', d.get('entries', [])); print(len(entries))"

# Claude Code commands
ls .claude/commands/ | wc -l

# Agents
ls .claude/agents/ | wc -l

# Detekt rules (hand-written, excluding generated/)
ls detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/*.kt 2>/dev/null | \
  grep -v "generated" | wc -l

# MCP tools
ls mcp-server/src/tools/*.ts | wc -l

# Scripts per platform
ls scripts/sh/ | wc -l

# Reusable CI workflows
ls .github/workflows/reusable-*.yml 2>/dev/null | wc -l

# Pattern docs (sub-docs, excluding hubs and guides)
find docs -name "*.md" ! -name "*hub*" ! -path "*/archive/*" ! -path "*/guides/*" | wc -l

# Hub docs
find docs -name "*hub*.md" | wc -l
```

### 2. Extract claimed counts from README

Read `README.md` and extract the numbers stated in:
- Badge text (if any)
- Description paragraph (first ~10 lines)
- Section headers ("X canonical skills", "X rules", "X tools", etc.)
- Table row counts where the README enumerates items

### 3. Diff and report

Produce a table of discrepancies:

| Item | README claims | Actual | Status |
|------|--------------|--------|--------|
| Skills (dirs) | 30 | 33 | ❌ stale |
| Registry entries | 55 | 59 | ❌ stale |
| Detekt rules | 5 | 13 | ❌ stale |
| MCP tools | 16 | 17 | ❌ stale |
| Agents | 11 | 12 | ❌ stale |
| ... | ... | ... | ✅ current |

Also check for **missing sections**:
- Reusable CI workflows section (if `.github/workflows/reusable-*.yml` exists but not mentioned)
- Any skill directory in `skills/` with no row in the Skills Reference table
- Any agent in `.claude/agents/` with no row in the Agents table

### 4. Apply fixes (with --fix)

If `--fix` is passed:
1. Update all stale counts in the description paragraph and section headers
2. Add missing skill rows to the Skills Reference table (use the `description` field from `skills/<name>/SKILL.md`)
3. Add missing agent rows to the Agents table
4. Add or update the Reusable CI Workflows section if workflows exist
5. Update the Project Structure tree (counts in comments)

Do **not** rewrite sections that are narratively accurate — only update counts and add missing rows.

After applying fixes, confirm: "README updated — N changes applied."

### 5. Output without --fix

Print the discrepancy table and the list of missing sections.
End with: "Run `/readme-audit --fix` to apply corrections."

## When to Run

Run at milestone close, before tagging a release, or any time the README feels stale. The `quality-gate-orchestrator` agent should include this as a final check.

## Cross-References

- Registry: `skills/registry.json`
- Skills: `skills/*/SKILL.md`
- Agents: `.claude/agents/*.md`
- Detekt rules: `detekt-rules/src/main/kotlin/.../rules/`
- MCP tools: `mcp-server/src/tools/`
- Reusable workflows: `.github/workflows/reusable-*.yml`
- README: `README.md`
