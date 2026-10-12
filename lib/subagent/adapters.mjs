// One adapter per harness: turn a task into a headless command (or HTTP call) and parse its answer.
import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { UsageError } from './config.mjs';

export function which(name, env = process.env) {
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

// dsh usually runs through npx, so also look in the npx cache. Never trigger a download.
export function findDsh(env = process.env) {
  const onPath = which('dsh', env);
  if (onPath) return onPath;
  const npx = join(env.HOME || homedir(), '.npm', '_npx');
  if (!existsSync(npx)) return null;
  for (const d of readdirSync(npx)) {
    const p = join(npx, d, 'node_modules', '.bin', 'dsh');
    if (existsSync(p) && existsSync(join(npx, d, 'node_modules', '@deepseek-ai', 'dsh'))) return p;
  }
  return null;
}

export function binaryFor(via, env = process.env) {
  if (via === 'dsh') return findDsh(env);
  if (via === 'ollama') return which('ollama', env);
  return which(via, env);
}

// Read-only Claude workers get search tools and read-only git; nothing that edits.
export const CLAUDE_READ_TOOLS = [
  'Read', 'Grep', 'Glob',
  'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git status:*)',
  'Bash(git ls-files:*)', 'Bash(git grep:*)', 'Bash(ls:*)', 'Bash(wc:*)',
];
export const CLAUDE_WRITE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'];

function withoutNestingGuards(env) {
  const out = { ...env };
  delete out.CLAUDECODE;
  delete out.CLAUDE_CODE_ENTRYPOINT;
  return out;
}

function parseClaude({ stdout }) {
  try {
    const j = JSON.parse(stdout);
    return { text: j.result ?? '', cost: j.total_cost_usd ?? null, error: j.is_error ? (j.subtype || 'error') : null };
  } catch {
    return { text: stdout, cost: null, error: 'unparsed output' };
  }
}

function parseOpencode({ stdout }) {
  const parts = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      const part = ev.part || ev.properties?.part;
      if (part?.type === 'text' && part.text) parts.push(part.text);
      else if (ev.type === 'text' && typeof ev.text === 'string') parts.push(ev.text);
    } catch {
      parts.push(line);
    }
  }
  return { text: parts.join('\n').trim() || stdout, cost: null, error: null };
}

// Returns { cmd, args, cwd, env, stdin, outputFile?, http?, parse }.
export function buildCommand(task, env = process.env) {
  const { via, mode, cwd, prompt, model, effort, runDir, budgetUsd, allowUnsandboxed } = task;
  const read = mode !== 'write';

  if (via === 'claude') {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config',
      '--permission-mode', 'dontAsk', '--allowedTools', (read ? CLAUDE_READ_TOOLS : CLAUDE_WRITE_TOOLS).join(',')];
    if (read) args.push('--disallowedTools', 'Edit,Write,NotebookEdit');
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (budgetUsd) args.push('--max-budget-usd', String(budgetUsd));
    return { cmd: binaryFor('claude', env) || 'claude', args, cwd, env: withoutNestingGuards(env), stdin: prompt, parse: parseClaude };
  }

  if (via === 'codex') {
    const outputFile = join(runDir, 'codex-last-message.md');
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never',
      '-s', read ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"', '-C', cwd, '-o', outputFile];
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    args.push('-');
    return {
      cmd: binaryFor('codex', env) || 'codex', args, cwd, env, stdin: prompt, outputFile,
      parse: () => ({ text: existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '', cost: null, error: null }),
    };
  }

  if (via === 'opencode') {
    const args = ['run', '--dir', cwd, '--format', 'json', '--agent', read ? 'plan' : 'build'];
    if (model) args.push('-m', model);
    if (effort) args.push('--variant', effort);
    args.push(prompt);
    return { cmd: binaryFor('opencode', env) || 'opencode', args, cwd, env, stdin: null, parse: parseOpencode };
  }

  if (via === 'ollama') {
    if (!read) throw new UsageError('ollama has no tools; it can only run read tasks (pass the files with --attach)');
    if (!model) throw new UsageError('ollama needs a model (set one in tiers.json or pass --model)');
    const host = (env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const base = host.startsWith('http') ? host : `http://${host}`;
    return {
      http: { url: `${base}/api/generate`, body: { model, prompt, stream: false } },
      cmd: 'POST', args: [`${base}/api/generate`, `model=${model}`], cwd, env,
      parse: ({ stdout }) => {
        const j = JSON.parse(stdout);
        return { text: j.response ?? '', cost: 0, error: j.error ?? null };
      },
    };
  }

  if (via === 'dsh') {
    if (!allowUnsandboxed) {
      throw new UsageError('dsh headless cannot be limited to read-only or to one folder; pass --allow-unsandboxed and use a scratch worktree as --cwd');
    }
    if (model) throw new UsageError('dsh uses its profile default model; --model and tiers are not supported');
    return { cmd: binaryFor('dsh', env) || 'dsh', args: ['--profile', 'headless', prompt], cwd, env, stdin: null, parse: ({ stdout }) => ({ text: stdout.trim(), cost: null, error: null }) };
  }

  throw new UsageError(`unknown harness "${via}"`);
}
