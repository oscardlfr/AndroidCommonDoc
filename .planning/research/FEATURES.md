# Feature Research

**Domain:** Developer toolkit architecture enforcement, MCP server exposure, and tech debt hardening (v1.1 milestone)
**Researched:** 2026-03-13
**Confidence:** HIGH (Konsist, tech debt), MEDIUM (MCP server, consumer guard tests)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that anyone shipping an architecture enforcement toolkit would expect in a "hardening" milestone. Missing these makes v1.1 feel like an incomplete iteration.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Konsist declaration checks for existing Detekt rule parity** | The 5 existing Detekt rules (sealed UiState, CancellationException rethrow, no platform deps in ViewModel, WhileSubscribed timeout, no Channel UI events) must have Konsist equivalents to prove the approach works and to catch what AST-only Detekt misses at the structural level. | MEDIUM | Konsist reads Kotlin source directly (not bytecode), so it catches patterns that Detekt's AST visitor might miss. Use `Konsist.scopeFromProject()` with JUnit5. Konsist 0.17.3 is latest stable. |
| **Konsist architecture layer checks** | The `assertArchitecture` API is Konsist's flagship capability. Any Konsist adoption without layer checks wastes the library's core value. Must define layers matching the documented architecture (UI, ViewModel, Domain, Data, Model) and enforce dependency direction. | MEDIUM | Use `Layer("Domain", "..domain..")` pattern with `dependsOnNothing()` for Model layer, `dependsOn(domain)` for Data, etc. Layers map directly to PROJECT.md architecture table. |
| **Konsist naming convention checks** | Class naming conventions (ViewModels end in `ViewModel`, UseCases end in `UseCase`, Repositories end in `Repository`) are table stakes for any structural linting toolkit. | LOW | `withNameEndingWith("ViewModel")` + `resideInPackage("..viewmodel..")`. These are the simplest Konsist tests and serve as good entry points. |
| **Tech debt: remove orphaned validate-phase01-*.sh scripts** | 5 orphaned scripts produce noise in quality gate runs. Leaving known dead code in a toolkit that preaches code quality is embarrassing. | LOW | Delete `validate-phase01-agents-md.sh`, `validate-phase01-param-drift.sh`, `validate-phase01-param-manifest.sh`, `validate-phase01-pattern-docs.sh`, `validate-phase01-skill-pipeline.sh`. Verify no other scripts or agents reference them first. |
| **Tech debt: orchestrator delegates to individual agents** | The quality-gate-orchestrator inlines all 4 gate checks (~275 lines of duplicated logic). When individual agents are updated, the orchestrator drifts. This is a known bug documented in PROJECT.md. | MEDIUM | Refactor orchestrator to invoke individual agent files programmatically or use shared function definitions. The orchestrator prompt should orchestrate, not duplicate. |
| **Tech debt: ANDROID_COMMON_DOC env var enforcement** | The convention plugin already errors if missing, but setup scripts do not check or prompt for it. First-time adopters hit a cryptic Gradle error instead of a helpful setup message. | LOW | Add env var check to install scripts (both PS1 and SH). Print clear instructions if missing. Optionally auto-detect from `pwd` during install. |
| **Tech debt: install-copilot-prompts.sh standalone delivery** | The install script does not deliver generated Copilot instructions to the consuming project. Users must manually copy `.github/prompts/` and `.github/instructions/` files. | LOW | Script should copy generated files to the target project's `.github/` directory. Follow same pattern as existing install scripts with `--projects` flag. |

### Differentiators (Competitive Advantage)

