'use strict';

const assert = require('assert');
const test = require('node:test');
const { parseCommandIntent, hasIntent } = require('../lib/shell-command-intent.cjs');

const blocked = [
  'git push', 'git \\push origin x', '\\git push', 'rtk git push',
  'sudo -u user git -C /tmp push origin x', 'FOO=1 env git push',
  'env --chdir /tmp FOO=1 git push', 'nice -n 5 git push', 'xargs -n 1 git push',
  '/usr/bin/git push origin x', "'C:\\Program\\Git\\cmd\\git.exe' push origin x",
  'echo ok && git push', 'bash -c "git push origin x"',
  "bash -lc 'git push origin x'", "zsh -xec 'git push origin x'",
  "bash --noprofile -lc 'git push origin x'", 'echo ok\ngit push origin x',
  '( git push origin x )', '{ git push origin x; }', '! git push origin x',
  'if git push origin x; then echo done; fi', 'git -- push origin x',
  "git -c alias.ship='push origin feature' ship",
  "bash -c $'echo ok\\ngit push origin x'", '$(git push)', '`git push`',
  'gh pr create --title x', 'rtk gh pr create --fill',
  '/usr/local/bin/gh pr create --fill', "'C:\\tools\\gh.exe' pr create --fill",
  'cat <<EOF\nharmless body\nEOF\ngit push origin x',
];
const allowed = [
  'echo git push the button', "printf '%s' 'git push'", 'git status',
  'git -C push status', 'gh pr view 2', "bash -c 'echo git push'",
  '# git push\necho safe',
  'cat <<EOF\ngit push origin x\nEOF\necho safe',
  "cat <<-'EOF'\n\tgit push origin x\n\tEOF\necho safe",
  "echo '{ git push; }'", 'echo { git push }',
];

test('detects executable push and PR-create intents', () => {
  for (const command of blocked) {
    assert.ok(parseCommandIntent(command).length > 0, command);
  }
});

test('does not scan harmless argument prose', () => {
  for (const command of allowed) {
    assert.deepStrictEqual(parseCommandIntent(command), [], command);
  }
});

test('reports intent kinds explicitly', () => {
  assert.strictEqual(hasIntent('git push', 'git-push'), true);
  assert.strictEqual(hasIntent('gh pr create', 'gh-pr-create'), true);
  assert.strictEqual(hasIntent('git push', 'gh-pr-create'), false);
});
