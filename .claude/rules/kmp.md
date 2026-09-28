---
paths:
  - "**/*.kt"
  - "**/*.kts"
  - "**/gradle/**"
  - "**/libs.versions.toml"
  - "detekt-rules/**"
  - "konsist-tests/**"
---

# KMP rules

- Keep `commonMain` pure Kotlin. Platform APIs belong in the narrowest platform source set.
- Share Android/Desktop implementations in `jvmMain` and Apple implementations in `appleMain`; do not duplicate them across leaf source sets.
- Use flat Gradle module names. Check the shared version catalog before adding a local dependency.
- UI depends on ViewModel, then Domain, Data and Model; dependencies never point upward.
- ViewModels expose sealed `UiState` through `StateFlow` and have no platform dependencies.
- User-facing ViewModel strings use `UiText` with `StringResource` or `DynamicString`.
- Ephemeral UI events use `MutableSharedFlow(replay = 0)` unless a project-specific state-event contract explicitly overrides this.
- Rethrow `CancellationException`; use typed domain failures and the canonical `Result<T>` abstraction.
- Compose resources live in `src/commonMain/composeResources/`.
- Consult `docs/architecture/kmp-architecture.md` and the relevant domain hub before changing a public pattern.
