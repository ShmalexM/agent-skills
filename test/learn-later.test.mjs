// learn-later queue: destination handling, index round-trips, and the pack checker. Offline, temp folders only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INDEX_NAME, addTopic, checkPack, newIndex, packPath, parseIndex, renderIndex, resolveRoot, setStatus, topicName } from '../skills/learn-later/scripts/queue.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'learn-later', 'scripts', 'queue.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'learn-later-'));

function cli(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, LEARN_LATER_DIR: '', ...env }, encoding: 'utf8' });
}

test('no destination: where exits 3 and tells the agent to ask; init saves it', () => {
  const cfg = tmp();
  const dest = join(tmp(), 'Learn Later');
  const env = { AGENT_SKILLS_CONFIG_DIR: cfg, HOME: tmp() };
  const before = cli(['where'], env);
  assert.equal(before.status, 3);
  assert.match(before.stderr, /Ask the user/);
  assert.equal(cli(['init', '--root', dest], env).status, 0);
  assert.equal(JSON.parse(readFileSync(join(cfg, 'learn-later.json'), 'utf8')).root, dest);
  const after = cli(['where'], env);
  assert.equal(after.status, 0);
  assert.ok(after.stdout.startsWith(dest));
  assert.match(readFileSync(join(dest, INDEX_NAME), 'utf8'), /learn-later:start/);
});

test('resolveRoot precedence: --root, then LEARN_LATER_DIR, then config', () => {
  const cfg = tmp();
  writeFileSync(join(cfg, 'learn-later.json'), JSON.stringify({ root: '/from/config' }));
  assert.equal(resolveRoot({ env: { AGENT_SKILLS_CONFIG_DIR: cfg } }).root, '/from/config');
  assert.equal(resolveRoot({ env: { AGENT_SKILLS_CONFIG_DIR: cfg, LEARN_LATER_DIR: '/from/env' } }).root, '/from/env');
  assert.equal(resolveRoot({ root: '/from/flag', env: { AGENT_SKILLS_CONFIG_DIR: cfg, LEARN_LATER_DIR: '/x' } }).root, '/from/flag');
  assert.equal(resolveRoot({ env: { AGENT_SKILLS_CONFIG_DIR: tmp() } }), null);
});

test('topic names are filesystem-safe and stable', () => {
  assert.equal(topicName('  Zero-knowledge proofs: a primer?  '), 'Zero-knowledge proofs a primer');
  assert.equal(topicName('A/B testing'), 'A B testing');
  assert.throws(() => topicName('///'));
});

test('add, duplicate add, set status; text outside the table is preserved', () => {
  const root = tmp();
  const r1 = addTopic(root, 'Stablecoins', 'came up in a chat | about tokenized assets', { today: '2026-10-12', header: ['[[Learning/Learning]]', '#Learning'] });
  assert.equal(r1.added, true);
  assert.equal(r1.pack, join(root, 'Stablecoins', 'Stablecoins.md'));
  const indexFile = join(root, INDEX_NAME);
  writeFileSync(indexFile, readFileSync(indexFile, 'utf8') + '\nMy own notes below the table.\n');
  assert.equal(addTopic(root, 'stablecoins').added, false);
  addTopic(root, 'Proof of stake', '', { today: '2026-10-13' });
  setStatus(root, 'Stablecoins', 'ready');
  const text = readFileSync(indexFile, 'utf8');
  assert.match(text, /^\[\[Learning\/Learning\]\]$/m);
  assert.match(text, /My own notes below the table\./);
  assert.match(text, /\| \[Stablecoins\]\(Stablecoins\/Stablecoins\.md\) \| 2026-10-12 \| ready \| came up in a chat \/ about tokenized assets \|/);
  assert.match(text, /\(Proof%20of%20stake\/Proof%20of%20stake\.md\)/);
  const rows = parseIndex(text).rows;
  assert.deepEqual(rows.map((r) => [r.topic, r.status]), [['Stablecoins', 'ready'], ['Proof of stake', 'queued']]);
  assert.throws(() => setStatus(root, 'Stablecoins', 'done'), /status must be/);
  assert.throws(() => setStatus(root, 'Unknown', 'read'), /not in the queue/);
});

test('index render/parse round-trip keeps rows', () => {
  const idx = parseIndex(newIndex());
  idx.rows.push({ topic: 'A', added: '2026-01-01', status: 'queued', why: 'x' });
  assert.deepEqual(parseIndex(renderIndex(idx)).rows, idx.rows);
});

const GOOD = `---
topic: T
---

# T

> **In one line:** a thing.

## How it works

![flow](t-how-it-works.svg)

## Key terms

## Where it stands now (as of 2026-10-12)

## Check yourself

## Go deeper

- [One](https://example.com/1): a
- [Two](https://example.com/2): b
`;

test('checkPack: a complete pack passes; missing parts are named', () => {
  const ok = checkPack(GOOD, '/p', { fileExists: () => true, svgCheck: () => null });
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.warnings.some((w) => /words/.test(w)));
  const bad = checkPack(GOOD.replace('## Key terms\n', '').replace('- [Two](https://example.com/2): b\n', ''), '/p', { fileExists: () => false, svgCheck: () => null });
  assert.ok(bad.errors.includes('missing section "## Key terms"'));
  assert.ok(bad.errors.includes('diagram not found: t-how-it-works.svg'));
  assert.ok(bad.errors.includes('"Go deeper" needs at least 2 source links'));
});

test('checkPack parses real SVG files (python3) and rejects broken ones', () => {
  const dir = tmp();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 't-how-it-works.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>A &amp; B</text></svg>');
  assert.deepEqual(checkPack(GOOD, dir).errors, []);
  writeFileSync(join(dir, 't-how-it-works.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>A & B</text></svg>');
  const probe = spawnSync('python3', ['-c', 'print(1)']);
  if (probe.status === 0) assert.match(checkPack(GOOD, dir).errors.join(' '), /does not parse/);
});

test('packPath matches the index link target', () => {
  assert.equal(packPath('/r', 'Proof of stake'), '/r/Proof of stake/Proof of stake.md');
});
