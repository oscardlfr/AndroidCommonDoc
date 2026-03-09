---
scope: [ui, compose, resources, strings]
sources: [compose-resources, compose-multiplatform]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 1163
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "Component patterns: string resources, UiText, cross-platform resource strategies, implementation checklists"
slug: ui-screen-components
status: active
layer: L0
parent: ui-screen-patterns
category: ui
rules:
  - id: sealed-ui-state
    type: prefer-construct
    message: "UiState must be sealed interface, not data class with boolean flags"
    detect:
      class_suffix: UiState
      must_be: sealed
    hand_written: true
    source_rule: SealedUiStateRule.kt

---

# UI Component and Resource Patterns

## Overview

String resource strategies, UiText for dynamic content, cross-platform resource handling, and implementation checklists for UI screens.

**Core Principle**: Every user-facing string must come from resources. Hardcoded strings break localization and make UI text inconsistent.

---

## 1. String Resources by Platform

| Platform | UI Framework | Resources Source | Usage |
|----------|--------------|------------------|-------|
| Android | Jetpack Compose | Compose Resources | `stringResource(Res.string.*)` |
| Desktop | Compose Desktop | Compose Resources | `stringResource(Res.string.*)` |
| iOS | SwiftUI | `.xcstrings` / `Localizable.strings` | `NSLocalizedString(...)` |
| macOS | SwiftUI | `.xcstrings` / `Localizable.strings` | `NSLocalizedString(...)` |

### Compose Multiplatform (Android + Desktop)

```kotlin
import org.jetbrains.compose.resources.stringResource
import com.project.core.designsystem.resources.Res
import com.project.core.designsystem.resources.string.*

@Composable
fun MyScreen() {
    Column {
        PageHeadline(text = stringResource(Res.string.welcome_title))
        Text(stringResource(Res.string.user_count, count))
        Text(pluralStringResource(Res.plurals.items, count, count))
    }
}
```

### Cross-Module Resource Access

```kotlin
import com.project.feature.myfeature.resources.Res as FeatureRes
import com.project.core.designsystem.resources.Res as DesignRes

@Composable
fun MyFeatureScreen() {
    Text(stringResource(FeatureRes.string.myfeature_title))
    Text(stringResource(DesignRes.string.common_loading))
}
```

### SwiftUI (iOS + macOS)

```swift
struct MyScreen: View {
    var body: some View {
        VStack {
            Text(NSLocalizedString("welcome_title", comment: ""))
            Text(String(format: NSLocalizedString("user_count", comment: ""), count))
        }
    }
}
```

**Key naming rule**: Use same key names in both Compose Resources and Swift resources for consistency.

## 2. UiText for Dynamic Content

ViewModels emit `UiText`; UI resolves it:

```kotlin
// ViewModel (in commonMain - iOS compatible)
sealed interface UiText {
    data class StringResource(val key: String, val args: List<Any> = emptyList()) : UiText
    data class DynamicString(val value: String) : UiText
}

_uiState.value = MyUiState.Error(
    message = UiText.StringResource("error_network")
)

// Compose Screen (in commonMain)
@Composable
fun UiText.asString(): String = when (this) {
    is UiText.DynamicString -> value
    is UiText.StringResource -> stringResource(
        Res.string.getByName(key),
        *args.toTypedArray()
    )
}

ErrorBanner(message = state.message.asString())
```

### Android-Only Projects (R.string)

```kotlin
sealed interface UiText {
    data class StringResource(@StringRes val resId: Int, val args: Array<Any> = emptyArray()) : UiText
    data class DynamicString(val value: String) : UiText
}
```

## 3. Anti-Patterns

```kotlin
// BAD: Hardcoded strings are not localizable
Text("Save")

// GOOD: Use Compose Resources for all static strings
Text(stringResource(Res.string.common_save))

// BAD: Custom source sets for resources
src/composeMain/composeResources/

// GOOD: Resources in commonMain
src/commonMain/composeResources/
```

## 4. Implementation Checklists

### Component Usage
- [ ] Use semantic components from design system
- [ ] Use `PageHeadline`, `BodyMessage`, `PrimaryButton`, etc.
- [ ] Use `StateLayout` for Loading/Error/Success handling
- [ ] No raw `Button`, `Text`, `Surface` for common patterns

### Strings
- [ ] Static text: `stringResource()` or Compose Resources
- [ ] Dynamic text: `UiText.asString()`

### Navigation
- [ ] Simple navigation: callback from NavHost
- [ ] Async navigation: state flag, not Channel
- [ ] Screen results: pass via ViewModel state or navigation arguments

### Accessibility
- [ ] Headings marked
- [ ] Content descriptions present
- [ ] No auto-focus
- [ ] Touch targets >= 48dp

### Testing
- [ ] Test tags on interactive elements
- [ ] Accessibility checks enabled

---

**See [compose-resources-patterns.md](../compose/compose-resources-patterns.md) for complete Compose Resources guide.**

**Parent doc**: [ui-screen-patterns.md](ui-screen-patterns.md)
