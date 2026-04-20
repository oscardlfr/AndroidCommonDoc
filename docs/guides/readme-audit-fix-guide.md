---
scope: [audit, readme, automation, scripts]
sources: [androidcommondoc, scripts/sh/readme-audit.sh]
targets: [l0, l1, l2]
slug: readme-audit-fix-guide
status: active
layer: L0
category: guides
description: "What scripts/sh/readme-audit.sh --fix actually auto-fixes, what it marks fixable=true but silently no-ops, and how to remediate the gaps manually."
version: 2
last_updated: "2026-04"
---

# readme-audit --fix Gap Guide

`scripts/sh/readme-audit.sh` reports findings tagged `fixable=true` or `fixable=false`. With `--fix`, it invokes `fix_findings()` to apply corrections. In practice, `fix_findings()` handles **three of the twenty-plus** `fixable=true` call-sites — the rest are counted toward the "Fixable: N / M" summary line but silently skipped when `--fix` runs.

This guide documents which findings `--fix` actually patches, which are silently no-op, and the manual checklist for the gaps.

## How to Run

```
bash scripts/sh/readme-audit.sh --project-root <path>
bash scripts/sh/readme-audit.sh --project-root <path> --fix
bash scripts/sh/readme-audit.sh --project-root <path> --json
```

- `--project-root` (required): absolute or relative path to the repo to audit.
- `--fix`: after reporting, run `fix_findings()` — patches a subset of findings in place.
- `--json`: emit findings as JSON instead of a text report.

Exit codes:
- `0` — zero HIGH findings.
- `1` — one or more HIGH findings.

The skill `/readme-audit` wraps this script with `--project-root "$(pwd)"`. The pre-commit hook `.claude/hooks/readme-pre-commit.sh` runs the audit and blocks commits on HIGH findings.

## What `--fix` Auto-Fixes

`fix_findings()` in `scripts/sh/readme-audit.sh` handles exactly three cases. Everything else tagged `fixable=true` falls through the `case "$cat"` block with no action.

| Finding category | Target file | Patch applied |
|------------------|-------------|---------------|
| `count` — "AGENTS.md 'Available Skills (N)' but actual: M" | `AGENTS.md` | Replace first occurrence of `N` with `M` |
| `count` — "AGENTS.md 'MCP Tools (N)' but actual: M" | `AGENTS.md` | Replace first occurrence of `N` with `M` |
| `count` — "README description says 'N tools' but actual: M" | `README.md` | Replace first occurrence of `N` with `M` |
| `count` — "README says 'N Detekt rules' but actual: M" | `README.md` | Replace first occurrence of `N` with `M` |
| `count` — "README says 'N guides' / 'N sub-docs' / 'N commands' but actual: M" | `README.md` | Replace first occurrence of `N` with `M` |
| `missing` — "Skill 'X' exists on disk but missing from AGENTS.md table" | `AGENTS.md` | Append row to `## Available Skills` table, description pulled from `skills/X/SKILL.md` |
| `phantom` — "Skill 'X' in AGENTS.md table but not on disk" | `AGENTS.md` | Remove row matching ``\`X\`` from AGENTS.md |

That is the complete set. Notice all targeted files are `README.md` or `AGENTS.md` at the project root — `fix_findings()` never edits hub docs, source files, or anything under `docs/`.

## What `--fix` Does NOT Fix (Despite `fixable=true`)

The audit emits the following findings with `fixable=true` but `fix_findings()` has no case for them. They print to the report, increment the "Fixable" counter, and then nothing happens.

### Table-level gaps

| Finding | Source line | What should happen |
|---------|-------------|--------------------|
| MCP tool missing from AGENTS.md `## MCP Tools` table | 116 | Append row to AGENTS.md `## MCP Tools` table |
| MCP tool phantom in AGENTS.md `## MCP Tools` table | 122 | Remove row from AGENTS.md `## MCP Tools` table |
| Agent on disk but missing from README `## Agents` table | 140 | Append row to README.md `## Agents` table |
| Script in README `## Scripts` table but actually in `scripts/sh/lib/` | 159 | Remove misplaced row (`lib/` is helpers, not standalone scripts) |
| Script phantom in README `## Scripts` table | 161 | Remove row from README.md `## Scripts` table |
| Script on disk but missing from README `## Scripts` table | 168 | Append row to README.md `## Scripts` table |
| Guide file in `docs/guides/` not linked from `guides-hub.md` | 182 | Append row to `docs/guides/guides-hub.md` Documents table |
| Hub directory on disk but missing from README `## Documentation` table | 215 | Append row to README.md `## Documentation` table |
| Hub links N sub-docs but directory has M non-hub `.md` files | 240 | Adjust hub's link table or the directory contents |

### Prose / tree-level gaps

