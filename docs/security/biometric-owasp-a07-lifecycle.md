---
category: security
scope: [biometric-auth, owasp-a07, masvs-auth, session-management]
sources: [androidx.biometric, core-auth-biometric]
targets: [android]
slug: biometric-owasp-a07-lifecycle
status: draft
layer: L0
description: "OWASP A07 (Identification & Authentication Failures) biometric lifecycle rules: session binding, key invalidation on enrollment change, re-auth triggers, MASVS-AUTH-1/2 coverage"
version: 1
last_updated: "2026-05-19"
monitor_urls:
  - url: "https://developer.android.com/reference/androidx/biometric/BiometricManager"
    type: doc-page
    tier: 2
  - url: "https://developer.android.com/reference/androidx/biometric/BiometricPrompt"
    type: doc-page
    tier: 2
l0_refs: [security-testing-patterns, auth-biometric]
---

# Biometric OWASP A07 Lifecycle

OWASP A07 (Identification & Authentication Failures) maps directly to biometric authentication when the app fails to invalidate sessions or keys after enrollment state changes.

## OWASP A07 / MASVS-AUTH Mapping

| Standard | Requirement | L1 obligation |
|----------|-------------|---------------|
| OWASP A07 | Prevent broken authentication | Invalidate biometric-bound keys on enrollment change |
| MASVS-AUTH-1 | Authentication policy | Enforce BIOMETRIC_STRONG (Class 3) by default |
| MASVS-AUTH-2 | Stateful authentication | Bind session to biometric auth event; re-auth on timeout or key rotation |

## Class 3 (BIOMETRIC_STRONG) Default

Always pass `BIOMETRIC_STRONG` to `setAllowedAuthenticators()`. Class 2 (BIOMETRIC_WEAK) does NOT provide hardware-backed key binding.

```kotlin
BiometricPrompt.PromptInfo.Builder()
    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
    .build()
```

Downgrading to Class 2 requires explicit user opt-in with documented rationale. Never downgrade silently.

## Session Binding Rule

Biometric authentication MUST invalidate the user session on enrollment change. Android KeyStore enforces this automatically when a biometric-bound key is created with `setInvalidatedByBiometricEnrollment(true)` (the default).

```kotlin
keyGenParameterSpec {
    setUserAuthenticationRequired(true)
    setInvalidatedByBiometricEnrollment(true) // default; be explicit
}
```

When the user adds or removes a biometric enrollment, the bound key becomes permanently invalidated. The app MUST detect `KeyPermanentlyInvalidatedException` and invalidate the session + prompt re-enrollment.

## BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED Handling

When `BiometricPrompt.onAuthenticationError` fires with error code `BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED`:

1. Invalidate all biometric-bound keys in the Android KeyStore immediately.
2. Clear any cached biometric auth session state.
3. Prompt the user to update device security or re-enroll biometrics.

```kotlin
override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
    if (errorCode == BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED) {
        keyStore.deleteEntry(BIOMETRIC_KEY_ALIAS)
        sessionManager.invalidateSession()
        // surface appropriate UX to user
    }
}
```

## Re-Authentication Triggers

Re-authentication MUST be required when any of the following occurs:

| Trigger | Action |
|---------|--------|
| Session timeout (configurable, default ≤5min idle) | Prompt re-auth before resuming sensitive operation |
| Sensitive operation (payment, key export, GDPR erasure) | Always re-auth immediately before the operation |
| Key rotation (new biometric key provisioned) | Re-auth to bind session to new key |
| Enrollment change detected (new fingerprint added, etc.) | Invalidate session, force re-auth |
| `ERROR_SECURITY_UPDATE_REQUIRED` received | Invalidate keys + re-auth after update |

## Anti-Pattern: Caching Biometric Auth Result

**NEVER** cache the result of a biometric authentication across sensitive operations.

```kotlin
// WRONG — cached result re-used across operations
var isAuthenticated = false
fun onAuthenticationSucceeded(...) { isAuthenticated = true }
fun performSensitiveOperation() {
    if (isAuthenticated) doSensitiveWork() // stale auth bypasses MASVS-AUTH-2
}

// CORRECT — re-auth before each sensitive operation
fun performSensitiveOperation() {
    biometricPrompt.authenticate(promptInfo, cryptoObject) // fresh auth
}
```

Each sensitive operation must initiate a fresh `BiometricPrompt.authenticate()` call. The `CryptoObject` wrapping the operation's key is the enforcement mechanism — the OS will fail the operation if the key is invalidated.
