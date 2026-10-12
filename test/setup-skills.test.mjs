// Offline tests for the github-setup and cloud-setup audit scripts, using fixture API data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collect as collectGcp, commands, evaluate as evaluateGcp } from '../skills/cloud-setup/scripts/audit-gcp.mjs';
import { BASELINES, evaluate as evaluateGh, fixRequests, levelOf, parseGhInclude } from '../skills/github-setup/scripts/audit.mjs';

const ok = (json, status = 200) => ({ status, json });
const missing = { status: 404, json: { message: 'Not Found' } };

function ghData(overrides = {}) {
  return {
    repo: { private: false, visibility: 'public', default_branch: 'main', description: 'x', topics: ['a'], delete_branch_on_merge: true, has_wiki: false,
      license: { spdx_id: 'MIT' }, security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } },
    vuln: { status: 204, json: null }, autofix: ok({ enabled: true }),
    rulesets: { status: 200, list: [{ name: 'default-branch', enforcement: 'active', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } }, rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }] }] },
    protection: missing, wf: ok({ default_workflow_permissions: 'read', can_approve_pull_request_reviews: false }), codeScan: ok({ state: 'configured' }), readme: ok({}),
    files: { 'SECURITY.md': ok({}), '.github/dependabot.yml': ok({}), '.github/workflows': ok([{ name: 'ci.yml' }]), CODEOWNERS: missing },
    ...overrides,
  };
}

test('github: parseGhInclude reads the status line and JSON body', () => {
  assert.deepEqual(parseGhInclude('HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"a":1}'), { status: 200, json: { a: 1 } });
  assert.deepEqual(parseGhInclude('HTTP/2.0 204 No Content\nX: y\n\n'), { status: 204, json: null });
});

test('github: a well-set public repo passes every required check', () => {
  const checks = evaluateGh(ghData(), 'personal-public');
  const failing = checks.filter((c) => c.level === 'required' && c.status !== 'pass');
  assert.deepEqual(failing.map((c) => c.id), []);
  assert.equal(checks.find((c) => c.id === 'codeowners').status, 'fail');
  assert.equal(checks.find((c) => c.id === 'codeowners').level, 'info');
});

test('github: private repo without paid features reports n/a, not fail', () => {
  const d = ghData({ repo: { ...ghData().repo, private: true, visibility: 'private', security_and_analysis: {} }, codeScan: { status: 403, json: {} },
    rulesets: { status: 403, list: [] }, protection: { status: 403, json: {} } });
  const by = Object.fromEntries(evaluateGh(d, 'personal-private').map((c) => [c.id, c]));
  for (const id of ['secret-scanning', 'push-protection', 'code-scanning', 'default-branch-ruleset']) assert.equal(by[id].status, 'n/a', id);
});

test('github: write-capable workflow token and missing alerts fail', () => {
  const d = ghData({ wf: ok({ default_workflow_permissions: 'write', can_approve_pull_request_reviews: false }), vuln: missing, rulesets: { status: 200, list: [] } });
  const by = Object.fromEntries(evaluateGh(d, 'team').map((c) => [c.id, c]));
  assert.equal(by['workflow-token-read'].status, 'fail');
  assert.equal(by['vulnerability-alerts'].status, 'fail');
  assert.equal(by['default-branch-ruleset'].status, 'fail');
  assert.equal(by['require-pr'].level, 'required');
});

test('github: classic branch protection also satisfies the ruleset check', () => {
  const d = ghData({ rulesets: { status: 200, list: [] }, protection: ok({ allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } }) });
  assert.equal(evaluateGh(d, 'personal-public').find((c) => c.id === 'default-branch-ruleset').status, 'pass');
});

test('github: fixes are exact API calls; team ruleset adds a PR rule; files are not API fixes', () => {
  assert.deepEqual(fixRequests('vulnerability-alerts', 'o/r', 'personal-public'), [{ method: 'PUT', path: 'repos/o/r/vulnerability-alerts' }]);
  const personal = fixRequests('default-branch-ruleset', 'o/r', 'personal-public')[0].body.rules.map((r) => r.type);
  const team = fixRequests('default-branch-ruleset', 'o/r', 'team')[0].body.rules.map((r) => r.type);
  assert.deepEqual(personal, ['deletion', 'non_fast_forward']);
  assert.deepEqual(team, ['deletion', 'non_fast_forward', 'pull_request']);
  assert.equal(fixRequests('readme', 'o/r', 'team'), null);
  assert.equal(fixRequests('description', 'o/r', 'team'), null);
  for (const b of BASELINES) assert.ok(['required', 'recommended', 'info'].includes(levelOf('license', b)));
});

function gcpData(overrides = {}) {
  return {
    project: 'demo-project', config: ok({}), proj: { ok: true, json: { lifecycleState: 'ACTIVE', projectNumber: '123', labels: { env: 'dev' } } },
    billing: { ok: true, json: { billingEnabled: true, billingAccountName: 'billingAccounts/AAA' } },
    budgets: { ok: true, json: [{ budgetFilter: { projects: ['projects/123'] } }] },
    enabled: ['compute.googleapis.com', 'storage.googleapis.com'],
    iam: { ok: true, json: { bindings: [{ role: 'roles/owner', members: ['user:a@example.com'] }], auditConfigs: [{ service: 'allServices' }] } },
    keys: [{ email: 'sa@demo-project.iam.gserviceaccount.com', ok: true, json: [] }],
    firewall: { ok: true, json: [{ name: 'internal', direction: 'INGRESS', sourceRanges: ['10.0.0.0/8'], allowed: [{ IPProtocol: 'tcp', ports: ['22'] }] }] },
    buckets: { ok: true, json: [{ name: 'b1', uniform_bucket_level_access: true, public_access_prevention: 'enforced' }] },
    bucketIam: [{ name: 'b1', ok: true, json: { bindings: [{ role: 'roles/storage.objectViewer', members: ['projectViewer:demo-project'] }] } }],
    truncated: { buckets: false, serviceAccounts: false },
    ...overrides,
  };
}

