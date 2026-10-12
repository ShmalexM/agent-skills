// Offline tests: command construction, task checks, tier config and batch parsing. No model is called.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLAUDE_READ_TOOLS, buildCommand } from '../lib/subagent/adapters.mjs';
import { parseBatch } from '../lib/subagent/batch.mjs';
import { UsageError, detectSelf, loadTiers, merge, resolveModel, resolveVia } from '../lib/subagent/config.mjs';
import { WORKER_PREAMBLE, assemblePrompt, normalizeTask, runTask } from '../lib/subagent/run.mjs';

const tiers = loadTiers({ HOME: '/nonexistent', AGENT_SKILLS_TIERS: '/nonexistent/tiers.json' });
const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
const base = { cwd: dir, prompt: 'do the thing', runDir: dir };

test('tiers: every harness has the three tiers and a data note', () => {
  for (const h of ['claude', 'codex', 'opencode', 'ollama', 'dsh']) {
    for (const t of ['cheap', 'standard', 'frontier']) assert.ok(tiers[h][t], `${h}.${t}`);
    assert.ok(tiers[h].data, `${h}.data`);
  }
});

test('tiers: user overrides deep-merge over the defaults', () => {
  const merged = merge(tiers, { codex: { cheap: { model: 'other-model' } } });
  assert.equal(merged.codex.cheap.model, 'other-model');
  assert.equal(merged.codex.cheap.effort, 'low');
  assert.equal(merged.claude.cheap.model, tiers.claude.cheap.model);
});

test('resolveModel: flags beat the tier table; bad tiers are rejected', () => {
  assert.deepEqual(resolveModel({ via: 'codex', tier: 'cheap' }, tiers), { model: 'gpt-6-luna', effort: 'low' });
  assert.equal(resolveModel({ via: 'codex', tier: 'cheap', model: 'x' }, tiers).model, 'x');
  assert.throws(() => resolveModel({ via: 'codex', tier: 'huge' }, tiers), UsageError);
});

