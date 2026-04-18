package com.androidcommondoc.dokka.markdown

object SlugDeriver {

    fun normalizeModule(raw: String): String =
        raw
            .lowercase()
            .replace(Regex("[:/.]+" ), "-")
            .trim('-')
            .replace(Regex("-{2,}"), "-")

    fun deriveForClass(className: String, moduleName: String): String =
        "${normalizeModule(moduleName)}--${toKebab(className)}"

    fun deriveForMember(simpleName: String, moduleName: String): String =
        "${normalizeModule(moduleName)}-${toKebab(simpleName)}"

    fun deriveForHub(moduleName: String): String =
        "${normalizeModule(moduleName)}-api-hub"

    fun fileBasename(className: String): String = "-${toKebab(className)}"

    fun toKebab(name: String): String {
        if (name.isEmpty()) return name
        // All-uppercase (acronym like "URL", "HTTP") — join each letter with dashes
        if (name.all { it.isUpperCase() || it.isDigit() }) {
            val sb = StringBuilder()
            for (i in name.indices) {
                val c = name[i]
                // Dash before every letter (except first); digits attach directly (no leading dash)
                if (i > 0 && c.isLetter()) sb.append('-')
                sb.append(c.lowercaseChar())
            }
            return sb.toString()
        }
        val sb = StringBuilder()
        for (i in name.indices) {
            val c = name[i]
            when {
                c.isUpperCase() && i > 0 -> {
                    val prev = name[i - 1]
                    val next = if (i + 1 < name.length) name[i + 1] else null
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
