---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, koin, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 4
last_updated: "2026-03"
description: "SDK DI concepts — isolation levels, DI vs Service Locator, cross-feature dependencies, singleton survival. Framework-agnostic principles with honest framework capabilities."
slug: di-sdk-consumer-isolation
status: archived
layer: L0
category: archive
---

# SDK DI Concepts

Foundational concepts for building modular SDKs with dependency injection. Framework-agnostic principles — applies to Dagger, Koin, kotlin-inject, or manual DI.

For Dagger 2 implementations, see [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md).
For framework comparison, see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md).

---

## DI vs Service Locator

Two paradigms for managing dependencies. Understanding this distinction matters because it determines what guarantees you get at compile time.

### Dependency Injection (Pure DI)

The framework generates code that creates objects and passes their dependencies via constructor. The class never asks for anything:

```kotlin
// The class — zero knowledge of any DI container
class SecurityServiceImpl(
    private val network: NetworkExecutor,
    private val logger: Logger,
) : SecurityService

// Dagger module — tells Dagger HOW to create SecurityServiceImpl
@Module class SecurityModule {
    @Provides fun security(network: NetworkExecutor, logger: Logger): SecurityService =
        SecurityServiceImpl(network, logger)  // Dagger calls this, passing network and logger
}
```

Dagger's annotation processor reads `@Provides`, sees that `SecurityServiceImpl` needs `NetworkExecutor` and `Logger`, finds those in other `@Provides` methods, and generates a factory class that wires everything at compile time. If `NetworkExecutor` has no provider, the build fails — not the app.

**Frameworks:** Dagger 2, Hilt, kotlin-inject

### Service Locator

The framework holds a registry of "how to create X". Code asks the registry at runtime:

```kotlin
// Koin module — registers HOW to create things
val securityModule = module {
    single<SecurityService> { SecurityServiceImpl(get(), get()) }
    //                                             ^^^   ^^^
    //                          asks Koin "give me a NetworkExecutor" and "give me a Logger"
}
```

`get()` is a runtime lookup — Koin searches its registry for something that matches the requested type. If nothing is registered, it crashes at runtime.

**Important nuance:** The `SecurityServiceImpl` class itself uses constructor injection — it takes `network` and `logger` as constructor args. The difference is WHERE the resolution happens. In Dagger, it happens at compile time (codegen). In Koin, it happens at runtime (`get()` inside the module lambda).

**Frameworks:** Koin, kodein

### Trade-offs

| | Pure DI (Dagger, kotlin-inject) | Service Locator (Koin) |
|---|---|---|
| **Missing dependency** | Build fails | App crashes at runtime |
| **Graph validation** | Compile-time | `checkModules()` in tests |
| **Build speed** | Slower (KAPT/KSP codegen) | Faster (no codegen) |
| **KMP support** | Dagger: JVM only. kotlin-inject: full | Full (JVM + Native + JS) |
| **Runtime flexibility** | Graph fixed at compile time | Modules composable at runtime |
| **Feature auto-discovery** | Not possible with Dagger | Yes (Class.forName, @EagerInit) |
| **Code size** | Generates factory classes | No generated code |

Neither is universally better. Pure DI catches more bugs at build time. Service Locator enables runtime composition (auto-discovery, conditional modules) that compile-time DI cannot.

---

## Consumer Isolation Levels

How much does the consuming app know about SDK internals?

### Level 0 — No isolation (anti-pattern)

Consumer creates impl classes directly:
```kotlin
import com.example.sdk.security.internal.SecurityServiceImpl
import com.example.sdk.network.internal.KtorNetworkClient
val service = SecurityServiceImpl(KtorNetworkClient())
```
Consumer's Gradle: `implementation("com.example:security-impl:1.0")`.

If the SDK renames `SecurityServiceImpl` or changes its constructor, the consumer's code breaks. The consumer is coupled to internal details.

### Level 1 — Facade

Consumer calls a facade object. Sees the facade, not what's behind it:
```kotlin
import com.example.sdk.MySdk
MySdk.init(context, config, setOf(Feature.SECURITY))
val service = MySdk.security()
```
Consumer's Gradle: `implementation("com.example:sdk:1.0")`.

The consumer doesn't import `SecurityServiceImpl`, `KtorNetworkClient`, or any Dagger class. The facade hides all internal wiring. The SDK can completely rewrite its internals without breaking the consumer — as long as the facade API stays the same.

### Level 2 — Interface + auto-discovery

Consumer depends on an abstract API. The SDK discovers and wires implementations automatically:
```kotlin
import com.example.sdk.SdkModule
import com.example.sdk.SharedSdk
SharedSdk.init(modules = setOf(SdkModule.Security))
val service: SecurityService = SharedSdk.get()
```
Consumer's Gradle: `implementation("com.example:sdk-core:1.0")` + `runtimeOnly("com.example:security-impl:1.0")`.

The consumer never imports any impl module in code. Just adding the Gradle dependency is enough — the SDK discovers it at runtime. This is only possible with runtime resolution (Koin, ServiceLoader).

### What each framework achieves

| Framework | Max level | Why |
|-----------|----------|-----|
| **Dagger Monolithic** | 1 | Facade hides impls, but all are compiled into the binary |
| **Dagger Per-Feature** | 1 | Facade per feature, consumer imports facade from integration module |
| **Dagger + ServiceLoader** | 1-2 | ServiceLoader discovers, but limited to JVM |
| **Koin** | 2 | Runtime discovery via Class.forName / @EagerInit, full KMP |
| **kotlin-inject** | 1 | Consumer explicitly composes components |

