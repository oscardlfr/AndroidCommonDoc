---
scope: [testing, benchmarks, performance, kotlin-native, r8]
sources: [kotlinx-benchmark, androidx-benchmark, kmp-features-2026]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-05-26"
assumes_read: testing-patterns-benchmarks
description: "Re-baseline guidance after Kotlin 2.4 / AGP bump: K/N CMS GC default (silent shift) and R8 coroutine rewrite (20-50% Android improvement)"
slug: testing-patterns-benchmarks-rebaseline
status: active
layer: L0
parent: testing-patterns-benchmarks
category: testing
---

# Benchmark Re-baseline After Kotlin 2.4 / AGP Bump

Parent: [testing-patterns-benchmarks.md](testing-patterns-benchmarks.md)

Kotlin 2.4 introduces two separate changes that silently shift benchmark baselines. Consumers must re-record after either bump.

## K/N CMS GC (Kotlin 2.4)

Kotlin 2.4 changes the default Kotlin/Native GC from PMCS to CMS (Concurrent Mark and Sweep).
CMS interacts with `nativeGCAfterIteration = true` differently — shorter but more frequent pauses.
**Benchmark baselines silently shift after a Kotlin 2.4 upgrade.**

- Re-record all K/N benchmarks after bumping Kotlin to 2.4.
- Rollback flag: `kotlin.native.gc=pmcs` in `gradle.properties` — use only if regression confirmed.
- See `kmp-features-2026.md` → "Kotlin/Native 2.4 Runtime Changes" for full context.

## R8 Coroutine Rewrite (AGP + Kotlin 2.4)

R8 paired with AGP + Kotlin 2.4 rewrote coroutine lock handling — up to 50% perf improvement
on Compose benchmarks. **Android benchmark baselines may improve 20-50% after AGP bump.**

- Re-record all Android benchmarks after bumping AGP.
- Attribute the improvement to R8, not to code changes — do not revert unrelated code to "fix" it.
- See `agp9-consumer-rules-banned-directives.md` for why `-dontoptimize` is banned.
