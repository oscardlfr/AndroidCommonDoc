package com.sample.data

actual class PlatformClock actual constructor() {
    actual fun nowMillis(): Long = System.currentTimeMillis()
}
