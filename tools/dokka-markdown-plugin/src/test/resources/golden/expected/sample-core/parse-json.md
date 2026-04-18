---
scope: [api, sample-core]
sources: [sample-core]
targets: [all]
slug: sample-core-parse-json
status: active
layer: L1
category: api
description: Parses raw JSON bytes into a typed result.
version: 1
last_updated: 2026-04
generated: true
generated_from: dokka
content_hash: HASH_PLACEHOLDER
parent: sample-core-api-hub
---

[sample-core](../../sample-core-hub.md) / [com.sample.core](../com.sample.core.md) / parseJson

# parseJson

fun parseJson(bytes: ByteArray, strict: Boolean = false): NetworkResult<String>

Parses raw JSON bytes into a typed result.

#### Parameters
- `bytes` — The raw JSON payload to parse.
- `strict` — When true, unknown keys cause a failure.

#### Return
A NetworkResult containing the parsed value or error.

#### Throws
- `IllegalArgumentException` — When bytes are empty.

#### See also
- `NetworkResult`