---
scope: [security, encryption, key-management, testing, android-keystore]
sources: [as-built:shared-kmp-libs@2026-05-17, PR#57:bf694f16]
targets: [android, desktop, jvm]
slug: security-testing-patterns
status: active
layer: L0
category: testing
description: "Security module testing patterns: Android Keystore instrumented tests, cipher unit-tests with deterministic IV, real-vs-fake split, fake stream patterns, PBKDF2-iter-as-config-field"
version: 1
last_updated: "2026-05-17"
---

# Security Module Testing Patterns

Patterns for testing cryptographic and key-management modules in KMP. Derived from `core-encryption` and `core-security-keys` as shipped in PR #57.

> Security fakes (`FakeKeyProvider`, `FakeEncryptionService`) must stay **module-local** — their interfaces are not in `core-testing`'s dep graph. See [testing-patterns-fakes](testing-patterns-fakes.md).

---

## 1. Android Keystore Instrumented Test Structure

Android Keystore operations require a real device or emulator. Use `androidDeviceTest` source set — **not** `commonTest` or `desktopTest`.

```kotlin
// src/androidDeviceTest/kotlin/.../AndroidKeyProviderTest.kt
@RunWith(AndroidJUnit4::class)
class AndroidKeyProviderTest : KeyProviderTest() {
    private val androidKeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @Before
    fun setupAndroid() { deleteAllTestKeys() }

    @After
    fun teardownAndroid() { deleteAllTestKeys() }

    override fun createKeyProvider(): KeyProvider = AndroidKeyProvider()

    override suspend fun cleanup(provider: KeyProvider) { deleteAllTestKeys() }

    private fun deleteAllTestKeys() {
        try {
            androidKeyStore.aliases().toList()
                .filter { it.startsWith("test_key") }
                .forEach { alias ->
                    try { androidKeyStore.deleteEntry(alias) } catch (_: Exception) {}
                }
        } catch (_: Exception) {}
    }
}
```

**Key rules:**
- `@RunWith(AndroidJUnit4::class)` + `kotlin.test.@Test` — not JUnit5 (AGP 9 KMP uses JUnit4 runner for device tests)
- `runTest {}` for all suspend calls
- `@Before` + `@After` both call cleanup — `@Before` prevents left-over state from prior failed runs
- Alias prefix filter (`startsWith("test_key")`) isolates test cleanup to test-owned entries only

### What to assert for Keystore tests

| Assertion | Why |
|-----------|-----|
| `androidKeyStore.containsAlias(alias)` | Confirms key persisted in hardware store |
| `key.algorithm == "AES"` | Guards algorithm regression |
| `key.encoded.size == 32` | Confirms 256-bit key size |
| `keyInfo` via `SecretKeyFactory` | Confirms AndroidKeyStore-backed `KeyInfo` available |

---

## 2. Cipher Unit-Test Pattern (Deterministic IV via Injected SecureRandom)

`PlatformCipher` and `JvmPasswordEncryptionService` use `SecureRandom` internally. For cipher-correctness tests (encrypt→corrupt→decrypt), run in `desktopTest` — `expect/actual` cannot use anonymous objects in `commonTest`.

**Canonical pattern:**
```kotlin
// desktopTest — encrypt, corrupt one byte, assert DecryptionFailed
@Test
fun `corrupted ciphertext throws DecryptionFailed`() {
    val original = "test data".encodeToByteArray()
    val encrypted = service.encryptWithPassword(original, password)

    val corrupted = EncryptedData(
        ciphertext = encrypted.ciphertext.copyOf().also { it[0] = (it[0] + 1).toByte() },
        salt = encrypted.salt,
        iv = encrypted.iv,
    )

    assertFailsWith<EncryptionException.DecryptionFailed> {
        service.decryptWithPassword(corrupted, password)
    }
}
```

**Why desktopTest, not commonTest:** `JvmPasswordEncryptionService` is a `jvmMain` actual — it cannot be instantiated in `commonTest`. Place cipher unit-tests in `desktopTest` (inherits `jvmMain`).

---

## 3. Real-vs-Fake Test Split for Security Modules

`KeyProvider` and `EncryptionService` interfaces are **not in `core-testing`'s dep graph**. Fakes for these interfaces must live in the test source set of the owning module — never in `core-testing`.

| Interface | Fake location | Reason |
|-----------|--------------|--------|
| `KeyProvider` | `core-security-keys/desktopTest/` | Not in core-testing dep graph |
| `EncryptionService` | `core-encryption/desktopTest/` | Not in core-testing dep graph |
| `FakeClock`, `FakeResult` | `core-testing` | Interfaces ARE in dep graph |

**Rule:** before promoting a fake to `core-testing`, verify the interface it implements is reachable via `core-testing`'s declared dependencies (`core-result`, `core-error`, `core-common`, `core-logging`, `core-storage-api`).

---

## 4. Fake Stream Patterns for kotlinx.io / okio

When testing stream-based encryption (`EncryptionService` encrypt/decrypt with streams), prefer temp files over in-memory byte arrays to avoid platform differences.

```kotlin
@AfterTest
fun cleanup() { tempFile.delete() }

private val tempFile = File.createTempFile("test_encryption", ".tmp")

@Test
fun `stream round-trip`() = runTest {
    val plaintext = "test content".encodeToByteArray()
    tempFile.writeBytes(plaintext)

    val inputStream = tempFile.inputStream()
    val outputStream = ByteArrayOutputStream()

    service.encrypt(inputStream, outputStream, key)

    // ... assert encrypted output
}
```

**Why temp files:** in-memory `PipedInputStream`/`PipedOutputStream` pairs deadlock on single-threaded `runTest`. `File.createTempFile` + `@AfterTest` cleanup is safe cross-platform.

---

## 5. PBKDF2 Iteration Count as Config Field

**Problem:** hardcoding `PBKDF2_ITERATIONS = 310_000` into production code creates two risks:
1. Future OWASP floor bumps silently break stored data (old format can't be decrypted with new params)
2. The constant is invisible to the decryptor — it must re-discover it by convention

**Solution (Wave 3a precedent):** store crypto parameters in the `EncryptedData` wire format via a `version` field + `VERSION_TABLE`.

```kotlin
data class EncryptedData(
    val ciphertext: ByteArray,
    val salt: ByteArray,
    val iv: ByteArray,
    val version: Int = CURRENT_VERSION,   // written at encrypt time
) {
    companion object {
        const val CURRENT_VERSION: Int = 1

        internal data class CryptoParams(
            val pbkdf2Iterations: Int,
            val keyLengthBits: Int,
            val tagLengthBits: Int,
        )

        internal val VERSION_TABLE: Map<Int, CryptoParams> = mapOf(
            1 to CryptoParams(pbkdf2Iterations = 600_000, keyLengthBits = 256, tagLengthBits = 128),
        )

        internal fun paramsForVersion(version: Int): CryptoParams =
            VERSION_TABLE[version] ?: throw EncryptionException.UnsupportedVersion(version)
    }
}
```

**Decryptor reads version from the data, not from a constant:**
```kotlin
fun decryptWithPassword(encrypted: EncryptedData, password: String): ByteArray {
    val params = EncryptedData.paramsForVersion(encrypted.version) // never hardcoded
    // use params.pbkdf2Iterations, params.keyLengthBits, params.tagLengthBits
}
```

**Principle:** any security parameter that could change over time (iteration count, key length, algorithm) belongs in the encrypted-data format — not hardcoded in the service.

### Test coverage for the version table

```kotlin
// commonTest — regression guard
@Test
fun `CURRENT_VERSION is 1 — regression guard against accidental bump`() {
    assertEquals(1, EncryptedData.CURRENT_VERSION)
}

@Test
fun `paramsForVersion with unsupported version throws UnsupportedVersion`() {
    assertFailsWith<EncryptionException.UnsupportedVersion> {
        EncryptedData.paramsForVersion(99)
    }
}

// desktopTest — iteration floor guard
@Test
fun `PBKDF2 iteration count meets minimum security floor`() {
    assertTrue(
        JvmPasswordEncryptionService.PBKDF2_ITERATIONS >= 600_000,
        "PBKDF2 iteration count must be >= 600000 (OWASP 2024 floor for PBKDF2-HMAC-SHA256)",
    )
}
```

**OWASP 2024 floor for PBKDF2-HMAC-SHA256:** 600,000 iterations minimum. As of Wave 3a, `VERSION_TABLE[1].pbkdf2Iterations = 600_000`.

---

## Anti-patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| Hardcoded `PBKDF2_ITERATIONS` on decrypt path | Breaks when constant changes | Read from `EncryptedData.version` via `VERSION_TABLE` |
| Security fakes in `core-testing` | `KeyProvider`/`EncryptionService` not in dep graph — compile error | Keep fakes module-local |
| Cipher tests in `commonTest` | `JvmPasswordEncryptionService` is a jvmMain actual | Move to `desktopTest` |
| `PipedInputStream` in `runTest` | Deadlocks on single-threaded dispatcher | Use `File.createTempFile` |
| Missing `@Before` cleanup | Left-over Keystore entries from prior failed tests | Always cleanup in both `@Before` and `@After` |
