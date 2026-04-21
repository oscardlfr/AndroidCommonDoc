<!-- GENERATED from skills/doc-integrity/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Unified documentation integrity audit. Runs kdoc-coverage, check-doc-patterns, docs/api freshness, and audit-docs in sequence. Produces a single report with coverage, drifts, and structure issues."
---

Unified documentation integrity audit. Runs kdoc-coverage, check-doc-patterns, docs/api freshness, and audit-docs in sequence. Produces a single report with coverage, drifts, and structure issues.

## Instructions

## Usage

```
/doc-integrity                           # full audit — all modules
/doc-integrity --changed-only            # quality gate mode — only changed .kt files
/doc-integrity --module core-common      # single module deep audit
/doc-integrity --fix                     # audit + generate docs/api/ where stale
/doc-integrity --project-root ../other   # cross-project
```

## Parameters

- `--project-root PATH` -- Target project (default: cwd)
- `--module MODULE` -- Single module (default: all)
- `--changed-only` -- Only changed files since base branch
- `--fix` -- Generate/regenerate docs/api/ for stale modules after audit

## Pipeline (5 steps, sequential)

### Step 1: KDoc Coverage

```bash
node "$ANDROID_COMMON_DOC/mcp-server/build/cli/kdoc-coverage.js" "$PROJECT_ROOT" [--changed-files "$CHANGED" | --modules "$MODULE"] --format json
```

Measures: public APIs with/without KDoc per module.
Writes: `.androidcommondoc/kdoc-state.json` (coverage section).
Reads: previous state for regression detection.

### Step 2: Pattern-Code Alignment

Call `check-doc-patterns` MCP tool (or via context-provider):
- Normative patterns (MUST/NEVER) without Detekt rules
- Orphaned generated rules without source doc
- Rule-doc alignment (aligned vs drifted)

If docs/api/ exists, also cross-reference: patterns vs generated API docs content.

### Step 3: docs/api/ Freshness

```bash
node "$ANDROID_COMMON_DOC/mcp-server/build/cli/generate-api-docs.js" "$PROJECT_ROOT" --validate-only
```

Reports: FRESH (all up to date), STALE (modules need regeneration), NO_DOCS (docs/api/ doesn't exist — optional).

If `--fix` flag: regenerate stale modules:
```bash
node "$ANDROID_COMMON_DOC/mcp-server/build/cli/generate-api-docs.js" "$PROJECT_ROOT" [--module "$STALE_MODULE"]
```

### Step 4: Doc Structure Audit

```bash
/audit-docs --project-root "$PROJECT_ROOT" --waves 1,2
```

Validates: frontmatter completeness, size limits (hub 100, sub-doc 300), cross-references, category mapping.

### Step 5: Unified Report

Combine all results into a single report:

```markdown
## Doc Integrity Report

### Summary
| Check | Result | Detail |
|-------|--------|--------|
| KDoc Coverage | {pct}% ({n}/{total}) | {trend vs baseline} |
| Pattern Alignment | {n} drifts | {candidates for new rules} |
| docs/api/ Freshness | FRESH/STALE/N/A | {stale modules if any} |
| Doc Structure | {errors}/{warnings} | {frontmatter, sizes, links} |

### KDoc Coverage by Module
| Module | Coverage | Trend | Gaps |
|--------|----------|-------|------|
| core-common | 100% | = | 0 |
| core-domain | 100% | +44% | 0 |
| core-network-api | 67.7% | new | 30 |
| ... | | | |

### Pattern Drifts
- {pattern} in {doc} → code shows {violation}

### Action Items
1. {module}: add KDoc to {n} public APIs
2. {pattern}: create Detekt rule (run /generate-rules)
3. {module}: regenerate docs/api/ (run /generate-api-docs --module {name})

### State File
Written to: .androidcommondoc/kdoc-state.json
Coverage baseline: {pct}%
docs/api generated at: {timestamp}
```

## Who Uses This

| Context | How |
|---------|-----|
| **Human** | `/doc-integrity` in any project terminal |
| **context-provider** | Reads kdoc-state.json at session start (instant, no re-scan) |
| **quality-gater** | Steps 5+7 call kdoc-coverage and generate-api-docs CLIs |
| **doc-updater** | Pre-write validation uses validate-doc-update MCP tool |
| **CI** | `node build/cli/kdoc-coverage.js --changed-files` with exit code |
| **team-lead** | Delegates to architects who use MCP tools for specifics |

## Cross-References

- CLIs: `kdoc-coverage.js`, `generate-api-docs.js`, `audit-docs.js`
- MCP tools: `kdoc-coverage`, `validate-doc-update`, `check-doc-patterns`, `audit-docs`
- Skills: `/kdoc-audit` (coverage only), `/kdoc-migrate` (add KDoc), `/generate-api-docs` (Dokka)
- State: `.androidcommondoc/kdoc-state.json`
- Docs: `docs/agents/quality-gate-protocol.md`
