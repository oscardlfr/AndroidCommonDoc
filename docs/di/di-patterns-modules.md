---
scope: [dependency-injection, koin, dagger-hilt, modules]
sources: [koin, dagger-hilt]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: di-hub
token_budget: 903
monitor_urls:
  - url: "https://github.com/InsertKoinIO/koin/releases"
    type: github-releases
    tier: 2
description: "DI module declaration patterns: Koin modules, koinViewModel, SharedSdk.init() runtime wiring, Dagger/Hilt ViewModel injection, KMP platform modules, hybrid patterns"
slug: di-patterns-modules
status: active
layer: L0
parent: di-patterns
category: di
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

# DI Patterns: Module Declarations

## Overview

Module declaration patterns for both Koin (KMP-native) and Dagger/Hilt (Android-centric), including ViewModel injection, app startup, KMP platform modules, and hybrid KMP+Hilt patterns.

---

## 1. Koin Module Declarations

### Module Declaration

```kotlin
// feature/snapshot/di/SnapshotModule.kt
val snapshotModule = module {
    single<SnapshotRepository> { SnapshotRepositoryImpl(get(), get()) }
    factory { SyncSnapshotsUseCase(get(), get()) }
    viewModel { SnapshotListViewModel(get()) }
}
```

### ViewModel Injection in Compose

```kotlin
// Screen composable (commonMain)
@Composable
fun SnapshotListScreen(
    viewModel: SnapshotListViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    // ...
}
```

### App Startup — SharedSdk.init()

The recommended startup pattern uses `SharedSdk.init()` as the single entry point for runtime DI wiring. It creates an isolated `koinApplication` (Koin 4.x), registers SDK modules and optional app modules, and exposes `SharedSdk.koin` for resolution.

```kotlin
// Application entry point (L2 app)
SharedSdk.init(
    modules = setOf(
        SdkModule.Encryption.Default,
        SdkModule.Network.Ktor,
        SdkModule.Io.KotlinxIo,
    ),
    config = SdkConfig(debug = BuildConfig.DEBUG),
    appModules = listOf(dataModule, domainModule, viewModelModule),
)

// Resolve from the shared graph
val koin = SharedSdk.koin
```

`SharedSdk.init()` is the **runtime** counterpart to Gradle composite builds (**build-time**). Both are required; neither replaces the other.

> Authoritative reference: [Build-Time vs Runtime](../gradle/gradle-patterns-dependencies.md) — complementarity table and full explanation.
> Deep dive: [Koin SDK + Dagger App hybrid](../archive/di-hybrid-koin-sdk-dagger-app.md) -- bridge pattern for Hilt consumers.

### Desktop/Compose — GlobalContext Bridge

`SharedSdk.init()` creates an **isolated** `koinApplication` (not `startKoin`). Compose helpers (`koinViewModel()`, `LocalKoinScope`, `KoinContext`) look up `GlobalContext`, which remains empty unless explicitly bridged.

**DO**: Register the SDK instance into GlobalContext on Desktop/Compose:

```kotlin
// desktopApp Main.kt
fun main() = application {
    val app = remember {
        val koinApp = SharedSdk.init(
            modules = setOf(SdkModule.Encryption.Default, ...),
            appModules = listOf(appModule, viewModelModule),
        )
        GlobalContext.startKoin(koinApp)  // Bridge: isolated → global
        koinApp
    }

    Window(onCloseRequest = ::exitApplication) {
        App()  // koinViewModel() now works
    }
}
```

**DON'T**: Call `startKoin {}` separately — it creates a second Koin instance. Use `GlobalContext.startKoin(app)` with the existing `koinApplication` returned by `SharedSdk.init()`.

**Why `remember`**: `SharedSdk.init()` has an idempotency guard, and `GlobalContext.startKoin` throws `KoinApplicationAlreadyStartedException` on double-call. Wrapping in `remember` prevents re-execution on recomposition.

**Android**: `startKoin {}` in `Application.onCreate()` registers globally by default — no bridge needed. The issue is Desktop-specific because `application {}` is a composable scope.

**Key insight**: `koinApplication {}` creates the DI graph but does NOT register it in `GlobalContext`. `startKoin {}` does both. `GlobalContext.startKoin(app)` bridges an existing isolated graph into the global scope. `createEagerInstances()` runs during the bridge call, activating `createdAtStart = true` singletons.

### Fallback — Standalone Apps

For projects **without** a shared SDK layer:

```kotlin
// Direct koinApplication (acceptable for single-app projects)
fun initKoin(): KoinApplication = koinApplication {
    modules(coreModule, networkModule, snapshotModule)
}
```

### KMP Platform Modules

```kotlin
// commonMain
expect val platformModule: Module

// androidMain
actual val platformModule = module {
    single<DatabaseDriver> { AndroidSqliteDriver(AppDatabase.Schema, get(), "app.db") }
}

// iosMain
actual val platformModule = module {
    single<DatabaseDriver> { NativeSqliteDriver(AppDatabase.Schema, "app.db") }
}
```

---

## 2. Dagger/Hilt Module Declarations

Dagger/Hilt is Android-centric. For KMP projects using Hilt, DI setup lives in `androidMain` while shared code uses constructor injection without Hilt annotations.

### ViewModel with Hilt

```kotlin
// androidMain
@HiltViewModel
class SnapshotListViewModel @Inject constructor(
    private val syncSnapshots: SyncSnapshotsUseCase
) : ViewModel() {
    // ...
}
```

### Module/Component Hierarchy

```kotlin
// androidMain - di/SnapshotModule.kt
@Module
@InstallIn(SingletonComponent::class)
abstract class SnapshotModule {
    @Binds
    abstract fun bindRepository(impl: SnapshotRepositoryImpl): SnapshotRepository
}

@Module
@InstallIn(SingletonComponent::class)
object SnapshotProviderModule {
    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(context, AppDatabase::class.java, "app.db").build()
    }
}
```

### KMP + Hilt Hybrid Pattern

For KMP projects using Hilt on Android: annotate Application with `@HiltAndroidApp`, Activity with `@AndroidEntryPoint`. Shared code in `commonMain` uses plain constructor injection -- Hilt annotations only in `androidMain`.

```kotlin
// commonMain -- no DI annotations, pure Kotlin
class SyncSnapshotsUseCase(
    private val repository: SnapshotRepository,
    private val dispatcher: CoroutineDispatcher
)

// androidMain -- Hilt provides the wiring
@Module
@InstallIn(SingletonComponent::class)
object UseCaseModule {
    @Provides
    fun provideSyncSnapshots(
        repository: SnapshotRepository,
        @IoDispatcher dispatcher: CoroutineDispatcher
    ): SyncSnapshotsUseCase = SyncSnapshotsUseCase(repository, dispatcher)
}
```

---

Parent doc: [di-patterns.md](di-patterns.md)
