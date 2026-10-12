#!/usr/bin/env node
// Read-only audit of a Google Cloud project. Runs only describe/list/get commands; prints suggested fixes, never runs them.
// Usage: node audit-gcp.mjs <project-id> [--configuration NAME] [--shell bash] [--max-buckets 50] [--domain example.com] [--json] [--print-commands]
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

const OPEN = ['0.0.0.0/0', '::/0'];
const ADMIN_PORTS = ['22', '3389'];
const PUBLIC_MEMBERS = ['allUsers', 'allAuthenticatedUsers'];
const KEY_MAX_AGE_DAYS = 90;

function which(name) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  return null;
}

// The exact read-only commands, so --print-commands and the runner agree.
export function commands(project) {
  const p = ['--project', project, '--format=json'];
  return {
    config: ['config', 'list', '--format=json'],
    project: ['projects', 'describe', project, '--format=json'],
    billing: ['billing', 'projects', 'describe', project, '--format=json'],
    budgets: (account) => ['billing', 'budgets', 'list', `--billing-account=${account}`, '--format=json'],
    services: ['services', 'list', '--enabled', ...p],
    iam: ['projects', 'get-iam-policy', project, '--format=json'],
    serviceAccounts: ['iam', 'service-accounts', 'list', ...p],
    keys: (email) => ['iam', 'service-accounts', 'keys', 'list', `--iam-account=${email}`, '--managed-by=user', ...p],
    firewall: ['compute', 'firewall-rules', 'list', ...p],
    buckets: ['storage', 'buckets', 'list', ...p],
    bucketIam: (name) => ['storage', 'buckets', 'get-iam-policy', `gs://${name}`, ...p],
  };
}

export function makeRunner({ shell, configuration } = {}) {
  const gcloud = which('gcloud') || 'gcloud';
  return (args) => new Promise((resolve) => {
    const full = configuration ? [...args, `--configuration=${configuration}`, '--quiet'] : [...args, '--quiet'];
    const child = shell ? spawn(shell, [gcloud, ...full]) : spawn(gcloud, full);
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', (code, signal) => {
      const text = Buffer.concat(out).toString();
      let json = null;
      try {
        json = text.trim() ? JSON.parse(text) : [];
      } catch {}
      const error = code === 0 ? null : (Buffer.concat(err).toString().trim().split('\n').pop() || `exit ${code ?? signal}`);
      resolve({ ok: code === 0 && json !== null, json, error });
    });
  });
}

export async function collect(project, run, { maxBuckets = 50, maxServiceAccounts = 30 } = {}) {
  const c = commands(project);
  const [config, proj, billing, services, iam, sas] = await Promise.all([c.config, c.project, c.billing, c.services, c.iam, c.serviceAccounts].map(run));
  if (!proj.ok) throw new Error(`cannot read project ${project}: ${proj.error}`);
  const enabled = new Set((services.json || []).map((s) => s.config?.name || String(s.name).split('/').pop()));
  const account = billing.ok && billing.json?.billingAccountName ? billing.json.billingAccountName.split('/').pop() : null;
  const budgets = account ? await run(c.budgets(account)) : { ok: false, error: 'no billing account visible' };
  const saList = (sas.json || []).slice(0, maxServiceAccounts);
  const keys = await Promise.all(saList.map((sa) => run(c.keys(sa.email)).then((r) => ({ email: sa.email, ...r }))));
  const firewall = enabled.has('compute.googleapis.com') ? await run(c.firewall) : { ok: true, json: [], skipped: 'compute API off' };
  const buckets = enabled.has('storage.googleapis.com') || enabled.has('storage-component.googleapis.com') ? await run(c.buckets) : { ok: true, json: [], skipped: 'storage API off' };
  const bucketList = (buckets.json || []).slice(0, maxBuckets);
  const bucketIam = await Promise.all(bucketList.map((b) => run(c.bucketIam(bucketName(b))).then((r) => ({ name: bucketName(b), ...r }))));
  return { project, config, proj, billing, budgets, services, enabled: [...enabled], iam, sas, keys, firewall, buckets, bucketIam, truncated: { buckets: (buckets.json || []).length > maxBuckets, serviceAccounts: (sas.json || []).length > maxServiceAccounts } };
}

