package com.androidcommondoc.dokka.markdown

object SlugDeriver {

    fun deriveForClass(simpleName: String): String =
        "-${toKebab(simpleName)}"

    fun deriveForMember(simpleName: String, moduleName: String): String =
        "$moduleName-${toKebab(simpleName)}"

    fun deriveForHub(moduleName: String): String =
        "$moduleName-api-hub"

    fun toKebab(name: String): String {
        if (name.isEmpty()) return name
        // All-uppercase (acronym like "URL", "HTTP") — join each letter with dashes
        if (name.all { it.isUpperCase() || it.isDigit() }) {
            return name.lowercase().split("").filter { it.isNotEmpty() }.joinToString("-")
        }
        val sb = StringBuilder()
        for (i in name.indices) {
            val c = name[i]
            when {
                c.isUpperCase() && i > 0 -> {
                    val prev = name[i - 1]
                    val next = if (i + 1 < name.length) name[i + 1] else null
                    // Insert dash before uppercase unless previous was also uppercase and next is lowercase
                    // (handles "HTTPClient" → "http-client" but "MyHTTPClient" → "my-http-client")
                    val inAcronymRun = prev.isUpperCase() && (next == null || next.isUpperCase())
                    if (!inAcronymRun) sb.append('-')
                    else if (next != null && next.isLowerCase()) sb.append('-')
                    sb.append(c.lowercaseChar())
                }
                else -> sb.append(c.lowercaseChar())
            }
        }
        return sb.toString()
    }
}
