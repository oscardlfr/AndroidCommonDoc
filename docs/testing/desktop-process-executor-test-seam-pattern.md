---
category: testing
scope: [desktop, solid, injection-seams, process-executor, runtime]
sources: [core-oauth-browser, Wave 3cd DesktopBrowserLauncher implementation]
targets: [desktop]
slug: desktop-process-executor-test-seam-pattern
status: draft
layer: L0
description: "SOLID injection seam pattern for Desktop modules invoking OS commands: ProcessExecutor interface + FakeProcessExecutor + osNameProvider lambda. Enables deterministic unit tests without OS side-effects."
version: 1
last_updated: "2026-05-19"
l0_refs: [biometric-android-device-test-patterns, testing-patterns-coverage]
---

# Desktop ProcessExecutor Test Seam Pattern

Desktop-only modules that invoke OS commands (e.g., opening a browser URL via `xdg-open`, `open`, `explorer`) cannot be unit-tested without triggering real OS side-effects. The injection seam pattern replaces the direct OS invocation with an injectable `ProcessExecutor` interface, enabling deterministic unit tests via `FakeProcessExecutor`.

Same family as MMKV `NativeLibraryLoader` injection (Wave 3b) and `BiometricPromptFactory` injection (Wave 3c).

## ProcessExecutor Interface

```kotlin
// In module's desktopMain source set
fun interface ProcessExecutor {
    fun execute(command: Array<String>)
}
```

Use `fun interface` (SAM) for minimal overhead and lambda injection in tests.

## DesktopProvider — Default Production Implementation

```kotlin
object DesktopProvider {
    // Production: delegates to OS process invocation via Runtime or ProcessBuilder
    val processExecutor: ProcessExecutor = ProcessExecutor { command ->
        ProcessBuilder(*command).start()
    }
}
```

The default implementation is injected at construction time. Tests supply `FakeProcessExecutor` instead.

## osNameProvider Lambda — OS Branch Seam

OS detection (`System.getProperty("os.name")`) is injectable to enable cross-OS branch testing on any CI host:

```kotlin
class DesktopBrowserLauncher(
    private val processExecutor: ProcessExecutor = DesktopProvider.processExecutor,
    private val osNameProvider: () -> String = { System.getProperty("os.name") ?: "" }
) {
    fun open(url: String) {
        val os = osNameProvider()
        val command = when {
            os.contains("win", ignoreCase = true) -> arrayOf("explorer", url)
            os.contains("mac", ignoreCase = true) -> arrayOf("open", url)
            else -> arrayOf("xdg-open", url)
        }
        processExecutor.execute(command)
    }
}
```

## FakeProcessExecutor — Test Double

```kotlin
class FakeProcessExecutor : ProcessExecutor {
    val capturedCommands = mutableListOf<Array<String>>()
    var shouldThrow: Exception? = null

    override fun execute(command: Array<String>) {
        shouldThrow?.let { throw it }
        capturedCommands.add(command)
    }
}
```

## Test Examples

```kotlin
@Test
fun open_onWindows_usesExplorer() {
    val fake = FakeProcessExecutor()
    val launcher = DesktopBrowserLauncher(processExecutor = fake, osNameProvider = { "Windows 11" })
    launcher.open("https://example.com")
    assertEquals(listOf("explorer", "https://example.com"), fake.capturedCommands.first().toList())
}

@Test
fun open_onMac_usesOpen() {
    val fake = FakeProcessExecutor()
    val launcher = DesktopBrowserLauncher(processExecutor = fake, osNameProvider = { "Mac OS X" })
    launcher.open("https://example.com")
    assertEquals(listOf("open", "https://example.com"), fake.capturedCommands.first().toList())
}

@Test
fun open_onLinux_usesXdgOpen() {
    val fake = FakeProcessExecutor()
    val launcher = DesktopBrowserLauncher(processExecutor = fake, osNameProvider = { "Linux" })
    launcher.open("https://example.com")
    assertEquals(listOf("xdg-open", "https://example.com"), fake.capturedCommands.first().toList())
}

@Test
fun open_processThrows_propagatesException() {
    val fake = FakeProcessExecutor().apply { shouldThrow = IOException("command failed") }
    val launcher = DesktopBrowserLauncher(processExecutor = fake)
    assertFailsWith<IOException> { launcher.open("https://example.com") }
}
```

## Anti-Pattern — Untestable Direct Invocation

```kotlin
// WRONG — no seam; triggers real OS side-effect in unit tests; no branch coverage
class DesktopBrowserLauncher {
    fun open(url: String) {
        // direct OS invocation with no injection point — untestable
        ProcessBuilder("xdg-open", url).start()
    }
}
```

## When to Apply This Pattern

Apply when a Desktop-only module:
1. Invokes OS commands (`ProcessBuilder`, `Runtime`, or equivalent)
2. Reads environment variables (`System.getenv()`) that branch behavior
3. Reads system properties (`System.getProperty("os.name")`) that branch OS logic
4. Calls any other side-effecting JVM API that cannot run deterministically in unit tests

The seam cost is minimal (one interface, one lambda param); the test benefit is full branch coverage across all OS paths without host OS dependency.

## Scope Limitation

Desktop/JVM-only pattern. For Android OS-level side effects, use `Intent`/`ActivityResultLauncher`. For biometric hardware seams, see `biometric-android-device-test-patterns`.
