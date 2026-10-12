// The scanner plan picks jobs from the files present and keeps network tools labeled.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plan } from '../skills/security/scripts/scanners.mjs';

const survey = { lockfiles: ['/r/web/package-lock.json'], requirements: [], gomods: [], dockerfiles: ['/r/Dockerfile'], python: false, workflows: true };

test('scanner plan: jobs follow the survey; network flags are set', () => {
  const byTool = Object.fromEntries(plan('/r', '/out', survey).map((s) => [s.label || s.tool, s]));
  assert.equal(byTool['npm-audit'].jobs().length, 1);
  assert.equal(byTool['npm-audit'].jobs()[0].cwd, '/r/web');
  assert.equal(byTool['pip-audit'].jobs().length, 0);
  assert.equal(byTool.bandit.jobs().length, 0);
  assert.equal(byTool.hadolint.jobs().length, 1);
  assert.ok(byTool.zizmor.jobs()[0].args.includes('--offline'));
  assert.ok(byTool.trufflehog.jobs()[0].args.includes('--no-verification'), 'never send found secrets out to verify them');
  assert.ok(byTool.gitleaks.jobs()[0].args.includes('--redact'));
  for (const name of ['semgrep', 'osv-scanner', 'npm-audit', 'pip-audit', 'trivy', 'govulncheck']) assert.equal(byTool[name].network, true, name);
  for (const name of ['gitleaks', 'trufflehog', 'bandit', 'zizmor', 'hadolint']) assert.equal(byTool[name].network, false, name);
});