test('detectSelf and "other" pick a different model family', () => {
  assert.equal(detectSelf({ CLAUDECODE: '1' }), 'claude');
  assert.equal(detectSelf({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
  assert.equal(detectSelf({}), null);
  assert.equal(resolveVia('other', { CLAUDECODE: '1' }), 'codex');
  assert.equal(resolveVia('other', { CODEX_THREAD_ID: 'x' }), 'claude');
  assert.equal(resolveVia('codex', {}), 'codex');
});

test('claude read mode: no edit tools, nesting guard stripped, brief on stdin', () => {
  const spec = buildCommand({ ...base, via: 'claude', mode: 'read', model: 'claude-haiku-5-5' }, { PATH: '', CLAUDECODE: '1', HOME: '/x' });
  const allowed = spec.args[spec.args.indexOf('--allowedTools') + 1];
  assert.equal(allowed, CLAUDE_READ_TOOLS.join(','));
  assert.ok(!allowed.includes('Edit') && !allowed.split(',').includes('Bash'));
  assert.ok(spec.args.includes('--disallowedTools'));
  assert.deepEqual(spec.args.slice(spec.args.indexOf('--permission-mode'), spec.args.indexOf('--permission-mode') + 2), ['--permission-mode', 'dontAsk']);
  assert.equal(spec.args[spec.args.indexOf('--model') + 1], 'claude-haiku-5-5');
  assert.equal(spec.env.CLAUDECODE, undefined);
  assert.equal(spec.stdin, 'do the thing');
  assert.ok(!spec.args.includes('--bare'), '--bare would break OAuth sign-in');
});

test('claude write mode allows edits; budget passes through', () => {
  const spec = buildCommand({ ...base, via: 'claude', mode: 'write', budgetUsd: 2 }, { PATH: '' });
  assert.ok(spec.args[spec.args.indexOf('--allowedTools') + 1].includes('Edit'));
  assert.ok(!spec.args.includes('--disallowedTools'));
  assert.equal(spec.args[spec.args.indexOf('--max-budget-usd') + 1], '2');
});

test('codex: sandbox follows mode, effort becomes a config override, last message to a file', () => {
  const read = buildCommand({ ...base, via: 'codex', mode: 'read', model: 'gpt-6-luna', effort: 'low' }, { PATH: '' });
  assert.equal(read.args[read.args.indexOf('-s') + 1], 'read-only');
  assert.ok(read.args.includes('model_reasoning_effort="low"'));
  assert.ok(read.args.includes('approval_policy="never"'));
  assert.equal(read.args.at(-1), '-');
  assert.equal(read.outputFile, join(dir, 'codex-last-message.md'));
  const write = buildCommand({ ...base, via: 'codex', mode: 'write' }, { PATH: '' });
  assert.equal(write.args[write.args.indexOf('-s') + 1], 'workspace-write');
});

test('opencode: plan agent for read, build agent for write, JSON events parsed', () => {
  const spec = buildCommand({ ...base, via: 'opencode', mode: 'read', model: 'ollama/qwen3.5:latest' }, { PATH: '' });
  assert.equal(spec.args[spec.args.indexOf('--agent') + 1], 'plan');
  assert.equal(spec.args.at(-1), 'do the thing');
  const parsed = spec.parse({ stdout: '{"type":"step_start"}\n{"type":"text","part":{"type":"text","text":"PONG"}}\n' });
  assert.equal(parsed.text, 'PONG');
  assert.equal(buildCommand({ ...base, via: 'opencode', mode: 'write' }, { PATH: '' }).args.includes('build'), true);
});

test('ollama: read only, needs a model, posts to the local server', () => {
  const spec = buildCommand({ ...base, via: 'ollama', mode: 'read', model: 'qwen3.5:latest' }, { PATH: '' });
  assert.equal(spec.http.url, 'http://127.0.0.1:11434/api/generate');
  assert.equal(spec.http.body.stream, false);
  assert.equal(spec.parse({ stdout: '{"response":"PONG"}' }).text, 'PONG');
  assert.throws(() => buildCommand({ ...base, via: 'ollama', mode: 'write', model: 'm' }, {}), UsageError);
  assert.throws(() => buildCommand({ ...base, via: 'ollama', mode: 'read', model: null }, {}), UsageError);
});

test('dsh: refused unless explicitly allowed, and never with a model flag', () => {
  assert.throws(() => buildCommand({ ...base, via: 'dsh', mode: 'read' }, { PATH: '', HOME: '/x' }), /allow-unsandboxed/);
  const spec = buildCommand({ ...base, via: 'dsh', mode: 'read', allowUnsandboxed: true }, { PATH: '', HOME: '/x' });
  assert.deepEqual(spec.args.slice(0, 2), ['--profile', 'headless']);
  assert.throws(() => buildCommand({ ...base, via: 'dsh', model: 'm', allowUnsandboxed: true }, { PATH: '', HOME: '/x' }), UsageError);
});

test('normalizeTask: defaults, write needs --cwd, empty briefs rejected', () => {
  const t = normalizeTask({ via: 'codex', prompt: 'x', cwd: dir, mode: undefined }, { tiers, env: {} });
  assert.equal(t.mode, 'read');
  assert.equal(t.tier, 'cheap');
  assert.equal(t.model, 'gpt-6-luna');
  assert.throws(() => normalizeTask({ via: 'codex', prompt: 'x', mode: 'write' }, { tiers, env: {} }), /explicit --cwd/);
  assert.throws(() => normalizeTask({ via: 'codex', prompt: '  ', cwd: dir }, { tiers, env: {} }), /empty brief/);
  assert.throws(() => normalizeTask({ via: 'nope', prompt: 'x', cwd: dir }, { tiers, env: {} }), UsageError);
});

test('assemblePrompt: preamble and mode line unless raw; attachments inlined', () => {
  const file = join(dir, 'notes.txt');
  writeFileSync(file, 'hello file');
  const t = normalizeTask({ via: 'ollama', prompt: 'sum it', cwd: dir, attach: [file] }, { tiers, env: {} });
  const p = assemblePrompt(t);
  assert.ok(p.startsWith(WORKER_PREAMBLE));
  assert.ok(p.includes('Mode: read-only'));
  assert.ok(p.includes('## Brief\n\nsum it'));
  assert.ok(p.includes(`## Attached: ${file}`) && p.includes('hello file'));
  assert.equal(assemblePrompt({ ...t, raw: true, attach: [] }), 'sum it');
});

test('runTask dry run spends nothing and hides the brief in argv', async () => {
  const r = await runTask({ via: 'opencode', prompt: 'secret-ish brief', cwd: dir, dryRun: true }, { tiers, env: { PATH: '' } });
  assert.equal(r.dry_run, true);
  assert.ok(r.args.includes('<brief.md>'));
  assert.ok(!r.args.some((a) => a.includes('secret-ish brief')));
});

test('parseBatch validates every line first and resolves paths from the file', () => {
  const brief = join(dir, 'b.md');
  writeFileSync(brief, 'from file');
  const good = join(dir, 'good.jsonl');
  writeFileSync(good, '// comment\n{"id":"a","via":"codex","prompt_file":"b.md","cwd":"."}\n\n{"via":"ollama","prompt":"x"}\n');
  const tasks = parseBatch(good, { tiers, env: {} });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[1].id, 'task-2');
  const bad = join(dir, 'bad.jsonl');
  writeFileSync(bad, '{"via":"codex","prompt":"x"}\n{"via":"codex","prompt":"x","colour":"red"}\n');
  assert.throws(() => parseBatch(bad, { tiers, env: {} }), /bad\.jsonl:2: unknown keys colour/);
});
