---
scope: test-specialist
category: agents
slug: test-specialist-vm-testing
sources: [setup/agent-templates/test-specialist.md]
targets: []
---

# test-specialist-vm-testing — High-Dep ViewModel Testing

For ViewModels with 5+ constructor dependencies: NEVER write a test that constructs a local flow to mirror VM behavior. The test MUST instantiate the VM class directly (via a factory helper with stubs) and read the VM's actual property. If the VM has >5 deps, create a `createMinimal{ViewModelName}()` factory that stubs all non-focal deps with the simplest possible fakes. Do NOT substitute the VM instantiation with a local flow that replays the production logic — this is test gaming.

When VM has >10 deps + hardwired DI, explicitly DISCOURAGE VM-level unit tests and REDIRECT to composable-layer tests. Document "test at the layer where the bug is visible" as canonical pattern.

BUG 4 used **compile-time RED** via nullable type parameter — stronger than runtime RED. TDD discipline preserved structurally. 3-state GREEN tests verify null/false/true rendering post-fix. Accepted as valid TDD pattern for cases where runtime RED is architecturally infeasible (high-dep VMs + hardwired DI).

**L0 implication**: Template explicitly recognizes compile-gate RED as a valid TDD signal. Current template implies RED = a failing test assertion. For type-system-level bugs (wrong nullability, wrong sealed variant, wrong type), a compile error IS the RED signal and should be accepted as such by arch-testing.
