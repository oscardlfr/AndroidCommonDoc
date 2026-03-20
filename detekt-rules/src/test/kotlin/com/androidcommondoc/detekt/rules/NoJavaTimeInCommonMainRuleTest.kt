package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.TestConfig
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

class NoJavaTimeInCommonMainRuleTest {

    /** Rule with path filtering disabled — tests pure import detection */
    private val rule = NoJavaTimeInCommonMainRule(TestConfig("onlyCommonMain" to "false"))

    /** Rule with path filtering enabled (default) */
    private val pathRule = NoJavaTimeInCommonMainRule(Config.empty)

    @Nested
    inner class ImportDetection {

        @Test
        fun `reports java time Instant`() {
            val code = """
                import java.time.Instant

                fun now() = Instant.now()
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
            assertThat(findings[0].message).contains("java.time.Instant")
            assertThat(findings[0].message).contains("JVM-only")
        }

        @Test
        fun `reports java time DateTimeFormatter`() {
            val code = """
                import java.time.format.DateTimeFormatter

                val fmt = DateTimeFormatter.ISO_INSTANT
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
        }

        @Test
        fun `reports java security MessageDigest`() {
            val code = """
                import java.security.MessageDigest

                fun hash(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data)
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
            assertThat(findings[0].message).contains("java.security.MessageDigest")
        }

        @Test
        fun `reports java text Normalizer`() {
            val code = """
                import java.text.Normalizer

                fun normalize(s: String) = Normalizer.normalize(s, Normalizer.Form.NFC)
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
        }

        @Test
        fun `reports java time ZoneId`() {
            val code = """
                import java.time.ZoneId

                fun zone() = ZoneId.systemDefault()
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
        }

        @Test
        fun `reports java time ZonedDateTime`() {
            val code = """
                import java.time.ZonedDateTime

                fun now() = ZonedDateTime.now()
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
        }

        @Test
        fun `reports multiple forbidden imports`() {
            val code = """
                import java.time.Instant
                import java.time.ZoneId
                import java.security.MessageDigest

                fun stuff() {}
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(3)
        }

        @Test
        fun `allows kotlinx datetime (not forbidden)`() {
            val code = """
                import kotlinx.datetime.Instant
                import kotlinx.datetime.TimeZone
                import kotlinx.datetime.toLocalDateTime

                fun parse(s: String) = Instant.parse(s)
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).isEmpty()
        }

        @Test
        fun `allows kotlin time`() {
            val code = """
                import kotlin.time.Clock
                import kotlin.time.ExperimentalTime

                @OptIn(ExperimentalTime::class)
                fun now() = Clock.System.now()
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).isEmpty()
        }

        @Test
        fun `allows unrelated imports`() {
            val code = """
                import kotlinx.coroutines.flow.StateFlow
                import kotlin.time.Duration

                val x = 1
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).isEmpty()
        }
    }

    @Nested
    inner class PathFiltering {

        @Test
        fun `default config skips non-commonMain files`() {
            // Default lint path is not commonMain, so pathRule should not fire
            val code = """
                import java.time.Instant

                fun now() = Instant.now()
            """.trimIndent()

            val findings = pathRule.lint(code)
            assertThat(findings).isEmpty()
        }

        @Test
        fun `onlyCommonMain false reports in any source set`() {
            val code = """
                import java.time.Instant

                fun now() = Instant.now()
            """.trimIndent()

            val findings = rule.lint(code)
            assertThat(findings).hasSize(1)
        }
    }
}
