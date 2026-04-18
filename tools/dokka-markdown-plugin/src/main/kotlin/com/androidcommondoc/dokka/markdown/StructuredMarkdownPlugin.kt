package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.CoreExtensions
import org.jetbrains.dokka.base.DokkaBase
import org.jetbrains.dokka.plugability.DokkaPlugin
import org.jetbrains.dokka.plugability.DokkaPluginApiPreview
import org.jetbrains.dokka.plugability.PluginApiPreviewAcknowledgement

class StructuredMarkdownPlugin : DokkaPlugin() {

    val structuredMarkdownRenderer by extending {
        @Suppress("UnstableApiUsage")
        CoreExtensions.renderer providing { ctx ->
            StructuredMarkdownRenderer(ctx)
        } override plugin<DokkaBase>().htmlRenderer
    }

    @DokkaPluginApiPreview
    override fun pluginApiPreviewAcknowledgement() =
        PluginApiPreviewAcknowledgement
}
