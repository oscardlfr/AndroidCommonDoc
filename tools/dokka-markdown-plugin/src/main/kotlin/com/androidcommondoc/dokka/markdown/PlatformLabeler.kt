package com.androidcommondoc.dokka.markdown

data class PlatformInfo(
    val frontmatterList: List<String>,
    val bodyLine: String,
)

object PlatformLabeler {

    fun label(platformNames: Set<String>): PlatformInfo? {
        val normalized = platformNames.map { normalize(it) }.distinct().sorted()
        if (normalized.size <= 1) return null
        return PlatformInfo(
            frontmatterList = normalized,
            bodyLine = "**Platforms:** ${normalized.joinToString(", ")}",
        )
    }

    fun labels(platforms: List<String>): List<String> =
        platforms.map { normalize(it.removeSuffix("Main")) }.distinct().sorted()

    fun normalize(raw: String): String = when (raw.lowercase()) {
        "android", "androidjvm" -> "android"
        "jvm" -> "jvm"
        "js", "javascript" -> "js"
        "native" -> "native"
        "ios", "iosx64", "iosarm64", "iossimulatorarm64" -> "apple"
        "macos", "macosx64", "macosarm64", "apple" -> "apple"
        "tvos", "watchos" -> "apple"
        "linuxarm64", "linuxx64" -> "linux"
        "mingwx64" -> "windows"
        "common" -> "common"
        "desktop" -> "desktop"
        else -> raw.lowercase()
    }
}
