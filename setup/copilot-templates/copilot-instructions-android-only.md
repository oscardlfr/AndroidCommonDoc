<!-- GENERATED from docs/*.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
<!-- Filtered for: Android-only projects (KMP sections excluded) -->
# AndroidCommonDoc Coding Patterns

Follow these patterns when writing Kotlin Android code in this project.

## Compose Resources: Troubleshooting

- DON'T: core/designsystem/build.gradle.kts
- DON'T: Two modules with same default package causes Res class collision

- Key insight: Every module with Compose Resources must have a unique `packageOfResClass` to prevent Res class collision.

## Gradle Dependency Management

- DON'T: BAD: Nested module names cause AGP 9+ circular dependency bug
- DO: FLAT module names avoid the AGP 9+ circular dependency bug
- DON'T: BAD: Breaks our project convention of keeping resources in commonMain
- DO: Resources go in src/commonMain/composeResources/ by convention

## Offline-First Architecture: Anti-Patterns and Flow Usage

- DON'T: BAD: Network-first approach -- UI shows nothing until network responds, fails completely when offline
- DO: Offline-first: UI always has data from local DB, network updates arrive asynchronously
- DON'T: BAD: Every screen load makes a network call
- DON'T: BAD: Overwriting remote data without checking for conflicts

- Key insight: Any offline-first system with write operations MUST have a conflict resolution strategy.

## Coroutine Testing Patterns

- DON'T: BAD: Using runBlocking -- no virtual time control, tests are slow and flaky

## Fake and Test Double Patterns

- DON'T: BAD: Mocks are JVM-only, don't work in commonTest, and don't catch interface changes
- DO: Fake implements the real interface -- compiler catches any interface changes

- Key insight: Fakes are compile-time safe, work in commonTest, and behave like the real implementation. Reserve MockK for legacy JVM-only tests where creating a fake is impractical.

## ViewModel Events: Consumption Patterns and Testing

- DON'T: BAD: UseCase runs on real background thread, not controlled by test

- Key insight: Google's current guidance (2024+) recommends modeling events as state. The "fire and forget" philosophy of SharedFlow means events can be silently lost during configuration changes, which leads to poor UX.

## ViewModel Navigation Patterns

- DON'T: BAD: Channel buffers navigation events -- user may see stale navigation after backgrounding the app
- DO: State-driven navigation survives configuration changes and aligns with Now in Android

- Key insight: Navigation is a state transition, not a task. Use state to represent "should navigate" and let the UI react to it.

## ViewModel State: Sealed Interface and UiState Modeling

- DON'T: BAD: Platform dependency makes ViewModel untestable and non-shareable across KMP targets
- DO: (see pattern doc for details)
- DO: (see pattern doc for details)
- DON'T: BAD: Data class with boolean flags allows invalid states (isLoading=true AND error!=null)

- Key insight: If your ViewModel constructor has `Context`, `Resources`, or any `android.*` import, it cannot be shared across KMP targets.
- Key insight: Sealed interfaces make invalid states unrepresentable at compile time.

## Architecture Rules (Enforced by Detekt)

These rules are automatically enforced by the AndroidCommonDoc custom Detekt rule set.
Violations will be flagged during builds and during AI-assisted development via hooks.

- **Sealed UiState**: UiState types must be sealed interface/class, not data class with boolean flags
- **CancellationException**: Always rethrow CancellationException in catch blocks -- never swallow it
- **WhileSubscribed Timeout**: Must specify non-zero timeout (use 5_000ms) in stateIn(WhileSubscribed(...))
- **No Channel for UI Events**: Use MutableSharedFlow for ephemeral events, not Channel
- **No Silent Catch**: catch blocks must not silently swallow exceptions
- **No Hardcoded Strings in ViewModel**: User-facing strings must use UiText/StringResource
- **No Magic Numbers in UseCase**: Use named constants instead of magic literals
