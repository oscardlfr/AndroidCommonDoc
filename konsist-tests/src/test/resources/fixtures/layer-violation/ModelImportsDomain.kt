package com.example.model

import com.example.domain.SomeUseCase // VIOLATION: Model depends on nothing

data class UserModel(val name: String)
