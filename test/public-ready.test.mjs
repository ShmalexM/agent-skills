// The private-terms check and share_lint's personal config both live outside the repo; check they are honored.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function validateWith(terms) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-skills-cfg-'));
  writeFileSync(join(dir, 'private-terms.txt'), `# test list\n${terms.join('\n')}\n`);
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'validate.mjs')], { env: { ...process.env, AGENT_SKILLS_CONFIG_DIR: dir }, encoding: 'utf8' });
}

test('validate: a private term present in the repo fails the check', () => {
  const r = validateWith(['subagent']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /private term "subagent"/);
});

test('validate: terms absent from the repo pass, and the count is reported', () => {
  // Built at run time so the terms do not appear literally in this file.
  const r = validateWith([['zz', 'absent', 'qq'].join('-'), ['yy', 'absent', 'ww'].join('-')]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /none of 2 private terms/);
});

test('share_lint: personal patterns and allowed ports come from the config file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-skills-lint-'));
  writeFileSync(join(dir, 'share_lint.json'), JSON.stringify({ patterns: [['\\bmy-launcher\\b', 'personal launcher']], allow_ports: [8080] }));
  const code = `
import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'skills', 'explain-codebase'))})
from share_lint import lint
print(len(lint("run my-launcher then open localhost:8080")), len(lint("open localhost:9000")), len(lint("clean text")))`;
  const r = spawnSync('python3', ['-c', code], { env: { ...process.env, AGENT_SKILLS_CONFIG_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '1 1 0');
});
