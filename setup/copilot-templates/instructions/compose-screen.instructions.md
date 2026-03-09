---
applyTo: "**/*Screen.kt"
---

# Compose Screen Instructions

## Screen/Content Separation

Always split into a stateful `Screen` composable and a stateless `Content` composable:

```kotlin
@Composable
fun FeatureScreen(viewModel: FeatureViewModel = koinViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    FeatureContent(uiState = uiState, onAction = viewModel::onAction)
}

@Composable
fun FeatureContent(uiState: UiState, onAction: (Action) -> Unit) {
    // Pure UI, no ViewModel reference
}
```

The `Content` composable must have no ViewModel dependency — it receives state and callbacks only. This enables preview and testing.

## Design Components

Use semantic design-system components. Prefer project-level wrappers (e.g., `AppButton`, `AppTextField`) over raw Material components when available.

## Strings

Never hardcode user-facing strings. Always use `stringResource(R.string.key)` or `UiText.asString()`.

## Accessibility

- Set `Modifier.semantics { heading() }` on section headings.
- Minimum touch target size: 48dp.
- Provide `contentDescription` on icons and images that convey meaning.
- Use `Modifier.clearAndSetSemantics {}` to merge decorative elements.

## Test Tags

Add `Modifier.testTag("feature_element")` to interactive elements and key content for UI tests. Use snake_case prefixed with the feature name.

## State Handling

Handle all UiState branches exhaustively with a `when` block. Never leave `else` as a catch-all for sealed interface states.
