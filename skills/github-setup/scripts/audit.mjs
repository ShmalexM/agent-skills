#!/usr/bin/env node
// Audit a GitHub repository against a baseline with `gh api`, and apply approved settings fixes.
// Usage:
//   node audit.mjs owner/name [--baseline personal-public|personal-private|team] [--json]
//   node audit.mjs owner/name --apply id1,id2 [--dry-run] [--baseline ...]
// Reads only, unless --apply is given. Never changes visibility, access or history.
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

export const BASELINES = ['personal-public', 'personal-private', 'team'];

// Level per check and baseline: r = required, c = recommended, i = info.
const LEVELS = {
  description: 'cic', topics: 'cii', 'default-branch': 'iii', 'delete-branch-on-merge': 'ccr', 'wiki-off': 'iii',
  'vulnerability-alerts': 'rrr', 'dependabot-security-updates': 'ccr', 'secret-scanning': 'rcr', 'push-protection': 'rcr',
  'code-scanning': 'cic', 'workflow-token-read': 'rrr', 'default-branch-ruleset': 'rcr', 'require-pr': 'iir',
  readme: 'rcr', license: 'ric', 'security-policy': 'cic', codeowners: 'iir', 'dependabot-config': 'ccr', 'ci-workflows': 'iic',
};
const LEVEL_NAMES = { r: 'required', c: 'recommended', i: 'info' };

export function levelOf(id, baseline) {
  return LEVEL_NAMES[LEVELS[id][BASELINES.indexOf(baseline)]];
}

// Run `gh api -i` and return { status, json }. gh prints the status line, headers, a blank line, then the body.
export function parseGhInclude(out) {
  const status = Number((out.match(/^HTTP\/[\d.]+ (\d{3})/m) || [])[1] || 0);
  const split = out.search(/\r?\n\r?\n/);
  const body = split >= 0 ? out.slice(split).trim() : '';
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {}
  return { status, json };
}

export function gh(path, { method = 'GET', body } = {}) {
  const args = ['api', '-i', '-X', method, '-H', 'Accept: application/vnd.github+json', path];
  if (body) args.push('--input', '-');
  return new Promise((resolve) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => resolve({ status: 0, json: null, error: e.message }));
    child.on('close', () => {
      const r = parseGhInclude(Buffer.concat(out).toString());
      resolve({ ...r, error: r.status ? null : Buffer.concat(err).toString().trim() });
    });
    child.stdin.end(body ? JSON.stringify(body) : '');
  });
}

const FILES = ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md', 'CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS',
  '.github/dependabot.yml', '.github/dependabot.yaml', '.github/workflows'];

export async function collect(repo, api = gh) {
  const meta = await api(`repos/${repo}`);
  if (meta.status !== 200) throw new Error(`cannot read ${repo}: HTTP ${meta.status || '?'} ${meta.error || ''}`.trim());
  const r = meta.json;
  const branch = encodeURIComponent(r.default_branch);
  const [vuln, autofix, rulesets, protection, wf, codeScan, readme, ...files] = await Promise.all([
    api(`repos/${repo}/vulnerability-alerts`),
    api(`repos/${repo}/automated-security-fixes`),
    api(`repos/${repo}/rulesets?includes_parents=true`),
    api(`repos/${repo}/branches/${branch}/protection`),
    api(`repos/${repo}/actions/permissions/workflow`),
    api(`repos/${repo}/code-scanning/default-setup`),
    api(`repos/${repo}/readme`),
    ...FILES.map((f) => api(`repos/${repo}/contents/${f}`)),
  ]);
  const rulesetDetails = rulesets.status === 200 && Array.isArray(rulesets.json)
    ? await Promise.all(rulesets.json.slice(0, 10).map((rs) => api(`repos/${repo}/rulesets/${rs.id}`).then((d) => d.json)))
    : [];
  return {
    repo: r, vuln, autofix, rulesets: { status: rulesets.status, list: rulesetDetails.filter(Boolean) }, protection, wf, codeScan, readme,
    files: Object.fromEntries(FILES.map((f, i) => [f, files[i]])),
  };
}

const present = (data, paths) => paths.some((p) => data.files[p]?.status === 200);

function targetsDefault(rs, defaultBranch) {
  const inc = rs.conditions?.ref_name?.include || [];
  return inc.includes('~DEFAULT_BRANCH') || inc.includes('~ALL') || inc.includes(`refs/heads/${defaultBranch}`);
}

