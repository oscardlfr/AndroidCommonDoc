package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoChannelForNavigationRuleTest {
    private val rule = NoChannelForNavigationRule(Config.empty)

    @Test
    fun `reports Channel used for navigation in ViewModel`() {
        val code = """
            class HomeViewModel : ViewModel() {
                private val navChannel = Channel<NavRoute>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("NavigationState")
    }

    @Test
    fun `reports Channel for navigation with route in name`() {
        val code = """
            class AuthViewModel : ViewModel() {
                val routeChannel = Channel<String>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `reports Channel with destination in property name`() {
        val code = """
            class MainViewModel : ViewModel() {
                private val _destinationChannel = Channel<Screen>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts StateFlow for navigation`() {
        val code = """
            class HomeViewModel : ViewModel() {
                private val _navState = MutableStateFlow<NavigationState>(NavigationState.Idle)
                val navState: StateFlow<NavigationState> = _navState.asStateFlow()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts Channel with non-navigation name in ViewModel`() {
        val code = """
            class DataViewModel : ViewModel() {
                private val dataChannel = Channel<DataItem>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts Channel for navigation outside ViewModel`() {
        val code = """
            class NavCoordinator {
                val navChannel = Channel<Screen>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
