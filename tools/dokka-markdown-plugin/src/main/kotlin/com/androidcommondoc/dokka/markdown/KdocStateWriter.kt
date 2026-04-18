package com.androidcommondoc.dokka.markdown

import java.io.File
import java.time.Instant
import java.time.format.DateTimeFormatter

data class KdocStateEntry(
    val slug: String,
    val sourcePath: String,
    val contentHash: String,
)

object KdocStateWriter {

    fun write(stateFile: File, entries: List<KdocStateEntry>, generatedAt: String = nowIso8601()) {
        stateFile.parentFile?.mkdirs()
        val sb = StringBuilder()
        sb.appendLine("{")
        sb.appendLine("  \"generated_at\": \"$generatedAt\",")
        sb.appendLine("  \"files\": {")
        val sorted = entries.sortedBy { it.slug }
        sorted.forEachIndexed { i, entry ->
            val comma = if (i < sorted.lastIndex) "," else ""
            sb.appendLine("    \"${entry.slug}\": {")
            sb.appendLine("      \"source\": \"${entry.sourcePath}\",")
            sb.appendLine("      \"content_hash\": \"${entry.contentHash}\"")
            sb.append("    }$comma")
            if (i < sorted.lastIndex) sb.appendLine() else sb.appendLine()
        }
        sb.appendLine("  }")
        sb.append("}")
        stateFile.writeText(sb.toString(), Charsets.UTF_8)
    }

    private fun nowIso8601(): String =
        DateTimeFormatter.ISO_INSTANT.format(Instant.now())
}
