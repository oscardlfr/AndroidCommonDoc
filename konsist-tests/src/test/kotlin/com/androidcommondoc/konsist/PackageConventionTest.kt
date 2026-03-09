package com.androidcommondoc.konsist

import com.androidcommondoc.konsist.support.ScopeFactory
import com.lemonappdev.konsist.api.ext.list.withNameEndingWith
import com.lemonappdev.konsist.api.verify.assertFalse
import com.lemonappdev.konsist.api.verify.assertTrue
import com.lemonappdev.konsist.core.exception.KoAssertionFailedException
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Validates that classes reside in packages matching their module identity,
 * and that modules do not cross-import each other's packages.
 *
 * Covers KONS-04 cross-file check: package placement and module isolation.
 *
 * All violation messages are actionable: they name the offending class/file,
 * state the violated rule, and provide remediation guidance.
 */
class PackageConventionTest {

    @Test
    fun `detekt-rules classes reside in com_androidcommondoc_detekt package`() {
        ScopeFactory.detektRulesScope()
            .classes()
            .assertTrue(
                additionalMessage = "All detekt-rules classes must be in " +
                    "com.androidcommondoc.detekt or a subpackage. " +
                    "Move the class to the correct package."
            ) {
                it.resideInPackage("com.androidcommondoc.detekt..")
            }
    }

    @Test
    fun `build-logic classes reside in com_androidcommondoc_gradle package`() {
        ScopeFactory.buildLogicScope()
            .classes()
            .assertTrue(
                additionalMessage = "All build-logic classes must be in " +
                    "com.androidcommondoc.gradle or a subpackage. " +
                    "Move the class to the correct package."
            ) {
                it.resideInPackage("com.androidcommondoc.gradle..")
            }
    }

    @Test
    fun `no detekt-rules file imports build-logic packages`() {
        ScopeFactory.detektRulesScope()
            .files
            .assertFalse(
                additionalMessage = "detekt-rules must not depend on build-logic. " +
                    "These are separate Gradle modules with independent classpaths."
            ) {
                it.hasImport { import ->
                    import.name.startsWith("com.androidcommondoc.gradle")
                }
            }
    }

    @Test
    fun `no build-logic file imports detekt rules packages`() {
        ScopeFactory.buildLogicScope()
            .files
            .assertFalse(
                additionalMessage = "build-logic must not directly import detekt rule " +
                    "implementations. Use the JAR artifact via Gradle dependency instead."
            ) {
                it.hasImport { import ->
                    import.name.startsWith("com.androidcommondoc.detekt.rules")
                }
            }
    }

    // --- Fixture-based negative tests (package violation detection) ---

    @Test
    fun `fixture MisplacedRule in wrong package is detected`() {
        val fixtureScope = ScopeFactory.fixtureScope("package-violation")

        // MisplacedRule has suffix "Rule" but resides in com.example.data instead of a
        // rules package. This proves the package placement check catches Rule-suffixed
        // classes that are not in their expected package.
        val error = assertThrows<KoAssertionFailedException> {
            fixtureScope
                .classes()
                .withNameEndingWith("Rule")
                .assertTrue(
                    additionalMessage = "Classes ending with 'Rule' must reside in a " +
                        "'rules' package. Move MisplacedRule to a rules package."
                ) {
                    it.resideInPackage("..rules..")
                }
        }

        assertThat(error.message)
            .describedAs(
                "Error message should name the offending class 'MisplacedRule' so the " +
                    "developer knows exactly which class is in the wrong package."
            )
            .contains("MisplacedRule")
    }
}
