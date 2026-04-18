package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.model.*
import org.jetbrains.dokka.model.doc.Param
import org.jetbrains.dokka.model.doc.Return
import org.jetbrains.dokka.model.doc.Throws
import org.jetbrains.dokka.model.doc.See

data class TypeAContext(
    val moduleName: String,
    val packageName: String,
    val symbolName: String,
    val platformInfo: PlatformInfo?,
    val constructorSignature: String?,
    val members: List<Pair<String, String>>,
    val frontmatter: FrontmatterFields,
)

object TypeAWriter {

    fun write(ctx: TypeAContext): String = buildString {
        append(FrontmatterSerializer.serialize(ctx.frontmatter))
        appendLine()
        appendLine()
        appendLine("[${ctx.moduleName}](../../${ctx.moduleName}-hub.md) / [${ctx.packageName}](../${ctx.packageName}.md) / ${ctx.symbolName}")
        appendLine()
        appendLine("# ${ctx.symbolName}")
        appendLine()
        ctx.platformInfo?.let {
            appendLine(it.bodyLine)
            appendLine()
        }
        ctx.constructorSignature?.let {
            appendLine(it)
            appendLine()
        }
        if (ctx.members.isNotEmpty()) {
            appendLine("## Members")
            for ((name, file) in ctx.members) {
                appendLine("- [$name]($file)")
            }
        }
    }.trimEnd()
}
