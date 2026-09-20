#!/usr/bin/env bash
# Extracts the body lines of every `run:` (or `script:`) block in a GitHub
# Actions workflow YAML file, so callers can grep the SHELL/JS TEXT for raw
# `${{ inputs. }}` interpolation without false-matching legitimate `env:` /
# `if:` / `with:` usage (those are evaluated by the Actions engine, not the
# shell/JS runtime -- only text inside a `run:`/`script:` block is ever
# handed to the shell/`actions/github-script` runtime verbatim).
#
# Usage in bats:
#   source "$BATS_TEST_DIRNAME/lib/workflow-run-blocks.sh"
#   run_block_lines "$wf" | grep -q '${{ inputs\.'
#   script_block_lines "$wf" | grep -q '${{ steps\.'
#
# Awk indentation state machine over the workflow YAML, parametrized by the
# block key ("run" or "script" -- always a fixed literal passed by this
# file's own wrapper functions below, never a dynamic/external value, so
# interpolating it into the awk regex/sub source carries no injection or
# wildcard-metacharacter risk):
#   - Enters "in block" on a `<key>:` line whose remainder (after `<key>:`)
#     is empty, or is only a block-scalar indicator (|, >, |-, |+, >-, >+),
#     optionally followed by a `#comment`.
#   - While in a block, emits every subsequent line indented deeper than the
#     `<key>:` key itself. A BLANK line mid-block does NOT end the block --
#     only the first NON-BLANK line indented <= the key's own indent does.
#   - A single-line `<key>: <cmd>` (no block-scalar indicator) is NOT treated
#     as a block: the remainder after `<key>:` is emitted directly as that
#     line's body. Without this, a naive implementation would flip into
#     block-tracking mode expecting a continuation, then immediately exit on
#     the next step with nothing ever emitted -- making a future single-line
#     `run: ... ${{ inputs.X }} ...` invisible to this extractor.
#   - Deliberately awk-only (no yq path): yq is not guaranteed present in
#     every runner and this project does not install tools mid-wave, so
#     making the fence's correctness depend on an environment-conditional
#     code path would undermine the guarantee this helper exists to provide.
#   - Pure POSIX-portable awk: 2-arg match() + RSTART/RLENGTH for indent
#     length, no gawk-only 3-arg match(str, regex, array) capture-group
#     extraction (a sibling script in this repo, scripts/sh/list-valid-commit-tokens.sh,
#     fails under bare BSD awk on exactly that gawk-only form).
#
# Usage: run_block_lines <workflow-file>
#        script_block_lines <workflow-file>
_yaml_block_lines() {
    local wf="$1"
    local key="$2"
    awk -v key="$key" '
    {
        line = $0
        sub(/\r$/, "", line)
        match(line, /^[ ]*/)
        indent = RLENGTH
        stripped = line
        sub(/^[ ]*/, "", stripped)
        is_blank = (stripped == "")

        if (in_block) {
            if (is_blank) {
                next
            }
            if (indent > key_indent) {
                print line
                next
            }
            in_block = 0
        }

        if (!is_blank && stripped ~ ("^" key ":")) {
            remainder = stripped
            sub("^" key ":[ \t]*", "", remainder)
            if (remainder == "" || remainder ~ /^[|>][-+]?[ \t]*(#.*)?$/) {
                in_block = 1
                key_indent = indent
            } else {
                print remainder
            }
        }
    }
    ' "$wf"
}

run_block_lines() {
    _yaml_block_lines "$1" "run"
}

script_block_lines() {
    _yaml_block_lines "$1" "script"
}