Features that set v1.1 apart from typical architecture test suites and create genuine competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Architecture guard test suite for consuming projects** | Ship a reusable Konsist test module that consuming projects (DawSync, WakeTheCave, OmniTrack) can add as a test dependency to enforce architecture rules in THEIR codebase. This is the "give a man a fish vs teach him to fish" of architecture enforcement -- not just rules in the toolkit, but exportable rules for consumers. | HIGH | Two delivery options: (1) Gradle `java-test-fixtures` plugin publishes test utilities alongside the main JAR, consumable via `testFixtures(project(...))`. (2) A dedicated `konsist-guard` module with parameterized test classes that consumers configure with their package prefixes. Option 2 is cleaner for composite builds. |
| **MCP server exposing toolkit capabilities** | Any MCP-compatible AI agent (Claude Code, Cursor, Windsurf, Android Studio Gemini) can programmatically query pattern docs, run architecture validation, and get structured results. This turns a static documentation toolkit into a live knowledge server. | HIGH | Use the official Kotlin MCP SDK (`io.modelcontextprotocol:kotlin-sdk-server` v0.8.3+). KMP-compatible. Expose as tools (validation commands), resources (pattern docs, skills), and prompts (architecture review templates). Stdio transport for Claude Code integration, Streamable HTTP for broader compatibility. |
| **Konsist checks complementing Detekt (not duplicating)** | Konsist reads Kotlin source text, Detekt visits AST nodes. They catch different things. Konsist excels at cross-file structural checks (e.g., "every class in `..domain..` package has no imports from `..data..`"), while Detekt excels at single-file code quality. Using both creates defense-in-depth. | MEDIUM | Position Konsist for structural/architectural checks and Detekt for code pattern checks. No overlap -- Konsist handles layer boundaries and naming conventions, Detekt handles code-level anti-patterns (missing rethrow, wrong StateFlow config). |
| **Parameterized consumer guard tests** | Consumer projects configure their package root (e.g., `com.wake.thecave`) and get all architecture checks automatically. The guard test suite adapts to each project's namespace without modification. | MEDIUM | Depends on the architecture guard test suite. Use a configuration object or extension function that takes the root package and generates all Layer definitions. Consumers write one test class that delegates to the shared suite. |
| **MCP resources for pattern docs** | Expose each of the 8 pattern docs as MCP resources with `docs://` URI scheme. AI agents can read current pattern documentation without file system access. This is especially valuable for remote/sandboxed agent environments. | LOW | Each doc becomes a `ReadResourceResult` with `text/markdown` mime type. URI pattern: `docs://androidcommondoc/{doc-name}`. Trivial to implement once the MCP server skeleton exists. |
| **MCP tools for validation commands** | Expose existing validation scripts as MCP tools. AI agents can run `/validate-patterns`, `/verify-kmp`, `/sync-versions` programmatically and get structured JSON results instead of terminal output. | MEDIUM | Wrap existing script execution in MCP tool handlers. Parse script output into structured `CallToolResult`. Each of the 16 skills becomes a potential MCP tool. Start with the 4-5 most useful: validate-patterns, verify-kmp, sync-versions, check-doc-freshness, extract-errors. |
| **MCP prompts for architecture review** | Pre-built prompt templates that AI agents can use for code review against the toolkit's patterns. E.g., "Review this ViewModel against AndroidCommonDoc patterns" with full context injection. | LOW | Leverages MCP's `GetPromptResult` with `PromptMessage`. Each prompt template includes the relevant pattern doc as context. Low implementation cost, high agent quality-of-life. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Konsist tests that duplicate Detekt rules exactly** | "Belt and suspenders" -- run the same check in both tools for safety. | Maintenance burden doubles. When a rule needs updating, you must update it in two places with two different APIs. False sense of security (same bugs, different syntax). | Assign each concern to exactly one tool. Konsist owns structural/architectural checks (layer boundaries, naming, package placement). Detekt owns code pattern checks (exception handling, StateFlow config, sealed interfaces). |
| **MCP server with write capabilities** | "Let the AI agent fix violations it finds." | MCP tools with side effects (file writes, git operations) in a documentation toolkit create security and trust concerns. The toolkit is advisory, not autonomous. | Expose read-only tools and validation. Return structured violation reports with fix suggestions. Let the consuming AI agent decide whether and how to apply fixes in its own context. |
| **Runtime Konsist checks (not test-time)** | "Check architecture on every build." | Konsist scans all Kotlin files and parses them from source text. Running on every build adds 10-30 seconds to incremental builds. Architecture rules change rarely; running them on every build is wasteful. | Run Konsist tests as part of the test suite (`./gradlew test`). CI runs them on every PR. Developers run them on demand or pre-commit. This matches how ArchUnit is used in JVM projects. |
| **Consumer guard tests that enforce specific package names** | "Force all consuming projects to use our exact package structure." | Each consuming project has its own package namespace (`com.wake.thecave`, `com.grinx.dawsync`, etc.). Hard-coding package names makes the guard suite useless outside one project. | Parameterized guard tests that accept a root package config. The architecture rules are about relative structure (domain does not depend on data), not absolute package names. |
| **MCP server as a standalone deployed service** | "Deploy the MCP server to a cloud endpoint for team-wide access." | Adds infrastructure management (hosting, auth, updates, monitoring) to what is a solo-developer documentation toolkit. The server would need to serve files from a specific checkout. | Stdio transport for local use (Claude Code runs it as a subprocess). If broader access is needed later, add Streamable HTTP transport that runs locally alongside the dev environment. No cloud deployment. |
| **Konsist tests for consuming project business logic** | "Check that DawSync's audio pipeline follows certain patterns." | Violates the "no business logic from consuming apps" constraint in PROJECT.md. Makes the toolkit project-specific. | Guard tests enforce architectural boundaries only (layer dependencies, naming conventions, structural rules). Business logic correctness is the consuming project's responsibility. |
| **Custom Konsist rule DSL / framework** | "Build an abstraction on top of Konsist's API for easier rule authoring." | Konsist's API is already fluent and well-designed. Adding an abstraction layer creates indirection, a learning curve for contributors, and coupling to a custom DSL that may not track Konsist API changes. | Use Konsist's API directly. Write clear, well-documented test classes with descriptive test names. The API is the DSL. |

