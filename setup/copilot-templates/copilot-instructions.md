# {{PROJECT_NAME}} — Copilot Instructions

> Project type: {{PROJECT_TYPE}}

## Architecture

Follow strict layered architecture. Dependencies flow downward only.

| Layer | Contains | Depends On |
|-------|----------|-----------|
| UI | Compose Screens, SwiftUI Views | ViewModel |
| ViewModel | UiState, event handling | UseCases |
| Domain | UseCases, Repository interfaces | Model |
| Data | Repository impls, DataSources | Domain + Platform |
| Model | Data classes, enums, sealed types | Nothing |

Never reference a higher layer from a lower layer. Data layer implements Domain interfaces — Domain never imports Data.

## ViewModel Rules

- UiState: ALWAYS a sealed interface. NEVER a data class with boolean flags like `isLoading`.
- Expose state via `StateFlow` with `stateIn(WhileSubscribed(5_000))`.
- Ephemeral events (snackbars, toasts): Use `MutableSharedFlow`. NEVER use `Channel`.
- Navigation: State-driven. NEVER use Channel-based navigation events.
- NO platform dependencies in ViewModels — no `Context`, `Resources`, `UIKit` types.
- Use `UiText` (StringResource / DynamicString) for all user-facing strings.

## Error Handling

- Use `com.example.shared.core.result.Result<T>` for all fallible operations.
- ALWAYS rethrow `CancellationException` in catch blocks:
  ```kotlin
  catch (e: Exception) {
      if (e is CancellationException) throw e
      // handle error
  }
  ```
- Use the `DomainException` hierarchy from `core-error` for typed domain errors.
- Never swallow exceptions silently. Map to `Result.Error` with a meaningful `DomainException`.

## Testing

- Prefer pure-Kotlin fakes over mocks (e.g., `FakeRepository`, `FakeClock`).
- Use `runTest` for ALL coroutine tests.
- Use `StandardTestDispatcher` for ViewModels that have `delay` loops or scheduled work.
- Use `UnconfinedTestDispatcher` when subscribing to `StateFlow` in `backgroundScope`.
- Subscribe to `StateFlow` BEFORE performing actions — otherwise emissions are missed.
- Inject `testDispatcher` into UseCases instead of relying on `Dispatchers.Default`.
- Call `advanceUntilIdle()` to flush pending coroutine work.
- ALWAYS rethrow `CancellationException` in test fakes too.

## KMP Source Set Rules

> Applies to Kotlin Multiplatform projects only.

- ALWAYS use `applyDefaultHierarchyTemplate()` in KMP modules.
- `commonMain`: Pure Kotlin ONLY. No `android.*`, `java.*`, or platform-specific imports.
- `jvmMain`: Shared JVM code when Android + Desktop need the same implementation.
- `appleMain`: Shared Apple code when iOS + macOS need the same implementation.
- DO NOT duplicate code across `androidMain` + `desktopMain` — use `jvmMain`.
- DO NOT duplicate code across `iosMain` + `macosMain` — use `appleMain`.

### File Naming by Source Set

| Source Set | Suffix | Example |
|------------|--------|---------|
| commonMain | `.kt` | `SnapshotRepository.kt` |
| jvmMain | `.jvm.kt` | `AudioPlayer.jvm.kt` |
| appleMain | `.apple.kt` | `AudioPlayer.apple.kt` |
| androidMain | `.android.kt` | `AudioPlayer.android.kt` |
| desktopMain | `.desktop.kt` | `AudioPlayer.desktop.kt` |

## Navigation

- Use Navigation3 (`androidx.navigation3`) with `@Serializable` routes for Compose (Android + Desktop).
- iOS/macOS use native SwiftUI `NavigationStack`.
- Navigation is state-driven. Never emit navigation events via Channel or SharedFlow.

## DI (Koin)

- Module declarations live in each module's `di/` package.
- Use `koinViewModel()` in Compose.
- In tests, initialize Koin before Activity launch.

## Module Naming

- Use FLAT module names: `core-json-api`, `core-network-ktor`.
- NEVER use nested modules like `core-json:api` (AGP 9+ circular dependency bug).
