package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoPlatformDepsInViewModelRuleTest {
    private val rule = NoPlatformDepsInViewModelRule(Config.empty)

    @Test
    fun `reports android Context import in ViewModel`() {
        val code = """
            import android.content.Context
            import androidx.lifecycle.ViewModel

            class HomeViewModel(private val context: Context) : ViewModel()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("android.content.Context")
    }

    @Test
    fun `reports java io File import in ViewModel`() {
        val code = """
            import java.io.File
            import androidx.lifecycle.ViewModel

            class FileViewModel : ViewModel() {
                fun loadFile(file: File) {}
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `reports platform UIKit import in ViewModel`() {
        val code = """
            import platform.UIKit.UIViewController
            import androidx.lifecycle.ViewModel

            class IosViewModel : ViewModel()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `ignores platform import in non-ViewModel file`() {
        val code = """
            import android.content.Context

            class MyService(private val context: Context)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows coroutine imports in ViewModel`() {
        val code = """
            import kotlinx.coroutines.flow.StateFlow
            import androidx.lifecycle.ViewModel

            class HomeViewModel : ViewModel()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows ViewModel with no platform imports`() {
        val code = """
            import androidx.lifecycle.ViewModel

            class CleanViewModel : ViewModel()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
