---
slug: ktor-websocket-patterns
title: Ktor WebSocket Patterns
description: Ktor 3 WebSocket migration guide — Duration API breaking change (2.x→3.x), compatible client API, and historical import migration (1.6.x→2.x)
category: network
layer: L0
status: stable
scope:
  - network
  - websocket
  - ktor
  - migration
targets:
  - android
  - desktop
  - ios
  - jvm
sources:
  - context7:/ktorio/ktor-documentation@2026-04-23
monitor_urls:
  - https://github.com/ktorio/ktor/releases
---

# Ktor WebSocket Patterns

## Breaking change: Duration API (2.x → 3.x)

Ktor 3 migrated WebSocket plugin configuration from `java.time.Duration` to `kotlin.time.Duration`.

### Ktor 2.x

```kotlin
import java.time.Duration

install(WebSockets) {
    pingPeriod = Duration.ofSeconds(15)
    timeout = Duration.ofSeconds(15)
}
```

### Ktor 3.x

```kotlin
import kotlin.time.Duration.Companion.seconds

install(WebSockets) {
    pingPeriod = 15.seconds
    timeout = 15.seconds
}
```

## Compatible API (2.x → 3.x unchanged)

Client WebSocket usage API is source-compatible — no changes required when upgrading from 2.x.

```kotlin
client.webSocket(host = "example.com", port = 8080, path = "/chat") {
    send(Frame.Text("Hello"))
    for (frame in incoming) {
        when (frame) {
            is Frame.Text -> println(frame.readText())
            is Frame.Binary -> { /* handle */ }
            else -> {}
        }
    }
}
```

`install(WebSockets)`, `send()`, `incoming`, `Frame.Text`, `Frame.Binary`, `close(CloseReason(...))` — all unchanged.

## Historical import migration (1.6.x → 2.x)

| Before (1.6.x) | After (2.x+) |
|---|---|
| `io.ktor.http.cio.websocket.*` | `io.ktor.websocket.*` |
| `io.ktor.client.features.*` | `io.ktor.client.plugins.*` |
