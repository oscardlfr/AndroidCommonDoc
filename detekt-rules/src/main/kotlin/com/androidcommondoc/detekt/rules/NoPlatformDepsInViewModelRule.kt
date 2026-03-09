package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtImportDirective

class NoPlatformDepsInViewModelRule(config: Config) : Rule(
    config,
    "ViewModels must not depend on platform-specific types"
) {

    private val platformImportPrefixes = listOf(
        "android.",
        "javax.",
        "platform.",
    )

    private val javaAllowedImports = setOf(
        "java.io.Serializable",
    )

    private var isViewModelFile = false
    private val platformImports = mutableListOf<KtImportDirective>()

    override fun visitKtFile(file: KtFile) {
        isViewModelFile = false
        platformImports.clear()
        super.visitKtFile(file)

        // Only report if this file contains a ViewModel class
        if (isViewModelFile) {
            platformImports.forEach { importDirective ->
                val importPath = importDirective.importedFqName?.asString() ?: importDirective.importPath?.pathStr ?: ""
                report(
                    Finding(
                        Entity.from(importDirective),
                        "Platform dependency '$importPath' used in ViewModel file. " +
                            "ViewModels must not reference platform-specific types."
                    )
                )
            }
        }
    }

    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)
        val superTypeList = klass.superTypeListEntries.map { it.text }
        if (superTypeList.any { it.contains("ViewModel") }) {
            isViewModelFile = true
        }
    }

    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString()
            ?: importDirective.importPath?.pathStr
            ?: return

        if (importPath in javaAllowedImports) return

        val isPlatformImport = platformImportPrefixes.any { importPath.startsWith(it) } ||
            importPath.startsWith("java.")

        if (isPlatformImport) {
            platformImports.add(importDirective)
        }
    }
}
