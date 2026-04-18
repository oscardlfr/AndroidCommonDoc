package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

class NoPlatformStorageInCommonRule(config: Config) : Rule(
    config,
    "Never use platform-specific storage APIs in commonMain; use expect/actual"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString() ?: return
        if (importPath.startsWith("android.content.SharedPreferences") ||
                importPath.startsWith("android.database.sqlite")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Never use platform-specific storage APIs in commonMain; use expect/actual Use 'expect/actual + multiplatform-settings / SQLDelight' instead of '$importPath'."
                )
            )
        }
    }
}