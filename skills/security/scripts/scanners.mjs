#!/usr/bin/env node
// Run whichever deterministic security scanners are installed, read-only, and summarize what ran.
// Usage: node scanners.mjs <checkout> --out <dir> [--offline] [--timeout 600] [--only gitleaks,bandit]
// Never installs anything. Tools marked network:true contact their vulnerability or rule services.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', 'vendor', '__pycache__', '.next', 'target']);

function which(name) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  return null;
}

// Collect the files that decide which scanners apply.
function survey(root, maxDepth = 6) {
  const found = { lockfiles: [], requirements: [], gomods: [], dockerfiles: [], python: false, workflows: existsSync(join(root, '.github', 'workflows')) };
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1);
      } else if (e.name === 'package-lock.json') found.lockfiles.push(p);
      else if (/^requirements.*\.txt$/.test(e.name)) found.requirements.push(p);
      else if (e.name === 'go.mod') found.gomods.push(p);
      else if (/^Dockerfile/.test(e.name)) found.dockerfiles.push(p);
      else if (e.name.endsWith('.py')) found.python = true;
    }
  };
  walk(root, 0);
  return found;
}

// Each scanner yields zero or more jobs: { cwd, args, outFile, stdoutIsReport }.
export function plan(root, out, s) {
  const o = (name) => join(out, `${name}.json`);
  return [
    { tool: 'gitleaks', network: false, jobs: () => [{ args: ['detect', '--no-git', '--source', root, '--report-format', 'json', '--report-path', o('gitleaks'), '--redact', '--no-banner'], outFile: o('gitleaks') }] },
    { tool: 'trufflehog', network: false, jobs: () => [{ args: ['filesystem', root, '--json', '--no-update', '--no-verification'], outFile: o('trufflehog'), stdoutIsReport: true }] },
    { tool: 'semgrep', network: true, jobs: () => [{ args: ['scan', '--config', 'p/default', '--json', '--metrics', 'off', '--quiet', '--output', o('semgrep'), root], outFile: o('semgrep') }] },
    { tool: 'osv-scanner', network: true, jobs: () => [{ args: ['scan', 'source', '-r', root, '--format', 'json', '--output', o('osv-scanner')], outFile: o('osv-scanner') }] },
    { tool: 'npm', label: 'npm-audit', network: true, jobs: () => s.lockfiles.map((f, i) => ({ cwd: dirname(f), args: ['audit', '--json', '--package-lock-only'], outFile: o(`npm-audit-${i + 1}`), stdoutIsReport: true, target: f })) },
    { tool: 'pip-audit', network: true, jobs: () => s.requirements.map((f, i) => ({ args: ['-r', f, '-f', 'json', '--progress-spinner', 'off'], outFile: o(`pip-audit-${i + 1}`), stdoutIsReport: true, target: f })) },
    { tool: 'bandit', network: false, jobs: () => (s.python ? [{ args: ['-r', root, '-f', 'json', '-q', '-o', o('bandit'), '-x', '*/node_modules/*,*/.venv/*,*/venv/*'], outFile: o('bandit') }] : []) },
    { tool: 'trivy', network: true, jobs: () => [{ args: ['fs', '--format', 'json', '--output', o('trivy'), '--scanners', 'vuln,secret,misconfig', root], outFile: o('trivy') }] },
    { tool: 'govulncheck', network: true, jobs: () => s.gomods.map((f, i) => ({ cwd: dirname(f), args: ['-json', './...'], outFile: o(`govulncheck-${i + 1}`), stdoutIsReport: true, target: f })) },
    { tool: 'zizmor', network: false, jobs: () => (s.workflows ? [{ args: ['--format', 'json', '--offline', join(root, '.github', 'workflows')], outFile: o('zizmor'), stdoutIsReport: true }] : []) },
    { tool: 'hadolint', network: false, jobs: () => s.dockerfiles.map((f, i) => ({ args: ['-f', 'json', f], outFile: o(`hadolint-${i + 1}`), stdoutIsReport: true, target: f })) },
  ];
}

function run(cmd, args, cwd, timeoutSec) {
  return new Promise((done) => {
    const out = [];
    const err = [];
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeoutSec * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ code: 127, stdout: '', stderr: e.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code: code ?? (signal ? 124 : 1), stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
    });
  });
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') o.offline = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o._[0] || !o.out) {
    console.error('usage: scanners.mjs <checkout> --out <dir> [--offline] [--timeout 600] [--only a,b]');
    return 2;
  }
  const root = resolve(o._[0]);
  const out = resolve(o.out, 'scanners');
  mkdirSync(out, { recursive: true });
  const only = o.only ? new Set(o.only.split(',')) : null;
  const timeout = Number(o.timeout || 600);
  const s = survey(root);
  const results = [];

  for (const scanner of plan(root, out, s)) {
    const name = scanner.label || scanner.tool;
    if (only && !only.has(name)) continue;
    const bin = which(scanner.tool);
    if (!bin) { results.push({ tool: name, status: 'missing', network: scanner.network }); continue; }
    if (scanner.network && o.offline) { results.push({ tool: name, status: 'skipped', reason: '--offline', network: true }); continue; }
    const jobs = scanner.jobs();
    if (!jobs.length) { results.push({ tool: name, status: 'skipped', reason: 'nothing to scan', network: scanner.network }); continue; }
    for (const job of jobs) {
      const started = Date.now();
      const r = await run(bin, job.args, job.cwd || root, timeout);
      if (job.stdoutIsReport) writeFileSync(job.outFile, r.stdout);
      const errFile = job.outFile.replace(/\.json$/, '.stderr.log');
      if (r.stderr.trim()) writeFileSync(errFile, r.stderr);
      results.push({
        tool: name, status: r.code === 124 ? 'timeout' : 'ran', exit_code: r.code, network: scanner.network,
        target: job.target ? relative(root, job.target) : '.', seconds: Math.round((Date.now() - started) / 100) / 10,
        output: existsSync(job.outFile) ? job.outFile : null, stderr: r.stderr.trim() ? errFile : null,
      });
    }
  }

  const summary = { checkout: root, at: new Date().toISOString(), offline: Boolean(o.offline), survey: { ...s, lockfiles: s.lockfiles.length, requirements: s.requirements.length, gomods: s.gomods.length, dockerfiles: s.dockerfiles.length }, results };
  writeFileSync(join(out, 'scanners.json'), JSON.stringify(summary, null, 2) + '\n');
  for (const r of results) {
    const extra = r.status === 'ran' ? `exit ${r.exit_code}, ${r.seconds}s, ${r.target}` : r.reason || '';
    console.log(`${r.tool.padEnd(12)} ${r.status.padEnd(8)} ${extra}`);
  }
  console.log(`\nsummary: ${join(out, 'scanners.json')} (exit codes: most scanners exit non-zero when they find something)`);
  return 0;
}

if (basename(process.argv[1] || '') === 'scanners.mjs') main().then((c) => process.exit(c));
