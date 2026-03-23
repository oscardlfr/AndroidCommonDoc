---
scope: [security, encryption, key-management, biometric]
sources: [android-keystore, ios-keychain, jvm-keystore]
targets: [android, desktop, ios, macos]
version: 1
last_updated: "2026-03"
assumes_read: security-hub
description: "Generic KMP security patterns: encryption architecture, key management, biometric auth, platform implementations"
slug: security-patterns
status: active
layer: L0
parent: security-hub
category: security
rules:
  - id: no-hardcoded-credentials
    type: banned-usage
    hand_written: true
    message: "Never hardcode credentials, API keys, or secrets — use secure storage"
    detect: { banned_initializer: "password" }
  - id: no-custom-crypto
    type: banned-import
    message: "Never implement custom cryptography — use platform crypto APIs"
    detect: { banned_import: "javax.crypto.spec", prefer: "Platform KeyStore/Keychain" }
---

# KMP Security Patterns

## 1. Encryption Architecture

### Single Orchestrator Pattern

One `commonMain` interface with platform `expect/actual` for cryptographic primitives:

```kotlin
// commonMain — orchestrator
interface EncryptionService {
    suspend fun encrypt(data: ByteArray, keyAlias: String): EncryptedData
    suspend fun decrypt(encrypted: EncryptedData, keyAlias: String): ByteArray
    suspend fun hash(data: ByteArray, algorithm: HashAlgorithm): ByteArray
}

data class EncryptedData(
    val ciphertext: ByteArray,
    val iv: ByteArray,
    val keyVersion: Int
)

// Platform actuals provide the crypto primitives
expect class PlatformCipher {
    fun encrypt(data: ByteArray, key: ByteArray, iv: ByteArray): ByteArray
    fun decrypt(ciphertext: ByteArray, key: ByteArray, iv: ByteArray): ByteArray
}
```

### Supported Operations

| Operation | Algorithm | Use Case |
|-----------|-----------|----------|
| Symmetric encryption | AES-256-GCM | Data at rest, file encryption |
| Password-based encryption | PBKDF2 + AES-256-GCM | User-password protected data |
| Hashing | SHA-256, SHA-512 | Integrity verification, dedup |
| Streaming encryption | AES-GCM chunked | Large file encryption |

## 2. Key Management

### Key Provider Pattern

```kotlin
// commonMain
interface KeyProvider {
    suspend fun getOrCreateKey(alias: String, keySize: Int = 32): SecretKey
    suspend fun deleteKey(alias: String)
    suspend fun keyExists(alias: String): Boolean
}
```

### Platform Implementations

| Platform | Storage | Hardware-backed |
|----------|---------|-----------------|
| Android | Android KeyStore | Yes (API 28+) |
| iOS/macOS | Keychain Services | Yes (Secure Enclave) |
| Desktop/JVM | JVM KeyStore + file | No |

### Key Rotation

Design for rotation from day one:
1. Store `keyVersion` alongside encrypted data
2. On rotation: new data uses new key, old data decrypts with old key
3. Background re-encryption of old data with new key
4. Delete old key only after all data re-encrypted

## 3. Biometric Authentication

### Pattern

```kotlin
// commonMain — biometric is a gate, not a credential
interface BiometricAuthenticator {
    suspend fun authenticate(reason: String): BiometricResult
    fun isAvailable(): Boolean
}

sealed interface BiometricResult {
    data object Success : BiometricResult
    data class Error(val code: BiometricErrorCode) : BiometricResult
    data object Cancelled : BiometricResult
}
```

Rules:
- Biometric auth is **local-only** — never send biometric data
- Biometric unlocks a key in the platform keystore — it doesn't replace encryption
- Always provide fallback (PIN/password) for devices without biometric hardware
- Use platform APIs: `BiometricPrompt` (Android), `LAContext` (Apple)

## 4. Typed Exception Hierarchy

```kotlin
sealed class SecurityException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class KeyNotFound(alias: String) : SecurityException("Key not found: $alias")
    class EncryptionFailed(cause: Throwable) : SecurityException("Encryption failed", cause)
    class DecryptionFailed(cause: Throwable) : SecurityException("Decryption failed", cause)
    class BiometricUnavailable : SecurityException("Biometric hardware not available")
    class KeyStoreCorrupted(cause: Throwable) : SecurityException("KeyStore corrupted", cause)
}
```

## 5. Anti-Patterns

| Anti-Pattern | Why | Correct |
|---|---|---|
| Custom crypto algorithms | Unaudited, breakable | Use AES-256-GCM via platform APIs |
| Hardcoded keys in source | Extractable from binary | Platform KeyStore/Keychain |
| Storing raw passwords | Breach exposure | Hash with PBKDF2/bcrypt |
| Biometric data to server | Privacy violation, GDPR | Local-only biometric gate |
| Skipping key rotation | Compromised key = all data | Version keys, rotate periodically |
| Synchronous crypto on main thread | UI freeze | `suspend` + `Dispatchers.Default` |

validate_upstream:
  - url: "https://developer.android.com/privacy-and-security/security-tips"
    assertions:
      - type: keyword_present
        value: "encryption"
        context: "Encryption patterns we teach"
      - type: keyword_present
        value: "KeyStore"
        context: "Android KeyStore for key management"
    on_failure: MEDIUM
---

Parent doc: [security-hub.md](security-hub.md)
