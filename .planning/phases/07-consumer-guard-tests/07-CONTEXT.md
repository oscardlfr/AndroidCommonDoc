# Phase 7: Consumer Guard Tests - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Distribute parameterized architecture enforcement templates to consuming projects so they can adopt 5-layer architecture guard tests with a single install command. Covers GUARD-01, GUARD-02, GUARD-03. Templates are opt-in — consumers choose to install, Konsist is not mandatory.

</domain>

<decisions>
## Implementation Decisions

### Template scope & rules
- Full suite: layer dependency checks + naming conventions + package placement + module isolation — mirrors everything Phase 6 built internally
- All checks parameterized on consumer's root package (e.g., `com.wake.thecave`, `com.dawsync`)
- Every template includes canary assertion confirming scope is non-empty (prevents vacuous passes on empty/misconfigured scope)
- Handle missing layers gracefully — skip layers that don't have files rather than failing (clean enterprise approach for projects of varying size)

### Install script UX
- CLI flag for root package: `bash install-guard-tests.sh --package com.dawsync` (consistent with existing --dry-run/--force/--projects pattern)
- Both SH + PS1 counterparts (follows cross-platform scripts constraint from Phase 5)
- Script lives in `setup/install-guard-tests.sh` (and `.ps1`)

### Consumer module setup
- Konsist adoption is opt-in — guard tests are an optional offering, not forced on consumers
- Dependencies handled via generated build.gradle.kts with pinned versions (zero manual editing per success criteria)

### Validation targets
- **DawSync** (`C:\Users\34645\AndroidStudioProjects\DawSync`): Full architecture scan — install templates, run all guard tests against real code
- **OmniSound** (`C:\Users\34645\AndroidStudioProjects\OmniSound`): Canary pass only — install templates, verify compile + non-empty scope assertions pass
- If DawSync scan finds real architecture violations: report to user (they fix in track-E terminal), do NOT fix in this phase
- Validate in DawSync worktree as well

### Claude's Discretion
- Whether to use ScopeFactory pattern (like Phase 6) or self-contained tests — pick based on maintainability vs install simplicity
- Consumer module location (standalone konsist-guard/ module vs other approach) — pick based on Phase 6 isolation strategy
- Dependency approach (pinned versions vs consumer catalog) — pick what requires zero manual editing
- Scan scope (configurable modules vs whole project) — pick what works cleanly in multi-module KMP projects
- Idempotency strategy (skip existing with --force override vs always overwrite) — follow existing install script pattern
- Violation message style (generic guidance vs linking to pattern docs) — pick based on coupling vs DX tradeoff

</decisions>

<specifics>
## Specific Ideas

- User consistently wants "the cleanest, most professional, solid, clean enterprise approach" — same direction as Phase 5 and Phase 6
- Konsist is NOT mandatory — the toolkit cannot force consumers to use any plugin
- WakeTheCave is NOT the validation target (outdated) — use DawSync (most updated) and OmniSound (stable)
- User has a parallel track-E terminal for DawSync fixes — report violations, don't fix them here

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `konsist-tests/` module: Proven JVM-only Konsist module pattern (build.gradle.kts, settings.gradle.kts, ScopeFactory.kt)
- `ScopeFactory.kt`: Canary assertions, relative path resolution, Windows path handling — template for consumer's scope factory
- `ArchitectureTest.kt`: 5-layer architecture enforcement with `with(KoArchitectureCreator)` pattern — source for guard templates
- `NamingConventionTest.kt`, `PackageConventionTest.kt`: Naming and package checks — source for additional guard templates
- `install-hooks.sh`: Established install script pattern (set -euo pipefail, colored logging, --dry-run/--force/--projects flags, summary report)

### Established Patterns
- Token substitution decided during roadmap: `.kt.template` files with placeholder replacement (e.g., `__ROOT_PACKAGE__` → `com.dawsync`)
- JVM-only module isolation: `kotlin("jvm")` only, no Detekt plugin, `outputs.upToDateWhen { false }`
- Relative paths for Konsist scopeFromDirectory (absolute paths cause duplication on Windows)
- `require()` canary assertions before every scope usage

### Integration Points
- `setup/install-guard-tests.sh` + `.ps1`: New install script pair
- Guard templates stored in toolkit (e.g., `guard-templates/` or similar)
- Consumer's `settings.gradle.kts`: Needs `include(":konsist-guard")` or equivalent
- Composite build: Consumer uses `includeBuild("../AndroidCommonDoc")` — guard module lives in consumer, not toolkit

</code_context>

<deferred>
## Deferred Ideas

- Consumer guard test convention plugin integration (`konsistGuard { rootPackage = "..." }` DSL) — tracked as MCPX-02 in future requirements
- WakeTheCave validation — project is outdated, defer until it's updated

</deferred>

---

*Phase: 07-consumer-guard-tests*
*Context gathered: 2026-03-13*
