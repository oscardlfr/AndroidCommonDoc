---
scope: [workflow, ai-agents, runtime-adapter, multi-agent, portable-runtime, security]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-trust-boundaries
status: active
layer: L0
parent: agents-hub
category: agents
description: "What the runtime's integrity checks do and do not promise: the same-uid trust boundary, BigInt identity comparison, and the closed post-read field list"
version: 1
last_updated: "2026-09"
assumes_read: runtime-messaging-adapters
token_budget: 1500
---

# Runtime Trust Boundaries

The threat model behind the runtime's integrity checks — pin freezing, protected
spawn, registry confinement, durable writes. Separate from the module-structure
invariants in [runtime-messaging-adapters](runtime-messaging-adapters.md)
because those describe how the code is *split*; this describes what it
*guarantees*, and a reader asking "what is actually protected here?" should not
have to infer it from a list about module boundaries.

The recurring failure mode this document exists to prevent is overclaiming: a
check that narrows an attack window being described as if it closed the class.

## The local user account is a trust boundary

Owner-confinement — 0700 roots, owner checks, Windows owner-only ACLs — defends
against *other* users on the host. Against a process already running as the
**same uid**, the contract is **detection, not prevention**. fd-binding,
`O_NOFOLLOW` and before/after identity re-checks prove that tampering happened;
they do not make it impossible.

This is the runtime's established position, not a concession invented for one
module:

| Module | Same-uid stance |
|---|---|
| `root-lifecycle.cjs` | Names a same-uid attacker explicitly, answers with an identity re-check |
| `durability/write.cjs` | Answers a planted byte-identical file or hard link with fd-binding and a re-fstat compare |
| `private-registry.cjs` | Confines to owner-only 0700; does not claim more |
| `app-server-pinned-image.cjs` | Executes a **verified isolated copy** |

"Verified isolated copy" is deliberate wording. The copy is *not* immutable, and
calling it so would promise a guarantee the module does not deliver: a same-uid
process can still `chmod u+w` and alter it between the final verification and
the spawn. What the copy changes is the *size* of that window (the whole startup
sequence, down to the gap between re-verification and exec) and its *location* (a
private digest-keyed directory instead of the mutable install path).

Genuine closure against a same-uid adversary needs an OS primitive Node exposes
no portable binding for — `fexecve`, or `memfd_create` plus `F_SEAL_WRITE`.
Until one exists, any module claiming more than detection is overclaiming.

## Security identity is compared in BigInt, never as a double

`fs.Stats` reports `dev`, `ino`, `mode`, `uid` and `nlink` as doubles unless
`{ bigint: true }` is requested. Windows NTFS file IDs are 64-bit and routinely
exceed `Number.MAX_SAFE_INTEGER`, so two genuinely different files become
indistinguishable once their identities round.

Measured on a real Windows runner, not inferred: ino `28710447629357696`
satisfies `ino + 1 === ino`, and across 500 freshly created files five pairs had
distinct 64-bit ids that compared equal as doubles. At that magnitude the double
spacing is 4, so `BASE + 1n`, `+ 2n` and `+ 3n` all round to `BASE`. A swap into
a nearby inode would have been accepted as the same file by every identity check
in the module.

So every identity, ownership, mode and timestamp comparison uses bigint stats.
Exactly one value ever crosses to `Number` — a byte length that has to index a
`Buffer` — and only after it is proven `<= Number.MAX_SAFE_INTEGER`; otherwise
the read is refused rather than silently truncated. BigInt and Number are never
compared to each other: `1n !== 1` is always true, so a mixed comparison is a
fail-closed bug that a green suite can easily hide.

## A post-read re-check compares one closed field list

Where a post-read comparison is the **sole** integrity guard, it compares `dev`,
`ino`, `mode`, `uid`, `gid`, `nlink`, `size`, `ctimeNs` and `mtimeNs` — one named
list, not a set chosen per site. Three hand-picked subsets is how a field goes
missing from one of them, which is exactly what had happened: each of the three
re-check sites compared a different set, and none of them included `ctimeNs`.

`ctimeNs` is the load-bearing field. A file's owner can rewrite it in place and
then restore the old modification time with `utimensat`, leaving `dev`, `ino`,
`size`, `nlink` and `mtimeNs` all identical across the read. But that same call
moves `ctime`, and no API sets it. Since the promise against a same-uid actor is
detection, a detection that a restored timestamp defeats is not the promise.

`atimeNs` is deliberately excluded: reading the file changes it, so including it
would make every check fail — a guard that cannot pass is as useless as one that
cannot fail.

### The one site that does not use the list

A comparison is not the sole guard when the same bytes are also bound by a
**digest compared against an independently-written expectation**. The pinned
executable is: its hash is checked against the conductor-written freeze, and the
copy that actually executes is re-hashed again before it may run. A widened stat
check there would catch nothing the digest chain does not.

It would cost something, though. That is the longest read in the module — a
whole executable rather than a 64KB record — and the access pattern most likely
to make an antivirus or indexer touch the file's metadata. Such a touch moves
`ctime` without changing a byte, and a widened check would refuse to launch over
it: fail-closed, but a breakage with no security gain. A check that can only
produce false positives is a liability, not defence in depth — the same
reasoning that excludes `atimeNs`. So that site keeps `dev`+`ino`+`size`, stated
as a rule rather than left as an inconsistency for the next reader to find.

### How the list is held up

Each field is held up by its own case in `scripts/tests/codex-pin-freeze.test.js`
— CPF-20 for the freeze record, CPF-21b for the config — which forge one field at
a time and assert the injected pair differs in that field and in nothing else.
CPF-21 asserts the executable site against its own narrower contract, so a future
widening of it surfaces as a test that needs a decision rather than passing
silently.

Verified by mutation, not assumed: dropping any single field from the list turns
CPF-20 and CPF-21b red, and neutralising any one of the three re-checks turns
exactly its own case red.

## Related Docs

- [runtime-messaging-adapters](runtime-messaging-adapters.md) — hub, module-structure invariants
- [runtime-messaging-bridges](runtime-messaging-bridges.md) — host bridge contracts
