---
name: cloud-setup
description: Audit and configure cloud projects against a secure, cost-safe baseline. Google Cloud is covered in full, and AWS accounts and Azure subscriptions follow the same method. Checks billing and budgets, enabled APIs, IAM least privilege, service-account keys, public exposure (buckets, firewall rules), audit logs, labels, and keyless CI access from GitHub (workload identity federation). The audit is read-only, then the user approves a plan, then the agent applies it with the cloud CLI or Terraform and audits again. Use when the user types /cloud-setup, or asks to "set up", "configure" or "harden" a GCP project, AWS account or Azure subscription, "create a new cloud project", "add a budget alert", "connect GitHub Actions to GCP", or "review IAM".
---

# Cloud setup

Bring a cloud project to a known, safe baseline, or bootstrap a new one. Cloud changes cost money and can lock people out, so this skill is strict: audit first, show a plan, change only what the user approves, and audit again.

If the user profile exists (`~/.config/agent-skills/profile.md`, see the repo README), read it first. It can name the CLI configuration, organization, billing account, region, labels and budget defaults.

## 0. Pin the target and the identity

- **Which cloud and which project.** Google Cloud project ID, AWS account ID, or Azure subscription ID. Never guess. If the user named none, list what the CLI can see and ask.
- **Which identity.** Show who the CLI acts as before anything else: `gcloud config list` and `gcloud auth list`, `aws sts get-caller-identity`, or `az account show`. Confirm it is the right account for this project.
- **Do not change the user's defaults.** Pass the project explicitly (`--project`, `--profile`, `--subscription`) instead of switching the active configuration. Use a named configuration only if the profile names one.
- **Is it managed as code?** Look for Terraform, Pulumi or deployment config that names this project (`grep -rl <project-id> --include=*.tf .`). If the project is managed as code, make changes in the code and run its plan. Do not fix drift by hand.

## 1. Audit (read-only)

**Google Cloud:**

```bash
node <this skill's folder>/scripts/audit-gcp.mjs <project-id> [--configuration <name>] [--json]
node <this skill's folder>/scripts/audit-gcp.mjs <project-id> --print-commands   # list the read-only gcloud calls, run nothing
```

The script runs read-only `gcloud` commands and checks these:

- the project is active, billing state, and a budget alert that covers the project;
- no `allUsers` or `allAuthenticatedUsers` IAM bindings;
- no Owner or Editor roles on service accounts;
- owners and members from outside domains;
- user-managed service-account keys, and how old they are;
- ingress firewall rules open to the internet on SSH, RDP or all ports;
- public buckets, and buckets without uniform access or public-access prevention;
- data-access audit logs, labels, and the enabled APIs.

Each finding has a suggested `gcloud` fix for you to review. The script never runs those fixes. The `gcloud` launcher is a POSIX shell script. If `/bin/sh` is blocked or broken on the machine, add `--shell bash` to start it through `bash`.

**AWS and Azure:** run the read-only commands in `references/aws-azure.md` and fill the same checklist. Use a cheap-tier worker (the `subagent` skill) to sort long JSON outputs. You read the findings yourself.

Report unknown checks (no permission to read) as unknown, not as a pass.

## 2. Plan

List each finding with its fix, the risk of the fix, and the rollback. Order: public exposure first, then keys and broad roles, then cost guards, then hygiene. Mark the changes that can break something running, for example removing a role a workload uses or closing a firewall rule. Check usage first (recent logins, recent key use, the services that run as that account).

Ask for a clear yes on the plan. Ask separately, naming the consequence, before any of these:

- linking or changing a billing account, or creating a project;
- granting or removing Owner, Editor or any IAM admin role;
- deleting anything (keys, rules, buckets, service accounts, projects);
- changing organization policies or folders;
- enabling paid services or creating resources that bill by the hour.

## 3. Apply

- Run one change at a time, with the project flag set explicitly, and show each command before you run it.
- With Terraform, run `terraform plan`, show the plan, and wait for a yes before `terraform apply`.
- Add before you remove: grant the narrower role first, check the workload still works, then remove the broad one.
- Keep a rollback line for each change (for example, the `add-iam-policy-binding` that undoes a removal).

## 4. Verify and report

Re-run the audit. Report each check before and after, what is still open and why, and the rollback commands. Do not paste key material, tokens or full IAM policies with personal emails into notes or logs.

## New project bootstrap

When the user asks for a new project, follow `references/gcp-bootstrap.md`. It covers: create under the right folder, link billing (with a yes), set a budget with alerts, enable only the APIs needed, add labels, create a deploy service account with narrow roles, and set up workload identity federation, so that GitHub Actions deploys without service-account keys. Pair it with the `github-setup` skill for the repository side.

## Rules

- Read-only until the user says yes. One yes covers the plan you showed, not later additions.
- Never create, download or print service-account keys, access keys or secrets. Prefer workload identity federation and short-lived credentials.
- Never weaken a control to make a check pass, and never remove the user's own access.
- Treat cost as a risk: say when a change can create charges.
- Write the prose in plain style (the `explain-style` skill).
