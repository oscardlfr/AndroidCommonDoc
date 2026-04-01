package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

class NoMocksInCommonTestsRule(config: Config) : Rule(
    config,
    "Use pure Kotlin fakes in commonTest, not Mockito or MockK"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString() ?: return
        if (importPath.startsWith("io.mockk") || importPath.startsWith("org.mockito")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Use pure Kotlin fakes in commonTest, not Mockito or MockK Use 'pure Kotlin fake class' instead of '$importPath'."
                )
            )
        }
    }
}