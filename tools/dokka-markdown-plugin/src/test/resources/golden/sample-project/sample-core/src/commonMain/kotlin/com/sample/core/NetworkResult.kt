package com.sample.core

/**
 * Represents the result of a network operation.
 *
 * Can be either [Success] or [Failure].
 */
sealed interface NetworkResult<out T> {
    /** Contains the parsed response payload. */
    data class Success<T>(val data: T) : NetworkResult<T>
    /** Contains the error that caused the failure. */
    data class Failure(val error: Throwable) : NetworkResult<Nothing>
}
