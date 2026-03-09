---
scope: [resources, lifecycle, desktop]
sources: [compose-runtime, kotlinx-coroutines]
targets: [desktop]
version: 1
last_updated: "2026-03"
assumes_read: resources-hub
token_budget: 1281
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 2
description: "Lifecycle patterns: window focus detection, process monitoring, processing mode state machine, coroutine scope management"
slug: resource-management-lifecycle
status: active
layer: L0
parent: resource-management
category: resources
rules:
  - id: no-platform-deps-in-viewmodel
    type: banned-import
    message: "ViewModels must not import platform-specific APIs (android.*, UIKit.*)"
    detect:
      in_class_extending: ViewModel
      banned_import_prefixes:
        - "android."
        - "platform.UIKit"
        - "platform.Foundation"
    hand_written: true
    source_rule: NoPlatformDepsInViewModelRule.kt

---

# Resource Lifecycle Patterns

## Overview

Patterns for lifecycle-aware resource management in Compose Desktop: window focus detection, external process monitoring, processing mode state machine, and proper coroutine scope management.

**Core Principle**: Desktop apps must detect and respond to focus changes and external process state. Use a state machine to control resource allocation.

---

## 1. Window Focus Detection

### WindowFocusManager

```kotlin
class WindowFocusManager {
    private val _hasFocus = MutableStateFlow(false)
    val hasFocus: StateFlow<Boolean> = _hasFocus.asStateFlow()

    fun attachToWindow(window: ComposeWindow) {
        window.addWindowFocusListener(object : WindowFocusListener {
            override fun windowGainedFocus(e: WindowEvent) {
                _hasFocus.value = true
            }
            override fun windowLostFocus(e: WindowEvent) {
                _hasFocus.value = false
            }
        })
    }
}
```

### Integration with Compose Desktop App

```kotlin
@Composable
fun App(windowFocusManager: WindowFocusManager) {
    val window = rememberComposeWindow()
    LaunchedEffect(Unit) {
        windowFocusManager.attachToWindow(window)
    }
}
```

## 2. Process Monitoring (Java 9+)

### ExternalProcessMonitor

```kotlin
class ExternalProcessMonitor(
    private val monitoredProcessNames: List<String> = listOf(
        "blender", "unity", "unreal", "davinci"
    )
) {
    private val _externalAppIsRunning = MutableStateFlow(false)
    val externalAppIsRunning: StateFlow<Boolean> = _externalAppIsRunning.asStateFlow()

    fun startMonitoring(scope: CoroutineScope) {
        scope.launch {
            while (isActive) {
                val running = isMonitoredProcessRunning()
                _externalAppIsRunning.value = running
                delay(5.seconds)
            }
        }
    }

    private fun isMonitoredProcessRunning(): Boolean {
        return ProcessHandle.allProcesses()
            .anyMatch { process ->
                process.info().command()
                    .map { it.contains(monitoredProcessNames, ignoreCase = true) }
                    .orElse(false)
            }
    }

    fun monitorProcess(processId: Long, onExit: () -> Unit) {
        ProcessHandle.of(processId).ifPresent { process ->
            process.onExit().thenRun(onExit)
        }
    }
}
```

## 3. Processing Mode State Machine

### ProcessingMode

```kotlin
enum class ProcessingMode {
    SILENT,        // 0% CPU - External app has focus
    LOW_PRIORITY,  // 2% CPU - App in background
    FULL_SPEED     // 20% CPU - App has focus
}
```

### ProcessingModeManager

```kotlin
class ProcessingModeManager(
    private val windowFocusManager: WindowFocusManager,
    private val externalProcessMonitor: ExternalProcessMonitor
) {
    private val _mode = MutableStateFlow(ProcessingMode.SILENT)
    val mode: StateFlow<ProcessingMode> = _mode.asStateFlow()

    fun startMonitoring(scope: CoroutineScope) {
        scope.launch {
            combine(
                windowFocusManager.hasFocus,
                externalProcessMonitor.externalAppIsRunning
            ) { hasFocus, externalRunning ->
                when {
                    externalRunning && !hasFocus -> ProcessingMode.SILENT
                    !hasFocus -> ProcessingMode.LOW_PRIORITY
                    else -> ProcessingMode.FULL_SPEED
                }
            }.collect { newMode ->
                if (_mode.value != newMode) {
                    _mode.value = newMode
                }
            }
        }
    }
}
```

## 4. Coroutine Scope Management

```kotlin
@Composable
fun App() {
    val scope = rememberCoroutineScope()
    val supervisorJob = remember { SupervisorJob() }
    val managedScope = remember {
        CoroutineScope(scope.coroutineContext + supervisorJob)
    }

    DisposableEffect(Unit) {
        onDispose {
            supervisorJob.cancel()
        }
    }
}
```

## 5. External Application Configuration

```kotlin
@Composable
fun ResourceSettingsScreen(viewModel: SettingsViewModel) {
    Column {
        Text("External Application Detection")
        Switch(
            checked = viewModel.autoDetection.value,
            onCheckedChange = { viewModel.setAutoDetection(it) }
        )
        if (!viewModel.autoDetection.value) {
            TextField(
                value = viewModel.customProcessName.value,
                onValueChange = { viewModel.setCustomProcessName(it) },
                label = { Text("Process Name") }
            )
        }
        Text("Processing Mode: ${viewModel.currentMode.value}")
    }
}
```

---

**Parent doc**: [resource-management-patterns.md](resource-management-patterns.md)
