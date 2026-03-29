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

## Gate Steps (dynamic — quality-gater discovers rules at runtime)

The quality-gater does NOT use a hardcoded checklist. It discovers each project's rules by reading CLAUDE.md, asking context-provider, and running `/pre-pr` (the project's own validation pipeline).

### Step 1: Project Rule Discovery
- Read CLAUDE.md → extract hard rules, constraints, patterns
- Ask context-provider for active Detekt rules and enforcement patterns
- Build project-specific verification checklist

### Step 2: Full Validation Pipeline (`/pre-pr`)
- **PRIMARY enforcement step** — runs Detekt, lint-resources, commit-lint, architecture guards
- All checks are project-configured, not hardcoded
- **BLOCK** on any failure

### Step 3: Test Suite
- `/test-full-parallel --fresh-daemon` — all modules must pass
- **BLOCK** on any failure

### Step 4: Coverage Baseline
- `/coverage` on touched modules — drop >1% → INVESTIGATE → **BLOCK**

### Step 5: KDoc Coverage (if .kt files changed)
- `kdoc-coverage` CLI on changed files
- **BLOCK** if new public APIs lack KDoc

### Step 6: Production File Verification
- `git diff --stat` — **BLOCK** if only test files modified on code tasks (test gaming)

### Step 7: Project Rule Cross-Check
- For EACH hard rule from Step 1: verify it was checked by an automated step or manual grep
- **BLOCK** if any rule not verified
- Report: which rules verified, how, result

### Step 8: Compose UI Tests (if UI code changed)
- Verify correct shared components used (not just "something renders")
- Verify no hardcoded strings (must use Compose multiplatform string resources)
- TDD enforced: RED test first, then GREEN
- **BLOCK** if tests missing, failing, or FALSE GREEN

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
