package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtProperty
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

class NoChannelForUiEventsRule(config: Config) : Rule(
    config,
    "Use MutableSharedFlow instead of Channel for UI events in ViewModels"
) {

    override fun visitKtFile(file: KtFile) {
        super.visitKtFile(file)
    }

    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        val superTypeList = klass.superTypeListEntries.map { it.text }
        if (!superTypeList.any { it.contains("ViewModel") }) return

        // Find Channel usage in properties within this ViewModel class
        val properties = klass.body?.properties ?: return

        for (property in properties) {
            val initializer = property.initializer ?: continue
            val initText = initializer.text

            if (initText.contains("Channel<") || initText.contains("Channel(")) {
                report(
                    Finding(
                        Entity.from(property),
                        "Channel used for UI events in ViewModel '${klass.name}'. " +
                            "Use MutableSharedFlow instead of Channel for ephemeral UI events."
                    )
                )
            }
        }
    }
}
