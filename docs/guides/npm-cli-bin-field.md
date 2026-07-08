---
slug: npm-cli-bin-field
category: guides
layer: L0
status: active
parent: guides-hub
scope: [npm, cli, package-json, tooling]
sources: [context7:docs.npmjs.com/cli/v11/configuring-npm/package-json@2026-07-09]
targets: [all]
version: 1
last_updated: "2026-07-09"
description: "npm package.json bin field — string vs object form, shebang requirement, global vs local-dependency resolution, and the bin-links escape hatch for symlink-less filesystems."
token_budget: 600
---

# npm package.json: the `bin` Field

## Two Forms

**String form** — used when the command name matches the package name:

```json
{
  "name": "my-cli",
  "bin": "bin/cli.js"
}
```

**Object form** — maps arbitrary command names to files (multiple commands, or a command name that differs from the package name):

```json
{
  "bin": {
    "myapp": "bin/cli.js",
    "myapp-debug": "bin/cli-debug.js"
  }
}
```

## Shebang Is Required

Every file referenced by `bin` needs a shebang as its first line:

```js
#!/usr/bin/env node
```

Without it, npm still links the file, but invoking it directly fails on POSIX systems (no interpreter to dispatch to).

## Resolution: Global vs Local Dependency

| Install mode | Resolution |
|---|---|
| `npm install -g <pkg>` | Linked into the global bins directory — on `PATH`, invokable as a bare command anywhere |
| `npm install <pkg>` (local/dependency) | **Not** on `PATH` globally — reachable only via `npm exec <cmd>` or an `npm run` script inside that package's own `node_modules/.bin/` |

This is the most common `bin`-field gotcha: a locally-installed dependency's CLI is not directly callable by name from an arbitrary shell — it must go through `npm exec`, `npx`, or a `package.json` script (npm prepends that package's `node_modules/.bin` to `PATH` automatically for scripts).

## `bin-links` Config

`bin-links` (default `true`) controls whether npm creates the symlinks (POSIX) / `.cmd` shims (Windows) at all. Set it `false` for filesystems that don't support symlinks:

```
npm config set bin-links false
```

With `bin-links=false`, `bin` entries are still recorded in the install manifest but no linked executable is created — callers must invoke the target file directly (e.g., `node node_modules/<pkg>/bin/cli.js`).

## Anti-Patterns

- Omitting the shebang and expecting `npm link`/global install to make the file directly executable on POSIX.
- Expecting a locally-installed (non-global) package's `bin` command to be on `PATH` outside of `npm exec`/an `npm run` script.
- Assuming `bin-links` is always `true` — some CI/sandboxed filesystems disable it, silently skipping shim creation.
