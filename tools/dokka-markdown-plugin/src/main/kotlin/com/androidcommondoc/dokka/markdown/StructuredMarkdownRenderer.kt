package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.model.*
import org.jetbrains.dokka.model.doc.*
import org.jetbrains.dokka.pages.*
import org.jetbrains.dokka.plugability.DokkaContext
import org.jetbrains.dokka.renderers.Renderer
import java.io.File
import java.time.YearMonth

class StructuredMarkdownRenderer(private val context: DokkaContext) : Renderer {

    override fun render(root: RootPageNode) {
        val outputDir = context.configuration.outputDir.also { it.mkdirs() }
        // In Dokka 2.2.x single-module builds, root IS the ModulePageNode.
        // In multi-module aggregation builds, root has ModulePageNode children.
        val modules = when (root) {
            is ModulePageNode -> listOf(root)
            else -> root.children.filterIsInstance<ModulePageNode>()
        }
        modules.forEach { renderModule(it, outputDir) }
    }

    private fun renderModule(modulePage: ModulePageNode, outputDir: File) {
        val moduleName = SlugDeriver.normalizeModule(modulePage.name)
        val moduleDir = File(outputDir, moduleName).also { it.mkdirs() }
        val hubEntries = mutableListOf<HubEntry>()
        val stateEntries = mutableListOf<KdocStateEntry>()
        for (packagePage in modulePage.children.filterIsInstance<PackagePageNode>()) {
            val packageName = packagePage.name
            for (classPage in packagePage.children.filterIsInstance<ClasslikePageNode>()) {
                renderClasslike(classPage, moduleName, packageName, moduleDir)
                    ?.let { (hub, states) -> hubEntries += hub; stateEntries += states }
            }
            for (memberPage in packagePage.children.filterIsInstance<MemberPageNode>()) {
                renderMember(memberPage, moduleName, packageName, null, moduleDir)
                    ?.let { (hub, state) -> hubEntries += hub; stateEntries += state }
            }
        }
        val hubContent = buildHubContent(moduleName, hubEntries)
        File(outputDir, moduleName + "-hub.md").writeText(hubContent, Charsets.UTF_8)
        KdocStateWriter.write(outputDir.resolve("../../.androidcommondoc/kdoc-state.json").canonicalFile, stateEntries)
    }

    private fun renderClasslike(
        page: ClasslikePageNode,
        moduleName: String,
        packageName: String,
        moduleDir: File,
    ): Pair<HubEntry, List<KdocStateEntry>>? {
        val symbolName = page.name
        val slug = SlugDeriver.deriveForClass(symbolName, moduleName)
        val doc = page.documentables.firstOrNull()?.documentation?.values?.firstOrNull()
        val descTag = doc?.children?.filterIsInstance<Description>()?.firstOrNull()?.root
        val description = KdocRenderer.firstSentence(descTag).ifEmpty { symbolName }
        val memberEntries = page.children.filterIsInstance<MemberPageNode>()
            .map { child -> Pair(child.name, SlugDeriver.toKebab(child.name) + ".md") }
        val memberStateEntries = mutableListOf<KdocStateEntry>()
        page.children.filterIsInstance<MemberPageNode>()
            .forEach { child ->
                renderMember(child, moduleName, packageName, symbolName, moduleDir)
                    ?.let { (_, state) -> memberStateEntries += state }
            }
        val platforms = page.documentables.firstOrNull()?.sourceSets?.map { it.displayName }?.toSet() ?: emptySet()
        val platformInfo = PlatformLabeler.label(platforms)
        val bodyForHash = "# $symbolName\n${platformInfo?.bodyLine ?: ""}"
        val contentHash = ContentHasher.hash(bodyForHash)
        val lastUpdated = YearMonth.now().toString()
        val scopeList = mutableListOf("api", moduleName).apply {
            platformInfo?.frontmatterList?.let { addAll(it) }
        }
        val frontmatter = FrontmatterFields(
            scope = scopeList,
            sources = listOf(moduleName),
            slug = slug,
            layer = "L1",
            description = description,
            lastUpdated = lastUpdated,
            contentHash = contentHash,
            parent = SlugDeriver.deriveForHub(moduleName),
            platforms = platformInfo?.frontmatterList,
        )
        val content = TypeAWriter.write(TypeAContext(
            moduleName = moduleName,
            packageName = packageName,
            symbolName = symbolName,
            platformInfo = platformInfo,
            constructorSignature = null,
            members = memberEntries,
            frontmatter = frontmatter,
        ))
        File(moduleDir, slug + ".md").writeText(content, Charsets.UTF_8)
        val classlikeState = KdocStateEntry(slug, moduleName + "/" + slug + ".md", contentHash)
        return Pair(
            HubEntry(symbolName, slug + ".md", description),
            listOf(classlikeState) + memberStateEntries,
        )
    }

