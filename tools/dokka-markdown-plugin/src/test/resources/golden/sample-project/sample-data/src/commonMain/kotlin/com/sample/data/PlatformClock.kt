package com.sample.data

/** Platform-specific clock that returns current time in milliseconds. */
expect class PlatformClock() {
    /** Returns current time in epoch milliseconds. */
    fun nowMillis(): Long
}