## Feature Dependencies

```
Konsist Architecture Tests (internal to toolkit)
    |
    +-- Konsist declaration checks (naming, package placement)
    |     Depends on: Konsist library dependency in detekt-rules module or new module
    |
    +-- Konsist layer checks (assertArchitecture)
    |     Depends on: Layer definitions matching docs/kmp-architecture.md
    |
    +-- Konsist integration with convention plugin
          Depends on: Convention plugin already exists (DONE)

Architecture Guard Test Suite (for consumers)
    |
    +-- Parameterized guard test base classes
    |     Depends on: Konsist architecture tests (proven patterns internally first)
    |
    +-- Guard test module publishable via composite build
    |     Depends on: Parameterized base classes + Gradle test-fixtures or dedicated module
    |
    +-- Consumer adoption scripts/docs
          Depends on: Guard test module working end-to-end

MCP Server
    |
    +-- Server skeleton (transport, capabilities registration)
    |     Depends on: Kotlin MCP SDK (io.modelcontextprotocol:kotlin-sdk-server)
    |
    +-- Resources (pattern docs exposure)
    |     Depends on: Server skeleton + docs/ directory access
    |
    +-- Tools (validation command execution)
    |     Depends on: Server skeleton + existing scripts in scripts/sh/
    |
    +-- Prompts (architecture review templates)
          Depends on: Server skeleton + pattern docs loaded as context

Tech Debt Cleanup
    |
    +-- Remove orphaned scripts
    |     Depends on: Nothing (standalone)
    |
    +-- Orchestrator refactor
    |     Depends on: Individual agent files unchanged (they become the source of truth)
    |
    +-- ANDROID_COMMON_DOC enforcement
    |     Depends on: Install scripts (scripts/sh/lib/, scripts/ps1/lib/)
    |
    +-- install-copilot-prompts.sh fix
          Depends on: setup/ directory templates being current
```

### Dependency Notes

- **Konsist tests before consumer guard tests:** Must prove Konsist patterns work internally before shipping reusable test suites. Internal tests serve as the reference implementation.
- **MCP server is independent of Konsist:** These two feature tracks can be built in parallel with no dependencies between them.
- **Tech debt is independent of everything:** Can be tackled first as a warm-up phase or interleaved with feature work. Removing orphaned scripts and fixing install gaps are low-risk wins.
- **MCP tools depend on existing scripts:** The MCP server wraps existing functionality, so it naturally comes after the validation infrastructure is stable. But v1.0 scripts are already stable.
- **Consumer guard tests require the Konsist module structure decision:** Whether to use `java-test-fixtures` in the existing `detekt-rules` module or create a new `konsist-guard` module affects how consumers depend on it.

