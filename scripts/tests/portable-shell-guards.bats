#!/usr/bin/env bats
#
# Static guards against GNU-only shell idioms in scripts/sh/**.
#
# Why static: CI runs a GNU userland, where `head -n -1` and a bare
# `paste -sd ','` both work. CI is therefore structurally blind to their
# reintroduction. On a BSD userland (macOS default) `head` rejects negative
# counts and `paste` prints usage, and both abort the calling script under
# `set -o pipefail`. 22 of the 29 macOS-only failures this guard was written
# for were exactly these two idioms.
#
# Precedent: the `declare -A` bash-3.2 guard in validate-agent-templates.bats.
#
# Design notes, each earned from an architect review of an earlier draft:
#   - Comment lines are skipped, because the fixed scripts document the banned
#     idioms in their own comments. Only a line whose FIRST non-blank character
#     is '#' counts as a comment; `paste ... # note` is still code.
#   - `paste` is identified as a COMMAND, not a substring: each `|`-delimited
#     segment is examined, and its leading token's basename must be `paste`.
#     This catches `/usr/bin/paste`, ignores `copy-paste_helper` and prose that
#     merely mentions the idiom, and — critically — inspects EVERY segment. An
#     earlier draft used `${seg#*paste}`, which only ever saw the first `paste`
#     on a line, so `paste -sd ',' - | paste -sd ','` slipped through.
#   - A segment may be prefixed by redirections or env assignments, which are
#     not the command: `>out paste -sd ','` and `FOO=bar paste -sd ','` are both
#     violations. Those prefixes are skipped. A QUOTED leading word is never
#     skipped, or `msg="the paste ..."` would expose `paste` as the command and
#     flag prose.
#   - The `-` operand is looked for AFTER stripping a trailing inline comment,
#     or a coincidental `" - "` in `paste -sd ',' # TODO - verify` would mask a
#     real violation.
#   - `paste -sd ',' -` (correct) contains `paste -sd ','` (incorrect) as a
#     substring, so a naive substring ban would reject the fix itself.
#   - Each guard asserts a sanity floor first. A detector that scans an empty
#     tree reports "0 hits", which is indistinguishable from "0 violations".
#     A guard that cannot fail is worse than no guard.
#
# KNOWN LIMITATIONS — accepted, deliberately not fixed. This guard is
# defense-in-depth; a real violation still fails loudly at runtime on a BSD
# userland. Do not open another hardening round for these absent a live
# occurrence in the tree or a CI/QG failure:
#
#   1. The `path:lineno:code` record is split on ':', so a repo path containing
#      a colon would mis-parse. `scripts/sh` and `mktemp -d` paths contain none.
#      Same assumption `grep -n` makes.
#   2. `paste -sd ' #' -` — a delimiter argument beginning with space-then-hash
#      is truncated by the inline-comment strip, producing a FALSE POSITIVE.
#      Fail-safe direction (it blocks, it does not mask). No such delimiter is
#      used anywhere in this codebase.
#   3. `paste -sd ',' data.txt` — a file operand, rather than the `-` stdin
#      operand, is reported as a violation. Also a FALSE POSITIVE, also
#      fail-safe. This codebase's `paste` invocations are all stdin pipelines.
#
# The guard is CLOSED. Its contract is: catch the reintroduction of `head -n -N`
# and of `paste -s` lacking an operand, in the forms this codebase actually
# writes. It is not a shell parser.

SH_DIR="$BATS_TEST_DIRNAME/../sh"

setup() {
    FIXTURES="$(mktemp -d)"
}

teardown() {
    rm -rf "$FIXTURES"
}

count_sh_files() {
    find "$1" -type f -name '*.sh' 2>/dev/null | wc -l | tr -d ' '
}

# Emit "path:lineno:code" for every line of every <dir>/**/*.sh whose first
# non-blank character is not '#'. bash-3.2 safe: no mapfile, no declare -A.
noncomment_lines() {
    local dir="$1" f n line trimmed
    find "$dir" -type f -name '*.sh' | LC_ALL=C sort | while IFS= read -r f; do
        n=0
        while IFS= read -r line || [ -n "$line" ]; do
            n=$(( n + 1 ))
            trimmed="${line#"${line%%[![:space:]]*}"}"
            [ -n "$trimmed" ] || continue
            case "$trimmed" in '#'*) continue ;; esac
            printf '%s:%s:%s\n' "$f" "$n" "$line"
        done < "$f"
    done
}

# Offending lines using `head -n -N`.
find_head_negative() {
    noncomment_lines "$1" | grep -E 'head[[:space:]]+-n[[:space:]]+-[0-9]' || true
}

