package com.androidcommondoc.konsist

import com.androidcommondoc.konsist.support.ScopeFactory
import com.lemonappdev.konsist.api.ext.list.withNameEndingWith
import com.lemonappdev.konsist.api.ext.list.withPackage
import com.lemonappdev.konsist.api.verify.assertTrue
import com.lemonappdev.konsist.core.exception.KoAssertionFailedException
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Validates class suffix conventions match package expectations (KONS-03).
 *
 * Enforces bidirectional naming rules:
 * - Classes in the detekt rules package must end with "Rule"
 * - Classes ending with "Rule" must reside in a rules package
 * - RuleSetProvider classes must reside in the detekt root package
 * - Build-logic extension classes must end with "Extension"
 *
 * All violation messages are actionable: they name the offending class,
 * state the violated rule, and provide remediation guidance.
 */
class NamingConventionTest {

    private val detektScope = ScopeFactory.detektRulesScope()

    @Test
    fun `classes in detekt rules package end with Rule`() {
        detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .assertTrue(
                additionalMessage = "Classes in the detekt rules package must end with 'Rule'. " +
                    "If this is a helper, move it to a support package."
            ) {
                it.name.endsWith("Rule")
            }
    }

    @Test
    fun `classes ending with Rule reside in a rules package`() {
        val ruleClasses = detektScope
            .classes()
            .withNameEndingWith("Rule")
            .toList()

        assertThat(ruleClasses)
            .withFailMessage("Canary: no classes ending with 'Rule' found in detekt-rules scope")
            .isNotEmpty

        ruleClasses.forEach { ruleClass ->
            assertThat(ruleClass.resideInPackage("..rules.."))
                .withFailMessage(
                    "Class '${ruleClass.name}' ends with 'Rule' but resides in package " +
                        "'${ruleClass.packagee?.name}'. Classes with 'Rule' suffix must be " +
                        "in a 'rules' package. Move the class or change its name."
                )
                .isTrue
        }
    }

    @Test
    fun `RuleSetProvider classes reside in detekt root package not rules subpackage`() {
        val providers = detektScope
            .classes()
            .withNameEndingWith("RuleSetProvider")
            .toList()

        assertThat(providers)
            .withFailMessage("Canary: no RuleSetProvider class found in detekt-rules scope")
            .isNotEmpty

        providers.forEach { provider ->
            assertThat(provider.resideInPackage("com.androidcommondoc.detekt"))
                .withFailMessage(
                    "RuleSetProvider '${provider.name}' resides in package " +
                        "'${provider.packagee?.name}' but must be in " +
                        "'com.androidcommondoc.detekt' (not a subpackage like .rules). " +
                        "The provider is the module entry point and belongs at the root."
                )
                .isTrue
        }
    }

    @Test
    fun `build-logic extension classes end with Extension`() {
        ScopeFactory.buildLogicScope()
            .classes()
            .withPackage("com.androidcommondoc.gradle..")
            .assertTrue(
                additionalMessage = "Classes in build-logic must end with 'Extension'. " +
                    "If this is a utility, use a 'Util' suffix or move to a support package."
            ) {
                it.name.endsWith("Extension")
            }
    }

    // --- Fixture-based negative tests (KONS-03 SC #3) ---

    @Test
    fun `fixture FooManager in wrong naming convention is detected`() {
        val fixtureScope = ScopeFactory.fixtureScope("naming-violation")

        // FooManager is in com.example.data but does not follow any expected data-layer
        // naming convention (e.g., Repository, DataSource). This proves the naming
        // enforcement mechanism catches classes with incorrect suffixes.
        val error = assertThrows<KoAssertionFailedException> {
            fixtureScope
                .classes()
                .assertTrue(
                    additionalMessage = "Data-layer classes must end with 'Repository' or " +
                        "'DataSource'. Rename the class or move it to the correct package."
                ) {
                    it.name.endsWith("Repository") || it.name.endsWith("DataSource")
                }
        }

        assertThat(error.message)
            .describedAs(
                "Error message should name the offending class 'FooManager' so the " +
                    "developer knows exactly which class violates the naming convention."
            )
            .contains("FooManager")
    }
}
