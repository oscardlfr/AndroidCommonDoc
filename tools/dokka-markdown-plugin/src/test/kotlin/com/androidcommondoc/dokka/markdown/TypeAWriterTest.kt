package com.androidcommondoc.dokka.markdown

import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TypeAWriterTest {

    private fun minimalFrontmatter() = FrontmatterFields(
        scope = listOf("api", "sample"),
        sources = listOf("sample"),
        slug = "sample--my-class",
        layer = "L1",
        description = "My class",
        lastUpdated = "2026-04",
        contentHash = "abc123",
        parent = "sample-api-hub",
    )

    private fun minimalCtx(
        members: List<Pair<String, String>> = emptyList(),
        platformInfo: PlatformInfo? = null,
        constructorSignature: String? = null,
        description: String = "",
    ) = TypeAContext(
        moduleName = "sample",
        packageName = "com.sample",
        symbolName = "MyClass",
        platformInfo = platformInfo,
        constructorSignature = constructorSignature,
        description = description,
        members = members,
        frontmatter = minimalFrontmatter(),
    )

    @Nested
    inner class Structure {

        @Test
        fun `write_containsFrontmatterBlock`() {
            val result = TypeAWriter.write(minimalCtx())
            assertTrue(result.contains("---\nscope:"))
        }

        @Test
        fun `write_containsH1WithSymbolName`() {
            val result = TypeAWriter.write(minimalCtx())
            assertTrue(result.contains("# MyClass"))
        }

        @Test
        fun `write_containsBreadcrumb`() {
            val result = TypeAWriter.write(minimalCtx())
            assertTrue(result.contains("[sample](../../sample-hub.md)"))
            assertTrue(result.contains("/ MyClass"))
        }

        @Test
        fun `write_noTrailingWhitespace`() {
            val result = TypeAWriter.write(minimalCtx())
            val lines = result.lines()
            lines.forEach { line ->
                assertEquals(line.trimEnd(), line, "Line has trailing whitespace: [$line]")
            }
        }
    }

    @Nested
    inner class Platforms {

        @Test
        fun `write_withPlatformInfo_containsBodyLine`() {
            val pi = PlatformInfo(listOf("apple", "common", "jvm"), "**Platforms:** apple, common, jvm")
            val result = TypeAWriter.write(minimalCtx(platformInfo = pi))
            assertTrue(result.contains("**Platforms:** apple, common, jvm"))
        }

        @Test
        fun `write_withoutPlatformInfo_noPlatformLine`() {
            val result = TypeAWriter.write(minimalCtx(platformInfo = null))
            assertTrue(!result.contains("**Platforms:**"))
        }
    }

    @Nested
    inner class Members {

        @Test
        fun `write_withMembers_hasMembersSection`() {
            val members = listOf(Pair("doSomething", "do-something.md"), Pair("getValue", "get-value.md"))
            val result = TypeAWriter.write(minimalCtx(members = members))
            assertTrue(result.contains("## Members"))
            assertTrue(result.contains("[doSomething](do-something.md)"))
            assertTrue(result.contains("[getValue](get-value.md)"))
        }

        @Test
        fun `write_noMembers_noMembersSection`() {
            val result = TypeAWriter.write(minimalCtx(members = emptyList()))
            assertTrue(!result.contains("## Members"))
        }
    }

    @Nested
    inner class Description {

        @Test
        fun `write_withDescription_emitsDescriptionBeforeMembers`() {
            val result = TypeAWriter.write(minimalCtx(description = "A useful class."))
            assertTrue(result.contains("A useful class."))
        }

        @Test
        fun `write_emptyDescription_descriptionAbsent`() {
            val result = TypeAWriter.write(minimalCtx(description = ""))
            assertTrue(!result.contains("A useful class."))
        }
    }

    @Nested
    inner class Constructor {

        @Test
        fun `write_withConstructorSignature_appearsInOutput`() {
            val sig = "constructor(value: Int, name: String)"
            val result = TypeAWriter.write(minimalCtx(constructorSignature = sig))
            assertTrue(result.contains(sig))
        }

        @Test
        fun `write_noConstructorSignature_noConstructorLine`() {
            val result = TypeAWriter.write(minimalCtx(constructorSignature = null))
            assertTrue(!result.contains("constructor("))
        }
    }
}
