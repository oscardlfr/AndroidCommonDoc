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
description: "DI module declaration patterns: Koin modules, koinViewModel, Dagger/Hilt ViewModel injection, KMP platform modules, hybrid patterns"
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

### App Startup

```kotlin
// Application or main entry point
fun initKoin() {
    startKoin {
        modules(
            coreModule,
            networkModule,
            snapshotModule,
            // ... all feature modules
        )
    }
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
