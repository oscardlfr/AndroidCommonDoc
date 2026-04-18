package com.androidcommondoc.dokka.markdown

import java.security.MessageDigest

object ContentHasher {

    fun hash(body: String): String {
        val canonical = canonicalize(body)
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        return digest.take(6).joinToString("") { "%02x".format(it) }
    }

    fun canonicalize(body: String): String =
        body.lines()
            .joinToString("\n") { it.trimEnd() }
            .trimEnd()
            .replace("\r\n", "\n")
            .replace("\r", "\n")
}

fun ContentHasher.hash12(body: String): String = hash(body)
