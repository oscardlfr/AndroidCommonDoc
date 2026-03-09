---
scope: [resources, memory, shutdown]
sources: [kotlinx-coroutines, compose-runtime]
targets: [desktop]
version: 1
last_updated: "2026-03"
assumes_read: resources-hub
token_budget: 1295
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 2
description: "Resource management: resource-aware file watching, graceful shutdown, anti-patterns, testing patterns"
slug: resource-management-memory
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

# Resource Management and Shutdown Patterns

## Overview

Patterns for resource-aware operations, graceful shutdown, anti-patterns to avoid, and testing resource management logic.

**Core Principle**: Every background coroutine must have a lifecycle owner. Use shutdown hooks with timeouts for cleanup. Never use GlobalScope.

---

## 1. Resource-Aware FileWatcher

```kotlin
class ConditionalFileWatcher(
    private val delegate: FileWatcher,
    private val processingModeManager: ProcessingModeManager
) : FileWatcher by delegate {

    override fun watch(): Flow<FileEvent> {
        return delegate.watch()
            .filter {
                processingModeManager.mode.value != ProcessingMode.SILENT
            }
    }
}
```

## 2. Graceful Shutdown

### ShutdownManager

```kotlin
class ShutdownManager(
    private val timeout: Duration = 10.seconds
) {
    private val tasks = mutableListOf<suspend () -> Unit>()

    fun registerShutdownTask(task: suspend () -> Unit) {
        tasks.add(task)
    }

    fun installShutdownHook() {
        Runtime.getRuntime().addShutdownHook(Thread {
            runBlocking {
                withTimeoutOrNull(timeout) {
                    tasks.forEach { task ->
                        try { task() } catch (e: Exception) {
                            println("[Shutdown] Task failed: ${e.message}")
                        }
                    }
                }
            }
        })
    }
}
```

### Usage

```kotlin
fun main() {
    val shutdownManager = ShutdownManager()
    shutdownManager.registerShutdownTask { fileWatcher.stop() }
    shutdownManager.registerShutdownTask { database.close() }
    shutdownManager.installShutdownHook()

    application { /* ... */ }
}
```

## 3. Anti-Patterns

### Ignoring Focus State

**DON'T:**
```kotlin
// BAD: Running intensive tasks regardless of focus wastes CPU
class BackgroundProcessor(scope: CoroutineScope) {
    fun start() {
        scope.launch {
            while (isActive) {
                performIntensiveTask()  // Runs at full speed always
                delay(1.seconds)
            }
        }
    }
}
```

**DO:**
```kotlin
// Resource-aware: only process when appropriate
class BackgroundProcessor(
    scope: CoroutineScope,
    private val processingModeManager: ProcessingModeManager
) {
    fun start() {
        scope.launch {
            processingModeManager.mode.collect { mode ->
                when (mode) {
                    ProcessingMode.SILENT -> { /* back off completely */ }
                    ProcessingMode.LOW_PRIORITY -> { /* essential tasks only */ }
                    ProcessingMode.FULL_SPEED -> performIntensiveTask()
                }
            }
        }
    }
}
```

### Using GlobalScope

**DON'T:**
```kotlin
// BAD: GlobalScope tasks are never cancelled -- memory leaks
GlobalScope.launch {
    while (true) {
        monitorProcesses()
        delay(5.seconds)
    }
}
```

**DO:**
```kotlin
// Use SupervisorJob + structured scope
val managedScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
DisposableEffect(Unit) {
    onDispose { managedScope.cancel() }
}
```

## 4. Best Practices

1. **Window Focus**: Use AWT WindowFocusListener, not polling. Test with multiple monitors.
2. **Process Monitoring**: Prefer ProcessHandle.onExit() for known processes. Poll every 5+ seconds.
3. **Shutdown**: Always add shutdown hooks. Use timeouts (5-30 seconds). Don't throw in hooks.
4. **Coroutines**: Use SupervisorJob. Cancel scopes in DisposableEffect. Handle cancellation.

## 5. Testing

### Test: ProcessingModeManager

```kotlin
@Test
fun mode_switches_when_external_app_gains_focus() = runTest {
    val focusManager = FakeWindowFocusManager()
    val processMonitor = FakeExternalProcessMonitor()
    val modeManager = ProcessingModeManager(focusManager, processMonitor)
    modeManager.startMonitoring(this)

    assertEquals(ProcessingMode.FULL_SPEED, modeManager.mode.value)

    processMonitor.setExternalAppRunning(true)
    advanceUntilIdle()
    assertEquals(ProcessingMode.SILENT, modeManager.mode.value)

    focusManager.setFocus(true)
    advanceUntilIdle()
    assertEquals(ProcessingMode.FULL_SPEED, modeManager.mode.value)
}
```

### Test: Graceful Shutdown

```kotlin
@Test
fun shutdown_executes_all_tasks() = runTest {
    val manager = ShutdownManager(timeout = 1.seconds)
    val executed = mutableListOf<String>()

    manager.registerShutdownTask { executed.add("task1") }
    manager.registerShutdownTask { delay(100); executed.add("task2") }

    runBlocking {
        withTimeoutOrNull(1.seconds) {
            manager.tasks.forEach { it() }
        }
    }

    assertEquals(listOf("task1", "task2"), executed)
}
```

---

**Parent doc**: [resource-management-patterns.md](resource-management-patterns.md)
