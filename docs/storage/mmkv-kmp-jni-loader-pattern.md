---
scope: [storage, kmp, jni, mmkv, testability]
sources: [mmkv, jna]
targets: [android, desktop]
slug: mmkv-kmp-jni-loader-pattern
status: active
layer: L0
category: storage
description: "How to make MMKV native library loading testable in KMP — Android MMKV.LibLoader seam and Desktop JNA NativeLibraryLoader seam"
version: 1
last_updated: "2026-05-18"
approved_by: user
approval_date: "2026-05-18"
sources_ingested:
  - type: webfetch
    url: https://github.com/Tencent/MMKV
    date: "2026-05-18"
    topic: MMKV Android LibLoader interface + JVM/JNA loading documentation absence
  - type: in-session-discovery
    project: shared-kmp-libs
    wave: Wave-3b-BL-W47-prep
    date: "2026-05-18"
---

# MMKV KMP native library loader testability pattern

## Context

`core-storage-mmkv` targets Android (via Tencent MMKV AAR, `com.tencent:mmkv:2.4.0`) and
Desktop (via JNA calling a user-compiled MMKV C++ binary). Both platforms require loading a
native library at runtime, which makes the adapter class structurally untestable on a CI host
unless an injection seam is provided.

This pattern documents the two injection seams added in Wave 3b (BL-W47p) and how to use them
in tests.

---

## Android: `MMKV.LibLoader` injection seam

### API

`com.tencent.mmkv.MMKV` (AAR 2.4.0) exposes multiple `initialize()` overloads, all accepting
an optional `LibLoader` parameter:

```java
// MMKV.java — LibLoader is a nested interface inside the MMKV class
public interface LibLoader {
    void loadLibrary(String libName);
}

public static String initialize(Context context, MMKV.LibLoader loader) { ... }
public static String initialize(Context context, String rootDir, MMKV.LibLoader loader) { ... }
// ... additional overloads — loader param is nullable (not @NonNull)
```

**FQN**: `com.tencent.mmkv.MMKV.LibLoader` — LibLoader is a **nested class** inside `MMKV`,
not a top-level class. The compiled AAR contains `com/tencent/mmkv/MMKV$LibLoader.class`.

### L1 wrapper

`initializeMMKV` in `androidMain` wraps `MMKV.initialize` and exposes the `loader` param:

```kotlin
// core-storage-mmkv/src/androidMain/.../MmkvAdapterImpl.android.kt:206-210
fun initializeMMKV(
    context: android.content.Context,
    loader: com.tencent.mmkv.MMKV.LibLoader? = null,
) {
    MMKV.initialize(context, loader)
}
```

`loader = null` → MMKV uses its default `System.loadLibrary("mmkv")`, which resolves the `.so`
bundled in the APK. Pass a no-op or fake loader in tests to bypass the native dep.

### Android test usage

```kotlin
// androidDeviceTest — real MMKV on device; no loader injection needed
// host unit test (if needed) — inject no-op loader:
initializeMMKV(context, loader = { libName -> /* no-op, skip native load */ })
val adapter = MmkvAdapterImpl("test-store")
```

---

## Desktop: `NativeLibraryLoader` fun interface injection seam

### API

`MmkvNativeLibrary.NativeLibraryLoader` is a `fun interface` defined in
`desktopMain/MmkvNativeLibrary.kt:29-32`:

```kotlin
fun interface NativeLibraryLoader {
    /** Returns a non-null [MmkvNativeLibrary]. Throws on failure (UnsatisfiedLinkError, etc). */
    fun load(): MmkvNativeLibrary
}
```

The default production loader (`DefaultLoader`) calls `Native.load("mmkv", MmkvNativeLibrary::class.java)`.
It is `internal` — not exposed to consumers.

`MmkvNativeLibrary.loadLibrary(loader)` (companion function) wraps the loader call:

```kotlin
// MmkvNativeLibrary.kt:60-65
fun loadLibrary(loader: NativeLibraryLoader = DefaultLoader): MmkvNativeLibrary? = try {
    loader.load()
} catch (e: Throwable) {
    if (e is CancellationException) throw e
    null  // null = binary not present; callers throw NativeLibraryFailed
}
```

### Secondary constructor on `MmkvAdapterImpl.desktop`

`MmkvAdapterImpl` exposes an `internal` secondary constructor accepting a loader:

```kotlin
// MmkvAdapterImpl.desktop.kt:33-38
internal constructor(
    mmkvId: String,
    loader: MmkvNativeLibrary.NativeLibraryLoader,
) : this(mmkvId) {
    this.loader = loader
}
```

