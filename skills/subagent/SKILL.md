---
name: subagent
description: Delegate bounded work to subagents on cheaper models, run independent pieces in parallel, and use the other local agent harnesses (Claude Code, Codex, OpenCode, Ollama, DeepSeek harness) as workers, second opinions or test runners. Use when the user types /subagent, or asks to "delegate", "fan out", "spin up subagents", "use a cheaper model", "get a second opinion from Codex/Claude", "test this in another harness", or "which harnesses work".
---

# Subagent

You are the lead. You keep the judgment, the integration and the final check. Workers on cheaper models do bounded pieces. This skill says what to hand off, at which tier, how to brief it, how to run it in this harness or another one, and how to check what comes back.

If the user gives a task with /subagent, do that task with this method. If the user gives no task, run the harness check (section 5) and report what is available.

If the user profile exists (`~/.config/agent-skills/profile.md`, see the repo README), read it first. It can set data rules and local conventions that apply to every worker.

## 1. Split the work

**Keep for yourself:** decisions and tradeoffs, anything that needs the whole conversation, combining results, the final check, anything that touches secrets, messages to people, and pushes or deploys.

**Delegate:** work that a stranger could do from a written brief, with output you can check cheaply. For example:

- find, read and summarize code, docs or logs;
- inventories (endpoints, dependencies, config keys, call sites);
- mechanical edits from an exact spec;
- running tests or linters and sorting the failures;
- per-file or per-item checks that fan out;
- drafting tests or boilerplate to a clear spec;
- an independent second opinion.

Do not delegate when the brief costs more than the work, or when you cannot check the result. Run independent pieces in parallel. Run dependent pieces in order, and check A before B starts.

## 2. Pick the tier

| Tier | Claude | Codex | Local (Ollama) | Use for |
|---|---|---|---|---|
| cheap | claude-haiku-5-5 | gpt-6-luna, low effort | qwen3.5 | search, read, summarize, extract, classify, inventory, log triage, mechanical edits with a checker |
| standard | claude-sonnet-5-5 | gpt-6.1-sol, medium | qwen3-coder | scoped code changes, writing tests, debugging with a repro, per-finding analysis |
| frontier | claude-opus-5-5 | gpt-6-astra, high | qwen3.8:27b | design, unclear bugs, security verification, a task a lower tier failed |

`subagent tiers` prints the current table from `config/tiers.json`. If it differs from the table above, it wins.

- Start at the lowest tier that can do the job.
- If a worker fails, sharpen the brief once. If it fails again, go up one tier.
- Never check work with a weaker model than the one that did it. The check is yours, or a tier at least as strong.

## 3. Write the brief

A worker starts with nothing. It has not seen this conversation. Use the template in `references/brief-template.md`:

- **Goal:** one sentence, what and why.
- **Scope:** files, folders, commit; what is out of scope.
- **Constraints:** read-only or write; which files may change; time or cost limit.
- **What you already know:** so the worker does not find it again.
- **Output contract:** the exact format (headings or a JSON shape), `path:line` for every claim, "checked" or "inferred" on each claim, and what to say if blocked.
- **Done when:** the stop condition.

Give each brief one job. Ten small briefs are better than one big one: they run in parallel and fail one at a time.

## 4. Run it

Use this harness's own subagent tool when it has one. The UI shows the workers, and the results come back into your context. Use the `subagent` CLI when you need another model family, a tier this harness does not have, or a run record on disk.

**Claude Code.** Use the Agent tool with `model: "haiku"`, `"sonnet"` or `"opus"` from the tier. These are aliases: in Claude Code 2.1.283 `haiku` resolves to Haiku 4.5 and `sonnet` to Sonnet 5, not the current 5.5 models. That is still cheaper than you; when the exact model matters, use `subagent run --via claude`, which passes exact IDs. Use `subagent_type: "Explore"` for read-only search. Several Agent calls in one message run in parallel. Use `run_in_background: true` for long jobs and `isolation: "worktree"` for workers that edit. For more than about 5 workers or a multi-stage pipeline, use the Workflow tool if this session has it: The user typing /subagent is the opt-in. Keep it under 10 workers unless the user asks for more, and say the size before you start.

