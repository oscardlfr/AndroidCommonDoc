---
scope: L0
category: agents
slug: kmp-checks-catalog
sources: ["arch-platform-verdict-wave-b", "BL-W31.7-09"]
targets: [arch-platform, arch-testing, arch-integration]
version: 0.1.0
description: "Six KMP architectural checks for arch-platform per wave."
---

# KMP Checks Catalog

## 1. Source Set Discipline
- commonMain: pure Kotlin ONLY -- no android.*, java.*, platform.* imports
- jvmMain for Android+Desktop -- NEVER duplicate across androidMain + desktopMain
- appleMain for iOS+macOS -- NEVER duplicate across iosMain + macosMain
- File suffixes: .kt (common), .jvm.kt, .apple.kt, .android.kt, .desktop.kt

## 2. Dependency Direction
- impl -> api, never reverse
- -api modules: ONLY interfaces, sealed classes, data classes, enums
- No concrete implementations in -api modules
- No cross-cluster direct dependencies (only via api contracts)

## 3. Five-Layer Model
- UI (Compose/SwiftUI) -> ViewModel -> Domain (UseCases) -> Data (Repos) -> Model
- Each layer depends ONLY on the one below
- No ViewModel importing from UI layer
- No Domain layer importing from Data implementation (only api)

## 4. Convention Plugin Compliance
- All modules use the project convention plugin
- No manual android {} or kotlin {} blocks that duplicate convention plugin config

## 5. Pattern Compliance
- Result<T> for all operations (not kotlin.Result, not exceptions)
- CancellationException rethrown in catch blocks
- UiState as sealed interface (not data class with boolean flags)
- StateFlow with stateIn(WhileSubscribed(5_000))
- No platform deps in ViewModels (no Context, Resources, UIKit)

## 6. Compose Resources
- Resources in src/commonMain/composeResources/ (not custom source sets)
- generateResClass = always for multi-module + composite builds
