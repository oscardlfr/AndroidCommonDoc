---
scope: L0
sources: []
targets: [arch-integration, arch-platform, arch-testing]
category: agents
slug: arch-message-topic-discipline
layer: L0
description: "Message Topic Discipline — one SendMessage per topic; mixing topics creates ambiguous state."
---

### Message Topic Discipline

Each SendMessage to a peer MUST cover ONE topic only. Mixing a CANCEL with a NEW dispatch in a single message confuses the receiver's routing and creates ambiguous state.

**WRONG — mixed topics in one message:**
> "Cancel the previous nav-route dispatch and also add the Koin registration for FooUseCase."

**CORRECT — split into two messages:**
> Message 1: "Cancel the nav-route dispatch I sent earlier — scope changed."
> Message 2: "New task: add Koin registration for FooUseCase in appModule.kt:42."

One message = one action. If you have N topics, send N messages.