test('gcp: a clean project passes all required checks', () => {
  const failing = evaluateGcp(gcpData()).filter((c) => c.level !== 'info' && c.status !== 'pass');
  assert.deepEqual(failing.map((c) => c.id), []);
});

test('gcp: public IAM, SA editor, open SSH, public bucket and old keys are caught', () => {
  const now = new Date('2026-10-12T00:00:00Z');
  const d = gcpData({
    iam: { ok: true, json: { bindings: [
      { role: 'roles/editor', members: ['serviceAccount:123-compute@developer.gserviceaccount.com'] },
      { role: 'roles/viewer', members: ['allUsers'] },
    ] } },
    keys: [{ email: 'ci@demo-project.iam.gserviceaccount.com', ok: true, json: [{ name: 'projects/p/serviceAccounts/x/keys/abcdef1234', validAfterTime: '2026-01-01T00:00:00Z' }] }],
    firewall: { ok: true, json: [
      { name: 'default-allow-ssh', direction: 'INGRESS', sourceRanges: ['0.0.0.0/0'], allowed: [{ IPProtocol: 'tcp', ports: ['22'] }] },
      { name: 'range', direction: 'INGRESS', sourceRanges: ['0.0.0.0/0'], allowed: [{ IPProtocol: 'tcp', ports: ['3000-4000'] }] },
      { name: 'web', direction: 'INGRESS', sourceRanges: ['0.0.0.0/0'], allowed: [{ IPProtocol: 'tcp', ports: ['443'] }] },
      { name: 'off', direction: 'INGRESS', disabled: true, sourceRanges: ['0.0.0.0/0'], allowed: [{ IPProtocol: 'all' }] },
    ] },
    buckets: { ok: true, json: [{ name: 'b1', iamConfiguration: { uniformBucketLevelAccess: { enabled: false }, publicAccessPrevention: 'inherited' } }] },
    bucketIam: [{ name: 'b1', ok: true, json: { bindings: [{ role: 'roles/storage.objectViewer', members: ['allUsers'] }] } }],
    budgets: { ok: true, json: [{ budgetFilter: { projects: ['projects/999'] } }] },
  });
  const by = Object.fromEntries(evaluateGcp(d, { now }).map((c) => [c.id, c]));
  for (const id of ['no-public-iam', 'no-primitive-sa', 'sa-user-keys', 'sa-key-age', 'firewall-open-admin', 'bucket-public', 'bucket-uniform-access', 'bucket-public-access-prevention', 'budget-alert']) {
    assert.equal(by[id].status, 'fail', id);
  }
  assert.match(by['firewall-open-admin'].current, /default-allow-ssh \(tcp:22\); range \(tcp:3389\)/);
  assert.doesNotMatch(by['firewall-open-admin'].current, /web|off/);
  assert.match(by['bucket-public'].fix, /remove-iam-policy-binding gs:\/\/b1 --member=allUsers/);
});

test('gcp: missing permissions are unknown, never pass', () => {
  const d = gcpData({ iam: { ok: false, error: 'PERMISSION_DENIED' }, budgets: { ok: false, error: 'PERMISSION_DENIED' }, firewall: { ok: false, error: 'denied' } });
  const by = Object.fromEntries(evaluateGcp(d).map((c) => [c.id, c]));
  assert.equal(by['no-public-iam'].status, 'unknown');
  assert.equal(by['budget-alert'].status, 'unknown');
  assert.equal(by['firewall-open-admin'].status, 'unknown');
});

test('gcp: only read-only gcloud verbs are ever issued', async () => {
  const c = commands('demo-project');
  const all = Object.values(c).map((v) => (typeof v === 'function' ? v('X') : v));
  const verbs = all.map((a) => a.find((w) => ['list', 'describe', 'get-iam-policy'].includes(w)));
  assert.ok(verbs.every(Boolean), JSON.stringify(all));
  const issued = [];
  const fake = async (args) => {
    issued.push(args);
    if (args[0] === 'projects' && args[1] === 'describe') return { ok: true, json: { lifecycleState: 'ACTIVE', projectNumber: '1' } };
    if (args[0] === 'services') return { ok: true, json: [{ config: { name: 'storage.googleapis.com' } }] };
    if (args[0] === 'storage' && args[2] === 'list') return { ok: true, json: [{ name: 'b1' }] };
    if (args[0] === 'iam' && args[2] === 'list') return { ok: true, json: [{ email: 'sa@x' }] };
    return { ok: true, json: args[0] === 'billing' ? { billingEnabled: false } : {} };
  };
  await collectGcp('demo-project', fake);
  for (const args of issued) assert.ok(args.some((w) => ['list', 'describe', 'get-iam-policy'].includes(w)), args.join(' '));
  assert.ok(!issued.some((a) => a[0] === 'compute'), 'compute API is off, so no firewall call');
});
