// Run many briefs from a JSONL file with a concurrency cap; one run record per task plus a summary.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UsageError, runsRoot } from './config.mjs';
import { makeRunDir, normalizeTask, runTask } from './run.mjs';

const KEYS = new Set(['id', 'via', 'tier', 'model', 'effort', 'mode', 'cwd', 'prompt', 'prompt_file', 'attach', 'timeout', 'label', 'budgetUsd', 'raw', 'allowUnsandboxed']);

export function parseBatch(file, { tiers, env = process.env, defaults = {} } = {}) {
  const baseDir = dirname(resolve(file));
  const lines = readFileSync(file, 'utf8').split('\n');
  const tasks = [];
  lines.forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('//')) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      throw new UsageError(`${file}:${i + 1}: not valid JSON (${e.message})`);
    }
    const unknown = Object.keys(obj).filter((k) => !KEYS.has(k));
    if (unknown.length) throw new UsageError(`${file}:${i + 1}: unknown keys ${unknown.join(', ')}`);
    const task = { id: obj.id ?? `task-${tasks.length + 1}`, ...defaults, ...obj };
    try {
      normalizeTask(task, { tiers, env, baseDir }); // validate every line before running any
    } catch (e) {
      throw new UsageError(`${file}:${i + 1}: ${e.message}`);
    }
    tasks.push({ ...task, _baseDir: baseDir });
  });
  if (!tasks.length) throw new UsageError(`${file}: no tasks`);
  return tasks;
}

export async function runBatch(file, { tiers, env = process.env, parallel = 3, defaults = {}, dryRun = false, onDone } = {}) {
  const tasks = parseBatch(file, { tiers, env, defaults });
  const root = dryRun ? null : makeRunDir({ label: 'batch' }, runsRoot(env));
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      const { _baseDir, ...task } = tasks[i];
      try {
        results[i] = await runTask({ ...task, dryRun }, { tiers, env, baseDir: _baseDir, outRoot: root || undefined });
      } catch (e) {
        results[i] = { id: task.id, via: task.via, ok: false, error: e.message };
      }
      onDone?.(results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, tasks.length)) }, worker));
  const summary = {
    batch_dir: root,
    total: results.length,
    ok: results.filter((r) => r.ok || r.dry_run).length,
    tasks: results.map(({ text, ...meta }) => meta),
  };
  if (root) writeFileSync(join(root, 'batch.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
