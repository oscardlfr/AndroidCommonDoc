package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

class NoCustomCryptoRule(config: Config) : Rule(
    config,
    "Never implement custom cryptography — use platform crypto APIs"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString() ?: return
        if (importPath.startsWith("javax.crypto.spec")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Never implement custom cryptography — use platform crypto APIs Use 'Platform KeyStore/Keychain' instead of '$importPath'."
                )
            )
        }
    }
}