---
applyTo: "**/*UseCase.kt"
---

# UseCase Instructions

## Return Type

Always return `com.example.shared.core.result.Result<T>`. Never throw exceptions from UseCases — wrap failures in `Result.Error`.

```kotlin
class GetItemsUseCase(
    private val repository: ItemRepository,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) {
    suspend operator fun invoke(): Result<List<Item>> =
        withContext(dispatcher) {
            repository.getItems()
        }
}
```

## Dispatcher Injection

Accept a `CoroutineDispatcher` parameter with a sensible default. This enables test injection of `StandardTestDispatcher`.

Never hardcode `Dispatchers.IO` or `Dispatchers.Default` inside the function body without the injectable parameter.

## CancellationException

Always rethrow `CancellationException` in catch blocks. Never swallow it — doing so breaks structured concurrency.

```kotlin
catch (e: Exception) {
    if (e is CancellationException) throw e
    Result.Error(DomainException.Unknown(e))
}
```

## Error Mapping

Map infrastructure exceptions to typed `DomainException` values from `core-error`. Never leak `IOException`, `HttpException`, or other platform types to the domain layer.

## Single Responsibility

Each UseCase performs exactly one operation. If you need to compose multiple operations, create a new UseCase that delegates to existing ones.

## Naming

Name UseCases as verb phrases: `GetItemsUseCase`, `SyncProfileUseCase`, `ValidateEmailUseCase`. Always use the `UseCase` suffix.