export function evaluate(data, baseline) {
  const r = data.repo;
  const isPrivate = Boolean(r.private);
  const sa = r.security_and_analysis || {};
  const active = data.rulesets.list.filter((rs) => rs.enforcement === 'active' && targetsDefault(rs, r.default_branch));
  const ruleTypes = new Set(active.flatMap((rs) => (rs.rules || []).map((x) => x.type)));
  const prot = data.protection.status === 200 ? data.protection.json : null;
  const checks = [];
  const add = (id, title, status, current, wanted, fix, note) => checks.push({ id, title, level: levelOf(id, baseline), status, current, wanted, fix, note });
  const bool = (v) => (v ? 'pass' : 'fail');
  const featureStatus = (f) => (f?.status === 'enabled' ? 'pass' : f?.status === 'disabled' ? 'fail' : isPrivate ? 'n/a' : 'unknown');

  add('description', 'Repo has a description', bool(r.description), r.description || '(none)', 'a one-line description', 'user');
  add('topics', 'Repo has topics', bool((r.topics || []).length), (r.topics || []).join(', ') || '(none)', 'at least one topic', 'user');
  add('default-branch', 'Default branch is main', bool(r.default_branch === 'main'), r.default_branch, 'main', 'user');
  add('delete-branch-on-merge', 'Head branches deleted after merge', bool(r.delete_branch_on_merge), String(Boolean(r.delete_branch_on_merge)), 'true', 'api');
  add('wiki-off', 'Wiki is off', bool(!r.has_wiki), String(Boolean(r.has_wiki)), 'false', 'api');
  add('vulnerability-alerts', 'Dependabot alerts on', data.vuln.status === 204 ? 'pass' : data.vuln.status === 404 ? 'fail' : 'unknown', `HTTP ${data.vuln.status}`, 'enabled', 'api');
  add('dependabot-security-updates', 'Dependabot security updates on', data.autofix.status === 200 ? bool(data.autofix.json?.enabled) : 'unknown',
    data.autofix.status === 200 ? String(Boolean(data.autofix.json?.enabled)) : `HTTP ${data.autofix.status}`, 'true', 'api');
  add('secret-scanning', 'Secret scanning on', featureStatus(sa.secret_scanning), sa.secret_scanning?.status || '(not offered)', 'enabled', 'api');
  add('push-protection', 'Secret push protection on', featureStatus(sa.secret_scanning_push_protection), sa.secret_scanning_push_protection?.status || '(not offered)', 'enabled', 'api');
  const cs = data.codeScan;
  add('code-scanning', 'CodeQL default setup configured', cs.status === 200 ? bool(cs.json?.state === 'configured') : (cs.status === 403 || cs.status === 404) && isPrivate ? 'n/a' : 'unknown',
    cs.status === 200 ? cs.json?.state : `HTTP ${cs.status}`, 'configured', 'api');
  add('workflow-token-read', 'Actions token read-only, cannot approve PRs',
    data.wf.status === 200 ? bool(data.wf.json?.default_workflow_permissions === 'read' && !data.wf.json?.can_approve_pull_request_reviews) : 'unknown',
    data.wf.status === 200 ? `${data.wf.json?.default_workflow_permissions}, approve=${Boolean(data.wf.json?.can_approve_pull_request_reviews)}` : `HTTP ${data.wf.status}`,
    'read, approve=false', 'api');
  const rulesetOk = (ruleTypes.has('deletion') && ruleTypes.has('non_fast_forward'))
    || (prot && !prot.allow_force_pushes?.enabled && !prot.allow_deletions?.enabled);
  const rulesUnavailable = data.rulesets.status === 403 || (isPrivate && data.protection.status === 403);
  add('default-branch-ruleset', 'Default branch blocks force-push and deletion', rulesetOk ? 'pass' : rulesUnavailable ? 'n/a' : 'fail',
    active.length ? `rulesets: ${active.map((x) => x.name).join(', ')}` : prot ? 'classic protection' : '(none)', 'deletion + non_fast_forward', 'api');
  const prOk = ruleTypes.has('pull_request') || Boolean(prot?.required_pull_request_reviews);
  add('require-pr', 'Default branch needs a reviewed PR', prOk ? 'pass' : rulesUnavailable ? 'n/a' : 'fail', prOk ? 'yes' : 'no', 'pull_request rule', 'api');
  add('readme', 'README exists', bool(data.readme.status === 200), data.readme.status === 200 ? 'present' : 'missing', 'present', 'pr');
  add('license', 'LICENSE exists', bool(r.license), r.license?.spdx_id || 'missing', 'present', 'pr');
  add('security-policy', 'SECURITY.md exists', bool(present(data, ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md'])), '', 'present', 'pr');
  add('codeowners', 'CODEOWNERS exists', bool(present(data, ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'])), '', 'present', 'pr');
  add('dependabot-config', 'dependabot.yml exists', bool(present(data, ['.github/dependabot.yml', '.github/dependabot.yaml'])), '', 'present', 'pr');
  const wfs = data.files['.github/workflows'];
  add('ci-workflows', 'At least one Actions workflow', bool(wfs?.status === 200 && Array.isArray(wfs.json) && wfs.json.length), wfs?.status === 200 ? `${wfs.json.length} file(s)` : 'none', '1+', 'pr');
  return checks;
}

// API calls for each fix the script can apply.
export function fixRequests(id, repo, baseline) {
  const pr = { type: 'pull_request', parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: false, required_review_thread_resolution: true } };
  const ruleset = (withPr) => ({
    method: 'POST', path: `repos/${repo}/rulesets`,
    body: { name: 'default-branch', target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, ...(withPr ? [pr] : [])] },
  });
  const table = {
    'delete-branch-on-merge': [{ method: 'PATCH', path: `repos/${repo}`, body: { delete_branch_on_merge: true } }],
    'wiki-off': [{ method: 'PATCH', path: `repos/${repo}`, body: { has_wiki: false } }],
    'vulnerability-alerts': [{ method: 'PUT', path: `repos/${repo}/vulnerability-alerts` }],
    'dependabot-security-updates': [{ method: 'PUT', path: `repos/${repo}/automated-security-fixes` }],
    'secret-scanning': [{ method: 'PATCH', path: `repos/${repo}`, body: { security_and_analysis: { secret_scanning: { status: 'enabled' } } } }],
    'push-protection': [{ method: 'PATCH', path: `repos/${repo}`, body: { security_and_analysis: { secret_scanning_push_protection: { status: 'enabled' } } } }],
    'code-scanning': [{ method: 'PATCH', path: `repos/${repo}/code-scanning/default-setup`, body: { state: 'configured' } }],
    'workflow-token-read': [{ method: 'PUT', path: `repos/${repo}/actions/permissions/workflow`, body: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } }],
    'default-branch-ruleset': [ruleset(baseline === 'team')],
    'require-pr': [ruleset(true)],
  };
  return table[id] || null;
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--dry-run') o[a.slice(2)] = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

function table(checks) {
  const rows = [['status', 'level', 'check', 'current', 'fix']];
  for (const c of checks) rows.push([c.status.toUpperCase(), c.level, c.id, String(c.current ?? '').slice(0, 40), c.status === 'fail' || c.status === 'unknown' ? c.fix : '']);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd()).join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const repo = o._[0];
  const baseline = o.baseline || null;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || (baseline && !BASELINES.includes(baseline))) {
    console.error(`usage: audit.mjs owner/name [--baseline ${BASELINES.join('|')}] [--json] [--apply id1,id2 [--dry-run]]`);
    return 2;
  }
  const before = await collect(repo);
  const base = baseline || (before.repo.private ? 'personal-private' : 'personal-public');
  const checks = evaluate(before, base);

  if (o.apply) {
    const ids = o.apply.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = ids.filter((id) => !fixRequests(id, repo, base));
    if (unknown.length) {
      console.error(`not applicable by this script: ${unknown.join(', ')} (see the fix column: pr = pull request, user = needs you)`);
      return 2;
    }
    for (const id of ids) {
      for (const req of fixRequests(id, repo, base)) {
        const line = `${req.method} ${req.path}${req.body ? ` ${JSON.stringify(req.body)}` : ''}`;
        if (o['dry-run']) { console.log(`would: ${line}`); continue; }
        const res = await gh(req.path, req);
        console.log(`${res.status >= 200 && res.status < 300 ? 'ok  ' : 'FAIL'} ${line} -> HTTP ${res.status}${res.json?.message ? ` ${res.json.message}` : ''}`);
      }
    }
    if (o['dry-run']) return 0;
    const after = evaluate(await collect(repo), base);
    for (const id of ids) {
      const b = checks.find((c) => c.id === id);
      const a = after.find((c) => c.id === id);
      console.log(`${id}: ${b.status} -> ${a.status}`);
    }
    return 0;
  }

  if (o.json) console.log(JSON.stringify({ repo, baseline: base, visibility: before.repo.visibility, checks }, null, 2));
  else {
    console.log(`${repo} (${before.repo.visibility}, default branch ${before.repo.default_branch}) against ${base}\n`);
    console.log(table(checks));
    const failing = checks.filter((c) => c.status === 'fail' && c.level !== 'info');
    console.log(`\n${failing.filter((c) => c.level === 'required').length} required and ${failing.filter((c) => c.level === 'recommended').length} recommended checks fail.`);
    const api = failing.filter((c) => c.fix === 'api').map((c) => c.id);
    if (api.length) console.log(`Script can apply: --apply ${api.join(',')}`);
  }
  return 0;
}

if (basename(process.argv[1] || '') === 'audit.mjs') main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
