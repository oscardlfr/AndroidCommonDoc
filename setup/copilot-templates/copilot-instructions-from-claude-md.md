<!-- GENERATED from CLAUDE.md files -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/claude-md-copilot-adapter.sh -->
# Coding Instructions

These instructions are generated from the CLAUDE.md ecosystem (L0 global + project-specific).
Follow these rules when writing code in this project.

## KMP Source Set Rules

- Default hierarchy template is automatic since Kotlin 1.9.20 (only call `applyDefaultHierarchyTemplate()` explicitly when reapplying after custom source set configuration)
- commonMain: Pure Kotlin ONLY (no android.*, java.*, platform.* imports)
- jvmMain: Shared JVM code when Android + Desktop need same impl
- appleMain: Shared Apple code when iOS + macOS need same impl
- DO NOT duplicate code across androidMain + desktopMain -- use jvmMain
- DO NOT duplicate code across iosMain + macosMain -- use appleMain
- See ~/.claude/docs/kmp-architecture.md for full hierarchy

## Module Naming

- FLAT names: `core-json-api`, `core-network-ktor` (NOT nested `core-json:api`)
- Reason: AGP 9+ circular dependency bug with nested modules

## Architecture

| Layer | Contains | Depends On |
|-------|----------|-----------|
| UI | Compose Screens, SwiftUI Views | ViewModel |
| ViewModel | UiState, event handling | UseCases |
| Domain | UseCases, Repository interfaces | Model |
| Data | Repository impls, DataSources | Domain + Platform |
| Model | Data classes, enums, sealed types | Nothing |

## Error Handling

- Use `com.example.shared.core.result.Result<T>` for all operations
- ALWAYS rethrow CancellationException in catch blocks
- DomainException hierarchy from core-error for typed errors

## ViewModel Rules

- UiState: ALWAYS sealed interface (NEVER data class with boolean flags)
- Expose via StateFlow with `stateIn(WhileSubscribed(5_000))`
- Ephemeral events: state-based (nullable UiState field + onEventConsumed callback, NOT Channel or MutableSharedFlow)
- Navigation: State-driven (NOT Channel-based)
- NO platform deps in ViewModels (no Context, Resources, UIKit)
- UiText for user-facing strings (StringResource / DynamicString)

## Testing Rules

- Pure-Kotlin fakes over mocks (FakeRepository, FakeClock)
- `runTest` for ALL coroutine tests
- Sequential execution: `maxParallelForks = 1` (file locking on Windows)
- StateFlow: subscribe in backgroundScope with UnconfinedTestDispatcher BEFORE actions
- Schedulers: test via triggerNow(), NEVER test infinite loops directly
- Inject testDispatcher into UseCases (not Dispatchers.Default)
- See ~/.claude/docs/testing-patterns.md for full patterns

## DI (Koin 4.1.1)

- Module declarations in each module's `di/` package
- `koinViewModel()` in Compose
- Koin before Activity launch in tests

## Navigation

- Navigation3 (androidx.navigation3) with @Serializable routes
- Shared across Android + Desktop Compose
- iOS/macOS use native SwiftUI NavigationStack

## Compose Resources

- Resources MUST be in `src/commonMain/composeResources/` (NOT custom source sets)
- `generateResClass = always` for multi-module + composite builds

## File Naming

| Source Set | Suffix | Example |
|------------|--------|---------|
| commonMain | `.kt` | `SnapshotRepository.kt` |
| jvmMain | `.jvm.kt` | `AudioPlayer.jvm.kt` |
| appleMain | `.apple.kt` | `AudioPlayer.apple.kt` |
| androidMain | `.android.kt` | `AudioPlayer.android.kt` |
| desktopMain | `.desktop.kt` | `AudioPlayer.desktop.kt` |

## Build Patterns

- Composite builds: `includeBuild("../shared-libs")` with dependencySubstitution
- Version catalog from `shared-libs` is canonical
- Convention plugins in build-logic/ for module boilerplate
- Kover for coverage

## Git Flow for Agent Teams

- Each teammate works on their OWN feature branch (never develop or main)
- Commit after each logical unit of work
- DO NOT merge into develop -- the lead handles all merges
- DO NOT rebase onto develop -- the lead handles conflict resolution
- If you need code from another teammate's branch, message the lead
- Branch naming: feature/{milestone}-{module} (e.g., feature/cloud-auth)

## Worktree Rules for Parallel Tracks

- When using worktrees: each track has its own worktree with isolated working tree
- Worktree agents MUST stay in their worktree directory -- never cd to the main working tree
- GSD branching configured per-project in `.planning/config.json` (`git.phase_branch_template`)

## Agent Team File Ownership

- Teammates MUST NOT edit files owned by another teammate
- File ownership follows module boundaries: one teammate per module
- Shared files (build.gradle.kts, DI modules) require lead coordination
- When a teammate needs changes in another's module, send a message -- do not edit directly
- Test files follow the same ownership as their source module

## MCP Server

- Located in `mcp-server/` -- Node.js TypeScript, tested with Vitest
- Exposes pattern docs, skills registry, validation tools via MCP protocol
- Key tools: find-pattern, validate-doc-structure, validate-skills, validate-claude-md, monitor-sources, sync-vault
- Run tests: `cd mcp-server && npm test`
- Resources use `docs://` URI scheme

## Skills & Agents

- Skills in `skills/*/SKILL.md` -- each skill has frontmatter (allowed-tools, description, etc.)
- Agents in `skills/agents/*/AGENT.md`
- Commands in `commands/` -- shell scripts, some generated by adapters
- Registry: `skills/registry.json` catalogs all L0 skills, agents, commands
- L1/L2 projects consume L0 via `l0-manifest.json` + `/sync-l0` skill

## Pattern Docs

- Located in `docs/` with domain-based subdirectories (architecture, testing, ui, etc.)
- All docs have YAML frontmatter (scope, sources, targets, category, slug)
- Hub docs <100 lines, sub-docs <300 lines, absolute max 500 lines
- Cross-references use relative paths between subdirectories

## Development Rules

- Konsist tests in `konsist-tests/` -- architecture enforcement for consuming projects
- Guard templates in `guard-templates/` -- parameterized tests for L1/L2
- Detekt rules in `detekt-rules/` -- generated from pattern doc frontmatter
- Adapters in `adapters/` -- Claude Code and Copilot instruction generation
- Version manifest: `versions-manifest.json` -- canonical version tracking

