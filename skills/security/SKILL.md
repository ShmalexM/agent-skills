---
name: security
description: Defensive security review of a repo, diff, PR, dependency set or config, using tiered subagents. Deterministic scanners run first, cheap models map the attack surface, a stronger model hunts by category, and a different model family tries to disprove each finding before it is reported. Use when the user types /security, or asks for a "security review", "security audit", "is this safe to merge", "check for vulns/secrets", or "threat model this". Defensive only, for code and systems the user owns or is authorized to assess.
---

# Security review

Find real, reachable weaknesses in code the user owns or is authorized to assess. Report each one with evidence and a fix. A short list of verified findings is worth more than a long list of guesses.

This skill uses the `subagent` skill for delegation. Load it now and follow its brief, tier and checking rules.

## 0. Scope and gate

- **Target.** One of: a diff or PR (quick), a repo or subsystem (standard), or a repo plus threat model (deep). Default: quick for a diff or PR, standard for a repo.
- **Pin it.** Record the repo, branch and full commit SHA. Review a detached worktree of that commit in a scratch folder, not the user's working checkout.
- **Authorization.** Only code and systems the user owns or is authorized to test. Do not scan, probe or attack live third-party hosts. Run code only locally, in a scratch environment.
- **Context gate.** Read the user profile (`~/.config/agent-skills/profile.md`) if it exists. If it names a check to run before a review (for example a repository classification script), run it on the checkout. Read the repo's `AGENTS.md`. For customer, deployment or private checkouts, the report stays private, and briefs go only to the providers the profile allows (by default, the provider of this session or local models).
- **Say the plan.** Before a fan-out, tell the user the mode, the slices, and roughly how many workers at which tiers.

## 1. Deterministic scanners (no model)

```bash
node <this skill's folder>/scripts/scanners.mjs <checkout> --out <run folder> [--offline]
```

The script finds installed scanners (gitleaks, trufflehog, semgrep, osv-scanner, npm audit, pip-audit, bandit, trivy, govulncheck, zizmor, hadolint), runs each read-only, and writes `scanners.json` with what ran, what was skipped and what is missing. `--offline` skips tools that call the network. It never installs anything. If key scanners are missing, list them in the report and offer the install command; do not install without a yes.

Scanner hits are leads, not findings. They go through the same check as model findings (step 4).

## 2. Map the attack surface (cheap tier, parallel)

Split the code into 3 to 6 slices (for example: API and auth, data and storage, background jobs and integrations, frontend, CI and deploy config). Send one cheap-tier worker per slice with a read-only brief. Ask each for a JSON list of:

- entry points: HTTP routes, CLI commands, queue consumers, webhooks, MCP tools, file or URL inputs, with `path:line` and the auth check (or `none`);
- trust boundaries: where untrusted data enters and where privilege changes;
- sinks: SQL, shell or `exec`, templates, file paths, outbound HTTP, deserialization, `eval`, crypto, secrets reads;
- each item tagged "checked" or "inferred".

Merge the maps yourself. This is the input for the hunt and the "checked areas" list in the report.

For a quick (diff) review, skip the full map: map only the entry points and sinks that the diff touches or reaches.

## 3. Hunt (standard tier, one worker per category or component)

Use the categories and the questions in `references/hunt-categories.md`: access control, injection, secrets and crypto, input handling and deserialization, SSRF and outbound calls, supply chain and CI, config and infrastructure, and LLM or agent risks (prompt injection that reaches tools, tool scope, MCP exposure).

Each brief carries the merged map for its area, the scanner leads in that area, and this output contract for each candidate:

```json
{"title": "", "category": "", "location": "path:line", "source_to_sink": ["path:line: what happens"],
 "preconditions": "", "impact": "", "confidence": "high|medium|low", "fix": "", "evidence": "checked|inferred"}
```

Workers describe a weakness in prose. They do not write working exploit code or payloads beyond the minimum needed to name the bug class.

## 4. Verify (frontier tier, other model family)

Every candidate goes to a skeptic whose job is to disprove it. Use a different model family from the one that found it: `subagent batch` with `"via": "other"` and `"tier": "frontier"`, one line per candidate (or per small group in the same file). The skeptic answers:

- Is the input really attacker-controlled on this path?
- Is there a guard upstream or downstream (auth middleware, validation, ORM parameters, framework escaping)?
- Is the code reachable in a real deployment (not dead, not test-only, not behind an admin-only flag)?
- What is the realistic impact?

Verdicts: **CONFIRMED** (evidence holds), **PLAUSIBLE** (could not rule it out; say what would settle it), **REJECTED** (with the reason). Read the key lines yourself for every CONFIRMED finding of high or critical severity. If the two families disagree, report the finding as PLAUSIBLE with both views. Drop REJECTED items, but count them in the report.

In deep mode, also verify the high-impact "checked and clean" claims from step 2 with a second worker. Absence of findings is a claim too.

## 5. Report

Use `references/report-template.md`. Severity = reachability × impact, with one line of reasoning per finding (Critical, High, Medium, Low, Info). For each finding: location, the source-to-sink path, why it is exploitable (prose, no weaponized payload), the fix, verification status, and which models agreed.

Also list:

- areas checked and found clean, with what "checked" covered;
- what was not covered (and why), and which scanners were missing;
- the worker ledger from the `subagent` skill (workers, tiers, models, checked or not).

Save the report in a private place, not inside the reviewed repo unless the user asks: the profile's report folder if it names one, otherwise `~/security-reviews/<repo>-<short-sha>-<date>.md`. Show the findings table and the path in chat.

## 6. Fix mode (only when the user asks)

Fix in a scratch worktree, one finding per commit, each with a test that fails before the fix and passes after. Then re-run step 4 on the changed code. Never push; publication follows the user's normal rules (see the profile).

## Rules

- Defensive work only. No attacks on systems the user does not own, no live-target scanning, no detection-evasion help, no working exploits.
- Redact secrets you find: show the type, the location and the first 4 characters only. Never copy a secret into a brief, a report or a log.
- Undisclosed vulnerabilities stay private. Do not open public issues, PRs or posts about them; the user decides on disclosure.
- Any log, note or status update names the review and the counts, not the exploit details.
- Write the prose in plain style (the `explain-style` skill).
