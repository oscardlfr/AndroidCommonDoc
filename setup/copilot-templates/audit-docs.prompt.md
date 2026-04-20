<!-- GENERATED from skills/audit-docs/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Unified documentation audit — validates structure (sizes, frontmatter), coherence (links, refs), and upstream content (API assertions, deprecation scan). Waves 1+2 are local ($0). Wave 3 requires --with-upstream."
---

Unified documentation audit — validates structure (sizes, frontmatter), coherence (links, refs), and upstream content (API assertions, deprecation scan). Waves 1+2 are local ($0). Wave 3 requires --with-upstream.

## Instructions

## Usage Examples

```
/audit-docs                                        # standard (Wave 1+2, local)
/audit-docs --with-upstream                        # include upstream validation (Wave 3)
/audit-docs --layer L1 --project-root /path/to/l1  # run on consumer project
/audit-docs --waves 1                              # structure only
/audit-docs --profile deep                         # include LLM semantic analysis
```

## Parameters

- `--project-root PATH` -- Target project root (default: cwd).
- `--layer L0|L1|L2` -- Project layer (default: L0).
- `--waves 1,2,3` -- Comma-separated wave numbers (default: 1,2).
- `--with-upstream` -- Include Wave 3 upstream content validation (requires network).
- `--cache-ttl N` -- Override cache TTL for upstream content in hours (default: 24).
- `--profile deep` -- Include LLM semantic analysis for upstream content changes.
- `--with-readability` — Include Wave 4 readability analysis. Requires: pip install textstat.

## Waves

### Wave 1: Structure (local, $0)
- Hub docs ≤ 100 lines
- Sub-docs ≤ 300 lines (absolute max 500)
- YAML frontmatter completeness
- File naming conventions (kebab-case)
- Archive directory excluded from limits
- Category vocabulary validation

### Wave 2: Coherence (local, $0)
- Internal markdown links resolve to existing files
- L0 refs from L1/L2 docs are valid slugs
- Hub tables reference all sub-documents
- Cross-layer reference validation

### Wave 3: Upstream (network, opt-in)

#### Layer 1 — Deterministic ($0)
Runs `validate_upstream` assertions from doc frontmatter:
- `api_present` — API name must exist in upstream content
- `api_absent` — API name must NOT exist
- `keyword_absent` — keyword must not appear near qualifier
- `keyword_present` — keyword MUST appear
- `pattern_match` — regex match
- `deprecation_scan` — scan for deprecation keywords near APIs

#### Layer 2 — Semantic (LLM, ~$0.03/doc, --profile deep only)
When Layer 1 detects content change, sends pattern doc + upstream to LLM for semantic comparison.

### Wave 4: Readability (opt-in, --with-readability)

Calls `doc-readability` MCP tool on each sub-doc (hub docs excluded).
Reports Flesch reading ease, Flesch-Kincaid grade level, word count, avg sentence length.

Verdict thresholds:
- readable: ease >= 60 (target for technical docs)
- complex: ease 30-59
- very_complex: ease < 30

Does NOT block — informational only. Reports per-file scores.
Skipped gracefully if textstat not installed.

## Behavior

1. Run the `audit-docs` CLI tool with the specified parameters.
2. Display findings grouped by wave and severity.
3. For HIGH/MEDIUM findings, suggest specific remediation actions.
4. Exit with code 1 if any HIGH findings exist.

## Implementation

```bash
# CLI
node mcp-server/build/cli/audit-docs.js --project-root "$(pwd)" --layer L0

# MCP tool
# Use via Claude Desktop or agent: call audit-docs tool with params
```

## Cross-References

- MCP tool: `audit-docs` (programmatic access)
- CLI: `mcp-server/src/cli/audit-docs.ts`
- CI: `.github/workflows/doc-audit.yml` (weekly cron)
- Related: `/monitor-docs` (version drift only), `/full-audit` (code + arch + tests)
- Upstream assertion format: see `docs/guides/doc-template.md` for frontmatter schema
