---
scope: [architecture, dependency-injection, sdk-design, research]
sources: [dagger2, koin, hilt, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 5
last_updated: "2026-03"
description: "DI framework comparison for SDK selective init — Dagger 2 (monolithic + per-feature), Koin, Hilt, kotlin-inject. Architecture requirements checklist, approach trade-offs, decision matrix. Neutral — no framework preference."
slug: di-sdk-selective-init-comparison
status: archived
layer: L0
category: archive
---

# DI SDK Selective Init — Framework Comparison

Comparison of DI approaches for an SDK where consumers select which modules to initialize without importing implementation classes. This document presents trade-offs — the right choice depends on your constraints.

**Related docs:**
- [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md) — Dagger 2 implementation (Approach A: monolithic, B: per-feature, C: ServiceLoader)
- [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md) — Consumer isolation levels (what the app sees vs binary contents)

## The Problem

An SDK with N feature modules where:

1. Each feature has multiple implementations (Ktor vs Retrofit, MMKV vs DataStore)
2. Consumers pick which implementations to use at init time
3. **Consumers never import implementation classes** — only a type-safe selector
4. Shared singletons must not duplicate
5. Modules not requested must not be instantiated
6. Registration should be automatic — Gradle dependency is sufficient

## DI vs Service Locator — The Fundamental Distinction

Before comparing frameworks, understand the two paradigms. This is often the deciding factor for teams that prioritize architectural purity.

### Dependency Injection (DI)

The framework **pushes** dependencies into the class. The class declares what it needs — it never asks for it.

```kotlin
// Pure DI — class receives dependencies, doesn't know where they come from
class SecurityServiceImpl @Inject constructor(
    private val network: NetworkExecutor,   // injected by framework
    private val logger: Logger,             // injected by framework
) : SecurityService { ... }
```

The class has **zero knowledge** of the DI container. It works in any context — production, test, manual instantiation. The framework (Dagger, kotlin-inject) resolves the graph at compile time and generates the wiring code.

**Frameworks:** Dagger 2, Hilt, kotlin-inject

### Service Locator

The class **pulls** dependencies from a global registry. The class actively asks for what it needs.

```kotlin
// Service Locator — class asks for dependencies
class SecurityServiceImpl(
    private val network: NetworkExecutor = get(),   // pulled from Koin
    private val logger: Logger = get(),             // pulled from Koin
) : SecurityService { ... }

// Or via Koin's inject pattern:
class MyViewModel : ViewModel() {
    private val repository: Repository by inject()  // pulled at access time
}
```

The class **knows about Koin** (or the locator). It cannot work without the container being initialized. Testing requires either starting the container or providing manual overrides.

**Frameworks:** Koin, kodein

### Why teams choose pure DI

| Argument | Explanation |
|----------|-------------|
| **Compile-time safety** | Missing bindings fail the build, not the user's device |
| **No hidden dependencies** | Constructor signature = complete dependency list |
| **Testability** | Class works with `new SecurityServiceImpl(fakeNetwork, fakeLogger)` — no container needed |
| **SOLID compliance** | Dependency Inversion Principle at the framework level |
| **IDE support** | Dagger's generated code is navigable — click through from `@Inject` to `@Provides` |

### Why teams choose Service Locator

| Argument | Explanation |
|----------|-------------|
| **KMP support** | Koin works on all Kotlin targets — Dagger is JVM-only |
| **Zero codegen** | No annotation processing, fastest builds |
| **Simplicity** | `module { single<X> { XImpl() } }` — smaller API surface |
| **Runtime flexibility** | Modules composable at runtime, not locked at compile time |
| **Auto-discovery** | Level 3 isolation achievable (sealed class + Class.forName) |

### The honest trade-off

Dagger is architecturally purer — it implements true Inversion of Control where the class never knows about the container. Koin is pragmatically simpler and achieves better consumer isolation for SDKs — but at the cost of runtime resolution and container awareness in code.

Neither is universally "better." The choice depends on whether the team values **compile-time purity** or **runtime flexibility**.

## Architecture Requirements Checklist

Use this checklist to evaluate ANY approach. A solution doesn't need to pass all 10 — prioritize based on your project constraints.

| # | Requirement | Weight | Question |
|---|-------------|--------|----------|
| 1 | Selective init | Critical | Can the consumer pick exactly which modules to activate? |
| 2 | Consumer impl isolation | Critical | Does production code import ZERO impl classes? |
| 3 | Shared singletons | High | Are shared services (logger, config, network) guaranteed single-instance? |
| 4 | Lazy instantiation | High | Are unselected modules never instantiated? |
| 5 | SDK-core independence | High | Does the SDK orchestrator depend on ZERO impl modules in production? |
| 6 | Auto-registration | Medium | Is adding a Gradle dependency sufficient, or must the consumer also call `register()`? |
| 7 | Binary lean | Medium | Does the consumer binary include only selected impls? |
| 8 | Platform discovery | Varies | Does module discovery work on all target platforms? |
| 9 | Category validation | Medium | Are conflicting impls (two network backends) rejected at init? |
| 10 | Compile-time safety | Varies | Are missing bindings caught at build time or runtime? |

## Approaches

### 1. Koin — Runtime DI, Full KMP

**Type:** Runtime service locator | **KMP:** Full | **Codegen:** None

**Init model:** Umbrella with selective module set
```kotlin
SharedSdk.init(
    modules = setOf(SdkModule.Io.KotlinxIo, SdkModule.Encryption.Default),
    config = SdkConfig(debug = false),
    appModules = listOf(myAppModule),
)
```

**Module discovery:** `Class.forName` (JVM) + `@EagerInitialization` (Native). Each impl self-registers via `object init {}` block.

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. Selective init | ✅ | Consumer passes `Set<SdkModule>` |
| 2. Consumer isolation | ✅ | 0 impl imports in production code |
| 3. Shared singletons | ✅ | Single Koin application lifecycle |
| 4. Lazy instantiation | ✅ | Class.forName only on requested modules |
| 5. SDK-core independence | ✅ | core-sdk has 0 impl deps in production |
| 6. Auto-registration | ✅ | Gradle dep → object init → register |
| 7. Binary lean | ✅ | Only selected impls on classpath |
| 8. Platform discovery | ✅ | JVM + Native covered |
| 9. Category validation | ✅ | `validateNoDuplicateCategories()` at init |
| 10. Compile-time safety | ❌ | Missing bindings crash at runtime |

**When this is the right choice:**
- Multi-platform SDK (Android + iOS + Desktop + macOS)
- Team values simplicity and zero codegen overhead
- Runtime validation via `checkModules()` in tests is acceptable

**When this is NOT the right choice:**
- Compile-time binding safety is non-negotiable
- Team is uncomfortable with service locator pattern
- JVM-only project where Dagger's maturity is preferred

### 2. Dagger 2 — Monolithic Component

**Type:** Compile-time DI | **KMP:** None (JVM only) | **Codegen:** KAPT or KSP (alpha)

**Init model:** Umbrella, all modules compiled in
```kotlin
MySdk.init(context, config, setOf(SdkModule.AUTH, SdkModule.ANALYTICS))
```

**Module discovery:** Not needed — `@Component` lists all `@Module` classes explicitly.

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. Selective init | ✅ | Via `Provider<ModuleInitializer>` laziness |
| 2. Consumer isolation | ❌ | All impls compiled into `@Component` |
| 3. Shared singletons | ✅ | `@Singleton` scope on single Component |
| 4. Lazy instantiation | ✅ | `Provider<>` delays instantiation |
| 5. SDK-core independence | ❌ | `@Component` must list all `@Module` classes |
| 6. Auto-registration | ✅ | `@IntoMap` + `@Module` is sufficient |
| 7. Binary lean | ❌ | All impl code linked regardless of selection |
| 8. Platform discovery | N/A | JVM only, no discovery needed |
| 9. Category validation | ✅ | Custom validation at init time |
| 10. Compile-time safety | ✅ | Missing bindings = build error |

**When this is the right choice:**
- Android-only SDK with small number of modules (≤10)
- Compile-time safety is the top priority
- Team has Dagger experience
- Binary size is not a concern (internal SDK)

**When this is NOT the right choice:**
- SDK has many optional modules (binary bloat)
- Per-module publishing required
- Consumer must not see impl classes

### 3. Dagger 2 — Per-Feature Component (Modern)

**Type:** Compile-time DI, per-feature isolation | **KMP:** None | **Codegen:** KAPT/KSP

**Init model:** Per-module, consumer initializes each feature independently
```kotlin
val core = CoreApis.create(config)
FeatureSecurity.init(core)
FeatureObservability.init(core)
```

**Module discovery:** Not needed — each feature has its own Component and init.

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. Selective init | ✅ | Consumer calls init on desired features only |
| 2. Consumer isolation | ✅ | Each feature is an independent module |
| 3. Shared singletons | ⚠️ | Via CoreApis interface, not `@Singleton` graph |
| 4. Lazy instantiation | ✅ | Uninitialised features don't exist |
| 5. SDK-core independence | ✅ | Core only has interfaces, no impl deps |
| 6. Auto-registration | ❌ | Consumer must explicitly call `Feature.init()` |
| 7. Binary lean | ✅ | Only selected features in binary |
| 8. Platform discovery | N/A | JVM only, explicit init |
| 9. Category validation | ⚠️ | Manual — no global registry to check |
| 10. Compile-time safety | ✅ | Per-feature graph validated at build |

**When this is the right choice:**
- Large SDK distributed to external consumers
- Per-module Maven publishing required
- Consumer teams want fine-grained dependency control
- Binary size matters (enterprise SDKs with 20+ optional features)

**When this is NOT the right choice:**
- Many features need to share services beyond CoreApis (each cross-feature dependency adds a field to CoreApis → [God Object risk](dagger2-sdk-selective-init.md#cross-feature-dependency-limitation-applies-to-b-and-c))
- Team wants zero-ceremony module addition
- Cross-feature compile-time graph validation needed

### 4. Dagger 2 — Per-Feature + ServiceLoader Discovery

**Type:** Compile-time DI + runtime discovery | **KMP:** None (JVM only, ServiceLoader) | **Codegen:** KAPT/KSP

Builds on Per-Feature's isolated Components but adds `ServiceLoader` for automatic feature registration. See [dagger2-sdk-selective-init.md — Approach C](dagger2-sdk-selective-init.md#approach-c-per-feature-with-serviceloader-discovery) for full implementation.

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. Selective init | ✅ | `MySdk.init(setOf(...))` discovers available features |
| 2. Consumer isolation | ✅ | Consumer uses `MySdk.get<Service>()`, no feature facade import |
| 3. Shared singletons | ⚠️ | Via CoreApis interface |
| 4. Lazy instantiation | ✅ | Undiscovered features not instantiated |
| 5. SDK-core independence | ✅ | Core defines contract only — zero impl deps |
| 6. Auto-registration | ✅ | META-INF/services — Gradle dep is enough |
| 7. Binary lean | ✅ | Only features with Gradle dep are linked |
| 8. Platform discovery | ❌ | ServiceLoader is JVM-only |
| 9. Category validation | ⚠️ | Manual at init time |
| 10. Compile-time safety | ⚠️ | Per-feature graph only, runtime discovery errors |

**When this is the right choice:**
- Large Android-only SDK with 20+ optional features
- Adding features frequently without touching core
- Team wants compile-time DI purity with runtime discovery convenience

**When this is NOT the right choice:**
- KMP required (ServiceLoader is JVM-only)
- Team wants zero runtime error risk from missing deps
- SDK has few features (overhead not justified)
- Features depend on each other's services (same [CoreApis God Object risk](dagger2-sdk-selective-init.md#cross-feature-dependency-limitation-applies-to-b-and-c) as Per-Feature)

### 5. Hilt

**Not recommended for SDKs.** `@HiltAndroidApp` annotation conflicts when multiple SDKs coexist in the same app. Designed for apps that own the `Application` class.

Use for: **Android apps** (not libraries or SDKs).

### 6. kotlin-inject

**Type:** Compile-time DI with KSP | **KMP:** Full | **Codegen:** KSP

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. Selective init | ✅ | Via component composition |
| 2. Consumer isolation | ✅ | Separate component per feature |
| 3. Shared singletons | ✅ | Component scope |
| 4. Lazy instantiation | ✅ | Component not created = no instances |
| 5. SDK-core independence | ✅ | Core defines interfaces only |
| 6. Auto-registration | ❌ | Consumer composes components explicitly |
| 7. Binary lean | ✅ | Only included components |
| 8. Platform discovery | ✅ | KSP runs on all KMP targets |
| 9. Category validation | ⚠️ | Manual validation |
| 10. Compile-time safety | ✅ | Full compile-time graph validation |

**When this is the right choice:**
- KMP SDK where compile-time safety is non-negotiable
- Team willing to adopt a pre-1.0 framework
- Multibindings needed (available since 0.7+)

**When this is NOT the right choice:**
- Need production-proven stability (Koin/Dagger are battle-tested)
- Team wants zero codegen (Koin)
- Simpler API preferred

## Side-by-Side Comparison

| Criterion | Koin | Dagger Mono | Dagger Per-Feature | Dagger + ServiceLoader | kotlin-inject |
|-----------|------|-------------|-------------------|----------------------|---------------|
| **Max isolation level** | Level 3 | Level 1 | Level 1 | Level 1-2 | Level 2 |
| **Graph validation** | Runtime | Compile | Compile (per-feat) | Compile (per-feat) | Compile |
| **KMP support** | ✅ Full | ❌ JVM | ❌ JVM | ❌ JVM | ✅ Full |
| **Consumer isolation** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Binary lean** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Build speed** | ✅ None | ❌ KAPT | ❌ KAPT/KSP | ❌ KAPT/KSP | ⚠️ KSP |
| **Init model** | Umbrella | Umbrella | Per-feature | Umbrella (discovered) | Per-component |
| **Singleton sharing** | koinApplication scope | @Singleton | CoreApis (⚠️) | CoreApis (⚠️) | Component |
| **Auto-registration** | ✅ | ✅ @IntoMap | ❌ Manual | ✅ ServiceLoader | ❌ Manual |
| **Adding a feature** | 1 entry | 1 @Component edit | New Component | META-INF only | New Component |
| **Maturity** | Production | Production | Production | Production (JVM) | Pre-1.0 |
| **DI paradigm** | Service Locator | Pure DI | Pure DI | Pure DI | Pure DI |

## Decision Matrix

| Your constraint | Best fit |
|-----------------|----------|
| Must support iOS/macOS/Desktop | Koin or kotlin-inject |
| Compile-time safety non-negotiable | Dagger or kotlin-inject |
| Pure DI (no service locator) | Dagger (any approach) or kotlin-inject |
| Android-only, small module count | Dagger Monolithic |
| Android-only, modular publishing | Dagger Per-Feature |
| Android-only, 20+ features, zero central edits | Dagger + ServiceLoader |
| Zero codegen, fastest builds | Koin |
| KMP + compile-time safety | kotlin-inject |
| Team has Dagger expertise | Dagger (any approach) |
| Team prefers simple API | Koin |
| Enterprise SDK, many optional features | Dagger + ServiceLoader or Koin |
| Binary size critical | Koin, Dagger Per-Feature, Dagger + ServiceLoader, or kotlin-inject |
| Hybrid: KMP SDK consumed by Dagger app | Koin inside SDK + Dagger bridge (see [isolation doc](di-sdk-consumer-isolation.md#hybrid-koin-inside-sdk--dagger-in-app)) |

## Version Compatibility (2026)

| Component | Koin | Dagger | kotlin-inject |
|-----------|------|--------|---------------|
| Kotlin | 2.3+ | 2.1+ (KSP), any (KAPT) | 2.0+ |
| AGP | N/A | 8.9+ (KSP alpha pending AGP 9) | N/A |
| Codegen | None | KAPT (stable), KSP (alpha 2.48+) | KSP |
| Maturity | 4.1+ (stable) | 2.52+ (10+ years) | 0.7+ (pre-1.0) |

## Singleton Survival Across Reinit

Some singletons must survive `shutdown() → init()` cycles. Typical example: a logger that holds file handles, correlation IDs, and buffered entries. Recreating it on reinit would lose pending logs and break tracing.

The pattern: hold process-lifetime singletons in an **external holder** outside the DI lifecycle. The DI container references the existing instance — it never creates a new one.

**What survives reinit:** Singletons that hold state accumulated over the process lifetime — loggers, telemetry pipelines, credential caches, ID generators.

**What gets recreated:** Configuration that may change between cycles — debug flags, API endpoints, environment settings.

### Koin

```kotlin
// External holder — lives outside Koin lifecycle
internal object FoundationSingletons {
    val logger: EventLogger = EventLoggerImpl()
    val idGenerator: IdGenerator = UuidIdGenerator()
}

// Koin module references existing instance, never creates new
fun foundationModule(config: SdkConfig) = module {
    single<EventLogger> { FoundationSingletons.logger }       // survives reinit
    single<IdGenerator> { FoundationSingletons.idGenerator }   // survives reinit
    single<SdkConfig> { config }                               // recreated each init
}

// SDK init uses isolated koinApplication (not global startKoin)
val app = koinApplication {
    modules(foundationModule(config) + resolvedModules)
}
```

`shutdown()` calls `koinApp.close()` — the isolated Koin instance is destroyed, but `FoundationSingletons` is a Kotlin `object` (static), so its fields persist until process death.

### Dagger 2 — Monolithic

```kotlin
// External holder — same concept
object FoundationSingletons {
    val logger: EventLogger = EventLoggerImpl()
}

@Module
object CoreModule {
    @Provides @Singleton
    fun provideLogger(): EventLogger = FoundationSingletons.logger  // survives reinit

    @Provides @Singleton
    fun provideConfig(config: SdkConfig): SdkConfig = config  // recreated via Builder
}

// On reinit: DaggerSdkComponent is rebuilt, but logger is the same instance
```

### Dagger 2 — Per-Feature

```kotlin
// CoreApis holds the survivors
class CoreApisImpl private constructor(val config: SdkConfig) : CoreApis {
    override val logger: EventLogger = FoundationSingletons.logger  // survives
    override val config: SdkConfig = config                          // recreated

    companion object {
        fun create(config: SdkConfig) = CoreApisImpl(config)
    }
}

// Each feature receives CoreApis — logger is always the same instance
FeatureSecurity.init(CoreApis.create(newConfig))
```

### kotlin-inject

```kotlin
// Same external holder pattern
object FoundationSingletons {
    val logger: EventLogger = EventLoggerImpl()
}

@Component
abstract class SdkComponent(
    @get:Provides val config: SdkConfig,           // recreated each init
) {
    @Provides fun logger(): EventLogger =
        FoundationSingletons.logger                 // survives reinit
}
```

### Key Principle

The pattern is framework-agnostic: **hold process-lifetime state in a `object` (Kotlin) or `static` (Java) outside the DI graph**. The DI container wraps it — it doesn't own it. This works identically in Koin, Dagger, and kotlin-inject.

## Anti-Pattern: Consumer Imports Impl Classes

Regardless of DI framework, consumers should never import implementation classes:

```kotlin
// ❌ WRONG — coupled to implementation
import com.example.sdk.io.kotlinxio.KotlinxIoFileSystemProvider
val fs = KotlinxIoFileSystemProvider()

// ✅ RIGHT — depends on interface, impl provided by DI
val fs: FileSystemProvider = get()  // Koin
val fs = component.fileSystemProvider()  // Dagger/kotlin-inject
```

If your consumer code imports classes from `*.impl.*`, `*.internal.*`, or platform-specific packages like `*.kotlinxio.*`, `*.okio.*`, `*.jvm.*` — you have a coupling problem that will break when the SDK changes implementations.
