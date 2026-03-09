# Phase 6: Konsist Internal Tests - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate the toolkit's own Kotlin sources with structural Konsist tests that run reliably alongside Kotlin 2.3.10 and Detekt 2.0.0-alpha.2. Covers KONS-01 through KONS-05. Guard test templates for consuming projects are Phase 7 (not this phase).

</domain>

<decisions>
## Implementation Decisions

### Test classes in scope
- **DetektRuleStructureTest** — Rules follow naming conventions, have companion test classes, implement RuleSetProvider. Also validates provider completeness: every `*Rule` class in the rules package is registered in the RuleSetProvider (catches forgotten registrations).
- **ScriptParityTest** — PS1/SH pairs exist for each user-facing script. Filesystem check, not Kotlin AST.
- **SkillStructureTest** — SKILL.md files have required frontmatter sections. Filesystem/markdown validation.
- **PackageConventionTest** — Packages match module names (e.g., classes in `detekt-rules` use `com.androidcommondoc.detekt`).
- **NamingConventionTest** — Class suffixes match package expectations (e.g., `*Rule` in detekt package, `*Extension` in build-logic).

### Test style for non-Kotlin checks
- Claude's discretion: ScriptParity and SkillStructure may use Konsist's file scanning API or plain JUnit filesystem checks, whichever is cleanest per test.

### Architecture checks approach
- Claude decides the best clean, solid, enterprise, professional approach for demonstrating 5-layer architecture enforcement
- Enforce toolkit's own module isolation: detekt-rules code must never import build-logic code (and vice versa)
- Test fixtures with intentional violations live in `src/test/resources/fixtures/` — Konsist scans them via `scopeFromDirectory()`
- Violation messages must be actionable: name the offending file, the violated rule, AND remediation guidance (e.g., "Move FooManager to domain package and rename to FooRepository")

### Cross-file structural checks (≥3 required, 4 selected)
1. **Layer import violations** — Both test fixtures (proves 5-layer detection works) AND real toolkit code (proves detekt-rules and build-logic stay isolated)
2. **Package placement** — Classes in wrong packages detected (Detekt single-file analysis can't know which package a class "should" be in)
3. **Provider registration sync** — Every `*Rule` class is registered in the RuleSetProvider (cross-file: provider file must reference all rule files)
4. **Test coverage structure** — 1:1 test-per-class enforcement: every production Kotlin class in detekt-rules must have a matching `*Test` class

### Classpath conflict strategy
- Start with isolated JVM module (`konsist-tests/`) with Konsist 0.17.3
- Claude decides fallback approach if classpath conflict arises (version forcing, separate Gradle build, Kotlin version pin in module) — should not force the user into any particular workaround
- Claude decides whether to spike classpath compatibility first or write tests optimistically — risk assessment at Claude's discretion

### Module configuration (carried forward from research)
- `konsist-tests/` as standalone JVM-only module with `kotlin("jvm")` only — no Detekt plugin, no convention plugin
- `outputs.upToDateWhen { false }` on test task — tests re-run every invocation (KONS-05)
- `scopeFromModule()` or `scopeFromDirectory()` for precise scoping — avoid `scopeFromProject()` in composite builds
- Canary assertions in every test to prevent vacuous passes on empty scope

### Claude's Discretion
- Whether ScriptParity/SkillStructure use Konsist file API or plain JUnit
- Architecture enforcement approach: fixture design, real code validation strategy
- Classpath conflict resolution strategy and whether to spike first
- Separate Gradle build complexity trade-off if needed
- Test organization (by concern vs by module scanned)

</decisions>

<specifics>
## Specific Ideas

- User wants "the cleanest, most professional, solid, clean enterprise approach" — consistent with Phase 5 direction
- Actionable violation messages: developers should fix without searching docs
- Provider completeness check: no forgotten rule registrations
- 1:1 test coverage: no rule ships untested

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `detekt-rules/` module: 5 custom rules + 1 RuleSetProvider, all in `com.androidcommondoc.detekt.rules` package
- `detekt-rules/build.gradle.kts`: Existing JVM-only Kotlin module pattern (kotlin("jvm") version "2.3.10") — serves as template for konsist-tests module
- Existing test infrastructure: JUnit5 + AssertJ in detekt-rules tests

### Established Patterns
- Standalone module with own `settings.gradle.kts` (rootProject.name = "detekt-rules") — konsist-tests should follow same pattern
- Detekt rules use `compileOnly("dev.detekt:detekt-api:2.0.0-alpha.2")` — Konsist similarly uses `testImplementation` only
- Scripts in `scripts/sh/` and `scripts/ps1/` — ScriptParity test scans these directories
- Skills in `skills/*/SKILL.md` — SkillStructure test scans these files

### Integration Points
- `detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/` — primary scan target for Konsist structural tests
- `build-logic/src/main/kotlin/` — secondary scan target for module isolation checks
- No existing `konsist-tests/` directory — module created from scratch

</code_context>

<deferred>
## Deferred Ideas

- **Conventional Commits enforcement** — Git `commit-msg` hook validating commit messages follow [Conventional Commits spec](https://www.conventionalcommits.org/en/v1.0.0/#specification). Not a Konsist concern (git hooks/CI). → New Phase 9
- **Gitflow workflow validation** — Branch naming rules and workflow enforcement following [Gitflow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow). Not a Konsist concern (git hooks/CI). → New Phase 9

</deferred>

---

*Phase: 06-konsist-internal-tests*
*Context gathered: 2026-03-13*
