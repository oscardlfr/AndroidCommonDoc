package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.model.*

enum class SymbolType { TYPE_A, TYPE_B, HUB }

object SymbolClassifier {

    fun classify(documentable: Documentable): SymbolType = when (documentable) {
        is DClass, is DInterface, is DObject, is DEnum, is DAnnotation -> SymbolType.TYPE_A
        is DModule -> SymbolType.HUB
        else -> SymbolType.TYPE_B
    }

    fun isTopLevel(documentable: Documentable): Boolean =
        documentable.dri.packageName != null && documentable.dri.classNames == null
}
