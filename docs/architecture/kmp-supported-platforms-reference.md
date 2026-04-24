---
slug: kmp-supported-platforms-reference
title: KMP Supported Platforms Reference
description: Citable reference for Kotlin Multiplatform and Compose Multiplatform platform stability matrix as of 2026. Source material for kmp-features-2026.md.
category: architecture
layer: L0
scope: KMP platform support tiers, Compose Multiplatform platform stability, target naming
targets: [kmp-features-2026.md, any doc referencing platform support status]
sources: [webfetch:github.com/jetbrains/kotlin-multiplatform-dev-docs/topics/overview/supported-platforms.md@2026-04-24]
status: reference
---

# KMP Supported Platforms Reference

Source: JetBrains KMP Dev Docs — supported-platforms.md (ingested 2026-04-24, user-approved)

## KMP Platform Stability Tiers

Kotlin Multiplatform defines three stability levels:

| Tier | Stability | Meaning |
|------|-----------|---------|
| **Stable** | Production-ready | JetBrains commits to compatibility and migration support |
| **Beta** | Feature-complete, may have minor issues | Can use in production with caveats |
| **Alpha** | Experimental | API may change; not production-recommended |

## KMP Targets by Platform

| Platform | Target | KMP Tier | Compose MP Tier |
|----------|--------|----------|-----------------|
| Android | `android` | Stable | Stable |
| JVM (Desktop) | `jvm` | Stable | Stable |
| iOS (arm64) | `iosArm64` | Stable | Beta |
| iOS Simulator | `iosSimulatorArm64` | Stable | Beta |
| macOS (arm64) | `macosArm64` | Stable | Beta |
| macOS (x64) | `macosX64` | Stable | Beta |
| Linux (x64) | `linuxX64` | Beta | Alpha |
| Windows (x64) | `mingwX64` | Beta | Alpha |
| JS (Browser) | `js` | Stable | Alpha |
| Wasm (Browser) | `wasmJs` | Alpha | Alpha |
| watchOS | `watchosArm64` | Beta | Not supported |
| tvOS | `tvosArm64` | Beta | Not supported |

## Compose Multiplatform Stability

Compose Multiplatform follows its own stability track, distinct from KMP core:

- **Stable**: Android, Desktop (JVM)
- **Beta**: iOS, macOS
- **Alpha**: Linux, Windows, Web (Wasm)

## Notes for kmp-features-2026.md Authors

- Use this table as the authoritative 2026 baseline for platform support claims
- Always distinguish KMP code-sharing tier from Compose UI tier — they differ for Apple targets
- Wasm/JS Compose is Alpha — do not recommend for production apps in pattern docs
- Verify against upstream JetBrains docs before citing in external-facing content
