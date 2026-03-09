package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtProperty

/**
 * Flags MutableStateFlow properties that are exposed publicly without a read-only StateFlow backing.
 *
 * Pattern: a `val _state = MutableStateFlow(...)` should always be paired with
 * a public `val state: StateFlow<...> = _state.asStateFlow()` (or similar).
 * Exposing the mutable directly leaks mutation capability to the UI layer.
 *
 * Detects: public `val` or `var` properties with type or initializer containing
 * `MutableStateFlow` in ViewModel classes.
 */
class MutableStateFlowExposedRule(config: Config) : Rule(
    config,
    "MutableStateFlow must not be exposed as a public property — expose as StateFlow via asStateFlow()"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        if (!klass.superTypeListEntries.any { it.text.contains("ViewModel") }) return

        val properties = klass.body?.properties ?: return
        for (property in properties) {
            checkProperty(property, klass)
        }
    }

    private fun checkProperty(property: KtProperty, klass: KtClass) {
        // Only flag non-private properties
        val modifiers = property.modifierList?.text ?: ""
        if (modifiers.contains("private")) return

        val typeRef = property.typeReference?.text ?: ""
        val initializer = property.initializer?.text ?: ""

        val isMutableStateFlow =
            typeRef.contains("MutableStateFlow") ||
                initializer.startsWith("MutableStateFlow")

        if (isMutableStateFlow) {
            report(
                Finding(
                    Entity.from(property),
                    "Property '${property.name}' in ViewModel '${klass.name}' exposes MutableStateFlow publicly. " +
                        "Add a private backing property and expose via '.asStateFlow()': " +
                        "private val _${property.name} = MutableStateFlow(...); " +
                        "val ${property.name}: StateFlow<...> = _${property.name}.asStateFlow()"
                )
            )
        }
    }
}