# Offending `paste` invocations lacking an explicit `-` stdin operand.
find_bare_paste() {
    local dir="$1" entry rest code remainder seg body first cmd out="" bt='`'
    while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        rest="${entry#*:}"          # strip "path:"
        code="${rest#*:}"           # strip "lineno:"

        # `$(` and a backtick open a new command context, exactly as `|` does.
        # Without this, `VAR=$(paste -sd ',')` collapses into the single leading
        # token `VAR=$(paste`, which matches the assignment arm below and hides
        # the paste entirely.
        code="${code//\$\(/|}"
        code="${code//$bt/|}"

        remainder="$code"
        while [ -n "$remainder" ]; do
            seg="${remainder%%|*}"
            if [ "$seg" = "$remainder" ]; then remainder=""; else remainder="${remainder#*|}"; fi

            # Resolve the command actually invoked. A segment may be prefixed by
            # redirections (`>out`, `2>err`, `10>out`, `<in`, `&>out`) or env
            # assignments (`FOO=bar`), which are not the command. A QUOTED leading
            # word is never a prefix — `msg="the paste ..."` must not expose
            # `paste` as the command, so that arm is listed FIRST (the prose token
            # `msg="the` also matches the assignment glob).
            body="$seg"
            while : ; do
                body="${body#"${body%%[![:space:]]*}"}"   # ltrim
                first="${body%%[[:space:]]*}"             # leading token
                [ -n "$first" ] || break
                case "$first" in
                    *'"'*|*"'"*)     break ;;                    # quoted word: prose, not a prefix
                    [A-Za-z_]*=*)    body="${body#"$first"}" ;;  # FOO=bar
                    '<'*|'>'*|'&>'*) body="${body#"$first"}" ;;  # <in >out &>out
                    [0-9]*'>'*)      body="${body#"$first"}" ;;  # 2>err, 10>out (glob has no `+`)
                    *)               break ;;
                esac
            done
            cmd="${first##*/}"                       # basename: catches /usr/bin/paste
            [ "$cmd" = "paste" ] || continue

            # Drop a trailing inline comment before looking for the `-` operand:
            # a standalone `" - "` inside `# TODO - verify` must not satisfy it.
            body="${body%% #*}"

            # Right-trim command-substitution closers, quoting and separators, so a
            # trailing `-` in `$( ... paste -sd ',' -)` is still seen as the operand.
            # One arm per character: an unquoted `;` inside a `[...]` bracket is a
            # case-statement metacharacter, not a glob member.
            while : ; do
                case "$body" in
                    *')')         body="${body%?}" ;;
                    *'"')         body="${body%?}" ;;
                    *"'")         body="${body%?}" ;;
                    *';')         body="${body%?}" ;;
                    *'}')         body="${body%?}" ;;
                    *[[:space:]]) body="${body%?}" ;;
                    *)            break ;;
                esac
            done

            case "$body" in
                *" - "*) continue ;;                 # stdin operand mid-segment
                *" -")   continue ;;                 # stdin operand at end of segment
            esac
            out="${out}${entry}
"
            break
        done
    done <<EOF
$(noncomment_lines "$dir" | grep -F 'paste' || true)
EOF
    printf '%s' "$out"
}

# ── Guards over the real tree ────────────────────────────────────────────────

@test "STATIC GUARD: scripts/sh never uses GNU-only 'head -n -N' (BSD head rejects negative counts)" {
    [ "$(count_sh_files "$SH_DIR")" -gt 0 ]   # sanity floor: an empty scan must not read as clean
    local hits
    hits="$(find_head_negative "$SH_DIR")"
    if [ -n "$hits" ]; then
        echo "Use \`sed '\$d'\` instead of \`head -n -1\`. Offending lines:"
        echo "$hits"
        false
    fi
}

@test "STATIC GUARD: scripts/sh never uses 'paste -s' without an explicit '-' stdin operand" {
    [ "$(count_sh_files "$SH_DIR")" -gt 0 ]   # sanity floor
    local hits
    hits="$(find_bare_paste "$SH_DIR")"
    if [ -n "$hits" ]; then
        echo "GNU paste defaults to stdin; BSD paste prints usage. Append \` -\`. Offending lines:"
        echo "$hits"
        false
    fi
}

# ── Self-tests: prove each detector actually fires ───────────────────────────

@test "SELF-TEST: head guard detects the bad idiom, ignores the fix and comments" {
    printf '%s\n' 'x="$(printf a | head -n -1)"' > "$FIXTURES/bad.sh"
    [ -n "$(find_head_negative "$FIXTURES")" ]

    rm -f "$FIXTURES/bad.sh"
    printf '%s\n' "x=\"\$(printf a | sed '\$d')\"" > "$FIXTURES/good.sh"
    printf '%s\n' '  # head -n -1 is a GNU extension — documented, not used' >> "$FIXTURES/good.sh"
    [ -z "$(find_head_negative "$FIXTURES")" ]
}

