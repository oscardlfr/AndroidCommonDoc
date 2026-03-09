package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoLaunchInInitRuleTest {
    private val rule = NoLaunchInInitRule(Config.empty)

    @Test
    fun `reports launch in init block`() {
        val code = """
            class SyncViewModel : ViewModel() {
                init {
                    viewModelScope.launch { loadInitialData() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("init {}")
    }

    @Test
    fun `reports bare launch in init block`() {
        val code = """
            class HomeViewModel : ViewModel() {
                init {
                    launch { fetchData() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts launch in named function`() {
        val code = """
            class SyncViewModel : ViewModel() {
                fun load() {
                    viewModelScope.launch { loadInitialData() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts non-coroutine calls in init block`() {
        val code = """
            class HomeViewModel : ViewModel() {
                init {
                    setupObservers()
                    registerAnalytics()
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports multiple launches in same init block`() {
        val code = """
            class DashboardViewModel : ViewModel() {
                init {
                    viewModelScope.launch { loadUser() }
                    viewModelScope.launch { loadFeed() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(2)
    }
}
