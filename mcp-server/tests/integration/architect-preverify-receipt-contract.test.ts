import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const ROLES = ['arch-platform', 'arch-testing', 'arch-integration'];

// Inspect executable examples, not a receipt mention elsewhere in the prose.
function finalCommands(content: string): string[] {
  return [...content.matchAll(/```(?:bash)?\n([\s\S]*?)```/g)]
    .flatMap(block => block[1].replace(/\\\r?\n\s*/g, ' ').split('\n'))
    .filter(line => /\brun verdict-write\b/.test(line) && /--phase verify-final\b/.test(line));
}

function requireReceiptCommand(command: string): void {
  if (!/--evidence-file\s+<absolute-preverify-receipt>(?:\s|$)/.test(command)
    || /\[[^\]]*--evidence-file/.test(command)) {
    throw new Error('missing-mandatory-preverify-receipt');
  }
  // wave-control requires opaque-file. Adding a schema produces json-record.
  if (/--evidence-schema\b/.test(command)) throw new Error('preverify-must-be-opaque-file');
}

describe('architect VERIFY_FINAL receipt command contract', () => {
  for (const role of ROLES) {
    it(`${role} distinguishes mandatory epoch evidence from optional supplemental evidence`, () => {
      const content = readFileSync(path.join(ROOT, `setup/agent-templates/${role}.md`), 'utf8');
      expect(content).toContain('A VERIFY_FINAL approve MUST include `--evidence-file <absolute-preverify-receipt>`');
      expect(content).toContain('current EXECUTE -> VERIFY_FINAL boundary supplied in dispatch');
      expect(content).toContain('Do not add `--evidence-schema` to that receipt');
      expect(content).toContain('`opaque-file` evidence for the current cycle and verification epoch');
      expect(content).toContain('`--evidence-text` and additional `--evidence-file` paths are optional supplemental evidence');
      expect(content).toContain('neither replaces the mandatory preverify receipt');
    });

    for (const relative of [
      `setup/agent-templates/${role}.md`,
      `.claude/agents/${role}.md`,
      `setup/copilot-agent-templates/${role}.agent.md`,
    ]) {
      it(`${relative} binds mandatory preverify evidence in its executable example`, () => {
        const commands = finalCommands(readFileSync(path.join(ROOT, relative), 'utf8'));
        expect(commands).toHaveLength(1);
        expect(commands[0]).toContain(`--role ${role}`);
        expect(() => requireReceiptCommand(commands[0])).not.toThrow();
      });
    }
  }
});

describe('preverify command regression controls', () => {
  const command = 'node .claude/runtime/l0-toolkit-launcher.cjs run verdict-write '
    + '--project-root "$PWD" -- --role arch-platform --phase verify-final '
    + '--request <request.json> --request-sha256 <sha256> --decision approve '
    + '--rationale "<concise rationale>" --evidence-file <absolute-preverify-receipt>';

  it('accepts the mandatory receipt without supplemental evidence text', () => {
    expect(() => requireReceiptCommand(command)).not.toThrow();
  });

  it('accepts optional supplemental text alongside the mandatory receipt', () => {
    expect(() => requireReceiptCommand(command + ' --evidence-text "<supplemental evidence>"')).not.toThrow();
  });

  it('rejects the previous text-only command even when prose mentions the receipt', () => {
    const previous = command.replace('--evidence-file <absolute-preverify-receipt>', '--evidence-text "<evidence>"');
    const commands = finalCommands('```bash\n' + previous + '\n```\n'
      + 'Mandatory: --evidence-file <absolute-preverify-receipt>');
    expect(commands).toHaveLength(1);
    expect(() => requireReceiptCommand(commands[0])).toThrow('missing-mandatory-preverify-receipt');
  });

  it('rejects presenting the receipt argument as optional', () => {
    expect(() => requireReceiptCommand(command.replace('--evidence-file <absolute-preverify-receipt>',
      '[--evidence-file <absolute-preverify-receipt>]'))).toThrow('missing-mandatory-preverify-receipt');
  });

  it('rejects a generic evidence file in place of the canonical preverify receipt', () => {
    expect(() => requireReceiptCommand(command.replace('<absolute-preverify-receipt>', '<supplemental-file>')))
      .toThrow('missing-mandatory-preverify-receipt');
  });

  it('rejects schema annotation that would turn the receipt into json-record evidence', () => {
    expect(() => requireReceiptCommand(command + ' --evidence-schema wave-preverify-receipt/v1'))
      .toThrow('preverify-must-be-opaque-file');
  });
});
