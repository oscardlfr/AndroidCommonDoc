---
slug: kotlinx-io-reference
title: kotlinx-io Reference
description: Citable reference for kotlinx-io — multiplatform Kotlin IO primitives based on Okio. Source material for kmp-features-2026.md.
category: architecture
layer: L0
scope: kotlinx-io library API, Buffer/Source/Sink primitives, multiplatform IO operations
targets: [kmp-features-2026.md, any doc referencing kotlinx-io APIs]
sources: [context7:kotlin/kotlinx-io@2026-04-24]
status: reference
---

# kotlinx-io Reference

Source: context7:kotlin/kotlinx-io (ingested 2026-04-24, user-approved)

## Overview

kotlinx-io is a multiplatform Kotlin library providing efficient IO primitives based on Okio. The library is built around `Buffer` — a mutable sequence of bytes that works like a queue, allowing data to be read from its head or written to its tail. Buffers consist of segments organized as a linked list, enabling memory-efficient operations by delegating or sharing ownership of segments between buffers rather than copying data.

## Core Abstractions

- **`Buffer`** — central mutable byte sequence; implements both `Source` and `Sink`
- **`Source`** — readable byte stream interface (read-from-head semantics)
- **`Sink`** — writable byte stream interface (write-to-tail semantics)
- **`RawSource` / `RawSink`** — lower-level interfaces without buffering

## Module Structure

| Module | Artifact | Purpose |
|--------|----------|---------|
| `kotlinx-io-core` | `org.jetbrains.kotlinx:kotlinx-io-core` | Core Buffer/Source/Sink primitives |
| `kotlinx-io-bytestring` | `org.jetbrains.kotlinx:kotlinx-io-bytestring` | Immutable byte sequences |

## Platform Support

All targets supported by Kotlin Multiplatform: JVM, Android, iOS, macOS, Linux, Windows (via K/N), JS, Wasm.

## Key Patterns

### Reading from a Source
```kotlin
val source: Source = ...
val buffer = Buffer()
source.readTo(buffer, byteCount = 1024L)
val text = buffer.readString()
```

### Writing to a Sink
```kotlin
val sink: Sink = ...
sink.write(Buffer().also { it.writeString("hello") })
sink.flush()
```

### Buffered operations via `buffered()`
```kotlin
val bufferedSource = rawSource.buffered()
val line = bufferedSource.readLineStrict()
```

## Notes for kmp-features-2026.md Authors

- kotlinx-io is the preferred cross-platform IO layer for KMP (replaces java.io on non-JVM targets)
- `Buffer` segment sharing avoids copies across module boundaries
- Availability across all KMP targets makes it suitable for commonMain
