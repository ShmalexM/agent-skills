# Baselines

`scripts/audit.mjs` checks these. Level: **required** fails the baseline; **recommended** is shown as a fail but is a judgment call; **info** is reported only.

| Check ID | What it checks | personal-public | personal-private | team |
|---|---|---|---|---|
| `description` | The repo has a description | recommended | info | recommended |
| `topics` | The repo has at least one topic | recommended | info | info |
| `default-branch` | The default branch is `main` | info | info | info |
| `delete-branch-on-merge` | Head branches are deleted after merge | recommended | recommended | required |
| `wiki-off` | The wiki is off (docs live in the repo) | info | info | info |
| `vulnerability-alerts` | Dependabot alerts are on | required | required | required |
| `dependabot-security-updates` | Dependabot opens security-fix PRs | recommended | recommended | required |
| `secret-scanning` | Secret scanning is on | required | recommended (paid on private) | required |
| `push-protection` | Pushes containing secrets are blocked | required | recommended (paid on private) | required |
| `code-scanning` | CodeQL default setup is configured | recommended | info (paid on private) | recommended |
| `workflow-token-read` | The Actions `GITHUB_TOKEN` is read-only by default and cannot approve PRs | required | required | required |
| `default-branch-ruleset` | The default branch blocks force-pushes and deletion | required | recommended (paid on private) | required |
| `require-pr` | Changes to the default branch need a reviewed PR | info | info | required |
| `readme` | A README exists | required | recommended | required |
| `license` | A LICENSE exists | required | info | recommended |
| `security-policy` | SECURITY.md exists | recommended | info | recommended |
| `codeowners` | CODEOWNERS exists | info | info | required |
| `dependabot-config` | `.github/dependabot.yml` exists (version updates) | recommended | recommended | required |
| `ci-workflows` | At least one Actions workflow exists | info | info | recommended |

"Paid on private": on the free plan, GitHub does not offer these features, or does not enforce them, on private repositories. The audit marks them n/a when the API says the feature is unavailable.

## What `--apply` does

| Check ID | API call |
|---|---|
| `delete-branch-on-merge` | `PATCH repos/{repo}` with `delete_branch_on_merge: true` |
| `wiki-off` | `PATCH repos/{repo}` with `has_wiki: false` |
| `vulnerability-alerts` | `PUT repos/{repo}/vulnerability-alerts` |
| `dependabot-security-updates` | `PUT repos/{repo}/automated-security-fixes` |
| `secret-scanning` | `PATCH repos/{repo}` with `security_and_analysis.secret_scanning.status: enabled` |
| `push-protection` | `PATCH repos/{repo}` with `security_and_analysis.secret_scanning_push_protection.status: enabled` |
| `code-scanning` | `PATCH repos/{repo}/code-scanning/default-setup` with `state: configured` |
| `workflow-token-read` | `PUT repos/{repo}/actions/permissions/workflow` with `default_workflow_permissions: read`, `can_approve_pull_request_reviews: false` |
| `default-branch-ruleset`, `require-pr` | `POST repos/{repo}/rulesets`: a ruleset named `default-branch` on `~DEFAULT_BRANCH` with `deletion` and `non_fast_forward` rules; for `team` (or when `require-pr` is applied) also a `pull_request` rule with 1 approval, code-owner review and stale-review dismissal |

A solo owner cannot approve their own pull request. Do not add `require-pr` to a personal repo unless the user asks for it.

## File templates

**SECURITY.md**

```markdown
# Security policy

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab of this repository, not in a public issue. You can expect a first answer within <N> days.
```

Private vulnerability reporting must be on for that button: `gh api -X PUT repos/{repo}/private-vulnerability-reporting` (ask first; it is a settings change).

**.github/dependabot.yml** (keep only the ecosystems the repo uses)

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: npm        # or pip, gomod, cargo, docker, ...
    directory: /
    schedule: { interval: weekly }
```

**CODEOWNERS**

```text
* @owner-or-team
```

**Workflow hardening** (for every workflow in `.github/workflows/`)

- Set `permissions:` at the top to the least needed (often `contents: read`).
- Pin third-party actions to a full commit SHA, with the version in a comment.
- Never interpolate `${{ github.event.* }}` into `run:` scripts; pass values through `env:`.
- Avoid `pull_request_target` with a checkout of the PR's code.
