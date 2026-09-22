<!-- GENERATED from CLAUDE.md files -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/claude-md-copilot-adapter.sh -->
# Coding Instructions

These instructions are generated from the CLAUDE.md ecosystem (L0 global + project-specific).
Follow these rules when writing code in this project.

## Workflow

- GSD is available via `gsd` CLI and `/gsd:` skills when explicitly invoked
- Respect .gsd/ directories if present, but do NOT require GSD for any workflow
- Detailed pattern docs at ~/.claude/docs/ -- consult when you need depth
- Never skip verification steps
- NEVER invoke agents prefixed with `gsd-` unless a `/gsd:` skill explicitly requests it
- `gsd-*` agents are GSD-internal — they depend on .planning/.gsd/ state files
- For native workflows, use L0 equivalents: `debugger`, `verifier`, `advisor`, `researcher`, `codebase-mapper`
- Project-specific agents (daw-guardian, data-layer-specialist, etc.) live in their project's `.claude/agents/`, not in user-global
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- After ANY correction from the user: save feedback to memory with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review memories at session start for relevant project
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes -- don't over-engineer
- Challenge your own work before presenting it
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -- then resolve them
- Zero context switching required from the user
- Go fix failing tests without being told how

## Architecture

- UI (Compose/SwiftUI) -> ViewModel (UiState) -> Domain (UseCases) -> Data (Repos) -> Model (data classes)
- Each layer depends ONLY on the one below it
- commonMain: Pure Kotlin ONLY (no android.*, java.*, platform.* imports)
- jvmMain for Android+Desktop shared code -- NEVER duplicate across androidMain + desktopMain
- appleMain for iOS+macOS shared code -- NEVER duplicate across iosMain + macosMain
- Suffixes: `.kt` (common), `.jvm.kt`, `.apple.kt`, `.android.kt`, `.desktop.kt`
- FLAT names: `core-json-api`, `core-network-ktor` (NOT nested `core-json:api`) -- AGP 9+ bug
- Composite builds: `includeBuild("../shared-kmp-libs")` with dependencySubstitution
- Version catalog from the shared library project is canonical
- **Catalog-first**: before adding a dep to local `libs.versions.toml`, check if it exists in the imported catalog (`sharedLibs`). Prefer shared catalog to prevent version drift
- Composite build (Gradle) and `SharedSdk.init()` (Koin DI) are complementary: build-time module visibility vs runtime wiring. Both required, neither replaces the other

## Patterns

- `com.grinx.shared.core.result.Result<T>` for ALL operations
- ALWAYS rethrow CancellationException in catch blocks
- DomainException hierarchy from core-error for typed errors
- UiState: ALWAYS sealed interface (NEVER data class with boolean flags)
- Expose via StateFlow with `stateIn(WhileSubscribed(5_000))`
- Ephemeral events: `MutableSharedFlow<T>(replay = 0)` collected in `LaunchedEffect` — NOT Channel (drops events on slow collectors)
- Navigation: state-driven (NOT Channel-based)
- NO platform deps in ViewModels (no Context, Resources, UIKit)
- UiText for user-facing strings (StringResource / DynamicString)
- Pure-Kotlin fakes over mocks (FakeRepository, FakeClock)
- `runTest` for ALL coroutine tests
- Sequential: `maxParallelForks = 1` (file locking on Windows)
- ViewModels: `combine()` + `stateIn(WhileSubscribed)` — see [testing-patterns-dispatcher-scopes](docs/testing/testing-patterns-dispatcher-scopes.md)
- Inject testDispatcher into ViewModels and UseCases — never hardcode Dispatchers.* (exception: benchmarks need Dispatchers.Default for real contention)
- Koin 4.1.1: module declarations in each module's `di/` package
- `koinViewModel()` in Compose, Koin before Activity launch in tests
- **Desktop**: `SharedSdk.init()` returns isolated `koinApplication` — wrap Compose tree in `KoinIsolatedContext(context = app)` so `koinViewModel()` works. Do NOT use `GlobalContext.startKoin()` (double eager-init). Wrap init in `remember` to prevent double-init on recomposition
- **Android**: `startKoin {}` in `Application.onCreate()` registers globally by default — `koinViewModel()` works without bridge
- **iOS/macOS**: No Compose — resolve via `SharedSdk.koin.get<T>()` directly
- Navigation3 with @Serializable routes for Android+Desktop; SwiftUI NavigationStack for iOS/macOS

## Constraints

- Compose Resources MUST be in `src/commonMain/composeResources/` (NOT custom source sets)
- `generateResClass = always` for multi-module + composite builds
- Convention plugins in build-logic/ for module boilerplate, Kover for coverage
- Each teammate works on OWN feature branch (never develop or main)
- DO NOT merge into develop -- the lead handles all merges
- Teammates MUST NOT edit files owned by another teammate
- Worktree agents MUST stay in their worktree directory

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

## Doc Consultation

- Vault sync → `mcp-server/src/vault/` (transformer, moc-generator, wikilink-generator)
- New skill → `skills/sync-vault/SKILL.md` as canonical example
- L0→L1/L2 propagation → `skills/sync-l0/SKILL.md`
- Pattern docs → `docs/` with category hubs (17 domains, 81+ sub-docs)
- Upstream validation → `docs/guides/upstream-validation.md` (validate_upstream frontmatter)
- Detekt rules → `detekt-rules/` + `docs/guides/detekt-config.md`
- Spec-driven workflow → `docs/agents/spec-driven-workflow.md`
- Agent templates → `setup/agent-templates/` (product-strategist, content-creator, landing-page-strategist; orchestration guide at `docs/agents/main-agent-orchestration-guide.md`)
- Note: `setup/agent-templates/team-lead.md` deprecated W31.6 — see `docs/agents/main-agent-orchestration-guide.md`
- Business doc templates → `setup/doc-templates/business/` (PRODUCT_SPEC, MARKETING, PRICING, LANDING_PAGES, COMPETITIVE)
- MCP tools → 46 tools via ~/.mcp.json — architects/specialists must declare them in `tools:` frontmatter to call them (Wave 25 fix: prose references alone don't load schemas)
- Dependency freshness → `check-outdated` MCP tool (TOML parser, Maven Central, kdoc-state v2 cache)

