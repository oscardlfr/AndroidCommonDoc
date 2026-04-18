package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.model.doc.Param
import org.jetbrains.dokka.model.doc.Return
import org.jetbrains.dokka.model.doc.See
import org.jetbrains.dokka.model.doc.Throws

data class TypeBContext(
    val moduleName: String,
    val packageName: String,
    val parentClassName: String?,
    val symbolName: String,
    val platformInfo: PlatformInfo?,
    val signature: String,
    val description: String,
    val params: List<Param>,
    val returnDoc: Return?,
    val throws: List<Throws>,
    val sees: List<See>,
    val frontmatter: FrontmatterFields,
)

object TypeBWriter {

    fun write(ctx: TypeBContext): String = buildString {
        append(FrontmatterSerializer.serialize(ctx.frontmatter))
        appendLine()
        appendLine()
        val breadcrumb = buildBreadcrumb(ctx)
        appendLine(breadcrumb)
        appendLine()
        appendLine("# ${ctx.symbolName}")
        appendLine()
        ctx.platformInfo?.let {
            appendLine(it.bodyLine)
            appendLine()
        }
        appendLine(ctx.signature)
        if (ctx.description.isNotEmpty()) {
            appendLine()
            appendLine(ctx.description)
        }
        val paramsSection = KdocRenderer.renderParams(ctx.params)
        if (paramsSection.isNotEmpty()) {
            appendLine()
            appendLine(paramsSection)
        }
        val returnSection = KdocRenderer.renderReturn(ctx.returnDoc)
        if (returnSection.isNotEmpty()) {
            appendLine()
            appendLine(returnSection)
        }
        val throwsSection = KdocRenderer.renderThrows(ctx.throws)
        if (throwsSection.isNotEmpty()) {
            appendLine()
            appendLine(throwsSection)
        }
        val seeSection = KdocRenderer.renderSee(ctx.sees)
        if (seeSection.isNotEmpty()) {
            appendLine()
            append(seeSection)
        }
    }.trimEnd()

    private fun buildBreadcrumb(ctx: TypeBContext): String {
        val parts = mutableListOf<String>()
        parts += "[${ctx.moduleName}](../../${ctx.moduleName}-hub.md)"
        parts += "[${ctx.packageName}](../${ctx.packageName}.md)"
        ctx.parentClassName?.let { parent ->
            parts += "[$parent](${SlugDeriver.fileBasename(parent)}.md)"
        }
        parts += ctx.symbolName
        return parts.joinToString(" / ")
    }
}
