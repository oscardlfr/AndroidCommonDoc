package com.androidcommondoc.dokka.markdown

data class FrontmatterFields(
    val scope: List<String>,
    val sources: List<String>,
    val targets: List<String> = listOf("all"),
    val slug: String,
    val status: String = "active",
    val layer: String,
    val category: String = "api",
    val description: String,
    val version: Int = 1,
    val lastUpdated: String,
    val generated: Boolean = true,
    val generatedFrom: String = "dokka",
    val contentHash: String,
    val parent: String,
    val platforms: List<String>? = null,
)

object FrontmatterSerializer {

    fun serialize(fields: FrontmatterFields): String = buildString {
        appendLine("---")
        appendLine("scope: ${yamlList(fields.scope)}")
        appendLine("sources: ${yamlList(fields.sources)}")
        appendLine("targets: ${yamlList(fields.targets)}")
        appendLine("slug: ${fields.slug}")
        appendLine("status: ${fields.status}")
        appendLine("layer: ${fields.layer}")
        appendLine("category: ${fields.category}")
        appendLine("description: ${yamlString(fields.description)}")
        appendLine("version: ${fields.version}")
        appendLine("last_updated: ${yamlString(fields.lastUpdated)}")
        appendLine("generated: ${fields.generated}")
        appendLine("generated_from: ${fields.generatedFrom}")
        appendLine("content_hash: ${yamlString(fields.contentHash)}")
        appendLine("parent: ${fields.parent}")
        fields.platforms?.takeIf { it.isNotEmpty() }?.let { appendLine("platforms: ${yamlList(it)}") }
        appendLine("---")
    }

    private fun yamlList(items: List<String>): String =
        "[${items.joinToString(", ")}]"

    private fun yamlString(value: String): String {
        val needsQuoting = value.contains('"') || value.contains(':') || value.contains('#')
        return if (needsQuoting) "\"${value.replace("\"", "\\\"")}\"" else value
    }
}

typealias Frontmatter = FrontmatterFields


fun FrontmatterSerializer.toYaml(frontmatter: FrontmatterFields): String = serialize(frontmatter) + "\n"