**Why Dagger can't reach Level 2:** Dagger needs to know ALL `@Module` classes at compile time to generate the factory code. It can't discover a module that was added as a Gradle dependency after the Component was compiled. This is the trade-off for compile-time safety.

---

## Cross-Feature Dependencies

When Feature A needs a service from Feature B.

### In a single graph (Dagger A / Koin)

No problem — all services are visible to each other:

```
┌─────────────────────────────────────────────────┐
│              ONE graph (Dagger A or Koin)        │
│                                                   │
│  Logger ─── AuthService ─── PaymentService       │
│    ↑             ↑                ↑               │
│  CoreModule    AuthModule    PaymentsModule       │
│                                   │               │
│              PaymentsModule can @Inject AuthService│
└─────────────────────────────────────────────────┘
```

PaymentsModule declares `AuthService` as a parameter, Dagger/Koin resolves it from the same graph.

### In per-feature isolation (Dagger B, C)

Each feature has its own separate DaggerComponent. They can't see each other:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ SecurityComp │    │ PaymentsComp │    │ AnalyticsComp│
│   @Singleton │    │   @Singleton │    │   @Singleton │
│              │    │              │    │              │
│ SecuritySvc  │    │ PaymentsSvc  │    │ AnalyticsSvc │
│ SecurityImpl │    │ PaymentsImpl │    │ AnalyticsImpl│
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └──────────┬────────┘───────────────────┘
                  ↓
          ┌──────────────┐
          │   CoreApis   │   ← plain Kotlin interface, NOT a @Component
          │              │
          │ logger       │   created once, passed to each feature
          │ config       │
          │ network      │
          └──────────────┘
```

**What CoreApis is:** A plain Kotlin interface — not a Dagger component, not DI. It's a manual bridge. You create `CoreApisImpl` once and pass it as a constructor argument to each feature's `DaggerComponent.Builder`.

**What CoreApis is NOT:** It does NOT resolve dependencies. It does NOT create singletons. It's just a data holder with references to shared objects.

**The problem:** If `PaymentsService` needs `SecurityService`, there's no way to get it:

1. **Add SecurityService to CoreApis** — works for 2-3 shared services. At 15+, CoreApis becomes a God Object that knows everything, defeating per-feature isolation.
2. **Initialize in order** — init Security first, then pass `security.service()` to Payments. Creates hidden ordering dependencies between features.
3. **Design features to be independent** — the architecturally honest answer. Shared infrastructure (logger, network, config) lives in CoreApis. Feature-specific services don't cross boundaries.

**Bottom line:** Per-feature Dagger (B, C) works well when features are truly independent. If many features need each other's services, use Dagger Monolithic (A) or Koin.

---

## Singleton Survival Across Reinit

Some singletons must survive `shutdown() → init()` cycles — loggers holding file handles, telemetry with buffered entries, correlation ID generators.

The pattern is framework-agnostic: hold process-lifetime state in a Kotlin `object` outside the DI container.

```kotlin
// Lives outside any DI container — created once at class load time
internal object FoundationSingletons {
    val logger: EventLogger = EventLoggerImpl()
    val idGenerator: IdGenerator = CommonIdGenerator()
}
```

Each framework references the existing instance instead of creating a new one:

```kotlin
// Koin — lambda returns the existing object, doesn't create new
fun foundationModule(config: SdkConfig) = module {
    single<EventLogger> { FoundationSingletons.logger }   // same instance every init()
    single<SdkConfig> { config }                           // new value each init()
}

// Dagger — @Provides returns the existing object
@Module object CoreModule {
    @Provides @Singleton
    fun logger(): EventLogger = FoundationSingletons.logger
}

// kotlin-inject
@Component abstract class SdkComponent(@get:Provides val config: SdkConfig) {
    @Provides fun logger(): EventLogger = FoundationSingletons.logger
}
```

When `shutdown()` destroys the DI container (Koin closes, Dagger component = null), `FoundationSingletons` survives because it's a Kotlin `object` (static singleton at the JVM/Native level). Next `init()` creates a new container that re-references the same instances.

---

## Hybrid: Koin SDK + Dagger App

A KMP SDK can use Koin internally while the consuming Android app uses Dagger/Hilt. No conflict because:
- Dagger has no global runtime state — it generates plain factory classes
- Koin 4.x supports `koinApplication {}` — isolated instance, not global

```kotlin
// SDK — uses isolated Koin instance
object SharedSdk {
    private var _koinApp: KoinApplication? = null
    val koin: Koin get() = _koinApp!!.koin

    fun init(modules: Set<SdkModule>, config: SdkConfig) {
        _koinApp = koinApplication {   // isolated, NOT startKoin
            modules(foundationModule(config) + resolvedModules)
        }
    }
}

// App — uses Dagger/Hilt, bridges to SDK's Koin
@Module @InstallIn(SingletonComponent::class)
object SdkBridgeModule {
    @Provides @Singleton
    fun security(): SecurityService = SharedSdk.koin.get()
}
```

**Critical:** SDK must use `koinApplication {}` (isolated), not `startKoin {}` (global). Both claiming `GlobalContext` = crash.
