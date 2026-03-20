package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

/**
 * Enforces kotlin.time.Clock.System over kotlinx.datetime.Clock.System.
 *
 * kotlin.time.Clock is the stdlib solution (experimental). kotlinx.datetime.Clock
 * is a library duplicate that creates confusion and inconsistency.
 *
 * AST-only: checks import directives for kotlinx.datetime.Clock usage.
 */
class PreferKotlinTimeClockRule(config: Config) : Rule(
    config,
    "Use kotlin.time.Clock.System instead of kotlinx.datetime.Clock.System"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)

        val importPath = importDirective.importPath?.pathStr ?: return

        if (importPath == "kotlinx.datetime.Clock" || importPath.startsWith("kotlinx.datetime.Clock.")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Import '$importPath' uses kotlinx.datetime.Clock. " +
                        "Use kotlin.time.Clock.System instead for consistency. " +
                        "Add @file:OptIn(ExperimentalTime::class) and import kotlin.time.Clock."
                )
            )
        }
    }
}
