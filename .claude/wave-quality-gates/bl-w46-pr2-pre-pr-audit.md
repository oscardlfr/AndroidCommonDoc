---
wave: BL-W46
pr: PR2
branch: bl-w46-pr2-mcp-shell-frontmatter
auditor: toolkit-specialist
swept_at: 2026-05-08
---

# BL-W46 PR2 Pre-PR Audit

## Active Fixes (this PR)

### L-03 — "network" in APPROVED_CATEGORIES
- **File**: `mcp-server/src/tools/validate-doc-structure.ts:51`
- **Before**: set ended at `"ui"`
- **After**: `"network"` added before `"ui"`
- **Verify**: `node -e "const {APPROVED_CATEGORIES}=require('./mcp-server/build/tools/validate-doc-structure.js'); console.log(APPROVED_CATEGORIES.has('network'))"`
- **Status**: DONE

### H-01 — ps1 + CI kmp-test-runner v0.7.0 → v0.8.1
- **Files**: `scripts/ps1/run-changed-modules-tests.ps1`, `scripts/ps1/run-parallel-coverage-suite.ps1`, `.github/workflows/reusable-shell-tests.yml`
- **Initial commit**: bumped `v0.7.0` (synopsis + deprecation warning) — missed `@0.7.0` npm tag format in runtime npx invocation + install error string (4 lines)
- **Fix-forward (5th commit)**: bumped remaining 4 `@0.7.0` → `@0.8.1` in ps1 files; bats OR assertion tautology fixed to AND
- **Scope expansion (6th commit)**: `.github/workflows/reusable-shell-tests.yml:19` — same root cause; folded per user direction
- **Verify**: 0 matches for `kmp-test-runner@0.7.0` across .github/workflows/, scripts/ps1/, scripts/sh/
- **Status**: DONE

### Deferred-3 — Shell parity: backtick strip in get_body_no_fences()
- **File**: `scripts/sh/validate-agent-templates.sh`
- **Before**: `get_body_no_fences()` stripped fenced blocks only — inline `` `Agent()` `` would survive and trigger false-positive xref WARN
- **After**: `echo "$body" | sed 's/\`[^\`]*\`//g'` applied after fence strip — mirrors `validate-agents.ts:stripCodeFences()` (lines 99-102) exactly
- **Bats test added**: `scripts/tests/validate-agent-templates.bats` — "Check 4: backtick-wrapped Agent() in body does NOT trigger xref WARN"
- **Status**: DONE

### README bats count
- **File**: `README.md:1131`
- **Before**: 1078 tests
- **After**: 1079 tests (+1 Deferred-3 backtick test)
- **Verified**: `bats --count scripts/tests/` = 1079
- **Status**: DONE

### L-08 — feature-domain-specialist tools: gap (SendMessage)
- **Files**: `setup/agent-templates/MIGRATIONS.json`, `.claude/registry/agents.manifest.yaml`, `setup/agent-templates/feature-domain-specialist.md`, `.claude/agents/feature-domain-specialist.md`
- **Gap**: body uses `SendMessage(to="your-architect", ...)` at L21 as directive; tools: had `Read, Grep, Glob, Bash`; SendMessage was in banned list
- **Fix**: MIGRATIONS.json 1.2.0 entry added first; manifest updated (SendMessage banned→allowed, version 1.1.0→1.2.0, can_send_to: [your-architect]); `generate-template.js --update-manifest-hash` regenerated both template+mirror, SHA: f971931f→62c1b4ba
- **Status**: DONE

## Closed as Already-Fixed (BL-W45 PR2 or prior work)

| Finding | Evidence |
|---------|----------|
| **M-01** validate-agents.ts err string | `validate-agents.ts:325` — `MAX_LINES = 425`; error string uses `${MAX_LINES}` template literal. No "limit: 400" string exists. |
| **L-01** validate-agents.ts JSDoc | JSDoc updated in prior wave; line 10 matches `≤425`. |
| **M-02** arch-integration.md off-by-one | `wc -l .claude/agents/arch-integration.md` = 425. AT cap, no comment to fix. |
| **L-08 (context-provider, doc-updater, planner)** | arch-platform confirmed SendMessage already in tools: for all three. Only feature-domain-specialist had a gap (fixed above). |

## doc-updater scope (separate commit, same branch)
- **L-07**: 9 frontmatter gaps in `docs/guides/getting-started/*.md`

## Test Results

| Suite | Result |
|-------|--------|
| `cd mcp-server && npm run build` | PASS (clean compile) |
| `cd mcp-server && npm test` (vitest) | PASS (2538/2538) |
| `bats scripts/tests/validate-agent-templates.bats` | PASS (5/5) |
| `bash scripts/sh/validate-agent-templates.sh` | ALL PASS (78 files, 7 checks, 0 WARNs) |
