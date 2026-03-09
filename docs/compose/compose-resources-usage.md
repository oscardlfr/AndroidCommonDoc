---
scope: [resources, compose, usage]
sources: [compose-resources, compose-multiplatform]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: compose-hub
token_budget: 1514
description: "Runtime usage patterns: string resources, image loading, font loading, qualifiers, dual resource system"
slug: compose-resources-usage
status: active
layer: L0
parent: compose-patterns

monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
category: compose
rules:
  - id: compose-resources-in-common-main
    type: naming-convention
    message: "Compose resources must be in commonMain/composeResources/"
    detect:
      resource_file_location: true
      required_parent_path: "commonMain/composeResources"
    hand_written: false

---

# Compose Resources: Usage Patterns

## Overview

Runtime usage patterns for Compose Multiplatform resources: accessing strings, images, and fonts in Compose UI and SwiftUI, cross-module resource access, the dual resource system for Compose + Swift platforms, naming conventions, and the UiText pattern for dynamic content.

---

## 1. Usage in Compose UI (Android + Desktop)

```kotlin
// Import from project's resources
import org.jetbrains.compose.resources.stringResource
import com.project.core.designsystem.resources.Res
import com.project.core.designsystem.resources.string.*

@Composable
fun MyScreen() {
    Column {
        // Static string resource
        Text(stringResource(Res.string.common_loading))

        // String with arguments
        Text(stringResource(Res.string.user_count, count))

        // Plurals
        Text(pluralStringResource(Res.plurals.items, count, count))
    }
}
```

---

## 2. Usage in SwiftUI (iOS + macOS)

```swift
struct MyScreen: View {
    var body: some View {
        VStack {
            // Static string
            Text(NSLocalizedString("common_loading", comment: ""))

            // String with format
            Text(String(format: NSLocalizedString("user_count", comment: ""), count))
        }
    }
}
```

---

## 3. Dual Resource System: Compose + Swift

### 3.1 Platform Strategy

| Platform | UI Framework | Resources Source |
|----------|--------------|------------------|
| Android | Jetpack Compose | Compose Resources (`commonMain/composeResources`) |
| Desktop | Compose Desktop | Compose Resources (`commonMain/composeResources`) |
| iOS | SwiftUI (native) | `.xcstrings` or `Localizable.strings` |
| macOS | SwiftUI (native) | `.xcstrings` or `Localizable.strings` |

### 3.2 Resource Organization

**Compose side** (Android + Desktop):
```
core/designsystem/src/commonMain/composeResources/
├── values/
│   └── strings.xml              # English (default)
├── values-es/
│   └── strings.xml              # Spanish
├── values-fr/
│   └── strings.xml              # French
├── drawable/
│   └── ic_*.xml                 # Vector drawables
└── font/
    └── *.ttf                     # Custom fonts
```

**Swift side** (iOS + macOS):
```
iosApp/Resources/
├── Localizable.xcstrings         # Modern approach (Xcode 15+)
└── Assets.xcassets/              # Images, colors
```

### 3.3 Keeping Resources in Sync

**Option A: Manual Sync** (< 200 strings)
- Maintain `strings.xml` for Compose
- Maintain `Localizable.xcstrings` for Swift
- Use same key names across both

**Option B: Generation Script** (> 200 strings)
- Use `strings.xml` as single source of truth
- Generate `Localizable.xcstrings` automatically
- Run as Gradle task: `./gradlew syncResources`

**Same key names across platforms**:

```xml
<!-- composeResources/values/strings.xml -->
<resources>
    <string name="common_loading">Loading...</string>
    <string name="snapshot_list_title">Snapshots</string>
</resources>
```

```json
// iosApp/Resources/Localizable.xcstrings
{
  "common_loading": {
    "en": { "stringUnit": { "value": "Loading..." } }
  }
}
```

---

## 4. UiText Pattern (Dynamic Content from ViewModel)

```kotlin
// ViewModel (in commonMain - iOS compatible)
sealed interface UiText {
    data class StringResource(val key: String, val args: List<Any> = emptyList()) : UiText
    data class DynamicString(val value: String) : UiText
}

_uiState.value = MyUiState.Error(
    message = UiText.StringResource("error_network")
)

// Compose UI
@Composable
fun UiText.asString(): String = when (this) {
    is UiText.DynamicString -> value
    is UiText.StringResource -> stringResource(
        Res.string.getByName(key),
        *args.toTypedArray()
    )
}

// Usage in screen
ErrorBanner(message = state.message.asString())
```

---

## 5. Naming Conventions

### 5.1 String Key Naming

Use consistent prefixes across Compose and Swift:

| Category | Prefix | Example |
|----------|--------|---------|
| Common UI | `common_` | `common_loading`, `common_save`, `common_cancel` |
| Feature-specific | `featurename_` | `snapshot_list_title`, `auth_login_button` |
| Errors | `error_` | `error_network`, `error_permission_denied` |
| Accessibility | `a11y_` | `a11y_button_close`, `a11y_audio_play` |
| Plurals | Use descriptive name | `item_count`, `user_count` |

**Format**: `{category}_{entity}_{descriptor}`

**Examples**:
- `snapshot_list_empty_message`
- `auth_login_email_label`
- `error_network_timeout`
- NOT `snapshotListEmptyMessage` (use underscores, not camelCase)

### 5.2 File Organization

```xml
<!-- values/strings.xml -->
<resources>
    <!-- Common UI strings (alphabetically) -->
    <string name="common_cancel">Cancel</string>
    <string name="common_loading">Loading...</string>
    <string name="common_save">Save</string>

    <!-- Feature-specific strings (grouped by feature) -->
    <string name="snapshot_list_title">Snapshots</string>
    <string name="snapshot_delete_confirm">Delete this snapshot?</string>

    <!-- Errors (alphabetically) -->
    <string name="error_network">Network error</string>
    <string name="error_permission_denied">Permission denied</string>
</resources>
```

---

## References

- [Compose Multiplatform Resources](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-images-resources.html)
- [Kotlin Multiplatform](https://kotlinlang.org/docs/multiplatform.html)
- Parent doc: [compose-resources-patterns.md](compose-resources-patterns.md)
