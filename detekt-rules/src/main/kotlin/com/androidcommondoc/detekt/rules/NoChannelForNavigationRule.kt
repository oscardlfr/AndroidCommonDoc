package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtProperty

/**
 * Flags use of `Channel` for navigation events in ViewModel classes.
 *
 * Navigation must be state-driven. Using a Channel for navigation events has
 * the same problems as using Channel for UI events:
 * - Events can be lost if the collector is not active during emission
 * - Hot channels buffer events and replay them unexpectedly after configuration change
 * - Testing requires consuming the channel, which is fragile
 *
 * Instead, expose a `navigationState: StateFlow<NavigationState>` where
 * `NavigationState` is a sealed interface with distinct navigation destinations.
 * The UI layer clears the state via a `onNavigationHandled()` callback.
 */
class NoChannelForNavigationRule(config: Config) : Rule(
    config,
    "Channel must not be used for navigation events — use a sealed NavigationState in StateFlow"
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
        val initializer = property.initializer?.text ?: return
        val typeRef = property.typeReference?.text ?: ""

        // Navigation-related property names heuristic
        val name = property.name?.lowercase() ?: ""
        val isNavigationRelated = name.contains("nav") ||
            name.contains("route") ||
            name.contains("destination") ||
            name.contains("screen")

        val isChannel = initializer.contains("Channel<") ||
            initializer.contains("Channel(") ||
            typeRef.contains("Channel<")

        if (isChannel && isNavigationRelated) {
            report(
                Finding(
                    Entity.from(property),
                    "Channel '${property.name}' in ViewModel '${klass.name}' appears to be used for navigation. " +
                        "Use a sealed NavigationState interface exposed via StateFlow instead: " +
                        "val navigationState: StateFlow<NavigationState> = _navigationState.asStateFlow()"
                )
            )
        }
    }
}
