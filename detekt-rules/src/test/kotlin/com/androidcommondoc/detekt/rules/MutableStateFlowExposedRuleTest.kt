package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class MutableStateFlowExposedRuleTest {
    private val rule = MutableStateFlowExposedRule(Config.empty)

    @Test
    fun `reports public MutableStateFlow property in ViewModel`() {
        val code = """
            class LoginViewModel : ViewModel() {
                val state = MutableStateFlow(LoginUiState.Idle)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("MutableStateFlow")
        assertThat(findings[0].message).contains("asStateFlow()")
    }

    @Test
    fun `reports MutableStateFlow with explicit type annotation`() {
        val code = """
            class ProfileViewModel : ViewModel() {
                val uiState: MutableStateFlow<ProfileUiState> = MutableStateFlow(ProfileUiState.Loading)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts private MutableStateFlow backing property`() {
        val code = """
            class LoginViewModel : ViewModel() {
                private val _state = MutableStateFlow(LoginUiState.Idle)
                val state: StateFlow<LoginUiState> = _state.asStateFlow()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts MutableStateFlow in non-ViewModel class`() {
        val code = """
            class SomeRepository {
                val state = MutableStateFlow(SomeState.Idle)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports multiple public MutableStateFlow properties`() {
        val code = """
            class DashboardViewModel : ViewModel() {
                val state = MutableStateFlow(DashboardUiState.Loading)
                val events = MutableStateFlow<DashboardEvent?>(null)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(2)
    }
}