| Finding | Source line | What should happen |
|---------|-------------|--------------------|
| Project tree `sh/` count claim doesn't match disk | 303 | Update the count in the README tree comment |
| Directory on disk but missing from README project tree block | 310 | Insert directory line into tree |
| `version.properties` exists but not mentioned in README | 316 | Add one-line reference |
| Consumer/L0 agent count drift (category: `content`) | 332 | Update the "Consumer agents" or "Domain Agents" claim |

### Partial coverage — the `count` fixer

The `count` case in `fix_findings()` uses `re.sub(r'(?<!\d)OLD(?!\d)', NEW, content, count=1)` against AGENTS.md or README.md. This works when the old number is unique in its document, but misfires when:

- The same number appears in multiple places (tree, table header, prose) — the first match wins, and the other claims remain stale.
- The target file is neither AGENTS.md nor README.md. The "Hub 'X': links N docs but directory has M non-hub .md files" finding is tagged `fixable=true` but has no target-file resolution in `fix_findings()` — silent no-op.
- The substring is inside a hub header line or a path fragment, not a count claim.

Re-run the audit after `--fix` to confirm the finding actually cleared. A stale count with the same number in two places will "fix" once and then re-report on the next run.

## Empirical Check — What You'll See

Run `--fix` on a project in mild drift and you will typically see output shaped like this:

```
  Total: 10 findings (0 HIGH, 1 MEDIUM, 9 LOW)
  Fixable: 10 / 10

  Applied: 1 fix(es)
```

"Fixable: 10 / 10" says every finding is tagged fixable. "Applied: 1 fix(es)" says one of them got patched. The other nine are silently skipped — they remain on the next run unless you remediate them by hand using the checklist below.

## Manual Remediation Checklist

Work through this list after `--fix` to clear residual findings. Each item maps to a silently-skipped case above.

1. **MCP tool drift** — edit `AGENTS.md`. Under `## MCP Tools`, add rows for tools flagged "on disk but missing" (pull the one-line description from the top comment of `mcp-server/src/tools/<name>.ts`). Remove rows for tools flagged "phantom".
2. **Agent drift** — edit `README.md`. Under `## Agents`, add rows for agents flagged "missing" (description from the agent's frontmatter `description:` field in `.claude/agents/<name>.md`).
3. **Script drift** — edit `README.md`. Under `## Scripts`, add rows for missing scripts. Remove rows for scripts flagged `misplaced` — they live in `scripts/sh/lib/` and are helpers, not standalone scripts.
4. **Guide hub drift** — edit `docs/guides/guides-hub.md`. Under `## Documents`, append `| [<slug>](<slug>.md) | <frontmatter description> |` for each flagged guide. This also prevents the audit from re-flagging the guide you just wrote as a phantom link.
5. **Documentation hub drift** — edit `README.md`. Under `## Documentation`, append `| [<hub-name>](docs/<hub-name>/<hub-name>-hub.md) | <N> sub-docs | <purpose> |` for each flagged hub.
6. **Sub-doc count mismatch** — edit the offending `docs/<hub-name>/<hub-name>-hub.md`. Update the count claim in the description or intro line. Alternatively, add the missing sub-doc links to the hub's `## Documents` table.
7. **Project tree drift** — edit `README.md`. Find the project tree code block. Add missing directory lines (e.g., `setup/agent-templates/`, `setup/copilot-agent-templates/`). Fix count comments manually — the tree is not grammar-safe for substring replace.
8. **`version.properties` reference** — add a one-line mention in `README.md` under the project tree or in a file-index section.
9. **Consumer/L0 agent count** — check how many agents the sync engine actually ships, then update the "Consumer agents" or "Domain Agents" claim in `README.md`.

After each batch of edits, re-run `bash scripts/sh/readme-audit.sh --project-root <path>` to confirm the findings cleared. Do not mass-edit without re-auditing — fixes to one row can shift line positions and invalidate other findings.

## Why `--fix` Is Partial Today

The audit emission side (`add_finding` calls) was extended across multiple waves as new drift categories were discovered. `fixable=true` was tagged any time an auto-fix was theoretically cheap, whether or not `fix_findings()` had been extended to cover it. The implementation side only grew for the three highest-frequency cases (skill count, skill missing, skill phantom — all in AGENTS.md).

Expanding `fix_findings()` to cover the gaps above is a known backlog item. This guide exists so consumers can remediate today without waiting for the script to catch up.

## Cross-References

- Script: `scripts/sh/readme-audit.sh`
- Skill: `skills/readme-audit/SKILL.md`
- Pre-commit hook: `.claude/hooks/readme-pre-commit.sh`
- Suppressions schema: [audit-suppressions](audit-suppressions.md)
- Hub: [guides-hub](guides-hub.md)
