package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

class NoComposeToolingInProductionRule(config: Config) : Rule(
    config,
    "Compose UI Tooling imports (@Preview) must not appear in production source sets — keep them in commonTest or a dedicated `-previews` module"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString() ?: return
        if (importPath.startsWith("androidx.compose.ui.tooling")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Compose UI Tooling imports (@Preview) must not appear in production source sets — keep them in commonTest or a dedicated `-previews` module Use 'move @Preview composables to commonTest or a -previews module' instead of '$importPath'."
                )
            )
        }
    }
}