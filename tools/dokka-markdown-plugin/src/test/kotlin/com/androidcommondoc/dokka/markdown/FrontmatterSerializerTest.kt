package com.androidcommondoc.dokka.markdown

import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FrontmatterSerializerTest {

    private fun baseFm(platforms: List<String>? = null) = FrontmatterFields(
        scope = listOf("api", "core"),
        sources = listOf("core"),
        targets = listOf("all"),
        slug = "core-do-something",
        status = "active",
        layer = "L1",
        category = "api",
        description = "Does something",
        version = 1,
        lastUpdated = "2026-04",
        generated = true,
        generatedFrom = "dokka",
        contentHash = "abc123def456",
        parent = "core-api-hub",
        platforms = platforms,
    )

    @Nested
    inner class Fencing {

        @Test
        fun `serialize_startsWithTripleDashNewline`() {
            assertTrue(FrontmatterSerializer.serialize(baseFm()).startsWith("---\n"))
        }

        @Test
        fun `serialize_endsWithTripleDashNewline`() {
            assertTrue(FrontmatterSerializer.serialize(baseFm()).endsWith("---\n"))
        }
    }

    @Nested
    inner class FieldOrder {

        @Test
        fun `serialize_14FieldsInExactOrder_noPlatforms`() {
            val result = FrontmatterSerializer.serialize(baseFm())
            val keys = result.lines()
                .filter { it.contains(":") && !it.startsWith("---") }
                .map { it.substringBefore(":").trim() }
            val expected = listOf(
                "scope", "sources", "targets", "slug", "status", "layer",
                "category", "description", "version", "last_updated",
                "generated", "generated_from", "content_hash", "parent",
            )
            assertEquals(expected, keys)
        }

        @Test
        fun `serialize_versionField_isInteger`() {
            assertTrue(FrontmatterSerializer.serialize(baseFm()).contains("version: 1"))
        }

        @Test
        fun `serialize_scopeField_inlineSquareBrackets`() {
            assertTrue(FrontmatterSerializer.serialize(baseFm()).contains("scope: [api, core]"))
        }
    }

    @Nested
    inner class OptionalPlatforms {

        @Test
        fun `serialize_platformsNull_fieldOmitted`() {
            assertFalse(FrontmatterSerializer.serialize(baseFm(platforms = null)).contains("platforms:"))
        }

        @Test
        fun `serialize_platformsEmptyList_fieldOmitted`() {
            assertFalse(FrontmatterSerializer.serialize(baseFm(platforms = emptyList())).contains("platforms:"))
        }

        @Test
        fun `serialize_platformsProvided_inlineSquareBrackets`() {
            val result = FrontmatterSerializer.serialize(baseFm(platforms = listOf("apple", "common", "jvm")))
            assertTrue(result.contains("platforms: [apple, common, jvm]"))
        }

        @Test
        fun `serialize_platformsProvided_appearsAfterParent`() {
            val result = FrontmatterSerializer.serialize(baseFm(platforms = listOf("jvm")))
            val lines = result.lines()
            val parentIdx = lines.indexOfFirst { it.startsWith("parent:") }
            val platformsIdx = lines.indexOfFirst { it.startsWith("platforms:") }
            assertTrue(platformsIdx > parentIdx)
        }

        @Test
        fun `serialize_platformsProvided_is15thField`() {
            val result = FrontmatterSerializer.serialize(baseFm(platforms = listOf("jvm")))
            val keys = result.lines()
                .filter { it.contains(":") && !it.startsWith("---") }
                .map { it.substringBefore(":").trim() }
            assertEquals("platforms", keys[14])
        }
    }

    @Nested
    inner class YamlQuoting {

        @Test
        fun `serialize_descriptionWithColon_valueQuoted`() {
            val fm = baseFm().copy(description = "Result: the outcome")
            assertTrue(FrontmatterSerializer.serialize(fm).contains("description: \"Result: the outcome\""))
        }

        @Test
        fun `serialize_descriptionWithHash_valueQuoted`() {
            val fm = baseFm().copy(description = "See #123 for context")
            assertTrue(FrontmatterSerializer.serialize(fm).contains("description: \"See #123 for context\""))
        }

        @Test
        fun `serialize_descriptionWithDoubleQuote_escapedAndQuoted`() {
            val fm = baseFm().copy(description = "She said \"hello\"")
            assertTrue(FrontmatterSerializer.serialize(fm).contains("description: \"She said \\\"hello\\\"\""))
        }

        @Test
        fun `serialize_plainDescription_unquoted`() {
            val fm = baseFm().copy(description = "Does something")
            assertTrue(FrontmatterSerializer.serialize(fm).contains("description: Does something"))
        }
    }
}