## MVP Definition

### Launch With (v1.1 core)

Minimum set of features that justify a v1.1 release.

- [ ] **Konsist architecture layer checks** -- Define 5 layers (UI, ViewModel, Domain, Data, Model) and enforce dependency direction. This is the flagship Konsist feature and validates the entire approach.
- [ ] **Konsist declaration checks for naming** -- ViewModels, UseCases, Repositories must follow naming conventions and reside in correct packages. Quick wins that demonstrate Konsist value.
- [ ] **Konsist checks complementing Detekt** -- At least 3 checks that Detekt cannot do: cross-file dependency direction, package-based layer enforcement, structural naming validation across modules.
- [ ] **Tech debt: remove orphaned scripts** -- Clean up the 5 `validate-phase01-*.sh` scripts. Zero risk, immediate noise reduction.
- [ ] **Tech debt: orchestrator delegates to agents** -- Fix the orchestrator drift bug. The orchestrator should reference individual agents rather than inlining their logic.
- [ ] **Tech debt: ANDROID_COMMON_DOC env var check in setup** -- Fail fast with clear instructions instead of a cryptic Gradle error.
- [ ] **Tech debt: install-copilot-prompts.sh delivers files** -- Complete the install pipeline so Copilot adoption is friction-free.

### Add After Validation (v1.1 extended)

Features to add once Konsist tests are proven and the tech debt is cleaned.

- [ ] **Architecture guard test suite for consumers** -- Trigger: internal Konsist tests are stable and cover all documented architecture rules. Ship parameterized test classes that consuming projects configure with their package root.
- [ ] **MCP server skeleton with resources** -- Trigger: demand from AI agent workflows or adoption by a second consuming project. Start with pattern doc resources (read-only, low risk).
- [ ] **MCP tools for top 5 validation commands** -- Trigger: MCP server skeleton is working. Wrap validate-patterns, verify-kmp, sync-versions, check-doc-freshness, extract-errors.

### Future Consideration (v1.2+)

Features to defer until v1.1 is shipped and adopted.

- [ ] **MCP prompts for architecture review** -- Defer until MCP resources and tools are validated in real workflows.
- [ ] **Consumer guard test convention plugin integration** -- Defer until consumers are actually using guard tests. A `konsistGuard { rootPackage = "com.wake.thecave" }` DSL would be nice but is premature.
- [ ] **MCP Streamable HTTP transport** -- Defer until local stdio transport proves the concept. HTTP adds deployment complexity.
- [ ] **Konsist checks for Compose-specific patterns** -- Defer because compose-rules (io.nlopez.compose.rules) already covers Compose via Detekt. Konsist should not duplicate this.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Konsist architecture layer checks | HIGH | MEDIUM | P1 |
| Konsist declaration checks (naming) | HIGH | LOW | P1 |
| Tech debt: remove orphaned scripts | MEDIUM | LOW | P1 |
| Tech debt: orchestrator refactor | MEDIUM | MEDIUM | P1 |
| Tech debt: env var enforcement | MEDIUM | LOW | P1 |
| Tech debt: install-copilot fix | MEDIUM | LOW | P1 |
| Konsist complementary checks (cross-file) | HIGH | MEDIUM | P1 |
| Architecture guard test suite (consumers) | HIGH | HIGH | P2 |
| Parameterized consumer guard tests | HIGH | MEDIUM | P2 |
| MCP server skeleton + resources | MEDIUM | HIGH | P2 |
| MCP validation tools | MEDIUM | MEDIUM | P2 |
| MCP architecture review prompts | LOW | LOW | P3 |
| MCP Streamable HTTP transport | LOW | MEDIUM | P3 |
| Konsist Compose-specific checks | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.1 launch -- architecture enforcement and debt cleanup
- P2: Should have, add when P1 is stable -- consumer adoption and MCP exposure
- P3: Nice to have, future consideration -- extended MCP and niche checks

## Competitor Feature Analysis

