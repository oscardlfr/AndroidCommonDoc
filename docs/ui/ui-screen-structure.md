---
scope: [ui, compose, screens, accessibility]
sources: [compose-ui, compose-material3]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 1206
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "Screen structure: Screen+Content split, design system components, state handling, accessibility, test tags"
slug: ui-screen-structure
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

# Screen Structure Patterns

## Overview

Patterns for structuring Compose screens: the Screen+Content split, design system component usage, state handling, accessibility checklists, and test tags.

**Core Principle**: Split every screen into a Screen composable (state collection, callbacks) and a Content composable (pure presentation). This enables Compose previews and simplifies testing.

---

## 1. Screen + Content Split

### Pattern

1. **Screen Composable** - Handles high-level concerns: collecting state, navigation effects, wiring callbacks.
2. **Content Composable** - Pure presentation: receives data and callbacks, renders UI.

```kotlin
@Composable
fun SnapshotListScreen(
    onNavigateToDetail: (String) -> Unit,
    viewModel: SnapshotListViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    SnapshotListContent(
        uiState = uiState,
        onSnapshotClick = { snapshot -> onNavigateToDetail(snapshot.id) },
        onRefresh = { viewModel.refresh() }
    )
}

@Composable
private fun SnapshotListContent(
    uiState: SnapshotListUiState,
    onSnapshotClick: (Snapshot) -> Unit,
    onRefresh: () -> Unit
) {
    // Pure presentation
}
```

### Anti-Pattern

```kotlin
// BAD: Business logic in composable -- untestable, mixed concerns
@Composable
fun SnapshotListScreen(repository: SnapshotRepository) {
    var snapshots by remember { mutableStateOf<List<Snapshot>>(emptyList()) }
    LaunchedEffect(Unit) {
        snapshots = repository.getSnapshots()  // Data fetching in UI
    }
}
```

> **KMP Note**: Use `collectAsStateWithLifecycle()` on Android (lifecycle-aware). On Desktop/KMP commonMain, use `collectAsState()` instead.

---

## 2. Design System Components

Use semantic components from the design system instead of raw platform primitives.

| Function | Semantic Component | Raw Equivalent |
|----------|-------------------|----------------|
| Page title | `PageHeadline` | `Text` with headline style |
| Body text | `BodyMessage` | `Text` with body style |
| Primary action | `PrimaryButton` | `Button` |
| Secondary action | `SecondaryButton` | `OutlinedButton` |
| Text input | `PrimaryTextField` | `OutlinedTextField` |
| Loading overlay | `LoadingOverlay` | `Box` + `CircularProgressIndicator` |
| Error banner | `ErrorBanner` | `Card` with error colors |
| State handler | `StateLayout` / `StateView` | Manual `when` block |

---

## 3. State Handling

### StateLayout / StateView

```kotlin
StateLayout(
    uiState = uiState,
    onLoading = { LoadingOverlay(message = stringResource(Res.string.loading)) },
    onError = { message -> RetryableErrorScreen(message = message.asString(), onRetry = onRetry) },
    onSuccess = { data -> SuccessContent(data) }
)
```

### Overlay vs Banner

| Component | Behavior | Use Case |
|-----------|----------|----------|
| `LoadingOverlay` | Blocks interaction | Long-running operations |
| `ErrorBanner` | Non-blocking, top of screen | Transient errors user can dismiss |

---

## 4. Accessibility

### Checklist

- All user-facing text uses `stringResource` (never hardcoded)
- Page titles marked as headings: `Modifier.semantics { heading() }`
- Interactive elements have content descriptions
- Touch targets at least 48dp
- Loading and error states announced via `LocalAccessibilityAnnouncer`

### Form Accessibility

- **No auto-focus** on screen load; let TalkBack control navigation
- Use `label` parameter on text fields (not just placeholder)
- Configure `ImeAction.Next` / `ImeAction.Done` for keyboard navigation

### Automated Testing (Android)

```kotlin
@get:Rule
val composeTestRule = createComposeRule().apply {
    enableAccessibilityChecks()
}

@Test
fun screenPassesAccessibilityChecks() {
    composeTestRule.setContent { MyScreen() }
    composeTestRule.onRoot().tryPerformAccessibilityChecks()
}
```

---

## 5. Test Tags

### Centralized Tags

```kotlin
object TestTags {
    object SnapshotList {
        const val LIST = "snapshot_list"
        const val REFRESH_BUTTON = "snapshot_list_refresh"
        fun itemAt(index: Int) = "snapshot_list_item_$index"
    }
}
```

### Apply Tags

```kotlin
LazyColumn(modifier = Modifier.testTag(TestTags.SnapshotList.LIST)) {
    itemsIndexed(snapshots) { index, snapshot ->
        SnapshotItem(modifier = Modifier.testTag(TestTags.SnapshotList.itemAt(index)))
    }
}
```

---

**Parent doc**: [ui-screen-patterns.md](ui-screen-patterns.md)
