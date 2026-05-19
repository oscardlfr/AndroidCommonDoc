---
category: testing
scope: [kotlin-native, coroutines, apple-targets, commonMain]
sources: [Wave 3c friction #107, K/N compiler enforcement]
targets: [ios, macos, iosSimulator]
slug: kotlin-native-throws-suspend-pattern
status: draft
layer: L0
description: "Kotlin/Native compiler constraint: @Throws on suspend fun MUST include CancellationException. Applies to all Apple targets (iosX64, iosArm64, iosSimulatorArm64, macosArm64). Canonical annotation pattern + import path + anti-pattern + exit-criteria mandate."
version: 1
last_updated: "2026-05-19"
monitor_urls:
  - url: "https://kotlinlang.org/docs/native-objc-interop.html"
    type: doc-page
    tier: 2
l0_refs: [testing-patterns-coverage]
---

# Kotlin/Native @Throws on suspend fun

The Kotlin/Native compiler enforces that any `suspend fun` annotated with `@Throws` MUST include `CancellationException` (or a superclass) in its throws list. Omitting it causes a compile error on ALL Apple targets.

This applies to every `suspend fun` in `commonMain`, `appleMain`, `iosMain`, or any Apple-targeting source set annotated with `@Throws`.

## Canonical Pattern

```kotlin
import kotlin.coroutines.cancellation.CancellationException

@Throws(UnsupportedOperationException::class, CancellationException::class)
suspend fun authenticate(config: BiometricPromptConfig): BiometricResult
```

Both exception types are required:
- `UnsupportedOperationException::class` — the domain exception this function declares
- `CancellationException::class` — K/N compiler mandate for ALL suspend fun with @Throws

## Import Path

Always use the Kotlin stdlib path:

```kotlin
import kotlin.coroutines.cancellation.CancellationException
```

Do NOT use `kotlinx.coroutines.CancellationException` — that is a type alias in kotlinx-coroutines and may not resolve identically across all K/N targets.

## Anti-Pattern — Missing CancellationException

```kotlin
// WRONG — compiles on JVM/Desktop, FAILS on iosX64/iosArm64/iosSimulatorArm64/macosArm64
@Throws(UnsupportedOperationException::class)
suspend fun authenticate(config: BiometricPromptConfig): BiometricResult
```

K/N compile error (all Apple targets):
```
error: 'throws' list of a suspend function must contain CancellationException or one of its superclasses
```

## Multiple Domain Exceptions

When a suspend fun throws multiple typed exceptions, include ALL of them plus `CancellationException`:

```kotlin
@Throws(
    UnsupportedOperationException::class,
    IllegalStateException::class,
    CancellationException::class   // always last by convention; always required
)
suspend fun sensitiveOperation(): Result<Unit>
```

## Exit-Criteria Mandate

Any specialist brief touching a commonMain `suspend fun` with `@Throws` MUST include Apple target compile in exit-criteria:

```bash
# Minimum exit-criteria for commonMain changes with @Throws suspend fun:
./gradlew :module:compileAndroidMain         # AGP 9 KMP Android
./gradlew :module:compileKotlinDesktop       # Desktop/JVM
./gradlew :module:compileKotlinIosX64        # K/N Apple (catches @Throws constraint)
```

Omitting `compileKotlinIosX64` means the K/N `@Throws` constraint is never verified until `/pre-pr` or CI.

## Scope

This constraint applies when ALL of the following are true:
1. Function is declared in `commonMain`, `appleMain`, `iosMain`, `macosMain`, or any source set compiled by K/N
2. Function is marked `suspend`
3. Function is annotated with `@Throws`

Standard (non-suspend) `@Throws` functions are not affected.

## K/N Backtick Function Name Restrictions

Kotlin/Native forbids parentheses `()` inside backtick function names. This is a K/N-only restriction that affects commonTest test functions.

```kotlin
// WRONG — compiles on JVM/desktopTest; fails K/N (iosX64 etc.)
@Test
fun `sanitizedMessage NOT_AVAILABLE returns generic literal()`() { ... }

// CORRECT — remove () from backtick name
@Test
fun `sanitizedMessage NOT_AVAILABLE returns generic literal`() { ... }
```

Other special characters forbidden in K/N backtick names: `<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*`.

**Exit-criteria rule for commonTest with backtick names**: `:desktopTest` alone is insufficient. Use `:check` to validate all targets including K/N Apple:

```bash
# Mandatory for commonTest files with backtick test names:
./gradlew :module:check   # compiles + tests all targets; catches K/N backtick restrictions
```
