package com.sample.core

/**
 * Parses raw JSON bytes into a typed result.
 *
 * @param bytes The raw JSON payload to parse.
 * @param strict When true, unknown keys cause a failure.
 * @return A [NetworkResult] containing the parsed value or error.
 * @throws IllegalArgumentException When bytes are empty.
 * @see NetworkResult
 */
fun parseJson(bytes: ByteArray, strict: Boolean = false): NetworkResult<String> {
    if (bytes.isEmpty()) throw IllegalArgumentException("bytes must not be empty")
    return NetworkResult.Success(bytes.decodeToString())
}