| Feature | ArchUnit (JVM) | Konsist | NowInAndroid lint module | Our Approach |
|---------|----------------|---------|--------------------------|--------------|
| Layer dependency enforcement | Yes (bytecode-based, Java-centric) | Yes (Kotlin source-based, KMP-native) | No (single-file lint rules only) | Konsist for layers, Detekt for code patterns |
| Naming convention checks | Yes (but requires Java bytecode knowledge) | Yes (Kotlin-native API, intuitive) | Partial (Detekt rules) | Konsist for naming, Detekt for anti-patterns |
| KMP multiplatform support | No (Java bytecode only, no JS/Native) | Yes (reads Kotlin source, platform-agnostic) | No (Android-only) | Konsist is the only option for KMP |
| Reusable test suites for consumers | Partial (shared test JARs) | Yes (scope + architecture variables) | No (copy/paste rules) | Parameterized guard tests via composite build |
| MCP server exposure | No | No | No | Unique differentiator -- expose patterns and validation as MCP tools |
| Integration with AI agents | No | No | No | MCP server + Claude Code hooks + existing skills |
| Custom Detekt rules | N/A | N/A | Yes (separate module) | Already have 5 rules in detekt-rules module |

## Konsist Feature Details

### Konsist API Overview (v0.17.3)

**Scope creation:**
- `Konsist.scopeFromProject()` -- all Kotlin files in project
- `Konsist.scopeFromModule("moduleName")` -- specific module
- `Konsist.scopeFromDirectory("path")` -- specific directory
- `Konsist.scopeFromProduction()` / `Konsist.scopeFromTest()` -- filter by source set
- Scopes can be combined with `+` or subtracted with `-`

**Declaration checks (3-step):**
1. Create scope
2. Query/filter declarations (`.classes()`, `.functions()`, `.properties()`)
3. Assert (`.assertTrue { }`, `.assertFalse { }`)

**Architecture checks (4-step):**
1. Create scope
2. Define layers with `Layer("Name", "..package..")`
3. Define dependencies (`dependsOn()`, `dependsOnNothing()`, `doesNotDependOn()`)
4. Assert with `assertArchitecture { }`

**Reusable architecture definitions:**
```kotlin
val architecture = architecture {
    val domain = Layer("Domain", "..domain..")
    val data = Layer("Data", "..data..")
    domain.dependsOnNothing()
    data.dependsOn(domain)
}
// Reuse across multiple scopes
scope1.assertArchitecture(architecture)
scope2.assertArchitecture(architecture)
```

**Dependency strictness:**
- `dependsOn(layer)` -- optional (layer MAY depend on target), default
- `dependsOn(layer, strict = true)` -- required (layer MUST depend on target)

### Architecture Layers for This Project

Based on the architecture in CLAUDE.md and the existing pattern docs:

| Layer | Package Pattern | Dependencies |
|-------|----------------|--------------|
| UI | `..ui..` | ViewModel |
| ViewModel | `..viewmodel..` (or `..presentation..`) | Domain (UseCases) |
| Domain | `..domain..` | Model |
| Data | `..data..` | Domain + Platform |
| Model | `..model..` | Nothing |

## MCP Server Feature Details

### MCP Kotlin SDK (v0.8.3+)

**Three capability types:**
- **Resources:** Read-only data exposed via stable URIs. Pattern docs, skill definitions, version manifests.
- **Tools:** Executable functions. Validation commands, architecture checks, version sync.
- **Prompts:** Reusable prompt templates with arguments. Architecture review, pattern compliance check.

**Transport options:**
- **Stdio:** Best for Claude Code integration (subprocess model). Lowest friction.
- **Streamable HTTP:** Best for broader agent compatibility. Requires Ktor server.
- **SSE:** Server-sent events for one-way streaming. Less useful for this use case.
- **WebSocket:** Bidirectional. Overkill for a documentation toolkit.

**Recommended transport:** Start with Stdio for Claude Code, add Streamable HTTP later if needed.

**Dependencies:**
```kotlin
implementation("io.modelcontextprotocol:kotlin-sdk-server:0.8.3")
implementation("io.ktor:ktor-server-cio:<ktor-version>")  // only if using HTTP transport
```

