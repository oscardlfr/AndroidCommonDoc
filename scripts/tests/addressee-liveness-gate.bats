#!/usr/bin/env bats
# =============================================================================
# Tests for .claude/hooks/addressee-liveness-gate.js
#
# Validates:
#   - Hook allows SendMessage when addressee is alive
#   - Hook blocks SendMessage when addressee has sent a shutdown notification
#   - Hook blocks SendMessage when addressee has 3+ unanswered messages
# =============================================================================

HOOK_PATH="$(git -C "$BATS_TEST_DIRNAME" rev-parse --show-toplevel)/.claude/hooks/addressee-liveness-gate.js"
SESSION_ID="bats-test-session"

setup() {
    rm -rf "$HOME/.claude/teams/$SESSION_ID"
}

teardown() {
    rm -rf "$HOME/.claude/teams/$SESSION_ID"
}

@test "hook allows message when addressee is alive" {
    run bash -c "echo '{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"context-provider\"},\"session_id\":\"$SESSION_ID\"}' | node '$HOOK_PATH'"
    [ "$status" -eq 0 ]
}

@test "hook blocks message when addressee has shutdown notification" {
    mkdir -p "$HOME/.claude/teams/$SESSION_ID"
    touch "$HOME/.claude/teams/$SESSION_ID/shutdown-dead-peer.flag"
    run bash -c "echo '{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"dead-peer\"},\"session_id\":\"$SESSION_ID\"}' | node '$HOOK_PATH'"
    [ "$status" -eq 2 ]
    [[ "$output" == *"block"* ]]
}

@test "hook blocks message when addressee has 3 unanswered messages" {
    mkdir -p "$HOME/.claude/teams/$SESSION_ID"
    echo "3" > "$HOME/.claude/teams/$SESSION_ID/unanswered-unresponsive-peer.count"
    run bash -c "echo '{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"unresponsive-peer\"},\"session_id\":\"$SESSION_ID\"}' | node '$HOOK_PATH'"
    [ "$status" -eq 2 ]
    [[ "$output" == *"block"* ]]
}
