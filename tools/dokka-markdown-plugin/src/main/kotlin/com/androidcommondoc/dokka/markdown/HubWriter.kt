package com.androidcommondoc.dokka.markdown

data class HubEntry(
    val symbolName: String,
    val fileName: String,
    val description: String,
)

data class HubContext(
    val moduleName: String,
    val entries: List<HubEntry>,
    val frontmatter: FrontmatterFields,
)

object HubWriter {

    fun write(ctx: HubContext): String = buildString {
        append(FrontmatterSerializer.serialize(ctx.frontmatter))
        appendLine()
        appendLine()
        appendLine("# ${ctx.moduleName} API")
        appendLine()
        appendLine("Auto-generated from KDoc via Dokka plugin `com.androidcommondoc:dokka-markdown-plugin`.")
        appendLine()
        appendLine("## Sub-documents")
        appendLine()
        appendLine("| Class/Interface | Description |")
        appendLine("|----------------|-------------|")
        val sorted = ctx.entries.sortedBy { it.symbolName.lowercase() }
        for (entry in sorted) {
            val desc = entry.description.take(80)
            appendLine("| [${entry.symbolName}](${ctx.moduleName}/${entry.fileName}) | $desc |")
        }
    }.trimEnd()
}
