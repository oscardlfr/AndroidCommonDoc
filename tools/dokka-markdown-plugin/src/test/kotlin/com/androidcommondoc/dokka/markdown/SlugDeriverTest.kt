package com.androidcommondoc.dokka.markdown

import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import kotlin.test.assertEquals

class SlugDeriverTest {

    @Nested
    inner class ToKebab {

        @ParameterizedTest(name = "toKebab({0}) == {1}")
        @CsvSource(
            "MyClass,         my-class",
            "doSomething,     do-something",
            "HttpClient,      http-client",
            "URL,             u-r-l",
            "JSON2YAML,       j-s-o-n2-y-a-m-l",
        )
        fun `toKebab_camelAndAcronymCases`(input: String, expected: String) {
            assertEquals(expected, SlugDeriver.toKebab(input))
        }

        @Test
        fun `toKebab_allCapsAcronym_json`() {
            // "JSON" → "j-s-o-n" per contract table (all-uppercase acronym = per-letter dashes)
            assertEquals("j-s-o-n", SlugDeriver.toKebab("JSON"))
        }
    }

    @Nested
    inner class DeriveForMember {

        @Test
        fun `deriveForMember_functionName_moduleAndKebab`() {
            // production: deriveForMember(simpleName, moduleName)
            assertEquals("core-do-something", SlugDeriver.deriveForMember("doSomething", "core"))
        }

        @Test
        fun `deriveForMember_preservesModuleName`() {
            assertEquals("core-common-my-prop", SlugDeriver.deriveForMember("myProp", "core-common"))
        }
    }

    @Nested
    inner class DeriveForClass {

        @Test
        fun `deriveForClass_leadingDashPlusKebab`() {
            // production: deriveForClass(simpleName) → "-" + kebab(simpleName)
            assertEquals("-base64-converter", SlugDeriver.deriveForClass("Base64Converter"))
        }

        @Test
        fun `deriveForClass_simpleClass_leadingDash`() {
            assertEquals("-my-class", SlugDeriver.deriveForClass("MyClass"))
        }
    }

    @Nested
    inner class DeriveForHub {

        @Test
        fun `deriveForHub_moduleName_appendsApiHub`() {
            assertEquals("core-common-api-hub", SlugDeriver.deriveForHub("core-common"))
        }

        @Test
        fun `deriveForHub_simpleModule_appendsApiHub`() {
            assertEquals("core-api-hub", SlugDeriver.deriveForHub("core"))
        }
    }
}
