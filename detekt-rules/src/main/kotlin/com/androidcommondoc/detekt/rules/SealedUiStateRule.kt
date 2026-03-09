package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass

class SealedUiStateRule(config: Config) : Rule(config, "UiState types must be sealed interfaces or sealed classes") {

    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)
        val name = klass.name ?: return

        if (name.endsWith("UiState") && !klass.isSealed()) {
            val keyword = klass.getClassOrInterfaceKeyword()?.text ?: "class"
            report(
                Finding(
                    Entity.from(klass),
                    "UiState type '$name' must be a sealed interface, not a $keyword. " +
                        "Use 'sealed interface $name' to model distinct UI states."
                )
            )
        }
    }
}
