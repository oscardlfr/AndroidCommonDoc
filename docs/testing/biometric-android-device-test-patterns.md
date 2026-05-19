---
category: testing
scope: [biometric-auth, android-instrumented, kover, fakes]
sources: [core-auth-biometric, Wave 3c implementation]
targets: [android]
slug: biometric-android-device-test-patterns
status: draft
layer: L0
description: "Android instrumented test patterns for BiometricPrompt: FakeBiometricPromptFactory callbacks, assertFailsWith, Kover subset-includes gate, catalog deps, device-agnostic assertions"
version: 1
last_updated: "2026-05-19"
monitor_urls:
  - url: "https://developer.android.com/reference/androidx/biometric/BiometricPrompt"
    type: doc-page
    tier: 2
  - url: "https://kotlin.github.io/kotlinx-kover/"
    type: doc-page
    tier: 2
l0_refs: [biometric-owasp-a07-lifecycle, testing-patterns-coverage, security-testing-patterns]
---

# Biometric Android Device Test Patterns

Biometric instrumented tests run on a physical device or managed device emulator. Real `BiometricPrompt` hardware cannot be triggered programmatically; a `FakeBiometricPromptFactory` drives all callbacks without touching hardware.

## FakeBiometricPromptFactory — Callback Invocation Pattern

The fake invokes `BiometricPrompt` callbacks synchronously via a configurable outcome. No hardware is needed.

```kotlin
class FakeBiometricPromptFactory : BiometricPromptFactory {
    var outcome: Outcome = Outcome.Success

    enum class Outcome { Success, Failed, Error }

    override fun create(
        activity: FragmentActivity,
        executor: Executor,
        callback: BiometricPrompt.AuthenticationCallback
    ): BiometricPrompt {
        // Return a real BiometricPrompt but immediately invoke callback based on outcome.
        // The real BiometricPrompt reference is needed to satisfy the type system;
        // authenticate() is never called on it.
        val prompt = BiometricPrompt(activity, executor, callback)
        when (outcome) {
            Outcome.Success -> callback.onAuthenticationSucceeded(
                BiometricPrompt.AuthenticationResult(null, BiometricPrompt.AUTHENTICATION_RESULT_TYPE_BIOMETRIC)
            )
            Outcome.Failed -> callback.onAuthenticationFailed()
            Outcome.Error -> callback.onAuthenticationError(
                BiometricPrompt.ERROR_CANCELED, "Authentication canceled"
            )
        }
        return prompt
    }
}
```

## onAuthenticationFailed — Non-Resume Test

`onAuthenticationFailed` signals a single failed attempt; `BiometricPrompt` internally retries. The test must assert that the flow does NOT resume (the VM remains in an "authenticating" state after failure):

```kotlin
@Test
fun authenticate_failed_doesNotEmitResult() = runTest {
    val fake = FakeBiometricPromptFactory().apply { outcome = Outcome.Failed }
    val vm = BiometricViewModel(biometricAuth = BiometricAuth(fake))
    vm.authenticate(promptConfig)
    // onAuthenticationFailed triggers internal retry, no terminal result emitted
    val state = vm.uiState.first()
    assertIs<BiometricUiState.Authenticating>(state)
}
```

Do NOT assert `onAuthenticationFailed` produces a terminal `Result.Error` — that is incorrect per BiometricPrompt's contract.

## UnsupportedOperationException — Correct Assertion

Use `assertFailsWith<UnsupportedOperationException>` — NOT `assertNotNull(e)` or catching `Throwable`:

```kotlin
// CORRECT
@Test
fun authenticate_unsupportedPlatform_throws() {
    val vm = DesktopBiometricViewModel() // stub that always throws
    assertFailsWith<UnsupportedOperationException> {
        vm.authenticate(promptConfig)
    }
}

// WRONG — assertNotNull(e) always passes even if exception is null
@Test
fun authenticate_unsupportedPlatform_wrongAssertion() {
    try {
        vm.authenticate(promptConfig)
    } catch (e: UnsupportedOperationException) {
        assertNotNull(e) // gaming — catches any exception or no exception
    }
}
```

## setAllowedAuthenticators — Instrumented Verification

Verify that the prompt config enforces `BIOMETRIC_STRONG`:

```kotlin
@Test
fun promptConfig_allowedAuthenticators_isBiometricStrong() {
    val config = BiometricPromptConfig(
        title = "Verify identity",
        allowedAuthenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
    )
    assertEquals(
        BiometricManager.Authenticators.BIOMETRIC_STRONG,
        config.allowedAuthenticators
    )
}
```

## Kover Subset-Includes for Instrumented-Only Modules

`BiometricPromptFactoryImpl` is a 3-line leaf excluded from Kover enforcement. The instrumented test module must be gate-enforced on its own subset, excluding the impl leaf.

In the module's `build.gradle.kts`:

```kotlin
kover {
    reports {
        filters {
            excludes {
                classes(
                    // 3-line leaf — no branching logic to test; structurally excluded
                    "*BiometricPromptFactoryImpl*"
                )
            }
        }
        verify {
            rule("biometric instrumented coverage") {
                minBound(90) // gate on the subset (excludes impl leaf)
            }
        }
    }
}
```

The `BiometricPromptFactoryImpl` exclusion must be documented in the rule comment.

## Catalog Dependencies — Allowed Set

For `androidDeviceTest` only use deps from the version catalog:

```kotlin
// build.gradle.kts androidDeviceTest deps — ONLY these two
androidDeviceTest {
    dependencies {
        implementation(libs.androidx.test.runner)
        implementation(libs.androidx.test.ext.junit)
        // DO NOT add libs.androidx.test.core — not in catalog
        // DO NOT add libs.junit — JVM-only; not valid in androidDeviceTest
    }
}
```

If `libs.androidx.test.core` is needed, add it to the version catalog first via catalog PR.

## Device-Agnostic Test Assertions

Biometric feature availability varies per device. Tests must not assert on hardware presence:

```kotlin
// WRONG — asserts hardware is present; fails on emulators without biometric HW
assertTrue(BiometricManager.canAuthenticate(BIOMETRIC_STRONG) == BIOMETRIC_SUCCESS)

// CORRECT — assert on behavior given faked outcome, regardless of HW
// Use FakeBiometricPromptFactory to control outcome; don't depend on device state
```

All functional tests must use the `FakeBiometricPromptFactory` to be device-agnostic.

## logger = null Variant — Null-Safety Verification

Test the null-logger variant to exercise null-safety guards:

```kotlin
@Test
fun biometricAuth_nullLogger_doesNotCrash() = runTest {
    val auth = BiometricAuth(
        factory = FakeBiometricPromptFactory().apply { outcome = Outcome.Success },
        logger = null // explicitly test null logger path
    )
    val result = auth.authenticate(promptConfig, activity)
    assertIs<Result.Success<Unit>>(result)
}
```

This test confirms that `logger?.d(...)` calls don't throw when logger is absent.
