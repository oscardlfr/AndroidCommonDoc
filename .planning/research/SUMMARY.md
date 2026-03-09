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