**Codex.** Use `spawn_agent` with `model` and `reasoning_effort` from the tier (for example `gpt-6-luna`, `low`). The user typing /subagent is the explicit request that lets you set `model`. Collect results with `wait_agent`. Call `close_agent` when a worker is done, because finished workers still count toward the concurrency limit.

**OpenCode.** Use the task tool with a subagent, or an `@name` mention. The model comes from the agent's file in `~/.config/opencode/agents/`.

**DeepSeek harness.** Use its subagent tool. The model is the profile default.

**Any harness with a shell.** Use the `subagent` CLI (on `PATH` after `install.sh`; the source is `bin/subagent` in this repo):

```bash
subagent run --via codex --tier cheap --cwd <repo> --prompt-file brief.md
subagent run --via other --tier frontier --cwd <repo> --prompt-file review.md
subagent run --via ollama --attach build.log --prompt "List each distinct error with its first line number."
subagent batch tasks.jsonl --parallel 4
```

- `--via other` picks a different model family from yours (Codex when you are Claude, Claude otherwise).
- The answer goes to stdout. The run folder (brief, output, logs, `meta.json` with model, time and cost) is named on stderr.
- `--dry-run` prints the exact command and spends nothing.
- Write tasks need `--mode write --cwd <scratch worktree>`.
- Ollama has no tools. Give it what it needs with `--attach`.
- `--attach` inlines text files with 1-based line numbers (`cat -n` style), so line references in the answer match the file. Pass `--line-numbers=false` to inline the plain text.
- The batch file format is in `references/brief-template.md`.

**Sandboxes.** A harness that runs commands in a sandbox usually blocks the network and keychain that another harness needs. Run `subagent` with this harness's sandbox override (in Claude Code, `dangerouslyDisableSandbox: true` on that Bash call; in Codex, ask for escalation). Say that you did it. Run long jobs in the background and carry on.

## 5. Check which harnesses work

```bash
subagent doctor          # installed, signed in, tier models, where the data goes, skills linked
subagent doctor --probe  # also sends a one-line brief to each harness on its cheap tier
```

Run `--probe` before you rely on another harness in a session, and when the user asks which harnesses work. Show the table. Do not use a harness that fails the probe; say why (not signed in, server down, model not pulled). `references/harness-matrix.md` has the headless commands, skill folders and known traps for each harness.

## 6. Use other harnesses for testing

- **Second opinion.** Send the same review brief with `--via other`. Agreement raises confidence. Disagreement goes to the user with both views. Different model families make different mistakes.
- **Skill or instruction changes.** Write the test brief once and put one line per harness in a batch file. Compare the answers. For example, ask each harness to list the skills it can see.
- **Clean-room setup test.** A write-mode worker in a scratch worktree follows the README install and test steps exactly as written and reports where it got stuck. This finds missing steps.
- **Big local inputs.** Ollama summarizes large logs or files you attach, and no data leaves the machine.

## 7. Check what comes back

A worker's output is a claim, not a fact.

- Open a sample of the cited `path:line` yourself. Open all of them when the result drives a decision.
- Re-run tests that a worker says pass. For write tasks, read the full diff before you take anything from the worktree.
- If the output is wrong or vague, fix the brief and rerun, or go up a tier. Do not hide the gap.
- When you report to the user, say which parts came from workers and what you checked.

## 8. Safety

- Read-only by default. Writes happen only in a scratch git worktree or a folder made for the task. Never in the user's main checkout. Workers never push, publish or deploy.
- A brief is data sent to that harness's provider: Claude to Anthropic, Codex to OpenAI, Ollama stays local, OpenCode goes to its model's provider, and the DeepSeek harness goes to the provider in its profile. Treat free or preview models as public: assume prompts are kept.
- Never put credentials, keys or customer data in a brief. Confidential code goes only to providers the user already uses for that repo (the profile may list them), or to local models.
- Workers do not run session-start rituals from global agent instructions, claim tasks, write logs or notes, or message people. The lead does that once for the whole job. The CLI's worker preamble says this.
- Workers do not start their own workers unless the brief says so. Maximum depth is 2.
- Before a fan-out of more than about 5 workers, say how many and which tiers. Use `--budget-usd` on Claude CLI runs that could loop.

## 9. Report

End with a short ledger: each worker, its tier and model, what it did, the result, and whether you checked it. Then give the combined answer. Write the prose in plain style (the `explain-style` skill).
