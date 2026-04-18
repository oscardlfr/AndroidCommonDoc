package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtProperty

class NoDefaultDispatcherInTestsRule(config: Config) : Rule(
    config,
    "Tests must inject TestDispatcher; never use Dispatchers.Default directly (exception: benchmarks — see testing-patterns-benchmarks)"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        klass.body?.properties?.forEach { property ->
            checkProperty(property, klass)
        }
    }

    private fun checkProperty(property: KtProperty, klass: KtClass) {
        val initializerText = property.initializer?.text ?: return
        if (initializerText.contains("Dispatchers.Default")) {
            report(
                Finding(
                    Entity.from(property),
                    "Tests must inject TestDispatcher; never use Dispatchers.Default directly (exception: benchmarks — see testing-patterns-benchmarks) Use 'injected testDispatcher parameter' instead."
                )
            )
        }
    }
}