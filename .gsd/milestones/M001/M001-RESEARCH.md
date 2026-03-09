# Project Research Summary

**Project:** AndroidCommonDoc v1.1 — Hardening & Intelligence
**Domain:** Developer toolkit: architecture enforcement, consumer guard tests, MCP server, tech debt cleanup
**Researched:** 2026-03-13
**Confidence:** MEDIUM (Konsist/Kotlin 2.3 compatibility unvalidated; MCP server Windows behavior unvalidated)

## Executive Summary

AndroidCommonDoc v1.1 extends a validated v1.0 toolkit (Detekt rules, convention plugin, quality gate agents, adapter pipeline) with three parallel capability tracks: Konsist architecture tests, consumer-facing guard test templates, and an MCP server that exposes toolkit knowledge to AI agents. Each track is a self-contained addition that plugs into the existing microkernel architecture — none requires restructuring what shipped in v1.0. The recommended build order is tech debt cleanup first (stabilizes the foundation), then Konsist internal tests (validates the approach in isolation), then consumer guard tests (depends on proven Konsist patterns), with the MCP server developed in parallel to the guard tests since it has no Konsist dependency.

The dominant technology decisions are Konsist 0.17.3 for structural architecture testing (the only Kotlin-native option that catches cross-file layer violations that Detekt's single-file AST cannot) and the TypeScript MCP SDK 1.27.1 over the Kotlin SDK 0.9.0 (production-ready vs. pre-1.0, zero build-step deployment via `npx`, better fit for a server that reads files and calls scripts). These two tools are complementary, not overlapping: Konsist handles structural layer enforcement; Detekt handles single-file code pattern enforcement; the MCP server is a thin proxy over existing docs and scripts with no business logic of its own.

The primary risk is the Konsist/Kotlin 2.3 classpath conflict: Konsist 0.17.3 bundles `kotlin-compiler-embeddable:2.0.20` while the project runs Kotlin 2.3.10 and Detekt 2.0.0-alpha.2 — three tools competing for one compiler version. This is mitigated by isolating Konsist in a dedicated `konsist-tests/` JVM-only module and forcing resolution via `resolutionStrategy.force`, but this must be validated in a spike before the full Konsist test suite is written. A secondary risk is the MCP server on Windows: JVM startup, stdout purity (any `println` corrupts the JSON-RPC transport), and absolute path resolution in `.mcp.json` must all be validated on the primary dev platform before release.

## Key Findings

### Recommended Stack

The v1.0 stack (Kotlin 2.3.10, Detekt 2.0.0-alpha.2, Gradle 9.1.0, JUnit Jupiter 5.11.4, Compose Rules 0.5.6, Bash/PS1/Python scripts) is validated and unchanged. v1.1 adds exactly two new technology ecosystems.

**Core technologies added in v1.1:**
- **Konsist 0.17.3**: Kotlin-native structural architecture testing via JUnit5 — only tool that catches cross-file layer violations in KMP projects. Requires isolation in `konsist-tests/` module due to `kotlin-compiler-embeddable` version conflict with Kotlin 2.3.10 KGP + Detekt.
- **@modelcontextprotocol/sdk 1.27.1 (TypeScript)**: MCP server framework — production-ready (v1.27.1 vs Kotlin SDK's v0.9.0), zero build-step deployment via `npx`, stdio transport works with all MCP clients. Chosen over Kotlin SDK because the server reads files and calls scripts (TypeScript's sweet spot) and adds no Ktor/coroutines overhead.
- **Node.js 24.x LTS + TypeScript 5.x + zod 3.x**: Runtime and dependencies for the MCP server. Node 24.x supported through April 2028.
- **Tech debt cleanup**: No new dependencies. Pure Bash/PS1 refactoring within the existing script infrastructure.

Critical version constraint: Konsist 0.17.3 bundling `kotlin-compiler-embeddable:2.0.20` against the project's Kotlin 2.3.10 is UNVALIDATED. A spike in Phase 2 must confirm the isolated module approach resolves this before writing the full test suite.

Note: FEATURES.md recommended the Kotlin MCP SDK; STACK.md overrides this with a detailed rationale for TypeScript. The TypeScript recommendation in STACK.md is correct and should be followed. See "Gaps to Address" below.

### Expected Features

**Must have (table stakes) — v1.1 core:**
- Konsist architecture layer checks (UI/ViewModel/Domain/Data/Model) — flagship Konsist capability; validates the entire approach
- Konsist declaration checks for naming conventions (ViewModel, UseCase, Repository suffixes) — lowest-cost, highest-signal Konsist tests
- Konsist cross-file structural checks complementing Detekt — at least 3 checks Detekt cannot do (layer dependency direction, package-based enforcement, cross-module structural validation)
- Tech debt: remove 5 orphaned `validate-phase01-*.sh` scripts — zero risk, immediate noise reduction (use deprecation-then-removal, not immediate deletion)
- Tech debt: refactor quality-gate-orchestrator to delegate to individual agents — fixes known orchestrator drift bug
- Tech debt: ANDROID_COMMON_DOC env var graceful degradation in convention plugin — replaces cryptic Gradle crash with helpful setup message
- Tech debt: `install-copilot-prompts.sh` standalone delivery of generated files — completes the install pipeline

**Should have — v1.1 extended (after must-haves are stable):**
- Architecture guard test suite for consuming projects (WakeTheCave, DawSync, OmniTrack) — parameterized `.kt.template` files with `{{BASE_PACKAGE}}` substitution installed by setup script
- Parameterized consumer guard tests — single configuration object drives all layer definitions from consumer's package root; canary assertion confirms scope is non-empty
- MCP server skeleton with pattern doc resources — serve all 8 `docs/*.md` as `docs://androidcommondoc/{name}` resources
- MCP tools for top 5 validation commands — wrap existing scripts (`validate-patterns`, `verify-kmp`, `sync-versions`, `check-freshness`, `extract-errors`)

**Defer to v1.2+:**
- MCP architecture review prompts (depends on resources + tools being validated in real workflows)
- MCP Streamable HTTP transport (stdio proves the concept first; HTTP adds deployment complexity)
- Konsist Compose-specific checks (io.nlopez.compose.rules already covers this via Detekt)
- Consumer guard test convention plugin DSL (`konsistGuard { rootPackage = "..." }`) — premature before consumers are actually using guard tests

**Anti-features to actively avoid:**
- Duplicating Detekt rule logic in Konsist (doubles maintenance; assign each concern to exactly one tool)
- MCP server write capabilities (toolkit is advisory, not autonomous)
- Runtime Konsist checks on every build (use test-time execution only)
- Compiling arch-guard templates inside AndroidCommonDoc (distribute as source with `{{BASE_PACKAGE}}` tokens, not bytecode)

### Architecture Approach

The v1.1 architecture follows the existing microkernel + adapter model by adding three parallel extension points, each with a distinct integration boundary. `konsist-tests/` is a terminal JVM-only module that scans the toolkit's own Kotlin sources via Konsist — it validates internally with zero external blast radius. `arch-guard/` is a directory of `.kt.template` files (not a compiled module) that the setup installer copies and substitutes into consuming projects at install time, giving consumers ownership of their tests after installation. `mcp-server/` is a TypeScript Node.js application that acts as a content proxy, reading existing `docs/` and `skills/` files from disk at request time and serving them over stdio transport — it contains no embedded content and requires no rebuild when docs change.

**Major components:**
1. `konsist-tests/` (new module) — JUnit5 tests using Konsist to enforce structural rules within the toolkit itself (Detekt rule naming, script PS1/SH pairing, skill YAML frontmatter, package conventions)
2. `arch-guard/` (new template directory) — Parameterized Konsist test templates for consumers; installed by setup scripts with `{{BASE_PACKAGE}}` and `{{PROJECT_NAME}}` substitution; NOT compiled in AndroidCommonDoc
3. `mcp-server/` (new TypeScript Node.js app) — stdio MCP server exposing pattern docs as resources and validation scripts as tools; launched as subprocess via `.mcp.json`; logs exclusively to stderr
4. `build-logic/` (modified) — Add optional `konsistTests` property to `AndroidCommonDocExtension` for consumers opting into guard test configuration
5. `setup/` scripts (modified) — Extended with `--skip-konsist` and `--skip-mcp` flags, template copy + token substitution logic, and MCP server registration

### Critical Pitfalls

1. **Konsist `kotlin-compiler-embeddable` classpath conflict** — Konsist 0.17.3 bundles `2.0.20`; project uses Kotlin 2.3.10 + Detekt. Avoid by isolating Konsist in `konsist-tests/` with `kotlin("jvm")` only (no convention plugin, no Detekt plugin) and adding `resolutionStrategy.force("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.3.10")`. Spike this before writing any tests. If forcing fails, fall back to a completely separate Gradle build invoked as a CI step.

2. **Konsist tests silently skipped by Gradle UP-TO-DATE** — Konsist scans other modules' files but Gradle only tracks the Konsist module's own inputs. Add `outputs.upToDateWhen { false }` to the Konsist test task in the very first PR. Missing this means architecture violations pass CI silently from day one.

3. **Consumer guard tests cannot scope across composite build boundary** — `Konsist.scopeFromProject()` inside the toolkit cannot see consumer code when using `includeBuild`. Ship guard tests as a test dependency with reusable assertion functions; the consumer creates the scope in their own project. Getting this wrong requires a full API redesign (HIGH recovery cost).

4. **MCP server stdout corruption by `println`** — Any output to stdout corrupts the JSON-RPC stdio transport. Configure Logback to stderr-only in the first MCP commit. Canary test: `java -jar server.jar < request.json 2>/dev/null | jq .` must parse cleanly. Add a Detekt or Konsist rule flagging `println` in the MCP server package.

5. **MCP server fails to launch on Windows** — JVM startup path resolution, missing `java` on PATH in Claude Code's environment, and top-level coroutine lifecycle bugs cause silent failures. Package as fat JAR, use absolute path via `${ANDROID_COMMON_DOC}` in `.mcp.json`, and test on Windows from the first iteration. This project is Windows-primary; never defer Windows testing.

6. **Orchestrator refactoring diverges from individual agents** — Claude Code agents cannot call other agents. "Delegation" means extracting validation logic to scripts that both the orchestrator and individual agents invoke. After refactoring, diff orchestrator vs individual agent reports on the same codebase to verify parity. The orchestrator should be significantly shorter after the refactoring — if it is still 200+ lines, the refactoring is incomplete.

## Implications for Roadmap

Based on research, the dependency graph and pitfall timing dictate a 4-phase structure. Phases 3 and 4 can overlap. All phases deliver independently releasable artifacts.

### Phase 1: Tech Debt Foundation

**Rationale:** Cleaning the foundation before adding capabilities eliminates the orchestrator drift bug that would otherwise affect quality gate validation of all subsequent phases. The env var fix prevents first-use failures for any developer testing new features. This phase is pure refactoring with zero new dependencies — lowest risk, highest stability return.

**Delivers:** A clean, correct quality gate system; a friction-free setup experience; no orphaned scripts producing noise in gate runs

**Addresses:** All 4 tech debt table-stakes features (orchestrator refactoring, orphaned script removal, env var enforcement, Copilot prompts install fix)

**Avoids:** Pitfall 6 (orchestrator drift — extract shared validation to scripts), Pitfall 9 (orphaned script removal breaks CI — use deprecation-then-removal, not immediate deletion; grep all agent and CI files first), Pitfall 10 (env var chicken-and-egg — degrade gracefully with a warning, never `error()`; support `local.properties` fallback for Android Studio)

**Research flag:** Standard patterns. No deeper research needed. Pure Bash/PS1 refactoring.

### Phase 2: Konsist Internal Tests (Spike-First)

**Rationale:** Must prove Konsist works without classpath conflicts before writing any consumer-facing artifacts. Internal tests have zero blast radius — if the spike fails, nothing shipped to consumers is affected. This phase also establishes the `toolkitProductionScope()` helper that correctly excludes `build/`, test files, and `build-logic/` from scope, preventing false violations.

**Delivers:** A validated `konsist-tests/` module proving the Kotlin 2.3.10 isolation strategy works; structural tests for Detekt rule naming, script PS1/SH pairing, skill YAML frontmatter, and package conventions; `outputs.upToDateWhen { false }` configured from day one

**Uses:** Konsist 0.17.3, JUnit Jupiter 5.11.4 (already in stack)

**Implements:** Internal `konsist-tests/` module; `toolkitProductionScope()` helper function

**Avoids:** Pitfall 1 (classpath conflict — spike first, then force resolution), Pitfall 2 (UP-TO-DATE skipping — configure `upToDateWhen { false }` immediately), Pitfall 7 (scope over-reach — `toolkitProductionScope()` created in first commit), Pitfall 11 (JVM Test Suite ordering — use dedicated module, not source set)

**Research flag:** Needs spike to validate Konsist 0.17.3 + Kotlin 2.3.10 isolation. Do not write the full test suite until the spike passes. If `resolutionStrategy.force` fails, escalate to a separate Gradle build as a CI step.

### Phase 3: Consumer Architecture Guard Tests

**Rationale:** Depends on Phase 2 proving Konsist patterns internally. Guard tests encode the same architectural rules validated in Phase 2 but distributed to consumers as parameterized source templates. The API design decision (reusable assertion functions, not compiled tests; consumer creates the scope) must be made before writing a single template — wrong choice here has HIGH recovery cost.

**Delivers:** `arch-guard/` directory with 5 parameterized `.kt.template` files encoding documented layer rules; extended setup scripts with `--skip-konsist` flag and `{{BASE_PACKAGE}}` substitution; `konsistTests` property in `AndroidCommonDocExtension`; validated against WakeTheCave as a real composite-build consumer

**Uses:** Konsist 0.17.3 (consumer-side), existing setup script infrastructure

**Implements:** `arch-guard/` template directory; `build-logic/` extension property; setup script extensions

**Avoids:** Pitfall 3 (composite build scope — ship reusable assertion functions, consumer creates scope; never `scopeFromProject()` from toolkit), Pitfall 8 (hardcoded packages — parameterize from day one; include canary assertion that scope is non-empty), Pitfall 11 (JVM Test Suite ordering — standalone module approach in consumer)

**Research flag:** Needs empirical validation of the template installation flow against WakeTheCave's composite build before declaring done. The canary assertion (non-empty scope) must pass in the consumer's build context, not just in the toolkit.

### Phase 4: MCP Server (TypeScript)

**Rationale:** Independent of Konsist — can be developed in parallel with Phase 3. The server reads existing v1.0 files; docs and scripts it serves are stable. TypeScript chosen for production-readiness and zero build-step deployment. Windows testing must happen from iteration 1, not after the feature is "working" on macOS/Linux.

**Delivers:** TypeScript MCP server in `mcp-server/` with 4 tools (read-pattern, list-skills, check-versions, validate-architecture) and 9 resources (8 pattern docs + version manifest); `.mcp.json` project config; Claude Code integration via `claude mcp add`; MCP server reads docs from disk at request time (no embedded content)

**Uses:** @modelcontextprotocol/sdk 1.27.1, Node.js 24.x LTS, TypeScript 5.x, zod 3.x

**Implements:** `mcp-server/` as stdio content proxy; `.mcp.json` process launch config; setup-toolkit extensions with `--skip-mcp` flag

**Avoids:** Pitfall 4 (stdout corruption — Logback to stderr only, `jq` canary test in first commit), Pitfall 5 (Windows launch failure — fat JAR via Shadow plugin, absolute path via `${ANDROID_COMMON_DOC}`, Windows-first testing), anti-pattern of embedded docs in JAR (read from disk), anti-pattern of multiple transports (stdio only; HTTP deferred)

**Research flag:** Windows validation is mandatory in the first iteration. Measure fat JAR size and JVM startup latency on Windows — if startup exceeds Claude Code's connection timeout, the server will never connect. This must be caught early.

### Phase Ordering Rationale

- Phase 1 precedes everything: the orchestrator refactoring affects quality gate validation of all subsequent phases; env var fix prevents confusing failures during development testing
- Phase 2 precedes Phase 3: internal Konsist tests are the reference implementation and validate the classpath isolation strategy before distributing to consumers; the API lessons learned in Phase 2 inform Phase 3 design
- Phase 3 follows Phase 2: guard tests encode the same rules proven internally; the scope API decisions are based on what Phase 2 discovered about composite build behavior
- Phase 4 is parallel to Phase 3: MCP server has no Konsist dependency; it only requires Phase 1 stability (stable script infrastructure to wrap)

### Research Flags

Needs deeper validation during implementation:
- **Phase 2 (Konsist spike):** Konsist 0.17.3 + Kotlin 2.3.10 classpath isolation is UNVALIDATED. Run `./gradlew :konsist-tests:test` with Detekt also active before writing any tests. If `resolutionStrategy.force` fails, use a separate Gradle build.
- **Phase 3 (composite build scope):** `scopeFromProject()` behavior across composite build boundaries is inferred, not documented. Validate against WakeTheCave before finalizing the guard test API.
- **Phase 4 (Windows MCP launch):** JVM startup, PATH resolution, and stdout encoding on Windows must be tested in iteration 1. Fat JAR size and startup latency must be measured.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Tech debt):** Pure Bash/PS1 refactoring. Established patterns throughout.
- **Phase 4 (MCP resources):** Serving Markdown over stdio MCP is the canonical TypeScript SDK use case. Well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | TypeScript MCP SDK choice is HIGH confidence. Konsist 0.17.3 + Kotlin 2.3.10 isolation is MEDIUM — strategy is sound but unvalidated at this exact version combination. Tech debt stack is HIGH (no new deps). FEATURES.md vs STACK.md MCP SDK disagreement resolved in favor of STACK.md (TypeScript). |
| Features | HIGH | Feature prioritization is well-grounded: internal Konsist before consumer guard tests, tech debt before new features, MCP tools wrapping existing scripts. Anti-features are explicitly enumerated. MVP vs. extended vs. deferred are clearly separated. |
| Architecture | HIGH | Component boundaries are clear and well-specified. Three new components are true parallel additions with distinct integration boundaries and no cross-dependencies. Data flows documented for all four major scenarios. Anti-patterns enumerated with rationale. |
| Pitfalls | HIGH | Critical pitfalls verified against official docs and GitHub issues (Konsist #795, Detekt #7883, Gradle #28810, Roo-Code #5462). MCP pitfalls are MEDIUM due to SDK maturity and Windows-specific behavior. Recovery strategies are practical and quantified by cost. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Konsist 0.17.3 + Kotlin 2.3.10 compatibility:** Konsist docs confirm Kotlin 1.8+ support but do not explicitly document Kotlin 2.3.x. The `kotlin-compiler-embeddable:2.0.20` bundle against KGP 2.3.10 may surface unexpected internal API changes. Validate with a spike in Phase 2 before writing the test suite.

- **FEATURES.md vs STACK.md MCP SDK conflict:** FEATURES.md recommended the Kotlin MCP SDK (`io.modelcontextprotocol:kotlin-sdk-server`); STACK.md recommended TypeScript SDK with detailed rationale. Resolution: TypeScript SDK is correct — it is v1.27.1 (production) vs Kotlin SDK v0.9.0 (pre-1.0). The roadmap must specify TypeScript SDK explicitly to close this decision.

- **Konsist behavior in Gradle composite builds:** Official docs do not explicitly document `scopeFromProject()` behavior when the test module is in a composite build. Inferred from the scope API design. Needs empirical validation in Phase 2 before Phase 3 consumer guard test API is finalized.

- **MCP server fat JAR size and JVM startup latency on Windows:** Estimated 20-30MB and 1-3s startup respectively. If startup exceeds Claude Code's 60-second connection timeout, the server will never connect. Measure in Phase 4 iteration 1.

- **Guard test empty-scope false passes:** Any guard test that scans a wrong package passes vacuously (zero files checked = zero violations). A canary assertion (`assertThat(scope.files()).isNotEmpty()`) must be included in every guard test template. This gap is easy to miss and produces dangerously misleading results.

## Sources

### Primary (HIGH confidence)
- [Konsist GitHub v0.17.3](https://github.com/LemonAppDev/konsist) — scope API, architecture assertions, isolation patterns
- [Konsist Official Documentation](https://docs.konsist.lemonappdev.com/) — compatibility, architecture-assert, koscope, isolate-konsist-tests
- [@modelcontextprotocol/sdk npm v1.27.1](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — TypeScript SDK, stdio transport
- [MCP Official Build Server Guide](https://modelcontextprotocol.io/docs/develop/build-server) — TypeScript + Python examples
- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp) — `.mcp.json` format, stdio transport, tool registration
- [MCP Kotlin SDK GitHub v0.9.0](https://github.com/modelcontextprotocol/kotlin-sdk) — Kotlin SDK maturity reference (rejected in favor of TypeScript)

### Secondary (MEDIUM confidence)
- [Konsist Discussion #795](https://github.com/LemonAppDev/konsist/discussions/795) — `kotlin-compiler-embeddable` classpath conflict documentation
- [Detekt Issue #7883](https://github.com/detekt/detekt/issues/7883) — Detekt + `kotlin-compiler-embeddable` incompatibility with Kotlin 2.1+
- [Gradle Issue #28810](https://github.com/gradle/gradle/issues/28810) — JVM Test Suite Plugin + convention plugin ordering bug
- [MCP: Tips, Tricks and Pitfalls (nearform)](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) — stdio logging corruption patterns
- [Roo-Code Issue #5462](https://github.com/RooCodeInc/Roo-Code/issues/5462) — MCP stdio Windows launch failures
- [Konsist KMP Integration (Lahiru Jayawickrama)](https://medium.com/@lahirujay/konsist-protect-kotlin-multiplatform-projects-from-architecture-guidelines-violations-d88db0614cbd) — KMP-specific patterns
- [Mercedes-Benz Konsist Case Study](https://www.mercedes-benz.io/blog/2024-10-31-konsist-the-game-changer-your-kotlin-project-needs) — enterprise adoption patterns
- [ArchUnit vs Konsist (ProAndroidDev)](https://proandroiddev.com/archunit-vs-konsist-why-did-we-need-another-linter-972c4ff2622d) — Konsist vs Detekt scope differences
- [MCP SDK Comparison (Stainless)](https://www.stainless.com/mcp/mcp-sdk-comparison-python-vs-typescript-vs-go-implementations) — cross-language SDK analysis
- [Node.js releases](https://nodejs.org/en/about/previous-releases) — Node 24.x LTS current through April 2028

### Tertiary (LOW confidence)
- Konsist behavior with Gradle composite builds — inferred from scope API design; not explicitly documented; needs empirical validation
- MCP server fat JAR size (~20-30MB) — estimated from Ktor/MCP SDK dependencies; not measured
- MCP server JVM startup latency (~1-3s on Windows) — estimated; may be longer with antivirus scanning

---
*Research completed: 2026-03-13*
*Ready for roadmap: yes*

# Architecture Research

**Domain:** Documentation Coherence & Context Management (v1.2 milestone)
**Researched:** 2026-03-14
**Confidence:** HIGH (builds on verified v1.1 architecture; all integration points exist in current codebase)

## Standard Architecture

### System Overview: v1.2 Integration Map

The v1.2 milestone adds three capabilities to the existing MCP server and vault pipeline. Unlike v1.1 (which added parallel modules), v1.2 is about **deepening existing modules** -- adding new processing stages to the collector/transformer pipeline and new MCP tools that operate on CLAUDE.md files.

```
+-----------------------------------------------------------------------+
|                   ANDROID COMMON DOC (v1.2)                            |
|                                                                        |
|  EXISTING (v1.0-v1.1) -- Unchanged                                    |
|  +------------------+  +------------------+  +----------------+        |
|  | docs/*.md        |  | scripts/         |  | detekt-rules/  |        |
|  | (L0 patterns)    |  | (ps1/ + sh/)     |  | (5 lint rules) |        |
|  +------------------+  +------------------+  +----------------+        |
|  +------------------+  +------------------+  +----------------+        |
|  | .claude/agents/  |  | adapters/        |  | build-logic/   |        |
|  | (quality gates)  |  | (skill pipeline) |  | (convention)   |        |
|  +------------------+  +------------------+  +----------------+        |
|  +------------------+  +------------------+  +----------------+        |
|  | skills/          |  | guard-templates/ |  | konsist-tests/ |        |
|  | (16 SKILL.md)    |  | (arch guards)    |  | (internal)     |        |
|  +------------------+  +------------------+  +----------------+        |
|                                                                        |
|  EXISTING (v1.1) -- Modified by v1.2                                   |
|                                                                        |
|  +------------------+                                                  |
|  | mcp-server/      |                                                  |
|  |  src/            |                                                  |
|  |  +-- vault/      | <-- Modified: template engine, CLAUDE.md parser  |
|  |  +-- tools/      | <-- Modified: new coherence tools                |
|  |  +-- registry/   | <-- Modified: template-aware scanning            |
|  +------------------+                                                  |
|                                                                        |
|  NEW (v1.2)                                                            |
|                                                                        |
|  +------------------+  +------------------+  +----------------+        |
|  | templates/       |  | vault/coherence/ |  | tools/         |        |
|  | doc-structure/   |  | (new submodule)  |  | (new tools)    |        |
|  | (standard doc    |  | context-delegate |  | validate-      |        |
|  |  templates per   |  | claude-md-parser |  |  coherence     |        |
|  |  domain section) |  | template-engine  |  | generate-      |        |
|  +------------------+  +------------------+  |  claude-md     |        |
|       |                      |               | audit-docs     |        |
|  Lives as static     Processes CLAUDE.md     +----------------+        |
|  .md files in        files during vault           |                    |
|  mcp-server/src/     sync pipeline           New MCP tool              |
|  templates/                                  registrations             |
+-----------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **templates/** (NEW) | Standard documentation structure templates by domain section (architecture, testing, UI, data, cross-cutting). These are reference templates that define what a well-structured doc looks like at each layer. | Static `.md` template files under `mcp-server/src/templates/`. Loaded by the template engine at runtime. Not compiled TypeScript -- pure markdown with placeholder tokens. |
| **vault/coherence/** (NEW) | Three coherence processing components: (1) CLAUDE.md parser that extracts sections, cross-references, and delegation directives; (2) template comparator that checks doc structure against standard templates; (3) context delegation resolver that validates L0/L1/L2 cross-references. | New TypeScript files in `mcp-server/src/vault/`. Plugs into the existing collector->transformer pipeline. |
| **tools/ (new tools)** (NEW) | Three new MCP tools: `validate-coherence` checks doc structure against templates, `generate-claude-md` scaffolds CLAUDE.md from project analysis, `audit-docs` finds stale/missing/duplicate docs across layers. | New tool registration files following the existing pattern: `registerXxxTool(server, rateLimiter)`. |
| **collector.ts** (MODIFIED) | Extended to collect standard template files as a new source type and to detect CLAUDE.md cross-layer references during collection. | New `collectGlobs` entry for template files. New `classifyFile` case for template source type. Small additions, no structural change. |
| **transformer.ts** (MODIFIED) | Extended to inject cross-layer delegation metadata into CLAUDE.md vault entries. When a CLAUDE.md says "See L0 patterns for..." the transformer annotates the vault entry with those cross-references for MOC generation. | New sourceType handling in `transformSource()`. Cross-reference extraction from content. |

## Recommended Project Structure

### New Files and Modifications

```
mcp-server/
  src/
    templates/                             # NEW: Standard doc structure templates
      doc-structure/                       # Domain-specific templates
        architecture.md                    # Template for architecture docs
        testing.md                         # Template for testing docs
        ui.md                              # Template for UI docs
        data.md                            # Template for data layer docs
        cross-cutting.md                   # Template for cross-cutting docs
        claude-md.md                       # Template for CLAUDE.md structure
      template-registry.ts                 # NEW: Template loading and matching

    vault/
      claude-md-parser.ts                  # NEW: Parse CLAUDE.md structure
      context-delegate.ts                  # NEW: Resolve cross-layer references
      coherence-checker.ts                 # NEW: Compare docs against templates
      collector.ts                         # MODIFIED: template collection support
      transformer.ts                       # MODIFIED: cross-ref injection
      types.ts                             # MODIFIED: new source types + interfaces
      moc-generator.ts                     # MODIFIED: cross-layer reference MOC

    tools/
      validate-coherence.ts                # NEW: MCP tool
      generate-claude-md.ts                # NEW: MCP tool
      audit-docs.ts                        # NEW: MCP tool
      index.ts                             # MODIFIED: register 3 new tools

    registry/
      types.ts                             # MODIFIED: new metadata fields

  tests/
    unit/
      vault/
        claude-md-parser.test.ts           # NEW
        context-delegate.test.ts           # NEW
        coherence-checker.test.ts          # NEW
      tools/
        validate-coherence.test.ts         # NEW
        generate-claude-md.test.ts         # NEW
        audit-docs.test.ts                 # NEW
      templates/
        template-registry.test.ts          # NEW
```

### Structure Rationale

- **templates/ inside mcp-server/src/**: Templates are runtime data consumed by the MCP server's coherence tools. They ship with the server, not as standalone files. This avoids a separate build step and keeps templates versioned with the tool that uses them.
- **vault/ gets new files, not a subdirectory**: The existing vault/ module has flat organization (collector, transformer, types, etc.). Adding 3 new files maintains consistency. A `coherence/` subdirectory would only be warranted if the files grew beyond 6-7 modules, which is unlikely.
- **tools/ follows existing pattern**: Each new tool gets its own file with the `registerXxxTool(server, rateLimiter)` signature. This matches all 12 existing tools and keeps the index.ts registration aggregator clean.

## Architectural Patterns

### Pattern 1: Pipeline Extension (Collector -> Transformer -> Writer)

**What:** The existing vault sync pipeline is a linear data pipeline. v1.2 extends it by adding new processing stages without changing the pipeline structure.

**When to use:** Adding new capabilities that process source files through the same collect->transform->write flow.

**Trade-offs:**
- (+) No structural change to existing code
- (+) New processing is additive, not invasive
- (-) Must respect existing type contracts (VaultSource, VaultEntry)
- (-) Pipeline stages run sequentially, adding stages adds latency

**Integration points for v1.2:**

```
collectAll()                    transformAll()              generateAllMOCs()
    |                               |                           |
    v                               v                           v
[L0 sources]    ---------->   [VaultEntry[]   ---------->  [MOC pages]
[L1 sources]    (existing)     with enriched   (existing)   (existing +
[L2 sources]                   frontmatter)                  new cross-
[templates]     <-- NEW                                      layer MOC)
                               [cross-layer    <-- NEW
                                refs injected]
```

The key insight: templates are collected as VaultSources (new sourceType `"template"`), transformed into VaultEntries, and written to the vault. The coherence checker reads templates at check-time, not sync-time. This separation keeps the pipeline clean.

### Pattern 2: CLAUDE.md as Structured Document

**What:** Treat CLAUDE.md files not as opaque markdown blobs but as structured documents with parseable sections, cross-layer references, and machine-readable delegation directives.

**When to use:** When building tools that need to understand, validate, or generate CLAUDE.md files across the ecosystem.

**Trade-offs:**
- (+) Enables programmatic validation and generation
- (+) Makes cross-layer references discoverable
- (-) Requires a parser that handles markdown section structure
- (-) CLAUDE.md format is not standardized by Anthropic; our structure is a convention

**Structure convention for CLAUDE.md files:**

```markdown
# [Project Name]

[1-2 line project description]

## Critical Rules              <-- Required section
[Non-negotiable rules]

## Build Commands              <-- Required section
[How to build/test]

## Architecture                <-- Required for L2 apps
[Module structure, patterns]

## Context Delegation          <-- NEW: Required for L1/L2
### From L0 (AndroidCommonDoc)
- Pattern docs: See ~/.claude/docs/ for [specific patterns]
- Skills: Available via MCP server

### From L1 (shared-kmp-libs)  <-- Only in L2 CLAUDE.md
- Module catalog: [reference to L1 CLAUDE.md]
- Version authority: shared-kmp-libs

## [Domain-Specific Sections]  <-- Project-specific
```

**Parser output type:**

```typescript
interface ClaudeMdStructure {
  projectName: string;
  sections: Map<string, string>;        // section heading -> content
  requiredSections: string[];           // which sections are present
  crossReferences: CrossLayerRef[];     // parsed delegation directives
  layer: Layer;                         // inferred from content/config
}

interface CrossLayerRef {
  fromLayer: Layer;
  toLayer: Layer;
  targetProject: string;
  referenceType: "pattern" | "module" | "convention" | "skill";
  description: string;
}
```

### Pattern 3: Template-Based Validation (Not Generation)

**What:** Templates define the expected structure of documentation. The coherence checker compares actual docs against templates and reports deviations. Templates do NOT auto-generate docs -- they inform validation.

**When to use:** Checking whether existing documentation follows the standard structure, identifying missing sections, detecting structural drift.

**Trade-offs:**
- (+) Non-destructive: never modifies existing docs
- (+) Templates are version-controlled and evolve with the toolkit
- (+) Validation results are actionable by humans or agents
- (-) Templates must be maintained as a separate artifact
- (-) Overly rigid templates discourage documentation creativity

**Validation flow:**

```
Template Registry                  Project Docs
+------------------+              +------------------+
| architecture.md  |   compare    | DawSync/docs/    |
| testing.md       | ----------> | architecture.md  |
| ui.md            |              | testing.md       |
| data.md          |              | (missing!)       |
| cross-cutting.md |              |                  |
| claude-md.md     |              | CLAUDE.md        |
+------------------+              +------------------+
                                         |
                                         v
                                  CoherenceReport {
                                    missingDocs: ["data"],
                                    missingSections: [...],
                                    structureDeviations: [...],
                                    crossRefIssues: [...]
                                  }
```

## Data Flow

### Coherence Validation Flow (New)

```
[Agent calls validate-coherence tool]
    |
    v
[Load template registry]
    |
    v
[Discover project docs via existing project-discovery]
    |
    v
[Parse CLAUDE.md files via claude-md-parser]
    |
    v
[Compare each project's docs against templates via coherence-checker]
    |
    v
[Resolve cross-layer references via context-delegate]
    |
    v
[Return CoherenceReport as structured JSON]
```

### CLAUDE.md Generation Flow (New)

```
[Agent calls generate-claude-md tool with project path]
    |
    v
[Scan project structure (build files, source dirs, existing docs)]
    |
    v
[Load claude-md.md template]
    |
    v
[Populate template sections from project analysis]
    |
    v
[Insert context delegation section based on project layer]
    |
    v
[Return generated CLAUDE.md content (agent writes to file)]
```

### Vault Sync with Cross-Layer References (Modified Flow)

```
[collectAll() -- existing pipeline]
    |
    v
[collector classifies CLAUDE.md files (existing, no change)]
    |
    v
[transformAll() -- existing pipeline, extended]
    |
    | For claude-md sources:
    |   parse with claude-md-parser
    |   extract cross-layer references
    |   inject into frontmatter as vault_cross_refs
    v
[generateAllMOCs() -- existing pipeline, extended]
    |
    | New MOC page: "Cross-Layer References"
    |   Groups by from-layer -> to-layer
    |   Shows which L2 apps reference which L0 patterns
    v
[writeVault() -- unchanged]
```

### Key Data Flows

1. **Template loading:** Templates are loaded from disk at tool invocation time (not cached globally). The template registry resolves template paths relative to the MCP server's build output directory. Templates are NOT collected into the vault -- they are tooling assets, not documentation.

2. **Cross-layer reference resolution:** When the context-delegate module finds a reference like "See L0 patterns for testing," it resolves the reference against the pattern registry (existing `resolveAllPatterns()`) and reports whether the referenced pattern exists, is current, and matches expectations.

3. **Coherence report aggregation:** Each project produces its own `ProjectCoherenceReport`. The `validate-coherence` tool aggregates these into an `EcosystemCoherenceReport` that shows cross-project issues (e.g., L1 defines a convention that L2 CLAUDE.md files don't reference).

## Integration Points with Existing Modules

### Internal Boundaries

| Boundary | Communication | Changes Required |
|----------|---------------|------------------|
| **New tools -> vault/coherence modules** | Direct function calls (same process) | New imports in tool files; functions exported from coherence modules |
| **claude-md-parser -> registry/resolver** | `resolveAllPatterns()` to validate cross-refs | No change to resolver; parser calls existing API |
| **coherence-checker -> template-registry** | `loadTemplate(domain)` returns template content | New module; no existing dependency |
| **collector -> templates/** | `classifyFile()` extended for template paths | Small switch case addition in collector.ts |
| **transformer -> claude-md-parser** | `parseClaudeMdStructure()` for cross-ref extraction | New import; new branch in transformSource() |
| **moc-generator -> context-delegate** | Cross-layer ref data passed as VaultEntry metadata | MOC reads from entry.frontmatter.vault_cross_refs |
| **tools/index.ts -> new tool modules** | `registerXxxTool()` calls in registerTools() | 3 new import + registration lines |
| **vault/types.ts** | New types: ClaudeMdStructure, CrossLayerRef, CoherenceReport | Additive type definitions, no breaking changes |

### External Service Integration

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Filesystem (CLAUDE.md files)** | Read via `readFile()` from project paths resolved by `discoverProjects()` | Existing pattern; no new FS access patterns needed |
| **~/.androidcommondoc/vault-config.json** | Read via existing `loadVaultConfig()` | No changes to config schema required for v1.2 |
| **~/.claude/CLAUDE.md** | Read as the shared root CLAUDE.md | New read target, but uses standard `readFile()` |

## Detailed Component Design

### 1. claude-md-parser.ts

**Purpose:** Parse a CLAUDE.md file into a structured representation.

**Input:** Raw markdown string (content of a CLAUDE.md file).

**Output:** `ClaudeMdStructure` with sections, cross-references, and layer inference.

**Key design decisions:**
- Uses regex-based heading extraction (not a full markdown AST parser). CLAUDE.md files are simple markdown with `##` sections. A full AST parser (remark, unified) would add dependencies for minimal benefit.
- Cross-layer references are detected by scanning for patterns like "See L0", "From L1", "shared-kmp-libs", "AndroidCommonDoc patterns". These are heuristic but sufficient because CLAUDE.md files are authored by the developer (us) with known conventions.
- Layer inference: if a project is in vault-config.json, use its layer. Otherwise infer from content (mentions of "shared-kmp-libs" conventions -> L1, app-specific content -> L2).

**Dependencies:** None on existing modules (pure parsing function). Optionally takes layer hint from caller.

### 2. context-delegate.ts

**Purpose:** Validate that cross-layer references in CLAUDE.md files resolve correctly.

**Input:** Array of `CrossLayerRef` objects from parsed CLAUDE.md files.

**Output:** `DelegationReport` listing valid refs, broken refs (target pattern/module not found), and stale refs (target exists but has changed significantly).

**Key design decisions:**
- Calls `resolveAllPatterns()` from the existing registry to check L0 pattern references.
- Calls `discoverProjects()` to resolve L1/L2 project references.
- Does NOT modify any files. Reports issues that the agent or developer acts on.
- Stale detection: if a referenced pattern's `last_updated` is newer than the referencing CLAUDE.md's git commit date, flag as potentially stale. This is approximate but useful.

**Dependencies:** `registry/resolver.ts`, `registry/project-discovery.ts`, `vault/config.ts`.

### 3. coherence-checker.ts

**Purpose:** Compare a project's documentation against standard templates to find structural gaps.

**Input:** Project path + template registry.

**Output:** `CoherenceReport` listing missing docs, missing sections within existing docs, and structural deviations.

**Key design decisions:**
- Templates define required and optional sections. A "required" section missing from a project's doc is a finding. An "optional" section missing is informational.
- Section matching is heading-based (e.g., template says `## Architecture` -> check if project doc has `## Architecture`). Content within sections is NOT validated (that would require semantic understanding beyond this tool's scope).
- Layer-aware: different templates apply to different layers. L0 templates check pattern doc structure. L1 templates check ecosystem convention docs. L2 templates check app-specific docs.

**Dependencies:** `templates/template-registry.ts`, filesystem access to project docs.

### 4. template-registry.ts

**Purpose:** Load and serve standard doc structure templates.

**Input:** Domain name (e.g., "architecture", "testing", "claude-md").

**Output:** Parsed template with section definitions.

**Key design decisions:**
- Templates are markdown files with a YAML frontmatter block that declares required_sections, optional_sections, and applies_to_layers.
- Loaded at tool invocation time (not cached across invocations). The MCP server is a short-lived subprocess; caching adds complexity without benefit.
- Template path resolution uses the same `getToolkitRoot()` pattern as other modules. Templates live at `<toolkit>/mcp-server/src/templates/doc-structure/`.
- Templates compiled into the build output directory by `tsc` (they are `.md` files, so they need to be copied separately or loaded from the source directory). **Decision: Load from source directory using path resolution relative to toolkit root, not build output.** This avoids a copy step in the build process.

**Dependencies:** `utils/paths.ts` for toolkit root resolution.

### 5. New MCP Tools

#### validate-coherence

**Purpose:** Check documentation structure across the ecosystem against standard templates.

**Input parameters:**
- `project` (optional): Specific project name, or "all" for ecosystem-wide check
- `include_templates` (optional, default false): Include template content in response for agent comparison
- `check_cross_refs` (optional, default true): Validate cross-layer references

**Output:** Structured JSON with `CoherenceReport` for each project.

**Design:** Follows the existing tool pattern. Calls `discoverProjects()` to find projects, `coherence-checker` per project, `context-delegate` for cross-ref validation. Returns aggregated report.

#### generate-claude-md

**Purpose:** Generate a CLAUDE.md scaffold for a project based on analysis and templates.

**Input parameters:**
- `project_path`: Absolute path to the project root
- `layer` (optional): Override layer detection
- `include_delegation` (optional, default true): Include context delegation section

**Output:** Generated CLAUDE.md content as a string. The tool does NOT write the file -- the agent writes it after review. This matches the existing `ingest-content` tool's "never auto-apply" pattern.

**Design:** Scans project for build files (settings.gradle.kts, build.gradle.kts), source directories, existing docs. Populates the claude-md template with discovered information. Inserts context delegation references based on layer.

#### audit-docs

**Purpose:** Find documentation quality issues: stale docs, missing docs at specific layers, duplicate content across layers, orphaned references.

**Input parameters:**
- `project` (optional): Specific project or "all"
- `check_type` (optional): "stale" | "missing" | "duplicate" | "all" (default: "all")

**Output:** Structured JSON with findings categorized by severity.

**Design:** Combines coherence checking with freshness detection (reusing existing `monitor-sources` infrastructure for staleness detection). For duplicate detection, compares doc section content across layers using keyword overlap (similar to `ingest-content`'s `extractKeywords()`).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 3 projects (current) | Current architecture handles this trivially. Template loading, project scanning, and coherence checking complete in milliseconds. |
| 10-20 projects | Still fine. Project discovery scans sibling directories. Coherence checking is O(projects * templates) which remains fast. |
| 50+ projects | Would need to reconsider project-discovery.ts. Currently scans all siblings of toolkit root. At scale, vault-config.json becomes mandatory (no auto-discover). Template caching might help. Not a concern for current solo developer use case. |

### Scaling Priorities

1. **First bottleneck:** Not performance -- it is template maintenance. As patterns evolve, templates must evolve too. A stale template generates false coherence findings. **Mitigation:** Templates reference pattern doc versions. When patterns update, templates are flagged for review.
2. **Second bottleneck:** Cross-layer reference resolution for many projects. Each project's CLAUDE.md references are resolved independently. For many projects, this means many calls to `resolveAllPatterns()`. **Mitigation:** Cache pattern resolution results within a single tool invocation (already the natural behavior since resolution scans directories and returns arrays).

## Anti-Patterns

### Anti-Pattern 1: Auto-Generating CLAUDE.md Without Review

**What people do:** The generate-claude-md tool writes directly to the project's CLAUDE.md file.
**Why it's wrong:** CLAUDE.md is a critical developer-authored document. Auto-writing risks overwriting manual customizations, injecting incorrect build commands, or producing a file that looks correct but has wrong instructions.
**Do this instead:** Generate content and return it as tool output. The agent or developer reviews and writes the file manually. This is the same pattern used by `ingest-content` ("All suggestions require user review").

### Anti-Pattern 2: Embedding Template Logic in the Transformer

**What people do:** Making the transformer generate coherence reports during vault sync.
**Why it's wrong:** The transformer's job is to convert VaultSource -> VaultEntry. Adding coherence validation makes it a side-effect-heavy operation that slows down sync and produces unexpected output.
**Do this instead:** Keep coherence checking in its own tool (`validate-coherence`). The transformer only extracts cross-layer references for vault frontmatter enrichment -- a lightweight, data-transformation operation.

### Anti-Pattern 3: Templates as Compiled TypeScript

**What people do:** Define templates as TypeScript string literals or template literal functions.
**Why it's wrong:** Templates should be readable markdown that a developer can edit without TypeScript knowledge. Embedding them in code makes maintenance harder and testing messier.
**Do this instead:** Templates are `.md` files loaded at runtime. The template-registry.ts handles loading and parsing. Changes to templates don't require recompilation.

### Anti-Pattern 4: Modifying vault-config.json Schema

**What people do:** Adding v1.2-specific fields (template paths, coherence settings) to vault-config.json.
**Why it's wrong:** vault-config.json is for vault sync configuration (projects, paths, features). Coherence checking is a tooling concern, not a sync concern. Polluting the config schema breaks the single-responsibility principle.
**Do this instead:** Templates are resolved from the toolkit root (fixed location). Coherence tool settings are passed as tool parameters. No config schema changes needed.

## Build Order (Dependency-Aware)

The following build order respects code dependencies. Each phase can be implemented and tested independently.

### Phase 1: Foundation Types and Templates

**What:** New type definitions + static template files.
**Dependencies:** None (additive types in types.ts, new template files).
**Deliverables:**
- `vault/types.ts` additions: `ClaudeMdStructure`, `CrossLayerRef`, `CoherenceReport`, new `VaultSourceType` value `"template"`
- `registry/types.ts` additions: optional cross-ref metadata fields
- `templates/doc-structure/*.md` files (6 templates)
- `templates/template-registry.ts` with `loadTemplate()` and `listTemplates()`
- Tests for template-registry

### Phase 2: CLAUDE.md Parser and Coherence Checker

**What:** Core processing modules.
**Dependencies:** Phase 1 types.
**Deliverables:**
- `vault/claude-md-parser.ts` with `parseClaudeMdStructure()`
- `vault/coherence-checker.ts` with `checkCoherence()`
- Unit tests for both

### Phase 3: Context Delegation Resolver

**What:** Cross-layer reference validation.
**Dependencies:** Phase 2 parser (produces CrossLayerRef[]), existing registry/resolver.
**Deliverables:**
- `vault/context-delegate.ts` with `resolveDelegation()`
- Unit tests

### Phase 4: MCP Tool Registration

**What:** Three new MCP tools wired to Phase 2-3 modules.
**Dependencies:** Phases 1-3 modules.
**Deliverables:**
- `tools/validate-coherence.ts`
- `tools/generate-claude-md.ts`
- `tools/audit-docs.ts`
- `tools/index.ts` updated with 3 new registrations
- Tool-level tests

### Phase 5: Vault Pipeline Integration (Optional)

**What:** Extend collector/transformer/MOC to surface cross-layer refs in the vault.
**Dependencies:** Phases 1-3 modules, existing vault pipeline.
**Deliverables:**
- `collector.ts` small modification (template source type classification)
- `transformer.ts` extended for cross-ref frontmatter injection
- `moc-generator.ts` new "Cross-Layer References" MOC page
- Integration tests

**Note:** Phase 5 is optional for the v1.2 milestone. The MCP tools (Phases 1-4) deliver the primary value. Vault integration enriches the Obsidian experience but is not blocking.

## Files Changed vs Files Created

### New Files (11 source + 13 test)

| File | Purpose |
|------|---------|
| `src/templates/doc-structure/architecture.md` | Standard architecture doc template |
| `src/templates/doc-structure/testing.md` | Standard testing doc template |
| `src/templates/doc-structure/ui.md` | Standard UI doc template |
| `src/templates/doc-structure/data.md` | Standard data layer doc template |
| `src/templates/doc-structure/cross-cutting.md` | Standard cross-cutting doc template |
| `src/templates/doc-structure/claude-md.md` | Standard CLAUDE.md structure template |
| `src/templates/template-registry.ts` | Template loading and matching |
| `src/vault/claude-md-parser.ts` | CLAUDE.md structural parser |
| `src/vault/context-delegate.ts` | Cross-layer reference resolver |
| `src/vault/coherence-checker.ts` | Doc structure vs template comparator |
| `src/tools/validate-coherence.ts` | MCP tool: coherence validation |
| `src/tools/generate-claude-md.ts` | MCP tool: CLAUDE.md scaffolding |
| `src/tools/audit-docs.ts` | MCP tool: doc quality audit |

### Modified Files (5 source)

| File | Change | Scope |
|------|--------|-------|
| `src/vault/types.ts` | Add `ClaudeMdStructure`, `CrossLayerRef`, `CoherenceReport` interfaces; add `"template"` to `VaultSourceType` | Additive only, ~40 lines |
| `src/tools/index.ts` | Import and register 3 new tools | 6 lines (3 imports + 3 registerTool calls) |
| `src/vault/collector.ts` | Add `"template"` case to `classifyFile()` | ~5 lines |
| `src/vault/transformer.ts` | Extract cross-refs for claude-md sources, inject into frontmatter | ~20 lines in transformSource() |
| `src/vault/moc-generator.ts` | Add `generateCrossLayerRefMOC()` to `generateAllMOCs()` | ~40 lines new function + 1 line in array |

### Unchanged Files (All Other Existing Files)

All existing tools, registry modules, resources, prompts, utilities, and test files remain unchanged. The v1.2 changes are strictly additive.

## Sources

- Existing codebase analysis (HIGH confidence): All integration points verified by reading current source files
- v1.1 architecture research (`.planning/research/ARCHITECTURE.md` from v1.1): Confirmed module boundaries and patterns
- MCP SDK documentation (verified via current `package.json` dependency: `@modelcontextprotocol/sdk: 1.27.1`): Tool registration patterns confirmed
- Vault pipeline architecture (verified via source): `collectAll() -> transformAll() -> generateAllMOCs() -> writeVault()` pipeline structure confirmed
- CLAUDE.md format conventions (verified via `~/.claude/CLAUDE.md`, `shared-kmp-libs/CLAUDE.md`, `DawSync/CLAUDE.md`): Current structure documented and used as basis for template design

---
*Architecture research for: Documentation Coherence & Context Management (v1.2)*
*Researched: 2026-03-14*

# Stack Research

**Domain:** Documentation coherence, CLAUDE.md ecosystem alignment, context delegation, and standard doc templates for KMP developer toolkit
**Researched:** 2026-03-14
**Confidence:** HIGH (this milestone is primarily documentation structure + minimal tooling additions to an existing, validated MCP server)

## Context

This is a DELTA stack document for v1.2. The v1.0 stack (Kotlin 2.3.10, Detekt 2.0.0-alpha.2, Gradle 9.1.0, 23 pattern docs, 16 skills, Python3 adapters, Bash/PS1 scripts) and v1.1 stack (TypeScript MCP SDK 1.27.1, Vitest 3.x, Konsist 0.17.3, Obsidian vault sync pipeline, L0/L1/L2 collector/transformer/MOC generator) are validated and shipping. This document covers ONLY the changes needed for v1.2 documentation coherence features.

**Key insight: v1.2 is 90% content work, 10% tooling work.** The existing MCP server, vault sync pipeline, and quality gate infrastructure already support what is needed. The primary deliverables are well-structured Markdown files (CLAUDE.md rewrites, doc templates, consolidated docs) and minor MCP tool additions for validation.

## Recommended Stack Additions

### No New Core Technologies Required

v1.2 does not require new languages, frameworks, or major library additions. The existing stack is sufficient:

| Existing Technology | v1.2 Usage | Notes |
|---------------------|------------|-------|
| TypeScript (MCP server) | New validation tool(s) for CLAUDE.md coherence checking | Same @modelcontextprotocol/sdk 1.27.1, same Vitest test framework |
| Markdown | Standard doc structure templates, CLAUDE.md rewrites | Plain Markdown with YAML frontmatter (existing pattern) |
| YAML frontmatter | Metadata for doc templates, cross-reference declarations | Existing `yaml` npm package 2.8.x already in MCP server |
| Vault sync pipeline | Updated collector globs, possibly new sourceType | Existing transformer/MOC pipeline handles new content automatically |

### Supporting Additions

| Addition | Purpose | Integration Point |
|----------|---------|-------------------|
| `@import` references in CLAUDE.md files | Cross-layer context delegation between L0/L1/L2 | Claude Code native feature -- no library needed |
| JSON Schema for doc structure validation | Optional: validate that project docs follow standard template | Existing `zod` 3.24.x in MCP server already handles schema validation |
| Markdown section parser (hand-rolled) | Validate CLAUDE.md structure against template requirements | ~50 lines TypeScript, no external dependency needed |

### Development Tools (Unchanged)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest 3.x | Test new validation logic | Already configured in mcp-server/ |
| ESLint 9 + @typescript-eslint | Lint new TypeScript code | Already configured |
| Prettier 3.x | Format new TypeScript code | Already configured |

## What Is Actually New in v1.2

### 1. CLAUDE.md Template & Cross-Reference System (Pure Markdown)

**What:** Standardized CLAUDE.md structure that each project follows, with `@import` directives for cross-layer context delegation.

**Why no new tech:** Claude Code natively supports `@path/to/file` in CLAUDE.md files. This is a content design problem, not a tooling problem. The `@import` syntax:
- Resolves relative and absolute paths
- Supports `@~/` for home directory references
- Loads imported files into Claude's context on session start
- Is recursive (imported files can import other files)

**Implementation approach:** Write three CLAUDE.md files (AndroidCommonDoc, shared-kmp-libs, DawSync) that use `@import` to reference each other's documentation via the `@~/.claude/docs/` directory or direct relative paths. No code to write -- just well-structured Markdown.

**Cross-reference pattern:**
```markdown
# DawSync CLAUDE.md

## Ecosystem Context
@~/.claude/CLAUDE.md (shared KMP rules)

## Architecture Patterns
See @docs/architecture/PATTERNS.md for domain-specific patterns.
For generic KMP patterns, consult @~/.claude/docs/kmp-architecture.md (from L0 AndroidCommonDoc).
```

### 2. Standard Doc Structure Template (Pure Markdown)

**What:** A template defining the expected sections for project documentation, organized by domain (architecture, testing, UI, data, cross-cutting).

**Why no new tech:** This is a Markdown file that serves as a reference template. Quality gate validation (optional) uses existing pattern-matching capabilities in the MCP server.

**Template structure (domain sections):**
- Architecture (module structure, data flow, key patterns)
- Testing (frameworks, coverage targets, patterns)
- UI (design system, navigation, accessibility)
- Data (storage, network, sync)
- Cross-cutting (error handling, DI, logging)

### 3. CLAUDE.md Validation Tool (Minor MCP Addition)

**What:** An MCP tool that validates CLAUDE.md files against the standard template, checking for required sections, broken `@import` references, and cross-layer consistency.

**Why existing stack is sufficient:**
- Markdown parsing: split by `##` headers, check section presence -- ~50 lines TypeScript
- `@import` validation: regex extract `@path/to/file` references, verify files exist via `fs.access` -- ~30 lines
- Cross-layer consistency: check that L2 CLAUDE.md references L1/L0 docs appropriately -- ~40 lines
- Total: one new tool file (~200 lines), one test file (~150 lines), registration in index.ts

**Implementation:** Single new file `mcp-server/src/tools/validate-claude-md.ts` following the established tool pattern (rate limiter, zod schema, structured JSON response).

### 4. DawSync Doc Consolidation (Pure Content Work)

**What:** Audit DawSync's docs/ directory, archive stale content, consolidate overlapping docs, identify L0 promotion candidates.

**Why no new tech:** This is editorial work. The vault sync pipeline already collects DawSync docs. The only tooling touch is potentially updating `vault-config.json` exclude globs for archived content.

### 5. Vault Sync Updates (Minor Config Changes)

**What:** Update default collection globs to collect the new standardized doc structure from all projects.

**Why existing stack is sufficient:** The `getDefaultGlobs()` function in `config.ts` already returns glob patterns. Updating the default patterns or adding layer-specific defaults (the `_layer` parameter is already reserved) is a one-line change.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Hand-rolled Markdown section parser | remark/unified/mdast | Over-engineered for checking section headers in <10 files; adds 50+ transitive dependencies for ~50 lines of logic |
| `@import` in CLAUDE.md | Custom context injection via MCP resources | `@import` is Claude Code native, zero overhead, auto-loaded on session start; MCP resources require explicit tool calls |
| Single validate-claude-md MCP tool | Quality gate agent for CLAUDE.md | Agents are for orchestration; a focused tool is more composable and can be called from existing quality-gate-orchestrator |
| YAML frontmatter for doc metadata | JSON sidecar files per doc | Consistent with existing pattern doc convention; one file not two |
| Plain Markdown templates | Docusaurus/MDX/custom templating engine | Templates are reference documents, not rendered sites; Markdown is universal |
| Direct @path references between repos | Symlinks or file copying | `@` references are first-class in Claude Code, work across repos without filesystem tricks |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| remark/unified/rehype | Massive dependency tree for trivial Markdown structure checking | Hand-rolled header extraction (~50 lines) |
| Custom doc rendering engine | v1.2 is about content structure, not presentation | Plain Markdown files that humans and agents read directly |
| Template generation scripts | Over-engineering; templates are reference documents, not scaffolding | Markdown template files that developers copy and fill in |
| CLAUDE.md generation from code analysis | `/init` already does this; re-implementing adds no value | Manual authoring with standard template as guide |
| Database for cross-reference tracking | Over-engineering; the L0/L1/L2 relationships are static and small | @import references + vault sync manifest for tracking |
| Complex doc validation CI pipeline | Three projects, one developer; the quality gate agent is sufficient | MCP tool invoked manually or from quality-gate-orchestrator |
| Bidirectional sync between CLAUDE.md files | Conflict resolution complexity, unclear source of truth | Unidirectional: each CLAUDE.md is authoritative for its project, references others read-only |
| NotebookLM API integration | Requires enterprise license; manual upload is sufficient | Vault sync to Obsidian (already working) + manual NotebookLM upload |

## Stack Patterns by Context

**When writing CLAUDE.md files:**
- Use `@~/.claude/docs/pattern-name.md` for L0 generic pattern references (these are already deployed)
- Use `@../shared-kmp-libs/CLAUDE.md` for L1 ecosystem references (relative to project root)
- Keep each CLAUDE.md under 10K words (community-validated performance threshold)
- Use WHY/WHAT/HOW information hierarchy per Anthropic best practices

**When adding MCP validation tools:**
- Follow the established pattern in `mcp-server/src/tools/` (rate limiter, zod schema, structured JSON)
- Test with Vitest using InMemoryTransport (established in Phase 8)
- Register in `tools/index.ts` with rate limiter injection

**When updating vault sync:**
- Modify `vault/config.ts` for default globs
- Update `vault/collector.ts` for new source type classification if needed
- Update `vault/moc-generator.ts` if new MOC groupings are needed
- All changes tested via existing integration test pattern from Phase 12

## Version Compatibility

No new version concerns. All additions use the existing validated stack:

| Component | Version | Compatibility Notes |
|-----------|---------|---------------------|
| @modelcontextprotocol/sdk | 1.27.1 | Stable, no upgrade needed |
| yaml | 2.8.x | Frontmatter parsing, already in use |
| zod | 3.24.x | Schema validation, already in use |
| Node.js | >=18.0.0 | Already enforced in package.json engines |
| TypeScript | 5.7.x | Already configured |
| Vitest | 3.x | Already configured |
| Claude Code CLAUDE.md @import | Native | No version dependency; works in all Claude Code versions supporting CLAUDE.md |

## Context Window Optimization Strategy

Relevant to v1.2 because documentation must be token-efficient for AI agent consumption.

**Key constraints (from Anthropic best practices):**
- CLAUDE.md is loaded every session -- keep it concise, only include what Claude cannot infer from code
- ~1.35 tokens per word estimate for documentation
- Anthropic recommends: "For each line, ask: Would removing this cause Claude to make mistakes?"
- Skills (`.claude/skills/SKILL.md`) are loaded on demand -- use for domain knowledge not needed every session
- Subagents run in separate context -- use for investigation-heavy tasks

**Token budget guidelines for v1.2 CLAUDE.md files:**
| Project | Target Size | Rationale |
|---------|-------------|-----------|
| AndroidCommonDoc | ~3K words (~4K tokens) | Toolkit overview, commands, conventions, boundaries |
| shared-kmp-libs | ~2K words (~2.7K tokens) | Module catalog, critical rules, build commands |
| DawSync | ~5K words (~6.7K tokens) | Largest project, most domain context needed |
| ~/.claude/CLAUDE.md | ~2K words (~2.7K tokens) | Shared KMP rules, cross-cutting conventions |

**Total ecosystem context at session start:** ~12K words (~16K tokens). Well within the recommended <10K per file threshold, and total is <5% of a 200K context window.

**Token efficiency patterns to apply:**
1. Delegate detail to `@import` files that Claude loads on demand (not at session start)
2. Use tables over prose (3x more information-dense)
3. Commands section: only non-obvious commands (Claude can read build files)
4. Architecture section: decision rationale, not code structure (Claude can read code)
5. Link to pattern docs via `@~/.claude/docs/` instead of inlining content

## Sources

- [Anthropic: Using CLAUDE.md Files](https://claude.com/blog/using-claude-md-files) -- Official guide for CLAUDE.md structure, hierarchy, @import syntax (HIGH confidence)
- [Anthropic: Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices) -- CLAUDE.md size guidelines, skills vs CLAUDE.md, context management (HIGH confidence)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) -- Information density principles, just-in-time retrieval, structured note-taking (HIGH confidence)
- [Addy Osmani: How to Write a Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/) -- Six essential areas, modular specs, living documents (MEDIUM confidence)
- [DEV Community: Organizing CLAUDE.md in a Monorepo](https://dev.to/anvodev/how-i-organized-my-claudemd-in-a-monorepo-with-too-many-contexts-37k7) -- Hierarchical structure, <10K words target, 80% reduction strategy (MEDIUM confidence)
- [GitHub Gist: Monorepo CLAUDE.md for Multi-Project](https://gist.github.com/pirate/ef7b8923de3993dd7d96dbbb9c096501) -- Shared ecosystem table pattern across CLAUDE.md files (MEDIUM confidence)
- Existing MCP server codebase analysis (mcp-server/src/) -- Tool patterns, vault pipeline, rate limiter conventions (HIGH confidence, primary source)
- Existing CLAUDE.md files across ecosystem (~/.claude/CLAUDE.md, shared-kmp-libs/CLAUDE.md, DawSync/CLAUDE.md) -- Current state baseline (HIGH confidence, primary source)

---
*Stack research for: v1.2 Documentation Coherence & Context Management*
*Researched: 2026-03-14*

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

# Pitfalls Research

**Domain:** Adding documentation coherence, standard doc templates, CLAUDE.md ecosystem alignment, and L0/L1/L2 context delegation to existing multi-project KMP toolkit
**Researched:** 2026-03-14
**Confidence:** HIGH (pitfalls derived from direct codebase analysis of all three projects, current CLAUDE.md files, and verified against community experience with multi-repo documentation and AI agent context management)

## Critical Pitfalls

### Pitfall 1: CLAUDE.md Rewrite Breaks Existing AI Agent Workflows

**What goes wrong:**
The three CLAUDE.md files (~/.claude/CLAUDE.md at 100 lines, shared-kmp-libs at 57 lines, DawSync at 232 lines) are currently loaded by Claude Code on EVERY session in their respective projects. They contain hard-won rules discovered through trial and error (e.g., "sealed interface NEVER data class for UiState", "maxParallelForks = 1 for Windows file locking", "SKIE disabled waiting for Kotlin 2.3.0+ support"). A rewrite that restructures these files risks deleting or rewording a rule so that AI agents no longer follow it. The consequence is not a documentation gap -- it is broken code generated by AI agents in every future session.

**Why it happens:**
Rewriting feels like "just reorganizing" but each line in a CLAUDE.md file is a behavioral instruction for an AI agent. Unlike documentation humans read occasionally, CLAUDE.md content is consumed literally and systematically. Rewording "ALWAYS rethrow CancellationException in catch blocks" to something like "handle CancellationException properly" loses the prescriptive force. Moving a rule from the root `~/.claude/CLAUDE.md` to a project-level file changes when it loads (global vs. project-specific). Removing a rule because "it's in the pattern docs" assumes the agent will read the pattern docs before generating code -- it will not unless the CLAUDE.md tells it to.

**How to avoid:**
- Extract every rule from all three existing CLAUDE.md files into a canonical checklist BEFORE rewriting. Every rule in the old files must appear in the new files or be explicitly marked as "removed because X."
- Diff the old and new CLAUDE.md files side by side. For each removed line, answer: "Will AI agents still follow this rule?" If the answer depends on the agent reading a secondary document, the rule must stay in CLAUDE.md.
- After rewriting, run a smoke test: open each project in Claude Code and ask it to generate a ViewModel, a UseCase, and a test. Verify the output follows all the rules that were in the original CLAUDE.md.
- Keep a `CLAUDE.md.previous` backup until the rewrite is validated across at least 3 real development sessions.

**Warning signs:**
- AI agent generates a ViewModel with `data class UiState` instead of `sealed interface`
- AI agent uses `Dispatchers.Default` directly instead of injecting test dispatcher
- AI agent creates a `core-json:api` nested module instead of `core-json-api` flat module
- Agent does not mention consulting docs/ before modifying code in DawSync
- Agent generates Compose resources in wrong directory

**Phase to address:**
CLAUDE.md rewrite phase. This is the highest-risk phase of the entire milestone because regressions are silent -- they show up as subtly wrong code in future sessions, not as build failures.

---

### Pitfall 2: DawSync docs/ Consolidation Loses Important Content

**What goes wrong:**
DawSync has 132 markdown files totaling ~33,618 lines across docs/ (active) and docs/archive/ (31 archived files, ~10,766 lines). The archive alone contains substantive documents: ARCHITECTURE.md, DATA_LAYER_DESIGN.md, STRATEGIC_ALIGNMENT_2026.md, PRODUCT_MASTERPLAN.md, SYNC_STRATEGY.md. During consolidation, a developer scans these quickly, judges them as "old," and discards content that is actually still relevant -- such as design decisions that explain WHY the current architecture looks the way it does. Six months later, someone refactors the sync engine without understanding the original strategy, reintroducing a problem that was already solved.

**Why it happens:**
Solo developers accumulate docs organically. The archive/ folder has 31 files because ideas evolved iteratively. Some archived docs are genuinely superseded (PRICING_MODEL.md might be replaced by BUSINESS_STRATEGY.md), but others contain irreplaceable context (PRODUCT_MOAT.md explains competitive positioning that no other doc captures). The urge to "clean up" is strong, but distinguishing "superseded" from "complementary" requires reading every document carefully -- which is tedious and gets shortcut.

**How to avoid:**
- Audit docs in two passes. First pass: read each document and tag it as ACTIVE (still relevant), SUPERSEDED (content exists elsewhere, link to replacement), or UNIQUE (content not captured elsewhere, must be preserved). Second pass: for SUPERSEDED docs, verify the replacement actually covers the same ground.
- Do NOT delete any document. Move superseded docs to docs/archive/ with a header noting what replaced them. Move truly obsolete docs to docs/archive/obsolete/ -- out of the way but recoverable.
- For documents tagged UNIQUE, either incorporate their content into the canonical doc structure or leave them in place with a note explaining their role.
- Create a consolidation manifest (spreadsheet or markdown table) that maps every source document to its destination. This manifest is the audit trail.

**Warning signs:**
- A docs/ cleanup PR removes more than 5 files without a manifest showing where their content went
- An archived document's unique content cannot be found in any active document
- A design decision question arises that nobody can answer because the doc explaining it was deleted
- The consolidation removes ALL archived docs in a single commit instead of reviewing individually

**Phase to address:**
DawSync doc audit phase. Must complete the audit before any deletion. The audit itself is a deliverable, not a preliminary step.

---

### Pitfall 3: L0/L1/L2 Cross-References Create Circular or Stale Dependencies

**What goes wrong:**
The L0 (AndroidCommonDoc) / L1 (shared-kmp-libs) / L2 (DawSync) hierarchy requires CLAUDE.md files to reference each other. For example, DawSync's CLAUDE.md might say "for KMP source set rules, see ~/.claude/CLAUDE.md" and ~/.claude/CLAUDE.md says "for detailed patterns, see ~/.claude/docs/kmp-architecture.md." If these references are not managed carefully, three failure modes emerge: (1) circular references where L2 points to L1 which points back to L2, (2) dangling references where L1 moves a doc and L2's reference breaks silently, (3) version drift where L0 updates a pattern but L2's CLAUDE.md still contains the old rule inline as a "summary."

**Why it happens:**
Cross-project references look like hyperlinks but behave like runtime dependencies. Unlike code dependencies that break the build when missing, documentation references fail silently -- the AI agent simply ignores the instruction to "see X" if X cannot be found or contains outdated information. The three-layer hierarchy increases the surface area for these failures. Each layer has its own update cadence (AndroidCommonDoc is toolkit-driven, DawSync is feature-driven), so references go stale at different rates.

**How to avoid:**
- Establish a strict reference direction: L2 references L1, L1 references L0, NEVER the reverse. L0 must NEVER mention DawSync or shared-kmp-libs by name. L1 may reference L0 patterns but never L2 domain knowledge.
- For each cross-reference, decide: is this a DELEGATION ("read X for details") or a SUMMARY ("the key rule from X is Y")? Delegations are fragile (target can move). Summaries create duplication (source can change). Prefer summaries for critical rules (with a comment noting the source) and delegations for detailed reference material.
- Create a reference registry: a simple file listing all cross-layer references and their targets. A quality gate script can verify these targets exist.
- Every cross-reference must use an absolute path or a well-known convention (e.g., `~/.claude/docs/` is stable; `../shared-kmp-libs/CLAUDE.md` is fragile if the repo is in a different location).

**Warning signs:**
- CLAUDE.md says "see ~/.claude/docs/foo.md" but that file has been renamed or reorganized
- L0 CLAUDE.md mentions "DawSync" or "WakeTheCave" (violates layer boundary)
- L2 CLAUDE.md repeats a rule from L1 verbatim -- but the L1 version has been updated
- AI agent follows a stale summary in L2 instead of the current rule in L1

**Phase to address:**
L0/L1/L2 context delegation phase. Design the reference strategy before adding any cross-references. This is an architecture decision, not a content task.

---

### Pitfall 4: Context Window Budget Blow-Up from Layered CLAUDE.md

**What goes wrong:**
Claude Code loads CLAUDE.md files hierarchically: ~/.claude/CLAUDE.md (100 lines) + project CLAUDE.md + any subdirectory CLAUDE.md files encountered during work. The current DawSync CLAUDE.md is already 232 lines. Adding L0/L1/L2 delegation with "see also" references to pattern docs means Claude Code may load 400-600+ lines of instructions before the developer even types a question. With ~/.claude/docs/ containing 4,343 lines of pattern docs that CLAUDE.md references, a well-intentioned "consult the relevant pattern doc" instruction can cause the agent to read thousands of lines of documentation, consuming 15-25% of the context window before any actual work begins.

**Why it happens:**
Documentation coherence optimizes for completeness ("the agent should know everything"). But context windows have a fixed budget. Every token spent on documentation is a token not available for code analysis, reasoning, or multi-file editing. The v1.2 milestone adds more documentation structure (standard templates, cross-references) -- each addition is small, but the cumulative effect is a bloated initial context load. The problem is invisible during development because the developer does not see the token count; they only notice when Claude starts "forgetting" earlier parts of the conversation.

**How to avoid:**
- Set a hard budget: root CLAUDE.md files must be under 150 lines each. Detailed patterns go in docs/ files that are loaded on-demand (when Claude works in a relevant directory), not at startup.
- Use the Claude Code CLAUDE.md hierarchy correctly: put global rules (that apply to EVERY file edit) in the root CLAUDE.md, put module-specific rules in subdirectory CLAUDE.md files. The agent only loads subdirectory files when working in that directory.
- Remove "Mandatory Documentation Consultation" tables from CLAUDE.md (DawSync currently has one). Instead, put a CLAUDE.md file IN each directory (e.g., `core/data/CLAUDE.md`) that says "read docs/architecture/PRODUCER_CONSUMER.md before modifying files here." This is lazy-loaded, not front-loaded.
- Measure token cost: after rewriting, use `/cost` or `/context` in Claude Code to verify the initial context load. If instructions exceed 4,000 tokens, it is too much.
- The ~/.claude/docs/ files (8 files, 4,343 lines) should NEVER be referenced as "read all of these." Each should be referenced from the specific subdirectory CLAUDE.md that needs it.

**Warning signs:**
- Claude Code sessions start with "context is getting long" warnings after only a few tool calls
- Agent "forgets" instructions from early in the CLAUDE.md when working on complex tasks
- Developer notices agent is slower to respond (more tokens to process per request)
- Agent reads 3+ docs files before starting any actual code work

**Phase to address:**
CLAUDE.md rewrite phase AND standard template phase. Both phases add content that affects context budget. Set the budget constraint first, then write within it.

---

### Pitfall 5: Standard Doc Templates That Nobody Follows

**What goes wrong:**
The milestone creates "standard doc structure templates" for documentation organization. These templates define section headers, required fields, ordering conventions. After creation, one of two failure modes occurs: (a) the templates are too rigid -- they require sections that do not apply to every project (e.g., "Producer/Consumer Pattern" section in a template used by WakeTheCave, which has no producer/consumer split), so developers skip sections or fill them with "N/A", making the template noise rather than structure; or (b) the templates are too loose -- they provide optional sections with no enforcement, so each project organizes docs differently and the "standard" template provides no actual standardization.

**Why it happens:**
Template design is a premature abstraction problem. The milestone targets three projects (AndroidCommonDoc, shared-kmp-libs, DawSync) with very different documentation needs. AndroidCommonDoc documents patterns generically. shared-kmp-libs documents modules and APIs. DawSync documents features, business strategy, and domain architecture. A template that works for all three is either so generic it adds no value, or so specific it forces inappropriate structure onto at least one project.

**How to avoid:**
- Design templates by DOMAIN SECTION, not by project. Create templates for: Architecture docs, Pattern docs, Guide docs, API reference docs, Business docs. Each project picks the templates relevant to its content.
- Keep templates minimal: required sections only (Title, Purpose, Last Updated, Content). Optional sections are suggestions in comments, not empty headers.
- Enforce templates through a quality gate, not through developer discipline. A script that checks "does this doc have a Title and Last Updated date?" is worth more than a 50-section template that nobody fills out.
- Start with the DawSync docs/ consolidation as the test case. Whatever template structure works for DawSync's 132 files is the right level of structure. Do not design templates in the abstract.

**Warning signs:**
- Template has more than 8 required sections
- Multiple documents have "N/A" or "TODO" in template-required sections
- A project's docs do not use the template because "it doesn't fit our needs"
- Template creation takes more than a day (over-engineering)

**Phase to address:**
Standard template phase. But design it AFTER the DawSync consolidation, not before. The consolidation reveals what structure is actually needed.

---

### Pitfall 6: Vault Sync Update Creates Stale Shadow Copies

**What goes wrong:**
The milestone includes "vault sync updated to reflect consolidated documentation structure." The vault aggregates docs from all layers into a read-only collection. After doc consolidation, the vault sync scripts must be updated to point to new file locations. If the sync script is updated incompletely -- pointing to some new paths but retaining some old paths -- the vault contains a mix of current and stale content. Worse, if the vault contains cached copies of files that were renamed or consolidated, users reading from the vault see outdated information while the source files have been updated.

**Why it happens:**
Vault sync is a downstream consumer of the documentation structure. When the structure changes, the sync must change too. But the sync update is typically done last (after consolidation is "complete"), by which point the developer has moved on mentally and does not exhaustively verify every path. The vault's read-only nature means stale content persists silently -- there is no build failure or test failure to catch it.

**How to avoid:**
- Update vault sync configuration DURING doc consolidation, not after. When a file is moved from docs/archive/ARCHITECTURE.md to docs/architecture/SYSTEM_ARCHITECTURE.md, update the vault sync path in the same commit.
- Add a vault sync verification step: after sync runs, compare the vault contents against a manifest of expected files. Any file in the vault that is not in the manifest is stale; any file in the manifest missing from the vault is a broken path.
- The vault config lives at ~/.androidcommondoc/ (per the memory document). Verify this config is updated as part of the consolidation, not as a separate follow-up task.

**Warning signs:**
- Vault contains files that no longer exist in the source repos
- Vault is missing files that were added or renamed during consolidation
- Vault sync script references paths like `docs/archive/ARCHITECTURE.md` that were consolidated into `docs/architecture/`
- Developer reads a doc from the vault that contradicts the source file

**Phase to address:**
Vault sync phase. But couple it to the DawSync consolidation phase -- do not treat vault sync as an independent phase.

---

## Moderate Pitfalls

### Pitfall 7: Over-Engineering Documentation Infrastructure

**What goes wrong:**
The solo developer, having shipped a sophisticated toolkit (31,710 LOC with quality gates, skill adapters, convention plugins), applies the same engineering rigor to documentation infrastructure. This produces: custom linting for doc format compliance, automated cross-reference checkers, template enforcement pipelines, staleness detection scripts, and doc-generation tooling. The documentation infrastructure becomes a project in its own right, requiring maintenance, bug fixes, and its own documentation. The time spent maintaining the infrastructure exceeds the time spent writing actual documentation.

**How to avoid:**
- Set a time budget: documentation infrastructure should take less than 20% of the total milestone effort. If infrastructure work exceeds this, stop and ship what exists.
- Only build automated checks for problems that have actually occurred. If cross-references have never gone stale yet, do not build a staleness checker. If templates have never been violated, do not build a template linter.
- Reuse existing infrastructure. The toolkit already has quality gate agents and script validation. Extend these minimally rather than building new systems.
- The "Last Updated" date in docs is sufficient staleness detection for a solo developer. No need for automated freshness tracking on documentation (the toolkit already has version freshness tracking for code -- documentation does not need the same rigor).

**Warning signs:**
- More than 3 new scripts created for documentation management
- Documentation infrastructure has its own test suite
- Time spent on infrastructure exceeds time spent on actual doc writing/consolidation
- Developer is debugging a doc-checking script instead of writing docs

**Phase to address:**
All phases. Set the infrastructure budget at milestone kickoff and enforce it throughout.

---

### Pitfall 8: Consolidation Creates One Giant Doc Instead of Navigable Structure

**What goes wrong:**
When consolidating DawSync's 31 archived docs and 10 top-level docs, the developer merges related content into fewer, larger files. ARCHITECTURE.md + DATA_LAYER_DESIGN.md + SYSTEM_ARCHITECTURE.md become one 800-line architecture document. PRICING_MODEL.md + COST_MODEL.md + FREEMIUM_PREMIUM.md + BUSINESS_STRATEGY.md become one 1,200-line business document. These mega-docs are technically complete but practically unusable -- neither humans nor AI agents want to read 1,200 lines to find one pricing detail.

**How to avoid:**
- Target 200-400 lines per document. If consolidation produces a document over 400 lines, split it into subsections in separate files under a topic directory (e.g., docs/architecture/PATTERNS.md, docs/architecture/PRODUCER_CONSUMER.md -- which DawSync already does well).
- Consolidation should REDUCE total doc count by ~30-50%, not by 80%. Going from 132 files to 20 mega-docs is worse than the original 132 files.
- For AI agent consumption specifically: smaller files are better. An agent that needs pricing info should be able to read docs/business/PRICING.md (100 lines) instead of docs/BUSINESS.md (1,200 lines, of which only 100 are relevant).
- Create an index file (docs/INDEX.md) that lists all docs with one-line descriptions, serving as a table of contents for both humans and agents.

**Warning signs:**
- Any consolidated document exceeds 500 lines
- The total doc file count drops below 15 (over-consolidated)
- AI agent reads a full document to answer a question that only requires one section
- Developer cannot find information without full-text search

**Phase to address:**
DawSync doc audit phase. Set document size targets before starting consolidation.

---

### Pitfall 9: CLAUDE.md Ecosystem Alignment Creates Unnecessary Coupling

**What goes wrong:**
"Ecosystem alignment" sounds like all three CLAUDE.md files should be consistent, cross-reference each other, and follow the same format. This creates coupling: changing a rule in ~/.claude/CLAUDE.md now requires checking if DawSync's CLAUDE.md and shared-kmp-libs' CLAUDE.md need corresponding updates. The three files become a distributed system with consistency requirements, turning every rule change into a multi-repo coordination task. For a solo developer, this is manageable but tedious. For the "future broader adoption" goal, it is a maintenance trap.

**How to avoid:**
- Each CLAUDE.md should be SELF-CONTAINED for its scope. ~/.claude/CLAUDE.md contains global KMP rules. shared-kmp-libs/CLAUDE.md contains library development rules. DawSync/CLAUDE.md contains app development rules. Overlap is fine -- a rule that matters in both L1 and L2 contexts should appear in both files rather than relying on delegation.
- Cross-references should be informational ("for deeper context, see..."), not behavioral ("the rules at X override the rules here"). AI agents should get correct behavior from reading ONLY the CLAUDE.md in the current project, without needing to chase references.
- Do NOT create a shared "base template" for CLAUDE.md files. Each project has different needs. shared-kmp-libs needs module catalog and build commands. DawSync needs architecture patterns and domain constraints. A shared template forces irrelevant sections.

**Warning signs:**
- Editing ~/.claude/CLAUDE.md requires also editing 2+ other CLAUDE.md files
- A CLAUDE.md file says "see [other project]/CLAUDE.md for rule X" for a rule the agent needs in the current project
- CLAUDE.md files have identical boilerplate sections (copied from a template) that add no project-specific value
- Updating a version number in one CLAUDE.md requires updating it in all three

**Phase to address:**
CLAUDE.md rewrite phase. Decide the coupling model (self-contained vs. delegating) before rewriting any file.

---

### Pitfall 10: Losing the "Why" During Documentation Restructuring

**What goes wrong:**
Restructuring documentation focuses on WHERE content lives (which file, which directory, which template section). In the process, the WHY behind decisions is lost. For example, DawSync's CLAUDE.md says "SKIE disabled (waiting for Kotlin 2.3.0+ support)." During restructuring, this might be moved to a "Known Limitations" section or dropped entirely because it seems temporary. But the WHY is critical: if a future agent enables SKIE without knowing the Kotlin version constraint, the build breaks in confusing ways. Similarly, "Navigation: State-driven (NOT Channel-based)" loses its force if restructured as just "Navigation: State-driven" -- the anti-pattern instruction is the valuable part.

**How to avoid:**
- Preserve anti-pattern instructions ("NOT X", "NEVER Y") verbatim. These are more valuable than positive instructions because they prevent specific mistakes the developer has already encountered.
- For each "temporary" note (like "waiting for X support"), add a condition: "Remove this note when [specific version/condition] is met." This makes the note self-documenting about when it can be cleaned up.
- During restructuring, maintain a "decision log" section in each CLAUDE.md that captures the WHY behind non-obvious rules. Even a one-line comment helps: `# AGP 9+ circular dependency bug -- see github.com/issue/123`

**Warning signs:**
- Restructured doc says "do X" without saying "NOT Y" (lost the anti-pattern)
- A temporary workaround note is removed because "it clutters the clean structure"
- An AI agent makes a mistake that was previously prevented by an instruction that was removed or softened during restructuring
- Decision rationale is in git commit messages instead of in the docs themselves

**Phase to address:**
All documentation phases. Every content move or rewrite should preserve the "why" and the "not."

---

### Pitfall 11: Documentation Serves Humans OR Agents, Not Both

**What goes wrong:**
The milestone says documentation must serve "both human readers AND AI agents." These audiences have conflicting needs. Humans want narrative explanations, diagrams, examples, and context. AI agents want concise rules, exact commands, and structured data. Optimizing for one degrades the experience for the other. A CLAUDE.md written for human readability ("Our architecture follows clean architecture principles, separating concerns across layers...") is wasted tokens for an AI agent that needs "Domain layer MUST NOT import from Data layer." A CLAUDE.md written for AI agents ("Rule: sealed interface for UiState. Rule: rethrow CancellationException.") is unreadable for a human trying to understand the project.

**How to avoid:**
- Separate the audiences by file type. CLAUDE.md files are for AI agents: concise, imperative, rule-based. docs/ files are for humans: narrative, explanatory, contextual. The two audiences should not share the same file (except for docs/ files that an AI agent reads on-demand for deeper context).
- CLAUDE.md style guide: bullet points, not paragraphs. "DO X" / "DO NOT Y" format. Tables for structured data. No motivational text. No "we believe in clean architecture" -- just "Architecture layer rules: [table]."
- docs/ style guide: narrative explanations, diagrams, code examples, rationale sections. These are human-first documents that AI agents consult when they need depth.
- Test with both audiences: after writing, read the CLAUDE.md as an AI agent would (literally, token by token). Read the docs/ as a new developer would (following the getting-started flow).

**Warning signs:**
- CLAUDE.md contains paragraphs of explanation (human-optimized, agent-wasteful)
- docs/ files contain terse bullet lists with no context (agent-optimized, human-unfriendly)
- A single document tries to serve both audiences and serves neither well
- CLAUDE.md exceeds 200 lines because it includes explanatory context alongside rules

**Phase to address:**
Standard template phase and CLAUDE.md rewrite phase. Define the audience for each file type before creating templates or rewriting content.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copy-paste rules into multiple CLAUDE.md files instead of delegating | Each file is self-contained, works offline | Rule updates require editing 3 files; drift is inevitable | Acceptable for critical rules (5-10 max) that must work in every context |
| Skip DawSync archive audit, just move everything to archive/ | Fast cleanup, looks organized | Unique content is buried; nobody reads archive/ | Never -- the audit IS the deliverable |
| Write templates before consolidating DawSync docs | Templates feel productive, visible output | Templates are based on assumptions, not evidence from actual consolidation | Never -- consolidate first, extract patterns second |
| Inline all L0 rules in L2 CLAUDE.md to avoid delegation | No cross-project dependencies | L2 file becomes 400+ lines; rule drift between L0 and L2 copies | Only for the 5-10 most critical rules (sealed interface, CancellationException, etc.) |
| Use relative paths for cross-project references | Simpler to write | Breaks when projects are in different directories or different machines | Never -- use absolute paths or well-known conventions (~/.claude/) |
| Skip vault sync verification after consolidation | Faster milestone completion | Vault serves stale content silently; trust in vault degrades | Never -- verification is the only way to catch stale vault content |
| Auto-generate CLAUDE.md from docs/ using a script | One source of truth, always in sync | Generated content is generic; loses hand-crafted anti-patterns and contextual rules | Never for the main CLAUDE.md; acceptable for secondary reference sections |

## Integration Gotchas

Common mistakes when connecting documentation coherence to the existing system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CLAUDE.md + ~/.claude/docs/ | Referencing all 8 pattern docs from root CLAUDE.md (loads 4,343 lines on every session) | Reference pattern docs from subdirectory CLAUDE.md files so they load only when relevant |
| DawSync CLAUDE.md + "Mandatory Doc Consultation" table | Table tells agent to read docs before any code change, burning tokens even for trivial edits | Move consultation instructions to per-directory CLAUDE.md files (lazy loading) |
| Standard templates + existing DawSync docs | Applying template retroactively to 132 existing files (massive rework for marginal benefit) | Apply template to new/rewritten docs only; existing docs get template compliance gradually |
| L0/L1/L2 references + composite builds | Using `../shared-kmp-libs/CLAUDE.md` relative path that breaks on different machines | Use absolute paths via env vars or `~/.claude/` convention |
| Vault sync + doc consolidation | Updating vault config after consolidation is complete (stale window) | Update vault config in same commit as each doc move/rename |
| CLAUDE.md rewrite + quality gate agents | Rewriting CLAUDE.md without updating quality gate agent instructions that reference CLAUDE.md content | Grep quality gate agents for CLAUDE.md-derived rules; update in same PR |
| Doc structure templates + Copilot instructions | Creating doc templates in Copilot instruction format alongside Claude format (doubling work) | Templates are markdown -- tool-agnostic. Only CLAUDE.md and skills need multi-tool variants |

## Performance Traps

Patterns that work at small scale but fail as documentation grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| CLAUDE.md referencing all docs/ as "required reading" | Agent spends 30+ seconds reading docs before starting work; context fills up before any code analysis | Only reference docs from subdirectory CLAUDE.md files relevant to that directory | At 10+ docs referenced, or when total referenced content exceeds 2,000 lines |
| Single INDEX.md listing all 100+ docs with descriptions | Agent reads entire index to find one doc; wasted tokens on irrelevant entries | Separate indexes per topic (architecture-index, testing-index, business-index) | At 30+ docs in a single index |
| Comprehensive cross-reference validation script | Script takes 30+ seconds scanning all repos on every run; developers stop running it | Validate only changed files' references, not all references on every run | At 50+ cross-references across 3 repos |
| DawSync CLAUDE.md with full module structure listing | 232 lines loaded on every session; most is reference material the agent rarely needs | Keep only rules and build commands in CLAUDE.md; module catalog goes in a separate doc | Current size (232 lines) is already borderline; will break if v1.2 adds more |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **CLAUDE.md rewritten:** Often missing anti-pattern preservation -- verify every "NEVER X" and "NOT Y" from the old files appears in the new files
- [ ] **DawSync docs consolidated:** Often missing archive audit trail -- verify a consolidation manifest exists mapping every source file to its destination
- [ ] **L0/L1/L2 references added:** Often missing direction enforcement -- verify L0 never references L1/L2 projects by name
- [ ] **Standard templates created:** Often missing audience separation -- verify templates distinguish AI-agent docs (CLAUDE.md) from human-readable docs (docs/)
- [ ] **Vault sync updated:** Often missing verification step -- verify vault contents match expected file list after sync runs
- [ ] **Cross-references working:** Often missing staleness check -- verify referenced files actually exist at the specified paths
- [ ] **Context budget met:** Often missing measurement -- verify initial CLAUDE.md token load is under 4,000 tokens per project using `/context` command
- [ ] **Templates tested:** Often missing real-world usage -- verify at least one DawSync doc was successfully created using the template before declaring it done
- [ ] **Consolidated docs are findable:** Often missing navigation -- verify a new developer can find the right doc for a given task without full-text search

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| CLAUDE.md rewrite breaks agent behavior (#1) | LOW | Restore from CLAUDE.md.previous backup; diff to find lost rules; reapply selectively |
| Content lost during consolidation (#2) | MEDIUM | Git history preserves all content; use `git log --all -- docs/archive/FILENAME.md` to find and restore; time cost is in re-reading and re-organizing |
| Cross-references go stale (#3) | LOW | Run reference validation script; fix broken paths; add validation to quality gate |
| Context window budget exceeded (#4) | MEDIUM | Requires restructuring CLAUDE.md files to use lazy loading; move content to subdirectory files; re-measure |
| Templates too rigid/loose (#5) | LOW | Templates are markdown -- just edit them. The real cost is re-applying to docs already written with the old template |
| Vault sync serves stale content (#6) | LOW | Re-run vault sync with corrected paths; verify with manifest; damage is limited to readers who consumed stale content |
| Over-engineered doc infrastructure (#7) | MEDIUM | Delete infrastructure scripts that are not providing value; simplify to manual checks; sunk cost of development time |
| Mega-docs from over-consolidation (#8) | MEDIUM | Split documents along section boundaries; update all references to point to new split files |
| Unnecessary coupling between CLAUDE.md files (#9) | MEDIUM | Make each file self-contained by duplicating critical rules; remove cross-references that create coupling |
| Lost "why" in restructuring (#10) | HIGH | Git history may preserve rationale in commit messages, but finding it is expensive; if the why is truly lost, it requires re-deriving the reasoning or accepting the knowledge gap |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| CLAUDE.md rewrite breaks behavior (#1) | CLAUDE.md rewrite phase | Side-by-side diff of old vs new; smoke test in Claude Code session |
| Content lost in consolidation (#2) | DawSync doc audit phase | Consolidation manifest with every file mapped to destination |
| Cross-references stale/circular (#3) | L0/L1/L2 delegation phase | Reference registry exists; all references resolve; no L0->L2 references |
| Context window budget exceeded (#4) | CLAUDE.md rewrite + template phase | `/context` measurement shows <4,000 tokens initial load per project |
| Templates too rigid/loose (#5) | Template phase (after DawSync consolidation) | At least 3 different doc types successfully use the templates |
| Vault sync stale (#6) | Coupled to DawSync consolidation phase | Vault manifest matches expected files; no stale content |
| Over-engineered infrastructure (#7) | All phases (budget constraint) | Doc infrastructure is <20% of total milestone effort |
| Mega-docs (#8) | DawSync consolidation phase | No doc exceeds 500 lines; total file count >15 |
| Unnecessary CLAUDE.md coupling (#9) | CLAUDE.md rewrite phase | Each CLAUDE.md works standalone; editing one does not require editing others |
| Lost "why" (#10) | All phases | Every "NEVER X" and decision rationale preserved in new structure |
| Human vs agent audience conflict (#11) | Template + CLAUDE.md rewrite phase | CLAUDE.md files are rule-based; docs/ files are narrative |

## Sources

- Direct analysis of existing CLAUDE.md files: ~/.claude/CLAUDE.md (100 lines), shared-kmp-libs/CLAUDE.md (57 lines), DawSync/CLAUDE.md (232 lines)
- Direct analysis of DawSync docs/ structure: 132 markdown files, 33,618 total lines, 31 archived documents
- Direct analysis of ~/.claude/docs/: 8 pattern files, 4,343 total lines
- [CLAUDE.md organization in monorepo with too many contexts](https://dev.to/anvodev/how-i-organized-my-claudemd-in-a-monorepo-with-too-many-contexts-37k7) -- hierarchical CLAUDE.md reduces context from 47k to 9k words (80% reduction)
- [Multi-repo context loading with Claude Code](https://blackdoglabs.io/blog/claude-code-decoded-multi-repo-context) -- 40-60% token budget wasted on cross-repo context duplication
- [Official Anthropic CLAUDE.md guidance](https://claude.com/blog/using-claude-md-files) -- keep concise, avoid inflating, iterate based on friction
- [Context engineering for AI agents](https://www.flowhunt.io/blog/context-engineering-ai-agents-token-optimization/) -- system instructions consume 10-15% of budget; strategic allocation required
- [Context window management strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) -- dynamic budget allocation across components
- [Documentation consolidation pitfalls](https://document360.com/blog/developer-documentation-mistakes/) -- 77% of teams lack formal doc organization
- [Content migration strategies](https://3di-info.com/tips-for-content-migration/) -- audit before migration, manifest-driven approach
- [Docs-as-code topologies](https://passo.uno/docs-as-code-topologies/) -- federated content requires discipline and robust orchestration
- Project memory: L0/L1/L2 architecture from project_ecosystem_architecture.md

---
*Pitfalls research for: AndroidCommonDoc v1.2 -- Documentation Coherence & Context Management*
*Researched: 2026-03-14*