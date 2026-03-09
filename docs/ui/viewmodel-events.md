---
scope: [viewmodel, events]
sources: [lifecycle-viewmodel, kotlinx-coroutines]
targets: [android, desktop, ios, jvm]
version: 3
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 796
description: "Event patterns: state-based events via nullable UiState fields, why not Channel or SharedFlow, testing ViewModels"
slug: viewmodel-events
status: active
layer: L0
parent: viewmodel-state-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
category: ui
rules:
  - id: no-channel-for-ui-events
    type: banned-usage
    message: "Use MutableSharedFlow(replay=0) for ephemeral events, never Channel"
    detect:
      in_class_extending: ViewModel
      banned_type: Channel
      prefer: "MutableSharedFlow(replay=0)"
    hand_written: true
    source_rule: NoChannelForUiEventsRule.kt

---

# ViewModel Event Patterns

## Overview

Patterns for ephemeral UI events (Snackbars, Toasts, error banners) in ViewModels. Events are modeled as **nullable fields in UiState** with an `onEventConsumed()` callback to clear them after the UI handles them.

**Core Principle**: Events are just state. A nullable field in UiState represents a pending event; `null` means no event. The event persists until the UI explicitly consumes it, guaranteeing delivery across configuration changes.

---

## Sub-documents

- **[viewmodel-events-consumption](viewmodel-events-consumption.md)**: Event consumption patterns -- state-based event implementation, why not Channel or SharedFlow (comparison tables), multiple event fields, testing ViewModel events (dispatcher setup, test checklist)

---

## References

- [Now in Android - Architecture](https://github.com/android/nowinandroid/blob/main/docs/ArchitectureLearningJourney.md)
- [Kotlin Coroutines Cancellation](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
- [Android Architecture Guide - UI Events](https://developer.android.com/topic/architecture/ui-layer/events)
- Parent doc: [viewmodel-state-patterns.md](viewmodel-state-patterns.md)
