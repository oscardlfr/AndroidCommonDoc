package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

/**
 * Forbids Turbine (app.cash.turbine) in test code.
 *
 * Turbine adds unnecessary complexity. Use backgroundScope.launch with
 * UnconfinedTestDispatcher and flow.toList(states) instead.
 *
 * AST-only: checks import directives for app.cash.turbine.*.
 */
class NoTurbineRule(config: Config) : Rule(
    config,
    "Turbine is forbidden — use backgroundScope.launch(UnconfinedTestDispatcher) { flow.toList(states) }"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)

        val importPath = importDirective.importPath?.pathStr ?: return

        if (importPath.startsWith("app.cash.turbine")) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Import '$importPath' uses Turbine. " +
                        "Use backgroundScope.launch(UnconfinedTestDispatcher) { flow.toList(states) } instead."
                )
            )
        }
    }
}