@test "SELF-TEST: paste guard detects the bare form, ignores the '-' form, comments and prose" {
    printf '%s\n' "echo a | paste -sd ',' | sed 's/,/, /g'" > "$FIXTURES/bad.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    rm -f "$FIXTURES/bad.sh"
    printf '%s\n' "echo a | paste -sd ',' - | sed 's/,/, /g'" > "$FIXTURES/good.sh"
    printf '%s\n' "echo b | paste -sd ',' -" >> "$FIXTURES/good.sh"
    printf '%s\n' "  # paste -sd ',' needs an explicit - on BSD" >> "$FIXTURES/good.sh"
    printf '%s\n' 'copy-paste_helper() { :; }' >> "$FIXTURES/good.sh"
    printf '%s\n' "msg=\"the paste -sd ',' idiom is banned\"  # prose, not an invocation" >> "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: paste guard inspects EVERY pipeline segment, not just the first" {
    # Regression pin for a real defect: `${seg#*paste}` only ever saw the first
    # `paste` on a line, so a good invocation upstream masked a bad one downstream.
    printf '%s\n' "echo a | paste -sd ',' - | paste -sd ','" > "$FIXTURES/bad.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    rm -f "$FIXTURES/bad.sh"
    printf '%s\n' "echo a | paste -sd ',' - | paste -sd ',' -" > "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: paste guard catches a full-path invocation" {
    printf '%s\n' "echo a | /usr/bin/paste -sd ','" > "$FIXTURES/bad.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    rm -f "$FIXTURES/bad.sh"
    printf '%s\n' "echo a | /usr/bin/paste -sd ',' -" > "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: paste guard resolves the command past leading redirects and assignments" {
    # Regression pin: an earlier draft took the segment's first whitespace token
    # as the command, so a redirection or env-assignment prefix hid the paste.
    printf '%s\n' "echo a | >out.txt paste -sd ','" > "$FIXTURES/bad1.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    find "$FIXTURES" -type f -name '*.sh' -delete
    printf '%s\n' "echo a | FOO=bar paste -sd ','" > "$FIXTURES/bad2.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    find "$FIXTURES" -type f -name '*.sh' -delete
    printf '%s\n' "echo a | FOO=bar paste -sd ',' -" > "$FIXTURES/good.sh"
    printf '%s\n' "echo a | 2>err paste -sd ',' -"  >> "$FIXTURES/good.sh"
    # A quoted leading word is prose, never a command prefix.
    printf '%s\n' "msg=\"the paste -sd ',' idiom is banned\"" >> "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: a trailing inline comment cannot mask a missing '-' operand" {
    # Regression pin: the operand check used to scan the raw segment, so a
    # standalone " - " inside the comment satisfied it.
    printf '%s\n' "echo a | paste -sd ',' # TODO - verify on BSD" > "$FIXTURES/bad.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    find "$FIXTURES" -type f -name '*.sh' -delete
    printf '%s\n' "echo a | paste -sd ',' - # verified on BSD" > "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: paste guard handles multi-digit fd redirects" {
    # Regression pin: `[0-9]'>'*` matched exactly one digit, so `10>out` hid the
    # command. Shell globs have no `+`, so the pattern is `[0-9]*'>'*`.
    printf '%s\n' "echo a | 10>out.txt paste -sd ','" > "$FIXTURES/bad.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    find "$FIXTURES" -type f -name '*.sh' -delete
    printf '%s\n' "echo a | 10>out.txt paste -sd ',' -" > "$FIXTURES/good.sh"
    printf '%s\n' "echo b | 2>err paste -sd ',' -"      >> "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: paste guard sees into command substitutions" {
    # Regression pin: `VAR=$(paste -sd ',')` collapsed into the single leading
    # token `VAR=$(paste`, which matched the assignment arm and hid the paste.
    printf '%s\n' "VAR=\$(paste -sd ',')" > "$FIXTURES/bad1.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    find "$FIXTURES" -type f -name '*.sh' -delete
    printf '%s\n' "VAR=\`paste -sd ','\`" > "$FIXTURES/bad2.sh"
    [ -n "$(find_bare_paste "$FIXTURES")" ]

    # The closing `)` must not defeat the operand check on the correct form.
    find "$FIXTURES" -type f -name '*.sh' -delete
    printf '%s\n' "VAR=\$(paste -sd ',' -)"           > "$FIXTURES/good.sh"
    printf '%s\n' "x=\"\$(echo a | paste -sd ',' -)\"" >> "$FIXTURES/good.sh"
    [ -z "$(find_bare_paste "$FIXTURES")" ]
}

@test "SELF-TEST: the sanity floor fails on an empty tree (a guard that cannot fail is worse than none)" {
    mkdir -p "$FIXTURES/empty"
    [ "$(count_sh_files "$FIXTURES/empty")" -eq 0 ]
    # Both detectors report "clean" on an empty tree — which is precisely why the
    # two STATIC GUARD tests above assert count_sh_files > 0 before trusting them.
    [ -z "$(find_head_negative "$FIXTURES/empty")" ]
    [ -z "$(find_bare_paste "$FIXTURES/empty")" ]
}
