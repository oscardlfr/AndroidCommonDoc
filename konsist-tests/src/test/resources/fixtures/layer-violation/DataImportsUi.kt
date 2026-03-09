package com.example.data

import com.example.ui.SomeUiClass // VIOLATION: Data must not import UI

class DataRepository {
    // Intentional violation fixture: Data layer importing UI layer
}