### Proposed MCP Resources

| URI | Name | Content |
|-----|------|---------|
| `docs://androidcommondoc/viewmodel-state-patterns` | ViewModel State Patterns | docs/viewmodel-state-patterns.md |
| `docs://androidcommondoc/testing-patterns` | Testing Patterns | docs/testing-patterns.md |
| `docs://androidcommondoc/kmp-architecture` | KMP Architecture | docs/kmp-architecture.md |
| `docs://androidcommondoc/gradle-patterns` | Gradle Patterns | docs/gradle-patterns.md |
| `docs://androidcommondoc/ui-screen-patterns` | UI Screen Patterns | docs/ui-screen-patterns.md |
| `docs://androidcommondoc/offline-first-patterns` | Offline-First Patterns | docs/offline-first-patterns.md |
| `docs://androidcommondoc/compose-resources-patterns` | Compose Resources | docs/compose-resources-patterns.md |
| `docs://androidcommondoc/resource-management-patterns` | Resource Management | docs/resource-management-patterns.md |
| `versions://androidcommondoc/manifest` | Version Manifest | versions-manifest.json |

### Proposed MCP Tools

| Tool Name | Description | Backing Script |
|-----------|-------------|----------------|
| `validate-patterns` | Validate codebase against documented patterns | scripts/sh/validate-phase03-build-logic.sh (or validate-patterns equivalent) |
| `verify-kmp` | Verify KMP source set structure and imports | scripts/sh/verify-kmp-packages.sh |
| `sync-versions` | Check version catalog alignment | scripts/sh/check-version-sync.sh |
| `check-freshness` | Detect stale version references in docs | scripts/sh/check-doc-freshness.sh |
| `extract-errors` | Extract and categorize build errors | scripts/sh/ai-error-extractor.sh |

## Sources

- [Konsist Official Documentation](https://docs.konsist.lemonappdev.com/)
- [Konsist GitHub Repository](https://github.com/LemonAppDev/konsist)
- [Konsist Architecture Assertion Docs](https://docs.konsist.lemonappdev.com/writing-tests/architecture-assert)
- [Konsist KoScope Docs](https://docs.konsist.lemonappdev.com/writing-tests/koscope)
- [Konsist Releases (v0.17.3 latest)](https://github.com/LemonAppDev/konsist/releases)
- [ArchUnit vs Konsist Comparison (ProAndroidDev)](https://proandroiddev.com/archunit-vs-konsist-why-did-we-need-another-linter-972c4ff2622d)
- [ArchUnit vs Konsist in Android Codebase (The House Of Code)](https://medium.com/the-house-of-code/archunit-vs-konsist-in-android-kotlin-oriented-codebase-b72c6c698b0b)
- [Konsist for KMP Projects (Lahiru Jayawickrama)](https://medium.com/@lahirujay/konsist-protect-kotlin-multiplatform-projects-from-architecture-guidelines-violations-d88db0614cbd)
- [Mercedes-Benz.io: Konsist Game-Changer](https://www.mercedes-benz.io/blog/2024-10-31-konsist-the-game-changer-your-kotlin-project-needs)
- [MCP Official Kotlin SDK](https://github.com/modelcontextprotocol/kotlin-sdk)
- [MCP Kotlin SDK Documentation](https://modelcontextprotocol.github.io/kotlin-sdk/)
- [MCP Specification - Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Build Server Guide](https://modelcontextprotocol.io/docs/develop/build-server)
- [MCP 2026 Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [Kotlin MCP + KMP (John O'Reilly)](https://johnoreilly.dev/posts/kotlin-mcp-kmp/)
- [What Makes an MCP Server Successful (Hands-on Architects)](https://handsonarchitects.com/blog/2026/what-makes-mcp-server-successful/)
- [MCP SDK Comparison (Stainless)](https://www.stainless.com/mcp/mcp-sdk-comparison-python-vs-typescript-vs-go-implementations)

---
*Feature research for: AndroidCommonDoc v1.1 Hardening & Intelligence*
*Researched: 2026-03-13*
