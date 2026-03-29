---
scope: [workflow, ai-agents, quality, verification]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: quality-gate-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "Quality gate protocol: sequential verification (frontmatter → tests → coverage → benchmarks → pre-pr) after architect APPROVE, before commit"
version: 2
last_updated: "2026-03"
assumes_read: autonomous-multi-agent-workflow, context-rotation-guide
token_budget: 1500
---

# Quality Gate Protocol

Sequential verification that runs AFTER all 3 architects APPROVE and BEFORE commit. Each step blocks — failures must be investigated, not bypassed.

---

## When This Runs

```
Architects detect → PM dispatches devs → devs implement → architects verify
  ↓
All 3 architects: APPROVE
  ↓
Quality Gate (this protocol)
  ↓
All pass → commit
Any fail → investigate → fix → re-run
```

---

## Gate Steps (sequential, each blocks)

### Step 0: Frontmatter Validation
- `validate-doc-structure` on all docs/ files
- Required: scope, sources, targets, slug, status, layer, category, description
- **BLOCK** if any doc missing required fields
- **Why**: Docs without frontmatter are invisible to context-provider's MCP tools

### Step 0.5: Code Documentation Coverage
- `kdoc-coverage` MCP tool with `changed_files` from `git diff $BASE...HEAD | grep '\.kt$'`
- **BLOCK** if any new/modified public API lacks KDoc
- **WARN** (no block) if module-wide coverage < 80%
- **Why**: Undocumented APIs cause drift — context-provider can't surface what isn't documented
- See also: `/kdoc-audit`, `doc-alignment-agent` (continuous drift detection)

### Step 1: Full Test Suite
- `/test-full-parallel --fresh-daemon`
- ALL modules must pass
- No "pre-existing failure" exceptions
- **BLOCK** on any failure

### Step 2: Coverage Baseline
- `/coverage` on touched modules
- Compare with baseline
- **Drop ≤1%**: Document reason, proceed
- **Drop >1%**: INVESTIGATE (see Coverage Investigation Protocol)
- **BLOCK** until investigation complete

### Step 3: Benchmarks (conditional)
- `/benchmark` if performance-sensitive changes
- Compare with baseline
- **Regression >10%**: INVESTIGATE
- Skip if no performance-relevant code changed

### Step 4: Pre-PR
- `/pre-pr` — commit-lint + architecture guards + lint
- Must pass
- **BLOCK** on any failure

### Step 5: Compose UI Tests (MANDATORY for UI changes)
- If any Compose/UI code changed: verify Compose tests EXIST for every modified screen
- Tests must assert: component renders, correct items, selection behavior, scroll visible
- TDD enforced: failing Compose test first (RED), then fix (GREEN)
- **BLOCK** if Compose tests missing or failing
- Claude Code cannot visually inspect apps — all verification via automated Compose tests

---

## Coverage Investigation Protocol

When coverage drops >1% on any module:

1. **DO NOT add tests to fill the gap** — that's gaming
2. **INVESTIGATE root cause**:
   - New code not covered → Is it testable? If not, WHY? (coupling? side effects?)
   - Deleted tests → Were they valid? Why deleted?
   - Code moved → Coverage moved, not dropped (false alarm)
3. **If code is not testable → not SOLID**:
   - Too many dependencies → Extract interface
   - Side effects in constructor → Dependency injection
   - God class → Single Responsibility violation
4. **Fix root cause** (refactor), THEN write quality tests
5. **Document** investigation in commit message

---

## Test Gaming Detection

Anti-patterns that indicate test gaming (quantity over quality):

| Pattern | Why it's gaming |
|---------|----------------|
| `assertEquals(X, X)` | Trivial — always passes |
| `assertTrue(true)` | No-op — tests nothing |
| `assertNotNull(...)` alone | Existence check, not behavior |
| 1 assertion per test class | Minimum effort coverage |
| Mock-only verification | Tests the test, not the code |
| `@Ignore` with no ticket | Silenced failure |

arch-testing detects these via grep on new/modified test files.

---

## Agent Template

The `quality-gater` agent template (`setup/agent-templates/quality-gater.md`) implements this protocol as a team peer in the Quality Gate Team. It runs alongside context-provider after all architects APPROVE.

Distinct from `quality-gate-orchestrator` (L0 internal validator for toolkit consistency — script-parity, template-sync).

## Related Docs

- [Team Topology](team-topology.md) — 3-phase model where Quality Gate is Phase 3
- [Multi-Agent Patterns](multi-agent-patterns.md) — orchestration and architect gates
- [Context Rotation Guide](context-rotation-guide.md) — context management for long sessions
- [Claude Code Workflow](claude-code-workflow.md) — single-agent patterns