    private fun renderMember(
        page: MemberPageNode,
        moduleName: String,
        packageName: String,
        parentClassName: String?,
        moduleDir: File,
    ): Pair<HubEntry, KdocStateEntry>? {
        val symbolName = page.name
        val kebab = SlugDeriver.toKebab(symbolName)
        val doc = page.documentables.firstOrNull()?.documentation?.values?.firstOrNull()
        val descTag = doc?.children?.filterIsInstance<Description>()?.firstOrNull()?.root
        val description = KdocRenderer.renderDescription(descTag)
        val firstSentence = KdocRenderer.firstSentence(descTag).ifEmpty { symbolName }
        val params = doc?.children?.filterIsInstance<Param>() ?: emptyList()
        val returnDoc = doc?.children?.filterIsInstance<Return>()?.firstOrNull()
        val throws = doc?.children?.filterIsInstance<Throws>() ?: emptyList()
        val sees = doc?.children?.filterIsInstance<See>() ?: emptyList()
        val platforms = page.documentables.firstOrNull()?.sourceSets?.map { it.displayName }?.toSet() ?: emptySet()
        val platformInfo = PlatformLabeler.label(platforms)
        val bodyForHash = "# $symbolName\n${platformInfo?.bodyLine ?: ""}\n$description"
        val contentHash = ContentHasher.hash(bodyForHash)
        val lastUpdated = YearMonth.now().toString()
        val parentSlug = parentClassName?.let { SlugDeriver.deriveForClass(it, moduleName) }
            ?: SlugDeriver.deriveForHub(moduleName)
        val scopeList = mutableListOf("api", moduleName).apply {
            platformInfo?.frontmatterList?.let { addAll(it) }
        }
        val frontmatter = FrontmatterFields(
            scope = scopeList,
            sources = listOf(moduleName),
            slug = SlugDeriver.deriveForMember(symbolName, moduleName),
            layer = "L1",
            description = firstSentence,
            lastUpdated = lastUpdated,
            contentHash = contentHash,
            parent = parentSlug,
            platforms = platformInfo?.frontmatterList,
        )
        val content = TypeBWriter.write(TypeBContext(
            moduleName = moduleName,
            packageName = packageName,
            parentClassName = parentClassName,
            symbolName = symbolName,
            platformInfo = platformInfo,
            signature = renderSignature(page.documentables.firstOrNull() ?: return null),
            description = description,
            params = params,
            returnDoc = returnDoc,
            throws = throws,
            sees = sees,
            frontmatter = frontmatter,
        ))
        File(moduleDir, kebab + ".md").writeText(content, Charsets.UTF_8)
        if (parentClassName != null) return null
        return Pair(
            HubEntry(symbolName, kebab + ".md", firstSentence),
            KdocStateEntry(
                SlugDeriver.deriveForMember(symbolName, moduleName),
                moduleName + "/" + kebab + ".md",
                contentHash,
            ),
        )
    }

    private fun renderSignature(documentable: Documentable): String = when (documentable) {
        is DFunction -> {
            val params = documentable.parameters.joinToString(", ") { p ->
                "${p.name}: ${renderBound(p.type)}"
            }
            "fun ${documentable.name}($params): ${renderBound(documentable.type)}"
        }
        is DProperty -> {
            val keyword = if (documentable.setter != null) "var" else "val"
            "$keyword ${documentable.name}: ${renderBound(documentable.type)}"
        }
        else -> ""
    }

    private fun renderBound(bound: Bound): String = when (bound) {
        is TypeConstructor -> bound.dri.classNames ?: bound.dri.packageName ?: bound.toString()
        is Nullable -> "${renderBound(bound.inner)}?"
        is TypeParameter -> bound.name
        is GenericTypeConstructor -> {
            val base = bound.dri.classNames ?: bound.dri.packageName ?: bound.toString()
            if (bound.projections.isEmpty()) base
            else "$base<${bound.projections.joinToString(", ") { renderProjection(it) }}>"
        }
        else -> bound.toString()
    }

    private fun renderProjection(projection: Projection): String = when (projection) {
        is Bound -> renderBound(projection)
        is Star -> "*"
        else -> projection.toString()
    }

    private fun buildHubContent(moduleName: String, entries: List<HubEntry>): String {
        val lastUpdated = YearMonth.now().toString()
        val slug = SlugDeriver.deriveForHub(moduleName)
        val contentHash = ContentHasher.hash(entries.joinToString("\n") { it.symbolName })
        val frontmatter = FrontmatterFields(
            scope = listOf("api", moduleName),
            sources = listOf(moduleName),
            slug = slug,
            layer = "L1",
            description = moduleName + " API hub",
            lastUpdated = lastUpdated,
            contentHash = contentHash,
            parent = "api-hub",
        )
        return HubWriter.write(HubContext(moduleName, entries, frontmatter))
    }
}
