package com.sample.data

import com.sample.core.NetworkResult

/** A raw byte array payload received from the network. */
typealias RawPayload = ByteArray

/** Singleton that provides a default [PlatformClock] instance. */
object DefaultClock {
    private val clock = PlatformClock()
    /** Returns current epoch milliseconds. */
    fun now(): Long = clock.nowMillis()
}
