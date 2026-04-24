---
scope: KMP platform capability matrix — 8 platforms × 10 features
sources:
  - docs/architecture/kmp-supported-platforms-reference.md
  - docs/architecture/kotlinx-io-reference.md
  - docs/architecture/kotlinx-coroutines-reference.md
targets: [arch-platform.md, kmp-architecture-sourceset.md]
category: architecture
slug: kmp-features-2026
last_verified: 2026-04-24
---

# KMP Features & Platform Capability Matrix (2026)

> Sources: ingested 2026-04-24 (user-approved) from kmp-supported-platforms-reference.md,
> kotlinx-io-reference.md, kotlinx-coroutines-reference.md.

## Platform Tier Summary

| Platform | KMP Tier | Compose MP Tier |
|----------|----------|-----------------|
| JVM | Stable | Stable |
| Android | Stable | Stable |
| iOS | Stable | Beta |
| macOS | Stable | Beta |
| Linux | Beta | Alpha |
| JS — Browser | Stable | Alpha |
| JS — Node.js | Stable | Alpha |
| Wasm | Alpha | Alpha |

> **Linux** is Beta (not Stable) for KMP as of 2026-04-24.
> **Wasm** (`wasmJs`) is Alpha (not Beta) for both KMP and Compose MP.

---

## Feature Matrix

| Feature | JVM | Android | iOS | macOS | Linux | JS — Browser | JS — Node.js | Wasm |
|---------|-----|---------|-----|-------|-------|-------------|-------------|------|
| **File IO** (kotlinx-io) | Yes | Yes | Yes | Yes | Yes | No (sandbox) | Yes | Limited |
| **Sockets / Networking** | Yes | Yes | Yes | Yes | Yes | HTTP/WS only | Yes (raw TCP) | HTTP only |
| **Coroutines** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Serialization** (kotlinx.serialization) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Ktor Client** | Yes | Yes | Yes | Yes | Yes | Yes (fetch engine) | Yes | Yes (fetch engine) |
| **Ktor Server** | Yes | Yes | No | No | Yes | No (sandbox) | Yes | No |
| **kotlinx-datetime** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **kotlinx-io** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **UI (Compose MP)** | Stable | Stable | Beta | Beta | Alpha | Alpha | Alpha | Alpha |
| **Background Work** | Yes | Yes (WorkManager) | Yes (limited) | Yes | Yes | No | Yes | No |

### Notes

- **File IO**: JS-Browser has no filesystem access (browser sandbox). kotlinx-io covers all native + JVM targets including macOS (see Myths section).
- **Sockets/Networking**: JS-Browser is restricted to HTTP and WebSocket by the browser sandbox — raw TCP is not available. JS-Node.js supports raw TCP via Ktor CIO engine.
- **Ktor Server**: Cannot run in browser (JS-Browser) or iOS/macOS as a standalone server process.
- **Background Work**: iOS background execution is limited by OS constraints (BGTaskScheduler). Wasm/JS-Browser have no background thread primitives.
- **Compose MP UI tiers** come from kmp-supported-platforms-reference.md, not KMP core tier.

---

## Coroutines Version Notes

- **1.10.x** (Stable) — current production release; use in all production KMP projects
- **1.11.0-rc01** (RC, paired with Kotlin 2.2.20) — release candidate; do not use in production without explicit opt-in

`Dispatchers.IO` is JVM/Android only. Apple/Linux/Native targets use `Dispatchers.Default` for IO work. Always inject dispatchers in commonMain — never hardcode `Dispatchers.*` in ViewModels or UseCases.

---

## Myths & Common Misconceptions

- **"macOS file IO is unsupported"** — WRONG as of kotlinx-io 1.x. macOS has full Source/Sink/Buffer support via Native targets.
- **"JS has no networking"** — WRONG for Node.js target. JS-Node.js supports raw TCP via Ktor. JS-Browser target is sandbox-restricted (HTTP/WebSocket only — no raw TCP).
- **"Wasm is Beta"** — WRONG. Wasm (`wasmJs`) is Alpha tier for both KMP and Compose MP as of 2026-04-24.

---

*Last verified: 2026-04-24. Refresh every 6 months or after major KMP release.*
