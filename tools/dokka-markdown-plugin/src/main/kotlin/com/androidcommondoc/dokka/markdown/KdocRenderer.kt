package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.model.doc.*

object KdocRenderer {

    fun firstSentence(docTag: DocTag?): String {
        if (docTag == null) return ""
        val text = renderDocTag(docTag).trim()
        val dot = text.indexOf('.')
        return if (dot > 0) text.substring(0, dot + 1).trim() else text.take(80).trim()
    }

    fun renderDescription(docTag: DocTag?): String {
        if (docTag == null) return ""
        return renderDocTag(docTag).trim()
    }

    fun renderParams(params: List<Param>): String {
        if (params.isEmpty()) return ""
        return buildString {
            appendLine("#### Parameters")
            for (param in params) {
                val desc = renderDocTag(param.root).trim()
                appendLine("- `${param.name}` — $desc")
            }
        }.trimEnd()
    }

    fun renderReturn(ret: Return?): String {
        if (ret == null) return ""
        return buildString {
            appendLine("#### Return")
            append(renderDocTag(ret.root).trim())
        }
    }

    fun renderThrows(throws: List<Throws>): String {
        if (throws.isEmpty()) return ""
        return buildString {
            appendLine("#### Throws")
            for (t in throws) {
                val desc = renderDocTag(t.root).trim()
                appendLine("- `${t.name}` — $desc")
            }
        }.trimEnd()
    }

    fun renderSee(sees: List<See>): String {
        if (sees.isEmpty()) return ""
        return buildString {
            appendLine("#### See also")
            for (see in sees) {
                appendLine("- `${see.name}`")
            }
        }.trimEnd()
    }

    private fun renderDocTag(tag: DocTag): String = buildString {
        when (tag) {
            is Text -> append(tag.body)
            is P -> {
                append(tag.children.joinToString("") { renderDocTag(it) })
                append("\n")
            }
            is CodeInline -> append("`${tag.children.joinToString("") { renderDocTag(it) }}`")
            is CodeBlock -> append("```\n${tag.children.joinToString("") { renderDocTag(it) }}\n```")
            is A -> {
                val href = tag.params["href"] ?: ""
                val text = tag.children.joinToString("") { renderDocTag(it) }
                append("[$text]($href)")
            }
            is Strong -> append("**${tag.children.joinToString("") { renderDocTag(it) }}**")
            is Em -> append("_${tag.children.joinToString("") { renderDocTag(it) }}_")
            is Ul -> tag.children.forEach { child ->
                append("- ${renderDocTag(child).trim()}\n")
            }
            is Li -> append(tag.children.joinToString("") { renderDocTag(it) })
            else -> tag.children.forEach { append(renderDocTag(it)) }
        }
    }
}
