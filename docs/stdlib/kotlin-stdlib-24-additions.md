---
scope: [stdlib, kotlin-2.4, uuid, collections, js-export]
sources: [kotlinlang.org/docs/whatsnew24.html]
targets: [android, desktop, ios, jvm, js, wasm]
slug: kotlin-stdlib-24-additions
status: active
layer: L0
category: stdlib
description: "Kotlin 2.4.0 stdlib additions: UUID API (common), sorted-order checks, value-class JS/TS export"
last_verified: 2026-06-03
parent: stdlib-hub
---

# Kotlin 2.4 stdlib Additions

New stable additions to the Kotlin standard library in 2.4.0.
All items below are **Stable** unless noted otherwise.

---

## UUID API (common stdlib)

Kotlin 2.4 ships a multiplatform `Uuid` type in `kotlin.uuid`:

```kotlin
import kotlin.uuid.Uuid

val id: Uuid = Uuid.random()           // V4 random — Experimental
val id7: Uuid = Uuid.randomUuidV7()    // V7 (time-ordered) — Experimental
val parsed: Uuid = Uuid.parse("550e8400-e29b-41d4-a716-446655440000")  // Stable
val fromBytes: Uuid = Uuid.fromByteArray(bytes)  // Stable
```

**Stability split**:
- Parsing, formatting, byte-array round-trip — **Stable**
- `Uuid.random()` (V4) and `Uuid.randomUuidV7()` (V7 time-ordered) — **Experimental** (require opt-in)

**Migration**: replace `java.util.UUID` in `jvmMain` / `NSUUID` in `appleMain` with common `Uuid` — removes the need for `expect/actual` boilerplate for ID generation in most cases.

Reference: https://kotlinlang.org/docs/whatsnew24.html

---

## Sorted-Order Checks (Stable)

New extension functions on `Iterable<T>` and `Array<T>`:

```kotlin
listOf(1, 2, 3).isSorted()                        // true
listOf(3, 2, 1).isSortedDescending()               // true
listOf("b", "a").isSortedWith(compareBy { it })    // false
listOf(User("Alice", 30), User("Bob", 25))
    .isSortedBy { it.name }                        // true
```

| Function | Description |
|----------|-------------|
| `.isSorted()` | Natural ascending order |
| `.isSortedDescending()` | Natural descending order |
| `.isSortedWith(comparator)` | Custom comparator |
| `.isSortedBy { selector }` | Key selector (ascending) |

Reference: https://kotlinlang.org/docs/whatsnew24.html

---

## Value-Class Export to JS/TS (Stable)

Kotlin value classes (formerly inline classes) annotated with `@JsExport` now generate proper TypeScript type definitions:

```kotlin
@JsExport
@JvmInline
value class UserId(val raw: String)

// Generated .d.ts: export class UserId { readonly raw: string }
```

Previously exported as the underlying primitive type, losing type safety at the JS boundary. Now generates a wrapper type in the TypeScript declaration file.

Reference: https://kotlinlang.org/docs/whatsnew24.html