const bucketName = (b) => b.name || String(b.storage_url || '').replace(/^gs:\/\//, '').replace(/\/$/, '');
const ubla = (b) => b.uniform_bucket_level_access ?? b.iamConfiguration?.uniformBucketLevelAccess?.enabled;
const pap = (b) => b.public_access_prevention ?? b.iamConfiguration?.publicAccessPrevention;

function portsOpen(rule) {
  const hits = [];
  for (const a of rule.allowed || []) {
    const proto = a.IPProtocol || a.ipProtocol;
    if (proto === 'all') hits.push('all');
    else if (proto === 'tcp') {
      if (!a.ports || !a.ports.length) hits.push('tcp:all');
      for (const port of a.ports || []) {
        const [lo, hi] = String(port).split('-').map(Number);
        for (const admin of ADMIN_PORTS) if (Number(admin) >= lo && Number(admin) <= (hi || lo)) hits.push(`tcp:${admin}`);
      }
    }
  }
  return hits;
}

export function evaluate(data, { now = new Date(), domain } = {}) {
  const checks = [];
  const add = (id, title, level, status, current, fix) => checks.push({ id, title, level, status, current, fix: status === 'pass' ? null : fix });
  const P = data.project;
  const pj = data.proj.json || {};
  const bindings = data.iam.ok ? data.iam.json.bindings || [] : null;

  add('project-active', 'Project is active', 'required', pj.lifecycleState === 'ACTIVE' ? 'pass' : 'fail', pj.lifecycleState || '?', null);
  add('billing', 'Billing state is known', 'info', data.billing.ok ? 'pass' : 'unknown',
    data.billing.ok ? `enabled=${Boolean(data.billing.json.billingEnabled)}` : data.billing.error, null);

  const projectRef = `projects/${pj.projectNumber}`;
  const covering = data.budgets.ok ? (data.budgets.json || []).filter((b) => {
    const ps = b.budgetFilter?.projects;
    return !ps || !ps.length || ps.includes(projectRef) || ps.includes(`projects/${P}`);
  }) : [];
  const billed = data.billing.ok && data.billing.json.billingEnabled;
  add('budget-alert', 'A budget with alerts covers the project', billed ? 'required' : 'info',
    !data.budgets.ok ? 'unknown' : covering.length ? 'pass' : 'fail',
    data.budgets.ok ? `${covering.length} budget(s)` : data.budgets.error,
    `gcloud billing budgets create --billing-account=ACCOUNT --display-name="${P} monthly" --budget-amount=AMOUNT --filter-projects=${projectRef} --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0`);

  if (!bindings) {
    for (const id of ['no-public-iam', 'no-primitive-sa', 'owners', 'external-members']) add(id, 'IAM policy readable', 'required', 'unknown', data.iam.error, null);
  } else {
    const pub = bindings.flatMap((b) => b.members.filter((m) => PUBLIC_MEMBERS.includes(m)).map((m) => `${m} ${b.role}`));
    add('no-public-iam', 'No allUsers/allAuthenticatedUsers on the project', 'required', pub.length ? 'fail' : 'pass', pub.join('; ') || 'none',
      pub.map((x) => { const [m, r] = x.split(' '); return `gcloud projects remove-iam-policy-binding ${P} --member=${m} --role=${r}`; }).join(' && '));
    const prim = bindings.filter((b) => ['roles/owner', 'roles/editor'].includes(b.role))
      .flatMap((b) => b.members.filter((m) => m.startsWith('serviceAccount:')).map((m) => `${m} ${b.role}`));
    add('no-primitive-sa', 'No Owner/Editor on service accounts', 'required', prim.length ? 'fail' : 'pass', prim.join('; ') || 'none',
      'grant narrower roles first, check the workload, then: gcloud projects remove-iam-policy-binding ' + P + ' --member=serviceAccount:EMAIL --role=ROLE');
    const owners = bindings.filter((b) => b.role === 'roles/owner').flatMap((b) => b.members);
    add('owners', 'Owners are few and known', 'info', owners.length > 3 ? 'fail' : 'pass', owners.join(', ') || 'none', 'review the list with the user');
    const domains = [...new Set(bindings.flatMap((b) => b.members).filter((m) => m.startsWith('user:')).map((m) => m.split('@')[1]))];
    const outside = domain ? domains.filter((d) => d !== domain) : [];
    add('external-members', domain ? `All users are from ${domain}` : 'User domains (pass --domain to check)', domain ? 'recommended' : 'info',
      domain ? (outside.length ? 'fail' : 'pass') : 'pass', (domain ? outside : domains).join(', ') || 'none', 'review outside members with the user');
    const auditCfg = (data.iam.json.auditConfigs || []).some((a) => a.service === 'allServices');
    add('data-access-logs', 'Data-access audit logs on for all services', 'info', auditCfg ? 'pass' : 'fail', auditCfg ? 'allServices' : 'defaults only',
      'enable in IAM > Audit Logs (adds log volume and cost)');
  }

  const keyRows = data.keys.filter((k) => k.ok).flatMap((k) => (k.json || []).map((key) => {
    const ageDays = key.validAfterTime ? Math.floor((now - new Date(key.validAfterTime)) / 86400000) : null;
    return { email: k.email, id: String(key.name).split('/').pop(), ageDays };
  }));
  const keysUnknown = data.keys.some((k) => !k.ok);
  add('sa-user-keys', 'No user-managed service-account keys', 'recommended', keyRows.length ? 'fail' : keysUnknown ? 'unknown' : 'pass',
    keyRows.map((k) => `${k.email} ${k.id.slice(0, 8)}… ${k.ageDays ?? '?'}d`).join('; ') || 'none',
    'move the workload to workload identity federation or an attached service account, check key use, then: gcloud iam service-accounts keys delete KEY_ID --iam-account=EMAIL --project=' + P);
  const old = keyRows.filter((k) => k.ageDays != null && k.ageDays > KEY_MAX_AGE_DAYS);
  add('sa-key-age', `No keys older than ${KEY_MAX_AGE_DAYS} days`, 'required', old.length ? 'fail' : keysUnknown ? 'unknown' : 'pass',
    old.map((k) => `${k.email} ${k.ageDays}d`).join('; ') || 'none', 'rotate or remove (see sa-user-keys)');

  if (data.firewall.skipped) add('firewall-open-admin', 'No admin ports open to the internet', 'required', 'pass', data.firewall.skipped, null);
  else if (!data.firewall.ok) add('firewall-open-admin', 'No admin ports open to the internet', 'required', 'unknown', data.firewall.error, null);
  else {
    const open = (data.firewall.json || []).filter((r) => (r.direction || 'INGRESS') === 'INGRESS' && !r.disabled && (r.sourceRanges || []).some((s) => OPEN.includes(s)))
      .map((r) => ({ name: r.name, ports: portsOpen(r) })).filter((r) => r.ports.length);
    add('firewall-open-admin', 'No admin ports open to the internet', 'required', open.length ? 'fail' : 'pass', open.map((r) => `${r.name} (${r.ports.join(',')})`).join('; ') || 'none',
      'limit sources, for example to IAP (35.235.240.0/20) for SSH: gcloud compute firewall-rules update RULE --source-ranges=35.235.240.0/20 --project=' + P);
  }

  if (data.buckets.skipped) {
    add('bucket-public', 'No public buckets', 'required', 'pass', data.buckets.skipped, null);
  } else if (!data.buckets.ok) {
    add('bucket-public', 'No public buckets', 'required', 'unknown', data.buckets.error, null);
  } else {
    const pub = data.bucketIam.filter((b) => b.ok).flatMap((b) => (b.json.bindings || []).flatMap((x) => x.members.filter((m) => PUBLIC_MEMBERS.includes(m)).map((m) => ({ name: b.name, member: m, role: x.role }))));
    add('bucket-public', 'No public buckets', 'required', pub.length ? 'fail' : data.bucketIam.some((b) => !b.ok) ? 'unknown' : 'pass',
      pub.map((p) => `${p.name}: ${p.member} ${p.role}`).join('; ') || 'none',
      pub.map((p) => `gcloud storage buckets remove-iam-policy-binding gs://${p.name} --member=${p.member} --role=${p.role}`).join(' && '));
    const list = data.buckets.json || [];
    const noUbla = list.filter((b) => ubla(b) === false).map(bucketName);
    add('bucket-uniform-access', 'Buckets use uniform bucket-level access', 'recommended', noUbla.length ? 'fail' : 'pass', noUbla.join(', ') || 'all',
      noUbla.map((n) => `gcloud storage buckets update gs://${n} --uniform-bucket-level-access`).join(' && '));
    const noPap = list.filter((b) => pap(b) && pap(b) !== 'enforced').map(bucketName);
    add('bucket-public-access-prevention', 'Buckets enforce public-access prevention', 'recommended', noPap.length ? 'fail' : 'pass', noPap.join(', ') || 'all',
      noPap.map((n) => `gcloud storage buckets update gs://${n} --public-access-prevention`).join(' && '));
  }

  add('labels', 'Project has labels', 'info', Object.keys(pj.labels || {}).length ? 'pass' : 'fail',
    Object.entries(pj.labels || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'none', `gcloud projects update ${P} --update-labels=env=ENV,owner=OWNER`);
  add('enabled-apis', 'Enabled APIs (review for unused ones)', 'info', 'pass', `${data.enabled.length}: ${data.enabled.slice(0, 12).join(', ')}${data.enabled.length > 12 ? ', …' : ''}`, null);
  if (data.truncated.buckets || data.truncated.serviceAccounts) add('coverage', 'Audit covered every resource', 'info', 'fail', JSON.stringify(data.truncated), 'raise --max-buckets');
  return checks;
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--json', '--print-commands'].includes(a)) o[a.slice(2)] = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const project = o._[0];
  if (!project || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) {
    console.error('usage: audit-gcp.mjs <project-id> [--configuration NAME] [--shell bash] [--max-buckets 50] [--domain example.com] [--json] [--print-commands]');
    return 2;
  }
  if (o['print-commands']) {
    const c = commands(project);
    for (const [k, v] of Object.entries(c)) console.log(`gcloud ${(typeof v === 'function' ? v(k === 'budgets' ? 'BILLING_ACCOUNT' : k === 'keys' ? 'SA_EMAIL' : 'BUCKET') : v).join(' ')}`);
    return 0;
  }
  const run = makeRunner({ shell: o.shell, configuration: o.configuration });
  const data = await collect(project, run, { maxBuckets: Number(o['max-buckets'] || 50) });
  const who = data.config.ok ? `${data.config.json.core?.account ?? '?'} (configuration project: ${data.config.json.core?.project ?? 'none'})` : 'unknown identity';
  const checks = evaluate(data, { domain: o.domain });
  if (o.json) {
    console.log(JSON.stringify({ project, identity: who, checks }, null, 2));
    return 0;
  }
  console.log(`Project ${project}, read as ${who}\n`);
  for (const c of checks) {
    console.log(`${c.status.toUpperCase().padEnd(7)} ${c.level.padEnd(11)} ${c.id.padEnd(32)} ${String(c.current ?? '').slice(0, 90)}`);
    if (c.fix && c.status !== 'pass') console.log(`${' '.repeat(52)}fix (review first): ${c.fix.slice(0, 220)}`);
  }
  const failing = checks.filter((c) => c.status === 'fail' && c.level !== 'info');
  console.log(`\n${failing.length} failing checks, ${checks.filter((c) => c.status === 'unknown').length} unknown. Nothing was changed.`);
  return 0;
}

if (basename(process.argv[1] || '') === 'audit-gcp.mjs') main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
