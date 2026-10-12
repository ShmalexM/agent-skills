// Which harnesses are installed, signed in and able to answer a real brief right now.
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { binaryFor } from './adapters.mjs';
import { HARNESSES, REPO_ROOT, detectSelf, listSkills, resolveModel } from './config.mjs';
import { runTask, spawnWithTimeout } from './run.mjs';

export const PROBE_BRIEF = 'Reply with exactly the word PONG and nothing else.';

async function quick(cmd, args, env, timeout = 20) {
  const r = await spawnWithTimeout({ cmd, args, cwd: tmpdir(), env, stdin: '' }, timeout);
  return { ok: r.code === 0, out: `${r.stdout}\n${r.stderr}`.trim() };
}

async function version(bin, env) {
  const r = await quick(bin, ['--version'], env);
  return (r.out.match(/\d+\.\d+[\w.+-]*/) || [r.ok ? r.out.split('\n')[0] : null])[0];
}

// Auth checks report status only. They never print keys, tokens or account details.
async function authStatus(via, bin, env) {
  if (via === 'claude') {
    const r = await quick(bin, ['auth', 'status'], env);
    try {
      const j = JSON.parse(r.out);
      return { ok: Boolean(j.loggedIn), detail: j.loggedIn ? `signed in (${j.authMethod})` : 'not signed in' };
    } catch {
      return { ok: false, detail: 'could not read `claude auth status`' };
    }
  }
  if (via === 'codex') {
    const r = await quick(bin, ['login', 'status'], env);
    return { ok: r.ok && /logged in/i.test(r.out), detail: r.out.split('\n').find((l) => /logged|not/i.test(l)) || 'unknown' };
  }
  if (via === 'opencode') {
    const r = await quick(bin, ['auth', 'list'], env);
    const providers = [...r.out.replace(/\x1b\[[0-9;]*m/g, '').matchAll(/●\s+([^\s]+)/g)].map((m) => m[1]);
    return { ok: r.ok, detail: providers.length ? `providers: ${providers.join(', ')}` : 'no stored credentials (local models only)' };
  }
  if (via === 'ollama') {
    const host = (env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
      const res = await fetch(`${host.startsWith('http') ? host : `http://${host}`}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const j = await res.json();
      return { ok: true, detail: `server up, ${j.models?.length ?? 0} models`, models: (j.models || []).map((m) => m.name) };
    } catch (e) {
      return { ok: false, detail: `server not reachable (${e.cause?.code || e.name}); start the Ollama app` };
    }
  }
  if (via === 'dsh') {
    const settings = join(env.DSH_HOME || join(env.HOME || homedir(), '.dsh'), 'settings.yaml');
    if (!existsSync(settings)) return { ok: false, detail: 'no ~/.dsh/settings.yaml' };
    const m = readFileSync(settings, 'utf8').match(/agent-default-model:\s*\n\s+provider:\s*(\S+)\s*\n\s+model:\s*(\S+)/);
    return { ok: true, detail: m ? `default model ${m[1]}/${m[2]}` : 'settings found' };
  }
  return { ok: false, detail: 'unknown' };
}

function linkedSkills(env) {
  const home = env.HOME || homedir();
  const roots = { claude: join(home, '.claude', 'skills'), agents: join(home, '.agents', 'skills') };
  const out = {};
  for (const [label, root] of Object.entries(roots)) {
    out[label] = listSkills().filter((name) => {
      try {
        return realpathSync(join(root, name)) === realpathSync(join(REPO_ROOT, 'skills', name));
      } catch {
        return false;
      }
    }).length;
  }
  return out;
}

export async function doctor({ tiers, env = process.env, probe = false, only, includeUnsandboxed = false, tier = 'cheap', timeout = 180 } = {}) {
  const wanted = only?.length ? only : HARNESSES;
  const rows = await Promise.all(wanted.map(async (via) => {
    const bin = binaryFor(via, env);
    const row = { harness: via, installed: Boolean(bin), path: bin, data: tiers[via]?.data ?? null, cheap_model: resolveModel({ via, tier }, tiers).model };
    if (!bin) return { ...row, auth: { ok: false, detail: 'not installed' } };
    const [ver, auth] = await Promise.all([via === 'ollama' || via === 'dsh' ? null : version(bin, env), authStatus(via, bin, env)]);
    row.version = ver;
    row.auth = auth;
    if (via === 'ollama' && auth.models && row.cheap_model && !auth.models.includes(row.cheap_model)) {
      row.notes = [`tier model ${row.cheap_model} is not pulled (have: ${auth.models.slice(0, 6).join(', ')})`];
    }
    return row;
  }));

  if (probe) {
    await Promise.all(rows.map(async (row) => {
      if (!row.installed || !row.auth.ok) return (row.probe = { ok: false, skipped: 'not ready' });
      if (row.harness === 'dsh' && !includeUnsandboxed) return (row.probe = { ok: false, skipped: 'needs --include-unsandboxed' });
      const cwd = mkdtempSync(join(env.TMPDIR || tmpdir(), 'subagent-probe-'));
      try {
        const r = await runTask({ via: row.harness, tier, mode: 'read', cwd, prompt: PROBE_BRIEF, timeout, label: `probe-${row.harness}`, allowUnsandboxed: includeUnsandboxed }, { tiers, env, baseDir: cwd });
        row.probe = { ok: r.ok && /PONG/i.test(r.text), seconds: r.duration_s, cost_usd: r.cost_usd, model: r.model, answer: r.text.trim().slice(0, 60), error: r.error, run_dir: r.run_dir };
      } catch (e) {
        row.probe = { ok: false, error: e.message };
      }
    }));
  }

  return { self: detectSelf(env), skills: listSkills(), linked: linkedSkills(env), harnesses: rows };
}

export function formatDoctor(report) {
  const lines = [];
  lines.push(`running inside: ${report.self ?? 'unknown (plain shell)'}`);
  lines.push(`repo skills: ${report.skills.join(', ')}`);
  lines.push(`linked: ~/.claude/skills ${report.linked.claude}/${report.skills.length}, ~/.agents/skills ${report.linked.agents}/${report.skills.length} (run install.sh if short)`);
  lines.push('');
  const head = ['harness', 'installed', 'version', 'ready', 'cheap model', 'data', 'probe'];
  const table = [head];
  for (const r of report.harnesses) {
    const probe = !r.probe ? '-' : r.probe.skipped ? `skipped: ${r.probe.skipped}` : r.probe.ok
      ? `PONG ${r.probe.seconds}s${r.probe.cost_usd != null ? ` $${Number(r.probe.cost_usd).toFixed(4)}` : ''}`
      : `FAIL ${r.probe.error || r.probe.answer || ''}`.slice(0, 70);
    table.push([r.harness, r.installed ? 'yes' : 'no', r.version || '-', `${r.auth.ok ? 'yes' : 'no'}: ${r.auth.detail}`, r.cheap_model || '(default)', r.data || '-', probe]);
  }
  const widths = head.map((_, i) => Math.min(48, Math.max(...table.map((row) => String(row[i]).length))));
  for (const row of table) lines.push(row.map((c, i) => String(c).slice(0, 48).padEnd(widths[i])).join('  ').trimEnd());
  for (const r of report.harnesses) for (const n of r.notes || []) lines.push(`note (${r.harness}): ${n}`);
  return lines.join('\n');
}