This constructor is `internal` — accessible from `desktopTest` (same Gradle module) but NOT
from consumer modules.

### Desktop test usage

```kotlin
// desktopTest — inject FakeMmkvNativeLibrary
class MmkvAdapterImplDesktopTest {
    private val fakeLib = FakeMmkvNativeLibrary()
    private val adapter = MmkvAdapterImpl("test-store", loader = { fakeLib })

    @Test
    fun putString_stores_value() {
        adapter.putString("key", "value")
        assertEquals("value", adapter.getString("key", null))
    }
}
```

`FakeMmkvNativeLibrary` implements `MmkvNativeLibrary` with an in-memory `MutableMap` backing.
All 15 JNA interface methods must be implemented (Wave 3b requirement — see `desktopTest`
source for the full fake).

---

## Why `by lazy` + loader injection

`MmkvAdapterImpl.desktop` holds:

```kotlin
private var loader: MmkvNativeLibrary.NativeLibraryLoader = MmkvNativeLibrary.DefaultLoader

private val nativeLib: MmkvNativeLibrary by lazy {
    try { loader.load() } catch (e: Throwable) { ... throw NativeLibraryFailed(...) }
}
```

The `by lazy` property reads `loader` at first access (first method call), not at construction
time. This means:
1. Primary constructor sets `loader = DefaultLoader`.
2. Secondary constructor body overrides `loader` before any method is called.
3. `nativeLib` lazy initializer picks up the overridden loader.

**Coverage implication**: when `loader.load()` returns the fake, every JNA call inside the
method bodies is reachable → ≥95% line coverage achievable on CI host.
When `loader` is `DefaultLoader` and the native binary is absent, `nativeLib` throws
`NativeLibraryFailed` at first access → all JNA call lines are unreachable (0% on host).

---

## JNA search order (Desktop production)

When `DefaultLoader` calls `Native.load("mmkv", ...)`, JNA resolves the binary in this order:

1. `jna.library.path` system property
2. Classpath resources at `/{os}-{arch}/mmkv.{ext}` (JAR resource bundling)
3. OS-native paths: `PATH` (Windows), `LD_LIBRARY_PATH` (Linux), `DYLD_LIBRARY_PATH` (macOS)
4. OS default search: `LoadLibrary` (Windows), `dlopen` (Linux/macOS)

**Security note (FLAG-02 / CWE-693)**: MMKV upstream has no documented guidance for JVM/JNA
loading and no hash verification recommendations. The default JNA load path is a consumer
security decision. Mitigation options:
- (A) Bundle the MMKV binary as a JAR classpath resource — JNA classpath search resolves it
  before OS paths, reducing PATH-based substitution risk.
- (B) Inject a custom `NativeLibraryLoader` using `System.load(absolutePath)` pointing to a
  verified app-installed location.

See `MmkvNativeLibrary.kt:39-53` (DefaultLoader KDoc) for the full FLAG-02 memo.

---

## MMKV upstream: no JVM/JNA documentation

MMKV's official repository (`github.com/Tencent/MMKV`) documents Android (AAR) and
Apple/POSIX (C++ / CocoaPods) usage. There is **no official JVM/JNA loading documentation**
for Desktop targets. The L1 JNA approach is custom — the Desktop implementation in
`core-storage-mmkv` is not following an upstream-documented pattern.

This means:
- No upstream guidance on binary distribution or signing for JVM Desktop
- No upstream hash verification mechanism
- The `NativeLibraryLoader` injection seam is L1-invented (not upstream-provided)

---

## Platform coverage summary

| Platform | Native mechanism | Test injection seam | CI host testable? |
|---|---|---|---|
| Android | `System.loadLibrary("mmkv")` via MMKV AAR | `MMKV.LibLoader` param to `initializeMMKV` | Yes (no-op loader) |
| Desktop (JVM) | `Native.load("mmkv", ...)` via JNA | `NativeLibraryLoader` secondary constructor | Yes (FakeMmkvNativeLibrary) |
| iOS/macOS | CocoaPods / appleMain | N/A — not JNA | N/A |

---

## Related

- [kover-platform-variant-scoping](../gradle/kover-platform-variant-scoping.md) — why `MmkvAdapterImpl` aggregate Kover fails on CI host and the class-name-filter workaround
- [kover-verification-dsl](../gradle/kover-verification-dsl.md) — `minBound` overloads, verify rule structure
- [agp9-kmp-host-test-source-set](../gradle/agp9-kmp-host-test-source-set.md) — `withDeviceTestBuilder` for `androidDeviceTest` source set
- [storage-patterns-implementation](storage-patterns-implementation.md) — MMKV platform storage models
