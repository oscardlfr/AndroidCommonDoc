---
scope: [dependency-injection, testing, architecture]
sources: [koin, dagger-hilt]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: di-hub
token_budget: 756
monitor_urls:
  - url: "https://github.com/InsertKoinIO/koin/releases"
    type: github-releases
    tier: 2
description: "DI testing patterns: Koin test lifecycle, interface-based binding, scoping rules, anti-patterns table"
slug: di-patterns-testing
status: active
layer: L0
parent: di-patterns
category: di
rules:
  - id: no-mocks-in-common-tests
    type: banned-import
    message: "Use pure Kotlin fakes in commonTest, not Mockito or MockK"
    detect:
      in_source_set: commonTest
      banned_import_prefixes:
        - "io.mockk"
        - "org.mockito"
      prefer: "pure Kotlin fake class"
    hand_written: false

---

# DI Patterns: Testing and Anti-Patterns

## Overview

Testing patterns for DI-wired code, including Koin test module setup, test lifecycle management, interface-based binding for testability, and a comprehensive anti-patterns reference.

---

## 1. Testing with Koin

Initialize Koin BEFORE Activity/test launch. Use `koinApplication` for isolated test modules.

```kotlin
@Before
fun setup() {
    startKoin {
        modules(
            module {
                single<SnapshotRepository> { FakeSnapshotRepository() }
                factory { SyncSnapshotsUseCase(get(), testDispatcher) }
            }
        )
    }
}

@After
fun tearDown() {
    stopKoin()
}
```

---

## 2. Interface-Based Binding

Bind interfaces in `commonMain`, implementations in platform source sets. This enables testing with fakes and platform-specific implementations.

```kotlin
// commonMain: interface
interface SnapshotRepository {
    suspend fun getSnapshots(): Result<List<Snapshot>>
}

// DI module: bind interface to implementation
// Koin: single<SnapshotRepository> { SnapshotRepositoryImpl(get()) }
// Dagger: @Binds abstract fun bindRepo(impl: SnapshotRepositoryImpl): SnapshotRepository
```

---

## 3. Platform-Specific Providers via expect/actual

When a dependency requires platform-specific construction (database drivers, crypto providers, file system access), use `expect`/`actual` to provide the platform-specific factory.

```kotlin
// commonMain
expect class PlatformContext

// androidMain
actual typealias PlatformContext = android.content.Context

// iosMain
actual class PlatformContext  // No-op or NSObject wrapper

// desktopMain
actual class PlatformContext  // File-path based context
```

---

## 4. Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|---|---|---|
| Service locator in business logic | Hidden dependencies, untestable, violates DI principle | Constructor injection |
| Field injection with `lateinit var` | Nullable at runtime, order-dependent, no compile-time safety | Constructor injection |
| DI annotations on data classes | Data classes are value types, not service objects | Only inject into services, use cases, ViewModels |
| Circular dependencies | Runtime crash or infinite loop during resolution | Redesign: extract shared interface, use lazy, or break cycle with mediator |
| Manual `get()` calls outside module declarations | Service locator pattern in disguise | Let the DI framework inject via constructor |
| Hilt annotations in `commonMain` | Does not compile on non-Android targets | Keep Hilt annotations in `androidMain` only |

---

Parent doc: [di-patterns.md](di-patterns.md)
