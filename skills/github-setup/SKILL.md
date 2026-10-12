---
name: github-setup
description: Audit and configure GitHub repositories, and GitHub Projects boards, against a chosen baseline. Covers visibility, branch rules, merge settings, Actions token permissions, security features (secret scanning, push protection, Dependabot, code scanning) and community files (README, LICENSE, SECURITY.md, CODEOWNERS, dependabot.yml). The audit is read-only, then the user approves a change plan, then the agent applies it with `gh` and audits again. Use when the user types /github-setup, or asks to "set up", "configure" or "harden" a GitHub repo, "add branch protection", "make this repo public-ready", "turn on Dependabot or secret scanning", or "set up a GitHub project board".
---

# GitHub setup

Bring a GitHub repository to a known baseline, with proof. Audit first, change only what the user approves, and audit again at the end.

If the user profile exists (`~/.config/agent-skills/profile.md`, see the repo README), read it first. It can set the default account, baseline, license, commit email and push rules.

## 1. Pin the target

- **Repository.** `owner/name`, from the user or from `git remote get-url origin`. For several repos, run the audit once per repo; a cheap-tier worker (the `subagent` skill) can run the loop and collect the tables.
- **Baseline.** One of `personal-public`, `personal-private` or `team`. `references/baselines.md` says what each one requires. Default: the profile's baseline, else `personal-public` for public repos and `personal-private` for private ones.
- **Who acts.** Show `gh auth status` (account and scopes). Organization repos may need SSO authorization or an org admin. Say so instead of working around it.

## 2. Audit (read-only)

```bash
node <this skill's folder>/scripts/audit.mjs owner/name --baseline personal-public
node <this skill's folder>/scripts/audit.mjs owner/name --baseline team --json   # for tooling
```

The script reads the repo settings, branch rules, Actions permissions, security features and key files through `gh api`. It prints one row per check: pass, fail, unknown (no permission, or the API did not say) or n/a (not available on this plan). Each failed check names its fix: `api` (the script can apply it), `pr` (a file to add through a pull request) or `user` (needs the user's input or an admin).

## 3. Plan

Group the failed and unknown checks:

1. **Settings the script can apply** (`api`): list the check IDs.
2. **Files** (`pr`): README, LICENSE, SECURITY.md, CODEOWNERS, `.github/dependabot.yml`, CI workflows. Draft them on a branch and open a pull request. Never commit them straight to the default branch. `references/baselines.md` has starting templates.
3. **Needs the user** (`user`): description and topics text, features that need a paid plan, organization policies, anything that changes who has access.

Show the plan as a short table and ask for a clear yes. Ask separately, and name the consequence, before any of these:

- changing visibility (public ↔ private);
- archiving, renaming, transferring or deleting a repo;
- removing collaborators, teams or deploy keys;
- force-pushing or rewriting history.

## 4. Apply

```bash
node <this skill's folder>/scripts/audit.mjs owner/name --baseline personal-public --apply delete-branch-on-merge,vulnerability-alerts --dry-run
node <this skill's folder>/scripts/audit.mjs owner/name --baseline personal-public --apply delete-branch-on-merge,vulnerability-alerts
```

Always run `--dry-run` first and show the exact API calls. After the yes, run it without `--dry-run`. The script applies only the IDs you list, then audits again and prints the before and after.

For files, create a branch, commit, push and open a pull request with `gh pr create`. Follow the profile's push rules; without a profile, ask before every push.

## 5. Verify and report

Re-run the audit. Report a table with each check, its status before and after, and anything still open, with who or what it waits on. Link the pull request for file changes.

## Making a repo public

Visibility is the user's decision. Before you recommend it:

- Run the `security` skill's secret scan on the full git history, not only the current files (`gitleaks git <path>` if it is installed).
- If the user keeps a private-terms list or a profile, check the files and the history for those terms (names, customers, internal hosts). History is public too: content removed in a later commit is still visible.
- If the history holds private content, offer two routes: publish a fresh single-commit history (new repo or replaced default branch), or clean the history. Both need the user's explicit yes.
- Make sure LICENSE, README and SECURITY.md exist, then switch on the `personal-public` checks (secret scanning, push protection and code scanning are free on public repos).
- Change visibility only after an explicit yes: `gh repo edit owner/name --visibility public --accept-visibility-change-consequences`.

## GitHub Projects (boards)

The user may mean the Projects feature (planning boards) instead of repositories.

- The `gh` token needs the `project` scope. Check with `gh auth status`; if it is missing, ask the user to run `gh auth refresh -s project`. Do not run it for them; it opens a browser sign-in.
- Create and link: `gh project create --owner <owner> --title "<title>"`, then `gh project link <number> --owner <owner> --repo owner/name`.
- Fields: `gh project field-create <number> --owner <owner> --name Priority --data-type SINGLE_SELECT --single-select-options "P0,P1,P2"`. A good default set: Status (built in), Priority, Size, Target date.
- Add work: `gh project item-add <number> --owner <owner> --url <issue-or-pr-url>`.
- Read before you change: `gh project list --owner <owner>`, `gh project view <number> --owner <owner>`, `gh project field-list <number> --owner <owner>`.

## Rules

- Read-only until the user says yes. One yes covers the plan you showed, not later additions.
- Never weaken a setting to make a check pass, never turn off a security feature, and never remove someone's access without an explicit request.
- Do not store secrets in repository files or variables. Repository secrets are set by the user (`gh secret set` prompts for the value); do not echo secret values.
- Write the prose in plain style (the `explain-style` skill).
