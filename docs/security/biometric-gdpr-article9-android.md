---
category: security
scope: [biometric-auth, gdpr, privacy, data-minimization]
sources: [core-auth-biometric, Wave 3c privacy-auditor verdict]
targets: [android]
slug: biometric-gdpr-article9-android
status: draft
layer: L0
description: "GDPR Article 9 obligations for Android biometric auth: special category data, errString sanitization pattern, log minimization, Right to Erasure boundary"
version: 1
last_updated: "2026-05-19"
monitor_urls:
  - url: "https://developer.android.com/reference/androidx/biometric/BiometricPrompt"
    type: doc-page
    tier: 2
l0_refs: [biometric-owasp-a07-lifecycle, security-testing-patterns]
---

# Biometric GDPR Article 9 — Android

GDPR Article 9 designates biometric data as a **special category** requiring explicit consent and heightened protection obligations. This applies beyond stored biometric templates to API surfaces that expose enrollment state or error messages.

## Article 9 Scope — What Counts as Biometric Data

| Data item | Art.9 status | Rationale |
|-----------|-------------|-----------|
| Biometric templates (fingerprint, face model) | Art.9 special category — OS-managed | Stored by Android OS in hardware-backed enclave; app never accesses directly |
| `BiometricManager.canAuthenticate()` return value | **Art.9 proxy** — app-managed | Boolean revealing whether biometric enrollment exists on device |
| `BiometricPrompt.onAuthenticationError.errString` | **Art.9 proxy** — must sanitize | Platform string contains human-readable enrollment information |
| `BiometricPrompt.onAuthenticationError.errorCode` | NOT Art.9 — typed integer | Safe to log and return; does not reveal enrollment content |
| Android KeyStore biometric-bound keys | App's Art.17 responsibility | App created and manages these keys; Right to Erasure = delete the key alias |

## Enrollment Status as Art.9 Data

`BiometricManager.canAuthenticate(BIOMETRIC_STRONG)` returning `BIOMETRIC_SUCCESS` is a proxy that discloses the subject has enrolled biometrics on their device. Under Art.9 this must be treated as special category data:

- Do NOT log `canAuthenticate()` return values
- Do NOT embed enrollment status in structured analytics events
- Do NOT transmit enrollment status to backend systems without explicit legal basis (typically explicit consent or Art.9(2)(a))

## errString Sanitization — Required Pattern

`BiometricPrompt.onAuthenticationError(errorCode: Int, errString: CharSequence)` delivers a platform-generated human-readable message. This string is Art.9 data because it encodes enrollment state (e.g., "No fingerprint enrolled", "Biometric hardware unavailable").

### FORBIDDEN
```kotlin
// WRONG — platform string embedded in Result.Error or logs
override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
    _result.value = Result.Error(errString.toString()) // Art.9 leak via message field
    logger.d("BiometricAuth", "error: $errString")     // Art.9 leak via log
}
```

### Required Pattern — BiometricErrorCode.sanitizedMessage()

Map error codes to app-owned typed literals. The SDK must own the string; platform strings must not flow through.

```kotlin
enum class BiometricErrorCode(val code: Int) {
    CANCELED(BiometricPrompt.ERROR_CANCELED),
    HW_NOT_PRESENT(BiometricPrompt.ERROR_HW_NOT_PRESENT),
    HW_UNAVAILABLE(BiometricPrompt.ERROR_HW_UNAVAILABLE),
    LOCKOUT(BiometricPrompt.ERROR_LOCKOUT),
    LOCKOUT_PERMANENT(BiometricPrompt.ERROR_LOCKOUT_PERMANENT),
    NO_BIOMETRICS(BiometricPrompt.ERROR_NO_BIOMETRICS),
    NO_DEVICE_CREDENTIAL(BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL),
    SECURITY_UPDATE_REQUIRED(BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED),
    TIMEOUT(BiometricPrompt.ERROR_TIMEOUT),
    UNABLE_TO_PROCESS(BiometricPrompt.ERROR_UNABLE_TO_PROCESS),
    USER_CANCELED(BiometricPrompt.ERROR_USER_CANCELED),
    VENDOR(BiometricPrompt.ERROR_VENDOR),
    UNKNOWN(-1);

    fun sanitizedMessage(): String = when (this) {
        CANCELED -> "Authentication canceled"
        HW_NOT_PRESENT -> "Biometric hardware not present"
        HW_UNAVAILABLE -> "Biometric hardware unavailable"
        LOCKOUT -> "Too many attempts; try again later"
        LOCKOUT_PERMANENT -> "Biometric locked; use device credential"
        NO_BIOMETRICS -> "No biometrics enrolled"
        NO_DEVICE_CREDENTIAL -> "No device credential set"
        SECURITY_UPDATE_REQUIRED -> "Device security update required"
        TIMEOUT -> "Authentication timed out"
        UNABLE_TO_PROCESS -> "Unable to process biometric"
        USER_CANCELED -> "Authentication canceled by user"
        VENDOR -> "Vendor-specific error"
        UNKNOWN -> "Unknown authentication error"
    }

    companion object {
        fun fromCode(code: Int): BiometricErrorCode =
            entries.firstOrNull { it.code == code } ?: UNKNOWN
    }
}

// In BiometricPrompt callback:
override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
    val typedCode = BiometricErrorCode.fromCode(errorCode)
    val safeMessage = typedCode.sanitizedMessage() // app-owned literal, NOT errString
    _result.value = BiometricResult.Error(typedCode, safeMessage)
    logger.d("BiometricAuth", "error_code=${typedCode.name}") // typed code only, NOT safeMessage
}
```

## BiometricLogEvent Minimization — Art.5(1)(c)

GDPR Art.5(1)(c) (data minimisation) requires that structured log events contain only what is necessary.

| Field | Allowed | Reason |
|-------|---------|--------|
| `error_code` (typed enum name) | YES | Does not reveal enrollment content |
| `sanitizedMessage()` string | NO | App-owned but still describes enrollment state; unnecessary for ops |
| `errString` (platform string) | NO | Art.9 proxy; must never appear in logs |
| `title` (prompt title) | Caller's responsibility | Art.5(1)(c) — title must not include PII; SDK KDocs this requirement |

```kotlin
// Minimized log event — error_code ONLY
data class BiometricAuthError(
    val error_code: String, // BiometricErrorCode.name
    val timestamp: Long
)
// NOT: data class BiometricAuthError(val message: String, ...)
```

## Right to Erasure Boundary — Art.17

| Data | Owner | Art.17 obligation |
|------|-------|------------------|
| Biometric templates | Android OS (hardware-backed enclave) | Platform's responsibility; app has no API to erase |
| Biometric-bound Android KeyStore keys | App | App MUST delete key alias on erasure request: `keyStore.deleteEntry(BIOMETRIC_KEY_ALIAS)` |
| Structured log events containing typed error codes | App | Standard log retention + erasure policy applies |

The app's Art.17 obligation is limited to app-managed biometric keys. Inform users that biometric template erasure requires them to remove the enrollment via device Settings.

## AuthenticationStarted.title — Art.5(1)(c) KDoc Requirement

The caller constructing `BiometricPromptConfig` is responsible for ensuring the `title` field does not include PII. The SDK must surface this obligation in KDoc:

```kotlin
/**
 * @param title Displayed in the biometric prompt. Caller's responsibility per GDPR Art.5(1)(c)
 *   to ensure this string contains no personal data (name, email, account ID, etc.).
 */
data class BiometricPromptConfig(
    val title: String,
    ...
)
```
