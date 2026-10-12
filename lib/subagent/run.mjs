// Run one delegated task through a harness and keep a record of it.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { buildCommand } from './adapters.mjs';
import { HARNESSES, UsageError, resolveModel, resolveVia, runsRoot } from './config.mjs';

export const WORKER_PREAMBLE = `You are a delegated worker. Another agent wrote this brief and will check your work.
- Do only the task below and stay inside its scope.
- Do not run session-start rituals, claim tasks, write logs, notes or memory, or message anyone. The delegating agent owns coordination.
- Do not push, publish, deploy, or contact services the brief does not name.
- If something blocks you, stop and say what blocked you. Do not guess.
- Mark each claim as "checked" (you read the code or ran it) or "inferred". Cite files as path:line.
- End with the output format the brief asks for.`;

const MAX_ATTACH_BYTES = 200_000;
const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

// Fill defaults and reject unsafe or impossible combinations before anything runs.
export function normalizeTask(input, { tiers, env = process.env, baseDir = process.cwd() } = {}) {
  const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null));
  const t = { tier: 'cheap', mode: 'read', timeout: 900, attach: [], ...given };
  t.via = resolveVia(t.via, env);
  if (!HARNESSES.includes(t.via)) throw new UsageError(`--via must be one of ${HARNESSES.join(', ')}, or "other" (got "${input.via ?? ''}")`);
  if (!['read', 'write'].includes(t.mode)) throw new UsageError(`--mode must be read or write (got "${t.mode}")`);
  if (t.mode === 'write' && !input.cwd) throw new UsageError('write tasks need an explicit --cwd (use a scratch git worktree, never your main checkout)');
  t.cwd = resolve(baseDir, t.cwd || '.');
  if (!existsSync(t.cwd) || !statSync(t.cwd).isDirectory()) throw new UsageError(`--cwd is not a directory: ${t.cwd}`);
  if (t.prompt_file && t.prompt == null) t.prompt = readFileSync(resolve(baseDir, t.prompt_file), 'utf8');
  if (!t.prompt || !String(t.prompt).trim()) throw new UsageError('empty brief: pass --prompt, --prompt-file, or - to read the brief from stdin');
  t.attach = [].concat(t.attach || []).map((p) => resolve(baseDir, p));
  t.timeout = Number(t.timeout);
  if (!(t.timeout > 0)) throw new UsageError('--timeout must be a positive number of seconds');
  Object.assign(t, resolveModel(t, tiers));
  return t;
}

export function assemblePrompt(task) {
  const sections = [];
  if (!task.raw) {
    sections.push(WORKER_PREAMBLE);
    sections.push(task.mode === 'write'
      ? `Mode: write. Change files only inside ${task.cwd}.`
      : 'Mode: read-only. Do not create, edit or delete files.');
  }
  sections.push(task.raw ? String(task.prompt) : `## Brief\n\n${task.prompt}`);
  for (const file of task.attach) {
    const buf = readFileSync(file);
    const body = buf.subarray(0, MAX_ATTACH_BYTES).toString('utf8');
    const cut = buf.length > MAX_ATTACH_BYTES ? `\n[truncated at ${MAX_ATTACH_BYTES} bytes of ${buf.length}]` : '';
    sections.push(`## Attached: ${file}\n\n\`\`\`${extname(file).slice(1)}\n${body}${cut}\n\`\`\``);
  }
  return sections.join('\n\n');
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function makeRunDir(task, root) {
  const label = String(task.label || task.id || task.via).replace(/[^\w.-]+/g, '-').slice(0, 40);
  const dir = join(root, `${stamp()}-${label}-${randomBytes(3).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function capture(stream, sink) {
  let size = 0;
  stream.on('data', (chunk) => {
    if (size >= MAX_CAPTURE_BYTES) return;
    size += chunk.length;
    sink.push(chunk);
  });
}

export function spawnWithTimeout(spec, timeoutSec) {
  return new Promise((resolvePromise) => {
    const out = [];
    const err = [];
    let timedOut = false;
    const child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    capture(child.stdout, out);
    capture(child.stderr, err);
    const kill = (sig) => {
      try { process.kill(-child.pid, sig); } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 5000).unref();
    }, timeoutSec * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ code: 127, stdout: '', stderr: String(e.message), timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? (signal ? 128 : 1), stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(spec.stdin ?? '');
  });
}

async function postJson(http, timeoutSec) {
  try {
    const res = await fetch(http.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(http.body),
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
    const text = await res.text();
    return { code: res.ok ? 0 : 1, stdout: text, stderr: res.ok ? '' : `HTTP ${res.status}`, timedOut: false };
  } catch (e) {
    const timedOut = e.name === 'TimeoutError';
    return { code: timedOut ? 124 : 1, stdout: '', stderr: String(e.cause?.message || e.message), timedOut };
  }
}

// The argv as recorded: the brief is replaced by a pointer so records stay small.
function displayArgs(spec, prompt) {
  return spec.args.map((a) => (a === prompt ? '<brief.md>' : a));
}

export async function runTask(input, { tiers, env = process.env, baseDir, outRoot } = {}) {
  const task = normalizeTask(input, { tiers, env, baseDir });
  const prompt = assemblePrompt(task);

  if (task.dryRun) {
    const spec = buildCommand({ ...task, prompt, runDir: '<run-dir>' }, env);
    return { dry_run: true, via: task.via, tier: task.tier, model: task.model, effort: task.effort, mode: task.mode, cwd: task.cwd, cmd: spec.cmd, args: displayArgs(spec, prompt), brief_chars: prompt.length };
  }

  buildCommand({ ...task, prompt, runDir: '<run-dir>' }, env); // reject bad tasks before making a run folder
  const runDir = makeRunDir(task, outRoot || runsRoot(env));
  const spec = buildCommand({ ...task, prompt, runDir }, env);
  writeFileSync(join(runDir, 'brief.md'), prompt);

  const started = new Date();
  const res = spec.http ? await postJson(spec.http, task.timeout) : await spawnWithTimeout(spec, task.timeout);
  const duration = (Date.now() - started.getTime()) / 1000;

  let parsed = { text: '', cost: null, error: null };
  try {
    parsed = spec.parse(res);
  } catch (e) {
    parsed = { text: res.stdout, cost: null, error: `parse failed: ${e.message}` };
  }
  const exitCode = res.timedOut ? 124 : res.code;
  const ok = exitCode === 0 && !parsed.error && Boolean(parsed.text.trim());

  writeFileSync(join(runDir, 'output.md'), parsed.text);
  writeFileSync(join(runDir, 'stdout.log'), res.stdout);
  writeFileSync(join(runDir, 'stderr.log'), res.stderr);
  const meta = {
    id: task.id ?? basename(runDir),
    via: task.via, tier: task.tier, model: task.model, effort: task.effort, mode: task.mode, cwd: task.cwd,
    started_at: started.toISOString(), duration_s: Math.round(duration * 10) / 10,
    exit_code: exitCode, timed_out: res.timedOut, ok, error: parsed.error || (ok ? null : lastLine(res.stderr) || 'no output'),
    cost_usd: parsed.cost,
    run_dir: runDir, output_file: join(runDir, 'output.md'),
    cmd: spec.cmd, args: displayArgs(spec, prompt),
  };
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return { ...meta, text: parsed.text };
}

function lastLine(s) {
  const lines = s.trim().split('\n').filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 300) : '';
}
